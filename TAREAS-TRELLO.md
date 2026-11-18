# Tareas pendientes para Trello - Follow App Backend

Fecha de corte: 2026-11-03
Base: `ESTADO-MIGRACION.md` (2026-10-30) + verificacion del repositorio al 2026-11-03.

Este archivo esta pensado para crear una tarjeta por cada bloque `Txx`. Cada tarjeta incluye lista sugerida, prioridad, estimacion, dependencias, contexto y criterios de aceptacion.

## Como usar

1. Crear en Trello las listas: `Pendiente - Alta`, `Pendiente - Media`, `Cierre y entrega` y `Hecho`.
2. Crear una tarjeta por bloque `Txx` usando el titulo del encabezado.
3. Copiar en la descripcion el contenido del bloque.
4. Usar el checklist como subtareas de la tarjeta.
5. No crear tarjetas para los items de la seccion "Ya resuelto".

## Etiquetas sugeridas

`backend`, `tests`, `docs`, `infra`, `entrega`, `alta`, `media`, `opcional`, `decision`.

## Resumen del tablero

> Las secciones estan agrupadas por lista de Trello. Los IDs no siguen el orden de las secciones; usar esta tabla como indice.

| ID | Tarjeta | Lista | Prioridad | Estimacion | Depende de |
| --- | --- | --- | --- | --- | --- |
| T01 | Suite de integracion CRUD y flujo completo por HTTP | Pendiente - Alta | Alta | L (4-6 h) | - |
| T02 | Ampliar suite de dominio: entidades, value objects y transiciones | Pendiente - Alta | Alta | M (3-4 h) | - |
| T03 | Ejecutar mediciones de carga: health, 5.000 y 20.000 filas | Pendiente - Alta | Alta | L (4-8 h) | - |
| T04 | Escribir `docs/mediciones.md` | Pendiente - Alta | Alta | M (2-3 h) | T03 |
| T05 | Completar `README.md` para entrega | Pendiente - Alta | Alta | M (2-3 h) | - |
| T06 | Escribir `docs/modelo.md` | Pendiente - Alta | Alta | M (3-4 h) | - |
| T07 | Escribir `docs/api.md` u OpenAPI 3.1 | Pendiente - Alta | Alta | L (4-6 h) | - |
| T08 | Escribir los seis ADR en `docs/adr/` | Pendiente - Alta | Alta | L (4-6 h) | - |
| T09 | Crear coleccion Postman o archivo `.http` | Pendiente - Alta | Alta | M (2-4 h) | - |
| T10 | Crear `docs/ataque.md` con plantilla y bitacora | Pendiente - Alta | Alta | M (2-3 h) | - |
| T11 | Validar `docker compose up` completo (app + db) | Cierre y entrega | Alta | M (2-4 h) | - |
| T12 | Validar clon limpio de punta a punta | Cierre y entrega | Alta | M (2-3 h) | T05, T11 |
| T13 | Escanear secretos en repositorio e historial | Cierre y entrega | Alta | S (1-2 h) | - |
| T14 | Publicar usuarios, credenciales ficticias y URL | Cierre y entrega | Alta | S (1 h) | T05, T11 |
| T15 | Congelar el sistema y anunciar ventana de ataque | Cierre y entrega | Alta | S (1 h) | T14 |
| T16 | Registrar correcciones del ataque y entrega final | Cierre y entrega | Alta | M (2-4 h) | T15 |
| T17 | Script/job de limpieza de datos tecnicos | Pendiente - Media | Media | M (3-4 h) | - |
| T18 | Recuperacion de claves de idempotencia atascadas | Pendiente - Media | Media | M (3-4 h) | - |
| T19 | Calcular total real en listados paginados | Pendiente - Media | Media | M (2-3 h) | - |
| T20 | Evaluar/implementar `requestId` con `AsyncLocalStorage` | Pendiente - Media | Media | M (2-3 h) | - |
| T21 | Completar adaptadores en memoria de los puertos | Pendiente - Media | Media | M (3-4 h) | - |
| T22 | Decidir `DocumentGenerator`: implementar o declarar exencion | Pendiente - Media | Media | S (1-2 h) | - |
| T23 | Actualizar `ESTADO-MIGRACION.md` y conteo de tests | Pendiente - Media | Media | S (1 h) | T01, T02 |

