# Guía para la API de reportes y certificados (Python + Django)

Fecha: 2026-11-17
Repo relacionado: `follow-up-backend-node`

## 1. Objetivo

Construir un servicio Django que **genere documentos** (reportes en PDF/XLSX y certificados en PDF) a partir de la misma base PostgreSQL que ya usa la API Node. Node sigue siendo la fachada pública: el cliente llama a Node, Node valida permisos y llama a este servicio. Django nunca expone CRUD de las tablas académicas.

La BD real tiene el esquema en `src/infra/db/migrations/1700000000000_initial.sql`. Los nombres de tablas/columnas de las consultas de esta guía son los reales de ese archivo.

## 2. Decisiones de diseño

| Decisión | Detalle |
| --- | --- |
| Node es el único cliente | Django solo escucha llamadas con `X-Service-Token`. No se publica en el gateway. |
| BD compartida, acceso distinto | `reports_reader` con `SELECT` en `public`; `reports_writer` dueño del schema `reportes` para las tablas propias del servicio. |
| No recalcular condiciones | `condiciones_alumno` ya persiste el resultado del cierre de periodo (`periodo_cierres`). Django solo lo lee. Recalcular la regla en Python duplicaría `calculateCondition()` de Node. |
| Async por defecto | `POST` devuelve `202` con un `id` de job; se consulta estado y se descarga. Se reserva `200` con binario solo para documentos chicos. |
| Idempotencia | `Idempotency-Key` obligatoria en los `POST`, igual que en Node (`src/infra/http/middleware.ts:179`). Se guarda el `request_hash` y se devuelve la misma respuesta. |
| Formatos | Reportes: `pdf` o `xlsx`. Certificados: solo `pdf`, cualquier otro valor devuelve `422`. |
| Trazabilidad | Node envía `requested_by` (uuid del usuario) y `request_id`; Django guarda ambos en el job y en el certificado. |
| Auditoría | `auditoria` es append-only en la BD; Django solo hace `SELECT`. La escritura de auditoría la hace Node. |

## 3. Estructura propuesta del proyecto

```text
follow-up-reports/
├── pyproject.toml
├── .env.example
├── manage.py
├── config/
│   ├── __init__.py
│   ├── settings.py
│   ├── urls.py
│   ├── celery.py
│   └── wsgi.py
├── reports/
│   ├── __init__.py
│   ├── apps.py
│   ├── models.py                 # DocumentJob, Certificate
│   ├── db_router.py
│   ├── permissions.py
│   ├── idempotency.py
│   ├── registry.py               # catálogo tipo -> query/serializer/formatos
│   ├── queries/
│   │   ├── asistencia.py
│   │   ├── calificaciones.py
│   │   ├── condiciones.py
│   │   ├── inscripciones.py
│   │   ├── auditoria.py
│   │   └── certificados.py
│   ├── documents/
│   │   ├── pdf.py
│   │   ├── xlsx.py
│   │   ├── storage.py
│   │   └── templates/            # logo institucional, fuentes
│   ├── tasks.py
│   ├── api/
│   │   ├── urls.py
│   │   ├── views.py
│   │   └── serializers.py
│   └── migrations/
└── tests/
    ├── conftest.py
    ├── test_auth.py
    ├── test_reportes.py
    ├── test_certificados.py
    └── test_documentos.py
```

## 4. Dependencias

`pyproject.toml` (mínimo razonable):

```toml
[project]
name = "follow-up-reports"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "django>=5.1",
  "djangorestframework>=3.15",
  "drf-spectacular>=0.27",
  "psycopg[binary]>=3.2",
  "django-environ>=0.11",
  "celery>=5.4",
  "redis>=5.1",
  "reportlab>=4.2",
  "XlsxWriter>=3.2",
  "Pillow>=11.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "pytest-django>=4.9", "ruff>=0.8"]
```

Notas:

- ReportLab cubre PDF tabulares simples sin depender de un motor HTML.
- Si después se quieren plantillas HTML/CSS, agregar `weasyprint` y mantener el mismo renderer interface.
- `XlsxWriter` con `constant_memory=True` para padrones grandes.
- Fuentes con acentos: incluir DejaVuSans.ttf en `documents/templates/` y registrar la fuente en ReportLab (ver §10).

## 5. Configuración

### 5.1 Variables de entorno

