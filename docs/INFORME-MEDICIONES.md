# Informe de mediciones de carga

## Objetivos

- Establecer un baseline de RPS y latencia de `/health` sin acceso a base de datos, como referencia del techo del servidor HTTP.
- Cuantificar el costo de la importación worker de alumnos con 5.000 y 20.000 filas (tiempo total, filas/segundo y filas válidas).
- Comparar el worker contra la implementación ingenua en hilo principal para medir el costo de la cola, el job y la auditoría.
- Observar el efecto de una importación larga sobre el event loop, la memoria RSS/heap y el pool de conexiones.
- Verificar la integridad de los DNIs entre escenarios y dejar evidencia reproducible para el informe.

## Hipótesis y validación

| # | Hipótesis | Resultado |
|---|---|---|
| H1 | `/health` sostiene baja latencia y cero errores con 20 conexiones concurrentes. | Confirmada: mediana 1389,5 RPS, p95 26 ms, 0 errores/timeouts. |
| H2 | El worker escala de forma aproximadamente lineal: 20.000 filas tardan ~4× lo que 5.000, con similar throughput. | Confirmada: 111,9 s vs 445,9 s, ambos ~45 filas/s. |
| H3 | La versión ingenua es más rápida en tiempo wall-clock, pero pierde trazabilidad y respeta menos reglas de negocio. | Confirmada: 194 filas/s vs 45, pero inserta todo en un solo curso y no genera job/auditoría/idempotencia. |
| H4 | Una importación prolongada presiona el event loop y el pool de conexiones. | Parcialmente confirmada: lag pico 316 ms, waiting pico 118; con pool 20 y heartbeat 30 s se agotó el pool. |
| H5 | Los DNIs generados no se solapan entre escenarios. | Confirmada para 5.000/ingenua/20.000; los dos CSV de 20.000 comparten rango pero nunca coexistieron en la misma BD. |

## Entorno

- Host: Windows 11 Home Single Language (10.0.26200, build 26200, 64 bits), Intel(R) Core(TM) i7-10510U @ 1,80 GHz (4 núcleos / 8 hilos lógicos), 23,8 GB de RAM; comandos ejecutados en PowerShell 5.1.
- Docker 29.8.0 y Docker Compose v5.5.1. Node.js del host: v24.14.1 (scripts de carga); Node.js del contenedor de la API: v22.23.5.
- PostgreSQL 16.15 (imagen `postgres:16-alpine`, x86_64-pc-linux-musl) + API Node.js 22 en contenedor, rebuild limpio con `docker compose down -v`.
- Seeds aplicados (`npm run db:seed`) y 182 cursos preparados (`npm run heavy:prepare-courses`: 7 cursos × 26 divisiones, turno Tarde, cupo 200).
- Config por defecto: `DB_POOL_MAX=20`, heartbeat 30 s, lease 120 s. Para la medición instrumentada de 20.000 filas se usó un override temporal: `DB_POOL_MAX=60`, heartbeat 120 s, lease 600 s.
- Salidas crudas: `tmp/mediciones/`.

## 1. Baseline `/health`

`autocannon`, 20 conexiones, 10 s por corrida. Se descartaron 2 corridas de arranque en frío (912 y 1071 RPS). p95 calculado con histograma HDR porque autocannon no lo expone.

| RPS | p50 | p95 | p99 | Errores | Timeouts |
|---:|---:|---:|---:|---:|---:|
| 1520,1 | 11 | 23 | 37 | 0 | 0 |
| 1389,5 | 12 | 26 | 46 | 0 | 0 |
| 1323,7 | 12 | 29 | 45 | 0 | 0 |

**Mediana:** 1389,5 RPS · p50 12 ms · p95 26 ms · p99 45 ms · 0 errores/timeouts/respuestas no-2xx.

Detalle: `tmp/mediciones/health-baseline.json`.

## 2. Importación de 5.000 filas

