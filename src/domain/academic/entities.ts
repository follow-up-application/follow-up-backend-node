import { InvalidStateTransitionError, ValidationDomainError } from '../shared/errors.js';
import type {
  ClassId,
  CourseId,
  CycleId,
  EnrollmentId,
  EnrollmentStatus,
  InstitutionId,
  LocalDate,
  LocalTime,
  SubjectId,
  UserId,
} from '../shared/types.js';
import { displayCourse, parseLocalDate, parseLocalTime, timeToMinutes } from '../shared/value-objects.js';

export interface InstitucionProps {
  id: InstitutionId;
  nombre: string;
  cue: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  activa: boolean;
  version: number;
}

export class Institucion {
  private constructor(private props: InstitucionProps) {}
  static reconstitute(props: InstitucionProps): Institucion {
    return new Institucion(props);
  }
  get id(): InstitutionId {
    return this.props.id;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get cue(): string | null {
    return this.props.cue;
  }
  get direccion(): string | null {
    return this.props.direccion;
  }
  get telefono(): string | null {
    return this.props.telefono;
  }
  get email(): string | null {
    return this.props.email;
  }
  get activa(): boolean {
    return this.props.activa;
  }
  get version(): number {
    return this.props.version;
  }
  deactivate(): void {
    this.props.activa = false;
  }
  activate(): void {
    this.props.activa = true;
  }
}

export interface CicloLectivoProps {
  id: CycleId;
  institucionId: InstitutionId;
  anio: number;
  fechaInicio: LocalDate;
  fechaFin: LocalDate;
  estado: 'planificado' | 'activo' | 'cerrado';
  version: number;
}

export class CicloLectivo {
  private constructor(private props: CicloLectivoProps) {}
  static reconstitute(props: CicloLectivoProps): CicloLectivo {
    return new CicloLectivo(props);
  }
  get id(): CycleId {
    return this.props.id;
  }
  get institucionId(): InstitutionId {
    return this.props.institucionId;
  }
  get anio(): number {
    return this.props.anio;
  }
  get fechaInicio(): LocalDate {
    return this.props.fechaInicio;
  }
  get fechaFin(): LocalDate {
    return this.props.fechaFin;
  }
  get estado(): 'planificado' | 'activo' | 'cerrado' {
    return this.props.estado;
  }
  get version(): number {
    return this.props.version;
  }
  isClosed(): boolean {
    return this.props.estado === 'cerrado';
  }
  contains(date: LocalDate): boolean {
    return date >= this.props.fechaInicio && date <= this.props.fechaFin;
  }
  activate(): void {
    if (this.props.estado === 'cerrado') {
      throw new InvalidStateTransitionError('No se puede activar un ciclo cerrado.');
    }
    this.props.estado = 'activo';
  }
  close(): void {
    if (this.props.estado === 'cerrado') return;
    this.props.estado = 'cerrado';
  }
}

export interface CursoDivisionTurnoProps {
  id: CourseId;
  cicloLectivoId: CycleId;
  curso: number;
  division: string;
  turno: 'Mañana' | 'Tarde';
  capacidadMaxima: number;
  version: number;
}

export class CursoDivisionTurno {
  private constructor(private props: CursoDivisionTurnoProps) {}
  static reconstitute(props: CursoDivisionTurnoProps): CursoDivisionTurno {
    return new CursoDivisionTurno({ ...props, division: props.division.trim() });
  }
  get id(): CourseId {
    return this.props.id;
  }
  get cicloLectivoId(): CycleId {
    return this.props.cicloLectivoId;
  }
  get curso(): number {
    return this.props.curso;
  }
  get division(): string {
    return this.props.division;
  }
  get turno(): 'Mañana' | 'Tarde' {
    return this.props.turno;
  }
  get capacidadMaxima(): number {
    return this.props.capacidadMaxima;
  }
  get version(): number {
    return this.props.version;
  }
  displayName(): string {
    return displayCourse(this.props.curso, this.props.division, this.props.turno);
  }
  changeCapacity(capacity: number, currentStudents: number): void {
    if (capacity < currentStudents) {
      throw new ValidationDomainError('La capacidad no puede ser menor a la cantidad de alumnos.');
    }
    this.props.capacidadMaxima = capacity;
  }
}

export interface MateriaProps {
  id: SubjectId;
  nombre: string;
  descripcion: string;
  cursoDivisionTurnoId: CourseId;
  docenteId: UserId;
  version: number;
}

export class Materia {
  private constructor(private props: MateriaProps) {}
  static reconstitute(props: MateriaProps): Materia {
    return new Materia(props);
  }
  get id(): SubjectId {
    return this.props.id;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get descripcion(): string {
    return this.props.descripcion;
  }
  get cursoDivisionTurnoId(): CourseId {
    return this.props.cursoDivisionTurnoId;
  }
  get docenteId(): UserId {
    return this.props.docenteId;
  }
  get version(): number {
    return this.props.version;
  }
  rename(nombre: string): void {
    if (!nombre.trim()) throw new ValidationDomainError('El nombre es obligatorio.');
    this.props.nombre = nombre.trim().slice(0, 150);
  }
  changeDescription(descripcion: string): void {
    if (!descripcion.trim()) throw new ValidationDomainError('La descripción es obligatoria.');
    this.props.descripcion = descripcion.trim().slice(0, 1000);
  }
  assignTeacher(docenteId: UserId): void {
    this.props.docenteId = docenteId;
  }
  changeCourse(courseId: CourseId): void {
    this.props.cursoDivisionTurnoId = courseId;
  }
}

export interface InscripcionProps {
  id: EnrollmentId;
  alumnoId: UserId;
  materiaId: SubjectId;
  fechaInscripcion: LocalDate;
  estado: EnrollmentStatus;
  version: number;
}

export class Inscripcion {
  private constructor(private props: InscripcionProps) {}
  static reconstitute(props: InscripcionProps): Inscripcion {
    return new Inscripcion(props);
  }
  get id(): EnrollmentId {
    return this.props.id;
  }
  get alumnoId(): UserId {
    return this.props.alumnoId;
  }
  get materiaId(): SubjectId {
    return this.props.materiaId;
  }
  get fechaInscripcion(): LocalDate {
    return this.props.fechaInscripcion;
  }
  get estado(): EnrollmentStatus {
    return this.props.estado;
  }
  get version(): number {
    return this.props.version;
  }
  approve(): void {
    if (this.props.estado !== 'pendiente') {
      throw new InvalidStateTransitionError('Solo una inscripción pendiente puede aprobarse.');
    }
    this.props.estado = 'aprobado';
  }
  reject(): void {
    if (this.props.estado !== 'pendiente') {
      throw new InvalidStateTransitionError('Solo una inscripción pendiente puede rechazarse.');
    }
    this.props.estado = 'rechazado';
  }
  cancel(): void {
    if (this.props.estado === 'rechazado') {
      throw new InvalidStateTransitionError('Una inscripción rechazada no puede cancelarse.');
    }
    if (this.props.estado === 'cancelado') return;
    this.props.estado = 'cancelado';
  }
}

export interface ClaseProps {
  id: ClassId;
  materiaId: SubjectId;
  fecha: LocalDate;
  horaInicio: LocalTime;
  horaFin: LocalTime;
  tema: string;
  estado: 'programada' | 'dictada' | 'cancelada';
  createdBy: UserId;
  version: number;
}

export class Clase {
  private constructor(private props: ClaseProps) {}
  static reconstitute(props: ClaseProps): Clase {
    const clase = new Clase(props);
    clase.validateSchedule();
    return clase;
  }
  private validateSchedule(): void {
    parseLocalDate(this.props.fecha);
    parseLocalTime(this.props.horaInicio, 'hora_inicio');
    parseLocalTime(this.props.horaFin, 'hora_fin');
    const start = timeToMinutes(this.props.horaInicio);
    const end = timeToMinutes(this.props.horaFin);
    if (end <= start) {
      throw new ValidationDomainError('La hora de fin debe ser posterior a la de inicio.');
    }
    if (end - start > 8 * 60) {
      throw new ValidationDomainError('La duración de la clase no puede superar 8 horas.');
    }
  }
  get id(): ClassId {
    return this.props.id;
  }
  get materiaId(): SubjectId {
    return this.props.materiaId;
  }
  get fecha(): LocalDate {
    return this.props.fecha;
  }
  get horaInicio(): LocalTime {
    return this.props.horaInicio;
  }
  get horaFin(): LocalTime {
    return this.props.horaFin;
  }
  get tema(): string {
    return this.props.tema;
  }
  get estado(): 'programada' | 'dictada' | 'cancelada' {
    return this.props.estado;
  }
  get createdBy(): UserId {
    return this.props.createdBy;
  }
  get version(): number {
    return this.props.version;
  }
  changeTopic(tema: string): void {
    if (!tema.trim()) throw new ValidationDomainError('El tema es obligatorio.');
    this.props.tema = tema.trim().slice(0, 500);
  }
  updateSchedule(fecha: LocalDate, horaInicio: LocalTime, horaFin: LocalTime): void {
    this.props.fecha = fecha;
    this.props.horaInicio = horaInicio;
    this.props.horaFin = horaFin;
    this.validateSchedule();
  }
  markTaught(): void {
    if (this.props.estado === 'cancelada') {
      throw new InvalidStateTransitionError('Una clase cancelada no puede marcarse como dictada.');
    }
    this.props.estado = 'dictada';
  }
  cancel(): void {
    if (this.props.estado === 'dictada') {
      throw new InvalidStateTransitionError('Una clase dictada no puede cancelarse.');
    }
    this.props.estado = 'cancelada';
  }
  canRegisterAttendance(): boolean {
    return this.props.estado === 'dictada';
  }
}