```dotenv
DJANGO_SECRET_KEY=cambiar-por-un-valor-largo-y-aleatorio
DEBUG=false
ALLOWED_HOSTS=localhost,127.0.0.1,reports

DATABASE_URL=postgres://reports_reader:CHANGE_ME@db:5432/follow
JOBS_DATABASE_URL=postgres://reports_writer:CHANGE_ME@db:5432/follow
REDIS_URL=redis://redis:6379/0

SERVICE_TOKEN=token-largo-compartido-con-node
STORAGE_DIR=/app/storage/documents
DOCUMENT_TTL_HOURS=72
MAX_ROWS=20000
TIME_ZONE=America/Argentina/Buenos_Aires
```

### 5.2 Usuarios y schema en PostgreSQL

Ejecutar una vez como superusuario (o agregarlo como migración SQL manual del proyecto de reportes):

```sql
CREATE ROLE reports_reader LOGIN PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE follow TO reports_reader;
GRANT USAGE ON SCHEMA public TO reports_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reports_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reports_reader;

CREATE ROLE reports_writer LOGIN PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE follow TO reports_writer;
CREATE SCHEMA reportes AUTHORIZATION reports_writer;
```

`reports_reader` no tiene `INSERT`/`UPDATE`/`DELETE` en ninguna tabla académica.

### 5.3 `config/settings.py`

```python
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent
env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "drf_spectacular",
    "reports",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "reports.idempotency.IdempotencyMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": env.db("JOBS_DATABASE_URL"),
    "follow": env.db("DATABASE_URL"),
}
DATABASES["default"]["OPTIONS"] = {"options": "-c search_path=reportes"}
DATABASE_ROUTERS = ["reports.db_router.ReportsRouter"]

SERVICE_TOKEN = env("SERVICE_TOKEN")
STORAGE_DIR = Path(env("STORAGE_DIR", default="storage/documents"))
DOCUMENT_TTL_HOURS = env.int("DOCUMENT_TTL_HOURS", default=72)
MAX_ROWS = env.int("MAX_ROWS", default=20000)
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TASK_TRACK_STARTED = True
CELERY_TIMEZONE = env("TIME_ZONE", default="America/Argentina/Buenos_Aires")

USE_TZ = True
TIME_ZONE = CELERY_TIMEZONE
LANGUAGE_CODE = "es-ar"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["reports.permissions.ServiceTokenPermission"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "reports.api.views.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {"TITLE": "Follow Reports API", "VERSION": "1.0.0"}
```

### 5.4 `reports/db_router.py`

```python
class ReportsRouter:
    def db_for_read(self, model, **hints):
        return "default" if model._meta.app_label == "reports" else "follow"

    def db_for_write(self, model, **hints):
        return "default" if model._meta.app_label == "reports" else "follow"

    def allow_relation(self, obj1, obj2, **hints):
        return obj1._meta.app_label == obj2._meta.app_label

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        return db == "default" and app_label == "reports"
```

## 6. Modelos propios

```python
import uuid
from django.db import models


class DocumentJob(models.Model):
    ESTADOS = [
        ("pendiente", "pendiente"),
        ("procesando", "procesando"),
        ("listo", "listo"),
        ("fallido", "fallido"),
        ("cancelado", "cancelado"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tipo = models.CharField(max_length=40)
    formato = models.CharField(max_length=4)
    estado = models.CharField(max_length=16, default="pendiente")
    solicitado_por = models.UUIDField()
    request_id = models.CharField(max_length=100, blank=True)
    idempotency_key = models.CharField(max_length=255, unique=True)
    request_hash = models.CharField(max_length=64)
    filtros = models.JSONField(default=dict)
    snapshot = models.JSONField(default=dict, blank=True)
    storage_path = models.CharField(max_length=500, blank=True)
    nombre_archivo = models.CharField(max_length=255, blank=True)
    checksum = models.CharField(max_length=64, blank=True)
    total_filas = models.PositiveIntegerField(default=0)
    progreso = models.PositiveSmallIntegerField(default=0)
    error_code = models.CharField(max_length=50, blank=True)
    error_message = models.TextField(blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["estado", "created_at"]),
            models.Index(fields=["solicitado_por", "created_at"]),
            models.Index(fields=["expires_at"]),
        ]


class Certificate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    numero = models.CharField(max_length=40, unique=True)
    tipo = models.CharField(max_length=40)
    alumno_id = models.UUIDField()
    ciclo_lectivo_id = models.UUIDField()
    job = models.OneToOneField(
        DocumentJob, null=True, blank=True, on_delete=models.SET_NULL, related_name="certificado"
    )
    payload = models.JSONField(default=dict)
    hash_sha256 = models.CharField(max_length=64)
    pdf_path = models.CharField(max_length=500)
    emitido_en = models.DateTimeField(auto_now_add=True)
    anulado = models.BooleanField(default=False)
    anulado_en = models.DateTimeField(null=True, blank=True)
    motivo_anulacion = models.CharField(max_length=500, blank=True)
```

