# Follow App - Backend

Follow App es una API REST de gestión educativa para instituciones secundarias.
Permite administrar usuarios con roles (administrador, preceptor, docente, alumno y tutor), cursos, materias e inscripciones.
Registra clases, asistencias, justificaciones, períodos, instancias de evaluación y calificaciones con reglas de condición.
Incluye autenticación JWT con refresh tokens, autorización por rol y recurso, auditoría e idempotencia.
Suma importación masiva de alumnos por CSV con procesamiento en worker threads y notificaciones asíncronas.

## Requisitos

- Node.js 22 o superior
- PostgreSQL 16 (o Docker para levantar la base)
- npm

## Puesta en marcha

```bash
# 1. Crear el archivo de entorno
Copy-Item .env.example .env        # PowerShell
# cp .env.example .env             # Bash/Git Bash

# 2. Instalar dependencias
npm ci

# 3. Levantar PostgreSQL con Docker (opcional si ya tenés una base local)
docker compose up -d db

# 4. Aplicar migraciones y cargar datos de prueba
npm run setup

# 5. Iniciar el servidor en modo desarrollo
npm run dev
```

La API queda disponible en `http://localhost:3000/api/v1`.
Los endpoints de salud son `GET /health` y `GET /ready`.

## Comandos disponibles

### Desarrollo y ejecución

```bash
npm run dev            # Servidor con recarga automática (tsx watch)
npm run build          # Compilar TypeScript a dist/
npm start              # Ejecutar la versión compilada
```

### Base de datos

```bash
npm run db:migrate     # Aplicar migraciones
npm run db:rollback    # Revertir la última migración
npm run db:seed        # Cargar datos de prueba
npm run db:reset       # Reiniciar esquema, migrar y sembrar
npm run setup          # Esperar la base, migrar y sembrar
```

### Tests

```bash
npm test               # Toda la suite
npm run test:domain    # Tests de dominio
npm run test:integration # Tests de integración
npm run test:security  # Tests de seguridad
npm run test:concurrency # Tests de concurrencia
npm run test:watch     # Tests en modo watch
```

### Calidad de código

```bash
npm run lint           # ESLint
npm run typecheck      # Verificación de tipos
npm run format         # Formatear con Prettier
npm run format:check   # Verificar formato
```

### Medición y carga (opcionales)

```bash
npm run heavy:generate-csv     # Generar CSV de alumnos
npm run heavy:prepare-courses  # Preparar cursos para la prueba
npm run heavy:import:naive     # Importación de referencia (hilo principal)
npm run heavy:import:final     # Importación con el worker
npm run load:health            # Prueba de carga sobre /health
npm run load:import            # Prueba de carga sobre importación
```

## Usuarios de prueba

Creados por `npm run db:seed` (solo en entornos que no sean producción). El login se realiza con `username` y `password` en `POST /api/v1/auth/login`.

| Rol | Username | Contraseña | Observaciones |
| --- | --- | --- | --- |
| Administrador | `admin` | `Admin1234!` | Acceso completo |
| Preceptor | `PRE-30111222-2026` | `30111222` | Debe cambiar la contraseña |
| Docente | `DOC-30222333-2024` | `30222333` | Debe cambiar la contraseña |
| Alumno | `EST-40123456-2026` | `40123456` | Debe cambiar la contraseña |
| Tutor | `laura@example.com` | `Tutor1234!` | El username es el email |

## Colección Postman

La colección está en `docs/postman/follow-up-api.postman_collection.json` (formato v2.1). No requiere un environment separado: todas las variables vienen precargadas en la colección.

### Importar

1. Postman → **Import** → **File** → seleccionar `docs/postman/follow-up-api.postman_collection.json`.
2. Verificar que `baseUrl` sea `http://localhost:3000` (o el endpoint donde corre la API).
3. No hay secretos reales: los tokens arrancan vacíos y las credenciales son las del seed local de la tabla anterior.

### Ejecutar

Con la API levantada (`npm run setup` y `npm run dev`), ejecutar los folders en este orden:

1. `00 - Operativos`: `Health` y `Ready`.
2. `01 - Autenticación y sesión`: `Login` (o su alias) con admin. Guarda `accessToken`/`refreshToken` y `adminAccessToken`/`adminRefreshToken`.
3. `02 - Identidad` → `03 - Académico` → `04 - Asistencia` → `05 - Calificaciones y condiciones` → `06 - Importación CSV` → `07 - Auditoría`.
4. `08 - Casos de error`: ejecutar al final; el caso 403 requiere `Login tutor (para 403)` y el 409 requiere Login admin previo y sus dos requests en orden.

También se puede usar el **Collection Runner** seleccionando la colección completa; los scripts setean los IDs generados en las variables correspondientes.

Para cambiar de rol, copiar `<rol>Username`/`<rol>Password` en `loginUsername`/`loginPassword` y ejecutar `Login` nuevamente. Los tokens por rol quedan en `<rol>AccessToken`/`<rol>RefreshToken`.

### Puntos de atención

- El script de pre-request genera una `Idempotency-Key` por request. Para repetir exactamente el mismo request, setear `reuseIdempotencyKey=true` y luego volver a `false`.
- Para importar CSV, setear `csvPath` con una ruta local o seleccionar el archivo en el Body. `importIdempotencyKey` está explícita; cambiarla para importar otro archivo.
- `tutorCodigo` apunta al código seed ya registrado. Para probar `POST /tutores/register`, setear `tutorCodigoRegistro` con un código pendiente.
- Los casos de error tienen `pm.test` con asserts de 401, 403, 409 y 422.
