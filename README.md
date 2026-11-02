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
