import { randomBytes } from 'node:crypto';
import type { AppContainer } from './container.js';
import type { Actor, UserId } from '../domain/shared/types.js';
import {
  CapacityExceededError,
  ConflictError,
  DuplicateResourceError,
  ForbiddenError,
  InvalidCodeError,
  NotFoundError,
  UnauthenticatedError,
  ValidationDomainError,
} from '../domain/shared/errors.js';
import {
  assertNotFuture,
  assertVersion,
  normalizeEmail,
  parseLegacyDate,
  validateDni,
  validatePassword,
  validateUsername,
} from '../domain/shared/value-objects.js';
import { User, Alumno, Docente, Tutor, Preceptor, TutorAlumno } from '../domain/identity/entities.js';
import type { Tx } from '../domain/shared/types.js';
import { isAdmin, requireRole, writeAudit, type RequestContext } from './shared/context.js';
import type { Relationship } from '../domain/identity/entities.js';

function currentYear(): number {
  return new Date().getUTCFullYear();
}

function generateCode(): string {
  return randomBytes(8).toString('hex').toUpperCase();
}

function expiryFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export class IdentityService {
  constructor(private readonly c: AppContainer) {}

  private async createUser(
    tx: Tx,
    input: {
      firstName: string;
      lastName: string;
      dni: number | null;
      username: string | null;
      email: string | null;
      passwordHash: string | null;
      role: User['role'];
      mustChangePassword: boolean;
      isActive?: boolean;
    },
  ): Promise<User> {
    const now = this.c.clock.now();
    const user = User.reconstitute({
      id: this.c.ids.uuid() as UserId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      dni: input.dni,
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      mustChangePassword: input.mustChangePassword,
      isActive: input.isActive ?? true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    await this.c.users.save(user, tx);
    return user;
  }

  private async assertUsernameAvailable(username: string, exceptId?: string): Promise<void> {
    const existing = await this.c.users.findByUsername(username);
    if (existing && existing.id !== exceptId) {
      throw new DuplicateResourceError('El username ya está en uso.');
    }
  }

  private async assertEmailAvailable(email: string, exceptId?: string): Promise<void> {
    const existing = await this.c.users.findByEmail(email);
    if (existing && existing.id !== exceptId) {
      throw new DuplicateResourceError('El email ya está en uso.');
    }
  }

  private async assertDniAvailable(dni: number, exceptId?: string): Promise<void> {
    const existing = await this.c.users.findByDni(dni);
    if (existing && existing.id !== exceptId) {
      throw new DuplicateResourceError('El DNI ya está en uso.');
    }
  }

  async createAdmin(
    input: { first_name: string; last_name: string; username: string; password: string },
    ctx: RequestContext,
  ): Promise<User> {
    requireRole(ctx.actor, 'administrador');
    validatePassword(input.password);
    validateUsername(input.username);
    await this.assertUsernameAvailable(input.username);
    const hash = await this.c.hasher.hash(input.password);
    let created: User | null = null;
    await this.c.uow.transaction(async (tx) => {
      created = await this.createUser(tx, {
        firstName: input.first_name,
        lastName: input.last_name,
        dni: null,
        username: input.username,
        email: null,
        passwordHash: hash,
        role: 'administrador',
        mustChangePassword: true,
      });
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: created.id,
        accion: 'crear',
        actor: ctx.actor,
        despues: { role: 'administrador', username: created.username },
        requestId: ctx.requestId,
      });
    });
    return created as unknown as User;
  }

  async listAdmins(limit: number, offset: number): Promise<User[]> {
    return this.c.users.list({ role: 'administrador', limit, offset });
  }

  async getAdmin(id: string): Promise<User> {
    const user = await this.c.users.findById(id);
    if (!user || user.role !== 'administrador') throw new NotFoundError('Administrador');
    return user;
  }

  async updateAdmin(
    id: string,
    input: { first_name?: string; last_name?: string; username?: string },
    ctx: RequestContext,
  ): Promise<User> {
    requireRole(ctx.actor, 'administrador');
    const user = await this.getAdmin(id);
    if (input.username !== undefined) {
      validateUsername(input.username);
      await this.assertUsernameAvailable(input.username, id);
      user.changeUsername(input.username);
    }
    if (input.first_name !== undefined || input.last_name !== undefined) {
      user.rename(input.first_name ?? user.firstName, input.last_name ?? user.lastName);
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.save(user, tx);
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: id,
        accion: 'actualizar',
        actor: ctx.actor,
        despues: { first_name: user.firstName, last_name: user.lastName, username: user.username },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.users.findById(id)) as User;
  }

  async deactivateAdmin(id: string, ctx: RequestContext, motivo?: string): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    if (id === ctx.actor.id) throw new ConflictError('No puede desactivar su propia cuenta.');
    const user = await this.getAdmin(id);
    if (!user.isActive) return;
    const admins = await this.c.users.countActiveAdmins();
    if (admins <= 1) throw new ConflictError('No se puede desactivar al último administrador activo.');
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.setActive(id, false, tx);
      await this.c.refreshTokens.revokeAllForUser(id, this.c.clock.now(), tx);
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: id,
        accion: 'desactivar',
        actor: ctx.actor,
        motivo: motivo ?? 'Baja solicitada desde DELETE /admins/:id',
        antes: { is_active: true },
        despues: { is_active: false },
        requestId: ctx.requestId,
      });
    });
  }

  async adminStats(): Promise<Record<string, number>> {
    const [alumnos, tutores, preceptores, materias] = await Promise.all([
      this.c.users.countByRole('alumno'),
      this.c.users.countByRole('tutor'),
      this.c.users.countByRole('preceptor'),
      this.c.materias.count(),
    ]);
    return {
      total_alumnos: alumnos,
      total_tutores: tutores,
      total_preceptores: preceptores,
      total_materias: materias,
    };
  }

  async listUsers(filter: {
    role?: User['role'];
    active?: boolean;
    limit: number;
    offset: number;
  }): Promise<User[]> {
    return this.c.users.list(filter);
  }

  async setUserActive(
    id: string,
    active: boolean,
    motivo: string,
    ctx: RequestContext,
  ): Promise<User> {
    requireRole(ctx.actor, 'administrador');
    if (id === ctx.actor.id && !active) {
      throw new ConflictError('No puede desactivar su propia cuenta.');
    }
    const user = await this.c.users.findById(id);
    if (!user) throw new NotFoundError('Usuario');
    if (!active && user.role === 'administrador') {
      const admins = await this.c.users.countActiveAdmins();
      if (admins <= 1) throw new ConflictError('No se puede desactivar al último administrador activo.');
    }
    await this.c.uow.transaction(async (tx) => {
      if (active) user.activate();
      else user.deactivate();
      await this.c.users.save(user, tx);
      if (!active) await this.c.refreshTokens.revokeAllForUser(id, this.c.clock.now(), tx);
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: id,
        accion: active ? 'reactivar' : 'desactivar',
        actor: ctx.actor,
        motivo,
        antes: { is_active: !active },
        despues: { is_active: active },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.users.findById(id)) as User;
  }

  async listAlumnos(
    actor: Actor,
    filter: { courseId?: number; limit: number; offset: number },
  ): Promise<Alumno[]> {
    if (actor.role === 'administrador') {
      return this.c.alumnos.list({ ...filter, limit: filter.limit, offset: filter.offset });
    }
    if (actor.role === 'preceptor') {
      const preceptor = await this.c.preceptores.findById(actor.id);
      if (!preceptor) throw new NotFoundError('Preceptor');
      if (filter.courseId !== undefined && !preceptor.courseIds.includes(filter.courseId)) {
        throw new NotFoundError('Curso');
      }
      return this.c.alumnos.list({
        courseId: filter.courseId,
        preceptorId: actor.id,
        limit: filter.limit,
        offset: filter.offset,
      });
    }
    if (actor.role === 'docente') {
      return this.c.alumnos.list({
        courseId: filter.courseId,
        teacherId: actor.id,
        limit: filter.limit,
        offset: filter.offset,
      });
    }
    if (actor.role === 'tutor') {
      return this.c.alumnos.list({
        courseId: filter.courseId,
        tutorId: actor.id,
        limit: filter.limit,
        offset: filter.offset,
      });
    }
    throw new ForbiddenError();
  }

  async getAlumno(actor: Actor, id: string): Promise<Alumno> {
    const alumno = await this.c.alumnos.findById(id);
    if (!alumno) throw new NotFoundError('Alumno');
    if (actor.role === 'administrador' || actor.id === id) return alumno;
    if (actor.role === 'tutor') {
      const links = await this.c.tutorAlumno.findByAlumno(id);
      if (links.some((link) => link.tutorId === actor.id)) return alumno;
    }
    if (actor.role === 'preceptor') {
      const preceptor = await this.c.preceptores.findById(actor.id);
      if (preceptor?.courseIds.includes(alumno.cursoDivisionTurnoId)) return alumno;
    }
    if (actor.role === 'docente') {
      const materias = await this.c.materias.findByCourse(alumno.cursoDivisionTurnoId);
      if (materias.some((materia) => materia.docenteId === actor.id)) return alumno;
    }
    throw new NotFoundError('Alumno');
  }

  async createAlumno(
    input: {
      first_name: string;
      last_name: string;
      dni: number;
      fecha_nacimiento: string;
      curso_division_turno_id: number;
      relationship: Relationship;
      otra_relacion?: string | null;
      tutor_id?: string | null;
      tutor_first_name?: string;
      tutor_last_name?: string;
      tutor_dni?: number;
      tutor_telephone?: string;
    },
    ctx: RequestContext,
  ): Promise<Alumno> {
    requireRole(ctx.actor, 'administrador');
    const dni = validateDni(input.dni);
    const fechaNacimiento = parseLegacyDate(input.fecha_nacimiento, 'fecha_nacimiento');
    assertNotFuture(fechaNacimiento, 'fecha_nacimiento');
    const curso = await this.c.cursos.findById(input.curso_division_turno_id);
    if (!curso) throw new NotFoundError('Curso');
    const count = await this.c.alumnos.countByCourse(curso.id);
    if (count >= curso.capacidadMaxima) throw new CapacityExceededError();
    await this.assertDniAvailable(dni);
    const passwordHash = await this.c.hasher.hash(String(dni));
    let created: Alumno | null = null;
    await this.c.uow.transaction(async (tx) => {
      const user = await this.createUser(tx, {
        firstName: input.first_name,
        lastName: input.last_name,
        dni,
        username: `EST-${dni}-${currentYear()}`,
        email: null,
        passwordHash,
        role: 'alumno',
        mustChangePassword: true,
      });
      const alumno = Alumno.reconstitute({
        user,
        fechaNacimiento,
        cursoDivisionTurnoId: curso.id,
        version: 1,
      });
      await this.c.alumnos.save(alumno, tx);

      let tutor: Tutor | null = null;
      if (input.tutor_id) {
        tutor = await this.c.tutores.findById(input.tutor_id, tx);
        if (!tutor) throw new NotFoundError('Tutor');
      } else {
        if (!input.tutor_first_name || !input.tutor_last_name || !input.tutor_dni) {
          throw new ValidationDomainError('Debe indicar tutor_id o los datos del tutor.');
        }
        const tutorDni = validateDni(input.tutor_dni);
        await this.assertDniAvailable(tutorDni);
        const tutorUser = await this.createUser(tx, {
          firstName: input.tutor_first_name,
          lastName: input.tutor_last_name,
          dni: tutorDni,
          username: null,
          email: null,
          passwordHash: null,
          role: 'tutor',
          mustChangePassword: false,
        });
        tutor = Tutor.reconstitute({
          user: tutorUser,
          telephone: (input.tutor_telephone ?? '').trim().slice(0, 20),
          version: 1,
        });
        if (!tutor.telephone) {
          throw new ValidationDomainError('El teléfono del tutor es obligatorio.');
        }
        await this.c.tutores.save(tutor, tx);
      }
      if (!tutor) throw new ValidationDomainError('Tutor inválido.');
      const existingLink = await this.c.tutorAlumno.findLink(alumno.id, tutor.id, tx);
      if (existingLink) throw new DuplicateResourceError('El tutor ya está vinculado al alumno.');
      const link = TutorAlumno.reconstitute({
        id: this.c.ids.uuid(),
        alumnoId: alumno.id,
        tutorId: tutor.id,
        relationship: input.relationship,
        otraRelacion: input.relationship === 'otra' ? (input.otra_relacion ?? null) : null,
        codigoInstitucional: generateCode(),
        estadoRegistro: 'pendiente',
        activa: true,
        codigoExpiraEn: expiryFromNow(7),
        registeredAt: null,
        version: 1,
      });
      if (input.relationship === 'otra' && !link.otraRelacion) {
        throw new ValidationDomainError('Debe indicar otra_relacion cuando relationship es "otra".');
      }
      await this.c.tutorAlumno.save(link, tx);
      await writeAudit(this.c, tx, {
        entidad: 'alumnos',
        entidadId: alumno.id,
        accion: 'crear',
        actor: ctx.actor,
        despues: { dni, curso_division_turno_id: curso.id, tutor_id: tutor.id },
        requestId: ctx.requestId,
      });
      created = alumno;
    });
    return created as unknown as Alumno;
  }

  async updateAlumno(
    id: string,
    input: {
      first_name?: string;
      last_name?: string;
      dni?: number;
      fecha_nacimiento?: string;
      curso_division_turno_id?: number;
      version?: number;
    },
    ctx: RequestContext,
  ): Promise<Alumno> {
    requireRole(ctx.actor, 'administrador');
    const alumno = await this.c.alumnos.findById(id);
    if (!alumno) throw new NotFoundError('Alumno');
    assertVersion(alumno.version, input.version);
    const user = alumno.user;
    if (input.dni !== undefined) {
      const dni = validateDni(input.dni);
      await this.assertDniAvailable(dni, id);
      user.changeDni(dni);
    }
    if (input.first_name !== undefined || input.last_name !== undefined) {
      user.rename(input.first_name ?? user.firstName, input.last_name ?? user.lastName);
    }
    if (input.fecha_nacimiento !== undefined) {
      const fecha = parseLegacyDate(input.fecha_nacimiento, 'fecha_nacimiento');
      assertNotFuture(fecha, 'fecha_nacimiento');
      alumno.changeBirthDate(fecha);
    }
    if (input.curso_division_turno_id !== undefined) {
      const curso = await this.c.cursos.findById(input.curso_division_turno_id);
      if (!curso) throw new NotFoundError('Curso');
      const count = await this.c.alumnos.countByCourse(curso.id);
      if (count >= curso.capacidadMaxima && curso.id !== alumno.cursoDivisionTurnoId) {
        throw new CapacityExceededError();
      }
      alumno.changeCourse(curso.id);
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.save(user, tx);
      await this.c.alumnos.save(alumno, tx);
      await writeAudit(this.c, tx, {
        entidad: 'alumnos',
        entidadId: id,
        accion: 'actualizar',
        actor: ctx.actor,
        despues: {
          first_name: user.firstName,
          last_name: user.lastName,
          dni: user.dni,
          fecha_nacimiento: alumno.fechaNacimiento,
          curso_division_turno_id: alumno.cursoDivisionTurnoId,
        },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.alumnos.findById(id)) as Alumno;
  }

  async deleteAlumno(id: string, ctx: RequestContext, motivo?: string): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const alumno = await this.c.alumnos.findById(id);
    if (!alumno) throw new NotFoundError('Alumno');
    if (!alumno.user.isActive) return;
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.setActive(id, false, tx);
      await this.c.refreshTokens.revokeAllForUser(id, this.c.clock.now(), tx);
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: id,
        accion: 'desactivar',
        actor: ctx.actor,
        motivo: motivo ?? 'Baja solicitada desde DELETE /alumnos/:id',
        antes: { is_active: true },
        despues: { is_active: false },
        requestId: ctx.requestId,
      });
    });
  }

  async listDocentes(
    actor: Actor,
    filter: { courseId?: number; limit: number; offset: number },
  ): Promise<Docente[]> {
    requireRole(actor, 'administrador', 'preceptor');
    return this.c.docentes.list(filter);
  }

  async getDocente(actor: Actor, id: string): Promise<Docente> {
    const docente = await this.c.docentes.findById(id);
    if (!docente) throw new NotFoundError('Docente');
    if (actor.role === 'administrador' || actor.role === 'preceptor' || actor.id === id) {
      return docente;
    }
    throw new NotFoundError('Docente');
  }

  async createDocente(
    input: {
      first_name: string;
      last_name: string;
      dni: number;
      telephone: string;
      fecha_ingreso: string;
      curso_division_turno_id?: number | null;
    },
    ctx: RequestContext,
  ): Promise<Docente> {
    requireRole(ctx.actor, 'administrador');
    const dni = validateDni(input.dni);
    const fechaIngreso = parseLegacyDate(input.fecha_ingreso, 'fecha_ingreso');
    assertNotFuture(fechaIngreso, 'fecha_ingreso');
    await this.assertDniAvailable(dni);
    if (input.curso_division_turno_id) {
      const curso = await this.c.cursos.findById(input.curso_division_turno_id);
      if (!curso) throw new NotFoundError('Curso');
    }
    const passwordHash = await this.c.hasher.hash(String(dni));
    let created: Docente | null = null;
    await this.c.uow.transaction(async (tx) => {
      const user = await this.createUser(tx, {
        firstName: input.first_name,
        lastName: input.last_name,
        dni,
        username: `DOC-${dni}-${fechaIngreso.slice(0, 4)}`,
        email: null,
        passwordHash,
        role: 'docente',
        mustChangePassword: true,
      });
      const docente = Docente.reconstitute({
        user,
        telephone: input.telephone,
        fechaIngreso,
        cursoDivisionTurnoId: input.curso_division_turno_id ?? null,
        version: 1,
      });
      await this.c.docentes.save(docente, tx);
      await writeAudit(this.c, tx, {
        entidad: 'docentes',
        entidadId: docente.id,
        accion: 'crear',
        actor: ctx.actor,
        despues: { dni, telephone: docente.telephone, fecha_ingreso: docente.fechaIngreso },
        requestId: ctx.requestId,
      });
      created = docente;
    });
    return created as unknown as Docente;
  }

  async updateDocente(
    id: string,
    input: {
      first_name?: string;
      last_name?: string;
      telephone?: string;
      fecha_ingreso?: string;
      curso_division_turno_id?: number | null;
      version?: number;
    },
    ctx: RequestContext,
  ): Promise<Docente> {
    requireRole(ctx.actor, 'administrador');
    const docente = await this.c.docentes.findById(id);
    if (!docente) throw new NotFoundError('Docente');
    assertVersion(docente.version, input.version);
    const user = docente.user;
    if (input.first_name !== undefined || input.last_name !== undefined) {
      user.rename(input.first_name ?? user.firstName, input.last_name ?? user.lastName);
    }
    if (input.telephone !== undefined) docente.changePhone(input.telephone);
    if (input.fecha_ingreso !== undefined) {
      const fecha = parseLegacyDate(input.fecha_ingreso, 'fecha_ingreso');
      assertNotFuture(fecha, 'fecha_ingreso');
      docente.changeHireDate(fecha);
    }
    if (input.curso_division_turno_id !== undefined) {
      if (input.curso_division_turno_id !== null) {
        const curso = await this.c.cursos.findById(input.curso_division_turno_id);
        if (!curso) throw new NotFoundError('Curso');
      }
      docente.changeReferenceCourse(input.curso_division_turno_id);
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.save(user, tx);
      await this.c.docentes.save(docente, tx);
      await writeAudit(this.c, tx, {
        entidad: 'docentes',
        entidadId: id,
        accion: 'actualizar',
        actor: ctx.actor,
        despues: {
          first_name: user.firstName,
          last_name: user.lastName,
          telephone: docente.telephone,
          fecha_ingreso: docente.fechaIngreso,
          curso_division_turno_id: docente.cursoDivisionTurnoId,
        },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.docentes.findById(id)) as Docente;
  }

  async deleteDocente(id: string, ctx: RequestContext, motivo?: string): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const docente = await this.c.docentes.findById(id);
    if (!docente) throw new NotFoundError('Docente');
    const materias = await this.c.materias.findByTeacher(id);
    if (materias.length > 0) {
      throw new ConflictError('El docente todavía dicta materias; reasígnelas antes de la baja.');
    }
    if (!docente.user.isActive) return;
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.setActive(id, false, tx);
      await this.c.refreshTokens.revokeAllForUser(id, this.c.clock.now(), tx);
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: id,
        accion: 'desactivar',
        actor: ctx.actor,
        motivo: motivo ?? 'Baja solicitada desde DELETE /docentes/:id',
        antes: { is_active: true },
        despues: { is_active: false },
        requestId: ctx.requestId,
      });
    });
  }

  async validateTutorCode(
    code: string,
  ): Promise<{ alumno: { first_name: string; last_name: string; curso_division: string } }> {
    const link = await this.c.tutorAlumno.findByCode(code);
    if (!link || !link.isCodeUsable(this.c.clock.now())) throw new InvalidCodeError();
    const alumno = await this.c.alumnos.findById(link.alumnoId);
    if (!alumno) throw new InvalidCodeError();
    const curso = await this.c.cursos.findById(alumno.cursoDivisionTurnoId);
    return {
      alumno: {
        first_name: alumno.user.firstName,
        last_name: alumno.user.lastName,
        curso_division: curso ? curso.displayName() : '',
      },
    };
  }

  async registerTutor(input: {
    codigo: string;
    email: string;
    password: string;
    password_confirmation: string;
  }): Promise<Tutor> {
    if (input.password !== input.password_confirmation) {
      throw new ValidationDomainError('La confirmación de la contraseña no coincide.', [
        { path: 'body.password_confirmation', code: 'custom', message: 'No coincide.' },
      ]);
    }
    validatePassword(input.password);
    const email = normalizeEmail(input.email);
    let created: Tutor | null = null;
    await this.c.uow.transaction(async (tx) => {
      const link = await this.c.tutorAlumno.findByCode(input.codigo, tx);
      if (!link || !link.isCodeUsable(this.c.clock.now())) throw new InvalidCodeError();
      const tutor = await this.c.tutores.findById(link.tutorId, tx);
      if (!tutor) throw new InvalidCodeError();
      if (tutor.user.email || tutor.user.username) {
        throw new DuplicateResourceError('El tutor ya está registrado.');
      }
      await this.assertEmailAvailable(email);
      const hash = await this.c.hasher.hash(input.password);
      tutor.user.changeEmail(email);
      tutor.user.changeUsername(email);
      tutor.user.changePassword(hash, false);
      await this.c.users.save(tutor.user, tx);
      link.register(this.c.clock.now());
      await this.c.tutorAlumno.save(link, tx);
      await writeAudit(this.c, tx, {
        entidad: 'tutores',
        entidadId: tutor.id,
        accion: 'registrar',
        actor: null,
        despues: { email, link_id: link.id },
        requestId: null,
      });
      created = tutor;
    });
    return created as unknown as Tutor;
  }

  async listTutores(limit: number, offset: number): Promise<Tutor[]> {
    return this.c.tutores.list({ limit, offset });
  }

  async getTutor(actor: Actor, id: string): Promise<Tutor> {
    const tutor = await this.c.tutores.findById(id);
    if (!tutor) throw new NotFoundError('Tutor');
    if (actor.role === 'administrador' || actor.id === id) return tutor;
    throw new NotFoundError('Tutor');
  }

  async createTutor(
    input: {
      first_name: string;
      last_name: string;
      dni: number;
      telephone: string;
      email: string;
      password?: string;
    },
    ctx: RequestContext,
  ): Promise<Tutor> {
    requireRole(ctx.actor, 'administrador');
    const dni = validateDni(input.dni);
    const email = normalizeEmail(input.email);
    await this.assertDniAvailable(dni);
    await this.assertEmailAvailable(email);
    const initialPassword = input.password ?? String(dni);
    validatePassword(initialPassword);
    const hash = await this.c.hasher.hash(initialPassword);
    let created: Tutor | null = null;
    await this.c.uow.transaction(async (tx) => {
      const user = await this.createUser(tx, {
        firstName: input.first_name,
        lastName: input.last_name,
        dni,
        username: email,
        email,
        passwordHash: hash,
        role: 'tutor',
        mustChangePassword: true,
      });
      const tutor = Tutor.reconstitute({
        user,
        telephone: input.telephone,
        version: 1,
      });
      await this.c.tutores.save(tutor, tx);
      await writeAudit(this.c, tx, {
        entidad: 'tutores',
        entidadId: tutor.id,
        accion: 'crear',
        actor: ctx.actor,
        despues: { dni, email, telephone: tutor.telephone },
        requestId: ctx.requestId,
      });
      created = tutor;
    });
    return created as unknown as Tutor;
  }

  async updateTutor(
    actor: Actor,
    id: string,
    input: { telephone?: string; email?: string; version?: number },
  ): Promise<Tutor> {
    const tutor = await this.getTutor(actor, id);
    if (actor.role !== 'administrador' && input.email !== undefined) {
      throw new ForbiddenError('Solo un administrador puede cambiar el email.');
    }
    assertVersion(tutor.version, input.version);
    if (input.telephone !== undefined) tutor.changePhone(input.telephone);
    if (input.email !== undefined) {
      const email = normalizeEmail(input.email);
      await this.assertEmailAvailable(email, id);
      tutor.user.changeEmail(email);
      tutor.user.changeUsername(email);
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.save(tutor.user, tx);
      await this.c.tutores.save(tutor, tx);
      await writeAudit(this.c, tx, {
        entidad: 'tutores',
        entidadId: id,
        accion: 'actualizar',
        actor,
        despues: { telephone: tutor.telephone, email: tutor.user.email },
        requestId: null,
      });
    });
    return (await this.c.tutores.findById(id)) as Tutor;
  }

  async deleteTutor(id: string, ctx: RequestContext, motivo?: string): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const tutor = await this.c.tutores.findById(id);
    if (!tutor) throw new NotFoundError('Tutor');
    if (!tutor.user.isActive) return;
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.setActive(id, false, tx);
      await this.c.refreshTokens.revokeAllForUser(id, this.c.clock.now(), tx);
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: id,
        accion: 'desactivar',
        actor: ctx.actor,
        motivo: motivo ?? 'Baja solicitada desde DELETE /tutores/:id',
        antes: { is_active: true },
        despues: { is_active: false },
        requestId: ctx.requestId,
      });
    });
  }

  async getTutorByDni(dni: number): Promise<Tutor> {
    const tutor = await this.c.tutores.findByDni(validateDni(dni));
    if (!tutor) throw new NotFoundError('Tutor');
    return tutor;
  }

  async getTutorAlumnos(actor: Actor, id: string): Promise<Alumno[]> {
    if (actor.role !== 'administrador' && actor.id !== id) throw new ForbiddenError();
    const links = await this.c.tutorAlumno.findByTutor(id);
    const alumnos: Alumno[] = [];
    for (const link of links) {
      const alumno = await this.c.alumnos.findById(link.alumnoId);
      if (alumno) alumnos.push(alumno);
    }
    return alumnos;
  }

  async deactivateTutorLink(id: string, ctx: RequestContext): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const link = await this.c.tutorAlumno.findById(id);
    if (!link) throw new NotFoundError('Vínculo');
    if (!link.activa) return;
    await this.c.uow.transaction(async (tx) => {
      link.deactivate();
      await this.c.tutorAlumno.save(link, tx);
      await writeAudit(this.c, tx, {
        entidad: 'tutor_alumno',
        entidadId: id,
        accion: 'desactivar',
        actor: ctx.actor,
        antes: { activa: true },
        despues: { activa: false },
        requestId: ctx.requestId,
      });
    });
  }

  async listPreceptores(filter: {
    courseId?: number;
    limit: number;
    offset: number;
  }): Promise<Preceptor[]> {
    return this.c.preceptores.list(filter);
  }

  async getPreceptor(actor: Actor, id: string): Promise<Preceptor> {
    const preceptor = await this.c.preceptores.findById(id);
    if (!preceptor) throw new NotFoundError('Preceptor');
    if (actor.role === 'administrador' || actor.id === id) return preceptor;
    throw new NotFoundError('Preceptor');
  }

  async createPreceptor(
    input: {
      first_name: string;
      last_name: string;
      dni: number;
      telephone?: string | null;
      employee_code?: string | null;
      cursos?: number[];
    },
    ctx: RequestContext,
  ): Promise<Preceptor> {
    requireRole(ctx.actor, 'administrador');
    const dni = validateDni(input.dni);
    await this.assertDniAvailable(dni);
    for (const courseId of input.cursos ?? []) {
      const curso = await this.c.cursos.findById(courseId);
      if (!curso) throw new NotFoundError('Curso');
    }
    const passwordHash = await this.c.hasher.hash(String(dni));
    let created: Preceptor | null = null;
    await this.c.uow.transaction(async (tx) => {
      const user = await this.createUser(tx, {
        firstName: input.first_name,
        lastName: input.last_name,
        dni,
        username: `PRE-${dni}-${currentYear()}`,
        email: null,
        passwordHash,
        role: 'preceptor',
        mustChangePassword: true,
      });
      const preceptor = Preceptor.reconstitute({
        user,
        telephone: input.telephone ?? null,
        employeeCode: input.employee_code ?? null,
        courseIds: input.cursos ?? [],
        version: 1,
      });
      await this.c.preceptores.save(preceptor, tx);
      await this.c.preceptores.replaceCourses(preceptor.id, input.cursos ?? [], tx);
      await writeAudit(this.c, tx, {
        entidad: 'preceptores',
        entidadId: preceptor.id,
        accion: 'crear',
        actor: ctx.actor,
        despues: { dni, cursos: input.cursos ?? [] },
        requestId: ctx.requestId,
      });
      created = preceptor;
    });
    return created as unknown as Preceptor;
  }

  async updatePreceptor(
    id: string,
    input: { telephone?: string | null; employee_code?: string | null; version?: number },
    ctx: RequestContext,
  ): Promise<Preceptor> {
    requireRole(ctx.actor, 'administrador');
    const preceptor = await this.c.preceptores.findById(id);
    if (!preceptor) throw new NotFoundError('Preceptor');
    assertVersion(preceptor.version, input.version);
    const updated = Preceptor.reconstitute({
      user: preceptor.user,
      telephone: input.telephone !== undefined ? input.telephone : preceptor.telephone,
      employeeCode: input.employee_code !== undefined ? input.employee_code : preceptor.employeeCode,
      courseIds: preceptor.courseIds,
      version: preceptor.version,
    });
    await this.c.uow.transaction(async (tx) => {
      await this.c.preceptores.save(updated, tx);
      await writeAudit(this.c, tx, {
        entidad: 'preceptores',
        entidadId: id,
        accion: 'actualizar',
        actor: ctx.actor,
        despues: { telephone: updated.telephone, employee_code: updated.employeeCode },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.preceptores.findById(id)) as Preceptor;
  }

  async replacePreceptorCourses(
    id: string,
    courses: number[],
    ctx: RequestContext,
  ): Promise<Preceptor> {
    requireRole(ctx.actor, 'administrador');
    const preceptor = await this.c.preceptores.findById(id);
    if (!preceptor) throw new NotFoundError('Preceptor');
    for (const courseId of courses) {
      const curso = await this.c.cursos.findById(courseId);
      if (!curso) throw new NotFoundError('Curso');
    }
    await this.c.uow.transaction(async (tx) => {
      await this.c.preceptores.replaceCourses(id, courses, tx);
      await writeAudit(this.c, tx, {
        entidad: 'preceptores',
        entidadId: id,
        accion: 'actualizar',
        actor: ctx.actor,
        antes: { cursos: preceptor.courseIds },
        despues: { cursos: courses },
        requestId: ctx.requestId,
      });
    });
    return (await this.c.preceptores.findById(id)) as Preceptor;
  }

  async deletePreceptor(id: string, ctx: RequestContext, motivo?: string): Promise<void> {
    requireRole(ctx.actor, 'administrador');
    const preceptor = await this.c.preceptores.findById(id);
    if (!preceptor) throw new NotFoundError('Preceptor');
    if (!preceptor.user.isActive) return;
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.setActive(id, false, tx);
      await this.c.refreshTokens.revokeAllForUser(id, this.c.clock.now(), tx);
      await writeAudit(this.c, tx, {
        entidad: 'users',
        entidadId: id,
        accion: 'desactivar',
        actor: ctx.actor,
        motivo: motivo ?? 'Baja solicitada desde DELETE /preceptores/:id',
        antes: { is_active: true },
        despues: { is_active: false },
        requestId: ctx.requestId,
      });
    });
  }

  async assertTutorLinked(actor: Actor, alumnoId: string): Promise<void> {
    if (actor.role !== 'tutor') return;
    const links = await this.c.tutorAlumno.findByAlumno(alumnoId);
    if (!links.some((link) => link.tutorId === actor.id)) throw new NotFoundError('Alumno');
  }

  async ensureCanSeeAlumno(actor: Actor, alumnoId: string): Promise<void> {
    await this.getAlumno(actor, alumnoId);
  }

  isAdmin(actor: Actor): boolean {
    return isAdmin(actor);
  }

  async requireAuthenticatedUser(actor: Actor): Promise<User> {
    const user = await this.c.users.findById(actor.id);
    if (!user || !user.isActive) throw new UnauthenticatedError();
    return user;
  }
}
