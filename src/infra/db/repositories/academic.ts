import type {
  CicloLectivoRepository,
  ClaseRepository,
  CursoDivisionTurnoRepository,
  InscripcionRepository,
  InstitucionRepository,
  MateriaRepository,
} from '../../../domain/academic/ports.js';
import {
  CicloLectivo,
  Clase,
  CursoDivisionTurno,
  Inscripcion,
  Institucion,
  Materia,
} from '../../../domain/academic/entities.js';
import type { Tx } from '../../../domain/shared/types.js';
import type { CourseId, CycleId, EnrollmentId, SubjectId } from '../../../domain/shared/types.js';
import { StaleVersionError } from '../../../domain/shared/errors.js';
import { clientOf } from '../client.js';
import {
  mapCiclo,
  mapClase,
  mapCurso,
  mapInscripcion,
  mapInstitucion,
  mapMateria,
} from '../mappers.js';

export class PgInstitucionRepository implements InstitucionRepository {
  async findById(id: string, tx?: Tx): Promise<Institucion | null> {
    const result = await clientOf(tx).query('SELECT * FROM instituciones WHERE id = $1', [id]);
    return result.rows[0] ? mapInstitucion(result.rows[0]) : null;
  }

  async list(tx?: Tx): Promise<Institucion[]> {
    const result = await clientOf(tx).query('SELECT * FROM instituciones ORDER BY nombre');
    return result.rows.map(mapInstitucion);
  }

  async save(institucion: Institucion, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM instituciones WHERE id = $1', [
      institucion.id,
    ]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE instituciones SET nombre = $2, cue = $3, direccion = $4, telefono = $5,
           email = $6, activa = $7, version = version + 1
         WHERE id = $1 AND version = $8`,
        [
          institucion.id,
          institucion.nombre,
          institucion.cue,
          institucion.direccion,
          institucion.telefono,
          institucion.email,
          institucion.activa,
          institucion.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO instituciones (id, nombre, cue, direccion, telefono, email, activa, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          institucion.id,
          institucion.nombre,
          institucion.cue,
          institucion.direccion,
          institucion.telefono,
          institucion.email,
          institucion.activa,
          institucion.version,
        ],
      );
    }
  }
}

export class PgCicloLectivoRepository implements CicloLectivoRepository {
  async findById(id: string, tx?: Tx): Promise<CicloLectivo | null> {
    const result = await clientOf(tx).query('SELECT * FROM ciclos_lectivos WHERE id = $1', [id]);
    return result.rows[0] ? mapCiclo(result.rows[0]) : null;
  }

  async findActiveByInstitution(institutionId: string, tx?: Tx): Promise<CicloLectivo | null> {
    const result = await clientOf(tx).query(
      `SELECT * FROM ciclos_lectivos WHERE institucion_id = $1 AND estado = 'activo'
       ORDER BY anio DESC LIMIT 1`,
      [institutionId],
    );
    return result.rows[0] ? mapCiclo(result.rows[0]) : null;
  }

  async findActive(tx?: Tx): Promise<CicloLectivo | null> {
    const result = await clientOf(tx).query(
      "SELECT * FROM ciclos_lectivos WHERE estado = 'activo' ORDER BY anio DESC LIMIT 1",
    );
    return result.rows[0] ? mapCiclo(result.rows[0]) : null;
  }

  async list(tx?: Tx): Promise<CicloLectivo[]> {
    const result = await clientOf(tx).query('SELECT * FROM ciclos_lectivos ORDER BY anio DESC');
    return result.rows.map(mapCiclo);
  }

  async save(ciclo: CicloLectivo, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM ciclos_lectivos WHERE id = $1', [ciclo.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE ciclos_lectivos SET institucion_id = $2, anio = $3, fecha_inicio = $4,
           fecha_fin = $5, estado = $6, version = version + 1
         WHERE id = $1 AND version = $7`,
        [
          ciclo.id,
          ciclo.institucionId,
          ciclo.anio,
          ciclo.fechaInicio,
          ciclo.fechaFin,
          ciclo.estado,
          ciclo.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO ciclos_lectivos (id, institucion_id, anio, fecha_inicio, fecha_fin, estado, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          ciclo.id,
          ciclo.institucionId,
          ciclo.anio,
          ciclo.fechaInicio,
          ciclo.fechaFin,
          ciclo.estado,
          ciclo.version,
        ],
      );
    }
  }
}