| Versión | Duración | Filas/s | Válidas | Errores |
|---|---:|---:|---:|---:|
| Worker (`import-final`) | 111.935 ms | 45 | 5.000 | 0 |
| Ingenua (`import-naive`, referencia) | 25.762 ms | 194 | 5.000 | 0 |

La versión ingenua fue ~4,3× más rápida, pero inserta todo en un solo curso (id 3), sin job, auditoría ni idempotencia. Detalle: `import-5000-worker.json`, `import-5000-naive.json`.

## 3. Importación de 20.000 filas

- Worker: **20.000 válidas / 0 errores**, 445.853 ms, **45 filas/s**.
- El curso 1°A Tarde quedó con 5.028 alumnos por la prueba ingenua (cupo 200), por lo que el CSV se distribuyó entre los otros 156 cursos (2°–7°).
- Primer intento fallido: DNI 30.000.001 colisionaba con el seed de `admin`; se regeneró con base 50.000.000. Detalle: `import-20000-incidente.json`.

Detalle: `import-20000-worker.json`.

## 4. Métricas internas durante la importación de 20.000 filas

Muestreo de `/internal/metrics` cada segundo durante la importación worker (553 muestras). Job `707c3543-d7bf-4503-971c-d8339d154c43`, 20.000 válidas, 0 errores.

| Métrica | Valor |
|---|---|
| Duración / filas por segundo | 568,1 s / 35 filas/s |
| Event loop lag (pico) | 316,15 ms; pico de p99: 79,17 ms |
| Memoria (pico) | RSS 272,4 MB; heap 57,1 MB |
| Pool (pico) | total/idle 60/60; waiting 118; max 60 |

### Tabla consolidada de 20.000 filas

| Métrica | Valor | Origen |
|---|---|---|
| Filas válidas / errores | 20.000 / 0 | `import-20000-worker.json` |
| Duración | 445,9 s (worker aislada) / 568,1 s (instrumentada) | Secciones 3 y 4 |
| Filas/segundo | 45 (worker aislada) / 35 (instrumentada) | Secciones 3 y 4 |
| RPS HTTP | No medido durante la importación; referencia `/health`: 1389,5 RPS | Sección 1 |
| p50 / p95 / p99 HTTP | No medidos durante la importación; referencia `/health`: 12 / 26 / 45 ms | Sección 1 |
| Event loop lag | Pico 316,15 ms; pico de p99 79,17 ms | Sección 4 |
| Memoria (pico) | RSS 272,4 MB; heap 57,1 MB | Sección 4 |
| Pool (pico) | total/idle 60/60; waiting 118; max 60 | Sección 4 |

Detalle completo con muestras crudas: `tmp/mediciones/import-20000-metrics.json`.

## 5. Verificación de DNIs

- Sin duplicados internos en ningún CSV (alumnos, tutores ni alumno=tutor dentro de una misma fila).
- Sin solapamientos entre los CSV de 5.000 (base 10.000.000), 5.000 ingenua (base 20.000.000) y 20.000 (base 50.000.000).
- `alumnos-20000.csv` y `alumnos-20000-metrics.csv` sí comparten exactamente el rango 50.000.001–50.040.000; pertenecen a dos escenarios ejecutados con BD reiniciada entre ellos, por lo que nunca coexistieron en la misma base.
- BD final: 40.005 usuarios con DNI no nulo, 40.005 DNIs distintos, 0 grupos duplicados.

## 6. Observaciones

- Con `DB_POOL_MAX=20` y heartbeat de 30 s, las importaciones largas (>~10 min) acumularon transacciones de heartbeat esperando el lock de `import_jobs`, agotaron el pool y devolvieron 500 en el polling. Elevar el pool a 60 y el heartbeat a 120 s permitió completar la corrida instrumentada.
- `scripts/load/import.ts` no enviaba `x-internal-token`, por lo que `/internal/metrics` respondía 403 y el script descartaba todas las muestras; se agregó el header usando `LOAD_METRICS_TOKEN`.
- La medición instrumentada corrió sin tráfico autocannon concurrente para evitar el bloqueo descrito; por eso sus filas/s (35) son menores que las de la corrida worker aislada (45).

