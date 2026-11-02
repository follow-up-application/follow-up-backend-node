import type {
  AlumnoRepository,
  DocenteRepository,
  PreceptorRepository,
  RefreshToken,
  RefreshTokenRepository,
  TutorAlumnoRepository,
  TutorRepository,
  UserRepository,
} from '../../../domain/identity/ports.js';
import type { UserRole } from '../../../domain/shared/types.js';
import type { Tx } from '../../../domain/shared/types.js';
import { StaleVersionError } from '../../../domain/shared/errors.js';
import type {
  Alumno,
  Docente,
  Preceptor,
  Tutor,
  TutorAlumno,
  User,
} from '../../../domain/identity/entities.js';
import { clientOf } from '../client.js';
import {
  mapAlumno,
  mapDocente,
  mapPreceptor,
  mapTutor,
  mapTutorAlumno,
  mapUser,
  type Row,
} from '../mappers.js';

const USER_COLUMNS = `
  u.id, u.first_name, u.last_name, u.dni, u.username, u.email, u.password_hash,
  u.role, u.must_change_password, u.is_active, u.last_login_at,
  u.version, u.created_at, u.updated_at
`;

export class PgUserRepository implements UserRepository {
  async findById(id: string, tx?: Tx): Promise<User | null> {
    const result = await clientOf(tx).query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByUsername(username: string, tx?: Tx): Promise<User | null> {
    const result = await clientOf(tx).query('SELECT * FROM users WHERE lower(username) = lower($1)', [
      username,
    ]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByEmail(email: string, tx?: Tx): Promise<User | null> {
    const result = await clientOf(tx).query('SELECT * FROM users WHERE lower(email) = lower($1)', [
      email,
    ]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByDni(dni: number, tx?: Tx): Promise<User | null> {
    const result = await clientOf(tx).query('SELECT * FROM users WHERE dni = $1', [dni]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findByDnis(dnis: number[], tx?: Tx): Promise<User[]> {
    if (dnis.length === 0) return [];
    const result = await clientOf(tx).query('SELECT * FROM users WHERE dni = ANY($1::int[])', [
      dnis,
    ]);
    return result.rows.map(mapUser);
  }

  async save(user: User, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const props = user.toProps();
    const exists = await client.query('SELECT 1 FROM users WHERE id = $1', [props.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE users SET
           first_name = $2, last_name = $3, dni = $4, username = $5, email = $6,
           password_hash = $7, role = $8, must_change_password = $9, is_active = $10,
           last_login_at = $11, version = version + 1
         WHERE id = $1 AND version = $12`,
        [
          props.id,
          props.firstName,
          props.lastName,
          props.dni,
          props.username,
          props.email,
          props.passwordHash,
          props.role,
          props.mustChangePassword,
          props.isActive,
          props.lastLoginAt,
          props.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO users
           (id, first_name, last_name, dni, username, email, password_hash, role,
            must_change_password, is_active, last_login_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          props.id,
          props.firstName,
          props.lastName,
          props.dni,
          props.username,
          props.email,
          props.passwordHash,
          props.role,
          props.mustChangePassword,
          props.isActive,
          props.lastLoginAt,
          props.version,
        ],
      );
    }
  }

  async setActive(id: string, active: boolean, tx?: Tx): Promise<void> {
    await clientOf(tx).query(
      'UPDATE users SET is_active = $2, version = version + 1 WHERE id = $1',
      [id, active],
    );
  }

  async countActiveAdmins(tx?: Tx): Promise<number> {
    const result = await clientOf(tx).query(
      "SELECT count(*)::int AS count FROM users WHERE role = 'administrador' AND is_active",
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async countByRole(role: UserRole, tx?: Tx): Promise<number> {
    const result = await clientOf(tx).query(
      'SELECT count(*)::int AS count FROM users WHERE role = $1 AND is_active',
      [role],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async list(
    filter: { role?: UserRole; active?: boolean; limit: number; offset: number },
    tx?: Tx,
  ): Promise<User[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.role) {
      values.push(filter.role);
      conditions.push(`role = $${values.length}`);
    }
    if (filter.active !== undefined) {
      values.push(filter.active);
      conditions.push(`is_active = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapUser);
  }
}

const ALUMNO_SELECT = `
  SELECT ${USER_COLUMNS},
         a.fecha_nacimiento AS alumno_fecha_nacimiento,
         a.curso_division_turno_id AS alumno_curso_division_turno_id,
         a.version AS alumno_version
    FROM alumnos a JOIN users u ON u.id = a.id
`;

export class PgAlumnoRepository implements AlumnoRepository {
  async findById(id: string, tx?: Tx): Promise<Alumno | null> {
    const result = await clientOf(tx).query(`${ALUMNO_SELECT} WHERE a.id = $1`, [id]);
    return result.rows[0] ? mapAlumno(result.rows[0]) : null;
  }

  async list(
    filter: {
      courseId?: number;
      teacherId?: string;
      tutorId?: string;
      preceptorId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Alumno[]> {
    const joins: string[] = [];
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.teacherId) {
      values.push(filter.teacherId);
      joins.push(
        `JOIN materias m_teacher ON m_teacher.curso_division_turno_id = a.curso_division_turno_id AND m_teacher.docente_id = $${values.length}`,
      );
    }
    if (filter.tutorId) {
      values.push(filter.tutorId);
      joins.push(
        `JOIN tutor_alumno ta ON ta.alumno_id = a.id AND ta.tutor_id = $${values.length} AND ta.activa`,
      );
    }
    if (filter.preceptorId) {
      values.push(filter.preceptorId);
      joins.push(
        `JOIN preceptor_curso pc ON pc.curso_division_turno_id = a.curso_division_turno_id AND pc.preceptor_id = $${values.length} AND pc.activo`,
      );
    }
    if (filter.courseId !== undefined) {
      values.push(filter.courseId);
      conditions.push(`a.curso_division_turno_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await clientOf(tx).query(
      `${ALUMNO_SELECT} ${joins.join(' ')} ${where}
       ORDER BY u.last_name, u.first_name
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapAlumno);
  }

  async save(alumno: Alumno, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM alumnos WHERE id = $1', [alumno.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE alumnos SET fecha_nacimiento = $2, curso_division_turno_id = $3, version = version + 1
         WHERE id = $1 AND version = $4`,
        [alumno.id, alumno.fechaNacimiento, alumno.cursoDivisionTurnoId, alumno.version],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO alumnos (id, fecha_nacimiento, curso_division_turno_id, version)
         VALUES ($1,$2,$3,$4)`,
        [alumno.id, alumno.fechaNacimiento, alumno.cursoDivisionTurnoId, alumno.version],
      );
    }
  }

  async countByCourse(courseId: number, tx?: Tx): Promise<number> {
    const result = await clientOf(tx).query(
      'SELECT count(*)::int AS count FROM alumnos WHERE curso_division_turno_id = $1',
      [courseId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}

const DOCENTE_SELECT = `
  SELECT ${USER_COLUMNS},
         d.telephone AS docente_telephone,
         d.fecha_ingreso AS docente_fecha_ingreso,
         d.curso_division_turno_id AS docente_curso_division_turno_id,
         d.version AS docente_version
    FROM docentes d JOIN users u ON u.id = d.id
`;

export class PgDocenteRepository implements DocenteRepository {
  async findById(id: string, tx?: Tx): Promise<Docente | null> {
    const result = await clientOf(tx).query(`${DOCENTE_SELECT} WHERE d.id = $1`, [id]);
    return result.rows[0] ? mapDocente(result.rows[0]) : null;
  }

  async list(
    filter: { courseId?: number; limit: number; offset: number },
    tx?: Tx,
  ): Promise<Docente[]> {
    const values: unknown[] = [];
    let where = '';
    if (filter.courseId !== undefined) {
      values.push(filter.courseId);
      where = `WHERE d.curso_division_turno_id = $${values.length}`;
    }
    values.push(filter.limit, filter.offset);
    const result = await clientOf(tx).query(
      `${DOCENTE_SELECT} ${where} ORDER BY u.last_name, u.first_name
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapDocente);
  }

  async save(docente: Docente, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM docentes WHERE id = $1', [docente.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE docentes SET telephone = $2, fecha_ingreso = $3, curso_division_turno_id = $4,
           version = version + 1 WHERE id = $1 AND version = $5`,
        [
          docente.id,
          docente.telephone,
          docente.fechaIngreso,
          docente.cursoDivisionTurnoId,
          docente.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO docentes (id, telephone, fecha_ingreso, curso_division_turno_id, version)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          docente.id,
          docente.telephone,
          docente.fechaIngreso,
          docente.cursoDivisionTurnoId,
          docente.version,
        ],
      );
    }
  }
}

const TUTOR_SELECT = `
  SELECT ${USER_COLUMNS},
         t.telephone AS tutor_telephone,
         t.version AS tutor_version
    FROM tutores t JOIN users u ON u.id = t.id
`;

export class PgTutorRepository implements TutorRepository {
  async findById(id: string, tx?: Tx): Promise<Tutor | null> {
    const result = await clientOf(tx).query(`${TUTOR_SELECT} WHERE t.id = $1`, [id]);
    return result.rows[0] ? mapTutor(result.rows[0]) : null;
  }

  async findByDni(dni: number, tx?: Tx): Promise<Tutor | null> {
    const result = await clientOf(tx).query(`${TUTOR_SELECT} WHERE u.dni = $1`, [dni]);
    return result.rows[0] ? mapTutor(result.rows[0]) : null;
  }

  async findByDnis(dnis: number[], tx?: Tx): Promise<Tutor[]> {
    if (dnis.length === 0) return [];
    const result = await clientOf(tx).query(`${TUTOR_SELECT} WHERE u.dni = ANY($1::int[])`, [dnis]);
    return result.rows.map(mapTutor);
  }

  async list(filter: { limit: number; offset: number }, tx?: Tx): Promise<Tutor[]> {
    const result = await clientOf(tx).query(
      `${TUTOR_SELECT} ORDER BY u.last_name, u.first_name LIMIT $1 OFFSET $2`,
      [filter.limit, filter.offset],
    );
    return result.rows.map(mapTutor);
  }

  async save(tutor: Tutor, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM tutores WHERE id = $1', [tutor.id]);
    if (exists.rowCount) {
      const result = await client.query(
        'UPDATE tutores SET telephone = $2, version = version + 1 WHERE id = $1 AND version = $3',
        [tutor.id, tutor.telephone, tutor.version],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        'INSERT INTO tutores (id, telephone, version) VALUES ($1,$2,$3)',
        [tutor.id, tutor.telephone, tutor.version],
      );
    }
  }
}

const PRECEPTOR_SELECT = `
  SELECT ${USER_COLUMNS},
         p.telephone AS preceptor_telephone,
         p.employee_code AS preceptor_employee_code,
         p.version AS preceptor_version
    FROM preceptores p JOIN users u ON u.id = p.id
`;

async function courseIdsForPreceptors(
  ids: string[],
  tx?: Tx,
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (ids.length === 0) return map;
  const result = await clientOf(tx).query(
    `SELECT preceptor_id, curso_division_turno_id FROM preceptor_curso
     WHERE activo AND preceptor_id = ANY($1::uuid[])`,
    [ids],
  );
  for (const row of result.rows as Row[]) {
    const list = map.get(row.preceptor_id) ?? [];
    list.push(Number(row.curso_division_turno_id));
    map.set(row.preceptor_id, list);
  }
  return map;
}

export class PgPreceptorRepository implements PreceptorRepository {
  async findById(id: string, tx?: Tx): Promise<Preceptor | null> {
    const result = await clientOf(tx).query(`${PRECEPTOR_SELECT} WHERE p.id = $1`, [id]);
    if (!result.rows[0]) return null;
    const courses = await courseIdsForPreceptors([id], tx);
    return mapPreceptor(result.rows[0], courses.get(id) ?? []);
  }

  async list(
    filter: { courseId?: number; limit: number; offset: number },
    tx?: Tx,
  ): Promise<Preceptor[]> {
    const values: unknown[] = [];
    let join = '';
    const where = '';
    if (filter.courseId !== undefined) {
      values.push(filter.courseId);
      join = `JOIN preceptor_curso pc ON pc.preceptor_id = p.id AND pc.activo AND pc.curso_division_turno_id = $${values.length}`;
    }
    values.push(filter.limit, filter.offset);
    const result = await clientOf(tx).query(
      `${PRECEPTOR_SELECT} ${join} ${where} ORDER BY u.last_name, u.first_name
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const ids = result.rows.map((row) => row.id as string);
    const courses = await courseIdsForPreceptors(ids, tx);
    return result.rows.map((row) => mapPreceptor(row, courses.get(row.id) ?? []));
  }

  async save(preceptor: Preceptor, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM preceptores WHERE id = $1', [preceptor.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE preceptores SET telephone = $2, employee_code = $3, version = version + 1
         WHERE id = $1 AND version = $4`,
        [preceptor.id, preceptor.telephone, preceptor.employeeCode, preceptor.version],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO preceptores (id, telephone, employee_code, version) VALUES ($1,$2,$3,$4)`,
        [preceptor.id, preceptor.telephone, preceptor.employeeCode, preceptor.version],
      );
    }
  }

  async replaceCourses(preceptorId: string, courseIds: number[], tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    await client.query(
      'UPDATE preceptor_curso SET activo = false WHERE preceptor_id = $1 AND activo = true',
      [preceptorId],
    );
    for (const courseId of courseIds) {
      const existing = await client.query(
        `SELECT id FROM preceptor_curso WHERE preceptor_id = $1 AND curso_division_turno_id = $2
         ORDER BY activo DESC LIMIT 1`,
        [preceptorId, courseId],
      );
      if (existing.rowCount) {
        await client.query(
          'UPDATE preceptor_curso SET activo = true WHERE id = $1',
          [existing.rows[0]?.id],
        );
      } else {
        await client.query(
          `INSERT INTO preceptor_curso (preceptor_id, curso_division_turno_id, activo)
           VALUES ($1,$2,true)`,
          [preceptorId, courseId],
        );
      }
    }
  }
}

export class PgTutorAlumnoRepository implements TutorAlumnoRepository {
  async findById(id: string, tx?: Tx): Promise<TutorAlumno | null> {
    const result = await clientOf(tx).query('SELECT * FROM tutor_alumno WHERE id = $1', [id]);
    return result.rows[0] ? mapTutorAlumno(result.rows[0]) : null;
  }

  async findByCode(code: string, tx?: Tx): Promise<TutorAlumno | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM tutor_alumno WHERE codigo_institucional = $1',
      [code],
    );
    return result.rows[0] ? mapTutorAlumno(result.rows[0]) : null;
  }

  async findByAlumno(alumnoId: string, onlyActive = true, tx?: Tx): Promise<TutorAlumno[]> {
    const result = await clientOf(tx).query(
      `SELECT * FROM tutor_alumno WHERE alumno_id = $1 ${onlyActive ? 'AND activa' : ''}
       ORDER BY created_at`,
      [alumnoId],
    );
    return result.rows.map(mapTutorAlumno);
  }

  async findByAlumnos(
    alumnoIds: string[],
    onlyActive = true,
    tx?: Tx,
  ): Promise<TutorAlumno[]> {
    if (alumnoIds.length === 0) return [];
    const result = await clientOf(tx).query(
      `SELECT * FROM tutor_alumno WHERE alumno_id = ANY($1::uuid[])
       ${onlyActive ? 'AND activa' : ''} ORDER BY created_at`,
      [alumnoIds],
    );
    return result.rows.map(mapTutorAlumno);
  }

  async findByTutor(tutorId: string, onlyActive = true, tx?: Tx): Promise<TutorAlumno[]> {
    const result = await clientOf(tx).query(
      `SELECT * FROM tutor_alumno WHERE tutor_id = $1 ${onlyActive ? 'AND activa' : ''}
       ORDER BY created_at`,
      [tutorId],
    );
    return result.rows.map(mapTutorAlumno);
  }

  async findLink(alumnoId: string, tutorId: string, tx?: Tx): Promise<TutorAlumno | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM tutor_alumno WHERE alumno_id = $1 AND tutor_id = $2',
      [alumnoId, tutorId],
    );
    return result.rows[0] ? mapTutorAlumno(result.rows[0]) : null;
  }

  async save(link: TutorAlumno, tx?: Tx): Promise<void> {
    const client = clientOf(tx);
    const exists = await client.query('SELECT 1 FROM tutor_alumno WHERE id = $1', [link.id]);
    if (exists.rowCount) {
      const result = await client.query(
        `UPDATE tutor_alumno SET relationship = $2, otra_relacion = $3,
           estado_registro = $4, activa = $5, registered_at = $6, version = version + 1
         WHERE id = $1 AND version = $7`,
        [
          link.id,
          link.relationship,
          link.otraRelacion,
          link.estadoRegistro,
          link.activa,
          link.registeredAt,
          link.version,
        ],
      );
      if (!result.rowCount) throw new StaleVersionError();
    } else {
      await client.query(
        `INSERT INTO tutor_alumno
          (id, alumno_id, tutor_id, relationship, otra_relacion, codigo_institucional,
           estado_registro, activa, codigo_expira_en, registered_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          link.id,
          link.alumnoId,
          link.tutorId,
          link.relationship,
          link.otraRelacion,
          link.codigoInstitucional,
          link.estadoRegistro,
          link.activa,
          link.codigoExpiraEn,
          link.registeredAt,
          link.version,
        ],
      );
    }
  }
}

export class PgRefreshTokenRepository implements RefreshTokenRepository {
  async create(token: RefreshToken, tx?: Tx): Promise<void> {
    await clientOf(tx).query(
      `INSERT INTO auth_refresh_tokens
        (id, user_id, family_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        token.id,
        token.userId,
        token.familyId,
        token.tokenHash,
        token.expiresAt,
        token.userAgent,
        token.ip,
      ],
    );
  }

  async findByHash(hash: string, tx?: Tx): Promise<RefreshToken | null> {
    const result = await clientOf(tx).query(
      'SELECT * FROM auth_refresh_tokens WHERE token_hash = $1',
      [hash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      familyId: row.family_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      replacedById: row.replaced_by_id,
      userAgent: row.user_agent,
      ip: row.ip,
      createdAt: row.created_at,
    };
  }

  async revoke(id: string, replacedBy: string | null, at: string, tx?: Tx): Promise<void> {
    await clientOf(tx).query(
      'UPDATE auth_refresh_tokens SET revoked_at = $2, replaced_by_id = $3 WHERE id = $1 AND revoked_at IS NULL',
      [id, at, replacedBy],
    );
  }

  async revokeFamily(familyId: string, at: string, tx?: Tx): Promise<void> {
    await clientOf(tx).query(
      'UPDATE auth_refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId, at],
    );
  }

  async revokeAllForUser(userId: string, at: string, tx?: Tx): Promise<void> {
    await clientOf(tx).query(
      'UPDATE auth_refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [userId, at],
    );
  }
}
