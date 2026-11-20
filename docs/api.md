# API HTTP

Base URL: `http://localhost:3000/api/v1`

## Convenciones

| Columna | Significado |
| --- | --- |
| **Auth** | `No` = endpoint público; `Bearer` = requiere `Authorization: Bearer <access token>`; `Interno` = token de métricas o loopback. |
| **Rol** | Roles permitidos. `Cualquiera` = cualquier rol autenticado. `Todos` = los cinco roles. |

Roles (`src/domain/shared/types.ts`): `administrador`, `preceptor`, `docente`, `alumno`, `tutor`.

Notas comunes:

- Todas las rutas bajo `/api/v1` están sujetas a rate limiting global.
- Las mutaciones marcadas con `Idempotency-Key` requieren esa cabecera (8–255 caracteres).
- Muchos endpoints aplican, además del rol, restricciones de propiedad/alcance (ej. "docente titular de la materia", "tutor vinculado", "solo su propio registro"). Se indican en **Notas**.
- Los tokens con `password_change_only` o usuarios con `mustChangePassword` solo pueden usar `GET /me`, `PUT /password` y logout; el resto devuelve `403 PASSWORD_CHANGE_REQUIRED`.

## Salud y operativos

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/health` | No | — | `200 {"status":"ok"}` |
| GET | `/ready` | No | — | `503` si DB o migraciones no disponibles |
| GET | `/internal/metrics` | Interno | — | Loopback o `x-internal-token` / Bearer = `INTERNAL_METRICS_TOKEN` |
| POST | `/internal/metrics/reset` | Interno | — | Misma autorización que metrics |

## Autenticación y sesión

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/login` (alias `/api/v1/login`) | No | — | Rate limit de login |
| POST | `/api/v1/auth/refresh` | No | — | Refresh token en el body; no reutilizable |
| POST | `/api/v1/auth/logout` (alias `/api/v1/logout`) | Bearer | Cualquiera | Permitido con cambio de password pendiente |
| GET | `/api/v1/me` | Bearer | Cualquiera | Permitido con cambio de password pendiente |
| PUT | `/api/v1/password` | Bearer | Cualquiera | Permitido con cambio de password pendiente |

## Registro público de tutores

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/tutores/validarCodigo/:codigo` | No | — | Rate limit público |
| POST | `/api/v1/tutores/register` | No | — | Rate limit público; requiere `Idempotency-Key` |

## Usuarios y administradores

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/users` | Bearer | `administrador` | |
| PATCH | `/api/v1/users/:id/estado` | Bearer | `administrador` | Único endpoint PATCH |
| POST | `/api/v1/admins` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/admins` | Bearer | `administrador` | |
| GET | `/api/v1/admins/estadisticas` | Bearer | `administrador` | |
| GET | `/api/v1/admins/:id` | Bearer | `administrador` | |
| PUT | `/api/v1/admins/:id` | Bearer | `administrador` | |
| DELETE | `/api/v1/admins/:id` | Bearer | `administrador` | |

## Alumnos

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/alumnos` | Bearer | `administrador`, `preceptor`, `docente`, `tutor` | `alumno` → `403`; resultados filtrados por alcance |
| POST | `/api/v1/alumnos` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/alumnos/:id` | Bearer | `administrador`, `preceptor`, `docente`, `tutor`, `alumno` | Solo propio id, tutor vinculado, preceptor del curso o docente con materia en el curso |
| PUT | `/api/v1/alumnos/:id` | Bearer | `administrador` | |
| DELETE | `/api/v1/alumnos/:id` | Bearer | `administrador` | |
| GET | `/api/v1/alumnos/:id/inscripciones` | Bearer | `administrador`, `docente`, `alumno`, `tutor` | Alumno propio / tutor vinculado; `preceptor` → `403` |
| GET | `/api/v1/alumnos/:id/condicion` | Bearer | Todos | Requiere acceso al alumno y al período |

## Docentes

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/docentes` | Bearer | `administrador`, `preceptor` | |
| POST | `/api/v1/docentes` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/docentes/:id` | Bearer | `administrador`, `preceptor`, `docente` | Docente solo su propio id |
| PUT | `/api/v1/docentes/:id` | Bearer | `administrador` | |
| DELETE | `/api/v1/docentes/:id` | Bearer | `administrador` | |
| GET | `/api/v1/docentes/:id/materias` | Bearer | Todos | Docente propio; demás filtrados por cursos permitidos |

## Tutores y vínculos

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/tutores` | Bearer | `administrador` | |
| POST | `/api/v1/tutores` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/tutores/dni/:dni` | Bearer | `administrador` | |
| GET | `/api/v1/tutores/:id` | Bearer | `administrador`, `tutor` | Tutor solo su propio id |
| PUT | `/api/v1/tutores/:id` | Bearer | `administrador`, `tutor` | Tutor propio; cambiar `email` solo `administrador` |
| DELETE | `/api/v1/tutores/:id` | Bearer | `administrador` | |
| GET | `/api/v1/tutores/:id/alumnos` | Bearer | `administrador`, `tutor` | Tutor solo su propio id |
| DELETE | `/api/v1/tutor-alumno/:id` | Bearer | `administrador` | |

## Preceptores

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/preceptores` | Bearer | `administrador` | |
| POST | `/api/v1/preceptores` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/preceptores/:id` | Bearer | `administrador`, `preceptor` | Preceptor solo su propio id |
| PUT | `/api/v1/preceptores/:id/cursos` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| PUT | `/api/v1/preceptores/:id` | Bearer | `administrador` | |
| DELETE | `/api/v1/preceptores/:id` | Bearer | `administrador` | |

## Cursos

Disponibles también bajo el alias `/api/v1/cursoDivisionTurno` con los mismos handlers.

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/cursos` | Bearer | Todos | Filtrado por cursos permitidos según rol |
| POST | `/api/v1/cursos` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/cursos/:id/alumnos` | Bearer | `administrador`, `preceptor`, `docente` | `alumno`/`tutor` → `403` |
| GET | `/api/v1/cursos/:id/materias` | Bearer | Todos | Requiere acceso al curso |
| GET | `/api/v1/cursos/:id` | Bearer | Todos | Requiere acceso al curso |
| PUT | `/api/v1/cursos/:id` | Bearer | `administrador` | |
| DELETE | `/api/v1/cursos/:id` | Bearer | `administrador` | |

## Materias

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/materias` | Bearer | Todos | Filtrado por curso/docente |
| POST | `/api/v1/materias` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/materias/:id` | Bearer | Todos | Requiere acceso a la materia |
| PUT | `/api/v1/materias/:id` | Bearer | `administrador` | |
| DELETE | `/api/v1/materias/:id` | Bearer | `administrador` | |
| GET | `/api/v1/materias/:id/inscripciones` | Bearer | `administrador`, `docente` | Docente solo si es titular de la materia |

## Inscripciones

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/inscripciones` | Bearer | `administrador`, `docente`, `alumno`, `tutor` | Alumno propio / tutor vinculado; `preceptor` → `403` |
| POST | `/api/v1/inscripciones` | Bearer | `administrador`, `alumno` | Alumno solo su propio `alumno_id`; requiere `Idempotency-Key` |
| GET | `/api/v1/inscripciones/:id` | Bearer | `administrador`, `docente`, `alumno`, `tutor` | Propietario/titular/vinculado; `preceptor` → `404` |
| PUT | `/api/v1/inscripciones/:id/estado` | Bearer | `administrador`, `docente` | Docente solo si es titular de la materia |
| DELETE | `/api/v1/inscripciones/:id` | Bearer | `administrador` | |

