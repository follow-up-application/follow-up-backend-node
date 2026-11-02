import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import type { AppContainer } from '../../application/container.js';
import type { AcademicService } from '../../application/academic-service.js';
import type { AttendanceService } from '../../application/attendance-service.js';
import type { AuditService } from '../../application/audit-service.js';
import type { AuthService } from '../../application/auth-service.js';
import type { GradingService } from '../../application/grading-service.js';
import type { IdentityService } from '../../application/identity-service.js';
import type { ImportsService } from '../../application/imports-service.js';
import { requireRole } from '../../application/shared/context.js';
import { env } from '../../config/env.js';
import {
  ImportInvalidFileError,
  PayloadTooLargeError,
} from '../../domain/shared/errors.js';
import {
  authenticate,
  asyncHandler,
  getActor,
  getContext,
  idempotency,
  rateLimiter,
  sha256,
} from './middleware.js';
import {
  presentAlumno,
  presentAsistencia,
  presentAuditoria,
  presentCalificacion,
  presentCierre,
  presentClase,
  presentCondicion,
  presentCurso,
  presentDocente,
  presentImportJob,
  presentInscripcion,
  presentInstancia,
  presentMateria,
  presentPeriodo,
  presentPreceptor,
  presentTutor,
  presentUser,
} from './presenters.js';
import {
  adminCreateSchema,
  adminUpdateSchema,
  alumnoCondicionQuery,
  alumnoCreateSchema,
  alumnoUpdateSchema,
  asistenciasQuery,
  asistenciaCreateSchema,
  asistenciaJustifySchema,
  asistenciaUpdateSchema,
  auditoriaQuery,
  calificacionAnnulSchema,
  calificacionCreateSchema,
  calificacionesQuery,
  calificacionRectifySchema,
  calificacionUpdateSchema,
  clasesQuery,
  claseCreateSchema,
  claseUpdateSchema,
  codeParam,
  condicionesPeriodoQuery,
  cursoCreateSchema,
  cursosQuery,
  cursoUpdateSchema,
  dniParam,
  docenteCreateSchema,
  docenteUpdateSchema,
  errorsQuery,
  idParam,
  inscripcionesQuery,
  inscripcionCreateSchema,
  inscripcionEstadoSchema,
  instanciaCreateSchema,
  instanciasQuery,
  instanciaUpdateSchema,
  intIdParam,
  loginSchema,
  logoutSchema,
  materiaCreateSchema,
  materiasQuery,
  materiaUpdateSchema,
  paginationQuery,
  paginationWithCourseQuery,
  passwordSchema,
  periodoCreateSchema,
  periodosQuery,
  periodoUpdateSchema,
  preceptorCoursesSchema,
  preceptorCreateSchema,
  preceptorUpdateSchema,
  refreshSchema,
  tutorCreateSchema,
  tutorRegisterSchema,
  tutorUpdateSchema,
  userStateSchema,
  usersQuery,
} from './schemas.js';

export interface HttpServices {
  auth: AuthService;
  identity: IdentityService;
  academic: AcademicService;
  attendance: AttendanceService;
  grading: GradingService;
  imports: ImportsService;
  audit: AuditService;
}

function meta(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

function paginated<T>(data: T[], limit: number, offset: number) {
  return { data, meta: { limit, offset, total: offset + data.length } };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env().IMPORT_MAX_FILE_BYTES, files: 1 },
});

const csvUpload: RequestHandler = (req, res, next) => {
  const contentType = String(req.headers['content-type'] ?? '');
  const finish = (buffer: Buffer, fileName: string) => {
    if (buffer.byteLength === 0) {
      next(new ImportInvalidFileError('El archivo CSV está vacío.'));
      return;
    }
    res.locals.csvBuffer = buffer;
    res.locals.csvFileName = fileName;
    res.locals.csvHash = createHash('sha256').update(buffer).digest('hex');
    next();
  };
  if (contentType.includes('multipart/form-data')) {
    upload.single('file')(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new PayloadTooLargeError());
        return;
      }
      if (error) {
        next(error);
        return;
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        next(new ImportInvalidFileError('Debe enviar un archivo en el campo file.'));
        return;
      }
      finish(file.buffer, file.originalname || 'alumnos.csv');
    });
    return;
  }
  if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    express.raw({ type: () => true, limit: env().IMPORT_MAX_FILE_BYTES })(req, res, (error: unknown) => {
      if (error) {
        next(error);
        return;
      }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      finish(buffer, 'alumnos.csv');
    });
    return;
  }
  next(new ImportInvalidFileError('Content-Type debe ser text/csv o multipart/form-data.'));
};

