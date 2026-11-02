import type { AppContainer } from './container.js';
import type { Actor } from '../domain/shared/types.js';
import {
  InvalidCredentialsError,
  PasswordChangeRequiredError,
  TokenReuseDetectedError,
  UnauthenticatedError,
  ValidationDomainError,
} from '../domain/shared/errors.js';
import { validatePassword } from '../domain/shared/value-objects.js';
import type { User } from '../domain/identity/entities.js';
import { env } from '../config/env.js';

export interface LoginResponse {
  access_token: string;
  refresh_token: string | null;
  token_type: 'Bearer';
  expires_in: number;
  role: string;
  first_name: string;
  last_name: string;
  username: string | null;
  must_change_password: boolean;
}

export class AuthService {
  constructor(private readonly c: AppContainer) {}

  private async buildSession(
    user: User,
    meta: { ip: string | null; userAgent: string | null },
    familyId?: string,
    tx?: import('../domain/shared/types.js').Tx,
  ): Promise<LoginResponse> {
    const passwordChangeOnly = user.mustChangePassword;
    const access = await this.c.tokens.issueAccess({
      userId: user.id,
      role: user.role,
      passwordChangeOnly,
    });
    let refreshToken: string | null = null;
    if (!passwordChangeOnly) {
      const generated = this.c.tokens.generateRefresh();
      const now = this.c.clock.now();
      const expiresAt = new Date(
        new Date(this.c.clock.now()).getTime() + env().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      await this.c.refreshTokens.create(
        {
          id: this.c.ids.uuid(),
          userId: user.id,
          familyId: familyId ?? generated.familyId,
          tokenHash: generated.tokenHash,
          expiresAt,
          revokedAt: null,
          replacedById: null,
          userAgent: meta.userAgent,
          ip: meta.ip,
          createdAt: now,
        },
        tx,
      );
      refreshToken = generated.rawToken;
    }
    return {
      access_token: access.token,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: access.expiresIn,
      role: user.role,
      first_name: user.firstName,
      last_name: user.lastName,
      username: user.username,
      must_change_password: user.mustChangePassword,
    };
  }

  async login(
    input: { username: string; password: string },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResponse> {
    const user = await this.c.users.findByUsername(input.username);
    if (!user || !user.isActive || !user.passwordHash || !user.canAuthenticate()) {
      throw new InvalidCredentialsError();
    }
    const valid = await this.c.hasher.verify(user.passwordHash, input.password);
    if (!valid) throw new InvalidCredentialsError();
    user.recordLogin(this.c.clock.now());
    let response: LoginResponse | null = null;
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.save(user, tx);
      response = await this.buildSession(user, meta, undefined, tx);
    });
    return response as unknown as LoginResponse;
  }

