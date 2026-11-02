import { Decimal } from 'decimal.js';
import { InvalidStateTransitionError, ValidationDomainError } from '../shared/errors.js';
import type {
  Condition,
  ConditionId,
  CycleId,
  Decimal as DecimalString,
  EvaluationId,
  EvaluationType,
  GradeId,
  GradeStatus,
  LocalDate,
  PeriodCloseId,
  PeriodId,
  SubjectId,
  UserId,
} from '../shared/types.js';
import { decimalToString, parseGrade, parsePercentage, roundHalfUp } from '../shared/value-objects.js';

export interface PeriodoProps {
  id: PeriodId;
  cicloLectivoId: CycleId;
  nombre: string;
  tipo: 'trimestre' | 'cuatrimestre';
  fechaInicio: LocalDate;
  fechaFin: LocalDate;
  estado: 'abierto' | 'cerrado';
  version: number;
}

export class Periodo {
  private constructor(private props: PeriodoProps) {}
  static reconstitute(props: PeriodoProps): Periodo {
    return new Periodo(props);
  }
  get id(): PeriodId {
    return this.props.id;
  }
  get cicloLectivoId(): CycleId {
    return this.props.cicloLectivoId;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get tipo(): 'trimestre' | 'cuatrimestre' {
    return this.props.tipo;
  }
  get fechaInicio(): LocalDate {
    return this.props.fechaInicio;
  }
  get fechaFin(): LocalDate {
    return this.props.fechaFin;
  }
  get estado(): 'abierto' | 'cerrado' {
    return this.props.estado;
  }
  get version(): number {
    return this.props.version;
  }
  isOpen(): boolean {
    return this.props.estado === 'abierto';
  }
  close(): void {
    if (this.props.estado === 'cerrado') return;
    this.props.estado = 'cerrado';
  }
  assertOpen(): void {
    if (this.props.estado !== 'abierto') {
      throw new InvalidStateTransitionError('El período está cerrado.');
    }
  }
}

export interface InstanciaEvaluacionProps {
  id: EvaluationId;
  materiaId: SubjectId;
  periodoId: PeriodId;
  nombre: string;
  tipo: EvaluationType;
  peso: DecimalString;
  fecha: LocalDate;
  createdBy: UserId;
  version: number;
}

export class InstanciaEvaluacion {
  private constructor(private props: InstanciaEvaluacionProps) {}
  static reconstitute(props: InstanciaEvaluacionProps): InstanciaEvaluacion {
    return new InstanciaEvaluacion(props);
  }
  get id(): EvaluationId {
    return this.props.id;
  }
  get materiaId(): SubjectId {
    return this.props.materiaId;
  }
  get periodoId(): PeriodId {
    return this.props.periodoId;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get tipo(): EvaluationType {
    return this.props.tipo;
  }
  get peso(): DecimalString {
    return this.props.peso;
  }
  get fecha(): LocalDate {
    return this.props.fecha;
  }
  get createdBy(): UserId {
    return this.props.createdBy;
  }
  get version(): number {
    return this.props.version;
  }
  changeWeight(peso: DecimalString): void {
    const parsed = parsePercentage(peso, 'peso');
    if (new Decimal(parsed).lessThanOrEqualTo(0)) {
      throw new ValidationDomainError('El peso debe ser mayor a 0.');
    }
    this.props.peso = parsed;
  }
}

export interface CalificacionProps {
  id: GradeId;
  instanciaId: EvaluationId;
  alumnoId: UserId;
  valor: DecimalString;
  estado: GradeStatus;
  version: number;
  createdBy: UserId;
  updatedBy: UserId;
  rectificadaPor: UserId | null;
  rectificadaEn: string | null;
  motivoRectificacion: string | null;
  createdAt: string;
  updatedAt: string;
}

export class Calificacion {
  private constructor(private props: CalificacionProps) {}
  static reconstitute(props: CalificacionProps): Calificacion {
    return new Calificacion(props);
  }
  get id(): GradeId {
    return this.props.id;
  }
  get instanciaId(): EvaluationId {
    return this.props.instanciaId;
  }
  get alumnoId(): UserId {
    return this.props.alumnoId;
  }
  get valor(): DecimalString {
    return this.props.valor;
  }
  get estado(): GradeStatus {
    return this.props.estado;
  }
  get version(): number {
    return this.props.version;
  }
  get createdBy(): UserId {
    return this.props.createdBy;
  }
  get updatedBy(): UserId {
    return this.props.updatedBy;
  }
  get rectificadaPor(): UserId | null {
    return this.props.rectificadaPor;
  }
  get rectificadaEn(): string | null {
    return this.props.rectificadaEn;
  }
  get motivoRectificacion(): string | null {
    return this.props.motivoRectificacion;
  }
  get createdAt(): string {
    return this.props.createdAt;
  }
  get updatedAt(): string {
    return this.props.updatedAt;
  }

