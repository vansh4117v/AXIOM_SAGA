const { ValidationError } = require('../errors');

/**
 * Schema-based input validation middleware.
 * Validates req.body, req.query, or req.params against a schema object.
 *
 * Schema format:
 * {
 *   fieldName: {
 *     type: 'string' | 'number' | 'boolean' | 'array' | 'object',
 *     required: boolean,
 *     minLength: number,      // strings
 *     maxLength: number,      // strings
 *     pattern: RegExp,        // strings
 *     min: number,            // numbers
 *     max: number,            // numbers
 *     enum: Array,            // allowed values
 *     custom: (value) => string|null  // custom validator, return error message or null
 *   }
 * }
 */

function validateField(name, value, rules) {
  const errors = [];

  if (rules.required && (value === undefined || value === null || value === '')) {
    errors.push({ field: name, message: `${name} is required` });
    return errors; // No point checking further
  }

  if (value === undefined || value === null) return errors;

  if (rules.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== rules.type) {
      errors.push({ field: name, message: `${name} must be of type ${rules.type}, got ${actualType}` });
      return errors;
    }
  }

  if (rules.type === 'string' || typeof value === 'string') {
    if (rules.minLength !== undefined && value.length < rules.minLength) {
      errors.push({ field: name, message: `${name} must be at least ${rules.minLength} characters` });
    }
    if (rules.maxLength !== undefined && value.length > rules.maxLength) {
      errors.push({ field: name, message: `${name} must be at most ${rules.maxLength} characters` });
    }
    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push({ field: name, message: `${name} has invalid format` });
    }
  }

  if (rules.type === 'number' || typeof value === 'number') {
    if (rules.min !== undefined && value < rules.min) {
      errors.push({ field: name, message: `${name} must be >= ${rules.min}` });
    }
    if (rules.max !== undefined && value > rules.max) {
      errors.push({ field: name, message: `${name} must be <= ${rules.max}` });
    }
  }

  if (rules.enum && !rules.enum.includes(value)) {
    errors.push({ field: name, message: `${name} must be one of: ${rules.enum.join(', ')}` });
  }

  if (rules.custom) {
    const err = rules.custom(value);
    if (err) errors.push({ field: name, message: err });
  }

  return errors;
}

/**
 * Create validation middleware.
 * @param {object} schema       — field validation rules
 * @param {'body'|'query'|'params'} source — which part of request to validate
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const data = req[source] || {};
    const allErrors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const errs = validateField(field, data[field], rules);
      allErrors.push(...errs);
    }

    if (allErrors.length > 0) {
      return next(new ValidationError('Validation failed', allErrors));
    }

    next();
  };
}

module.exports = { validate, validateField };
