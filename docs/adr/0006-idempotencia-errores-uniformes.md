# ADR-0006: Idempotencia y manejo uniforme de errores

- **Estado:** aceptado
- **Fecha:** 2026-11-27
- **Decisores:** equipo de backend

## Contexto

Los clientes pueden reintentar una petición ante un timeout o una desconexión. Sin idempotencia, un reintento de `POST` puede crear dos alumnos, dos calificaciones o dos importaciones. Además, los errores surgen de lugares muy distintos: reglas de dominio, validación de esquemas Zod, parser de JSON de Express, restricciones de PostgreSQL y fallos inesperados. Si cada ruta responde con un formato propio, el cliente no puede distinguir un error de validación de un conflicto ni correlacionar los logs con la petición que lo originó.

## Decisión

Usar **idempotencia basada en clave de solicitud persistida en PostgreSQL** y un **único manejador de errores HTTP** con un contrato de respuesta común.

### Idempotencia

- El middleware `idempotency(c, options)` se aplica a las mutaciones. Exige `Idempotency-Key` de 8 a 255 caracteres (`400 IDEMPOTENCY_KEY_REQUIRED`).
- El scope es `user:<actorId>` para peticiones autenticadas y `public:tutor-code:<sha256(codigo)>` en el registro público de tutores.
- El `requestHash` se calcula con método, ruta, cuerpo canonicalizado (claves ordenadas, `Buffer` reemplazado por su SHA-256) y un `extraHash` opcional: la importación CSV incluye el hash del archivo para distinguir dos cargas con la misma clave.
- La clave se reserva con `INSERT ... ON CONFLICT (scope_key, clave) DO NOTHING` en `idempotency_keys`, con estado `procesando` y TTL de `IDEMPOTENCY_TTL_HOURS` (24 h por defecto).
- Si la clave ya está `completada` y el hash coincide, se repite el `status` y el cuerpo originales con la cabecera `Idempotent-Replayed: true`. Si el hash difiere, `409 IDEMPOTENCY_KEY_REUSED`; si sigue `procesando`, `409 CONFLICT`. Las claves expiradas se liberan.
- Solo las respuestas `2xx` se marcan como completadas; cualquier error libera la clave para permitir el reintento. Se guarda también el `resourceId` cuando el cuerpo tiene un `id` string.

### Errores

- Las reglas de negocio lanzan subclases de `DomainError` definidas en `src/domain/shared/errors.ts`, con `code`, `httpStatus`, `message` y `details?` opcionales (por ejemplo `VALIDATION_ERROR` 422, `NOT_FOUND` 404, `FORBIDDEN` 403, `STALE_VERSION` 409).
- Los esquemas Zod validan body, query y params antes de invocar a los servicios; los errores de parseo de JSON y de tamaño excedido de Express también se normalizan.
- Un único `errorHandler` al final de `createApp()` traduce: `DomainError` a su estado/código, `ZodError` a `422 VALIDATION_ERROR` con detalle por campo, PostgreSQL `23505` a `409 DUPLICATE_RESOURCE`, `23503`/`23514` a `409 CONFLICT`, `entity.parse.failed` a `400 MALFORMED_JSON` y `entity.too.large` a `413 PAYLOAD_TOO_LARGE`. Cualquier otro error se registra y se responde como `500 INTERNAL_ERROR` sin exponer el mensaje original.
- La forma de respuesta es siempre `{ error: { code, message, details? }, message, requestId }`. El middleware `requestId` se ejecuta primero, acepta un `x-request-id` válido o genera un UUID, y lo devuelve en `X-Request-Id`; `notFoundHandler`, el rate limiter y las respuestas de `/ready` usan la misma forma.
- `asyncHandler` reenvía las promesas rechazadas al manejador central, de modo que las rutas no necesitan `try/catch`.

## Alternativas consideradas

- **Manejo de errores por ruta:** permitiría mensajes ricos, pero produciría formatos inconsistentes y filtraría detalles internos.
- **Confiar en el manejo por defecto de Express:** no garantiza códigos estables ni un `requestId` correlacionable.
- **Idempotencia en memoria:** se perdería al reiniciar y no funcionaría con varias instancias del API.
- **Apoyarse solo en restricciones únicas de la base:** evita duplicados, pero no permite al cliente recuperar la respuesta original de un reintento exitoso.

## Consecuencias

**Positivas**

- Un reintento con la misma clave y el mismo pedido no duplica efectos y devuelve la respuesta original.
- Los clientes pueden ramificar por `error.code` con un contrato estable, documentado en `docs/api.md`.
- Cada error puede correlacionarse con su `requestId` en los logs.
- Los errores de la base se traducen a semántica de dominio antes de salir del servidor, y los fallos internos no exponen detalles.

**Negativas**

- Toda mutación requiere una clave, con una inserción adicional y lecturas de la tabla `idempotency_keys`; es necesario controlar su crecimiento por TTL.
- El hash debe incluir todo lo que cambia el resultado; por eso la importación CSV necesita un `extraHash` explícito.
- La interceptación de `res.json` y el guardado en el evento `finish` añaden complejidad al middleware.
- Dos peticiones concurrentes con la misma clave pueden terminar en `409 CONFLICT`, por lo que el cliente debe reintentar esa respuesta.

## Verificación

Archivos que materializan la decisión: `src/domain/shared/errors.ts`, `src/infra/http/middleware.ts`, `src/infra/http/app.ts`, `src/infra/db/repositories/idempotency.ts` y `src/infra/http/schemas.ts`. El contrato está documentado en `docs/api.md` (secciones "Errores" e "Idempotencia") y se comprueba con `npm run test:concurrency`, `npm run test:integration` y `npm run typecheck`.
