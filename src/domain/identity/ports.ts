import type { UserRole, Tx } from '../shared/types.js';
import type {
  Alumno,
  Docente,
  Preceptor,
  Tutor,
  TutorAlumno,
  User,
} from './entities.js';

export interface UserRepository {
  findById(id: string, tx?: Tx): Promise<User | null>;
  findByUsername(username: string, tx?: Tx): Promise<User | null>;
  findByEmail(email: string, tx?: Tx): Promise<User | null>;
  findByDni(dni: number, tx?: Tx): Promise<User | null>;
  findByDnis(dnis: number[], tx?: Tx): Promise<User[]>;
  save(user: User, tx?: Tx): Promise<void>;
  setActive(id: string, active: boolean, tx?: Tx): Promise<void>;
  countActiveAdmins(tx?: Tx): Promise<number>;
  countByRole(role: UserRole, tx?: Tx): Promise<number>;
  list(filter: { role?: UserRole; active?: boolean; limit: number; offset: number }, tx?: Tx): Promise<User[]>;
}

export interface AlumnoRepository {
  findById(id: string, tx?: Tx): Promise<Alumno | null>;
  list(
    filter: {
      courseId?: number;
      teacherId?: string;
      tutorId?: string;
      preceptorId?: string;
      limit: number;
      offset: number;
    },
    tx?: Tx,
  ): Promise<Alumno[]>;
  save(alumno: Alumno, tx?: Tx): Promise<void>;
  countByCourse(courseId: number, tx?: Tx): Promise<number>;
}

export interface DocenteRepository {
  findById(id: string, tx?: Tx): Promise<Docente | null>;
  list(filter: { courseId?: number; limit: number; offset: number }, tx?: Tx): Promise<Docente[]>;
  save(docente: Docente, tx?: Tx): Promise<void>;
}

export interface TutorRepository {
  findById(id: string, tx?: Tx): Promise<Tutor | null>;
  findByDni(dni: number, tx?: Tx): Promise<Tutor | null>;
  findByDnis(dnis: number[], tx?: Tx): Promise<Tutor[]>;
  list(filter: { limit: number; offset: number }, tx?: Tx): Promise<Tutor[]>;
  save(tutor: Tutor, tx?: Tx): Promise<void>;
}

export interface PreceptorRepository {
  findById(id: string, tx?: Tx): Promise<Preceptor | null>;
  list(filter: { courseId?: number; limit: number; offset: number }, tx?: Tx): Promise<Preceptor[]>;
  save(preceptor: Preceptor, tx?: Tx): Promise<void>;
  replaceCourses(preceptorId: string, courseIds: number[], tx?: Tx): Promise<void>;
}

export interface TutorAlumnoRepository {
  findById(id: string, tx?: Tx): Promise<TutorAlumno | null>;
  findByCode(code: string, tx?: Tx): Promise<TutorAlumno | null>;
  findByAlumno(alumnoId: string, onlyActive?: boolean, tx?: Tx): Promise<TutorAlumno[]>;
  findByAlumnos(alumnoIds: string[], onlyActive?: boolean, tx?: Tx): Promise<TutorAlumno[]>;
  findByTutor(tutorId: string, onlyActive?: boolean, tx?: Tx): Promise<TutorAlumno[]>;
  findLink(alumnoId: string, tutorId: string, tx?: Tx): Promise<TutorAlumno | null>;
  save(link: TutorAlumno, tx?: Tx): Promise<void>;
}

export interface RefreshToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  replacedById: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
}

export interface RefreshTokenRepository {
  create(token: RefreshToken, tx?: Tx): Promise<void>;
  findByHash(hash: string, tx?: Tx): Promise<RefreshToken | null>;
  revoke(id: string, replacedBy: string | null, at: string, tx?: Tx): Promise<void>;
  revokeFamily(familyId: string, at: string, tx?: Tx): Promise<void>;
  revokeAllForUser(userId: string, at: string, tx?: Tx): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
  jti: string;
  password_change_only: boolean;
}

export interface TokenService {
  issueAccess(input: {
    userId: string;
    role: UserRole;
    passwordChangeOnly: boolean;
  }): Promise<{ token: string; expiresIn: number }>;
  verifyAccess(token: string): Promise<AccessTokenClaims>;
  generateRefresh(): { rawToken: string; tokenHash: string; familyId: string };
  hashRefresh(rawToken: string): string;
}
