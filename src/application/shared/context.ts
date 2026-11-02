import type { Actor, UserId } from '../../domain/shared/types.js';
import type { Tx } from '../../domain/shared/types.js';
import { ForbiddenError } from '../../domain/shared/errors.js';
import type { AppContainer } from '../container.js';
import { RegistroAuditoria } from '../../domain/audit/entities.js';
import type { RegistroAuditoriaProps } from '../../domain/audit/entities.js';

export interface RequestContext {
  actor: Actor;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export function requireRole(actor: Actor, ...roles: Actor['role'][]): void {
  if (!roles.includes(actor.role)) {
    throw new ForbiddenError();
  }
}

export function requireSelfOrRole(actor: Actor, userId: string, ...roles: Actor['role'][]): void {
  if (actor.id === userId) return;
  requireRole(actor, ...roles);
}

export function isAdmin(actor: Actor): boolean {
  return actor.role === 'administrador';
}

export function isStaff(actor: Actor): boolean {
  return actor.role === 'administrador' || actor.role === 'preceptor' || actor.role === 'docente';
}

export async function writeAudit(
  container: AppContainer,
  tx: Tx,
  entry: {
    entidad: string;
    entidadId: string;
    accion: RegistroAuditoriaProps['accion'];
    actor: Actor | null;
    motivo?: string | null;
    antes?: Record<string, unknown> | null;
    despues?: Record<string, unknown> | null;
    requestId?: string | null;
  },
): Promise<void> {
  await container.auditoria.append(
    RegistroAuditoria.reconstitute({
      id: container.ids.uuid(),
      entidad: entry.entidad,
      entidadId: entry.entidadId,
      accion: entry.accion,
      actorId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      motivo: entry.motivo ?? null,
      antes: entry.antes ?? null,
      despues: entry.despues ?? null,
      requestId: entry.requestId ?? null,
      ocurridoEn: container.clock.now(),
    }),
    tx,
  );
}

export function asUserId(value: string): UserId {
  return value as UserId;
}
