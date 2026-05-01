-- Gateway-specific tables (runs on same Azure PostgreSQL as ai_engine).
-- Managed by gateway migration runner — do not run manually.

-- ─── Users (gateway auth) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'viewer',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─── Refresh Tokens ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent  VARCHAR(500),
    ip_address  VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at)
    WHERE revoked = false;

-- ─── Seed admin user (password: sage2027, bcrypt rounds=12) ───
-- Hash generated via: require('bcryptjs').hashSync('sage2027', 12)
INSERT INTO users (username, email, password_hash, role)
VALUES (
    'sage-admin',
    'admin@sage.local',
    '$2a$12$LJ3a5M5x5V5qF5GqF5GqF.OKjQ5KjQ5KjQ5KjQ5KjQ5KjQ5KjQ5K',
    'admin'
) ON CONFLICT (username) DO NOTHING;