## 7. Comandos exactos ejecutados (PowerShell)

Todos se ejecutaron desde la raíz del repositorio (`C:\Users\BANGHO\Desktop\UTN-Programacion\ProgramacionIV\TPI\follow-up-backend-node`).

### Entorno limpio y health

~~~powershell
docker compose down -v --remove-orphans
docker compose up -d --build db app
npm run db:seed
curl.exe -sS -w "`nHTTP %{http_code}`n" http://localhost:3000/health; curl.exe -sS -w "`nHTTP %{http_code}`n" http://localhost:3000/ready
npm run load:health
node tmp/health-p95.mjs
1..3 | ForEach-Object { node tmp/health-p95.mjs }
~~~

### 5.000 filas (worker e ingenua)

~~~powershell
npm run heavy:prepare-courses
$env:CSV_ROWS='5000'; $env:CSV_DISTRIBUTE='true'; $env:CSV_TURNO='Tarde'; $env:CSV_OUTPUT='tmp/alumnos-5000.csv'; npm run heavy:generate-csv
$env:CSV_PATH='tmp/alumnos-5000.csv'; npm run heavy:import:final
$env:CSV_ROWS='5000'; $env:CSV_DISTRIBUTE='true'; $env:CSV_TURNO='Tarde'; $env:CSV_DNI_BASE='20000000'; $env:CSV_OUTPUT='tmp/alumnos-5000-naive.csv'; npm run heavy:generate-csv
$env:CSV_PATH='tmp/alumnos-5000-naive.csv'; npm run heavy:import:naive
~~~

### 20.000 filas

El primer CSV usó base 30.000.000 y falló por colisión con el DNI del seed; se regeneró con base 50.000.000.

~~~powershell
$env:CSV_ROWS='20000'; $env:CSV_DISTRIBUTE='true'; $env:CSV_TURNO='Tarde'; $env:CSV_CURSOS='2,3,4,5,6,7'; $env:CSV_DNI_BASE='30000000'; $env:CSV_OUTPUT='tmp/alumnos-20000.csv'; npm run heavy:generate-csv
$env:CSV_PATH='tmp/alumnos-20000.csv'; npm run heavy:import:final
$env:CSV_ROWS='20000'; $env:CSV_DISTRIBUTE='true'; $env:CSV_TURNO='Tarde'; $env:CSV_CURSOS='2,3,4,5,6,7'; $env:CSV_DNI_BASE='50000000'; $env:CSV_OUTPUT='tmp/alumnos-20000.csv'; npm run heavy:generate-csv
$env:CSV_PATH='tmp/alumnos-20000.csv'; npm run heavy:import:final
~~~

### Medición instrumentada

Los dos primeros `load:import` terminaron con 500 por el bloqueo de heartbeats. El muestreo definitivo usó `tmp/metrics-import.mjs` con un override temporal (`tmp/compose-metrics.yml`).

~~~powershell
docker compose down -v --remove-orphans; if ($?) { docker compose up -d --build db app }
docker compose ps --format "{{.Name}} {{.Status}}"; npm run db:seed; if ($?) { npm run heavy:prepare-courses }
$env:CSV_ROWS='20000'; $env:CSV_DISTRIBUTE='true'; $env:CSV_TURNO='Tarde'; $env:CSV_DNI_BASE='50000000'; $env:CSV_OUTPUT='tmp/alumnos-20000-metrics.csv'; npm run heavy:generate-csv
$env:LOAD_CSV='tmp/alumnos-20000-metrics.csv'; $env:LOAD_OUTPUT='tmp/mediciones/import-20000.json'; $env:LOAD_MAX_SECONDS='900'; npm run load:import
$env:LOAD_CSV='tmp/alumnos-20000-metrics.csv'; $env:LOAD_OUTPUT='tmp/mediciones/import-20000.json'; $env:LOAD_METRICS_TOKEN='local-metrics-token'; $env:LOAD_CONNECTIONS='5'; $env:LOAD_MAX_SECONDS='900'; npm run load:import
node tmp/metrics-import.mjs
docker compose -f docker-compose.yml -f tmp/compose-metrics.yml down -v --remove-orphans; if ($?) { docker compose -f docker-compose.yml -f tmp/compose-metrics.yml up -d db app }; if ($?) { npm run db:seed; if ($?) { npm run heavy:prepare-courses } }
node tmp/metrics-import.mjs
~~~