Migraciones: `python manage.py makemigrations reports && python manage.py migrate --database=default`.

## 7. Contrato HTTP

Base: `/api/v1`.

Headers obligatorios en todos menos `health`, `ready` y `verificar`:

```text
X-Service-Token: <comparte con Node>
Idempotency-Key: <uuid, solo POST>   (mismo valor que recibió Node)
Content-Type: application/json
```

Formato de error igual al de Node:

```json
{
  "error": {
    "code": "FORMATO_NO_PERMITIDO",
    "message": "Los certificados solo se generan en PDF.",
    "details": { "formato": "xlsx" }
  }
}
```

Códigos: `400` validación, `401` token inválido, `404` job inexistente, `409` idempotency key reutilizada, `422` regla de negocio (formato/cantidad de filas/periodo no cerrado), `429` rate limit, `503` Redis o storage caídos.

`reports/api/views.py`:

```python
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    detail = response.data
    if isinstance(detail, dict) and "error" in detail:
        return response
    code = getattr(exc, "code", "validation_error")
    if isinstance(code, str) is False:
        code = "validation_error"
    response.data = {"error": {"code": code.upper(), "message": str(detail), "details": detail}}
    return response
```

### 7.1 Tabla de endpoints

| Método | Path | Body / query | Respuesta |
| --- | --- | --- | --- |
| `POST` | `/reportes/asistencia` | `cicloLectivoId`, `cursoDivisionTurnoId?`, `materiaId?`, `alumnoId?`, `desde`, `hasta`, `formato` | `202` job |
| `POST` | `/reportes/calificaciones` | `cicloLectivoId`, `periodoId?`, `cursoDivisionTurnoId?`, `alumnoId?`, `formato` | `202` job |
| `POST` | `/reportes/condiciones` | `periodoId`, `cursoDivisionTurnoId?`, `formato` | `202` job |
| `POST` | `/reportes/inscripciones` | `cicloLectivoId`, `cursoDivisionTurnoId?`, `estado?`, `formato` | `202` job |
| `POST` | `/reportes/auditoria` | `desde`, `hasta`, `actorId?`, `accion?`, `limite?`, `formato` | `202` job |
| `POST` | `/certificados/regularidad` | `alumnoId`, `cicloLectivoId`, `periodoId?` | `202` job |
| `POST` | `/certificados/calificaciones` | `alumnoId`, `cicloLectivoId`, `periodoId?` | `202` job |
| `POST` | `/certificados/asistencia` | `alumnoId`, `cicloLectivoId`, `desde`, `hasta` | `202` job |
| `POST` | `/certificados/inscripcion` | `alumnoId`, `cicloLectivoId` | `202` job |
| `GET` | `/documentos/tipos` | - | catálogo de tipos y formatos |
| `GET` | `/documentos/{id}` | - | estado del job |
| `GET` | `/documentos/{id}/descargar` | - | binario con `Content-Disposition` |
| `POST` | `/documentos/{id}/cancelar` | - | `200` job cancelado (si está pendiente) |
| `GET` | `/certificados/verificar` | `numero`, `hash` | datos públicos mínimos del certificado |
| `POST` | `/certificados/{id}/anular` | `motivo` | certificado anulado |
| `GET` | `/health`, `/ready` | - | estado del proceso y de las dos BD |

Ejemplo de request:

```json
POST /api/v1/reportes/asistencia
{
  "cicloLectivoId": "6e5b1c40-...",
  "cursoDivisionTurnoId": 12,
  "desde": "2026-03-01",
  "hasta": "2026-06-30",
  "formato": "xlsx",
  "solicitadoPor": "11111111-1111-1111-1111-111111111111",
  "requestId": "req-9b8a7c"
}
```

Ejemplo de `202`:

```json
{
  "id": "0f2c8b6e-...",
  "tipo": "asistencia",
  "formato": "xlsx",
  "estado": "pendiente",
  "progreso": 0,
  "url": "/api/v1/documentos/0f2c8b6e-.../descargar",
  "expiresAt": "2026-11-20T12:00:00Z"
}
```

Ejemplo de `GET /documentos/{id}` con el job listo:

