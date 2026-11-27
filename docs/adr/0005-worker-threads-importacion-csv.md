# ADR-0005: `worker_threads` para la importación CSV

- **Estado:** aceptado
- **Fecha:** 2026-11-27
- **Decisores:** equipo de backend

## Contexto

La importación masiva de alumnos acepta archivos de hasta `IMPORT_MAX_FILE_BYTES` (10 MB por defecto) y `IMPORT_MAX_ROWS` (20.000 filas). El parseo, la validación por columna y la preparación de lotes son tareas intensivas en CPU que, si se ejecutan en el hilo principal, aumentan el lag del event loop y el jitter de endpoints como `/health`.

Al mismo tiempo, la importación no es solo insertar filas: necesita un job con estado y progreso, errores por fila con código, auditoría, control de cupos y DNI duplicados, disposición de alumnos en cursos, reintentos y notificaciones. La medición de referencia mostró que la versión ingenua en el hilo principal inserta más rápido (194 filas/s frente a 45 filas/s en 5.000 filas), pero no ofrece esas garantías.

## Decisión

Usar **`worker_threads` de Node.js para el parseo y la validación del CSV**, manteniendo la persistencia y la orquestación del job en el hilo principal.

- `src/infra/imports/alumnos-csv.worker.ts` recibe por `workerData` el `Buffer` del archivo, `maxRows` y `batchSize` (500), ejecuta `parseAlumnosCsv()` y envía mensajes por `postMessage`: `start`, `batch`, `done`, `limit` y `fatal`.
- `ImportWorker.runParserInWorker()` crea el `Worker` resolviendo la extensión `.ts` o `.js` según `import.meta.url`; en desarrollo agrega `execArgv: ['--import', 'tsx']` para que el hilo pueda ejecutar TypeScript.
- Los mensajes `batch` se encadenan en una promesa antes de resolver `done`, de modo que la escritura en base de cada lote termina antes de aceptar el siguiente (contrapresión). Cada lote se persiste en una transacción con `appendRows`, `appendErrors` y `updateProgress`.
- El worker se termina ante error fatal, exceso de filas, pérdida del lease o detención del servidor; además tiene un timeout de 10 minutos.
- La adjudicación del job (`claimNext` con `FOR UPDATE SKIP LOCKED`), el heartbeat y lease, la validación de negocio contra la base, la finalización, la auditoría y las notificaciones siguen en `ImportWorker`, usando el pool de `pg` y `PgUnitOfWork`. El hilo de parseo no accede a la base ni a los servicios de dominio.
- `IMPORT_NAIVE=true` conserva la ruta inline (`runParserInline`) como referencia de medición; el valor por defecto es `false`.

## Alternativas consideradas

- **Parsear en el hilo principal:** es más simple y fue ~4,3× más rápido en el benchmark de inserción pura, pero bloquea el event loop durante el parseo y no aporta por sí solo progreso, errores por fila ni reintentos.
- **Proceso hijo (`child_process`) o microservicio externo:** aísla mejor la CPU, pero añade serialización, supervisión de procesos y despliegue de otro componente; `worker_threads` mantiene todo en el mismo proceso.
- **Un worker por fila o varios workers por job:** incrementa el uso de CPU y la contención sobre la base; se eligió un worker de parseo por job activo y una sola importación activa a la vez.

## Consecuencias

**Positivas**

- El event loop queda libre para atender HTTP mientras se parsea y valida el CSV.
- El flujo informa progreso y errores por fila, respeta cupos y DNIs existentes, y mantiene auditoría y notificaciones en las mismas transacciones.
- El protocolo de mensajes permite cancelar la importación al detectar pérdida de lease o apagado del servidor.
- La ruta inline queda disponible como baseline reproducible sin cambiar el código de persistencia.

**Negativas**

- El throughput es menor que el de la inserción ingenua: el costo del job, la validación, los lotes y la auditoría es real (~45 filas/s en la corrida aislada).
- El protocolo entre hilos, el encadenamiento de lotes, el timeout y la terminación añaden complejidad al worker de importación.
- Pasar el `Buffer` como `workerData` implica copia/serialización al crear el hilo.
- La contención sobre el pool de base y los heartbeats no desaparece: el informe documenta agotamiento del pool con la configuración por defecto y recomienda distinguir el pool de heartbeats del de importación.

## Verificación

Archivos que materializan la decisión: `src/infra/imports/alumnos-csv.worker.ts`, `src/infra/imports/import-worker.ts`, `src/infra/imports/alumnos-csv-parser.ts` y `src/config/env.ts`. Se comprueba con `npm run test:integration`, `npm run heavy:import:final`, `npm run heavy:import:naive` y `npm run typecheck`; el análisis comparativo está en `docs/INFORME-MEDICIONES.md` (sección 9).