export function buildPublicRouter(c: AppContainer, services: HttpServices): Router {
  const router = Router();
  const loginLimiter = rateLimiter(env().LOGIN_RATE_LIMIT_MAX);
  const publicLimiter = rateLimiter(env().RATE_LIMIT_MAX);

  router.post(
    ['/auth/login', '/login'],
    loginLimiter,
    asyncHandler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      res.json(await services.auth.login(input, meta(req)));
    }),
  );

  router.post(
    '/auth/refresh',
    asyncHandler(async (req, res) => {
      const input = refreshSchema.parse(req.body);
      res.json(await services.auth.refresh(input.refresh_token, meta(req)));
    }),
  );

  router.get(
    '/tutores/validarCodigo/:codigo',
    publicLimiter,
    asyncHandler(async (req, res) => {
      const { codigo } = codeParam.parse(req.params);
      res.json(await services.identity.validateTutorCode(codigo));
    }),
  );

  router.post(
    '/tutores/register',
    publicLimiter,
    idempotency(c, {
      publicScope: (req) =>
        `public:tutor-code:${sha256(String((req.body as Record<string, unknown> | undefined)?.codigo ?? ''))}`,
    }),
    asyncHandler(async (req, res) => {
      const input = tutorRegisterSchema.parse(req.body);
      const tutor = await services.identity.registerTutor(input);
      res.status(201).json(presentTutor(tutor));
    }),
  );

  return router;
}