```json
{
  "id": "0f2c8b6e-...",
  "estado": "listo",
  "progreso": 100,
  "formato": "xlsx",
  "nombreArchivo": "asistencia-2026-03-01-2026-06-30.xlsx",
  "checksum": "sha256:9f2a...",
  "totalFilas": 1840,
  "url": "/api/v1/documentos/0f2c8b6e-.../descargar"
}
```

## 8. Validación y registro de tipos

```python
from rest_framework import serializers

FORMATOS_REPORTE = {"pdf", "xlsx"}
FORMATOS_CERTIFICADO = {"pdf"}


class BaseDocumentSerializer(serializers.Serializer):
    formato = serializers.ChoiceField(choices=["pdf", "xlsx"])
    solicitadoPor = serializers.UUIDField()
    requestId = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if self.context["kind"] in CERTIFICADOS and attrs["formato"] != "pdf":
            raise serializers.ValidationError(
                {"formato": "Los certificados solo se generan en PDF."}, code="formato_no_permitido"
            )
        return attrs


class AsistenciaSerializer(BaseDocumentSerializer):
    cicloLectivoId = serializers.UUIDField()
    cursoDivisionTurnoId = serializers.IntegerField(required=False, min_value=1)
    materiaId = serializers.IntegerField(required=False, min_value=1)
    alumnoId = serializers.UUIDField(required=False)
    desde = serializers.DateField()
    hasta = serializers.DateField()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs["desde"] > attrs["hasta"]:
            raise serializers.ValidationError({"desde": "Debe ser <= hasta."})
        return attrs
```

`reports/registry.py`:

```python
REPORTES = {
    "asistencia": {"serializer": AsistenciaSerializer, "query": query_asistencia, "titulo": "Reporte de asistencia"},
    "calificaciones": {"serializer": CalificacionesSerializer, "query": query_calificaciones, "titulo": "Reporte de calificaciones"},
    "condiciones": {"serializer": CondicionesSerializer, "query": query_condiciones, "titulo": "Reporte de condiciones"},
    "inscripciones": {"serializer": InscripcionesSerializer, "query": query_inscripciones, "titulo": "Padrón de inscripciones"},
    "auditoria": {"serializer": AuditoriaSerializer, "query": query_auditoria, "titulo": "Reporte de auditoría"},
}

CERTIFICADOS = {
    "regularidad": {"serializer": RegularidadSerializer, "query": query_regularidad, "titulo": "Constancia de regularidad"},
    "calificaciones": {"serializer": CertificadoNotasSerializer, "query": query_notas, "titulo": "Constancia de calificaciones"},
    "asistencia": {"serializer": CertificadoAsistenciaSerializer, "query": query_asistencia_certificado, "titulo": "Constancia de asistencia"},
    "inscripcion": {"serializer": InscripcionSerializer, "query": query_inscripcion_certificado, "titulo": "Constancia de inscripción"},
}
```

## 9. Consultas sobre la BD existente

Regla: siempre `SELECT`. Usar `connection("follow")` o un `cursor` con `using="follow"`. Los parámetros son `%(nombre)s` con psycopg.

Asistencia:

```sql
SELECT c.fecha,
       cd.curso, cd.division, cd.turno,
       m.nombre AS materia,
       u.first_name || ' ' || u.last_name AS alumno,
       a.estado, a.justificacion
FROM asistencias a
JOIN clases c ON c.id = a.clase_id
JOIN materias m ON m.id = c.materia_id
JOIN curso_division_turno cd ON cd.id = m.curso_division_turno_id
JOIN alumnos al ON al.id = a.alumno_id
JOIN users u ON u.id = al.id
WHERE c.fecha BETWEEN %(desde)s AND %(hasta)s
  AND (%(ciclo_id)s::uuid IS NULL OR cd.ciclo_lectivo_id = %(ciclo_id)s::uuid)
  AND (%(curso_id)s::bigint IS NULL OR cd.id = %(curso_id)s::bigint)
  AND (%(materia_id)s::bigint IS NULL OR m.id = %(materia_id)s::bigint)
  AND (%(alumno_id)s::uuid IS NULL OR a.alumno_id = %(alumno_id)s::uuid)
ORDER BY c.fecha, cd.curso, cd.division, alumno
LIMIT %(limite)s;
```

Resumen de asistencia por alumno (útil para el certificado):