  changeValue(value: DecimalString, actor: UserId): void {
    if (this.props.estado === 'anulada') {
      throw new ValidationDomainError('Debe indicar un motivo para reemplazar una nota anulada.');
    }
    this.props.valor = parseGrade(value);
    this.props.updatedBy = actor;
  }

  replaceAnnulled(value: DecimalString, reason: string, actor: UserId): void {
    if (this.props.estado !== 'anulada') {
      throw new InvalidStateTransitionError('La nota no está anulada.');
    }
    if (!reason.trim()) {
      throw new ValidationDomainError('El motivo es obligatorio para reemplazar una nota anulada.');
    }
    this.props.valor = parseGrade(value);
    this.props.estado = 'activa';
    this.props.updatedBy = actor;
    this.props.motivoRectificacion = reason.trim().slice(0, 500);
  }

  rectify(value: DecimalString, reason: string, actor: UserId, at: string): void {
    if (!reason.trim()) {
      throw new ValidationDomainError('El motivo de rectificación es obligatorio.');
    }
    this.props.valor = parseGrade(value);
    this.props.estado = 'rectificada';
    this.props.rectificadaPor = actor;
    this.props.rectificadaEn = at;
    this.props.motivoRectificacion = reason.trim().slice(0, 500);
    this.props.updatedBy = actor;
  }

