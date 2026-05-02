const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../utils/prisma');
const logger = require('../utils/logger');
const {
  AuthenticationError,
  ConflictError,
  NotFoundError,
} = require('../errors');


const JWT_SECRET        = process.env.JWT_SECRET || '';
const BCRYPT_ROUNDS     = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const ACCESS_EXPIRES    = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES   = process.env.JWT_REFRESH_EXPIRES || '7d';
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

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseExpiresIn(expiresIn) {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600 * 1000;
  const [, num, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num, 10) * multipliers[unit];
}

async function createRefreshTokenRecord(userId, meta = {}) {
  const rawToken = generateRefreshToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + parseExpiresIn(REFRESH_EXPIRES));

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: meta.userAgent || null,
      ipAddress: meta.ip || null,
    },
  });

  return rawToken;
}


async function register({ username, email, password }, meta = {}) {
  // Check existing
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });

  if (existing) {
    throw new ConflictError('Username or email already registered');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: { username, email, passwordHash, role: 'viewer' },
    select: { id: true, username: true, email: true, role: true, createdAt: true },
  });

  const accessToken = generateAccessToken(user);
  const refreshToken = await createRefreshTokenRecord(user.id, meta);

  logger.info(`User registered: ${username} (id: ${user.id})`);

  return {
    user,
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES,
  };
}


async function login({ username, password }, meta = {}) {
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user) {
    throw new AuthenticationError('Invalid credentials');
  }

  if (!user.isActive) {
    throw new AuthenticationError('Account is deactivated');
  }

  // Lockout check
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const remaining = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
    throw new AuthenticationError(
      `Account locked due to too many failed attempts. Try again in ${remaining} minute(s).`
    );
  }

  // Password can be null for OAuth-only accounts
  if (!user.passwordHash) {
    throw new AuthenticationError('This account uses Google sign-in. Please use Google OAuth.');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    const newAttempts = user.failedAttempts + 1;
    const lockUntil = newAttempts >= MAX_LOGIN_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_DURATION_MS)
      : null;

    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: newAttempts, lockedUntil: lockUntil },
    });

    if (lockUntil) {
      logger.warn(`Account locked: ${username} (${newAttempts} failed attempts)`);
      throw new AuthenticationError(
        `Account locked after ${MAX_LOGIN_ATTEMPTS} failed attempts. Try again in ${Math.ceil(LOCKOUT_DURATION_MS / 60000)} minutes.`
      );
    }

    throw new AuthenticationError('Invalid credentials');
  }

  // Success — reset lockout
  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const accessToken = generateAccessToken(user);
  const refreshToken = await createRefreshTokenRecord(user.id, meta);

  logger.info(`User logged in: ${username}`);

  return {
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES,
  };
}


async function refresh(rawRefreshToken, meta = {}) {
  const tokenHash = hashToken(rawRefreshToken);

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.revoked) {
    throw new AuthenticationError('Invalid or revoked refresh token');
  }

  if (new Date(record.expiresAt) < new Date()) {
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked: true, revokedAt: new Date() },
    });
    throw new AuthenticationError('Refresh token expired');
  }

  if (!record.user.isActive) {
    throw new AuthenticationError('Account is deactivated');
  }

  // Token rotation — revoke old, issue new
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revoked: true, revokedAt: new Date() },
  });

  const user = record.user;
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = await createRefreshTokenRecord(user.id, meta);

  logger.info(`Token refreshed for user: ${user.username}`);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_EXPIRES,
  };
}


async function logout(userId, rawRefreshToken = null) {
  if (rawRefreshToken) {
    const tokenHash = hashToken(rawRefreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, userId },
      data: { revoked: true, revokedAt: new Date() },
    });
  } else {
    // Revoke all tokens for user
    await prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  logger.info(`User logged out (id: ${userId})`);
}


async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, username: true, email: true, role: true,
      isActive: true, lastLoginAt: true, createdAt: true,
      authProvider: true, avatarUrl: true,
    },
  });

  if (!user) {
    throw new NotFoundError('User', String(userId));
  }

  return user;
}


async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, passwordHash: true },
  });

  if (!user) {
    throw new NotFoundError('User', String(userId));
  }

  if (!user.passwordHash) {
    throw new AuthenticationError('Cannot change password for OAuth-only accounts');
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AuthenticationError('Current password is incorrect');
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    }),
  ]);

  logger.info(`Password changed: ${user.username}`);
}


async function findOrCreateGoogleUser(profile, meta = {}) {
  const googleId = profile.id;
  const email = profile.emails?.[0]?.value;
  const displayName = profile.displayName || email?.split('@')[0] || 'user';
  const avatarUrl = profile.photos?.[0]?.value || null;

  // Try find by googleId
  let user = await prisma.user.findUnique({ where: { googleId } });

  if (!user && email) {
    // Try find by email — link Google account
    user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId, avatarUrl, authProvider: 'google', lastLoginAt: new Date() },
      });
      logger.info(`Linked Google account to existing user: ${user.username}`);
    }
  }

  if (!user) {
    // Create new user
    // Generate unique username from display name
    let username = displayName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 90);
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      username = `${username}_${Date.now().toString(36)}`;
    }

    user = await prisma.user.create({
      data: {
        username,
        email: email || `${googleId}@google.oauth`,
        googleId,
        avatarUrl,
        authProvider: 'google',
        role: 'viewer',
        lastLoginAt: new Date(),
      },
    });
    logger.info(`Created Google user: ${user.username} (id: ${user.id})`);
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), avatarUrl },
    });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = await createRefreshTokenRecord(user.id, meta);

  return {
    user: { id: user.id, username: user.username, email: user.email, role: user.role, avatarUrl: user.avatarUrl },
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES,
  };
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  getProfile,
  changePassword,
  findOrCreateGoogleUser,
};
