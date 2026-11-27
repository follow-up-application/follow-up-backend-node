# Architecture Decision Records (ADR)

Este directorio contiene los **Architecture Decision Records** del backend: decisiones de diseño relevantes, registradas junto con su contexto y sus consecuencias en el momento en que se tomaron.

Cada decisión se documenta en un archivo Markdown propio e inmutable: si una decisión cambia, se escribe un ADR nuevo que la reemplaza, sin modificar el original.

## Convenciones

- **Nombre de archivo:** `NNNN-titulo-en-kebab-case.md`, con `NNNN` correlativo (por ejemplo, `0001-stack-tecnologico.md`).
- **Numeración:** se asigna el siguiente número libre; nunca se reutiliza un número de un ADR rechazado o superado.
- **Estado:** `propuesto` → `aceptado` | `rechazado` | `deprecado` | `superado por ADR-NNNN`.
- **Estructura sugerida:** título, estado, fecha, contexto, decisión, alternativas consideradas y consecuencias (positivas y negativas).

Para agregar una decisión, crear el archivo con el siguiente número correlativo y completar la fila correspondiente en el índice.

## Índice

| ADR | Título | Estado | Fecha |
| --- | --- | --- | --- |
| [0001](0001-node-typescript-esm.md) | Node.js 22 + TypeScript + ESM | aceptado | 2026-11-27 |
| [0002](0002-postgresql-sql-node-pg-migrate.md) | PostgreSQL con SQL directo y `node-pg-migrate` en lugar de ORM | aceptado | 2026-11-27 |
| [0003](0003-jwt-refresh-autorizacion-por-recurso.md) | JWT de acceso corto + refresh tokens + autorización por recurso | aceptado | 2026-11-27 |
| [0004](0004-bloqueo-pesimista-cierre-calificaciones.md) | Bloqueo pesimista y transacciones para la carrera de calificaciones/cierre | aceptado | 2026-11-27 |
| [0005](0005-worker-threads-importacion-csv.md) | `worker_threads` para la importación CSV | aceptado | 2026-11-27 |
| [0006](0006-idempotencia-errores-uniformes.md) | Idempotencia y manejo uniforme de errores | aceptado | 2026-11-27 |

## Documentación relacionada

Mientras se migran las decisiones existentes a este formato, las siguientes guías documentan decisiones ya implementadas:

- [Modelo de dominio y reglas de negocio](../modelo.md)
- [Especificación de la API](../api.md)
- [Informe de mediciones](../INFORME-MEDICIONES.md)