export class PgCursoDivisionTurnoRepository implements CursoDivisionTurnoRepository {
  async findById(id: number, tx?: Tx): Promise<CursoDivisionTurno | null> {
    const result = await clientOf(tx).query('SELECT * FROM curso_division_turno WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ? mapCurso(result.rows[0]) : null;
  }

  async findByAttributes(
    cicloId: string,
    curso: number,
    division: string,
    turno: string,
    tx?: Tx,
  ): Promise<CursoDivisionTurno | null> {
    const result = await clientOf(tx).query(
      `SELECT * FROM curso_division_turno
       WHERE ciclo_lectivo_id = $1 AND curso = $2 AND division = $3 AND turno = $4`,
      [cicloId, curso, division, turno],
    );
    return result.rows[0] ? mapCurso(result.rows[0]) : null;
  }

  async list(
    filter: { cicloId?: string; courseIds?: number[]; limit: number; offset: number },
    tx?: Tx,
  ): Promise<CursoDivisionTurno[]> {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (filter.cicloId) {
      values.push(filter.cicloId);
      conditions.push(`ciclo_lectivo_id = $${values.length}`);
    }
    if (filter.courseIds) {
      values.push(filter.courseIds);
      conditions.push(`id = ANY($${values.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(filter.limit, filter.offset);
    const result = await clientOf(tx).query(
      `SELECT * FROM curso_division_turno ${where}
       ORDER BY curso, division, turno
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapCurso);
  }

  async save(curso: CursoDivisionTurno, tx?: Tx): Promise<CursoDivisionTurno> {
    const client = clientOf(tx);
    if (Number(curso.id) > 0) {
      const result = await client.query(
        `UPDATE curso_division_turno SET curso = $2, division = $3, turno = $4,
           capacidad_maxima = $5, version = version + 1
         WHERE id = $1 AND version = $6`,
        [
          curso.id,
          curso.curso,
          curso.division,
          curso.turno,
          curso.capacidadMaxima,
          curso.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
      return curso;
    }
    const result = await client.query(
      `INSERT INTO curso_division_turno
        (ciclo_lectivo_id, curso, division, turno, capacidad_maxima, version)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        curso.cicloLectivoId,
        curso.curso,
        curso.division,
        curso.turno,
        curso.capacidadMaxima,
        curso.version,
      ],
    );
    return CursoDivisionTurno.reconstitute({
      id: Number(result.rows[0]?.id) as CourseId,
      cicloLectivoId: curso.cicloLectivoId as CycleId,
      curso: curso.curso,
      division: curso.division,
      turno: curso.turno,
      capacidadMaxima: curso.capacidadMaxima,
      version: curso.version,
    });
  }

  async delete(id: number, tx?: Tx): Promise<void> {
    await clientOf(tx).query('DELETE FROM curso_division_turno WHERE id = $1', [id]);
  }

  async countStudents(courseId: number, tx?: Tx): Promise<number> {
    const result = await clientOf(tx).query(
      'SELECT count(*)::int AS count FROM alumnos WHERE curso_division_turno_id = $1',
      [courseId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}

export class PgMateriaRepository implements MateriaRepository {
  async findById(id: number, tx?: Tx): Promise<Materia | null> {
    const result = await clientOf(tx).query('SELECT * FROM materias WHERE id = $1', [id]);
    return result.rows[0] ? mapMateria(result.rows[0]) : null;
  }

  async findByTeacher(teacherId: string, tx?: Tx): Promise<Materia[]> {
    const result = await clientOf(tx).query(
      'SELECT * FROM materias WHERE docente_id = $1 ORDER BY nombre',
      [teacherId],
    );
    return result.rows.map(mapMateria);
  }

  async findByCourse(courseId: number, tx?: Tx): Promise<Materia[]> {
    const result = await clientOf(tx).query(
      'SELECT * FROM materias WHERE curso_division_turno_id = $1 ORDER BY nombre',
      [courseId],
    );
    return result.rows.map(mapMateria);
  }

  async list(
    filter: {
      courseId?: number;
      courseIds?: number[];
      teacherId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Materia[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.courseId !== undefined) {
      values.push(filter.courseId);
      conditions.push(`curso_division_turno_id = $${values.length}`);
    }
    if (filter.courseIds) {
      values.push(filter.courseIds);
      conditions.push(`curso_division_turno_id = ANY($${values.length})`);
    }
    if (filter.teacherId) {
      values.push(filter.teacherId);
      conditions.push(`docente_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT * FROM materias ${where} ORDER BY nombre
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapMateria);
  }

  async save(materia: Materia, tx?: Tx): Promise<Materia> {
    const client = clientOf(tx);
    if (Number(materia.id) > 0) {
      const result = await client.query(
        `UPDATE materias SET nombre = $2, descripcion = $3, curso_division_turno_id = $4,
           docente_id = $5, version = version + 1
         WHERE id = $1 AND version = $6`,
        [
          materia.id,
          materia.nombre,
          materia.descripcion,
          materia.cursoDivisionTurnoId,
          materia.docenteId,
          materia.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
      return materia;
    }
    const result = await client.query(
      `INSERT INTO materias (nombre, descripcion, curso_division_turno_id, docente_id, version)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        materia.nombre,
        materia.descripcion,
        materia.cursoDivisionTurnoId,
        materia.docenteId,
        materia.version,
      ],
    );
    return Materia.reconstitute({
      id: Number(result.rows[0]?.id) as SubjectId,
      nombre: materia.nombre,
      descripcion: materia.descripcion,
      cursoDivisionTurnoId: materia.cursoDivisionTurnoId,
      docenteId: materia.docenteId,
      version: materia.version,
    });
  }

  async delete(id: number, tx?: Tx): Promise<void> {
    await clientOf(tx).query('DELETE FROM materias WHERE id = $1', [id]);
  }

  async count(tx?: Tx): Promise<number> {
    const result = await clientOf(tx).query('SELECT count(*)::int AS count FROM materias');
    return Number(result.rows[0]?.count ?? 0);
  }
}

export class PgInscripcionRepository implements InscripcionRepository {
  async findById(id: number, tx?: Tx): Promise<Inscripcion | null> {
    const result = await clientOf(tx).query('SELECT * FROM inscripciones WHERE id = $1', [id]);
    return result.rows[0] ? mapInscripcion(result.rows[0]) : null;
  }

  async findActiveByAlumnoAndMateria(
    alumnoId: string,
    materiaId: number,
    tx?: Tx,
  ): Promise<Inscripcion | null> {
    const result = await clientOf(tx).query(
      `SELECT * FROM inscripciones
       WHERE alumno_id = $1 AND materia_id = $2 AND estado IN ('pendiente','aprobado')
       LIMIT 1`,
      [alumnoId, materiaId],
    );
    return result.rows[0] ? mapInscripcion(result.rows[0]) : null;
  }

  async findByAlumno(alumnoId: string, estado?: string, tx?: Tx): Promise<Inscripcion[]> {
    const values: unknown[] = [alumnoId];
    let filter = '';
    if (estado) {
      values.push(estado);
      filter = 'AND estado = $2';
    }
    const result = await clientOf(tx).query(
      `SELECT * FROM inscripciones WHERE alumno_id = $1 ${filter} ORDER BY fecha_inscripcion DESC`,
      values,
    );
    return result.rows.map(mapInscripcion);
  }

  async findByMateria(materiaId: number, estado?: string, tx?: Tx): Promise<Inscripcion[]> {
    const values: unknown[] = [materiaId];
    let filter = '';
    if (estado) {
      values.push(estado);
      filter = 'AND estado = $2';
    }
    const result = await clientOf(tx).query(
      `SELECT * FROM inscripciones WHERE materia_id = $1 ${filter} ORDER BY fecha_inscripcion`,
      values,
    );
    return result.rows.map(mapInscripcion);
  }

  async list(
    filter: {
      alumnoId?: string;
      alumnoIds?: string[];
      materiaId?: number;
      teacherId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Inscripcion[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let join = '';
    if (filter.teacherId) {
      values.push(filter.teacherId);
      join = `JOIN materias m ON m.id = i.materia_id AND m.docente_id = $${values.length}`;
    }
    if (filter.alumnoId) {
      values.push(filter.alumnoId);
      conditions.push(`i.alumno_id = $${values.length}`);
    }
    if (filter.alumnoIds) {
      values.push(filter.alumnoIds);
      conditions.push(`i.alumno_id = ANY($${values.length})`);
    }
    if (filter.materiaId !== undefined) {
      values.push(filter.materiaId);
      conditions.push(`i.materia_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT i.* FROM inscripciones i ${join} ${where}
       ORDER BY i.fecha_inscripcion DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapInscripcion);
  }

  async save(inscripcion: Inscripcion, tx?: Tx): Promise<Inscripcion> {
    const client = clientOf(tx);
    if (Number(inscripcion.id) > 0) {
      const result = await client.query(
        `UPDATE inscripciones SET alumno_id = $2, materia_id = $3, fecha_inscripcion = $4,
           estado = $5, version = version + 1
         WHERE id = $1 AND version = $6`,
        [
          inscripcion.id,
          inscripcion.alumnoId,
          inscripcion.materiaId,
          inscripcion.fechaInscripcion,
          inscripcion.estado,
          inscripcion.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
      return inscripcion;
    }
    const result = await client.query(
      `INSERT INTO inscripciones (alumno_id, materia_id, fecha_inscripcion, estado, version)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        inscripcion.alumnoId,
        inscripcion.materiaId,
        inscripcion.fechaInscripcion,
        inscripcion.estado,
        inscripcion.version,
      ],
    );
    return Inscripcion.reconstitute({
      id: Number(result.rows[0]?.id) as EnrollmentId,
      alumnoId: inscripcion.alumnoId,
      materiaId: inscripcion.materiaId,
      fechaInscripcion: inscripcion.fechaInscripcion,
      estado: inscripcion.estado,
      version: inscripcion.version,
    });
  }
}

export class PgClaseRepository implements ClaseRepository {
  async findById(id: string, tx?: Tx): Promise<Clase | null> {
    const result = await clientOf(tx).query('SELECT * FROM clases WHERE id = $1', [id]);
    return result.rows[0] ? mapClase(result.rows[0]) : null;
  }

  async findByMateriaAndRange(
    materiaId: number,
    from: string,
    to: string,
    tx?: Tx,
  ): Promise<Clase[]> {
    const result = await clientOf(tx).query(
      `SELECT * FROM clases WHERE materia_id = $1 AND fecha BETWEEN $2 AND $3
       ORDER BY fecha, hora_inicio`,
      [materiaId, from, to],
    );
    return result.rows.map(mapClase);
  }

  async list(
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
  ): Promise<Clase[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let join = '';
    if (filter.teacherId) {
      values.push(filter.teacherId);
      join = `JOIN materias m ON m.id = c.materia_id AND m.docente_id = $${values.length}`;
    }
    if (filter.courseId !== undefined) {
      if (!join) join = 'JOIN materias m ON m.id = c.materia_id';
      values.push(filter.courseId);
      conditions.push(`m.curso_division_turno_id = $${values.length}`);
    }
    if (filter.courseIds) {
      if (!join) join = 'JOIN materias m ON m.id = c.materia_id';
      values.push(filter.courseIds);
      conditions.push(`m.curso_division_turno_id = ANY($${values.length})`);
    }
    if (filter.materiaId !== undefined) {
      values.push(filter.materiaId);
      conditions.push(`c.materia_id = $${values.length}`);
    }
    if (filter.from) {
      values.push(filter.from);
      conditions.push(`c.fecha >= $${values.length}`);
    }
    if (filter.to) {
      values.push(filter.to);
      conditions.push(`c.fecha <= $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT c.* FROM clases c ${join} ${where} ORDER BY c.fecha, c.hora_inicio
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapClase);
  }

  async save(clase: Clase, tx?: Tx): Promise<Clase> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM clases WHERE id = $1', [clase.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE clases SET materia_id = $2, fecha = $3, hora_inicio = $4, hora_fin = $5,
           tema = $6, estado = $7, version = version + 1
         WHERE id = $1 AND version = $8`,
        [
          clase.id,
          clase.materiaId,
          clase.fecha,
          clase.horaInicio,
          clase.horaFin,
          clase.tema,
          clase.estado,
          clase.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
      return clase;
    }
    await client.query(
      `INSERT INTO clases (id, materia_id, fecha, hora_inicio, hora_fin, tema, estado, created_by, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        clase.id,
        clase.materiaId,
        clase.fecha,
        clase.horaInicio,
        clase.horaFin,
        clase.tema,
        clase.estado,
        clase.createdBy,
        clase.version,
      ],
    );
    return clase;
  }
}