---

## Pendiente - Alta

### T01 - Suite de integracion CRUD y flujo completo por HTTP

**Lista:** Pendiente - Alta
**Etiquetas:** `tests`, `backend`, `alta`
**Estimacion:** L (4-6 h)
**Depende de:** -
**Contexto:** La suite actual cubre health, seguridad, concurrencia, notificaciones e importacion CSV, pero falta el flujo CRUD completo por HTTP. Ya existen helpers en `tests/helpers/http.ts` y `tests/helpers/fixtures.ts`.

**Criterios de aceptacion:**

- [ ] Crear `tests/integration/crud-flow.test.ts` o dividirlo en archivos por modulo.
- [ ] Cubrir alta de alumno con tutor nuevo y con tutor existente por DNI.
- [ ] Cubrir validacion y registro publico de tutor por codigo institucional.
- [ ] Cubrir alta de curso, materia e inscripcion; listado y consulta por rol.
- [ ] Cubrir alta de clase, asistencia, justificacion y consulta por clase.
- [ ] Cubrir alta de calificacion, rectificacion, anulacion y cierre de periodo.
- [ ] Verificar auditoria de las operaciones principales.
- [ ] Probar al menos un caso 401, uno 403, uno 409 y uno 422 por flujo.
- [ ] Limpiar o aislar los datos creados para que la suite sea repetible.
- [ ] `npm run test:integration` pasa sin tests skipped.

**Evidencia:** `tests/integration/`, `tests/helpers/`, `src/infra/http/routes.ts`.

---

### T02 - Ampliar suite de dominio: entidades, value objects y transiciones

**Lista:** Pendiente - Alta
**Etiquetas:** `tests`, `backend`, `alta`
**Estimacion:** M (3-4 h)
**Depende de:** -
**Contexto:** `tests/domain/alumnos-csv.test.ts` cubre el CSV. Falta profundizar en reglas de entidades, value objects y transiciones de estado.

**Criterios de aceptacion:**

- [ ] Tests de value objects: DNI, email, username, password, notas, fechas y horas.
- [ ] Tests de identidad: alumno, docente, tutor, preceptor, administrador y vinculos tutor-alumno.
- [ ] Tests academicos: curso, materia, inscripcion y capacidad.
- [ ] Tests de asistencia: estados, justificacion y consulta por clase.
- [ ] Tests de calificaciones: instancia, periodo, condicion, cierre y rectificacion.
- [ ] Tests de transiciones invalidas y errores de dominio con `code` esperado.
- [ ] `npm run test:domain` pasa y los casos quedan documentados por nombre.

**Evidencia:** `src/domain/`, `tests/domain/`.

---

### T03 - Ejecutar mediciones de carga: health, 5.000 y 20.000 filas

**Lista:** Pendiente - Alta
**Etiquetas:** `tests`, `infra`, `alta`
**Estimacion:** L (4-8 h)
**Depende de:** -
**Contexto:** Los scripts de carga y generacion de CSV ya existen, pero no se ejecutaron ni se registraron resultados.

**Criterios de aceptacion:**

- [ ] Preparar entorno limpio con PostgreSQL/Docker y la app levantada.
- [ ] Ejecutar baseline de `/health` con autocannon y registrar RPS, p50, p95, p99, errores y timeouts.
- [ ] Generar CSV de 5.000 filas y ejecutar importacion final con worker.
- [ ] Ejecutar importacion ingenua de 5.000 filas como referencia comparativa.
- [ ] Generar CSV de 20.000 filas y ejecutar importacion final con worker.
- [ ] Registrar event loop lag max/p99, memoria RSS/heap, pool de conexiones y filas/segundo.
- [ ] Guardar los JSON de salida en `tmp/mediciones/` y conservar un resumen para el informe.
- [ ] Verificar que no haya DNIs duplicados entre escenarios.
- [ ] Documentar los comandos exactos usados en PowerShell.

