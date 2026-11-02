import type { Tx } from '../shared/types.js';
import type { Asistencia } from './entities.js';

export interface AsistenciaRepository {
  findById(id: string, tx?: Tx): Promise<Asistencia | null>;
  findByClaseAndAlumno(claseId: string, alumnoId: string, tx?: Tx): Promise<Asistencia | null>;
  findByClase(claseId: string, tx?: Tx): Promise<Asistencia[]>;
  findByAlumnoAndPeriodo(alumnoId: string, periodId: string, tx?: Tx): Promise<Asistencia[]>;
  list(
    filter: { alumnoId?: string; claseId?: string; limit: number; offset: number },
    tx?: Tx,
  ): Promise<Asistencia[]>;
  save(asistencia: Asistencia, tx?: Tx): Promise<void>;
}