  annul(reason: string, actor: UserId): void {
    if (!reason.trim()) {
      throw new ValidationDomainError('El motivo de anulación es obligatorio.');
    }
    if (this.props.estado === 'anulada') {
      throw new InvalidStateTransitionError('La nota ya está anulada.');
    }
    this.props.estado = 'anulada';
    this.props.updatedBy = actor;
    this.props.motivoRectificacion = reason.trim().slice(0, 500);
  }
}

export interface ConditionRule {
  asistencia_minima_pct: number;
  nota_minima_regular: number;
  nota_minima_promocion: number;
  condicion_sin_datos: Condition;
}

export interface ReglaCondicionProps {
  id: string;
  periodoId: PeriodId;
  materiaId: SubjectId | null;
  nombre: string;
  config: ConditionRule;
  activa: boolean;
  version: number;
}

export class ReglaCondicion {
  private constructor(private props: ReglaCondicionProps) {}
  static reconstitute(props: ReglaCondicionProps): ReglaCondicion {
    return new ReglaCondicion(props);
  }
  get id(): string {
    return this.props.id;
  }
  get periodoId(): PeriodId {
    return this.props.periodoId;
  }
  get materiaId(): SubjectId | null {
    return this.props.materiaId;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get config(): ConditionRule {
    return this.props.config;
  }
  get activa(): boolean {
    return this.props.activa;
  }
  get version(): number {
    return this.props.version;
  }
}

export interface CondicionAlumnoProps {
  id: ConditionId;
  periodoId: PeriodId;
  alumnoId: UserId;
  materiaId: SubjectId;
  condicion: Condition;
  promedio: DecimalString | null;
  porcentajeAsistencia: DecimalString;
  detalle: Record<string, unknown>;
  calculadaEn: string;
  cierreId: PeriodCloseId;
  version: number;
}

export class CondicionAlumno {
  private constructor(private props: CondicionAlumnoProps) {}
  static reconstitute(props: CondicionAlumnoProps): CondicionAlumno {
    return new CondicionAlumno(props);
  }
  get id(): ConditionId {
    return this.props.id;
  }
  get periodoId(): PeriodId {
    return this.props.periodoId;
  }
  get alumnoId(): UserId {
    return this.props.alumnoId;
  }
  get materiaId(): SubjectId {
    return this.props.materiaId;
  }
  get condicion(): Condition {
    return this.props.condicion;
  }
  get promedio(): DecimalString | null {
    return this.props.promedio;
  }
  get porcentajeAsistencia(): DecimalString {
    return this.props.porcentajeAsistencia;
  }
  get detalle(): Record<string, unknown> {
    return this.props.detalle;
  }
  get calculadaEn(): string {
    return this.props.calculadaEn;
  }
  get cierreId(): PeriodCloseId {
    return this.props.cierreId;
  }
  get version(): number {
    return this.props.version;
  }
  toProps(): CondicionAlumnoProps {
    return { ...this.props };
  }
}

export interface PeriodoCierreProps {
  id: PeriodCloseId;
  periodoId: PeriodId;
  ejecutadoPor: UserId;
  ejecutadoEn: string;
  totalAlumnos: number;
  totalCondiciones: number;
  resumen: Record<string, unknown>;
}

export class PeriodoCierre {
  private constructor(private props: PeriodoCierreProps) {}
  static reconstitute(props: PeriodoCierreProps): PeriodoCierre {
    return new PeriodoCierre(props);
  }
  get id(): PeriodCloseId {
    return this.props.id;
  }
  get periodoId(): PeriodId {
    return this.props.periodoId;
  }
  get ejecutadoPor(): UserId {
    return this.props.ejecutadoPor;
  }
  get ejecutadoEn(): string {
    return this.props.ejecutadoEn;
  }
  get totalAlumnos(): number {
    return this.props.totalAlumnos;
  }
  get totalCondiciones(): number {
    return this.props.totalCondiciones;
  }
  get resumen(): Record<string, unknown> {
    return this.props.resumen;
  }
}

export interface ConditionGrade {
  value: DecimalString;
  weight: DecimalString;
  status: 'activa' | 'rectificada';
}

export interface ConditionInput {
  grades: ConditionGrade[];
  attendance: { present: number; late: number; justified: number; absent: number };
  taughtClasses: number;
  rule: ConditionRule;
}

export interface ConditionOutput {
  condition: Condition;
  average: DecimalString | null;
  attendancePercentage: DecimalString;
  detail: Record<string, unknown>;
}

export function calculateCondition(input: ConditionInput): ConditionOutput {
  const { grades, attendance, taughtClasses, rule } = input;
  const attended = attendance.present + attendance.late + attendance.justified;
  const percentage =
    taughtClasses > 0 ? roundHalfUp(new Decimal(attended).div(taughtClasses).mul(100), 2) : new Decimal(0);

  const totalWeight = grades.reduce((acc, grade) => acc.plus(new Decimal(grade.weight)), new Decimal(0));
  let average: Decimal | null = null;
  if (grades.length > 0 && totalWeight.greaterThan(0)) {
    const weighted = grades.reduce(
      (acc, grade) => acc.plus(new Decimal(grade.value).mul(new Decimal(grade.weight))),
      new Decimal(0),
    );
    average = roundHalfUp(weighted.div(totalWeight), 2);
  }

  const detail = {
    grades: grades.map((grade) => ({ ...grade })),
    attendance,
    taughtClasses,
    totalWeight: totalWeight.toFixed(2),
    rule,
  };

  if (taughtClasses === 0 || average === null) {
    return {
      condition: 'no_aplica',
      average: average === null ? null : decimalToString(average),
      attendancePercentage: decimalToString(percentage),
      detail,
    };
  }

  if (percentage.lessThan(rule.asistencia_minima_pct)) {
    return {
      condition: 'libre',
      average: decimalToString(average),
      attendancePercentage: decimalToString(percentage),
      detail,
    };
  }

  if (average.greaterThanOrEqualTo(rule.nota_minima_promocion)) {
    return {
      condition: 'promocionado',
      average: decimalToString(average),
      attendancePercentage: decimalToString(percentage),
      detail,
    };
  }

  if (average.greaterThanOrEqualTo(rule.nota_minima_regular)) {
    return {
      condition: 'regular',
      average: decimalToString(average),
      attendancePercentage: decimalToString(percentage),
      detail,
    };
  }

  return {
    condition: 'libre',
    average: decimalToString(average),
    attendancePercentage: decimalToString(percentage),
    detail,
  };
}