**Comandos de referencia:**

```powershell
npm run db:reset
npm run heavy:prepare-courses
$env:CSV_ROWS=5000
$env:CSV_DISTRIBUTE='true'
$env:CSV_TURNO='Tarde'
$env:CSV_DNI_BASE='10000000'
npm run heavy:generate-csv
npm run load:health
$env:LOAD_CSV='tmp/alumnos-5000.csv'
npm run load:import
```

Para 20.000 filas usar `CSV_ROWS=20000`, otro `CSV_DNI_BASE` y `CSV_OUTPUT=tmp/alumnos-20000.csv`.

**Evidencia:** `scripts/heavy/`, `scripts/load/`, `tmp/mediciones/`.

---

### T04 - Escribir `docs/mediciones.md`

**Lista:** Pendiente - Alta
**Etiquetas:** `docs`, `alta`
**Estimacion:** M (2-3 h)
**Depende de:** T03
**Contexto:** El TPI exige un informe de mediciones con hipotesis, entorno, comandos, tablas y conclusion.

**Criterios de aceptacion:**

- [ ] Describir hipotesis y objetivos de la medicion.
- [ ] Documentar hardware, sistema operativo, version de Node, PostgreSQL y Docker.
- [ ] Incluir comandos reproducibles y variables de entorno usadas.
- [ ] Incluir tabla de baseline `/health`.
- [ ] Incluir tabla comparativa importacion ingenua vs worker para 5.000 filas.
- [ ] Incluir tabla de 20.000 filas con p50/p95/p99, RPS, event loop, memoria, pool y filas/segundo.
- [ ] Analizar resultados, cuellos de botella y diferencias entre versiones.
- [ ] Declarar limitaciones del entorno de medicion.
- [ ] Enlazar los JSON crudos o un resumen versionado.

**Evidencia:** `docs/mediciones.md`.

---

### T05 - Completar `README.md` para entrega

**Lista:** Pendiente - Alta
**Etiquetas:** `docs`, `alta`
**Estimacion:** M (2-3 h)
**Depende de:** -
**Contexto:** El README ya tiene descripcion, requisitos, puesta en marcha, comandos y usuarios de prueba. Falta completar las secciones que exige el TPI.

**Criterios de aceptacion:**

- [ ] Agregar tabla de permisos por rol y recurso.
- [ ] Agregar indice de `docs/`.
- [ ] Agregar secuencia de clon limpio paso a paso.
- [ ] Agregar seccion de alcance y limitaciones conocidas.
- [ ] Declarar explicitamente si `DocumentGenerator` se implementa o se exime.
- [ ] Verificar que todos los comandos del README funcionan.
- [ ] Verificar que los usuarios y credenciales de prueba coinciden con los seeds.
- [ ] Incluir URL base, healthchecks y ubicacion de la coleccion de requests.

**Evidencia:** `README.md`, `docs/`.

---

### T06 - Escribir `docs/modelo.md`

**Lista:** Pendiente - Alta
**Etiquetas:** `docs`, `alta`
**Estimacion:** M (3-4 h)
**Depende de:** -
**Contexto:** No existe documentacion del modelo de dominio.

**Criterios de aceptacion:**

- [ ] Documentar entidades principales y su responsabilidad.
- [ ] Documentar invariantes y reglas de negocio por entidad.
- [ ] Documentar estados y transiciones: inscripcion, asistencia, calificacion, periodo, importacion y notificacion.
- [ ] Incluir diagrama Mermaid de entidades o clases.
- [ ] Relacionar entidades con tablas de PostgreSQL.
- [ ] Incluir auditoria, idempotencia, importaciones y notificaciones.
- [ ] Verificar consistencia con la migracion SQL y el dominio.

