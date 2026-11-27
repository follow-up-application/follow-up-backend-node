# ADR-0003: JWT de acceso corto + refresh tokens + autorización por recurso

- **Estado:** aceptado
- **Fecha:** 2026-11-27
- **Decisores:** equipo de backend

## Contexto

La API atiende a cinco roles (administrador, preceptor, docente, alumno y tutor) sobre datos sensibles de estudiantes. El verificador de identidad debe ser stateless para no mantener sesiones en memoria, pero la revocación y el cambio de rol o de contraseña deben surtir efecto rápido. Además, el rol por sí solo no basta: un docente solo debe ver sus materias, un tutor solo a sus alumnos vinculados, un preceptor solo sus cursos y un alumno solo sus propios datos.

La autenticación y la autorización deben resolverse en la capa de aplicación, no solo en las rutas HTTP, para que cualquier caso de uso que invoque a un servicio aplique las mismas reglas.

## Decisión

Usar un **access token JWT de corta duración**, **refresh tokens opacos con rotación y familias**, y **autorización por rol combinada con verificación de propiedad del recurso**.

### Access token

- `JwtTokenService.issueAccess()` firma con HS256 y `JWT_SECRET` (mínimo 32 caracteres, validado al cargar el entorno). Incluye `sub`, `role`, `iat`, `exp`, `jti` y `password_change_only`; la TTL por defecto es `ACCESS_TOKEN_TTL_SECONDS=900`.
- `verifyAccess()` exige explícitamente el algoritmo HS256 y valida la forma de cada claim antes de construir `AccessTokenClaims`.
- El middleware `authenticate()` verifica el `Bearer`, vuelve a cargar el usuario y comprueba `isActive`; construye el `Actor` con el rol actual de la base, no solo con el claim, y lo deja en `res.locals.actor`.

### Refresh token

- `generateRefresh()` crea 48 bytes aleatorios en `base64url`; solo se guarda el hash SHA-256 en `auth_refresh_tokens` (`token_hash`), junto con `family_id`, `expires_at`, `user_agent` e `ip`. TTL por defecto: `REFRESH_TOKEN_TTL_DAYS=7`.
- Cada renovación crea un token nuevo de la misma familia, revoca el anterior registrando `replaced_by_id` y emite un access token nuevo, todo dentro de `PgUnitOfWork`.
- Si se presenta un token revocado, se revoca toda la familia y se lanza `TokenReuseDetectedError`. `logout` revoca la familia del token enviado (o todos los tokens del usuario) y `changePassword` revoca todos los tokens antes de emitir una sesión nueva.
- Si `must_change_password` es verdadero, el login emite un access token marcado con `password_change_only` y **no** emite refresh token; solo se permiten `GET /me`, `PUT /password` y logout.

### Autorización por recurso

- `requireRole()` y `requireSelfOrRole()` en `src/application/shared/context.ts` resuelven los requisitos de rol; `isAdmin()` e `isStaff()` cubren los casos compuestos. Se invocan desde los servicios de aplicación, no únicamente desde las rutas.
- Para cada recurso se comprueba la relación del actor: alumno sobre su propio `id`, tutor mediante `tutorAlumno.findByAlumno()`, docente mediante `materia.docenteId`, preceptor mediante `courseIds` asignados y administrador como superusuario.
- Los listados aplican el mismo alcance como filtros de repositorio (`alumnoId`, `tutorId`, `teacherId`, `courseIds`), evitando traer datos ajenos y filtrarlos después.
- Las negaciones por falta de propiedad suelen devolver `NotFoundError` para no revelar la existencia del recurso; las negaciones explícitas de rol devuelven `ForbiddenError`. Las mutaciones registran auditoría con el `Actor`, `requestId`, IP y user agent.

## Alternativas consideradas

- **Access token único de larga duración:** simplifica el cliente, pero extiende la ventana de exposición y hace imposible una rotación efectiva sin revocar todos los tokens.
- **Sesiones server-side con cookies opacas:** facilita la revocación inmediata, pero requiere estado compartido y protección CSRF; la API se consume desde clientes separados.
- **Tokens opacos con introspección en cada request:** permite revocar al instante, pero añade una consulta a la base por cada petición y acopla el verificador al almacenamiento.
- **Solo RBAC por rol:** más simple, pero permitiría que un docente consulte calificaciones de otra materia o un tutor las de un alumno no vinculado.

## Consecuencias

**Positivas**

- La vida del access token es corta y el refresh token nunca se almacena en texto plano; la rotación con detección de reuso limita el impacto de un robo.
- Cambios de rol, baja de usuario, cambio de contraseña y logout surten efecto en la siguiente petición o renovación.
- La autorización se aplica en los servicios, de modo que no depende de que una ruta concreta haya registrado el middleware correcto.
- El alcance por recurso se refleja tanto en la comprobación de entidades como en los filtros SQL de los listados.

**Negativas**

- El cliente debe implementar el flujo de renovación y manejar `401` (token expirado) y `403`/`404` (sin acceso).
- Cada request hace una consulta de usuario además de la verificación criptográfica del JWT.
- La rotación por familias, los plazos de gracia y la detección de reuso añaden complejidad al servicio de autenticación y a sus tests.
- El `jti` se emite pero no hay una lista de revocación de access tokens: un token ya emitido permanece válido hasta `exp`, si el usuario sigue activo.

## Verificación

Archivos que materializan la decisión: `src/config/env.ts`, `src/infra/security/token-service.ts`, `src/application/auth-service.ts`, `src/infra/db/repositories/identity.ts`, `src/infra/http/middleware.ts` y `src/application/shared/context.ts`. Se comprueba con `npm run test:security`, `npm run test:integration` y `npm run typecheck`.
