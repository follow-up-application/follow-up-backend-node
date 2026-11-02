import type { Tx } from '../shared/types.js';
import type {
  Calificacion,
  CondicionAlumno,
  InstanciaEvaluacion,
  Periodo,
  PeriodoCierre,
  ReglaCondicion,
} from './entities.js';

export interface PeriodoRepository {
  findById(id: string, tx?: Tx): Promise<Periodo | null>;
  findForUpdate(id: string, tx: Tx): Promise<Periodo | null>;
  findOpenByCycle(cycleId: string, tx?: Tx): Promise<Periodo[]>;
  list(
    filter: { cycleId?: string; status?: 'abierto' | 'cerrado'; limit: number; offset: number },
    tx?: Tx,
  ): Promise<Periodo[]>;
  save(periodo: Periodo, tx?: Tx): Promise<void>;
}

export interface InstanciaEvaluacionRepository {
  findById(id: string, tx?: Tx): Promise<InstanciaEvaluacion | null>;
  findByMateriaAndPeriodo(materiaId: number, periodId: string, tx?: Tx): Promise<InstanciaEvaluacion[]>;
  list(
    filter: {
      materiaId?: number;
      materiaIds?: number[];
      periodId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<InstanciaEvaluacion[]>;
  save(instancia: InstanciaEvaluacion, tx?: Tx): Promise<InstanciaEvaluacion>;
}

export interface CalificacionRepository {
  findById(id: string, tx?: Tx): Promise<Calificacion | null>;
  findForUpdate(id: string, tx: Tx): Promise<Calificacion | null>;
  findByInstanciaAndAlumno(instanciaId: string, alumnoId: string, tx?: Tx): Promise<Calificacion | null>;
  findByAlumnoAndPeriodo(alumnoId: string, periodId: string, tx?: Tx): Promise<Calificacion[]>;
  findByPeriodo(periodId: string, tx?: Tx): Promise<Calificacion[]>;
  list(
    filter: {
      instanciaId?: string;
      alumnoId?: string;
      alumnoIds?: string[];
      periodId?: string;
      materiaId?: number;
      materiaIds?: number[];
      courseIds?: number[];
      teacherId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Calificacion[]>;
  save(calificacion: Calificacion, tx?: Tx): Promise<void>;
}

export interface ReglaCondicionRepository {
  findForPeriodoAndMateria(
    periodId: string,
    materiaId: number | null,
    tx?: Tx,
  ): Promise<ReglaCondicion | null>;
  listByPeriodo(periodId: string, tx?: Tx): Promise<ReglaCondicion[]>;
  save(regla: ReglaCondicion, tx?: Tx): Promise<void>;
}

export interface CondicionAlumnoRepository {
  findByPeriodo(
    periodId: string,
    filter: {
      materiaId?: number;
      materiaIds?: number[];
      alumnoId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<CondicionAlumno[]>;
  findByAlumnoAndPeriodo(alumnoId: string, periodId: string, tx?: Tx): Promise<CondicionAlumno[]>;
  replaceForPeriod(periodId: string, conditions: CondicionAlumno[], tx: Tx): Promise<void>;
  updateOne(condition: CondicionAlumno, tx: Tx): Promise<void>;
}

export interface PeriodoCierreRepository {
  findByPeriodo(periodId: string, tx?: Tx): Promise<PeriodoCierre | null>;
  create(cierre: PeriodoCierre, tx: Tx): Promise<void>;
}