**Evidencia:** `docs/modelo.md`, `src/domain/`, `src/infra/db/migrations/1700000000000_initial.sql`.

---

### T07 - Escribir `docs/api.md` u OpenAPI 3.1

**Lista:** Pendiente - Alta
**Etiquetas:** `docs`, `alta`
**Estimacion:** L (4-6 h)
**Depende de:** -
**Contexto:** El contrato HTTP esta implementado en `src/infra/http/routes.ts` y `schemas.ts`, pero no documentado para entrega.

**Criterios de aceptacion:**

- [ ] Documentar todos los endpoints con metodo, ruta, auth y rol requerido.
- [ ] Documentar parametros, body, query y respuestas exitosas.
- [ ] Documentar codigos de error y formato uniforme de error.
- [ ] Documentar idempotencia con `Idempotency-Key`.
- [ ] Documentar paginacion, filtros y ordenamiento.
- [ ] Incluir ejemplos con usuarios ficticios.
- [ ] Validar que cada endpoint documentado existe en `routes.ts`.
- [ ] Si se usa OpenAPI 3.1, validar el archivo con un linter o visor.

**Evidencia:** `docs/api.md` u `docs/openapi.yaml`, `src/infra/http/routes.ts`, `src/infra/http/schemas.ts`.

---

### T08 - Escribir los seis ADR en `docs/adr/`

**Lista:** Pendiente - Alta
**Etiquetas:** `docs`, `alta`, `decision`
**Estimacion:** L (4-6 h)
**Depende de:** -
**Contexto:** El TPI exige al menos seis ADR con contexto, alternativas, consecuencias y que haria cambiar la decision.

**Criterios de aceptacion:**

- [ ] Crear `docs/adr/README.md` como indice.
- [ ] ADR 1: Node.js 22 + TypeScript + ESM.
- [ ] ADR 2: PostgreSQL con SQL directo y `node-pg-migrate` en lugar de ORM.
- [ ] ADR 3: JWT de acceso corto + refresh tokens + autorizacion por recurso.
- [ ] ADR 4: Bloqueo pesimista y transacciones para la carrera de calificaciones/cierre.
- [ ] ADR 5: `worker_threads` para la importacion CSV.
- [ ] ADR 6: Idempotencia y manejo uniforme de errores.
- [ ] Cada ADR incluye contexto, decision, alternativas, consecuencias y condiciones de cambio.
- [ ] Los ADR coinciden con el codigo implementado.

**Evidencia:** `docs/adr/`, `src/infra/imports/`, `src/infra/db/`, `src/infra/http/middleware.ts`.

---

### T09 - Crear coleccion Postman o archivo `.http`

**Lista:** Pendiente - Alta
**Etiquetas:** `docs`, `entrega`, `alta`
**Estimacion:** M (2-4 h)
**Depende de:** -
**Contexto:** El TPI pide una coleccion de requests para la demo.

**Criterios de aceptacion:**

- [ ] Crear coleccion en `docs/http/` o `docs/postman/`.
- [ ] Incluir variables de entorno para `baseUrl`, tokens y credenciales ficticias.
- [ ] Incluir login de admin, preceptor, docente, alumno y tutor.
- [ ] Incluir flujo feliz de identidad, academico, asistencia, calificaciones, importacion y auditoria.
- [ ] Incluir casos de error: 401, 403, 409 de idempotencia y 422 de validacion.
- [ ] Incluir request de importacion CSV con `Idempotency-Key`.
- [ ] Verificar que no haya secretos reales.
- [ ] Documentar como importar y ejecutar la coleccion.

**Evidencia:** `docs/http/` o `docs/postman/`, `README.md`.

---

### T10 - Crear `docs/ataque.md` con plantilla y bitacora

**Lista:** Pendiente - Alta
**Etiquetas:** `docs`, `entrega`, `alta`
**Estimacion:** M (2-3 h)
**Depende de:** -
**Contexto:** Falta la plantilla y bitacora del ataque cruzado entre grupos.