export function buildProtectedRouter(c: AppContainer, services: HttpServices): Router {
  const router = Router();
  router.use(authenticate(c));

  router.post(
    ['/auth/logout', '/logout'],
    asyncHandler(async (req, res) => {
      const actor = getActor(res);
      const input = logoutSchema.parse(req.body ?? {});
      await services.auth.logout(actor, input.refresh_token);
      res.status(204).send();
    }),
  );

  router.get(
    '/me',
    asyncHandler(async (_req, res) => {
      const result = await services.auth.me(getActor(res));
      res.json({
        user: presentUser(result.user as Parameters<typeof presentUser>[0]),
        perfiles: result.perfiles,
        cursos: result.cursos,
      });
    }),
  );

  router.put(
    '/password',
    asyncHandler(async (req, res) => {
      const actor = getActor(res);
      const input = passwordSchema.parse(req.body);
      res.json(await services.auth.changePassword(actor, input, meta(req)));
    }),
  );

  router.get(
    '/users',
    asyncHandler(async (req, res) => {
      const actor = getActor(res);
      requireRole(actor, 'administrador');
      const q = usersQuery.parse(req.query);
      const list = await services.identity.listUsers({
        role: q.role,
        active: q.active,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentUser), q.limit, q.offset));
    }),
  );

  router.patch(
    '/users/:id/estado',
    asyncHandler(async (req, res) => {
      const actor = getActor(res);
      requireRole(actor, 'administrador');
      const { id } = idParam.parse(req.params);
      const input = userStateSchema.parse(req.body);
      const user = await services.identity.setUserActive(
        id,
        input.is_active,
        input.motivo,
        getContext(c, req, res),
      );
      res.json(presentUser(user));
    }),
  );

  router.post(
    '/admins',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = adminCreateSchema.parse(req.body);
      const user = await services.identity.createAdmin(input, getContext(c, req, res));
      res.status(201).json(presentUser(user));
    }),
  );

  router.get(
    '/admins',
    asyncHandler(async (req, res) => {
      requireRole(getActor(res), 'administrador');
      const q = paginationQuery.parse(req.query);
      const list = await services.identity.listAdmins(q.limit, q.offset);
      res.json(list.map(presentUser));
    }),
  );

  router.get(
    '/admins/estadisticas',
    asyncHandler(async (_req, res) => {
      requireRole(getActor(res), 'administrador');
      res.json(await services.identity.adminStats());
    }),
  );

  router.get(
    '/admins/:id',
    asyncHandler(async (req, res) => {
      requireRole(getActor(res), 'administrador');
      const { id } = idParam.parse(req.params);
      res.json(presentUser(await services.identity.getAdmin(id)));
    }),
  );

  router.put(
    '/admins/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = adminUpdateSchema.parse(req.body);
      res.json(presentUser(await services.identity.updateAdmin(id, input, getContext(c, req, res))));
    }),
  );

  router.delete(
    '/admins/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const motivo = typeof body.motivo === 'string' ? body.motivo : undefined;
      await services.identity.deactivateAdmin(id, getContext(c, req, res), motivo);
      res.status(204).send();
    }),
  );

  router.get(
    '/alumnos',
    asyncHandler(async (req, res) => {
      const actor = getActor(res);
      const q = paginationWithCourseQuery.parse(req.query);
      const list = await services.identity.listAlumnos(actor, {
        courseId: q.curso_division_turno_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(await Promise.all(list.map((alumno) => presentAlumno(c, alumno))));
    }),
  );

  router.post(
    '/alumnos',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = alumnoCreateSchema.parse(req.body);
      const alumno = await services.identity.createAlumno(input, getContext(c, req, res));
      res.status(201).json(await presentAlumno(c, alumno));
    }),
  );

  router.get(
    '/alumnos/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(await presentAlumno(c, await services.identity.getAlumno(getActor(res), id)));
    }),
  );

  router.put(
    '/alumnos/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = alumnoUpdateSchema.parse(req.body);
      const alumno = await services.identity.updateAlumno(id, input, getContext(c, req, res));
      res.json(await presentAlumno(c, alumno));
    }),
  );

  router.delete(
    '/alumnos/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const motivo = typeof body.motivo === 'string' ? body.motivo : undefined;
      await services.identity.deleteAlumno(id, getContext(c, req, res), motivo);
      res.status(204).send();
    }),
  );

  router.get(
    '/alumnos/:id/inscripciones',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const q = inscripcionesQuery.parse(req.query);
      const list = await services.academic.listInscripciones(getActor(res), {
        alumnoId: id,
        materiaId: q.materia_id,
        limit: q.limit,
        offset: q.offset,
      });
      const filtered = q.estado ? list.filter((item) => item.estado === q.estado) : list;
      res.json(filtered.map(presentInscripcion));
    }),
  );

  router.get(
    '/alumnos/:id/condicion',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const q = alumnoCondicionQuery.parse(req.query);
      const condiciones = await services.grading.condicionAlumno(getActor(res), id, q.periodo_id);
      res.json(condiciones.map(presentCondicion));
    }),
  );

  router.get(
    '/docentes',
    asyncHandler(async (req, res) => {
      const q = paginationWithCourseQuery.parse(req.query);
      const list = await services.identity.listDocentes(getActor(res), {
        courseId: q.curso_division_turno_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(list.map(presentDocente));
    }),
  );

  router.post(
    '/docentes',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = docenteCreateSchema.parse(req.body);
      const docente = await services.identity.createDocente(input, getContext(c, req, res));
      res.status(201).json(presentDocente(docente));
    }),
  );

  router.get(
    '/docentes/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(presentDocente(await services.identity.getDocente(getActor(res), id)));
    }),
  );

  router.put(
    '/docentes/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = docenteUpdateSchema.parse(req.body);
      res.json(presentDocente(await services.identity.updateDocente(id, input, getContext(c, req, res))));
    }),
  );

  router.delete(
    '/docentes/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const motivo = typeof body.motivo === 'string' ? body.motivo : undefined;
      await services.identity.deleteDocente(id, getContext(c, req, res), motivo);
      res.status(204).send();
    }),
  );

  router.get(
    '/docentes/:id/materias',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const materias = await services.academic.listDocenteMaterias(getActor(res), id);
      res.json(await Promise.all(materias.map((materia) => presentMateria(c, materia))));
    }),
  );

  router.get(
    '/tutores',
    asyncHandler(async (req, res) => {
      requireRole(getActor(res), 'administrador');
      const q = paginationQuery.parse(req.query);
      const list = await services.identity.listTutores(q.limit, q.offset);
      res.json(list.map(presentTutor));
    }),
  );

  router.post(
    '/tutores',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = tutorCreateSchema.parse(req.body);
      const tutor = await services.identity.createTutor(input, getContext(c, req, res));
      res.status(201).json(presentTutor(tutor));
    }),
  );

  router.get(
    '/tutores/dni/:dni',
    asyncHandler(async (req, res) => {
      requireRole(getActor(res), 'administrador');
      const { dni } = dniParam.parse(req.params);
      res.json(presentTutor(await services.identity.getTutorByDni(dni)));
    }),
  );

  router.get(
    '/tutores/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(presentTutor(await services.identity.getTutor(getActor(res), id)));
    }),
  );

  router.put(
    '/tutores/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = tutorUpdateSchema.parse(req.body);
      res.json(presentTutor(await services.identity.updateTutor(getActor(res), id, input)));
    }),
  );

  router.delete(
    '/tutores/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const motivo = typeof body.motivo === 'string' ? body.motivo : undefined;
      await services.identity.deleteTutor(id, getContext(c, req, res), motivo);
      res.status(204).send();
    }),
  );

  router.get(
    '/tutores/:id/alumnos',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const alumnos = await services.identity.getTutorAlumnos(getActor(res), id);
      res.json(await Promise.all(alumnos.map((alumno) => presentAlumno(c, alumno))));
    }),
  );

  router.delete(
    '/tutor-alumno/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await services.identity.deactivateTutorLink(id, getContext(c, req, res));
      res.status(204).send();
    }),
  );

  router.get(
    '/preceptores',
    asyncHandler(async (req, res) => {
      requireRole(getActor(res), 'administrador');
      const q = paginationWithCourseQuery.parse(req.query);
      const list = await services.identity.listPreceptores({
        courseId: q.curso_division_turno_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(await Promise.all(list.map((item) => presentPreceptor(c, item))), q.limit, q.offset));
    }),
  );

  router.post(
    '/preceptores',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = preceptorCreateSchema.parse(req.body);
      const preceptor = await services.identity.createPreceptor(input, getContext(c, req, res));
      res.status(201).json(await presentPreceptor(c, preceptor));
    }),
  );

  router.get(
    '/preceptores/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(await presentPreceptor(c, await services.identity.getPreceptor(getActor(res), id)));
    }),
  );

  router.put(
    '/preceptores/:id/cursos',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = preceptorCoursesSchema.parse(req.body);
      const preceptor = await services.identity.replacePreceptorCourses(
        id,
        input.cursos,
        getContext(c, req, res),
      );
      res.json(await presentPreceptor(c, preceptor));
    }),
  );

  router.put(
    '/preceptores/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = preceptorUpdateSchema.parse(req.body);
      res.json(await presentPreceptor(c, await services.identity.updatePreceptor(id, input, getContext(c, req, res))));
    }),
  );

  router.delete(
    '/preceptores/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const motivo = typeof body.motivo === 'string' ? body.motivo : undefined;
      await services.identity.deletePreceptor(id, getContext(c, req, res), motivo);
      res.status(204).send();
    }),
  );

  const cursosRouter = buildCursosRouter(c, services);
  router.use('/cursos', cursosRouter);
  router.use('/cursoDivisionTurno', cursosRouter);

  router.get(
    '/materias',
    asyncHandler(async (req, res) => {
      const q = materiasQuery.parse(req.query);
      const list = await services.academic.listMaterias(getActor(res), {
        courseId: q.curso_division_turno_id,
        teacherId: q.docente_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(await Promise.all(list.map((materia) => presentMateria(c, materia))));
    }),
  );

  router.post(
    '/materias',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = materiaCreateSchema.parse(req.body);
      const materia = await services.academic.createMateria(input, getContext(c, req, res));
      res.status(201).json(await presentMateria(c, materia));
    }),
  );

  router.get(
    '/materias/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      res.json(await presentMateria(c, await services.academic.getMateria(getActor(res), id)));
    }),
  );

  router.put(
    '/materias/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      const input = materiaUpdateSchema.parse(req.body);
      res.json(await presentMateria(c, await services.academic.updateMateria(id, input, getContext(c, req, res))));
    }),
  );

  router.delete(
    '/materias/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      await services.academic.deleteMateria(id, getContext(c, req, res));
      res.status(204).send();
    }),
  );

  router.get(
    '/materias/:id/inscripciones',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      const q = inscripcionesQuery.parse(req.query);
      const list = await services.academic.listMateriaInscripciones(getActor(res), id, q.estado);
      res.json(list.map(presentInscripcion));
    }),
  );

  router.get(
    '/inscripciones',
    asyncHandler(async (req, res) => {
      const q = inscripcionesQuery.parse(req.query);
      const list = await services.academic.listInscripciones(getActor(res), {
        alumnoId: q.alumno_id,
        materiaId: q.materia_id,
        limit: q.limit,
        offset: q.offset,
      });
      const filtered = q.estado ? list.filter((item) => item.estado === q.estado) : list;
      res.json(filtered.map(presentInscripcion));
    }),
  );

  router.post(
    '/inscripciones',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = inscripcionCreateSchema.parse(req.body);
      const inscripcion = await services.academic.createInscripcion(getActor(res), input);
      res.status(201).json(presentInscripcion(inscripcion));
    }),
  );

  router.get(
    '/inscripciones/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      res.json(presentInscripcion(await services.academic.getInscripcion(getActor(res), id)));
    }),
  );

  router.put(
    '/inscripciones/:id/estado',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      const input = inscripcionEstadoSchema.parse(req.body);
      const inscripcion = await services.academic.updateInscripcionEstado(
        id,
        input.estado,
        getContext(c, req, res),
      );
      res.json(presentInscripcion(inscripcion));
    }),
  );

  router.delete(
    '/inscripciones/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      await services.academic.deleteInscripcion(id, getContext(c, req, res));
      res.status(204).send();
    }),
  );

  router.get(
    '/clases',
    asyncHandler(async (req, res) => {
      const q = clasesQuery.parse(req.query);
      const list = await services.academic.listClases(getActor(res), {
        materiaId: q.materia_id,
        courseId: q.curso_division_turno_id,
        from: q.desde,
        to: q.hasta,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentClase), q.limit, q.offset));
    }),
  );

  router.post(
    '/clases',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = claseCreateSchema.parse(req.body);
      const clase = await services.academic.createClase(getActor(res), input);
      res.status(201).json(presentClase(clase));
    }),
  );

  router.get(
    '/clases/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(presentClase(await services.academic.getClase(getActor(res), id)));
    }),
  );

  router.put(
    '/clases/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = claseUpdateSchema.parse(req.body);
      res.json(presentClase(await services.academic.updateClase(getActor(res), id, input)));
    }),
  );

  router.get(
    '/asistencias',
    asyncHandler(async (req, res) => {
      const actor = getActor(res);
      const q = asistenciasQuery.parse(req.query);
      if (q.clase_id) {
        const result = await services.attendance.listByClase(actor, q.clase_id);
        res.json({
          clase: presentClase(result.clase),
          alumnos: await Promise.all(
            result.alumnos.map(async (item) => ({
              alumno: await presentAlumno(c, item.alumno),
              asistencia: item.asistencia ? presentAsistencia(item.asistencia) : null,
            })),
          ),
        });
        return;
      }
      if (q.alumno_id && q.periodo_id) {
        const list = await services.attendance.listByAlumnoAndPeriodo(actor, q.alumno_id, q.periodo_id);
        res.json(list.map(presentAsistencia));
        return;
      }
      const list = await services.attendance.list(actor, {
        claseId: q.clase_id,
        alumnoId: q.alumno_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(list.map(presentAsistencia));
    }),
  );

  router.post(
    '/asistencias',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = asistenciaCreateSchema.parse(req.body);
      const asistencia = await services.attendance.create(getActor(res), input);
      res.status(201).json(presentAsistencia(asistencia));
    }),
  );

  router.put(
    '/asistencias/:id/justificacion',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = asistenciaJustifySchema.parse(req.body);
      const asistencia = await services.attendance.justify(
        getActor(res),
        id,
        input.justificacion,
        getContext(c, req, res),
      );
      res.json(presentAsistencia(asistencia));
    }),
  );

  router.put(
    '/asistencias/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = asistenciaUpdateSchema.parse(req.body);
      const asistencia = await services.attendance.update(getActor(res), id, input, getContext(c, req, res));
      res.json(presentAsistencia(asistencia));
    }),
  );

  router.get(
    '/periodos',
    asyncHandler(async (req, res) => {
      const q = periodosQuery.parse(req.query);
      const list = await services.grading.listPeriodos(getActor(res), {
        cicloId: q.ciclo_lectivo_id,
        estado: q.estado,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentPeriodo), q.limit, q.offset));
    }),
  );

  router.post(
    '/periodos',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = periodoCreateSchema.parse(req.body);
      const periodo = await services.grading.createPeriodo(input, getContext(c, req, res));
      res.status(201).json(presentPeriodo(periodo));
    }),
  );

  router.get(
    '/periodos/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(presentPeriodo(await services.grading.getPeriodo(getActor(res), id)));
    }),
  );

  router.put(
    '/periodos/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = periodoUpdateSchema.parse(req.body);
      res.json(presentPeriodo(await services.grading.updatePeriodo(id, input, getContext(c, req, res))));
    }),
  );

  router.post(
    '/periodos/:id/cerrar',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const result = await services.grading.closePeriodo(id, getContext(c, req, res));
      res.json({
        cierre: result.cierre ? presentCierre(result.cierre) : null,
        condiciones: result.condiciones.map(presentCondicion),
      });
    }),
  );

  router.get(
    '/periodos/:id/condiciones',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const q = condicionesPeriodoQuery.parse(req.query);
      const list = await services.grading.listCondiciones(getActor(res), id, {
        materiaId: q.materia_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentCondicion), q.limit, q.offset));
    }),
  );

  router.get(
    '/instancias-evaluacion',
    asyncHandler(async (req, res) => {
      const q = instanciasQuery.parse(req.query);
      const list = await services.grading.listInstancias(getActor(res), {
        materiaId: q.materia_id,
        periodId: q.periodo_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentInstancia), q.limit, q.offset));
    }),
  );

  router.post(
    '/instancias-evaluacion',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = instanciaCreateSchema.parse(req.body);
      const instancia = await services.grading.createInstancia(getActor(res), input);
      res.status(201).json(presentInstancia(instancia));
    }),
  );

  router.get(
    '/instancias-evaluacion/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(presentInstancia(await services.grading.getInstancia(getActor(res), id)));
    }),
  );

  router.put(
    '/instancias-evaluacion/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = instanciaUpdateSchema.parse(req.body);
      res.json(presentInstancia(await services.grading.updateInstancia(getActor(res), id, input)));
    }),
  );

  router.get(
    '/calificaciones',
    asyncHandler(async (req, res) => {
      const q = calificacionesQuery.parse(req.query);
      const list = await services.grading.listCalificaciones(getActor(res), {
        instanciaId: q.instancia_id,
        alumnoId: q.alumno_id,
        periodId: q.periodo_id,
        materiaId: q.materia_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentCalificacion), q.limit, q.offset));
    }),
  );

  router.post(
    '/calificaciones',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = calificacionCreateSchema.parse(req.body);
      const calificacion = await services.grading.createCalificacion(getActor(res), input);
      res.status(201).json(presentCalificacion(calificacion));
    }),
  );

  router.get(
    '/calificaciones/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(presentCalificacion(await services.grading.getCalificacion(getActor(res), id)));
    }),
  );

  router.put(
    '/calificaciones/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = calificacionUpdateSchema.parse(req.body);
      const calificacion = await services.grading.updateCalificacion(
        getActor(res),
        id,
        input,
        getContext(c, req, res),
      );
      res.json(presentCalificacion(calificacion));
    }),
  );

  router.post(
    '/calificaciones/:id/anular',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = calificacionAnnulSchema.parse(req.body);
      const calificacion = await services.grading.annulCalificacion(
        getActor(res),
        id,
        input.motivo,
        getContext(c, req, res),
      );
      res.json(presentCalificacion(calificacion));
    }),
  );

  router.get(
    '/calificaciones/:id/historial',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const list = await services.grading.historialCalificacion(getActor(res), id);
      res.json(list.map(presentAuditoria));
    }),
  );

  router.post(
    '/calificaciones/:id/rectificar',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const input = calificacionRectifySchema.parse(req.body);
      const calificacion = await services.grading.rectifyCalificacion(
        getActor(res),
        id,
        input,
        getContext(c, req, res),
      );
      res.json(presentCalificacion(calificacion));
    }),
  );

  router.post(
    '/imports/alumnos',
    rateLimiter(env().IMPORT_RATE_LIMIT_MAX),
    csvUpload,
    idempotency(c, {
      extraHash: (_req, res) => String(res.locals.csvHash ?? ''),
    }),
    asyncHandler(async (req, res) => {
      requireRole(getActor(res), 'administrador');
      const buffer = res.locals.csvBuffer as Buffer;
      const fileName = String(res.locals.csvFileName ?? 'alumnos.csv');
      const job = await services.imports.startAlumnosImport(
        getActor(res),
        { content: buffer, fileName },
        getContext(c, req, res),
      );
      res.status(202).json(presentImportJob(job));
    }),
  );

  router.get(
    '/imports/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json(presentImportJob(await services.imports.getJob(getActor(res), id)));
    }),
  );

  router.get(
    '/imports/:id/errores',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const q = errorsQuery.parse(req.query);
      const errors = await services.imports.listErrors(getActor(res), id, q.limit, q.offset);
      res.json(
        paginated(
          errors.map((error) => ({
            row_number: error.rowNumber,
            column_name: error.columnName,
            code: error.code,
            message: error.message,
            raw_value: error.rawValue,
          })),
          q.limit,
          q.offset,
        ),
      );
    }),
  );

  router.get(
    '/auditoria',
    asyncHandler(async (req, res) => {
      const q = auditoriaQuery.parse(req.query);
      const list = await services.audit.list(getActor(res), {
        entidad: q.entidad,
        entidadId: q.entidad_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentAuditoria), q.limit, q.offset));
    }),
  );

  return router;
}

