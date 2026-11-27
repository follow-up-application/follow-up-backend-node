# Ataque cruzado entre grupos

Plantilla y bitácora para el ejercicio de seguridad donde cada grupo usa sus credenciales/tokens contra el despliegue del otro grupo. La bitácora de referencia se apoya en `tests/security/access-control.test.ts`; en la sesión presencial debe completarse con la fila real correspondiente.

## Alcance

- API REST `/api/v1` de Follow App y endpoints operativos `/health`, `/ready`, `/internal/metrics`.
- Identidad (login, refresh, logout, cambio de contraseña, usuarios por rol), académico, asistencia, calificaciones, importación CSV y auditoría.
- Vectores permitidos: ausencia/falsificación de token, reutilización de refresh, acceso cruzado por IDOR, escalada de roles, idempotencia, validación de entrada y exposición de datos sensibles.
- Fuera de alcance: producción, bases de datos reales de terceros, infraestructura ajena a la API, ingeniería social, DoS sostenido y modificación destructiva de datos del otro grupo.

## Reglas de compromiso

1. Cada grupo publica solo su `baseUrl` local/LAN y credenciales ficticias del seed. No se intercambian secretos reales ni tokens de producción.
2. Los intentos se hacen con HTTP (Postman o `curl`) contra el despliegue del otro grupo. No se accede directamente a su PostgreSQL.
3. No se eliminan ni alteran recursos del otro grupo; si hace falta un fixture, se crea uno temporal y se documenta.
4. No se ejecutan fuerza bruta masiva ni pruebas de carga. La única prueba de límite de tasa es la controlada de `POST /api/v1/auth/login`.
5. Cada intento se registra con fecha/hora, método, ruta, actor, resultado HTTP, `error.code`, `X-Request-Id` (cuando aplique) y evidencia.
6. Los tokens se muestran enmascarados en la bitácora (por ejemplo, `eyJ...abc`).
7. Ante un acceso indebido confirmado, se detiene el vector, se notifica al grupo defensor y al docente, y se conserva la evidencia.
8. La colección Postman debe ejecutarse en orden; los casos de error van al final y requieren variables `reuseIdempotencyKey`, `importIdempotencyKey` y `tutorCodigoRegistro` ajustadas.

## Participantes

| Rol en el ejercicio | Grupo | Responsable | `baseUrl` publicado | Credenciales usadas | Contacto |
| --- | --- | --- | --- | --- | --- |
| Atacante A | Grupo A | Completar | `http://<IP-A>:3000` | Seed del Grupo A | Completar |
| Defensor B | Grupo B | Completar | `http://<IP-B>:3000` | Seed del Grupo B | Completar |
| Atacante B | Grupo B | Completar | `http://<IP-B>:3000` | Seed del Grupo B | Completar |
| Defensor A | Grupo A | Completar | `http://<IP-A>:3000` | Seed del Grupo A | Completar |
| Coordinación | Docente | Completar | - | - | Completar |

Los usuarios seed son `admin`, `preceptor`, `docente`, `alumno` y `tutor` según `README.md`. Cada grupo obtiene su token con `POST /api/v1/auth/login`.

## Entorno

- Node.js 22+, PostgreSQL 16 (Docker), `npm ci`, `npm run setup`, `npm run dev`.
- `baseUrl` por defecto: `http://localhost:3000`. En el cruce entre grupos se reemplaza por la IP/puerto publicados.
- Usuarios de prueba: ver tabla de `README.md`. Los roles `preceptor`, `docente` y `alumno` tienen `must_change_password=true`; el test los habilita con `enableSeedLogins()` en `tests/helpers/http.ts:39-46`.
- Fixture de "grupo ajeno": `createForeignFixture()` en `tests/helpers/fixtures.ts:53-117` crea curso `7-Z-Tarde`, docente DNI `30999001`, alumno DNI `40999002`, materia `9001`, clase e instancia ajenas.
- Tokens de la corrida de referencia: se obtienen en `tests/security/access-control.test.ts:20-29` con IPs `10.20.0.1` a `10.20.0.5`.
- Ejecución automatizada:

```bash
Copy-Item .env.example .env        # PowerShell
# cp .env.example .env             # Bash/Git Bash
# Ajustar DATABASE_TEST_URL=postgres://follow:follow@localhost:5432/follow_test
npm run test:security
```

La suite reinicia la base de test en `tests/global-setup.ts`; no ejecutarla contra una base compartida o de producción.

## Plantilla de bitácora (completar por intento)

| Campo | Contenido |
| --- | --- |
| ID | `AUT-01`, `IDOR-03`, etc. |
| Fecha/hora | `YYYY-MM-DD HH:mm` |
| Atacante -> Defensor | Grupo y responsable |
| Objetivo | Que se intenta demostrar |
| Vector | Token, IDOR, rol, idempotencia, validación, etc. |
| Método y ruta | `GET /api/v1/...` |
| Actor/credencial | Usuario y token enmascarado |
| Resultado esperado | Código HTTP y `error.code` |
| Resultado obtenido | Código HTTP, `error.code`, `requestId` |
| Evidencia | Postman/curl, captura o archivo de log |
| Impacto | Ninguno / lectura indebida / escritura indebida |
| Estado | Confirmado / no reproducido / mitigado |