**Criterios de aceptacion:**

- [ ] Definir alcance, reglas, participantes y entorno.
- [ ] Incluir matriz de ataque por rol y recurso.
- [ ] Incluir secciones de hipotesis, evidencia y resultado esperado.
- [ ] Incluir bitacora previa, durante y posterior al ataque.
- [ ] Incluir plantilla de hallazgos con severidad, reproduccion y correccion.
- [ ] Enlazar los tests de seguridad existentes.
- [ ] Dejar el documento listo para completar durante la ventana de ataque.

**Evidencia:** `docs/ataque.md`, `tests/security/access-control.test.ts`.

---

## Pendiente - Media

### T17 - Script/job de limpieza de datos tecnicos

**Lista:** Pendiente - Media
**Etiquetas:** `infra`, `backend`, `media`
**Estimacion:** M (3-4 h)
**Depende de:** -
**Contexto:** No existe limpieza de claves de idempotencia vencidas, importaciones retenidas ni archivos temporales no referenciados.

**Criterios de aceptacion:**

- [ ] Crear `scripts/cleanup.ts` o un job equivalente.
- [ ] Borrar `idempotency_keys` vencidas segun `IDEMPOTENCY_TTL_HOURS`.
- [ ] Borrar importaciones y errores segun `IMPORT_RETENTION_DAYS`.
- [ ] Borrar archivos temporales de importacion no referenciados.
- [ ] Soportar modo `dry-run`.
- [ ] Ser idempotente y registrar conteos en logs.
- [ ] Documentar el comando y la politica de retencion.
- [ ] Agregar al menos una prueba manual o automatizada.

**Evidencia:** `scripts/cleanup.ts`, `.env.example`, `src/infra/db/migrations/1700000000000_initial.sql`.

---

### T18 - Recuperacion de claves de idempotencia atascadas

**Lista:** Pendiente - Media
**Etiquetas:** `backend`, `infra`, `media`
**Estimacion:** M (3-4 h)
**Depende de:** -
**Contexto:** La finalizacion de idempotencia ocurre en `res.on('finish')`, fuera de la transaccion. Si el proceso muere, la clave puede quedar en `procesando` hasta su expiracion.

**Criterios de aceptacion:**

- [ ] Definir estrategia de recuperacion para claves `procesando` vencidas o sin heartbeat.
- [ ] Implementar la recuperacion de forma segura e idempotente.
- [ ] Evitar que un replay devuelva una respuesta inconsistente.
- [ ] Agregar test que simule proceso interrumpido o clave atascada.
- [ ] Documentar la decision en un ADR o en `docs/modelo.md`.
- [ ] Verificar que no se rompe el replay exitoso existente.

**Evidencia:** `src/infra/http/middleware.ts`, `src/infra/db/repositories/idempotency.ts`, `tests/concurrency/idempotency.test.ts`.

---

### T19 - Calcular total real en listados paginados

**Lista:** Pendiente - Media
**Etiquetas:** `backend`, `media`
**Estimacion:** M (2-3 h)
**Depende de:** -
**Contexto:** Hoy el `total` de los listados paginados se calcula como `offset + data.length`; no es un conteo real de la base.

**Criterios de aceptacion:**

- [ ] Implementar `COUNT(*)` con los mismos filtros de la consulta.
- [ ] Propagar el total real a los presenters y al contrato HTTP.
- [ ] Mantener el rendimiento aceptable en listados grandes.
- [ ] Agregar tests para paginas intermedias, ultima pagina y filtros.
- [ ] Actualizar `docs/api.md` si cambia el contrato.

**Evidencia:** `src/infra/db/repositories/`, `src/infra/http/presenters.ts`, `docs/api.md`.

---

### T20 - Evaluar/implementar `requestId` con `AsyncLocalStorage`

**Lista:** Pendiente - Media
**Etiquetas:** `backend`, `infra`, `media`, `opcional`
**Estimacion:** M (2-3 h)
**Depende de:** -
**Contexto:** Hoy el `requestId` se propaga por `res.locals` y Pino HTTP. Los logs de error no siempre quedan correlacionados sin acceso a `res`.

