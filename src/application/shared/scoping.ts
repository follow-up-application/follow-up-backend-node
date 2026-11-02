import type { AppContainer } from '../container.js';
import type { Actor } from '../../domain/shared/types.js';
import { ForbiddenError, NotFoundError } from '../../domain/shared/errors.js';
import type { CursoDivisionTurno, Materia } from '../../domain/academic/entities.js';

export async function allowedCourseIds(
  c: AppContainer,
  actor: Actor,
): Promise<number[] | null> {
  if (actor.role === 'administrador') return null;
  if (actor.role === 'preceptor') {
    const preceptor = await c.preceptores.findById(actor.id);
    if (!preceptor) throw new NotFoundError('Preceptor');
    return preceptor.courseIds;
  }
  if (actor.role === 'docente') {
    const materias = await c.materias.findByTeacher(actor.id);
    return [...new Set(materias.map((materia) => Number(materia.cursoDivisionTurnoId)))];
  }
  if (actor.role === 'alumno') {
    const alumno = await c.alumnos.findById(actor.id);
    if (!alumno) throw new NotFoundError('Alumno');
    return [Number(alumno.cursoDivisionTurnoId)];
  }
  if (actor.role === 'tutor') {
    const links = await c.tutorAlumno.findByTutor(actor.id);
    const courses = new Set<number>();
    for (const link of links) {
      const alumno = await c.alumnos.findById(link.alumnoId);
      if (alumno) courses.add(Number(alumno.cursoDivisionTurnoId));
    }
    return [...courses];
  }
  throw new ForbiddenError();
}

export async function assertCourseAccess(
  c: AppContainer,
  actor: Actor,
  courseId: number,
): Promise<CursoDivisionTurno> {
  const curso = await c.cursos.findById(courseId);
  if (!curso) throw new NotFoundError('Curso');
  if (actor.role === 'administrador') return curso;
  const allowed = await allowedCourseIds(c, actor);
  if (allowed && !allowed.includes(Number(curso.id))) throw new NotFoundError('Curso');
  return curso;
}

export async function assertMateriaAccess(
  c: AppContainer,
  actor: Actor,
  materiaId: number,
): Promise<Materia> {
  const materia = await c.materias.findById(materiaId);
  if (!materia) throw new NotFoundError('Materia');
  if (actor.role === 'administrador') return materia;
  if (actor.role === 'docente' && materia.docenteId === actor.id) return materia;
  const allowed = await allowedCourseIds(c, actor);
  if (allowed && allowed.includes(Number(materia.cursoDivisionTurnoId))) return materia;
  throw new NotFoundError('Materia');
}

export async function assertTeacherOfMateria(
  c: AppContainer,
  actor: Actor,
  materiaId: number,
): Promise<Materia> {
  const materia = await c.materias.findById(materiaId);
  if (!materia) throw new NotFoundError('Materia');
  if (actor.role === 'administrador') return materia;
  if (actor.role === 'docente' && materia.docenteId === actor.id) return materia;
  throw new NotFoundError('Materia');
}

export async function assertAlumnoAccess(
  c: AppContainer,
  actor: Actor,
  alumnoId: string,
) {
  const alumno = await c.alumnos.findById(alumnoId);
  if (!alumno) throw new NotFoundError('Alumno');
  if (actor.role === 'administrador' || actor.id === alumnoId) return alumno;
  if (actor.role === 'tutor') {
    const links = await c.tutorAlumno.findByTutor(actor.id);
    if (links.some((link) => link.alumnoId === alumnoId)) return alumno;
  }
  const allowed = await allowedCourseIds(c, actor);
  if (allowed && allowed.includes(Number(alumno.cursoDivisionTurnoId))) return alumno;
  throw new NotFoundError('Alumno');
}

export async function assertCanManageMateria(
  c: AppContainer,
  actor: Actor,
  materiaId: number,
): Promise<Materia> {
  const materia = await c.materias.findById(materiaId);
  if (!materia) throw new NotFoundError('Materia');
  if (actor.role === 'administrador') return materia;
  if (actor.role === 'docente' && materia.docenteId === actor.id) return materia;
  if (actor.role === 'preceptor') {
    const preceptor = await c.preceptores.findById(actor.id);
    if (preceptor?.courseIds.includes(Number(materia.cursoDivisionTurnoId))) return materia;
  }
  throw new NotFoundError('Materia');
}

export async function linkedAlumnoIds(c: AppContainer, tutorId: string): Promise<string[]> {
  const links = await c.tutorAlumno.findByTutor(tutorId);
  return links.map((link) => link.alumnoId);
}