function buildCursosRouter(c: AppContainer, services: HttpServices): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const q = cursosQuery.parse(req.query);
      const list = await services.academic.listCursos(getActor(res), {
        cicloId: q.ciclo_lectivo_id,
        limit: q.limit,
        offset: q.offset,
      });
      res.json(paginated(list.map(presentCurso), q.limit, q.offset));
    }),
  );

  router.post(
    '/',
    idempotency(c),
    asyncHandler(async (req, res) => {
      const input = cursoCreateSchema.parse(req.body);
      const curso = await services.academic.createCurso(input, getContext(c, req, res));
      res.status(201).json(presentCurso(curso));
    }),
  );

  router.get(
    '/:id/alumnos',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      const alumnos = await services.academic.listCursoAlumnos(getActor(res), id);
      res.json(await Promise.all(alumnos.map((alumno) => presentAlumno(c, alumno))));
    }),
  );

  router.get(
    '/:id/materias',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      const materias = await services.academic.listCursoMaterias(getActor(res), id);
      res.json(await Promise.all(materias.map((materia) => presentMateria(c, materia))));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      res.json(presentCurso(await services.academic.getCurso(getActor(res), id)));
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      const input = cursoUpdateSchema.parse(req.body);
      res.json(presentCurso(await services.academic.updateCurso(id, input, getContext(c, req, res))));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = intIdParam.parse(req.params);
      await services.academic.deleteCurso(id, getContext(c, req, res));
      res.status(204).send();
    }),
  );

  return router;
}