**Criterios de aceptacion:**

- [ ] Evaluar si `AsyncLocalStorage` aporta valor frente al esquema actual.
- [ ] Si se implementa, crear un contexto de request con `requestId` y usuario.
- [ ] Propagar el contexto a logger, errores y servicios.
- [ ] Agregar test de correlacion de logs.
- [ ] Si no se implementa, registrar la decision y el motivo.
- [ ] Actualizar la documentacion correspondiente.

**Evidencia:** `src/infra/http/middleware.ts`, `src/infra/logging/logger.ts`, `src/infra/http/app.ts`.

---

### T21 - Completar adaptadores en memoria de los puertos

**Lista:** Pendiente - Media
**Etiquetas:** `backend`, `tests`, `media`, `decision`
**Estimacion:** M (3-4 h)
**Depende de:** -
**Contexto:** El plan/DoD pide doble adaptador para los puertos. Hoy existe `InMemoryNotifier`, pero el resto de los puertos solo tiene adaptador PostgreSQL, disco local, JWT, Argon2 y log.

**Criterios de aceptacion:**

- [ ] Relevar que puertos exigen doble adaptador segun el alcance acordado.
- [ ] Implementar adaptador en memoria para almacenamiento de archivos.
- [ ] Implementar fake en memoria para `DocumentGenerator` si se decide implementarlo.
- [ ] Reutilizar `InMemoryNotifier` en tests.
- [ ] Mantener el cableado de produccion en `src/composition.ts`.
- [ ] Documentar el doble adaptador en README o ADR.
- [ ] Agregar tests que usen los adaptadores en memoria.

**Evidencia:** `src/domain/`, `src/infra/memory/`, `src/composition.ts`.

---

### T22 - Decidir `DocumentGenerator`: implementar o declarar exencion

**Lista:** Pendiente - Media
**Etiquetas:** `backend`, `docs`, `media`, `decision`
**Estimacion:** S (1-2 h)
**Depende de:** -
**Contexto:** El plan permite eximir la generacion de documentos por ser grupo de dos, pero la decision debe quedar explicita.

**Criterios de aceptacion:**

- [ ] Decidir entre implementar constancias/boletines simples o declarar la exencion.
- [ ] Si se implementa: crear puerto, adaptador PDF, fake en memoria y tests.
- [ ] Si se exime: documentarlo en `README.md` y en un ADR.
- [ ] Verificar que la decision sea consistente con el alcance del TPI.
- [ ] Actualizar `ESTADO-MIGRACION.md`.

**Evidencia:** `README.md`, `docs/adr/`, `src/domain/shared/ports.ts`.

---

### T23 - Actualizar `ESTADO-MIGRACION.md` y conteo de tests

**Lista:** Pendiente - Media
**Etiquetas:** `docs`, `media`
**Estimacion:** S (1 h)
**Depende de:** T01, T02
**Contexto:** El estado tiene items desactualizados: el README ya existe parcialmente, las metricas de event loop y pool ya estan implementadas y `InMemoryNotifier` ya existe. Tambien hay conteos de tests inconsistentes entre secciones.

**Criterios de aceptacion:**

- [ ] Actualizar fecha y resumen general.
- [ ] Marcar como hechos: README base, metricas de event loop/pool, `InMemoryNotifier`, scripts de carga existentes.
- [ ] Corregir el conteo de archivos y tests.
- [ ] Reemplazar items obsoletos por el estado real.
- [ ] Enlazar este tablero o el archivo de tareas.
- [ ] Verificar que no queden pendientes duplicados.

**Evidencia:** `ESTADO-MIGRACION.md`, `TAREAS-TRELLO.md`.

---

## Cierre y entrega

### T11 - Validar `docker compose up` completo (app + db)

