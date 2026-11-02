import type {
  CalificacionRepository,
  CondicionAlumnoRepository,
  InstanciaEvaluacionRepository,
  PeriodoCierreRepository,
  PeriodoRepository,
  ReglaCondicionRepository,
} from '../../../domain/grading/ports.js';
import {
  Calificacion,
  CondicionAlumno,
  InstanciaEvaluacion,
  Periodo,
  PeriodoCierre,
  ReglaCondicion,
} from '../../../domain/grading/entities.js';
import type { Tx } from '../../../domain/shared/types.js';
import { StaleVersionError } from '../../../domain/shared/errors.js';
import { clientOf } from '../client.js';
import {
  mapCalificacion,
  mapCierre,
  mapCondicion,
  mapInstancia,
  mapPeriodo,
  mapRegla,
} from '../mappers.js';

export class PgPeriodoRepository implements PeriodoRepository {
  async findById(id: string, tx?: Tx): Promise<Periodo | null> {
    const result = await clientOf(tx).query('SELECT * FROM periodos WHERE id = $1', [id]);
    return result.rows[0] ? mapPeriodo(result.rows[0]) : null;
  }

  async findForUpdate(id: string, tx: Tx): Promise<Periodo | null> {
    const result = await clientOf(tx).query('SELECT * FROM periodos WHERE id = $1 FOR UPDATE', [
      id,
    ]);
    return result.rows[0] ? mapPeriodo(result.rows[0]) : null;
  }

  async findOpenByCycle(cycleId: string, tx?: Tx): Promise<Periodo[]> {
    const result = await clientOf(tx).query(
      "SELECT * FROM periodos WHERE ciclo_lectivo_id = $1 AND estado = 'abierto' ORDER BY fecha_inicio",
      [cycleId],
    );
    return result.rows.map(mapPeriodo);
  }

  async list(
    filter: { cycleId?: string; status?: 'abierto' | 'cerrado'; limit: number; offset: number },
    tx?: Tx,
  ): Promise<Periodo[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.cycleId) {
      values.push(filter.cycleId);
      conditions.push(`ciclo_lectivo_id = $${values.length}`);
    }
    if (filter.status) {
      values.push(filter.status);
      conditions.push(`estado = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT * FROM periodos ${where} ORDER BY fecha_inicio
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapPeriodo);
  }

  async save(periodo: Periodo, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM periodos WHERE id = $1', [periodo.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE periodos SET ciclo_lectivo_id = $2, nombre = $3, tipo = $4, fecha_inicio = $5,
           fecha_fin = $6, estado = $7, version = version + 1
         WHERE id = $1 AND version = $8`,
        [
          periodo.id,
          periodo.cicloLectivoId,
          periodo.nombre,
          periodo.tipo,
          periodo.fechaInicio,
          periodo.fechaFin,
          periodo.estado,
          periodo.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO periodos
          (id, ciclo_lectivo_id, nombre, tipo, fecha_inicio, fecha_fin, estado, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          periodo.id,
          periodo.cicloLectivoId,
          periodo.nombre,
          periodo.tipo,
          periodo.fechaInicio,
          periodo.fechaFin,
          periodo.estado,
          periodo.version,
        ],
      );
    }
  }
}

