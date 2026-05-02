const jwt = require('jsonwebtoken');
const { AuthenticationError, AuthorizationError } = require('../errors');
const logger = require('../utils/logger');

/**
 * JWT authentication middleware.
 * Verifies Bearer token from Authorization header.
 * Attaches decoded payload to req.user.
 * Supports token type discrimination (access vs refresh).
 */
function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AuthenticationError('Missing or malformed Authorization header'));
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next(new AuthenticationError('Token not provided'));
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('JWT_SECRET not configured');
    return next(new AuthenticationError('Authentication service misconfigured'));
  }

  try {
    const decoded = jwt.verify(token, secret);

    // Reject refresh tokens used as access tokens
    if (decoded.tokenType === 'refresh') {
      return next(new AuthenticationError('Refresh tokens cannot be used for API access'));
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AuthenticationError('Token expired'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AuthenticationError('Invalid token'));
    }
    if (err.name === 'NotBeforeError') {
      return next(new AuthenticationError('Token not yet active'));
    }
    return next(new AuthenticationError('Token verification failed'));
  }
}

/**
 * Role-based authorization middleware.
 * Must be used after authenticate().
 *
 * @param {...string} allowedRoles — roles permitted to access the route
 * @returns {Function} Express middleware
 *
 * Usage: router.get('/admin', authenticate, authorize('admin'), handler)
 */
function authorize(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      logger.warn(
        `Authorization denied: user "${req.user.username}" (role: ${req.user.role}) ` +
        `attempted access requiring [${allowedRoles.join(', ')}]`
      );
      return next(new AuthorizationError(
        `This action requires one of the following roles: ${allowedRoles.join(', ')}`
      ));
    }

    next();
  };
}

/**
 * Optional authentication — attaches user if token present, but doesn't block.
 * Useful for routes that behave differently for authenticated vs anonymous users.
 */
function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;

  try {
    const decoded = jwt.verify(token, secret);
    if (decoded.tokenType !== 'refresh') {
      req.user = decoded;
    }
  } catch (_err) {
    // Silently ignore — user remains unauthenticated
  }

  next();
}

module.exports = { authenticate, authorize, optionalAuth };
