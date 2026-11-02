import type { AsistenciaRepository } from '../../../domain/attendance/ports.js';
import type { Asistencia } from '../../../domain/attendance/entities.js';
import type { Tx } from '../../../domain/shared/types.js';
import { StaleVersionError } from '../../../domain/shared/errors.js';
import { clientOf } from '../client.js';
import { mapAsistencia } from '../mappers.js';

export class PgAsistenciaRepository implements AsistenciaRepository {
  async findById(id: string, tx?: Tx): Promise<Asistencia | null> {
    const result = await clientOf(tx).query('SELECT * FROM asistencias WHERE id = $1', [id]);
    return result.rows[0] ? mapAsistencia(result.rows[0]) : null;
  }

  async findByClaseAndAlumno(
    claseId: string,
    alumnoId: string,
    tx?: Tx,
  ): Promise<Asistencia | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM asistencias WHERE clase_id = $1 AND alumno_id = $2',
      [claseId, alumnoId],
    );
    return result.rows[0] ? mapAsistencia(result.rows[0]) : null;
  }

  async findByClase(claseId: string, tx?: Tx): Promise<Asistencia[]> {
    const result = await clientOf(tx).query(
      'SELECT * FROM asistencias WHERE clase_id = $1 ORDER BY created_at',
      [claseId],
    );
    return result.rows.map(mapAsistencia);
  }

  async findByAlumnoAndPeriodo(
    alumnoId: string,
    periodId: string,
    tx?: Tx,
  ): Promise<Asistencia[]> {
    const result = await clientOf(tx).query(
      `SELECT a.* FROM asistencias a
         JOIN clases c ON c.id = a.clase_id
         JOIN periodos p ON p.id = $2 AND c.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
       WHERE a.alumno_id = $1
       ORDER BY c.fecha, c.hora_inicio`,
      [alumnoId, periodId],
    );
    return result.rows.map(mapAsistencia);
  }

  async list(
    filter: { alumnoId?: string; claseId?: string; limit: number; offset: number },
    tx?: Tx,
  ): Promise<Asistencia[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.alumnoId) {
      values.push(filter.alumnoId);
      conditions.push(`alumno_id = $${values.length}`);
    }
    if (filter.claseId) {
      values.push(filter.claseId);
      conditions.push(`clase_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT * FROM asistencias ${where} ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapAsistencia);
  }

  async save(asistencia: Asistencia, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM asistencias WHERE id = $1', [asistencia.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE asistencias SET estado = $2, justificacion = $3, registrada_por = $4,
           version = version + 1
         WHERE id = $1 AND version = $5`,
        [
          asistencia.id,
          asistencia.estado,
          asistencia.justificacion,
          asistencia.registradaPor,
          asistencia.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO asistencias (id, clase_id, alumno_id, estado, justificacion, registrada_por, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          asistencia.id,
          asistencia.claseId,
          asistencia.alumnoId,
          asistencia.estado,
          asistencia.justificacion,
          asistencia.registradaPor,
          asistencia.version,
        ],
      );
    }
  }
}