export class PgInstanciaEvaluacionRepository implements InstanciaEvaluacionRepository {
  async findById(id: string, tx?: Tx): Promise<InstanciaEvaluacion | null> {
    const result = await clientOf(tx).query('SELECT * FROM instancias_evaluacion WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ? mapInstancia(result.rows[0]) : null;
  }

  async findByMateriaAndPeriodo(
    materiaId: number,
    periodId: string,
    tx?: Tx,
  ): Promise<InstanciaEvaluacion[]> {
    const result = await clientOf(tx).query(
      `SELECT * FROM instancias_evaluacion WHERE materia_id = $1 AND periodo_id = $2
       ORDER BY fecha, created_at`,
      [materiaId, periodId],
    );
    return result.rows.map(mapInstancia);
  }

  async list(
    filter: {
      materiaId?: number;
      materiaIds?: number[];
      periodId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<InstanciaEvaluacion[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.materiaId !== undefined) {
      values.push(filter.materiaId);
      conditions.push(`materia_id = $${values.length}`);
    }
    if (filter.materiaIds) {
      values.push(filter.materiaIds);
      conditions.push(`materia_id = ANY($${values.length})`);
    }
    if (filter.periodId) {
      values.push(filter.periodId);
      conditions.push(`periodo_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT * FROM instancias_evaluacion ${where} ORDER BY fecha, created_at
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapInstancia);
  }

  async save(instancia: InstanciaEvaluacion, tx?: Tx): Promise<InstanciaEvaluacion> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM instancias_evaluacion WHERE id = $1', [
      instancia.id,
    ]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE instancias_evaluacion SET materia_id = $2, periodo_id = $3, nombre = $4,
           tipo = $5, peso = $6, fecha = $7, version = version + 1
         WHERE id = $1 AND version = $8`,
        [
          instancia.id,
          instancia.materiaId,
          instancia.periodoId,
          instancia.nombre,
          instancia.tipo,
          instancia.peso,
          instancia.fecha,
          instancia.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
      return instancia;
    }
    await client.query(
      `INSERT INTO instancias_evaluacion
        (id, materia_id, periodo_id, nombre, tipo, peso, fecha, created_by, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        instancia.id,
        instancia.materiaId,
        instancia.periodoId,
        instancia.nombre,
        instancia.tipo,
        instancia.peso,
        instancia.fecha,
        instancia.createdBy,
        instancia.version,
      ],
    );
    return InstanciaEvaluacion.reconstitute({
      id: instancia.id,
      materiaId: instancia.materiaId,
      periodoId: instancia.periodoId,
      nombre: instancia.nombre,
      tipo: instancia.tipo,
      peso: instancia.peso,
      fecha: instancia.fecha,
      createdBy: instancia.createdBy,
      version: instancia.version,
    });
  }
}

export class PgCalificacionRepository implements CalificacionRepository {
  async findById(id: string, tx?: Tx): Promise<Calificacion | null> {
    const result = await clientOf(tx).query('SELECT * FROM calificaciones WHERE id = $1', [id]);
    return result.rows[0] ? mapCalificacion(result.rows[0]) : null;
  }

  async findForUpdate(id: string, tx: Tx): Promise<Calificacion | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM calificaciones WHERE id = $1 FOR UPDATE',
      [id],
    );
    return result.rows[0] ? mapCalificacion(result.rows[0]) : null;
  }

  async findByInstanciaAndAlumno(
    instanciaId: string,
    alumnoId: string,
    tx?: Tx,
  ): Promise<Calificacion | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM calificaciones WHERE instancia_id = $1 AND alumno_id = $2',
      [instanciaId, alumnoId],
    );
    return result.rows[0] ? mapCalificacion(result.rows[0]) : null;
  }

  async findByAlumnoAndPeriodo(
    alumnoId: string,
    periodId: string,
    tx?: Tx,
  ): Promise<Calificacion[]> {
    const result = await clientOf(tx).query(
      `SELECT c.* FROM calificaciones c
         JOIN instancias_evaluacion i ON i.id = c.instancia_id
       WHERE c.alumno_id = $1 AND i.periodo_id = $2
       ORDER BY i.fecha`,
      [alumnoId, periodId],
    );
    return result.rows.map(mapCalificacion);
  }

  async findByPeriodo(periodId: string, tx?: Tx): Promise<Calificacion[]> {
    const result = await clientOf(tx).query(
      `SELECT c.* FROM calificaciones c
         JOIN instancias_evaluacion i ON i.id = c.instancia_id
       WHERE i.periodo_id = $1
       ORDER BY c.alumno_id, i.fecha`,
      [periodId],
    );
    return result.rows.map(mapCalificacion);
  }

  async list(
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
  ): Promise<Calificacion[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let join = '';
    const needsInstancias =
      filter.periodId !== undefined ||
      filter.materiaId !== undefined ||
      filter.materiaIds !== undefined ||
      filter.courseIds !== undefined ||
      filter.teacherId !== undefined;
    if (needsInstancias) {
      join = 'JOIN instancias_evaluacion i ON i.id = c.instancia_id';
    }
    if (filter.teacherId || filter.courseIds) {
      join += ' JOIN materias m ON m.id = i.materia_id';
    }
    if (filter.instanciaId) {
      values.push(filter.instanciaId);
      conditions.push(`c.instancia_id = $${values.length}`);
    }
    if (filter.alumnoId) {
      values.push(filter.alumnoId);
      conditions.push(`c.alumno_id = $${values.length}`);
    }
    if (filter.alumnoIds) {
      values.push(filter.alumnoIds);
      conditions.push(`c.alumno_id = ANY($${values.length})`);
    }
    if (filter.periodId) {
      values.push(filter.periodId);
      conditions.push(`i.periodo_id = $${values.length}`);
    }
    if (filter.materiaId !== undefined) {
      values.push(filter.materiaId);
      conditions.push(`i.materia_id = $${values.length}`);
    }
    if (filter.materiaIds) {
      values.push(filter.materiaIds);
      conditions.push(`i.materia_id = ANY($${values.length})`);
    }
    if (filter.courseIds) {
      values.push(filter.courseIds);
      conditions.push(`m.curso_division_turno_id = ANY($${values.length})`);
    }
    if (filter.teacherId) {
      values.push(filter.teacherId);
      conditions.push(`m.docente_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT c.* FROM calificaciones c ${join} ${where}
       ORDER BY c.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapCalificacion);
  }

  async save(calificacion: Calificacion, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM calificaciones WHERE id = $1', [
      calificacion.id,
    ]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE calificaciones SET instancia_id = $2, alumno_id = $3, valor = $4, estado = $5,
           updated_by = $6, rectificada_por = $7, rectificada_en = $8,
           motivo_rectificacion = $9, updated_at = now(), version = version + 1
         WHERE id = $1 AND version = $10`,
        [
          calificacion.id,
          calificacion.instanciaId,
          calificacion.alumnoId,
          calificacion.valor,
          calificacion.estado,
          calificacion.updatedBy,
          calificacion.rectificadaPor,
          calificacion.rectificadaEn,
          calificacion.motivoRectificacion,
          calificacion.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO calificaciones
          (id, instancia_id, alumno_id, valor, estado, created_by, updated_by,
           rectificada_por, rectificada_en, motivo_rectificacion, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          calificacion.id,
          calificacion.instanciaId,
          calificacion.alumnoId,
          calificacion.valor,
          calificacion.estado,
          calificacion.createdBy,
          calificacion.updatedBy,
          calificacion.rectificadaPor,
          calificacion.rectificadaEn,
          calificacion.motivoRectificacion,
          calificacion.version,
        ],
      );
    }
  }
}

export class PgReglaCondicionRepository implements ReglaCondicionRepository {
  async findForPeriodoAndMateria(
    periodId: string,
    materiaId: number | null,
    tx?: Tx,
  ): Promise<ReglaCondicion | null> {
    const result = await clientOf(tx).query(
      `SELECT * FROM reglas_condicion
       WHERE periodo_id = $1 AND ((materia_id = $2) OR ($2::int IS NULL AND materia_id IS NULL))
       ORDER BY activa DESC, created_at DESC LIMIT 1`,
      [periodId, materiaId],
    );
    return result.rows[0] ? mapRegla(result.rows[0]) : null;
  }

  async listByPeriodo(periodId: string, tx?: Tx): Promise<ReglaCondicion[]> {
    const result = await clientOf(tx).query(
      'SELECT * FROM reglas_condicion WHERE periodo_id = $1 ORDER BY created_at',
      [periodId],
    );
    return result.rows.map(mapRegla);
  }

  async save(regla: ReglaCondicion, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM reglas_condicion WHERE id = $1', [regla.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE reglas_condicion SET periodo_id = $2, materia_id = $3, nombre = $4,
           config = $5, activa = $6, version = version + 1
         WHERE id = $1 AND version = $7`,
        [
          regla.id,
          regla.periodoId,
          regla.materiaId,
          regla.nombre,
          JSON.stringify(regla.config),
          regla.activa,
          regla.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO reglas_condicion (id, periodo_id, materia_id, nombre, config, activa, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          regla.id,
          regla.periodoId,
          regla.materiaId,
          regla.nombre,
          JSON.stringify(regla.config),
          regla.activa,
          regla.version,
        ],
      );
    }
  }
}

export class PgCondicionAlumnoRepository implements CondicionAlumnoRepository {
  async findByPeriodo(
    periodId: string,
    filter: {
      materiaId?: number;
      materiaIds?: number[];
      alumnoId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<CondicionAlumno[]> {
    const conditions: string[] = ['periodo_id = $1'];
    const values: unknown[] = [periodId];
    if (filter.materiaId !== undefined) {
      values.push(filter.materiaId);
      conditions.push(`materia_id = $${values.length}`);
    }
    if (filter.materiaIds) {
      values.push(filter.materiaIds);
      conditions.push(`materia_id = ANY($${values.length})`);
    }
    if (filter.alumnoId) {
      values.push(filter.alumnoId);
      conditions.push(`alumno_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const result = await clientOf(tx).query(
      `SELECT * FROM condiciones_alumno WHERE ${conditions.join(' AND ')}
       ORDER BY alumno_id, materia_id
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapCondicion);
  }

  async findByAlumnoAndPeriodo(
    alumnoId: string,
    periodId: string,
    tx?: Tx,
  ): Promise<CondicionAlumno[]> {
    const result = await clientOf(tx).query(
      'SELECT * FROM condiciones_alumno WHERE alumno_id = $1 AND periodo_id = $2 ORDER BY materia_id',
      [alumnoId, periodId],
    );
    return result.rows.map(mapCondicion);
  }

  async replaceForPeriod(
    periodId: string,
    conditions: CondicionAlumno[],
    tx: Tx,
  ): Promise<void> {
    const client = clientOf(tx);
    await client.query('DELETE FROM condiciones_alumno WHERE periodo_id = $1', [periodId]);
    for (const condition of conditions) {
      const props = condition.toProps();
      await client.query(
        `INSERT INTO condiciones_alumno
          (id, periodo_id, alumno_id, materia_id, condicion, promedio, porcentaje_asistencia,
           detalle, calculada_en, cierre_id, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          props.id,
          props.periodoId,
          props.alumnoId,
          props.materiaId,
          props.condicion,
          props.promedio,
          props.porcentajeAsistencia,
          JSON.stringify(props.detalle),
          props.calculadaEn,
          props.cierreId,
          props.version,
        ],
      );
    }
  }

  async updateOne(condition: CondicionAlumno, tx: Tx): Promise<void> {
    const props = condition.toProps();
    const result = await clientOf(tx).query(
      `UPDATE condiciones_alumno SET condicion = $2, promedio = $3, porcentaje_asistencia = $4,
         detalle = $5, calculada_en = $6, cierre_id = $7, version = version + 1
       WHERE id = $1 AND version = $8`,
      [
        props.id,
        props.condicion,
        props.promedio,
        props.porcentajeAsistencia,
        JSON.stringify(props.detalle),
        props.calculadaEn,
        props.cierreId,
        props.version,
      ],
    );
    if (!result.rowCount) throw new StaleVersionError();
  }
}

export class PgPeriodoCierreRepository implements PeriodoCierreRepository {
  async findByPeriodo(periodId: string, tx?: Tx): Promise<PeriodoCierre | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM periodo_cierres WHERE periodo_id = $1 ORDER BY ejecutado_en DESC LIMIT 1',
      [periodId],
    );
    return result.rows[0] ? mapCierre(result.rows[0]) : null;
  }

  async create(cierre: PeriodoCierre, tx: Tx): Promise<void> {
    await clientOf(tx).query(
      `INSERT INTO periodo_cierres
        (id, periodo_id, ejecutado_por, ejecutado_en, total_alumnos, total_condiciones, resumen)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        cierre.id,
        cierre.periodoId,
        cierre.ejecutadoPor,
        cierre.ejecutadoEn,
        cierre.totalAlumnos,
        cierre.totalCondiciones,
        JSON.stringify(cierre.resumen),
      ],
    );
  }
}
