import type { AuditoriaRepository } from '../../../domain/audit/ports.js';
import type { RegistroAuditoria } from '../../../domain/audit/entities.js';
import type { Tx } from '../../../domain/shared/types.js';
import { clientOf } from '../client.js';
import { mapAuditoria } from '../mappers.js';

export class PgAuditoriaRepository implements AuditoriaRepository {
  async append(entry: RegistroAuditoria, tx?: Tx): Promise<void> {
    const props = entry.toProps();
    await clientOf(tx).query(
      `INSERT INTO auditoria
        (entidad, entidad_id, accion, actor_id, actor_role, motivo, antes, despues, request_id, ocurrido_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        props.entidad,
        props.entidadId,
        props.accion,
        props.actorId,
        props.actorRole,
        props.motivo,
        props.antes === null ? null : JSON.stringify(props.antes),
        props.despues === null ? null : JSON.stringify(props.despues),
        props.requestId,
        props.ocurridoEn,
      ],
    );
  }

  async list(
    filter: {
      entity?: string;
      entityId?: string;
      actorId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<RegistroAuditoria[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.entity) {
      values.push(filter.entity);
      conditions.push(`entidad = $${values.length}`);
    }
    if (filter.entityId) {
      values.push(filter.entityId);
      conditions.push(`entidad_id = $${values.length}`);
    }
    if (filter.actorId) {
      values.push(filter.actorId);
      conditions.push(`actor_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT * FROM auditoria ${where}
       ORDER BY ocurrido_en DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapAuditoria);
  }

  async listByIds(
    filter: { entity: string; entityIds: string[]; limit: number; offset: number },
    tx?: Tx,
  ): Promise<RegistroAuditoria[]> {
    if (filter.entityIds.length === 0) return [];
    const result = await clientOf(tx).query(
      `SELECT * FROM auditoria WHERE entidad = $1 AND entidad_id = ANY($2::text[])
       ORDER BY ocurrido_en DESC LIMIT $3 OFFSET $4`,
      [filter.entity, filter.entityIds, filter.limit, filter.offset],
    );
    return result.rows.map(mapAuditoria);
  }
}