## Clases

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/clases` | Bearer | Todos | Filtrado por materia/curso según rol |
| POST | `/api/v1/clases` | Bearer | `administrador`, `docente` | Docente solo si es titular; requiere `Idempotency-Key` |
| GET | `/api/v1/clases/:id` | Bearer | Todos | Requiere acceso a la materia |
| PUT | `/api/v1/clases/:id` | Bearer | `administrador`, `docente` | Docente solo si es titular |

## Asistencias

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/asistencias?clase_id=...` | Bearer | Todos | Requiere acceso a la materia de la clase |
| GET | `/api/v1/asistencias?alumno_id=...&periodo_id=...` | Bearer | Todos | Requiere acceso al alumno y al período |
| GET | `/api/v1/asistencias?alumno_id=...` | Bearer | Todos | Requiere acceso al alumno |
| GET | `/api/v1/asistencias` | Bearer | Cualquiera | Sin filtros: sin scope, devuelve todas |
| POST | `/api/v1/asistencias` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso; requiere `Idempotency-Key` |
| PUT | `/api/v1/asistencias/:id/justificacion` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso |
| PUT | `/api/v1/asistencias/:id` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso |

## Períodos y condiciones

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/periodos` | Bearer | Todos | Según ciclos de cursos permitidos |
| POST | `/api/v1/periodos` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/periodos/:id` | Bearer | Todos | Requiere acceso al período |
| PUT | `/api/v1/periodos/:id` | Bearer | `administrador` | |
| POST | `/api/v1/periodos/:id/cerrar` | Bearer | `administrador` | Requiere `Idempotency-Key` |
| GET | `/api/v1/periodos/:id/condiciones` | Bearer | Todos | Requiere acceso al período; con `materia_id` requiere permiso de gestión de la materia |

## Instancias de evaluación

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/instancias-evaluacion` | Bearer | `administrador`, `docente` | |
| POST | `/api/v1/instancias-evaluacion` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso; requiere `Idempotency-Key` |
| GET | `/api/v1/instancias-evaluacion/:id` | Bearer | Todos | Requiere acceso a la materia |
| PUT | `/api/v1/instancias-evaluacion/:id` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso |

## Calificaciones

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/calificaciones` | Bearer | Todos | Scope según rol |
| POST | `/api/v1/calificaciones` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso; requiere `Idempotency-Key` |
| GET | `/api/v1/calificaciones/:id` | Bearer | Todos | Requiere acceso a la calificación |
| PUT | `/api/v1/calificaciones/:id` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso |
| POST | `/api/v1/calificaciones/:id/anular` | Bearer | `administrador`, `docente`, `preceptor` | Docente titular / preceptor del curso; requiere `Idempotency-Key` |
| GET | `/api/v1/calificaciones/:id/historial` | Bearer | Todos | Requiere acceso a la calificación |
| POST | `/api/v1/calificaciones/:id/rectificar` | Bearer | `administrador` | Requiere `Idempotency-Key` |

## Importaciones y auditoría

| Método | Ruta | Auth | Rol | Notas |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/imports/alumnos` | Bearer | `administrador` | Rate limit propio, `multipart/form-data` (CSV) y `Idempotency-Key` |
| GET | `/api/v1/imports/:id` | Bearer | `administrador` | |
| GET | `/api/v1/imports/:id/errores` | Bearer | `administrador` | |
| GET | `/api/v1/auditoria` | Bearer | Todos | `administrador` ve todo; los demás solo sus propios eventos |
