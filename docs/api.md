# API HTTP

Base URL: `http://localhost:3000/api/v1`

## Convenciones

| Columna | Significado |
| --- | --- |
| **Auth** | `No` = endpoint público; `Bearer` = requiere `Authorization: Bearer <access token>`; `Interno` = token de métricas o loopback. |
| **Rol** | Roles permitidos. `Cualquiera` = cualquier rol autenticado. `Todos` = los cinco roles. |
| **Params** | Parámetros de path (`/recurso/:id`). `—` = ninguno. |
| **Query** | Parámetros de query string. Se referencia el schema definido en [Query](#query). `—` = ninguno. |
| **Body** | Cuerpo JSON. Se referencia el schema definido en [Body](#body). `—` = ninguno. |
| **OK** | Código y forma de la respuesta exitosa definida en [Formatos de respuesta](#formatos-de-respuesta). |

Roles (`src/domain/shared/types.ts`): `administrador`, `preceptor`, `docente`, `alumno`, `tutor`.

Notas comunes:

- Todos los schemas son `.strict()`: los campos desconocidos en params, query o body se rechazan.
- Todas las rutas bajo `/api/v1` están sujetas a rate limiting global.
- Las mutaciones marcadas con `Idempotency-Key` requieren esa cabecera (8–255 caracteres). En replay responden el mismo cuerpo con `Idempotent-Replayed: true`; ver [Idempotencia](#idempotencia).
- Muchos endpoints aplican, además del rol, restricciones de propiedad/alcance (ej. "docente titular de la materia", "tutor vinculado", "solo su propio registro"). Se indican bajo cada tabla.
- Los tokens con `password_change_only` o usuarios con `mustChangePassword` solo pueden usar `GET /me`, `PUT /password` y logout; el resto devuelve `403 PASSWORD_CHANGE_REQUIRED`.
- Toda respuesta incluye la cabecera `X-Request-Id`. La forma de error estándar es `{ error: { code, message, details? }, message, requestId }`; ver [Errores](#errores).

## Tipos de request

### Path params

| Nombre | Tipo | Uso |
| --- | --- | --- |
| `:id` (UUID) | `uuid` v4 | Usuarios, alumnos, docentes, tutores, preceptores, clases, asistencias, períodos, instancias, calificaciones, importaciones, vínculos |
| `:id` (entero) | entero positivo | Cursos, materias, inscripciones |
| `:dni` | entero positivo | `GET /tutores/dni/:dni` |
| `:codigo` | string 1–255 | `GET /tutores/validarCodigo/:codigo` |

### Query

Todos los schemas de query son estrictos. `?` = opcional.

| Schema | Campos |
| --- | --- |
| `Pagination` | `limit?` entero 1–500 (default 50), `offset?` entero ≥ 0 (default 0) |
| `paginationQuery` | `Pagination` |
| `usersQuery` | `role?` (`administrador`\|`preceptor`\|`docente`\|`alumno`\|`tutor`), `active?` (`true`\|`false`\|`1`\|`0`), `Pagination` |
| `paginationWithCourseQuery` | `curso_division_turno_id?` entero positivo, `Pagination` |
| `cursosQuery` | `ciclo_lectivo_id?` UUID, `Pagination` |
| `materiasQuery` | `curso_division_turno_id?` entero, `docente_id?` UUID, `Pagination` |
| `inscripcionesQuery` | `alumno_id?` UUID, `materia_id?` entero, `estado?` (`pendiente`\|`aprobado`\|`rechazado`\|`cancelado`), `Pagination` |
| `clasesQuery` | `materia_id?` entero, `curso_division_turno_id?` entero, `desde?` fecha, `hasta?` fecha, `Pagination` |
| `asistenciasQuery` | `clase_id?` UUID, `alumno_id?` UUID, `periodo_id?` UUID, `Pagination` |
| `periodosQuery` | `ciclo_lectivo_id?` UUID, `estado?` (`abierto`\|`cerrado`), `Pagination` |
| `condicionesPeriodoQuery` | `materia_id?` entero, `Pagination` |
| `instanciasQuery` | `materia_id?` entero, `periodo_id?` UUID, `Pagination` |
| `calificacionesQuery` | `instancia_id?` UUID, `alumno_id?` UUID, `periodo_id?` UUID, `materia_id?` entero, `Pagination` |
| `alumnoCondicionQuery` | `periodo_id` UUID (obligatorio) |
| `auditoriaQuery` | `entidad?` string 1–100, `entidad_id?` string 1–100, `Pagination` |
| `errorsQuery` | `Pagination` |

Formatos: fecha = `YYYY-MM-DD`; hora = `HH:mm`. Los booleanos de query solo aceptan `true`, `false`, `1` o `0`.

### Body

Todos los cuerpos son JSON, salvo `CsvUpload`. Formato de campos: `nombre:tipo` (obligatorio), `nombre?:tipo` (opcional), `nullish` (acepta `null`).

| Schema | Campos |
| --- | --- |
| `Login` | `username:string(1-255)`, `password:string(1-128)` |
| `Refresh` | `refresh_token:string(1-2048)` |
| `Logout` | `refresh_token?:string(1-2048)` |
| `Password` | `current_password:string(1-128)`, `new_password:string(1-128)`, `new_password_confirmation:string(1-128)` |
| `AdminCreate` | `first_name:string(1-100)`, `last_name:string(1-100)`, `username:string(1-255)`, `password:string(1-128)` |
| `AdminUpdate` | `first_name?:string(1-100)`, `last_name?:string(1-100)`, `username?:string(3-255)` |
| `UserState` | `is_active:boolean`, `motivo:string(1-500)` |
| `AlumnoCreate` | `first_name:string(1-100)`, `last_name:string(1-100)`, `dni:integer`, `fecha_nacimiento:date`, `curso_division_turno_id:integer`, `relationship:` `padre`\|`madre`\|`otra`, `otra_relacion?:string(≤100)\|null`, `tutor_id?:UUID\|null`, `tutor_first_name?:string(1-100)`, `tutor_last_name?:string(1-100)`, `tutor_dni?:integer`, `tutor_telephone?:string(1-20)` |
| `AlumnoUpdate` | `first_name?`, `last_name?`, `dni?`, `fecha_nacimiento?`, `curso_division_turno_id?`, `version?:integer>0` |
| `DocenteCreate` | `first_name:string(1-100)`, `last_name:string(1-100)`, `dni:integer`, `telephone:string(1-20)`, `fecha_ingreso:date`, `curso_division_turno_id?:integer\|null` |
| `DocenteUpdate` | `first_name?`, `last_name?`, `telephone?:string(1-20)`, `fecha_ingreso?:date`, `curso_division_turno_id?:integer\|null`, `version?` |
| `TutorRegister` | `codigo:string(1-255)`, `email:string(1-255)`, `password:string(1-128)`, `password_confirmation:string(1-128)` |
| `TutorCreate` | `first_name:string(1-100)`, `last_name:string(1-100)`, `dni:integer`, `telephone:string(1-20)`, `email:string(1-255)`, `password?:string(6-128)` |
| `TutorUpdate` | `telephone?:string(1-20)`, `email?:string(3-255)`, `version?` |
| `PreceptorCreate` | `first_name:string(1-100)`, `last_name:string(1-100)`, `dni:integer`, `telephone?:string(≤20)\|null`, `employee_code?:string(≤50)\|null`, `cursos?:integer[] (≤50)` |
| `PreceptorUpdate` | `telephone?:string(≤20)\|null`, `employee_code?:string(≤50)\|null`, `version?` |
| `PreceptorCourses` | `cursos:integer[] (≤50)` |
| `CursoCreate` | `ciclo_lectivo_id?:UUID`, `curso:integer`, `division:string(1-10)`, `turno:` `Mañana`\|`Tarde`, `capacidad_maxima?:integer` |
| `CursoUpdate` | `curso?:integer`, `division?:string(1-10)`, `turno?`, `capacidad_maxima?:integer`, `version?` |
| `MateriaCreate` | `nombre:string(1-150)`, `descripcion:string(1-1000)`, `curso_division_turno_id:integer`, `docente_id:UUID` |
| `MateriaUpdate` | `nombre?:string(1-150)`, `descripcion?:string(1-1000)`, `curso_division_turno_id?:integer`, `docente_id?:UUID`, `version?` |
| `InscripcionCreate` | `alumno_id:UUID`, `materia_id:integer`, `fecha_inscripcion?:date` |
| `InscripcionEstado` | `estado:` `pendiente`\|`aprobado`\|`rechazado`\|`cancelado` |
| `ClaseCreate` | `materia_id:integer`, `fecha:date`, `hora_inicio:time`, `hora_fin:time`, `tema:string(1-500)` |
| `ClaseUpdate` | `fecha?:date`, `hora_inicio?:time`, `hora_fin?:time`, `tema?:string(1-500)`, `estado?:` `programada`\|`dictada`\|`cancelada`, `version?` |
| `AsistenciaCreate` | `clase_id:UUID`, `alumno_id:UUID`, `estado:` `presente`\|`ausente`\|`justificada`\|`tarde` |
| `AsistenciaUpdate` | `estado:` `presente`\|`ausente`\|`justificada`\|`tarde`, `motivo?:string(≤500)`, `version?` |
| `AsistenciaJustify` | `justificacion:string(1-500)` |
| `PeriodoCreate` | `ciclo_lectivo_id:UUID`, `nombre:string(1-100)`, `tipo:` `trimestre`\|`cuatrimestre`, `fecha_inicio:date`, `fecha_fin:date`, `regla_default?:object` |
| `PeriodoUpdate` | `nombre?:string(1-100)`, `fecha_inicio?:date`, `fecha_fin?:date`, `regla_default?:object`, `version?` |
| `InstanciaCreate` | `materia_id:integer`, `periodo_id:UUID`, `nombre:string(1-150)`, `tipo:` `parcial`\|`tp`\|`oral`\|`recuperatorio`\|`otro`, `peso:string\|number`, `fecha:date` |
| `InstanciaUpdate` | `nombre?:string(1-150)`, `tipo?`, `peso?:string\|number`, `fecha?:date`, `version?` |
| `CalificacionCreate` | `instancia_id:UUID`, `alumno_id:UUID`, `valor:string\|number` |
| `CalificacionUpdate` | `valor:string\|number`, `motivo?:string(≤500)`, `version?` |
| `CalificacionAnnul` | `motivo:string(1-500)` |
| `CalificacionRectify` | `valor:string\|number`, `motivo:string(1-500)` |
| `Motivo (sin validar)` | DELETE varios: `motivo` leído directamente de `req.body` |
| `CsvUpload` | `POST /imports/alumnos`: `multipart/form-data` con campo `file` (1 archivo CSV) **o** `text/csv` / `text/plain` raw; máximo `IMPORT_MAX_FILE_BYTES` |

## Formatos de respuesta

### Convenciones

- `200`: lecturas y actualizaciones; `201`: altas; `202`: importación iniciada; `204`: sin cuerpo (todos los DELETE, logout y reset de métricas).
- Un objeto simple se denota por su tipo (ej. `User`). Un array plano, por `Tipo[]`.
- `Paginado<T>` = `{ data: T[], meta: { limit: number, offset: number, total: number } }`.
  **Nota:** `total = offset + data.length`; no es un `COUNT` real.
- Los decimales se serializan como string con 2 decimales (ej. `"8.50"`, `"30.00"`).
- `fecha_nacimiento`, `fecha_ingreso` y `fecha_inscripcion` se devuelven en `dd/mm/YYYY`; el resto de fechas en `YYYY-MM-DD` o ISO según el campo.
- Siempre que un campo se marca `|null`, el JSON contiene `null` (no se omite).

### Objetos

| Tipo | Campos |
| --- | --- |
| `User` | `id, first_name, last_name, dni, username, email, role, is_active, must_change_password` |
| `Alumno` | `User` + `fecha_nacimiento (dd/mm/YYYY), curso_division_turno_id, curso_division (string\|null)` |
| `Docente` | `User` + `telephone, fecha_ingreso (dd/mm/YYYY), curso_division_turno_id (int\|null)` |
| `Tutor` | `User` + `telephone` |
| `Preceptor` | `User` + `telephone, employee_code, cursos: [{ id, curso_division }]` |
| `Curso` | `id, ciclo_lectivo_id, curso, division, turno, capacidad_maxima, curso_division, version` |
| `Materia` | `id, nombre, descripcion, curso_division_turno_id, turno (string\|null), docente_id, version` |
| `Inscripcion` | `id, alumno_id, materia_id, fecha_inscripcion (dd/mm/YYYY), estado, estado_label, version` |
| `Clase` | `id, materia_id, fecha, hora_inicio (HH:mm), hora_fin (HH:mm), tema, estado, version` |
| `Asistencia` | `id, clase_id, alumno_id, estado, justificacion, registrada_por, version, updated_at` |
| `Periodo` | `id, ciclo_lectivo_id, nombre, tipo, fecha_inicio, fecha_fin, estado, version` |
| `Instancia` | `id, materia_id, periodo_id, nombre, tipo, peso (string), fecha, version` |
| `Calificacion` | `id, instancia_id, alumno_id, valor (string), estado, version, updated_at` |
| `Condicion` | `id, periodo_id, alumno_id, materia_id, condicion, promedio, porcentaje_asistencia, detalle, calculada_en` |
| `Cierre` | `id, periodo_id, ejecutado_en, total_alumnos, total_condiciones` |
| `ImportJob` | `id, estado, file_name, total_rows, processed_rows, valid_rows, error_rows, error_code, error_message, attempts, created_at, finished_at` |
| `ImportError` | `row_number, column_name, code, message, raw_value` |
| `Auditoria` | `id, entidad, entidad_id, accion, actor_id, actor_role, motivo, antes, despues, ocurrido_en` |

Valores de enum en respuestas: inscripción `pendiente|aprobado|rechazado|cancelado` (`estado_label`: `Pendiente|Aprobado|Rechazado|Cancelado`); asistencia `presente|ausente|justificada|tarde`; clase `programada|dictada|cancelada`; período `abierto|cerrado`; calificación `activa|rectificada|anulada`; condición `regular|libre|promocionado|no_aplica`; importación `pendiente|procesando|completada|fallida`.

`detalle` de `Condicion`:

```json
{
  "grades": [{ "value": "8.50", "weight": "30.00", "status": "activa" }],
  "attendance": { "present": 10, "late": 1, "justified": 0, "absent": 1 },
  "taughtClasses": 12,
  "totalWeight": "100.00",
  "rule": {
    "asistencia_minima_pct": 75,
    "nota_minima_regular": 6,
    "nota_minima_promocion": 8,
    "condicion_sin_datos": "no_aplica"
  }
}
```

### Respuestas especiales

| Tipo | Forma |
| --- | --- |
| `Session` | `{ access_token, refresh_token (string\|null), token_type: "Bearer", expires_in, role, first_name, last_name, username, must_change_password }`. `refresh_token: null` cuando debe cambiar la contraseña. |
| `Me` | `{ user: User, perfiles: object, cursos: [{ id, curso_division }] }`. `perfiles.alumno = { fecha_nacimiento, curso_division_turno_id }`; `perfiles.docente = { telephone, fecha_ingreso }`; `perfiles.tutor = { telephone }`; `perfiles.preceptor = { telephone, employee_code }`; administrador → `{}`. |
| `TutorCode` | `{ alumno: { first_name, last_name, curso_division } }` |
| `AdminStats` | `{ total_alumnos, total_tutores, total_preceptores, total_materias }` |
| `AsistenciasPorClase` | `{ clase: Clase, alumnos: [{ alumno: Alumno, asistencia: Asistencia\|null }] }` — incluye todos los alumnos del curso, con `asistencia: null` si no registró. |
| `CierrePeriodo` | `{ cierre: Cierre\|null, condiciones: Condicion[] }` |
| `Ready` | `{ status: "ok", database: true, migrations: true }` |
| `Metrics` | `{ uptime_seconds, memory: { rss, heapTotal, heapUsed, external, arrayBuffers }, cpu: { user, system }, event_loop: { samples, min_ms, max_ms, mean_ms, p50_ms, p95_ms, p99_ms }\|null, db_pool: { total, idle, waiting, max }, pid, node, timestamp }` |

## Errores

### Formato uniforme

Toda respuesta de error (salvo `GET /ready`, ver más abajo) usa exactamente esta forma:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La entrada no es válida.",
    "details": [
      { "path": "body.username", "code": "invalid_type", "message": "Required" }
    ]
  },
  "message": "La entrada no es válida.",
  "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

Reglas:

- `error.code`: identificador máquina del error (tablas siguientes).
- `error.message`: mensaje legible; `message` (raíz) **siempre es idéntico**.
- `error.details`: **solo se incluye cuando existe**. Puede ser un array de `{ path, code, message }` (Zod, `23505`) o el valor libre pasado al construir el error de dominio. Si el valor es `null`, se serializa `"details": null`.
- `requestId`: el `x-request-id` recibido (válido: ≤ 128 chars, `/^[\w.:-]+$/`) o un UUID generado. Se devuelve también como cabecera `X-Request-Id` en todas las respuestas.
- Los errores no controlados se loguean como `Error no controlado.` y se renderizan como `500 INTERNAL_ERROR`, sin exponer el error original.

Cabeceras relevantes en errores:

| Cabecera | Cuándo |
| --- | --- |
| `X-Request-Id` | Todas las respuestas. |
| `Retry-After` | Respuestas `429 RATE_LIMITED` (segundos restantes de la ventana). |
| `RateLimit`, `RateLimit-Policy` | Endpoints con limiter (`draft-7`). No se envían cabeceras `X-RateLimit-*` (`legacyHeaders: false`). |
| `Idempotent-Replayed: true` | No es un error: indica replay de una mutación idempotente ya completada (mismo status y body originales). |

### Códigos generados por el handler

| HTTP | `error.code` | `error.message` | Origen |
| --- | --- | --- | --- |
| 400 | `MALFORMED_JSON` | El cuerpo JSON no es válido. | `express.json` (`entity.parse.failed`) |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | El header Idempotency-Key es obligatorio. | Falta `Idempotency-Key` o longitud fuera de 8–255 |
| 403 | `FORBIDDEN` | No tiene permisos para acceder a este recurso. | `requireRole` en `context.ts`; `/internal/metrics*` |
| 404 | `NOT_FOUND` | Ruta no encontrada. | `notFoundHandler` (ruta inexistente) |
| 409 | `DUPLICATE_RESOURCE` | El recurso ya existe. | `DomainError` o PG `23505` |
| 409 | `CONFLICT` | La operación entra en conflicto con el estado actual. | PG `23503` / `23514`; conflictos de idempotencia y concurrencia |
| 413 | `PAYLOAD_TOO_LARGE` | El cuerpo del pedido es demasiado grande. | `express.json` / `express.raw` (`entity.too.large`) |
| 422 | `VALIDATION_ERROR` | La entrada no es válida. | Cualquier `schema.parse()` de Zod |
| 422 | `VALIDATION_ERROR` | La entrada contiene campos no permitidos. | `rejectPrototypePollution` (sin `details`) |
| 429 | `RATE_LIMITED` | Demasiados pedidos. Intente más tarde. | `rateLimiter` global, de login, público o de importación |
| 500 | `INTERNAL_ERROR` | Error interno del servidor. | Fallback del `errorHandler` |
| 503 | `SERVICE_UNAVAILABLE` | La base de datos o las migraciones no están disponibles. | `GET /ready` (cuerpo especial) |

Detalle de `details` según origen:

| Origen | `details` |
| --- | --- |
| Zod | `[{ path: string, code: string, message: string }]` por cada issue (`invalid_type`, `unrecognized_keys`, `too_small`, `too_big`, `invalid_string`, `custom`, …). `path` es vacío cuando el error es de objeto. |
| PG `23505` | `[{ path: "<constraint>", code: "unique", message: "Valor duplicado." }]`; se omite si no hay nombre de constraint. |
| PG `23503` / `23514` | Sin `details`. |
| `entity.parse.failed`, `entity.too.large`, `RATE_LIMITED`, `notFoundHandler` | Sin `details`. |

Mapeo de Postgres: `23505` → `409 DUPLICATE_RESOURCE`; `23503` y `23514` → `409 CONFLICT`; cualquier otro código (incluidos `22P02`, `23502`, `40001`, `40P01`) → `500 INTERNAL_ERROR`.

### Errores de dominio

| `error.code` | HTTP | `error.message` |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | (mensaje recibido) |
| `NOT_FOUND` | 404 | `<recurso> no encontrado.` (default: "Recurso no encontrado.") |
| `FORBIDDEN` | 403 | No tiene permisos para acceder a este recurso. |
| `UNAUTHENTICATED` | 401 | No autenticado. |
| `INVALID_CREDENTIALS` | 401 | Credenciales inválidas. |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Debe cambiar la contraseña antes de continuar. |
| `DUPLICATE_RESOURCE` | 409 | El recurso ya existe. |
| `CONFLICT` | 409 | La operación no es válida en el estado actual. |
| `INVALID_STATE_TRANSITION` | 409 | Transición de estado no permitida. |
| `CAPACITY_EXCEEDED` | 409 | El curso no tiene cupo disponible. |
| `PERIOD_CLOSED` | 409 | El período está cerrado. |
| `PERIOD_INCOMPLETE` | 409 | No se puede cerrar el período: faltan datos obligatorios. |
| `STALE_VERSION` | 409 | La versión enviada no coincide con la actual. |
| `INVALID_CODE` | 400 | El código de vinculación no es válido. |
| `TOKEN_REUSE_DETECTED` | 401 | El refresh token ya fue utilizado. Inicie sesión nuevamente. |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | El header Idempotency-Key es obligatorio. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | La Idempotency-Key ya fue usada con un pedido distinto. |
| `IMPORT_ALREADY_RUNNING` | 409 | Ya hay una importación en curso para este usuario. |
| `IMPORT_INVALID_FILE` | 422 | El archivo CSV no es válido. |
| `PAYLOAD_TOO_LARGE` | 413 | El archivo supera el tamaño máximo permitido. |
| `RATE_LIMITED` | 429 | Demasiados pedidos. Intente más tarde. |
| `SERVICE_UNAVAILABLE` | 503 | Servicio no disponible. |

`PERIOD_CLOSED` y `PERIOD_INCOMPLETE` están definidos en el catálogo pero no se lanzan desde los endpoints actuales: los cierres de período se resuelven con `CONFLICT` o devolviendo el cierre existente.

### Errores por situación

| Situación | Códigos |
| --- | --- |
| Todas las rutas protegidas | `UNAUTHENTICATED` (sin token, token inválido/expirado, cuenta inactiva), `PASSWORD_CHANGE_REQUIRED` (salvo `GET /me`, `PUT /password` y logout), `FORBIDDEN` (rol/alcance), `NOT_FOUND` (recurso fuera del alcance), `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR` |
| Mutaciones con `version` | `STALE_VERSION` si la versión enviada no coincide con la actual (alumnos, docentes, tutores, preceptores, cursos, materias, períodos, instancias, calificaciones, clases, asistencias) |
| Mutaciones con `Idempotency-Key` | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `CONFLICT` ("todavía está en proceso" / "No se pudo reservar la Idempotency-Key") |
| Login | `INVALID_CREDENTIALS`, `RATE_LIMITED` (limiter propio) |
| Refresh | `TOKEN_REUSE_DETECTED` (revoca la familia), `UNAUTHENTICATED` ("Refresh token inválido.", "Refresh token expirado.", "Cuenta inactiva."), `PASSWORD_CHANGE_REQUIRED` |
| `PUT /password` | `VALIDATION_ERROR` (confirmación, contraseña actual incorrecta, contraseña igual a la anterior o reglas de complejidad), `UNAUTHENTICATED` |
| Tutores públicos | `INVALID_CODE`, `VALIDATION_ERROR` (confirmación de contraseña), `DUPLICATE_RESOURCE` ("El tutor ya está registrado.", "El email ya está en uso."), `RATE_LIMITED` |
| Usuarios y administradores | `FORBIDDEN`, `NOT_FOUND` ("Usuario/Administrador no encontrado."), `CONFLICT` ("No puede desactivar su propia cuenta.", "No se puede desactivar al último administrador activo."), `DUPLICATE_RESOURCE` (username/email/DNI) |
| Alumnos | `CAPACITY_EXCEEDED`, `DUPLICATE_RESOURCE` (DNI, vínculo de tutor), `NOT_FOUND` ("Curso/Alumno no encontrado."), `VALIDATION_ERROR` (datos del tutor, `otra_relacion`) |
| Docentes | `CAPACITY_EXCEEDED`, `CONFLICT` ("El docente todavía dicta materias; reasígnelas antes de la baja."), `NOT_FOUND`, `STALE_VERSION` |
| Tutores y vínculos | `FORBIDDEN` ("Solo un administrador puede cambiar el email."), `DUPLICATE_RESOURCE`, `NOT_FOUND` ("Tutor/Vínculo no encontrado."), `STALE_VERSION` |
| Preceptores | `NOT_FOUND` ("Preceptor/Curso no encontrado."), `DUPLICATE_RESOURCE`, `STALE_VERSION` |
| Cursos | `VALIDATION_ERROR` (turno, curso 1–7, capacidad 1–100, capacidad menor a alumnos), `NOT_FOUND` ("Ciclo lectivo/Curso no encontrado."), `CONFLICT` ("El ciclo lectivo está cerrado.", curso duplicado, "El curso tiene alumnos, materias o clases asociadas.") |
| Materias | `VALIDATION_ERROR` (nombre/descripción obligatorios), `NOT_FOUND` ("Curso/Docente/Materia no encontrado."), `CONFLICT` ("El ciclo lectivo está cerrado.", "La materia tiene inscripciones, clases o calificaciones asociadas.") |
| Inscripciones | `FORBIDDEN` ("Solo puede inscribirse a sí mismo."), `NOT_FOUND`, `VALIDATION_ERROR` ("El alumno no pertenece al curso de la materia."), `CONFLICT` ("Ya existe una inscripción activa a esa materia."), `INVALID_STATE_TRANSITION` (transiciones de estado inválidas) |
| Clases | `VALIDATION_ERROR` (fecha fuera del ciclo, hora de fin, duración > 8 h, tema obligatorio, "No se puede volver al estado programada."), `NOT_FOUND`, `CONFLICT` ("El ciclo lectivo está cerrado."), `INVALID_STATE_TRANSITION` |
| Asistencias | `CONFLICT` ("La clase debe estar dictada para registrar asistencia.", "Ya existe asistencia para ese alumno en la clase."), `VALIDATION_ERROR` ("Debe indicar alumno_id.", motivo/justificación obligatorios), `NOT_FOUND`, `INVALID_STATE_TRANSITION` |
| Períodos | `VALIDATION_ERROR` (`regla_default`, porcentajes/notas, tipo, fechas), `NOT_FOUND` ("Ciclo lectivo/Período no encontrado."), `CONFLICT` ("El ciclo lectivo está cerrado.", "El período está cerrado."), `STALE_VERSION` |
| `POST /periodos/:id/cerrar` | `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION` ("El período está cerrado." — en la práctica se devuelve el cierre existente), `IDEMPOTENCY_*` |
| Instancias de evaluación | `VALIDATION_ERROR` (tipo, fecha dentro del período, peso > 0), `NOT_FOUND`, `CONFLICT` ("El período está cerrado."), `STALE_VERSION` |
| Calificaciones | `VALIDATION_ERROR` (nota 0–10 con ≤ 2 decimales, motivos obligatorios), `NOT_FOUND`, `CONFLICT` ("El período está cerrado.", "Ya existe una calificación para ese alumno.", "Solo se rectifican calificaciones de períodos cerrados."), `INVALID_STATE_TRANSITION` ("La nota ya está anulada.", "La nota no está anulada."), `FORBIDDEN` (rectificar sin rol `administrador`) |
| `POST /imports/alumnos` | `IMPORT_INVALID_FILE` (vacío, sin campo `file`, Content-Type inválido), `PAYLOAD_TOO_LARGE`, `IMPORT_ALREADY_RUNNING`, `FORBIDDEN`, `RATE_LIMITED` (limiter propio), `IDEMPOTENCY_*`, errores de dominio de curso/alumno |
| `GET /imports/:id`, `GET /imports/:id/errores` | `FORBIDDEN`, `NOT_FOUND` ("Importación no encontrado.") |
| `GET /auditoria` | `FORBIDDEN` para roles fuera de la lista |
| `GET /ready` | `503 SERVICE_UNAVAILABLE` (cuerpo especial) |
| `/internal/metrics*` | `403 FORBIDDEN` si no es loopback y el token no coincide |

`403 FORBIDDEN` de `metricsAuthorized` usa el mismo formato estándar, pero `GET /ready` **no** incluye `message` en la raíz:

```json
{
  "status": "unavailable",
  "database": false,
  "migrations": false,
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "La base de datos o las migraciones no están disponibles."
  },
  "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

### Errores diferidos de importación

No son respuestas HTTP: se consultan en `error_code` / `error_message` de `ImportJob` y en `code` de `ImportError`.

| Ámbito | Códigos |
| --- | --- |
| Job | `IMPORT_INVALID_FILE`, `IMPORT_LIMIT_EXCEEDED`, `IMPORT_FAILED`, `IMPORT_WORKER_FAILED`, `NO_ACTIVE_CYCLE` |
| Filas CSV | `REQUIRED`, `INVALID_DNI`, `INVALID_DATE`, `INVALID_COURSE`, `INVALID_DIVISION`, `INVALID_TURNO`, `INVALID_RELATIONSHIP`, `SAME_DNI`, `DUPLICATE_DNI`, `DUPLICATE_TUTOR_DNI`, `COURSE_NOT_FOUND`, `CAPACITY_EXCEEDED`, `DNI_IN_USE`, `NO_ACTIVE_CYCLE` |

## Idempotencia

### Cabecera y alcance

- Cabecera obligatoria en los 19 endpoints listados abajo: `Idempotency-Key: <string de 8 a 255 caracteres>`.
- Alcance de la clave (`scopeKey`):
  - Rutas autenticadas: `user:<actorId>`. El propietario de la clave queda registrado como `actorId`.
  - `POST /api/v1/tutores/register` (público): `public:tutor-code:<sha256(codigo)>`; el `codigo` del body reemplaza al actor.
- Identificador de pedido (`requestHash`): `sha256("<METHOD> <baseUrl><path> <body canónico> <extra>")`.
  - El body se canonicaliza: claves de objeto ordenadas, valores `undefined` omitidos, arrays en su orden original, `Buffer` reemplazado por `sha256(contenido)`.
  - Reordenar las claves JSON del body **no** cambia el hash; cambiar el método, la ruta, un valor del body o el contenido del CSV sí.
  - `extra` se usa solo en importaciones: hash del contenido del CSV (`res.locals.csvHash`), por lo que reutilizar la misma clave con otro archivo se considera pedido distinto.
- TTL: `IDEMPOTENCY_TTL_HOURS` (default 24 h). Si la clave expiró, se libera y el pedido se procesa como nuevo. El repositorio expone `deleteExpired()`, pero no hay un job programado que lo invoque: la expiración se resuelve al consultar la clave.

### Flujo

1. Validar presencia y longitud de `Idempotency-Key`; si falta o está fuera de rango → `400 IDEMPOTENCY_KEY_REQUIRED`.
2. Resolver `scopeKey` y calcular `requestHash`.
3. Buscar la clave:
   - Si existe y su hash difiere → `409 IDEMPOTENCY_KEY_REUSED`.
   - Si existe, coincide, no expiró y está `completada` → se devuelve el `statusCode` y `responseBody` guardados, con `Idempotent-Replayed: true`. **No se ejecuta el handler.**
   - Si existe, coincide y está `procesando` → `409 CONFLICT` ("La operación con esa Idempotency-Key todavía está en proceso.").
   - Si expiró → se elimina y se continúa.
4. Reservar la clave con `INSERT ... ON CONFLICT (scope_key, clave) DO NOTHING` en estado `procesando`. Si otra petición la reservó primero, se repite el paso 3; si no se puede resolver → `409 CONFLICT` ("No se pudo reservar la Idempotency-Key.").
5. Al terminar, solo las respuestas `2xx` se marcan `completada` y se guardan (status, body y `resourceId` si el body tiene `id` string). Las respuestas de error se liberan, por lo que **se puede reintentar con la misma clave**.

Ejemplo de replay:

```http
POST /api/v1/admins HTTP/1.1
Idempotency-Key: 4f3a9c2e-8b11-4d0a-9f77-2c6e1a5b0d33
Content-Type: application/json

{"first_name":"Ana","last_name":"Pérez","username":"ana.perez","password":"Secreto123!"}
```

```http
HTTP/1.1 201 Created
Idempotent-Replayed: true
X-Request-Id: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d

{"id":"...","first_name":"Ana","last_name":"Pérez", ...}
```

### Endpoints que la requieren

| Método | Ruta | Alcance | Respuesta en replay |
| --- | --- | --- | --- |
| POST | `/api/v1/tutores/register` | `public:tutor-code:<sha256(codigo)>` (+ rate limit público) | `201 · Tutor` |
| POST | `/api/v1/admins` | `user:<actorId>` | `201 · User` |
| POST | `/api/v1/alumnos` | `user:<actorId>` | `201 · Alumno` |
| POST | `/api/v1/docentes` | `user:<actorId>` | `201 · Docente` |
| POST | `/api/v1/tutores` | `user:<actorId>` | `201 · Tutor` |
| POST | `/api/v1/preceptores` | `user:<actorId>` | `201 · Preceptor` |
| PUT | `/api/v1/preceptores/:id/cursos` | `user:<actorId>` | `200 · Preceptor` |
| POST | `/api/v1/materias` | `user:<actorId>` | `201 · Materia` |
| POST | `/api/v1/inscripciones` | `user:<actorId>` | `201 · Inscripcion` |
| POST | `/api/v1/clases` | `user:<actorId>` | `201 · Clase` |
| POST | `/api/v1/asistencias` | `user:<actorId>` | `201 · Asistencia` |
| POST | `/api/v1/periodos` | `user:<actorId>` | `201 · Periodo` |
| POST | `/api/v1/periodos/:id/cerrar` | `user:<actorId>` | `200 · CierrePeriodo` |
| POST | `/api/v1/instancias-evaluacion` | `user:<actorId>` | `201 · Instancia` |
| POST | `/api/v1/calificaciones` | `user:<actorId>` | `201 · Calificacion` |
| POST | `/api/v1/calificaciones/:id/anular` | `user:<actorId>` | `200 · Calificacion` |
| POST | `/api/v1/calificaciones/:id/rectificar` | `user:<actorId>` | `200 · Calificacion` |
| POST | `/api/v1/imports/alumnos` | `user:<actorId>` + hash del CSV | `202 · ImportJob` (no duplica el job) |
| POST | `/api/v1/cursos` (y alias `/api/v1/cursoDivisionTurno`) | `user:<actorId>` | `201 · Curso` |

Errores propios: `400 IDEMPOTENCY_KEY_REQUIRED` (cabecera ausente o longitud inválida; en rutas públicas sin `publicScope` también `401 UNAUTHENTICATED`), `409 IDEMPOTENCY_KEY_REUSED` (mismo scope y clave con distinto pedido) y `409 CONFLICT` (operación en proceso o carrera al reservar). Ver [Errores](#errores).

## Endpoints

### Salud y operativos

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | No | — | — | — | — | `200 · { status: "ok" }` |
| GET | `/ready` | No | — | — | — | — | `200 · Ready` |
| GET | `/internal/metrics` | Interno | — | — | — | — | `200 · Metrics` |
| POST | `/internal/metrics/reset` | Interno | — | — | — | — | `204 · sin cuerpo` |

Autorización interna: loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) o `x-internal-token` / `Authorization: Bearer` igual a `INTERNAL_METRICS_TOKEN`. `/ready` responde `503` si DB o migraciones no están disponibles.

### Autenticación y sesión

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/login` (alias `/api/v1/login`) | No | — | — | — | `Login` | `200 · Session` |
| POST | `/api/v1/auth/refresh` | No | — | — | — | `Refresh` | `200 · Session` |
| POST | `/api/v1/auth/logout` (alias `/api/v1/logout`) | Bearer | Cualquiera | — | — | `Logout` (opcional) | `204 · sin cuerpo` |
| GET | `/api/v1/me` | Bearer | Cualquiera | — | — | — | `200 · Me` |
| PUT | `/api/v1/password` | Bearer | Cualquiera | — | — | `Password` | `200 · Session` |

### Registro público de tutores

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/tutores/validarCodigo/:codigo` | No | — | `:codigo` string 1–255 | — | — | `200 · TutorCode` |
| POST | `/api/v1/tutores/register` | No | — | — | — | `TutorRegister` | `201 · Tutor` |

### Usuarios y administradores

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/users` | Bearer | `administrador` | — | `usersQuery` | — | `200 · Paginado<User>` |
| PATCH | `/api/v1/users/:id/estado` | Bearer | `administrador` | `:id` UUID | — | `UserState` | `200 · User` |
| POST | `/api/v1/admins` | Bearer | `administrador` | — | — | `AdminCreate` | `201 · User` |
| GET | `/api/v1/admins` | Bearer | `administrador` | — | `paginationQuery` | — | `200 · User[]` |
| GET | `/api/v1/admins/estadisticas` | Bearer | `administrador` | — | — | — | `200 · AdminStats` |
| GET | `/api/v1/admins/:id` | Bearer | `administrador` | `:id` UUID | — | — | `200 · User` |
| PUT | `/api/v1/admins/:id` | Bearer | `administrador` | `:id` UUID | — | `AdminUpdate` | `200 · User` |
| DELETE | `/api/v1/admins/:id` | Bearer | `administrador` | `:id` UUID | — | `Motivo` | `204 · sin cuerpo` |

### Alumnos

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/alumnos` | Bearer | `administrador`, `preceptor`, `docente`, `tutor` | — | `paginationWithCourseQuery` | — | `200 · Alumno[]` |
| POST | `/api/v1/alumnos` | Bearer | `administrador` | — | — | `AlumnoCreate` | `201 · Alumno` |
| GET | `/api/v1/alumnos/:id` | Bearer | `administrador`, `preceptor`, `docente`, `tutor`, `alumno` | `:id` UUID | — | — | `200 · Alumno` |
| PUT | `/api/v1/alumnos/:id` | Bearer | `administrador` | `:id` UUID | — | `AlumnoUpdate` | `200 · Alumno` |
| DELETE | `/api/v1/alumnos/:id` | Bearer | `administrador` | `:id` UUID | — | `Motivo` | `204 · sin cuerpo` |
| GET | `/api/v1/alumnos/:id/inscripciones` | Bearer | `administrador`, `docente`, `alumno`, `tutor` | `:id` UUID | `inscripcionesQuery` | — | `200 · Inscripcion[]` |
| GET | `/api/v1/alumnos/:id/condicion` | Bearer | Todos | `:id` UUID | `alumnoCondicionQuery` | — | `200 · Condicion[]` |

Notas: `GET /alumnos` excluye a `alumno` (403); `GET /alumnos/:id` permite propio id, tutor vinculado, preceptor del curso o docente con materia en el curso; `GET /alumnos/:id/inscripciones` excluye a `preceptor` (403) y exige propiedad/vínculo.

### Docentes

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/docentes` | Bearer | `administrador`, `preceptor` | — | `paginationWithCourseQuery` | — | `200 · Docente[]` |
| POST | `/api/v1/docentes` | Bearer | `administrador` | — | — | `DocenteCreate` | `201 · Docente` |
| GET | `/api/v1/docentes/:id` | Bearer | `administrador`, `preceptor`, `docente` | `:id` UUID | — | — | `200 · Docente` |
| PUT | `/api/v1/docentes/:id` | Bearer | `administrador` | `:id` UUID | — | `DocenteUpdate` | `200 · Docente` |
| DELETE | `/api/v1/docentes/:id` | Bearer | `administrador` | `:id` UUID | — | `Motivo` | `204 · sin cuerpo` |
| GET | `/api/v1/docentes/:id/materias` | Bearer | Todos | `:id` UUID | — | — | `200 · Materia[]` |

### Tutores y vínculos

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/tutores` | Bearer | `administrador` | — | `paginationQuery` | — | `200 · Tutor[]` |
| POST | `/api/v1/tutores` | Bearer | `administrador` | — | — | `TutorCreate` | `201 · Tutor` |
| GET | `/api/v1/tutores/dni/:dni` | Bearer | `administrador` | `:dni` entero | — | — | `200 · Tutor` |
| GET | `/api/v1/tutores/:id` | Bearer | `administrador`, `tutor` | `:id` UUID | — | — | `200 · Tutor` |
| PUT | `/api/v1/tutores/:id` | Bearer | `administrador`, `tutor` | `:id` UUID | — | `TutorUpdate` | `200 · Tutor` |
| DELETE | `/api/v1/tutores/:id` | Bearer | `administrador` | `:id` UUID | — | `Motivo` | `204 · sin cuerpo` |
| GET | `/api/v1/tutores/:id/alumnos` | Bearer | `administrador`, `tutor` | `:id` UUID | — | — | `200 · Alumno[]` |
| DELETE | `/api/v1/tutor-alumno/:id` | Bearer | `administrador` | `:id` UUID | — | — | `204 · sin cuerpo` |

Nota: el tutor solo puede consultarse/modificarse a sí mismo; el cambio de `email` requiere `administrador`.

### Preceptores

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/preceptores` | Bearer | `administrador` | — | `paginationWithCourseQuery` | — | `200 · Paginado<Preceptor>` |
| POST | `/api/v1/preceptores` | Bearer | `administrador` | — | — | `PreceptorCreate` | `201 · Preceptor` |
| GET | `/api/v1/preceptores/:id` | Bearer | `administrador`, `preceptor` | `:id` UUID | — | — | `200 · Preceptor` |
| PUT | `/api/v1/preceptores/:id/cursos` | Bearer | `administrador` | `:id` UUID | — | `PreceptorCourses` | `200 · Preceptor` |
| PUT | `/api/v1/preceptores/:id` | Bearer | `administrador` | `:id` UUID | — | `PreceptorUpdate` | `200 · Preceptor` |
| DELETE | `/api/v1/preceptores/:id` | Bearer | `administrador` | `:id` UUID | — | `Motivo` | `204 · sin cuerpo` |

### Cursos

Disponibles también bajo el alias `/api/v1/cursoDivisionTurno` con idénticos params, query, body y respuesta.

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/cursos` | Bearer | Todos | — | `cursosQuery` | — | `200 · Paginado<Curso>` |
| POST | `/api/v1/cursos` | Bearer | `administrador` | — | — | `CursoCreate` | `201 · Curso` |
| GET | `/api/v1/cursos/:id/alumnos` | Bearer | `administrador`, `preceptor`, `docente` | `:id` entero | — | — | `200 · Alumno[]` |
| GET | `/api/v1/cursos/:id/materias` | Bearer | Todos | `:id` entero | — | — | `200 · Materia[]` |
| GET | `/api/v1/cursos/:id` | Bearer | Todos | `:id` entero | — | — | `200 · Curso` |
| PUT | `/api/v1/cursos/:id` | Bearer | `administrador` | `:id` entero | — | `CursoUpdate` | `200 · Curso` |
| DELETE | `/api/v1/cursos/:id` | Bearer | `administrador` | `:id` entero | — | — | `204 · sin cuerpo` |

### Materias

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/materias` | Bearer | Todos | — | `materiasQuery` | — | `200 · Materia[]` |
| POST | `/api/v1/materias` | Bearer | `administrador` | — | — | `MateriaCreate` | `201 · Materia` |
| GET | `/api/v1/materias/:id` | Bearer | Todos | `:id` entero | — | — | `200 · Materia` |
| PUT | `/api/v1/materias/:id` | Bearer | `administrador` | `:id` entero | — | `MateriaUpdate` | `200 · Materia` |
| DELETE | `/api/v1/materias/:id` | Bearer | `administrador` | `:id` entero | — | — | `204 · sin cuerpo` |
| GET | `/api/v1/materias/:id/inscripciones` | Bearer | `administrador`, `docente` | `:id` entero | `inscripcionesQuery` | — | `200 · Inscripcion[]` |

### Inscripciones

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/inscripciones` | Bearer | `administrador`, `docente`, `alumno`, `tutor` | — | `inscripcionesQuery` | — | `200 · Inscripcion[]` |
| POST | `/api/v1/inscripciones` | Bearer | `administrador`, `alumno` | — | — | `InscripcionCreate` | `201 · Inscripcion` |
| GET | `/api/v1/inscripciones/:id` | Bearer | `administrador`, `docente`, `alumno`, `tutor` | `:id` entero | — | — | `200 · Inscripcion` |
| PUT | `/api/v1/inscripciones/:id/estado` | Bearer | `administrador`, `docente` | `:id` entero | — | `InscripcionEstado` | `200 · Inscripcion` |
| DELETE | `/api/v1/inscripciones/:id` | Bearer | `administrador` | `:id` entero | — | — | `204 · sin cuerpo` |

Notas: `alumno` solo puede enviar su propio `alumno_id`; `preceptor` no puede listar (403) ni ver una inscripción ajena (404). DELETE cancela la inscripción en lugar de borrarla.

### Clases

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/clases` | Bearer | Todos | — | `clasesQuery` | — | `200 · Paginado<Clase>` |
| POST | `/api/v1/clases` | Bearer | `administrador`, `docente` | — | — | `ClaseCreate` | `201 · Clase` |
| GET | `/api/v1/clases/:id` | Bearer | Todos | `:id` UUID | — | — | `200 · Clase` |
| PUT | `/api/v1/clases/:id` | Bearer | `administrador`, `docente` | `:id` UUID | — | `ClaseUpdate` | `200 · Clase` |

### Asistencias

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/asistencias?clase_id=...` | Bearer | Todos | — | `asistenciasQuery` (`clase_id` requerido en la práctica) | — | `200 · AsistenciasPorClase` |
| GET | `/api/v1/asistencias?alumno_id=...&periodo_id=...` | Bearer | Todos | — | `asistenciasQuery` (`alumno_id` + `periodo_id`) | — | `200 · Asistencia[]` |
| GET | `/api/v1/asistencias?alumno_id=...` | Bearer | Todos | — | `asistenciasQuery` (`alumno_id`) | — | `200 · Asistencia[]` |
| GET | `/api/v1/asistencias` | Bearer | Cualquiera | — | `asistenciasQuery` (sin filtros) | — | `200 · Asistencia[]` |
| POST | `/api/v1/asistencias` | Bearer | `administrador`, `docente`, `preceptor` | — | — | `AsistenciaCreate` | `201 · Asistencia` |
| PUT | `/api/v1/asistencias/:id/justificacion` | Bearer | `administrador`, `docente`, `preceptor` | `:id` UUID | — | `AsistenciaJustify` | `200 · Asistencia` |
| PUT | `/api/v1/asistencias/:id` | Bearer | `administrador`, `docente`, `preceptor` | `:id` UUID | — | `AsistenciaUpdate` | `200 · Asistencia` |

Nota: documentalmente es un único `GET /api/v1/asistencias`; la respuesta cambia según el filtro. Sin filtros no se aplica scope por rol y devuelve todas las asistencias.

### Períodos y condiciones

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/periodos` | Bearer | Todos | — | `periodosQuery` | — | `200 · Paginado<Periodo>` |
| POST | `/api/v1/periodos` | Bearer | `administrador` | — | — | `PeriodoCreate` | `201 · Periodo` |
| GET | `/api/v1/periodos/:id` | Bearer | Todos | `:id` UUID | — | — | `200 · Periodo` |
| PUT | `/api/v1/periodos/:id` | Bearer | `administrador` | `:id` UUID | — | `PeriodoUpdate` | `200 · Periodo` |
| POST | `/api/v1/periodos/:id/cerrar` | Bearer | `administrador` | `:id` UUID | — | — | `200 · CierrePeriodo` |
| GET | `/api/v1/periodos/:id/condiciones` | Bearer | Todos | `:id` UUID | `condicionesPeriodoQuery` | — | `200 · Paginado<Condicion>` |

### Instancias de evaluación

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/instancias-evaluacion` | Bearer | `administrador`, `docente` | — | `instanciasQuery` | — | `200 · Paginado<Instancia>` |
| POST | `/api/v1/instancias-evaluacion` | Bearer | `administrador`, `docente`, `preceptor` | — | — | `InstanciaCreate` | `201 · Instancia` |
| GET | `/api/v1/instancias-evaluacion/:id` | Bearer | Todos | `:id` UUID | — | — | `200 · Instancia` |
| PUT | `/api/v1/instancias-evaluacion/:id` | Bearer | `administrador`, `docente`, `preceptor` | `:id` UUID | — | `InstanciaUpdate` | `200 · Instancia` |

### Calificaciones

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/calificaciones` | Bearer | Todos | — | `calificacionesQuery` | — | `200 · Paginado<Calificacion>` |
| POST | `/api/v1/calificaciones` | Bearer | `administrador`, `docente`, `preceptor` | — | — | `CalificacionCreate` | `201 · Calificacion` |
| GET | `/api/v1/calificaciones/:id` | Bearer | Todos | `:id` UUID | — | — | `200 · Calificacion` |
| PUT | `/api/v1/calificaciones/:id` | Bearer | `administrador`, `docente`, `preceptor` | `:id` UUID | — | `CalificacionUpdate` | `200 · Calificacion` |
| POST | `/api/v1/calificaciones/:id/anular` | Bearer | `administrador`, `docente`, `preceptor` | `:id` UUID | — | `CalificacionAnnul` | `200 · Calificacion` |
| GET | `/api/v1/calificaciones/:id/historial` | Bearer | Todos | `:id` UUID | — | — | `200 · Auditoria[]` |
| POST | `/api/v1/calificaciones/:id/rectificar` | Bearer | `administrador` | `:id` UUID | — | `CalificacionRectify` | `200 · Calificacion` |

### Importaciones y auditoría

| Método | Ruta | Auth | Rol | Params | Query | Body | OK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/imports/alumnos` | Bearer | `administrador` | — | — | `CsvUpload` | `202 · ImportJob` |
| GET | `/api/v1/imports/:id` | Bearer | `administrador` | `:id` UUID | — | — | `200 · ImportJob` |
| GET | `/api/v1/imports/:id/errores` | Bearer | `administrador` | `:id` UUID | `errorsQuery` | — | `200 · Paginado<ImportError>` |
| GET | `/api/v1/auditoria` | Bearer | Todos | — | `auditoriaQuery` | — | `200 · Paginado<Auditoria>` |

Notas: `POST /imports/alumnos` usa rate limit propio, requiere `Idempotency-Key` y el hash del CSV se incluye en la clave de idempotencia. `GET /auditoria` muestra solo los eventos propios de `actorId` para roles no administradores. `Accion` en `Auditoria`: `crear|actualizar|eliminar|desactivar|reactivar|rectificar|cerrar|recalcular_condicion|registrar|justificar`.
