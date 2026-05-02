const authService = require('../services/auth.service');

/**
 * Auth controller — parses request, calls service, formats response.
 * No business logic here.
 */

function getMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  };
}

async function register(req, res, next) {
  try {
    const result = await authService.register(req.body, getMeta(req));
    res.status(201).json(result);
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body, getMeta(req));
    res.json(result);
  } catch (err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const result = await authService.refresh(req.body.refreshToken, getMeta(req));
    res.json(result);
  } catch (err) { next(err); }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.user.userId, req.body.refreshToken);
    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
}

async function getProfile(req, res, next) {
  try {
    const user = await authService.getProfile(req.user.userId);
    res.json({ user });
  } catch (err) { next(err); }
}

async function changePassword(req, res, next) {
  try {
    await authService.changePassword(req.user.userId, req.body);
    res.json({ message: 'Password changed. All sessions revoked — please log in again.' });
  } catch (err) { next(err); }
}

/**
 * Google OAuth callback handler.
 * Called by Passport after successful Google auth.
 * Issues JWT tokens and redirects to frontend with tokens.
 */
async function googleCallback(req, res, next) {
  try {
    const result = await authService.findOrCreateGoogleUser(req.user, getMeta(req));

    // Redirect to frontend with tokens as query params
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const params = new URLSearchParams({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    });

    res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
  } catch (err) { next(err); }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  getProfile,
  changePassword,
  googleCallback,
};
