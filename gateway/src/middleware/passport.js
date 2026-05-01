const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const logger = require('../utils/logger');

/**
 * Configure Passport with Google OAuth 2.0 strategy.
 * Called once at startup. No-ops if Google credentials not set.
 *
 * On successful auth, the raw Google profile is passed to the route handler
 * (via req.user). The auth.service.findOrCreateGoogleUser() handles
 * DB lookup/creation and JWT issuance.
 */
function configurePassport() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback';

  if (!clientID || !clientSecret) {
    logger.warn('Google OAuth not configured — missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return false;
  }

  passport.use(new GoogleStrategy(
    {
      clientID,
      clientSecret,
      callbackURL,
      scope: ['profile', 'email'],
    },
    (_accessToken, _refreshToken, profile, done) => {
      // Pass raw profile to route handler — service layer handles DB logic
      return done(null, profile);
    }
  ));

  // Serialize/deserialize — not using sessions for API, but Passport requires these
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  logger.info('Google OAuth strategy configured');
  return true;
}

module.exports = { configurePassport };
