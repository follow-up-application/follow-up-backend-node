# ADR-0002: PostgreSQL con SQL directo y `node-pg-migrate` en lugar de ORM

- **Estado:** aceptado
- **Fecha:** 2026-11-27
- **Decisores:** equipo de backend

## Contexto

El dominio define entidades, reglas de negocio y puertos de repositorio propios; la persistencia es una capa de infraestructura que implementa esos puertos. Las reglas requieren garantías que no se resuelven solo en memoria: unicidad condicional (un ciclo activo por institución, un vínculo activo alumno-tutor), integridad referencial, precisión decimal en notas y porcentajes, control de concurrencia por versión y adjudicación de trabajos de importación sin bloqueos mutuos.

Además, el esquema debe ser reproducible y revisable: se ejecuta en local, en contenedores y en los tests de integración, y necesita migraciones aplicadas de forma determinista.

## Decisión

Usar **PostgreSQL como gestor de base de datos**, acceder con **SQL explícito a través del driver `pg`** y gestionar el esquema con **`node-pg-migrate`**. No usar ORM ni query builder.

La implementación es:

- `src/infra/db/client.ts` crea un `Pool` de `pg` con `DATABASE_URL` y `DB_POOL_MAX`, configura el parser de tipos para `date`/`timestamp` y expone `query()` y `clientOf(tx)` para elegir entre el pool y la conexión de la transacción.
- Cada repositorio (`PgUserRepository`, `PgImportJobRepository`, etc.) implementa un puerto del dominio con sentencias SQL parametrizadas (`$1`, `$2`, …). No hay entidades anotadas ni generadas por una herramienta externa.
- `src/infra/db/mappers.ts` convierte filas SQL en entidades de dominio, conservando los tipos (`Decimal`, `LocalDate`, `UserId`) en la frontera entre capas.
- `PgUnitOfWork.transaction()` ejecuta `BEGIN` / `COMMIT` / `ROLLBACK` sobre un `PoolClient` y libera la conexión; los `UPDATE` de versión usan `WHERE id = $1 AND version = $n` y `assertUpdated()` traduce `rowCount = 0` en `StaleVersionError`.
- Las restricciones y la concurrencia se apoyan en PostgreSQL: `CHECK`, `UNIQUE`, índices únicos parciales, triggers (`set_updated_at`, prevención de borrado físico de `users`), `ON CONFLICT ... DO NOTHING` para idempotencia y `FOR UPDATE SKIP LOCKED` para reclamar importaciones pendientes.
- El esquema vive en migraciones SQL (`src/infra/db/migrations/1700000000000_initial.sql`) ejecutadas con `node-pg-migrate up|down -m src/infra/db/migrations -j sql --envPath .env`. Los comandos `db:migrate`, `db:rollback`, `db:seed`, `db:reset` y `setup` son la única vía para preparar la base.

## Alternativas consideradas

- **ORM (Prisma, TypeORM, Sequelize):** reduce el código de repositorio, pero añade un modelo de datos paralelo al dominio y una capa generada; dificulta expresar índices parciales, `SKIP LOCKED`, `ON CONFLICT`, intervalos de expiración y conversiones `numeric` exactas sin salir al SQL nativo.
- **Query builder (Knex):** evita la generación de entidades, pero mantiene una abstracción intermedia que no aporta frente a SQL legible y revisable en los repositorios.
- **Sincronizar el esquema desde el código o aplicar SQL manual sin migraciones:** agiliza el desarrollo inicial, pero no deja historial revisable ni garantiza el mismo esquema entre entornos.

## Consecuencias

**Positivas**

- Control total sobre el SQL ejecutado: se pueden elegir índices, bloqueos, agregaciones y conversiones de tipos según cada caso de uso.
- Las invariantes críticas se refuerzan en la base con restricciones, de modo que se mantienen aunque exista un error en la capa de aplicación.
- Las migraciones son archivos SQL versionables y revisables en PR; el esquema no depende del estado de las entidades TypeScript.
- Menos dependencias y menos indirección entre el repositorio y lo que realmente ejecuta PostgreSQL.

**Negativas**

- Los repositorios son más extensos: hay que escribir columnas, parámetros y conversiones de filas de forma explícita.
- El mapeo entre filas y entidades es manual; un cambio de columna requiere actualizar la consulta, el mapper y los tests.
- Se renuncia a la portabilidad entre motores y a las herramientas de generación automática de un ORM.
- La correctitud concurrente depende de que cada operación use la transacción y la cláusula de bloqueo adecuadas.

## Verificación

Archivos que materializan la decisión: `src/infra/db/client.ts`, `src/infra/db/unit-of-work.ts`, `src/infra/db/mappers.ts`, `src/infra/db/repositories/` y `src/infra/db/migrations/`. Se comprueba con `npm run db:migrate`, `npm run db:seed`, `npm run typecheck` y la suite `npm run test:integration`.