```sql
SELECT al.id AS alumno_id,
       u.first_name || ' ' || u.last_name AS alumno,
       count(*) AS total_clases,
       count(*) FILTER (WHERE a.estado = 'presente') AS presentes,
       count(*) FILTER (WHERE a.estado = 'justificada') AS justificadas,
       count(*) FILTER (WHERE a.estado = 'ausente') AS ausentes,
       round(100.0 * count(*) FILTER (WHERE a.estado IN ('presente', 'justificada'))
             / NULLIF(count(*), 0), 2) AS porcentaje
FROM asistencias a
JOIN clases c ON c.id = a.clase_id
JOIN materias m ON m.id = c.materia_id
JOIN curso_division_turno cd ON cd.id = m.curso_division_turno_id
JOIN alumnos al ON al.id = a.alumno_id
JOIN users u ON u.id = al.id
WHERE c.fecha BETWEEN %(desde)s AND %(hasta)s
  AND a.alumno_id = %(alumno_id)s::uuid
  AND (%(curso_id)s::bigint IS NULL OR cd.id = %(curso_id)s::bigint)
GROUP BY al.id, u.first_name, u.last_name;
```

Calificaciones:

```sql
SELECT al.id AS alumno_id,
       u.first_name || ' ' || u.last_name AS alumno,
       m.nombre AS materia,
       ie.nombre AS instancia,
       ie.tipo, ie.peso,
       cal.valor, cal.estado
FROM calificaciones cal
JOIN instancias_evaluacion ie ON ie.id = cal.instancia_id
JOIN periodos p ON p.id = ie.periodo_id
JOIN materias m ON m.id = ie.materia_id
JOIN curso_division_turno cd ON cd.id = m.curso_division_turno_id
JOIN alumnos al ON al.id = cal.alumno_id
JOIN users u ON u.id = al.id
WHERE cal.estado = 'activa'
  AND (%(periodo_id)s::uuid IS NULL OR p.id = %(periodo_id)s::uuid)
  AND p.ciclo_lectivo_id = %(ciclo_id)s::uuid
  AND (%(curso_id)s::bigint IS NULL OR cd.id = %(curso_id)s::bigint)
  AND (%(alumno_id)s::uuid IS NULL OR al.id = %(alumno_id)s::uuid)
ORDER BY alumno, materia, ie.fecha;
```

Promedio ponderado de una materia (la regla de Node usa pesos de `instancias_evaluacion`):

```sql
SELECT cal.alumno_id,
       ie.materia_id,
       round(sum(cal.valor * ie.peso) / NULLIF(sum(ie.peso), 0), 2) AS promedio_ponderado
FROM calificaciones cal
JOIN instancias_evaluacion ie ON ie.id = cal.instancia_id
WHERE cal.estado = 'activa'
  AND ie.periodo_id = %(periodo_id)s::uuid
  AND (%(alumno_id)s::uuid IS NULL OR cal.alumno_id = %(alumno_id)s::uuid)
GROUP BY cal.alumno_id, ie.materia_id;
```

Condiciones (ya calculadas y persistidas por Node al cerrar el periodo):

```sql
SELECT p.nombre AS periodo,
       cd.curso, cd.division, cd.turno,
       m.nombre AS materia,
       u.first_name || ' ' || u.last_name AS alumno,
       ca.condicion, ca.promedio, ca.porcentaje_asistencia, ca.calculada_en
FROM condiciones_alumno ca
JOIN periodos p ON p.id = ca.periodo_id
JOIN materias m ON m.id = ca.materia_id
JOIN curso_division_turno cd ON cd.id = m.curso_division_turno_id
JOIN alumnos al ON al.id = ca.alumno_id
JOIN users u ON u.id = al.id
WHERE ca.periodo_id = %(periodo_id)s::uuid
  AND (%(curso_id)s::bigint IS NULL OR cd.id = %(curso_id)s::bigint)
ORDER BY cd.curso, cd.division, alumno, m.nombre;
```

Si el periodo no tiene fila en `periodo_cierres`, devolver `422 PERIODO_NO_CERRADO` en vez de un PDF vacío:

```sql
SELECT 1 FROM periodo_cierres WHERE periodo_id = %(periodo_id)s::uuid;
```

Inscripciones:

```sql
SELECT cd.curso, cd.division, cd.turno,
       m.nombre AS materia,
       u.first_name || ' ' || u.last_name AS alumno,
       i.estado, i.fecha_inscripcion
FROM inscripciones i
JOIN materias m ON m.id = i.materia_id
JOIN curso_division_turno cd ON cd.id = m.curso_division_turno_id
JOIN alumnos al ON al.id = i.alumno_id
JOIN users u ON u.id = al.id
WHERE cd.ciclo_lectivo_id = %(ciclo_id)s::uuid
  AND (%(curso_id)s::bigint IS NULL OR cd.id = %(curso_id)s::bigint)
  AND (%(estado)s IS NULL OR i.estado = %(estado)s)
ORDER BY cd.curso, cd.division, alumno, m.nombre;
```

Auditoría:

```sql
SELECT id, entidad, entidad_id, accion, actor_id, actor_role, motivo, ocurrido_en
FROM auditoria
WHERE ocurrido_en >= %(desde)s
  AND ocurrido_en < %(hasta)s
  AND (%(actor_id)s::uuid IS NULL OR actor_id = %(actor_id)s::uuid)
  AND (%(accion)s IS NULL OR accion = %(accion)s)
ORDER BY ocurrido_en DESC
LIMIT %(limite)s;
```

Regularidad para certificado:

```sql
SELECT DISTINCT ON (ca.alumno_id, m.id)
       ca.alumno_id, ca.condicion, ca.promedio, ca.porcentaje_asistencia,
       m.nombre AS materia, ca.calculada_en
FROM condiciones_alumno ca
JOIN materias m ON m.id = ca.materia_id
JOIN curso_division_turno cd ON cd.id = m.curso_division_turno_id
WHERE ca.alumno_id = %(alumno_id)s::uuid
  AND cd.ciclo_lectivo_id = %(ciclo_id)s::uuid
  AND ca.condicion IN ('regular', 'promocionado')
ORDER BY ca.alumno_id, m.id, ca.calculada_en DESC;
```

## 10. Generación de archivos

`reports/documents/pdf.py`:

```python
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


def build_pdf(path: Path, *, titulo: str, columnas: list[str], filas: list[list], institucion: str) -> None:
    font_path = Path(__file__).parent / "templates" / "DejaVuSans.ttf"
    pdfmetrics.registerFont(TTFont("DejaVu", str(font_path)))

    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
    )
    estilos = getSampleStyleSheet()
    estilos["Title"].fontName = "DejaVu"
    estilos["Normal"].fontName = "DejaVu"

    data = [list(columnas)] + [["" if v is None else str(v) for v in fila] for fila in filas]
    tabla = Table(data, repeatRows=1, hAlign="LEFT")
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCE6F1")),
        ("FONTNAME", (0, 0), (-1, -1), "DejaVu"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7FA")]),
    ]))

    doc.build([
        Paragraph(institucion, estilos["Heading2"]),
        Paragraph(titulo, estilos["Title"]),
        Spacer(1, 6 * mm),
        tabla,
    ])
```

Para certificados se usa el mismo `build_pdf` con una sola fila de datos, o una plantilla propia con número de certificado, QR y leyenda de verificación.

`reports/documents/xlsx.py`:

```python
from pathlib import Path
import xlsxwriter


def build_xlsx(path: Path, *, titulo: str, columnas: list[str], filas: list[list]) -> None:
    book = xlsxwriter.Workbook(str(path), {"constant_memory": True, "default_date_format": "yyyy-mm-dd"})
    sheet = book.add_worksheet("Reporte")
    header = book.add_format({"bold": True, "bg_color": "#DCE6F1", "border": 1})

    sheet.write(0, 0, titulo, header)
    for col, nombre in enumerate(columnas):
        sheet.write(1, col, nombre, header)
    for row, fila in enumerate(filas, start=2):
        for col, valor in enumerate(fila):
            sheet.write(row, col, valor)

    sheet.freeze_panes(2, 0)
    sheet.autofilter(1, 0, len(filas) + 1, len(columnas) - 1)
    book.close()
```

`reports/documents/storage.py`:

```python
import hashlib
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def job_path(storage_dir: Path, job_id, formato: str) -> Path:
    folder = storage_dir / str(job_id)[:2]
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{job_id}.{formato}"
```

## 11. Job asíncrono con Celery

`reports/tasks.py`:

```python
import celery
from django.conf import settings

from reports.documents.pdf import build_pdf
from reports.documents.storage import job_path, sha256_file
from reports.documents.xlsx import build_xlsx
from reports.models import Certificate, DocumentJob
from reports.registry import CERTIFICADOS, REPORTES

app = celery.Celery("follow_reports")


@app.task(bind=True, autoretry_for=(celery.exceptions.TimeoutError,), retry_backoff=10, max_retries=3)
def generar_documento(self, job_id: str) -> None:
    job = DocumentJob.objects.get(id=job_id)
    job.estado = "procesando"
    job.save(update_fields=["estado", "updated_at"])

    registro = {**REPORTES, **CERTIFICADOS}[job.tipo]
    columnas, filas, titulo = registro["query"](job.filtros, job.snapshot)

    if len(filas) > settings.MAX_ROWS:
        raise ValueError("MAX_ROWS_EXCEDIDO")

    path = job_path(settings.STORAGE_DIR, job.id, job.formato)
    if job.formato == "pdf":
        build_pdf(path, titulo=titulo, columnas=columnas, filas=filas, institucion="Institución")
    else:
        build_xlsx(path, titulo=titulo, columnas=columnas, filas=filas)

    job.storage_path = str(path)
    job.checksum = sha256_file(path)
    job.total_filas = len(filas)
    job.progreso = 100
    job.estado = "listo"
    job.save(update_fields=[
        "storage_path", "checksum", "total_filas", "progreso", "estado", "updated_at"
    ])

    if job.tipo in CERTIFICADOS:
        emitir_certificado(job)
```

`emitir_certificado(job)` genera `numero` secuencial (`CERT-2026-000001`), calcula `hash_sha256` sobre los campos canónicos del payload y crea el `Certificate` con `pdf_path = job.storage_path`. El QR del PDF contiene `{"numero": ..., "hash": ...}`; el endpoint público `verificar` solo devuelve `numero`, `tipo`, `alumno`, `fecha`, `vigente` — nunca DNI completo ni datos de contacto.

`config/celery.py` debe importar la app de `reports.tasks` y `config/__init__.py` debe exponerla:

```python
from .celery import app as celery_app

__all__ = ("celery_app",)
```

Worker:

```bash
celery -A config worker -l info -Q documents --concurrency=4
```

Limpieza: una tarea periódica (`celery beat`) elimina archivos y jobs con `expires_at < now()`.

## 12. Idempotencia y permisos

`reports/idempotency.py`:

```python
import hashlib
import json
import secrets
from django.http import JsonResponse

from reports.models import DocumentJob

POST_PATHS = ("/api/v1/reportes/", "/api/v1/certificados/")


class IdempotencyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method != "POST" or not request.path.startswith(POST_PATHS):
            return self.get_response(request)

        key = request.headers.get("Idempotency-Key", "")
        if len(key) < 8:
            return JsonResponse(
                {"error": {"code": "IDEMPOTENCY_KEY_REQUIRED", "message": "Idempotency-Key obligatoria."}},
                status=400,
            )

        raw = request.body
        request_hash = hashlib.sha256(raw).hexdigest()
        existing = DocumentJob.objects.filter(idempotency_key=key).first()
        if existing:
            if existing.request_hash != request_hash:
                return JsonResponse(
                    {"error": {"code": "IDEMPOTENCY_KEY_REUSED", "message": "La clave ya fue usada."}},
                    status=409,
                )
            return JsonResponse(
                {"id": str(existing.id), "estado": existing.estado, "url": f"/api/v1/documentos/{existing.id}"},
                status=202,
            )

        request.idempotency_key = key
        request.request_hash = request_hash
        return self.get_response(request)
```

Nota: el job se crea con `get_or_create(idempotency_key=key, defaults={...})` para cubrir la condición de carrera. El middleware siempre devuelve `202` porque la creación del job es la respuesta idempotente; el cliente consulta el estado después.

`reports/permissions.py`:

```python
import secrets
from rest_framework.permissions import BasePermission
from django.conf import settings


class ServiceTokenPermission(BasePermission):
    def has_permission(self, request, view):
        token = request.headers.get("X-Service-Token", "")
        return secrets.compare_digest(token, settings.SERVICE_TOKEN)
```

## 13. Integración del lado Node

1. Agregar a `src/config/env.ts`:

```ts
REPORTS_API_URL: z.string().url().default('http://reports:8000/api/v1'),
REPORTS_SERVICE_TOKEN: z.string().min(16),
```

2. Agregar a `.env.example` y `docker-compose.yml` (servicio `reports` + `redis`).

3. Puerto nuevo, por ejemplo en `src/domain/grading/ports.ts` o un dominance `documents`:

```ts
export interface ReportGateway {
  create(input: {
    tipo: string;
    formato: 'pdf' | 'xlsx';
    filtros: Record<string, unknown>;
    idempotencyKey: string;
    solicitadoPor: string;
    requestId?: string;
  }): Promise<{ id: string; estado: string; url: string }>;
}
```