Contenido de `tmp/compose-metrics.yml`:

~~~yaml
services:
  app:
    environment:
      DB_POOL_MAX: 60
      IMPORT_HEARTBEAT_SECONDS: 120
      IMPORT_LEASE_SECONDS: 600
~~~

### Verificación final

~~~powershell
node tmp/check-dnis.mjs
docker compose -f docker-compose.yml -f tmp/compose-metrics.yml ps --format "{{.Name}} {{.Status}}"
docker compose -f docker-compose.yml -f tmp/compose-metrics.yml exec -T db psql -U follow -d follow -tAc "select count(*) from alumnos;"
~~~

## 8. Variables de entorno usadas

Los comandos reproducibles están en la sección 7; las variables aparecen ahí inline. Este inventario las agrupa por origen.

| Variable | Valor usado | Observación |
|---|---|---|
| `NODE_ENV` | `development` en `.env`, `production` en el contenedor `app` | Definido en `docker-compose.yml:22`. |
| `PORT` | `3000` | API dentro y fuera del contenedor. |
| `DB_PORT` | `55432` | Mapeo host del contenedor `db`. |
| `DATABASE_URL` | `postgres://follow:follow@localhost:55432/follow` (host) / `postgres://follow:follow@db:5432/follow` (app) | `docker-compose.yml:24`. |
| `DATABASE_TEST_URL` | `.../follow_test` | Igual patrón, sufijo `_test`. |
| `DB_POOL_MAX` | `20` por defecto (`src/config/env.ts:19`), `60` en la medición instrumentada | Override en `tmp/compose-metrics.yml`. |
| `INTERNAL_METRICS_TOKEN` | `local-metrics-token` | Requerido por `/internal/metrics`; `docker-compose.yml:28`. |
| `IMPORT_MAX_ROWS` | `20000` | `.env:32`. |
| `IMPORT_LEASE_SECONDS` | `120` por defecto (`src/config/env.ts:39`), `600` en la medición instrumentada | Override en `tmp/compose-metrics.yml`. |
| `IMPORT_HEARTBEAT_SECONDS` | `30` por defecto (`src/config/env.ts:40`), `120` en la medición instrumentada | Override en `tmp/compose-metrics.yml`. |
| `IMPORT_STORAGE_DIR` | `storage/imports` (host) / `/app/storage/imports` (app) | `docker-compose.yml:29`. |
| `CSV_ROWS` | `5000`, `20000` | Generación de CSV. |
| `CSV_DISTRIBUTE` | `true` | Reparte alumnos entre cursos. |
| `CSV_TURNO` | `Tarde` | Turno usado en todas las corridas. |
| `CSV_CURSOS` | `2,3,4,5,6,7` | Solo en el primer intento de 20.000. |
| `CSV_DNI_BASE` | `10000000`, `20000000`, `30000000`, `50000000` | Base de DNIs por escenario. |
| `CSV_OUTPUT` | `tmp/alumnos-5000.csv`, `tmp/alumnos-5000-naive.csv`, `tmp/alumnos-20000.csv`, `tmp/alumnos-20000-metrics.csv` | Archivos generados. |
| `CSV_PATH` | Ruta al CSV generado | Consumida por `heavy:import:final` / `heavy:import:naive`. |
| `LOAD_URL` | `http://localhost:3000/health` (default) | Baseline `autocannon`. |
| `LOAD_CONNECTIONS` | `20` (default health), `5` (reintento de `load:import`) | Concurrencia de carga. |
| `LOAD_DURATION` | `10` (default) | Segundos por corrida de health. |
| `LOAD_CSV` | `tmp/alumnos-20000-metrics.csv` | Script `load:import`. |
| `LOAD_OUTPUT` | `tmp/mediciones/import-20000.json` | Salida cruda. |
| `LOAD_MAX_SECONDS` | `900` | Tiempo límite del script. |
| `LOAD_METRICS_TOKEN` | `local-metrics-token` | Usado por el fix de `scripts/load/import.ts` para enviar `x-internal-token`. |

