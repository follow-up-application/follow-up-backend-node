# Ataque cruzado entre grupos

Plantilla y bitácora para el ejercicio de seguridad donde cada grupo usa sus credenciales/tokens contra el despliegue del otro grupo. La bitácora de referencia se apoya en [tests/security/access-control.test.ts](../tests/security/access-control.test.ts); en la sesión presencial debe completarse con la fila real correspondiente.

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

## Matriz de ataque por rol y recurso

La matriz asume un token válido del rol indicado contra un recurso ajeno del otro grupo. Cada celda indica `lectura / escritura`; en escritura se agrupan crear, actualizar, eliminar y acciones especiales.

| Leyenda | Significado |
| --- | --- |
| `200`, `201`, `202`, `204` | Operación permitida por RBAC. |
| `401` | Falta token válido. |
| `403` | Rol sin permiso para la operación. |
| `404` | Recurso ajeno fuera de alcance; bloquea IDOR. |
| `(propio)` | Solo sobre el usuario/vínculo propio. |
| `—` | No aplica. |

| Recurso objetivo | Anónimo | Administrador | Preceptor | Docente | Alumno | Tutor |
| --- | --- | --- | --- | --- | --- | --- |
| Sesión protegida (`/me`, `/password`, `/auth/logout`) | `401 / 401` | `200 (propio) / 200 (propio)` | `200 (propio) / 200 (propio)` | `200 (propio) / 200 (propio)` | `200 (propio) / 200 (propio)` | `200 (propio) / 200 (propio)` |
| Usuarios y administradores | `401 / 401` | `200 / 201` | `403 / 403` | `403 / 403` | `403 / 403` | `403 / 403` |
| Alumnos | `401 / 401` | `200 / 201` | `404 / 403` | `404 / 403` | `404 / 403` | `404 / 403` |
| Docentes | `401 / 401` | `200 / 201` | `200 / 403` | `404 (propio) / 403` | `403 / 403` | `403 / 403` |
| Tutores y vínculos | `401 / 401` | `200 / 201` | `403 / 403` | `403 / 403` | `403 / 403` | `404 (propio) / 404 (propio)` |
| Preceptores | `401 / 401` | `200 / 201` | `404 (propio) / 403` | `403 / 403` | `403 / 403` | `403 / 403` |
| Cursos y materias | `401 / 401` | `200 / 201` | `200 / 403` | `200 / 403` | `200 / 403` | `200 / 403` |
| Inscripciones | `401 / 401` | `200 / 201` | `403 / 403` | `404 / 404` | `404 / 403 (propio: 201)` | `404 / 403` |
| Clases | `401 / 401` | `200 / 201` | `404 / 403` | `404 / 201` | `404 / 403` | `404 / 403` |
| Asistencias | `401 / 401` | `200 / 201` | `404 / 404` | `404 / 404` | `404 / 403` | `404 / 403` |
| Períodos y condiciones | `401 / 401` | `200 / 201` | `404 / 403` | `404 / 403` | `404 / 403` | `404 / 403` |
| Instancias y calificaciones | `401 / 401` | `200 / 201` | `404 / 404` | `404 / 404` | `404 / 403` | `404 / 403` |
| Importaciones CSV | `401 / 401` | `202 / 202` | `403 / 403` | `403 / 403` | `403 / 403` | `403 / 403` |
| Auditoría | `401 / —` | `200 (todas) / —` | `200 (propias) / —` | `200 (propias) / —` | `200 (propias) / —` | `200 (propias) / —` |

Notas: `login`, `refresh`, `validarCodigo` y `register` son públicos. En inscripciones, el preceptor recibe `403` al listar y `404` al consultar un id ajeno. En docentes, la matriz considera el detalle; `GET /docentes/:id/materias` es de lectura autenticada para todos los roles. `POST /calificaciones/:id/rectificar` es exclusivo de `administrador` (`403` para preceptor y docente aunque puedan cargar o anular). `GET /asistencias` sin filtros devuelve todas las asistencias; no usar ese atajo para inferir permisos por rol.

