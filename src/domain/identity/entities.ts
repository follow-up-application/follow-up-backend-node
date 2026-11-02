import { ValidationDomainError } from '../shared/errors.js';
import type { CourseId, LocalDate, UserId, UserRole } from '../shared/types.js';
import {
  normalizeEmail,
  parseLocalDate,
  validateDni,
  validateUsername,
} from '../shared/value-objects.js';

export interface UserProps {
  id: UserId;
  firstName: string;
  lastName: string;
  dni: number | null;
  username: string | null;
  email: string | null;
  passwordHash: string | null;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class User {
  private constructor(private props: UserProps) {}

  static reconstitute(props: UserProps): User {
    return new User({ ...props });
  }

  get id(): UserId {
    return this.props.id;
  }
  get firstName(): string {
    return this.props.firstName;
  }
  get lastName(): string {
    return this.props.lastName;
  }
  get dni(): number | null {
    return this.props.dni;
  }
  get username(): string | null {
    return this.props.username;
  }
  get email(): string | null {
    return this.props.email;
  }
  get passwordHash(): string | null {
    return this.props.passwordHash;
  }
  get role(): UserRole {
    return this.props.role;
  }
  get mustChangePassword(): boolean {
    return this.props.mustChangePassword;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }
  get lastLoginAt(): string | null {
    return this.props.lastLoginAt;
  }
  get createdAt(): string {
    return this.props.createdAt;
  }
  get updatedAt(): string {
    return this.props.updatedAt;
  }
  get version(): number {
    return this.props.version;
  }

  toProps(): UserProps {
    return { ...this.props };
  }

  rename(firstName: string, lastName: string): void {
    if (!firstName.trim() || !lastName.trim()) {
      throw new ValidationDomainError('Nombre y apellido son obligatorios.');
    }
    this.props.firstName = firstName.trim().slice(0, 100);
    this.props.lastName = lastName.trim().slice(0, 100);
  }

  changeDni(dni: number | null): void {
    this.props.dni = dni === null ? null : validateDni(dni);
  }

  changeUsername(username: string | null): void {
    this.props.username = username === null ? null : validateUsername(username);
  }

  changeEmail(email: string | null): void {
    this.props.email = email === null ? null : normalizeEmail(email);
  }

  changePassword(hash: string, mustChangePassword: boolean): void {
    this.props.passwordHash = hash;
    this.props.mustChangePassword = mustChangePassword;
  }

  recordLogin(instant: string): void {
    this.props.lastLoginAt = instant;
  }

  activate(): void {
    this.props.isActive = true;
  }

  deactivate(): void {
    this.props.isActive = false;
  }

  hasRole(role: UserRole): boolean {
    return this.props.role === role;
  }

  canAuthenticate(): boolean {
    return this.props.isActive && this.props.username !== null && this.props.passwordHash !== null;
  }
}

export interface AlumnoProps {
  user: User;
  fechaNacimiento: LocalDate;
  cursoDivisionTurnoId: CourseId;
  version: number;
}

export class Alumno {
  private constructor(private props: AlumnoProps) {}

  static reconstitute(props: AlumnoProps): Alumno {
    return new Alumno(props);
  }

  get id(): UserId {
    return this.props.user.id;
  }
  get user(): User {
    return this.props.user;
  }
  get fechaNacimiento(): LocalDate {
    return this.props.fechaNacimiento;
  }
  get cursoDivisionTurnoId(): CourseId {
    return this.props.cursoDivisionTurnoId;
  }
  get version(): number {
    return this.props.version;
  }

  changeBirthDate(date: LocalDate): void {
    this.props.fechaNacimiento = parseLocalDate(date);
  }

  changeCourse(courseId: CourseId): void {
    this.props.cursoDivisionTurnoId = courseId;
  }

  belongsToCourse(courseId: CourseId): boolean {
    return this.props.cursoDivisionTurnoId === courseId;
  }
}

export interface DocenteProps {
  user: User;
  telephone: string;
  fechaIngreso: LocalDate;
  cursoDivisionTurnoId: CourseId | null;
  version: number;
}

export class Docente {
  private constructor(private props: DocenteProps) {}

  static reconstitute(props: DocenteProps): Docente {
    return new Docente(props);
  }

