import type { Tx } from '../shared/types.js';
import type { RegistroAuditoria } from './entities.js';

export interface AuditoriaRepository {
  append(entry: RegistroAuditoria, tx?: Tx): Promise<void>;
  list(
    filter: {
      entity?: string;
      entityId?: string;
      actorId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<RegistroAuditoria[]>;
  listByIds(
    filter: { entity: string; entityIds: string[]; limit: number; offset: number },
    tx?: Tx,
  ): Promise<RegistroAuditoria[]>;
}
