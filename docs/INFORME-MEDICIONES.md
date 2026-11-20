# Informe de mediciones de carga

## Entorno

- PostgreSQL 16 (Docker Compose) + API Node.js 22 en contenedor, rebuild limpio con `docker compose down -v`.
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