  async refresh(
    rawToken: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResponse> {
    const hash = this.c.tokens.hashRefresh(rawToken);
    const stored = await this.c.refreshTokens.findByHash(hash);
    if (!stored) throw new UnauthenticatedError('Refresh token inválido.');
    if (stored.revokedAt) {
      await this.c.refreshTokens.revokeFamily(stored.familyId, this.c.clock.now());
      throw new TokenReuseDetectedError();
    }
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw new UnauthenticatedError('Refresh token expirado.');
    }
    const user = await this.c.users.findById(stored.userId);
    if (!user || !user.isActive) throw new UnauthenticatedError('Cuenta inactiva.');
    if (user.mustChangePassword) throw new PasswordChangeRequiredError();

    let response: LoginResponse | null = null;
    await this.c.uow.transaction(async (tx) => {
      const generated = this.c.tokens.generateRefresh();
      const newId = this.c.ids.uuid();
      const now = this.c.clock.now();
      await this.c.refreshTokens.create(
        {
          id: newId,
          userId: user.id,
          familyId: stored.familyId,
          tokenHash: generated.tokenHash,
          expiresAt: new Date(
            new Date(this.c.clock.now()).getTime() + env().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString(),
          revokedAt: null,
          replacedById: null,
          userAgent: meta.userAgent,
          ip: meta.ip,
          createdAt: now,
        },
        tx,
      );
      await this.c.refreshTokens.revoke(stored.id, newId, now, tx);
      const access = await this.c.tokens.issueAccess({
        userId: user.id,
        role: user.role,
        passwordChangeOnly: false,
      });
      response = {
        access_token: access.token,
        refresh_token: generated.rawToken,
        token_type: 'Bearer',
        expires_in: access.expiresIn,
        role: user.role,
        first_name: user.firstName,
        last_name: user.lastName,
        username: user.username,
        must_change_password: false,
      };
    });
    return response as unknown as LoginResponse;
  }

  async logout(actor: Actor, rawToken?: string): Promise<void> {
    const now = this.c.clock.now();
    if (rawToken) {
      const stored = await this.c.refreshTokens.findByHash(this.c.tokens.hashRefresh(rawToken));
      if (stored && stored.userId === actor.id) {
        await this.c.refreshTokens.revokeFamily(stored.familyId, now);
      }
      return;
    }
    await this.c.refreshTokens.revokeAllForUser(actor.id, now);
  }

  async changePassword(
    actor: Actor,
    input: { current_password: string; new_password: string; new_password_confirmation: string },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<LoginResponse> {
    if (input.new_password !== input.new_password_confirmation) {
      throw new ValidationDomainError('La confirmación de la nueva contraseña no coincide.', [
        { path: 'body.new_password_confirmation', code: 'custom', message: 'No coincide.' },
      ]);
    }
    validatePassword(input.new_password, env().PASSWORD_MIN_LENGTH, env().PASSWORD_MAX_LENGTH);
    if (input.new_password === input.current_password) {
      throw new ValidationDomainError('La nueva contraseña debe ser distinta de la anterior.');
    }
    const user = await this.c.users.findById(actor.id);
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthenticatedError();
    }
    const valid = await this.c.hasher.verify(user.passwordHash, input.current_password);
    if (!valid) {
      throw new ValidationDomainError('La contraseña actual no es correcta.', [
        { path: 'body.current_password', code: 'custom', message: 'Contraseña actual incorrecta.' },
      ]);
    }
    const hash = await this.c.hasher.hash(input.new_password);
    user.changePassword(hash, false);
    let response: LoginResponse | null = null;
    await this.c.uow.transaction(async (tx) => {
      await this.c.users.save(user, tx);
      await this.c.refreshTokens.revokeAllForUser(user.id, this.c.clock.now(), tx);
      response = await this.buildSession(user, meta, undefined, tx);
    });
    return response as unknown as LoginResponse;
  }

  async me(actor: Actor): Promise<Record<string, unknown>> {
    const user = await this.c.users.findById(actor.id);
    if (!user || !user.isActive) throw new UnauthenticatedError();
    const perfiles: Record<string, unknown> = {};
    const cursos: unknown[] = [];
    if (user.role === 'alumno') {
      const alumno = await this.c.alumnos.findById(user.id);
      if (alumno) {
        const curso = await this.c.cursos.findById(alumno.cursoDivisionTurnoId);
        perfiles.alumno = { fecha_nacimiento: alumno.fechaNacimiento, curso_division_turno_id: alumno.cursoDivisionTurnoId };
        if (curso) cursos.push({ id: curso.id, curso_division: curso.displayName() });
      }
    } else if (user.role === 'docente') {
      const docente = await this.c.docentes.findById(user.id);
      if (docente) perfiles.docente = { telephone: docente.telephone, fecha_ingreso: docente.fechaIngreso };
    } else if (user.role === 'tutor') {
      const tutor = await this.c.tutores.findById(user.id);
      if (tutor) perfiles.tutor = { telephone: tutor.telephone };
    } else if (user.role === 'preceptor') {
      const preceptor = await this.c.preceptores.findById(user.id);
      if (preceptor) {
        perfiles.preceptor = { telephone: preceptor.telephone, employee_code: preceptor.employeeCode };
        for (const courseId of preceptor.courseIds) {
          const curso = await this.c.cursos.findById(courseId);
          if (curso) cursos.push({ id: curso.id, curso_division: curso.displayName() });
        }
      }
    }
    return { user, perfiles, cursos };
  }
}