## Bitácora de referencia (evidencia automatizada)

Los resultados son los asserts de `tests/security/access-control.test.ts`. "OK" significa que el servidor respondió como se esperaba y el acceso fue bloqueado.

| ID | Vector | Método y ruta | Atacante -> Defensor | Resultado esperado | Referencia | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| AUT-01 | Sin token | `GET /api/v1/me` | Anónimo -> API | 401 `UNAUTHENTICATED` | `:45-47` | OK |
| AUT-02 | JWT forjado con otro secreto | `GET /api/v1/me` | Atacante -> API | 401 `UNAUTHENTICATED` | `:49-59` | OK |
| AUT-03 | JWT expirado | `GET /api/v1/me` | Atacante -> API | 401 | `:61-69` | OK |
| AUT-04 | Firma alterada | `GET /api/v1/me` | Atacante -> API | 401 | `:71-75` | OK |
| AUT-05 | `must_change_password` | `GET /api/v1/alumnos` | Usuario restringido -> API | 403 `PASSWORD_CHANGE_REQUIRED` | `:78-141` | OK |
| AUT-06 | Reutilización de refresh | `POST /api/v1/auth/refresh` | Tutora -> API | 401 `TOKEN_REUSE_DETECTED` y familia revocada | `:144-168` | OK |
| IDOR-01 | Alumno ajeno | `GET /api/v1/alumnos/:foreignId` | Alumno -> Otro alumno | 404 | `:173-174` | OK |
| IDOR-02 | Notas ajenas | `GET /api/v1/calificaciones?alumno_id=<foreign>` | Alumno -> Otro alumno | 404 | `:176-181` | OK |
| IDOR-03 | Inscripción ajena | `POST /api/v1/inscripciones` | Alumno -> Otro alumno | 403 `FORBIDDEN` | `:183-188` | OK |
| IDOR-04 | Nota de materia ajena | `POST /api/v1/calificaciones` | Docente -> Otro docente | 404 | `:190-195` | OK |
| IDOR-05 | Asistencia de clase ajena | `GET /api/v1/asistencias?clase_id=<foreign>` | Docente -> Otro docente | 404 | `:197-202` | OK |
| IDOR-06 | Curso ajeno | `GET /api/v1/alumnos?curso_division_turno_id=<foreign>` | Preceptor -> Otro preceptor | 404 | `:204-209` | OK |
| IDOR-07 | Alumno no vinculado | `GET /api/v1/alumnos/:foreignId` | Tutor -> Otro tutor | 404 | `:211-212` | OK |
| IDOR-08 | Condición no vinculada | `GET /api/v1/alumnos/:foreignId/condicion` | Tutor -> Otro tutor | 404 | `:214-219` | OK |
| RBAC-01 | Cerrar período | `POST /api/v1/periodos/:id/cerrar` | Alumno -> API | 403 | `:223-224` | OK |
| RBAC-02 | Rectificar calificación | `POST /api/v1/calificaciones/:id/rectificar` | Docente -> API | 403 | `:226-231` | OK |
| RBAC-03 | Importar CSV | `POST /api/v1/imports/alumnos` | Preceptor -> API | 403 | `:233-236` | OK |
| RBAC-04 | Listar usuarios | `GET /api/v1/users` | Alumno -> API | 403 | `:238-239` | OK |
| RBAC-05 | Listar tutores | `GET /api/v1/tutores` | Preceptor -> API | 403 | `:241-242` | OK |
| RBAC-06 | Crear admin público | `POST /api/v1/admins` | Anónimo -> API | 401 | `:244-250` | OK |
| HARD-01 | Fuga de hashes | `POST /api/v1/auth/login`, `GET /api/v1/users` | Admin -> API | Sin `password_hash` ni `$argon2` | `:256-267` | OK |
| HARD-02 | Stack trace | `GET /api/v1/alumnos/:randomUuid` | Admin -> API | 404 sin `at ` y con `requestId` | `:269-273` | OK |
| HARD-03 | Prototype pollution | `POST /api/v1/auth/login`, `POST /api/v1/alumnos` | Atacante -> API | 422 `VALIDATION_ERROR`, globales limpios | `:276-299` | OK |
| HARD-04 | Inyección SQL en login | `POST /api/v1/auth/login` | Atacante -> API | 401 `INVALID_CREDENTIALS` | `:302-308` | OK |
| HARD-05 | Inyección en filtros | `GET /api/v1/users?role=...` | Admin -> API | 422 `VALIDATION_ERROR` | `:310-316` | OK |
| HARD-06 | Campo desconocido | `POST /api/v1/auth/login` | Atacante -> API | 422 `VALIDATION_ERROR` | `:318-323` | OK |
| HARD-07 | Rate limit de login | 6 x `POST /api/v1/auth/login` | Atacante -> API | 429 `RATE_LIMITED` con `Retry-After` | `:329-340` | OK |

## Resultado

La suite de referencia no registró accesos indebidos: todos los intentos de autenticación, acceso cruzado, escalada de roles y endurecimiento fueron rechazados con el estado esperado. La ejecución local de `npm run test:security` requiere `DATABASE_TEST_URL` y una base `follow_test` disponible; si falta, Vitest falla en `tests/global-setup.ts:23` antes de correr los casos.