**Lista:** Cierre y entrega
**Etiquetas:** `infra`, `entrega`, `alta`
**Estimacion:** M (2-4 h)
**Depende de:** -
**Contexto:** Solo se valido `docker compose up -d db`. Falta validar la aplicacion incluida en el compose.

**Criterios de aceptacion:**

- [ ] Ejecutar `docker compose build` sin errores.
- [ ] Ejecutar `docker compose up -d` y esperar healthchecks.
- [ ] Verificar que `db` y `app` queden healthy.
- [ ] Verificar migraciones automaticas del entrypoint.
- [ ] Verificar `GET /health`, `GET /ready` y `GET /internal/metrics`.
- [ ] Verificar login y una operacion real contra la app en Docker.
- [ ] Verificar workers de importacion y notificaciones dentro del contenedor.
- [ ] Verificar volumen de storage de importaciones.
- [ ] Documentar comandos, resultados y problemas encontrados.

**Evidencia:** `docker-compose.yml`, `Dockerfile`, `docker/entrypoint.sh`.

---

### T12 - Validar clon limpio de punta a punta

**Lista:** Cierre y entrega
**Etiquetas:** `entrega`, `alta`
**Estimacion:** M (2-3 h)
**Depende de:** T05, T11
**Contexto:** Falta probar la secuencia completa desde un clon limpio, sin `node_modules` ni `.env`.

**Criterios de aceptacion:**

- [ ] Clonar en un directorio temporal limpio.
- [ ] Seguir el README al pie de la letra.
- [ ] Crear `.env` desde `.env.example`.
- [ ] Ejecutar `npm ci`.
- [ ] Ejecutar `docker compose up -d db`.
- [ ] Ejecutar `npm run setup`.
- [ ] Ejecutar `npm test`.
- [ ] Ejecutar `npm run dev` y verificar `/health` y `/ready`.
- [ ] Registrar cualquier desvio del README y corregirlo.

**Evidencia:** `README.md`, `docker-compose.yml`, `package.json`.

---

### T13 - Escanear secretos en repositorio e historial

**Lista:** Cierre y entrega
**Etiquetas:** `entrega`, `infra`, `alta`
**Estimacion:** S (1-2 h)
**Depende de:** -
**Contexto:** Hay que verificar que no haya secretos en el arbol de trabajo ni en el historial de Git.

**Criterios de aceptacion:**

- [ ] Confirmar que `.env` no esta trackeado y esta en `.gitignore`.
- [ ] Ejecutar un escaneo con `gitleaks`, `trufflehog` o equivalente.
- [ ] Revisar el historial con `git log -p` o herramienta especializada.
- [ ] Revisar `docker-compose.yml`, `.env.example`, seeds, tests y fixtures.
- [ ] Confirmar que los secretos de desarrollo estan claramente marcados como no productivos.
- [ ] Rotar o eliminar cualquier secreto real encontrado.
- [ ] Registrar comando y resultado del escaneo.

**Evidencia:** `.gitignore`, `.env.example`, `docker-compose.yml`, historial Git.

---

### T14 - Publicar usuarios, credenciales ficticias y URL

**Lista:** Cierre y entrega
**Etiquetas:** `entrega`, `alta`
**Estimacion:** S (1 h)
**Depende de:** T05, T11
**Contexto:** Falta publicar los usuarios y credenciales ficticias para la demo y el ataque cruzado.

**Criterios de aceptacion:**

- [ ] Definir la URL final de la API.
- [ ] Publicar tabla de usuarios por rol con credenciales ficticias.
- [ ] Indicar que usuarios requieren cambio de contrasena inicial.
- [ ] Verificar cada login contra el entorno publicado.
- [ ] Confirmar que los seeds no se ejecutan en produccion.
- [ ] Compartir la coleccion de requests o el archivo `.http`.

**Evidencia:** `README.md`, `docs/http/`, seeds.

---

### T15 - Congelar el sistema y anunciar ventana de ataque

**Lista:** Cierre y entrega
**Etiquetas:** `entrega`, `alta`
**Estimacion:** S (1 h)
**Depende de:** T14
**Contexto:** Falta congelar el sistema y anunciar la ventana para el ataque cruzado.