  get id(): UserId {
    return this.props.user.id;
  }
  get user(): User {
    return this.props.user;
  }
  get telephone(): string {
    return this.props.telephone;
  }
  get fechaIngreso(): LocalDate {
    return this.props.fechaIngreso;
  }
  get cursoDivisionTurnoId(): CourseId | null {
    return this.props.cursoDivisionTurnoId;
  }
  get version(): number {
    return this.props.version;
  }

  changePhone(phone: string): void {
    if (!phone.trim()) throw new ValidationDomainError('El teléfono es obligatorio.');
    this.props.telephone = phone.trim().slice(0, 20);
  }

  changeHireDate(date: LocalDate): void {
    this.props.fechaIngreso = parseLocalDate(date);
  }

  changeReferenceCourse(courseId: CourseId | null): void {
    this.props.cursoDivisionTurnoId = courseId;
  }
}

export interface TutorProps {
  user: User;
  telephone: string;
  version: number;
}

export class Tutor {
  private constructor(private props: TutorProps) {}

  static reconstitute(props: TutorProps): Tutor {
    return new Tutor(props);
  }

  get id(): UserId {
    return this.props.user.id;
  }
  get user(): User {
    return this.props.user;
  }
  get telephone(): string {
    return this.props.telephone;
  }
  get version(): number {
    return this.props.version;
  }

  changePhone(phone: string): void {
    if (!phone.trim()) throw new ValidationDomainError('El teléfono es obligatorio.');
    this.props.telephone = phone.trim().slice(0, 20);
  }
}

export interface PreceptorProps {
  user: User;
  telephone: string | null;
  employeeCode: string | null;
  courseIds: CourseId[];
  version: number;
}

export class Preceptor {
  private constructor(private props: PreceptorProps) {}

  static reconstitute(props: PreceptorProps): Preceptor {
    return new Preceptor({ ...props, courseIds: [...props.courseIds] });
  }

  get id(): UserId {
    return this.props.user.id;
  }
  get user(): User {
    return this.props.user;
  }
  get telephone(): string | null {
    return this.props.telephone;
  }
  get employeeCode(): string | null {
    return this.props.employeeCode;
  }
  get courseIds(): CourseId[] {
    return [...this.props.courseIds];
  }
  get version(): number {
    return this.props.version;
  }

  canOperate(): boolean {
    return this.props.courseIds.length > 0;
  }
}

export type Relationship = 'padre' | 'madre' | 'otra';

export interface TutorAlumnoProps {
  id: string;
  alumnoId: UserId;
  tutorId: UserId;
  relationship: Relationship;
  otraRelacion: string | null;
  codigoInstitucional: string;
  estadoRegistro: 'pendiente' | 'registrado';
  activa: boolean;
  codigoExpiraEn: string;
  registeredAt: string | null;
  version: number;
}

export class TutorAlumno {
  private constructor(private props: TutorAlumnoProps) {}

  static reconstitute(props: TutorAlumnoProps): TutorAlumno {
    return new TutorAlumno(props);
  }

  get id(): string {
    return this.props.id;
  }
  get alumnoId(): UserId {
    return this.props.alumnoId;
  }
  get tutorId(): UserId {
    return this.props.tutorId;
  }
  get relationship(): Relationship {
    return this.props.relationship;
  }
  get otraRelacion(): string | null {
    return this.props.otraRelacion;
  }
  get codigoInstitucional(): string {
    return this.props.codigoInstitucional;
  }
  get estadoRegistro(): 'pendiente' | 'registrado' {
    return this.props.estadoRegistro;
  }
  get activa(): boolean {
    return this.props.activa;
  }
  get codigoExpiraEn(): string {
    return this.props.codigoExpiraEn;
  }
  get registeredAt(): string | null {
    return this.props.registeredAt;
  }
  get version(): number {
    return this.props.version;
  }

  isCodeUsable(now: string): boolean {
    return (
      this.props.activa &&
      this.props.estadoRegistro === 'pendiente' &&
      this.props.codigoExpiraEn > now
    );
  }

  register(at: string): void {
    if (this.props.estadoRegistro === 'registrado') {
      throw new ValidationDomainError('El vínculo ya fue registrado.');
    }
    this.props.estadoRegistro = 'registrado';
    this.props.registeredAt = at;
  }

  deactivate(): void {
    this.props.activa = false;
  }
}
