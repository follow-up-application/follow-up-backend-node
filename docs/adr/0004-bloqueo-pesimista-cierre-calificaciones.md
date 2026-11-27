# ADR-0004: Bloqueo pesimista y transacciones para la carrera de calificaciones/cierre

- **Estado:** aceptado
- **Fecha:** 2026-11-27
- **Decisores:** equipo de backend

## Contexto

Varias operaciones pueden competir sobre el mismo período lectivo: docentes que actualizan calificaciones y un administrador que cierra el período. El cierre calcula condiciones a partir de notas, asistencias, clases dictadas y reglas de condición; luego inserta un registro de cierre, reemplaza todas las condiciones del período, marca el período como cerrado, escribe auditoría y encola notificaciones.

Sin serialización pueden aparecer: una nota escrita después de calcular las condiciones y antes de cerrar, dos cierres simultáneos con registros duplicados, condiciones basadas en una lectura parcial o actualizaciones perdidas sobre la misma calificación.

## Decisión

Usar **bloqueo pesimista a nivel de fila con `SELECT ... FOR UPDATE` dentro de una transacción**, complementado con **control de versión optimista** y restricciones únicas de PostgreSQL como respaldo.

- `PgPeriodoRepository.findForUpdate()` bloquea la fila de `periodos`. `PgCalificacionRepository.findForUpdate()` bloquea la fila de `calificaciones`.
- `createCalificacion()` y `updateCalificacion()` abren `PgUnitOfWork.transaction()`, adquieren primero el lock del período y verifican `periodo.isOpen()`; solo después bloquean la calificación. Todas las lecturas posteriores usan el mismo cliente de transacción mediante `clientOf(tx)`.
- `updateCalificacion()` también comprueba `assertVersion(current.version, input.version)`; un `version` obsoleto produce `StaleVersionError` (HTTP `409`). La sentencia de actualización incrementa `version` y la unicidad `calificaciones_unica (instancia_id, alumno_id)` impide duplicados.
- `closePeriodo()` abre una transacción, bloquea el período, verifica si ya existe cierre; si el período ya está cerrado, devuelve el cierre y las condiciones existentes en lugar de repetir el cálculo. Si está abierto, calcula todas las condiciones dentro de la transacción, inserta el cierre, reemplaza las condiciones, cierra el período, registra auditoría y encola las notificaciones con `dedupeKey`.
- El orden de adquisición es siempre **período → calificación**, para evitar deadlocks entre operaciones concurrentes.
- La tabla `periodo_cierres` tiene `UNIQUE (periodo_id)` y `condiciones_alumno` tiene `UNIQUE (periodo_id, alumno_id, materia_id)`: son la última barrera aunque falle una comprobación en la aplicación.
- El endpoint de cierre acepta `Idempotency-Key`; la middleware correspondiente evita repetir la operación ante reintentos del cliente.

No se usa `FOR UPDATE SKIP LOCKED` en esta sección crítica: ese patrón se reserva para las colas de importación y notificaciones, donde sí interesa omitir filas ocupadas.

## Alternativas consideradas

- **Solo control optimista por `version`:** evita sobrescrituras, pero no impide que un cierre calcule condiciones con datos que otro proceso está a punto de modificar; obligaría a reintentar el cierre completo.
- **Mutex en memoria dentro del proceso:** no sirve con varias instancias del API ni protege a otros clientes que escriban en la base.
- **Aislamiento `SERIALIZABLE` para toda la transacción:** detectaría la anomalía, pero requiere manejar errores de serialización y reintentos en todos los casos de uso.
- **Sin bloqueo:** simple, pero permite cierres duplicados, condiciones inconsistentes y pérdida de actualizaciones confirmadas.

## Consecuencias

**Positivas**

- La actualización de notas y el cierre quedan serializados: cada operación ve el estado comprometido precedente y el que gana el lock decide el resultado.
- Un cierre simultáneo a una actualización termina con un estado coherente: la nota entra al cálculo o la operación recibe un `409`.
- Dos cierres concurrentes producen un solo registro de cierre y el segundo obtiene el mismo resultado.
- Auditoría, condiciones, cierre y notificaciones se confirman o se revierten juntos.

**Negativas**

- El cierre mantiene el lock de la fila del período durante todo el recorrido de cursos, materias, inscripciones y notificaciones; con muchas filas aumenta la espera y el riesgo de `statement_timeout`.
- Cada mutación de calificación bloquea primero el período, creando un punto de contención compartido incluso entre materias distintas.
- El orden de locks y el uso del cliente de transacción son convenciones que deben respetarse en todo nuevo caso de uso relacionado.
- El enfoque depende de semántica específica de PostgreSQL (`FOR UPDATE`, unicidad, transacciones), por lo que los tests de concurrencia requieren una base real.

## Verificación

Archivos que materializan la decisión: `src/infra/db/unit-of-work.ts`, `src/infra/db/repositories/grading.ts` y `src/application/grading-service.ts`. Los escenarios están en `tests/concurrency/grading.test.ts` (50 actualizaciones concurrentes, actualización contra cierre y doble cierre simultáneo) y se ejecutan con `npm run test:concurrency` y `npm run typecheck`.
