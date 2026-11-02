export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationDomainError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', 422, message, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource = 'Recurso') {
    super('NOT_FOUND', 404, `${resource} no encontrado.`);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'No tiene permisos para acceder a este recurso.') {
    super('FORBIDDEN', 403, message);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'No autenticado.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Credenciales inválidas.');
  }
}

export class PasswordChangeRequiredError extends DomainError {
  constructor() {
    super('PASSWORD_CHANGE_REQUIRED', 403, 'Debe cambiar la contraseña antes de continuar.');
  }
}

export class DuplicateResourceError extends DomainError {
  constructor(message = 'El recurso ya existe.') {
    super('DUPLICATE_RESOURCE', 409, message);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'La operación no es válida en el estado actual.', code = 'CONFLICT') {
    super(code, 409, message);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(message = 'Transición de estado no permitida.') {
    super('INVALID_STATE_TRANSITION', 409, message);
  }
}

export class CapacityExceededError extends DomainError {
  constructor() {
    super('CAPACITY_EXCEEDED', 409, 'El curso no tiene cupo disponible.');
  }
}

export class PeriodClosedError extends DomainError {
  constructor() {
    super('PERIOD_CLOSED', 409, 'El período está cerrado.');
  }
}

export class PeriodIncompleteError extends DomainError {
  constructor(details?: unknown) {
    super('PERIOD_INCOMPLETE', 409, 'No se puede cerrar el período: faltan datos obligatorios.', details);
  }
}

export class StaleVersionError extends DomainError {
  constructor() {
    super('STALE_VERSION', 409, 'La versión enviada no coincide con la actual.');
  }
}

export class InvalidCodeError extends DomainError {
  constructor() {
    super('INVALID_CODE', 400, 'El código de vinculación no es válido.');
  }
}

export class TokenReuseDetectedError extends DomainError {
  constructor() {
    super('TOKEN_REUSE_DETECTED', 401, 'El refresh token ya fue utilizado. Inicie sesión nuevamente.');
  }
}

export class IdempotencyKeyRequiredError extends DomainError {
  constructor() {
    super('IDEMPOTENCY_KEY_REQUIRED', 400, 'El header Idempotency-Key es obligatorio.');
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super('IDEMPOTENCY_KEY_REUSED', 409, 'La Idempotency-Key ya fue usada con un pedido distinto.');
  }
}

export class ImportAlreadyRunningError extends DomainError {
  constructor() {
    super('IMPORT_ALREADY_RUNNING', 409, 'Ya hay una importación en curso para este usuario.');
  }
}

export class ImportInvalidFileError extends DomainError {
  constructor(message = 'El archivo CSV no es válido.') {
    super('IMPORT_INVALID_FILE', 422, message);
  }
}

export class PayloadTooLargeError extends DomainError {
  constructor(message = 'El archivo supera el tamaño máximo permitido.') {
    super('PAYLOAD_TOO_LARGE', 413, message);
  }
}

export class RateLimitedError extends DomainError {
  constructor() {
    super('RATE_LIMITED', 429, 'Demasiados pedidos. Intente más tarde.');
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message = 'Servicio no disponible.') {
    super('SERVICE_UNAVAILABLE', 503, message);
  }
}