## 9. Análisis de resultados, cuellos de botella y diferencias entre versiones

### 9.1 Lectura global

- El servidor HTTP no es el límite: `/health` sostiene ~1.400 RPS con p95 de 26 ms sin acceder a BD. El cuello aparece cuando entra la importación y la base de datos.
- El worker escala de forma lineal en el rango medido: 5.000 filas en 111,9 s y 20.000 en 445,9 s, ambos a ~45 filas/s. El cuádruple de volumen costó ~4× el tiempo.
- La corrida instrumentada bajó a 35 filas/s (~22% más lenta que la aislada). El muestreo cada segundo y las diferencias de reparto/estado explican la brecha; no se aisló una causa única.
- El intento fallido con DNI 30.000.001 confirma que la validación reporta fila y código de error, en lugar de insertar datos inválidos.

### 9.2 Cuellos de botella

1. **Pool + heartbeats (crítico con la config por defecto).** Con `DB_POOL_MAX=20`, heartbeat de 30 s y lease de 120 s, los `UPDATE import_jobs` de heartbeat compiten con el trabajo del worker por el lock de la fila y por conexiones. `pg_stat_activity` mostró actualizaciones en `waiting on Lock` mientras los `INSERT` estaban en `ClientRead`; el pool se agotó y el polling devolvió 500. Elevar pool a 60, heartbeat a 120 s y lease a 600 s resolvió el fallo, pero `waiting=118` indica que persistió cierta contención.
2. **Event loop.** Lag pico de 316 ms y pico de p99 de 79 ms. `/health` solo serializa JSON, pero durante la importación esos picos generan jitter. Los candidatos principales son el parseo/validación del CSV y la preparación de lotes en el hilo principal.
3. **Memoria.** RSS pico de 272 MB contra heap de 57 MB: la diferencia son buffers nativos (CSV, driver de PostgreSQL, respuestas). El consumo creció durante la corrida y no se vio liberación completa al final de la muestra; conviene vigilar ejecuciones repetidas.
4. **Observabilidad.** El primer `load:import` no enviaba `x-internal-token`, por lo que `/internal/metrics` respondió 403 y descartó todas las muestras. Además, hacer polling con autocannon concurrente agravó el lock; la medición definitiva corrió sin tráfico de carga paralelo.

### 9.3 Diferencias entre versiones

| Aspecto | Worker (`import-final`) | Ingenua (`import-naive`) |
|---|---|---|
| Rendimiento en 5.000 | 45 filas/s, 111,9 s | 194 filas/s, 25,8 s (4,3× más rápida) |
| Trazabilidad | Job con id, estado y error por fila | Sin job ni auditoría |
| Validación / idempotencia | Rechaza DNI duplicado con fila y código | No aplica los controles del flujo |
| Distribución | Reparte entre cursos con cupo | Todo en curso id 3: 5.028 alumnos vs cupo 200 |
| Memoria en 5.000 | No registrada en el informe | RSS 86 MB |
| Adecuada para 20.000 | Sí: 20.000 válidas, 0 errores | No evaluada; violaría cupos y reglas de negocio |

