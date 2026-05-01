const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../utils/db');
const logger = require('../utils/logger');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
  ValidationError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
} = require('../errors');

// Stricter rate limit for auth endpoints (10 req / 15 min per IP)
const authRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10', 10),
});

const JWT_SECRET = process.env.JWT_SECRET || '';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_DURATION_MS = parseInt(process.env.LOCKOUT_DURATION_MS || String(30 * 60 * 1000), 10);

function generateAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      tokenType: 'access',
    },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseExpiresIn(expiresIn) {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600 * 1000; // Default 7 days
  const [, num, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num, 10) * multipliers[unit];
}

const registerSchema = {
  username: { type: 'string', required: true, minLength: 3, maxLength: 100, pattern: /^[a-zA-Z0-9_-]+$/ },
  email:    { type: 'string', required: true, maxLength: 255, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  password: { type: 'string', required: true, minLength: 8, maxLength: 128 },
};

router.post('/register', authRateLimit, validate(registerSchema), async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // Check existing user
    const existing = await db.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existing.rows.length > 0) {
      throw new ConflictError('Username or email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Insert user
    const result = await db.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'viewer')
       RETURNING id, username, email, role, created_at`,
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    logger.info(`User registered: ${username} (id: ${user.id})`);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + parseExpiresIn(REFRESH_EXPIRES));

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id,
        refreshHash,
        expiresAt,
        req.headers['user-agent'] || null,
        req.ip,
      ]
    );

    return res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      accessToken,
      refreshToken,
      expiresIn: ACCESS_EXPIRES,
    });
  } catch (err) {
    next(err);
  }
});

const loginSchema = {
  username: { type: 'string', required: true },
  password: { type: 'string', required: true },
};

router.post('/login', authRateLimit, validate(loginSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Fetch user
    const result = await db.query(
      `SELECT id, username, email, password_hash, role, is_active,
              failed_attempts, locked_until
       FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      throw new AuthenticationError('Invalid credentials');
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      throw new AuthenticationError('Account is deactivated');
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
      throw new AuthenticationError(
        `Account locked due to too many failed attempts. Try again in ${remaining} minute(s).`
      );
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      // Increment failed attempts
      const newAttempts = (user.failed_attempts || 0) + 1;
      const lockUntil = newAttempts >= MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_DURATION_MS)
        : null;

      await db.query(
        `UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3`,
        [newAttempts, lockUntil, user.id]
      );

      if (lockUntil) {
        logger.warn(`Account locked: ${username} (${newAttempts} failed attempts)`);
        throw new AuthenticationError(
          `Account locked after ${MAX_LOGIN_ATTEMPTS} failed attempts. Try again in ${Math.ceil(LOCKOUT_DURATION_MS / 60000)} minutes.`
        );
      }

      throw new AuthenticationError('Invalid credentials');
    }

    // Successful login — reset failed attempts, update last login
    await db.query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
      [user.id]
    );

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + parseExpiresIn(REFRESH_EXPIRES));

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshHash, expiresAt, req.headers['user-agent'] || null, req.ip]
    );

    logger.info(`User logged in: ${username}`);

    return res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      accessToken,
      refreshToken,
      expiresIn: ACCESS_EXPIRES,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', authRateLimit, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new ValidationError('refreshToken is required');
    }

    const tokenHash = hashRefreshToken(refreshToken);

    // Find valid refresh token
    const result = await db.query(
      `SELECT rt.id, rt.user_id, rt.expires_at,
              u.id AS uid, u.username, u.email, u.role, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.revoked = false`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw new AuthenticationError('Invalid or revoked refresh token');
    }

    const row = result.rows[0];

    // Check expiry
    if (new Date(row.expires_at) < new Date()) {
      // Revoke expired token
      await db.query('UPDATE refresh_tokens SET revoked = true, revoked_at = NOW() WHERE id = $1', [row.id]);
      throw new AuthenticationError('Refresh token expired');
    }

    // Check user still active
    if (!row.is_active) {
      throw new AuthenticationError('Account is deactivated');
    }

    // Token rotation: revoke old token, issue new pair
    await db.query(
      'UPDATE refresh_tokens SET revoked = true, revoked_at = NOW() WHERE id = $1',
      [row.id]
    );

    const user = { id: row.uid, username: row.username, email: row.email, role: row.role };
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();
    const newRefreshHash = hashRefreshToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + parseExpiresIn(REFRESH_EXPIRES));

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, newRefreshHash, expiresAt, req.headers['user-agent'] || null, req.ip]
    );

    logger.info(`Token refreshed for user: ${user.username}`);

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: ACCESS_EXPIRES,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Revoke specific token
      const tokenHash = hashRefreshToken(refreshToken);
      await db.query(
        `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
         WHERE token_hash = $1 AND user_id = $2`,
        [tokenHash, req.user.userId]
      );
    } else {
      // Revoke ALL refresh tokens for this user
      await db.query(
        `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
         WHERE user_id = $1 AND revoked = false`,
        [req.user.userId]
      );
    }

    logger.info(`User logged out: ${req.user.username}`);
    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, username, email, role, is_active, last_login_at, created_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User', String(req.user.userId));
    }

    return res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

const passwordSchema = {
  currentPassword: { type: 'string', required: true },
  newPassword:     { type: 'string', required: true, minLength: 8, maxLength: 128 },
};

router.put('/password', authenticate, validate(passwordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const result = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User', String(req.user.userId));
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      throw new AuthenticationError('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, req.user.userId]
    );

    // Revoke all refresh tokens (force re-login)
    await db.query(
      `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
       WHERE user_id = $1 AND revoked = false`,
      [req.user.userId]
    );

    logger.info(`Password changed: ${req.user.username}`);
    return res.json({ message: 'Password changed. All sessions revoked — please log in again.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
