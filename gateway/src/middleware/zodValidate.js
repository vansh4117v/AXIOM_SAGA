const { ValidationError } = require('../errors');

/**
 * Zod-based validation middleware factory.
 * Parses request data against a Zod schema.
 * On success: attaches parsed data to `req.validated`.
 * On failure: passes ValidationError to error handler.
 *
 * @param {import('zod').ZodSchema} schema — Zod schema to validate against
 * @param {'body'|'query'|'params'} source — which part of request to validate
 * @returns {Function} Express middleware
 */
function zodValidate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const fields = result.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
      return next(new ValidationError('Validation failed', fields));
    }

    // Replace source with parsed + transformed data
    // This ensures defaults are applied and types are coerced
    req[source] = result.data;
    next();
  };
}

module.exports = { zodValidate };