4. Adaptador HTTP en `src/infra/external/report-client.ts`:

```ts
const res = await fetch(`${env().REPORTS_API_URL}/${path}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-service-token': env().REPORTS_SERVICE_TOKEN,
    'idempotency-key': input.idempotencyKey,
  },
  body: JSON.stringify({ ...input.filtros, solicitadoPor: input.solicitadoPor, requestId: input.requestId }),
  signal: AbortSignal.timeout(10_000),
});
```

5. Caso de uso en `application/` y ruta en `src/infra/http/routes.ts` con `requireAuth`, allowlist de roles (administrador/preceptor/docente; alumno y tutor solo certificados propios) y `idempotency(c)`. Reenviar la misma `Idempotency-Key` que usó Node.

6. Node puede elegir entre devolver al cliente la `url` del job o hacer proxy del binario. Recomendación: devolver la URL y que un endpoint de Node haga el proxy, para no filtrar el host interno de Django.

7. Variables del compose:

```yaml
  redis:
    image: redis:7-alpine

  reports:
    build: ./follow-up-reports
    environment:
      DJANGO_SECRET_KEY: local-reports-secret-change-me
      DEBUG: 'false'
      ALLOWED_HOSTS: reports,localhost
      DATABASE_URL: postgres://reports_reader:CHANGE_ME@db:5432/follow
      JOBS_DATABASE_URL: postgres://reports_writer:CHANGE_ME@db:5432/follow
      REDIS_URL: redis://redis:6379/0
      SERVICE_TOKEN: token-largo-compartido-con-node
      STORAGE_DIR: /app/storage/documents
    volumes:
      - reportdocs:/app/storage/documents
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

volumes:
  reportdocs:
```

Arranque: `python manage.py migrate --database=default`, `python manage.py runserver 0.0.0.0:8000` y el worker Celery.

## 14. Tests mínimos

- `401` sin `X-Service-Token`; `200` con token válido.
- `400` si falta `Idempotency-Key`; `409` si se reutiliza con otro body; respuesta idéntica si se reutiliza con el mismo body.
- `422` si un certificado pide `xlsx`.
- `422` si `desde > hasta`.
- `422 PERIODO_NO_CERRADO` si no hay `periodo_cierres`.
- Reporte de asistencia genera XLSX con `reportlab`/`openpyxl` abierto: encabezados y cantidad de filas.
- Certificado genera PDF válido (empieza con `%PDF`) y crea fila en `Certificate` con `hash_sha256`.
- `GET /documentos/{id}` pasa por `pendiente -> procesando -> listo`.
- `GET /documentos/{id}/descargar` devuelve `Content-Disposition` y `404` después de expirar.
- `/certificados/verificar` devuelve `vigente: true` y `false` tras anular.
- Ninguna query del servicio intenta escribir en la conexión `follow` (usar `django_assert_num_queries` o un usuario sin permisos en tests).

## 15. Orden de implementación sugerido

1. Usuarios PostgreSQL, schema `reportes`, settings con dos BD y router.
2. Modelos `DocumentJob` y `Certificate` + migración.
3. Permisos, idempotencia, contrato de errores y `GET /health|/ready`.
4. Consultas SQL de asistencia y calificaciones (las más usadas).
5. Renderers PDF y XLSX + descarga.
6. Celery, estados del job y expiración.
7. Certificados + número/hash/QR + verificación y anulación.
8. Reportes de condiciones, inscripciones y auditoría.
9. Adaptador en Node, rutas con roles y auditoría desde Node.
10. Tests, docker compose y documentación de operación.

## 16. Puntos a definir antes de programar

- ¿Node devuelve la URL del documento o hace proxy del binario?
- ¿Quién puede pedir cada certificado: solo el alumno/tutor, o también preceptor/administrador?
- ¿Los certificados llevan firma digital o solo QR + hash verificable?
- ¿Se quiere logo/membrete institucional por `institucion_id`? Hoy `instituciones` tiene `nombre`, `cue`, `direccion`, `telefono`, `email`.
- Formato de fecha y número en español (`es-ar`) y zona horaria `America/Argentina/Buenos_Aires`.
- Política de retención: `DOCUMENT_TTL_HOURS` y cuánto tiempo se conserva el registro del certificado anulado.
- Si se necesita un reporte con datos calculados en el momento (no persistidos), conviene que Node envíe un `snapshot` en el body en vez de reimplementar la regla en Python.