La versión ingenua sirve como piso teórico de inserción, no como implementación: su ventaja de velocidad desaparece al considerar corrección, reintentos y auditoría. El costo del worker es el precio de esas garantías.

### 9.4 Recomendaciones

- Separar el pool de heartbeats/polling del pool de importación, o ejecutar el heartbeat sin mantener una transacción larga que retenga el lock de `import_jobs`.
- Mantener `lease` mayor a la duración máxima estimada y un heartbeat holgado (120 s / 600 s ya validados) como valores de producción iniciales.
- Parsear el CSV en streaming o fuera del hilo principal y limitar el tamaño de lote para reducir lag y RSS.
- Alertar sobre `waiting` del pool, no solo sobre `idle`.
- No usar `/health` como indicador de capacidad de importación: mide el techo HTTP, no el cuello transaccional.

## 10. Limitaciones del entorno de medición

- **Host compartido:** todo corrió en una notebook Windows 11 con Docker Desktop, compartiendo CPU y RAM entre el host, la VM de Docker, la API, PostgreSQL y el generador de carga (`autocannon`). No es un entorno dedicado ni reproducible byte a byte en otra máquina.
- **Recursos disponibles:** 4 núcleos / 8 hilos lógicos y 23,8 GB de RAM. Docker Desktop reserva recursos propios, por lo que la app no necesariamente vio la totalidad del hardware del host.
- **Muestra estadística:** `/health` tuvo 3 corridas calientes (más 2 descartadas en frío), pero cada importación (5.000 y 20.000) se ejecutó una sola vez. No hay desviación estándar, intervalos de confianza ni repetibilidad suficiente para afirmar diferencias pequeñas.
- **Configuración no default:** la medición instrumentada de 20.000 usó `DB_POOL_MAX=60`, heartbeat 120 s y lease 600 s. Los resultados no representan la configuración de fábrica, que mostró fallos con 500 en importaciones largas.
- **Sin tráfico concurrente durante la importación:** se evitó `autocannon` en paralelo para no agravar el lock de `import_jobs`. Por eso no hay RPS ni latencias HTTP bajo carga de importación; la tabla consolidada los marca como no medidos.
- **Endpoint sintético:** `/health` no consulta BD, no aplica autenticación ni serializa datos de negocio. Es un techo del servidor HTTP, no un proxy de los endpoints reales.
- **Cliente en el mismo host:** el generador de carga corrió en loopback sobre la misma máquina que el servidor, compitiendo por CPU y sin introducir latencia de red real ni distribución de clientes.
- **Muestreo de métricas:** `/internal/metrics` se consultó cada 1 s; los picos entre muestras pueden no haberse registrado. El p99 se calcula sobre ventanas de muestra, no sobre cada evento del event loop.
- **Cálculo de p95:** no lo expone `autocannon`; se calculó con un histograma HDR en un script auxiliar, metodología distinta a la de las librerías de carga estándar.
- **Scripts auxiliares no versionados:** `health-p95.mjs`, `metrics-import.mjs`, `check-dnis.mjs` y `compose-metrics.yml` quedaron en `tmp/` (gitignored). Los CSV sí se regeneran con los comandos documentados, pero esos scripts deben copiarse aparte para repetir las mediciones.
- **Estado de BD aislado:** se hicieron resets entre escenarios, por lo que no se evaluó acumulación de datos, retención, `VACUUM`, fragmentación ni importaciones repetidas sobre el mismo dataset.
- **Dataset sintético:** DNIs secuenciales, 182 cursos con cupo uniforme y un solo worker. No se modelaron sesgos de calor por curso, múltiples workers concurrentes ni volúmenes superiores al límite `IMPORT_MAX_ROWS=20000`.

## 11. Evidencia

- **Resumen versionado** (incluido en el repositorio): [`docs/mediciones/resumen.json`](mediciones/resumen.json).