**Criterios de aceptacion:**

- [ ] Congelar cambios de codigo y despliegue durante la ventana.
- [ ] Crear un tag o commit identificable del estado congelado.
- [ ] Anunciar URL, usuarios, reglas, horario y contacto.
- [ ] Confirmar disponibilidad de la base y de los servicios.
- [ ] Registrar el anuncio en `docs/ataque.md`.

**Evidencia:** `docs/ataque.md`, tag de Git.

---

### T16 - Registrar correcciones del ataque y entrega final

**Lista:** Cierre y entrega
**Etiquetas:** `entrega`, `docs`, `alta`
**Estimacion:** M (2-4 h)
**Depende de:** T15
**Contexto:** Falta registrar hallazgos del ataque, corregirlos y cerrar la entrega.

**Criterios de aceptacion:**

- [ ] Volcar hallazgos en `docs/ataque.md` con severidad y reproduccion.
- [ ] Corregir hallazgos criticos y altos.
- [ ] Agregar tests de regresion por cada correccion.
- [ ] Reejecutar lint, typecheck, build y toda la suite.
- [ ] Actualizar README y documentacion si cambia el contrato.
- [ ] Crear tag final y publicar artefactos de entrega.
- [ ] Dejar registrados los hallazgos no corregidos y su justificacion.

**Evidencia:** `docs/ataque.md`, `tests/`, tag final.

---

## Ya resuelto - no crear tarjetas

Estos items figuran como pendientes en `ESTADO-MIGRACION.md` o podrian parecerlo, pero ya estan implementados en el repositorio:

- Worker de importaciones CSV con `SKIP LOCKED`, lease, heartbeat, staging, reintentos y recuperacion.
- Worker de notificaciones con `dedupe_key`, reintentos y hooks de emision.
- Metricas de event loop (`monitorEventLoopDelay`) y del pool de conexiones en `/internal/metrics`.
- `InMemoryNotifier` para tests de notificaciones.
- CI con PostgreSQL de servicio, migraciones, seeds, lint, typecheck, test y build.
- Tests de dominio del CSV, integracion de importacion/notificaciones, seguridad, concurrencia e idempotencia.
- Seeds idempotentes, `scripts/setup.ts`, `scripts/db-reset.ts` y `scripts/wait-for-db.ts`.
- `docker compose up -d db`, `npm run setup`, `npm test` y `/ready` contra PostgreSQL real.
- Scripts de generacion de CSV y de carga (`scripts/heavy/`, `scripts/load/`). Falta ejecutarlos y documentar resultados.
- `.env.example` con variables de workers.
- README base con descripcion, requisitos, puesta en marcha, comandos y usuarios de prueba. Falta completarlo (T05).

## Definicion de terminado del proyecto

- [ ] Suite de tests completa y verde: dominio, integracion, seguridad, concurrencia, idempotencia e importacion.
- [ ] Mediciones ejecutadas y documentadas.
- [ ] README completo y reproducible desde un clon limpio.
- [ ] Seis ADR, modelo, API, mediciones y ataque documentados.
- [ ] Coleccion de requests lista para la demo.
- [ ] `docker compose up` completo validado.
- [ ] Sin secretos en el repositorio ni en el historial.
- [ ] Usuarios ficticios y URL publicados.
- [ ] Ataque cruzado ejecutado, hallazgos registrados y correcciones aplicadas.
- [ ] Tag final y artefactos de entrega publicados.

## Orden recomendado de ejecucion

1. T01, T02 y T03: cerrar la brecha de tests y obtener las mediciones.
2. T04 a T10: producir toda la documentacion y la coleccion de requests.
3. T05, T11 y T12: dejar el README y la ejecucion reproducibles.
4. T13 a T16: preparar y ejecutar el cierre y el ataque cruzado.
5. T17 a T23: completar calidad operativa y actualizar el estado, si el alcance lo permite.