Fuente: tabla de endpoints de `docs/api.md:830-1025` y asserts de [tests/security/access-control.test.ts:45-340](../tests/security/access-control.test.ts#L45-L340).

## Hipótesis

| ID | Hipótesis | Validación |
| --- | --- | --- |
| H-AUT | Un atacante sin token o con token forjado, expirado o alterado no puede leer recursos protegidos. | Enviar pedidos sin `Authorization`, con JWT firmado con otro secreto, expirado y modificado; esperar `401 UNAUTHENTICATED`. |
| H-REFRESH | La reutilización de un refresh token revela robo y revoca toda la familia. | Rotar el refresh, reutilizar el anterior y probar el nuevo; esperar `401 TOKEN_REUSE_DETECTED`. |
| H-PWD | Un usuario con `must_change_password=true` solo puede acceder a `/me` y `/password`. | Consultar `/alumnos` con el token restringido; esperar `403 PASSWORD_CHANGE_REQUIRED`. |
| H-IDOR | Un rol autorizado no puede leer ni modificar recursos ajenos al otro grupo o a otro usuario. | Usar los IDs del fixture ajeno en alumnos, calificaciones, inscripciones, asistencias, cursos y condición; esperar `404`. |
| H-RBAC | Un rol sin permiso no puede ejecutar acciones exclusivas de otro rol. | Cerrar período, rectificar nota, importar CSV, listar usuarios y listar tutores; esperar `403`. |
| H-HARD | La API no expone secretos ni trazas y rechaza entradas manipuladas. | Buscar `password_hash` y `$argon2`, enviar `__proto__`, SQLi y campos desconocidos; esperar `401` o `422` sin contaminar objetos globales. |
| H-RL | El login limita la tasa de intentos fallidos desde la misma IP. | Enviar 6 intentos fallidos; esperar `429 RATE_LIMITED` con `Retry-After`. |

## Evidencia

Cada intento debe dejar evidencia reproducible y enlazada a su ID de bitácora:

| Tipo | Qué capturar | Dónde |
| --- | --- | --- |
| Pedido | Método, URL completa, headers relevantes (`Authorization` enmascarado, `Idempotency-Key`, `X-Request-Id`) y body. | Postman/curl o [tests/security/access-control.test.ts](../tests/security/access-control.test.ts). |
| Respuesta | Código HTTP, `error.code`, `requestId`, headers (`Retry-After`) y cuerpo sin secretos. | Captura o archivo de log. |
| Contexto | Rol atacante, IP de origen, `baseUrl`, fecha/hora e IDs del fixture ajeno. | Bitácora. |
| Estado global | Para prototype pollution, comprobar que `{}` no tenga `polluted`. | Assert o consola. |
| Referencia | Líneas del test automatizado que cubren el vector. | Bitácora de referencia. |

Los tokens se registran enmascarados: no pegar `refresh_token`, contraseñas ni secretos reales.

## Resultado esperado

- Éxito del ejercicio: cada intento obtiene el código descrito en la matriz y en la bitácora de referencia, sin accesos de lectura o escritura indebidos.
- Fallo a investigar: `200`, `201`, `202` o `204` donde la matriz indica `401`, `403` o `404`; datos ajenos devueltos; `password_hash`, `$argon2` o stack traces en la respuesta.
- Criterio de cierre: vector detenido, grupo defensor y docente notificados, evidencia conservada y fila de bitácora marcada como `Confirmado`, `no reproducido` o `mitigado`.
- La corrida de referencia no registró accesos indebidos: ver la bitácora de referencia y los asserts de [tests/security/access-control.test.ts:45-340](../tests/security/access-control.test.ts#L45-L340).

## Tests de seguridad existentes

| Archivo | Qué cubre | Ejecución |
| --- | --- | --- |
| [tests/security/access-control.test.ts](../tests/security/access-control.test.ts) | Autenticación, refresh, IDOR, RBAC, endurecimiento de entradas y rate limit; asserts en `:45-340`. | `npm run test:security` |
| [tests/helpers/http.ts](../tests/helpers/http.ts) | `SEED`, `CREDENTIALS`, `enableSeedLogins()` (`:39-46`) y `login()`. | Uso interno del test |
| [tests/helpers/fixtures.ts](../tests/helpers/fixtures.ts) | `createForeignFixture()` (`:53-117`) para recursos ajenos. | Uso interno del test |
| [tests/global-setup.ts](../tests/global-setup.ts) | Reset de la base de test; exige `DATABASE_TEST_URL` en `:23`. | `npm run test:security` |

Requisito local: `DATABASE_TEST_URL=postgres://follow:follow@localhost:5432/follow_test` y base `follow_test` creada. Para reproducción manual, usar la colección [follow-up-api.postman_collection.json](postman/follow-up-api.postman_collection.json).

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
- Usuarios de prueba: ver tabla de `README.md`. Los roles `preceptor`, `docente` y `alumno` tienen `must_change_password=true`; el test los habilita con `enableSeedLogins()` en [tests/helpers/http.ts:39-46](../tests/helpers/http.ts#L39-L46).
- Fixture de "grupo ajeno": `createForeignFixture()` en [tests/helpers/fixtures.ts:53-117](../tests/helpers/fixtures.ts#L53-L117) crea curso `7-Z-Tarde`, docente DNI `30999001`, alumno DNI `40999002`, materia `9001`, clase e instancia ajenas.
- Tokens de la corrida de referencia: se obtienen en [tests/security/access-control.test.ts:20-29](../tests/security/access-control.test.ts#L20-L29) con IPs `10.20.0.1` a `10.20.0.5`.
- Ejecución automatizada:

```bash
Copy-Item .env.example .env        # PowerShell
# cp .env.example .env             # Bash/Git Bash
# Ajustar DATABASE_TEST_URL=postgres://follow:follow@localhost:5432/follow_test
npm run test:security
```

La suite reinicia la base de test en [tests/global-setup.ts](../tests/global-setup.ts); no ejecutarla contra una base compartida o de producción.

## Bitácora por fase

Completar una fila por fase. La fase "durante" se detalla después con la plantilla por intento; la bitácora de referencia al final del documento cubre esa fase con la corrida automatizada.

### Previa al ataque

| Campo | Contenido |
| --- | --- |
| ID de sesión | `ATAQUE-YYYYMMDD-<GRUPO>` |
| Fecha/hora de inicio | `YYYY-MM-DD HH:mm` |
| Atacante / defensor | Grupos y responsables |
| `baseUrl` acordado | `http://<IP>:3000` |
| Alcance confirmado | Endpoints permitidos y reglas de compromiso aceptadas |
| Credenciales preparadas | Usuarios seed y tokens enmascarados por rol |
| Fixture ajeno | IDs del fixture creado o proporcionado por el defensor |
| Variables Postman | `reuseIdempotencyKey=false`, `importIdempotencyKey`, `tutorCodigoRegistro`, tokens por rol |
| Estado del entorno | `/health` 200, `/ready` 200, versión o commit desplegado |
| Evidencia inicial | Captura de `/health`, `/ready` y hash del commit |

### Durante el ataque

| Campo | Contenido |
| --- | --- |
| ID del intento | `AUT-01`, `IDOR-03`, etc. |
| Fecha/hora | `YYYY-MM-DD HH:mm` |
| Hipótesis | `H-AUT`, `H-IDOR`, etc. |
| Vector y rol atacante | Token, IDOR, RBAC, idempotencia o validación; rol usado |
| Método y ruta | `GET /api/v1/...` |
| Actor/credencial | Usuario y token enmascarado |
| Resultado esperado | Código HTTP y `error.code` según la matriz |
| Resultado obtenido | Código HTTP, `error.code` y `requestId` |
| Evidencia | Postman/curl, captura o archivo de log |
| Impacto | Ninguno / lectura indebida / escritura indebida |
| Estado | Confirmado / no reproducido / mitigado |

Repetir esta tabla por cada intento; el detalle mínimo exigido está en la plantilla siguiente.

### Posterior al ataque

| Campo | Contenido |
| --- | --- |
| Fecha/hora de cierre | `YYYY-MM-DD HH:mm` |
| Intentos ejecutados | Cantidad total |
| Accesos indebidos | `0` o lista de IDs de intentos |
| Hallazgos | Resumen de vulnerabilidades confirmadas |
| Notificación | Defensor y docente: fecha/hora y canal |
| Limpieza | Logout, rotación de tokens, borrado de fixtures temporales y restauración de variables |
| Evidencia archivada | Ruta o nombre de archivo de capturas y logs |
| Estado final | Cerrado / abierto por hallazgo |
| Acciones correctivas | Cambios propuestos o aplicados y responsable |

## Plantilla de hallazgos (completar por vulnerabilidad confirmada)

| Campo | Contenido |
| --- | --- |
| ID | `HAL-01`, `HAL-02`, etc. |
| Título | Nombre breve del hallazgo |
| Intento relacionado | `AUT-01`, `IDOR-03`, etc. |
| Hipótesis | `H-AUT`, `H-IDOR`, etc., que se confirmó |
| Severidad | Crítica / Alta / Media / Baja |
| Criterio | Impacto, alcance y facilidad de explotación |
| Clasificación | CWE / OWASP Top 10 si aplica |
| Recurso | Método, ruta y parámetros afectados |
| Actor | Rol atacante y token enmascarado |
| Resultado esperado | Código HTTP y `error.code` según la matriz |
| Resultado obtenido | Código HTTP, cuerpo relevante y `requestId` |
| Reproducción | Precondiciones, pasos numerados, request exacto y respuesta |
| Evidencia | Captura, log o test automatizado sin secretos |
| Impacto | Lectura indebida / escritura indebida / escalada / fuga de datos / denegación |
| Causa raíz | Validación, alcance, middleware o configuración faltante |
| Corrección | Control a agregar, archivo o función a modificar y criterio de aceptación |
| Verificación | Cómo demostrar la mitigación y test de regresión asociado |
| Estado | Abierto / en corrección / mitigado / cerrado |
| Responsable y fecha | Grupo defensor y `YYYY-MM-DD` |

Criterios de severidad:

| Severidad | Criterio |
| --- | --- |
| Crítica | Acceso total no autorizado, creación de administradores o compromiso de secretos. |
| Alta | Lectura o escritura de datos ajenos, escalada de roles o evasión de control de acceso. |
| Media | Fuga de metadatos sensibles, stack traces o inconsistencia de idempotencia con impacto parcial. |
| Baja | Validación laxa o ruido informativo sin acceso indebido directo. |

La bitácora de referencia no registra hallazgos abiertos: todos los vectores fueron bloqueados. Si aparece un acceso indebido, se crea una fila `HAL-NN`, se detiene el vector y se completa la corrección antes de cerrar la sesión.

## Plantilla de bitácora durante el ataque (completar por intento)

| Campo | Contenido |
| --- | --- |
| ID | `AUT-01`, `IDOR-03`, etc. |
| Fecha/hora | `YYYY-MM-DD HH:mm` |
| Atacante -> Defensor | Grupo y responsable |
| Hipótesis | Enunciado de `H-AUT`, `H-IDOR`, etc. |
| Vector | Token, IDOR, rol, idempotencia, validación, etc. |
| Método y ruta | `GET /api/v1/...` |
| Actor/credencial | Usuario y token enmascarado |
| Resultado esperado | Código HTTP y `error.code` |
| Resultado obtenido | Código HTTP, `error.code`, `requestId` |
| Evidencia | Postman/curl, captura o archivo de log |
| Impacto | Ninguno / lectura indebida / escritura indebida |
| Estado | Confirmado / no reproducido / mitigado |

## Bitácora de referencia (evidencia automatizada)

Los resultados son los asserts de [tests/security/access-control.test.ts](../tests/security/access-control.test.ts). "OK" significa que el servidor respondió como se esperaba y el acceso fue bloqueado.

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

La suite de referencia no registró accesos indebidos: todos los intentos de autenticación, acceso cruzado, escalada de roles y endurecimiento fueron rechazados con el estado esperado. La ejecución local de `npm run test:security` requiere `DATABASE_TEST_URL` y una base `follow_test` disponible; si falta, Vitest falla en [tests/global-setup.ts:23](../tests/global-setup.ts#L23) antes de correr los casos.
