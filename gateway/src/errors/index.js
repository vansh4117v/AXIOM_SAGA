/**
 * Application error hierarchy.
 * Every error has: statusCode, code (machine-readable), message (human-readable).
 * Global error handler maps these to consistent JSON responses.
 */

class AppError extends Error {
  /**
   * @param {string} message   — human-readable message
   * @param {number} statusCode — HTTP status code
   * @param {string} code       — machine-readable error code (e.g. "VALIDATION_ERROR")
   * @param {object} [details]  — optional structured error details
   */
  constructor(message, statusCode, code, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguishes from programmer errors
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    const obj = {
      error: {
        code: this.code,
        message: this.message,
      },
    };
    if (this.details) {
      obj.error.details = this.details;
    }
    return obj;
  }
}

class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {Array<{field: string, message: string}>} [fields] — per-field errors
   */
  constructor(message, fields = null) {
    super(message, 400, 'VALIDATION_ERROR', fields ? { fields } : null);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  /**
   * @param {string} resource — e.g. "Ticket", "Prompt"
   * @param {string} [identifier] — e.g. "PROJ-001"
   */
  constructor(resource, identifier = null) {
    const msg = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super(msg, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(retryAfterMs = 0) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED', {
      retryAfterMs,
    });
  }
}

class ExternalServiceError extends AppError {
  /**
   * @param {string} service — e.g. "Jira", "AI Engine"
   * @param {string} message
   * @param {number} [upstreamStatus]
   */
  constructor(service, message, upstreamStatus = null) {
    super(`${service}: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR', {
      service,
      upstreamStatus,
    });
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
};
