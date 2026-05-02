const express = require("express");
const passport = require("passport");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth");
const { zodValidate } = require("../middleware/zodValidate");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} = require("../schemas/auth.schema");

// Stricter rate limit for auth endpoints
const authRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "10", 10),
});

router.post("/register", authRateLimit, zodValidate(registerSchema), authController.register);
router.post("/login", authRateLimit, zodValidate(loginSchema), authController.login);
router.post("/refresh", authRateLimit, zodValidate(refreshSchema), authController.refresh);

router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.getProfile);
router.put(
  "/password",
  authenticate,
  zodValidate(changePasswordSchema),
  authController.changePassword,
);

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false }),
);

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/auth/google/failure" }),
  authController.googleCallback,
);

router.get("/google/failure", (_req, res) => {
  res.status(401).json({
    error: { code: "OAUTH_FAILED", message: "Google authentication failed" },
  });
});

module.exports = router;
