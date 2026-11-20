import { describe, expect, it } from 'vitest';
import {
  Alumno,
  Docente,
  Preceptor,
  Tutor,
  TutorAlumno,
  User,
  type AlumnoProps,
  type DocenteProps,
  type PreceptorProps,
  type TutorProps,
  type TutorAlumnoProps,
  type UserProps,
} from '../../src/domain/identity/entities.js';
import { ValidationDomainError } from '../../src/domain/shared/errors.js';
import type { CourseId, LocalDate, UserId } from '../../src/domain/shared/types.js';

const NOW = '2026-01-15T12:00:00.000Z';

function expectValidation(run: () => unknown, message: string): void {
  expect(run).toThrow(ValidationDomainError);
  expect(run).toThrow(message);
}

function userProps(overrides: Partial<UserProps> = {}): UserProps {
  return {
    id: 'user-1' as UserId,
    firstName: 'Ana',
    lastName: 'Pérez',
    dni: 40_123_456,
    username: 'ana.perez',
    email: 'ana@example.com',
    passwordHash: 'hash',
    role: 'alumno',
    mustChangePassword: false,
    isActive: true,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserProps> = {}): User {
  return User.reconstitute(userProps(overrides));
}

describe('User (base de todos los roles)', () => {
  it('expone una copia de sus propiedades', () => {
    const user = makeUser();
    const props = user.toProps();
    expect(props).toEqual(userProps());
    props.firstName = 'Modificado';
    expect(user.firstName).toBe('Ana');
  });

  it('rename recorta espacios y limita a 100 caracteres', () => {
    const user = makeUser();
    user.rename('  Juan  ', '  López  ');
    expect([user.firstName, user.lastName]).toEqual(['Juan', 'López']);

    user.rename('a'.repeat(120), 'b'.repeat(120));
    expect([user.firstName, user.lastName]).toEqual(['a'.repeat(100), 'b'.repeat(100)]);
  });

  it('rename rechaza nombres vacíos', () => {
    const user = makeUser();
    expectValidation(() => user.rename('', 'Pérez'), 'Nombre y apellido son obligatorios.');
    expectValidation(() => user.rename('Ana', '   '), 'Nombre y apellido son obligatorios.');
  });

  it('cambia DNI, username y email con sus value objects', () => {
    const user = makeUser();
    user.changeDni(30_111_222);
    user.changeUsername('  nueva.usuaria  ');
    user.changeEmail('  Maria@Example.COM  ');
    expect([user.dni, user.username, user.email]).toEqual([
      30_111_222,
      'nueva.usuaria',
      'maria@example.com',
    ]);

    user.changeDni(null);
    user.changeUsername(null);
    user.changeEmail(null);
    expect([user.dni, user.username, user.email]).toEqual([null, null, null]);
  });

  it('rechaza credenciales inválidas', () => {
    const user = makeUser();
    expectValidation(() => user.changeDni(123), 'El DNI debe tener 7 u 8 dígitos.');
    expectValidation(
      () => user.changeUsername('ab'),
      'El username debe tener al menos 3 caracteres.',
    );
    expectValidation(() => user.changeEmail('no-email'), 'El email no es válido.');
  });

  it('changePassword y recordLogin actualizan el estado', () => {
    const user = makeUser();
    user.changePassword('nuevo-hash', true);
    user.recordLogin(NOW);
    expect([user.passwordHash, user.mustChangePassword, user.lastLoginAt]).toEqual([
      'nuevo-hash',
      true,
      NOW,
    ]);
  });

  it('canAuthenticate exige activo, username y passwordHash', () => {
    const user = makeUser();
    expect(user.canAuthenticate()).toBe(true);
    user.deactivate();
    expect(user.isActive).toBe(false);
    expect(user.canAuthenticate()).toBe(false);

    user.activate();
    user.changeUsername(null);
    expect(user.canAuthenticate()).toBe(false);
    user.changeUsername('ana.perez');
    user.changePassword(null as unknown as string, false);
    expect(user.canAuthenticate()).toBe(false);
  });

  it('administrador conserva su rol y valida el cambio de estado', () => {
    const admin = makeUser({ role: 'administrador', mustChangePassword: true });
    expect(admin.role).toBe('administrador');
    expect(admin.hasRole('administrador')).toBe(true);
    expect(admin.hasRole('preceptor')).toBe(false);
    expect(admin.canAuthenticate()).toBe(true);
    admin.deactivate();
    expect(admin.canAuthenticate()).toBe(false);
    admin.activate();
    expect(admin.canAuthenticate()).toBe(true);
  });
});

describe('Alumno', () => {
  function makeAlumno(overrides: Partial<AlumnoProps> = {}): Alumno {
    return Alumno.reconstitute({
      user: makeUser({ role: 'alumno' }),
      fechaNacimiento: '2010-05-12' as LocalDate,
      cursoDivisionTurnoId: 1 as CourseId,
      version: 1,
      ...overrides,
    });
  }

  it('delega identidad y expone sus atributos', () => {
    const alumno = makeAlumno();
    expect(alumno.id).toBe(alumno.user.id);
    expect(alumno.user.role).toBe('alumno');
    expect(alumno.fechaNacimiento).toBe('2010-05-12');
    expect(alumno.cursoDivisionTurnoId).toBe(1);
    expect(alumno.version).toBe(1);
  });

  it('changeBirthDate valida el formato de fecha', () => {
    const alumno = makeAlumno();
    alumno.changeBirthDate('2011-01-03' as LocalDate);
    expect(alumno.fechaNacimiento).toBe('2011-01-03');
    expectValidation(
      () => alumno.changeBirthDate('03/01/2011' as LocalDate),
      'fecha debe tener formato YYYY-MM-DD.',
    );
  });

  it('changeCourse actualiza el curso y belongsToCourse', () => {
    const alumno = makeAlumno();
    expect(alumno.belongsToCourse(1)).toBe(true);
    alumno.changeCourse(2 as CourseId);
    expect(alumno.belongsToCourse(2)).toBe(true);
    expect(alumno.belongsToCourse(1)).toBe(false);
  });
});

describe('Docente', () => {
  function makeDocente(overrides: Partial<DocenteProps> = {}): Docente {
    return Docente.reconstitute({
      user: makeUser({ role: 'docente' }),
      telephone: '3815551111',
      fechaIngreso: '2020-03-01' as LocalDate,
      cursoDivisionTurnoId: 1 as CourseId,
      version: 1,
      ...overrides,
    });
  }

  it('expone usuario, teléfono, ingreso y curso de referencia', () => {
    const docente = makeDocente();
    expect(docente.id).toBe(docente.user.id);
    expect(docente.user.role).toBe('docente');
    expect(docente.telephone).toBe('3815551111');
    expect(docente.fechaIngreso).toBe('2020-03-01');
    expect(docente.cursoDivisionTurnoId).toBe(1);
    expect(docente.version).toBe(1);
  });

  it('changePhone recorta espacios y limita a 20 caracteres', () => {
    const docente = makeDocente();
    docente.changePhone('  3815559999  ');
    expect(docente.telephone).toBe('3815559999');
    docente.changePhone('1'.repeat(30));
    expect(docente.telephone).toBe('1'.repeat(20));
    expectValidation(() => docente.changePhone('   '), 'El teléfono es obligatorio.');
  });

  it('changeHireDate valida la fecha y changeReferenceCourse acepta null', () => {
    const docente = makeDocente();
    docente.changeHireDate('2021-02-15' as LocalDate);
    expect(docente.fechaIngreso).toBe('2021-02-15');
    expectValidation(
      () => docente.changeHireDate('2021-13-01' as LocalDate),
      'fecha debe tener formato YYYY-MM-DD.',
    );

    docente.changeReferenceCourse(null);
    expect(docente.cursoDivisionTurnoId).toBeNull();
    docente.changeReferenceCourse(5 as CourseId);
    expect(docente.cursoDivisionTurnoId).toBe(5);
  });
});

describe('Tutor', () => {
  function makeTutor(overrides: Partial<TutorProps> = {}): Tutor {
    return Tutor.reconstitute({
      user: makeUser({ role: 'tutor', username: null, passwordHash: null }),
      telephone: '3815552222',
      version: 1,
      ...overrides,
    });
  }

  it('expone usuario y teléfono', () => {
    const tutor = makeTutor();
    expect(tutor.id).toBe(tutor.user.id);
    expect(tutor.user.role).toBe('tutor');
    expect(tutor.telephone).toBe('3815552222');
    expect(tutor.version).toBe(1);
  });

  it('changePhone normaliza y rechaza valores vacíos', () => {
    const tutor = makeTutor();
    tutor.changePhone('  3815553333  ');
    expect(tutor.telephone).toBe('3815553333');
    expectValidation(() => tutor.changePhone(''), 'El teléfono es obligatorio.');
  });

  it('un tutor pendiente de registro no puede autenticarse', () => {
    expect(makeTutor().user.canAuthenticate()).toBe(false);
    expect(makeTutor({ user: makeUser({ role: 'tutor' }) }).user.canAuthenticate()).toBe(true);
  });
});

describe('Preceptor', () => {
  function makePreceptor(overrides: Partial<PreceptorProps> = {}): Preceptor {
    return Preceptor.reconstitute({
      user: makeUser({ role: 'preceptor' }),
      telephone: null,
      employeeCode: 'EMP-1',
      courseIds: [1, 2],
      version: 1,
      ...overrides,
    });
  }

  it('expone usuario, datos opcionales y versión', () => {
    const preceptor = makePreceptor();
    expect(preceptor.id).toBe(preceptor.user.id);
    expect(preceptor.user.role).toBe('preceptor');
    expect(preceptor.telephone).toBeNull();
    expect(preceptor.employeeCode).toBe('EMP-1');
    expect(preceptor.version).toBe(1);
  });

  it('copia courseIds al reconstituir y al leerlos', () => {
    const courseIds = [1, 2];
    const preceptor = makePreceptor({ courseIds });
    courseIds.push(3);
    expect(preceptor.courseIds).toEqual([1, 2]);

    const read = preceptor.courseIds;
    read.push(4);
    expect(preceptor.courseIds).toEqual([1, 2]);
  });

  it('canOperate depende de tener cursos asignados', () => {
    expect(makePreceptor().canOperate()).toBe(true);
    expect(makePreceptor({ courseIds: [] }).canOperate()).toBe(false);
  });
});

describe('Vínculo tutor-alumno', () => {
  function makeLink(overrides: Partial<TutorAlumnoProps> = {}): TutorAlumno {
    return TutorAlumno.reconstitute({
      id: 'link-1',
      alumnoId: 'alumno-1' as UserId,
      tutorId: 'tutor-1' as UserId,
      relationship: 'padre',
      otraRelacion: null,
      codigoInstitucional: 'CODE1234',
      estadoRegistro: 'pendiente',
      activa: true,
      codigoExpiraEn: '2026-01-20T12:00:00.000Z',
      registeredAt: null,
      version: 1,
      ...overrides,
    });
  }

  it('expone los datos del vínculo', () => {
    const link = makeLink({ relationship: 'otra', otraRelacion: 'abuela' });
    expect(link).toMatchObject({
      id: 'link-1',
      alumnoId: 'alumno-1',
      tutorId: 'tutor-1',
      relationship: 'otra',
      otraRelacion: 'abuela',
      codigoInstitucional: 'CODE1234',
      estadoRegistro: 'pendiente',
      activa: true,
      codigoExpiraEn: '2026-01-20T12:00:00.000Z',
      registeredAt: null,
      version: 1,
    });
  });

  it('isCodeUsable exige vínculo activo, pendiente y código vigente', () => {
    expect(makeLink().isCodeUsable(NOW)).toBe(true);
    expect(makeLink().isCodeUsable('2026-01-20T12:00:00.000Z')).toBe(false);
    expect(makeLink().isCodeUsable('2026-01-21T12:00:00.000Z')).toBe(false);
    expect(makeLink({ activa: false }).isCodeUsable(NOW)).toBe(false);
    expect(makeLink({ estadoRegistro: 'registrado' }).isCodeUsable(NOW)).toBe(false);
  });

  it('register marca el vínculo una sola vez', () => {
    const link = makeLink();
    link.register(NOW);
    expect(link.estadoRegistro).toBe('registrado');
    expect(link.registeredAt).toBe(NOW);
    expect(link.isCodeUsable(NOW)).toBe(false);
    expectValidation(() => link.register(NOW), 'El vínculo ya fue registrado.');
  });

  it('deactivate inhabilita el código sin borrar el vínculo', () => {
    const link = makeLink();
    link.deactivate();
    expect(link.activa).toBe(false);
    expect(link.alumnoId).toBe('alumno-1');
    expect(link.isCodeUsable(NOW)).toBe(false);
  });
});
