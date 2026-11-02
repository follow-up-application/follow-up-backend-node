import type { Tx } from '../shared/types.js';
import type {
  CicloLectivo,
  Clase,
  CursoDivisionTurno,
  Inscripcion,
  Institucion,
  Materia,
} from './entities.js';

export interface InstitucionRepository {
  findById(id: string, tx?: Tx): Promise<Institucion | null>;
  list(tx?: Tx): Promise<Institucion[]>;
  save(institucion: Institucion, tx?: Tx): Promise<void>;
}

export interface CicloLectivoRepository {
  findById(id: string, tx?: Tx): Promise<CicloLectivo | null>;
  findActiveByInstitution(institutionId: string, tx?: Tx): Promise<CicloLectivo | null>;
  findActive(tx?: Tx): Promise<CicloLectivo | null>;
  list(tx?: Tx): Promise<CicloLectivo[]>;
  save(ciclo: CicloLectivo, tx?: Tx): Promise<void>;
}

export interface CursoDivisionTurnoRepository {
  findById(id: number, tx?: Tx): Promise<CursoDivisionTurno | null>;
  findByAttributes(
    cicloId: string,
    curso: number,
    division: string,
    turno: string,
    tx?: Tx,
  ): Promise<CursoDivisionTurno | null>;
  list(
    filter: { cicloId?: string; courseIds?: number[]; limit: number; offset: number },
    tx?: Tx,
  ): Promise<CursoDivisionTurno[]>;
  save(curso: CursoDivisionTurno, tx?: Tx): Promise<CursoDivisionTurno>;
  delete(id: number, tx?: Tx): Promise<void>;
  countStudents(courseId: number, tx?: Tx): Promise<number>;
}

export interface MateriaRepository {
  findById(id: number, tx?: Tx): Promise<Materia | null>;
  findByTeacher(teacherId: string, tx?: Tx): Promise<Materia[]>;
  findByCourse(courseId: number, tx?: Tx): Promise<Materia[]>;
  list(
    filter: {
      courseId?: number;
      courseIds?: number[];
      teacherId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Materia[]>;
  save(materia: Materia, tx?: Tx): Promise<Materia>;
  delete(id: number, tx?: Tx): Promise<void>;
  count(tx?: Tx): Promise<number>;
}

export interface InscripcionRepository {
  findById(id: number, tx?: Tx): Promise<Inscripcion | null>;
  findActiveByAlumnoAndMateria(
    alumnoId: string,
    materiaId: number,
    tx?: Tx,
  ): Promise<Inscripcion | null>;
  findByAlumno(alumnoId: string, estado?: string, tx?: Tx): Promise<Inscripcion[]>;
  findByMateria(materiaId: number, estado?: string, tx?: Tx): Promise<Inscripcion[]>;
  list(
    filter: {
      alumnoId?: string;
      alumnoIds?: string[];
      materiaId?: number;
      teacherId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Inscripcion[]>;
  save(inscripcion: Inscripcion, tx?: Tx): Promise<Inscripcion>;
}

export interface ClaseRepository {
  findById(id: string, tx?: Tx): Promise<Clase | null>;
  findByMateriaAndRange(materiaId: number, from: string, to: string, tx?: Tx): Promise<Clase[]>;
  list(
    filter: {
      materiaId?: number;
      teacherId?: string;
      courseId?: number;
      courseIds?: number[];
      from?: string;
      to?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Clase[]>;
  save(clase: Clase, tx?: Tx): Promise<Clase>;
}
