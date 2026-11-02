import type { AppContainer } from './container.js';
import type { Actor } from '../domain/shared/types.js';
import { requireRole } from './shared/context.js';

export class AuditService {
  constructor(private readonly c: AppContainer) {}

  async list(
    actor: Actor,
    filter: { entidad?: string; entidadId?: string; limit: number; offset: number },
  ) {
    if (actor.role === 'administrador') {
      return this.c.auditoria.list({
        entity: filter.entidad,
        entityId: filter.entidadId,
        limit: filter.limit,
        offset: filter.offset,
      });
    }
    requireRole(actor, 'preceptor', 'docente', 'alumno', 'tutor');
    return this.c.auditoria.list({
      entity: filter.entidad,
      entityId: filter.entidadId,
      actorId: actor.id,
      limit: filter.limit,
      offset: filter.offset,
    });
  }
}
