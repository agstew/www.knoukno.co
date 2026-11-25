CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  token_version INTEGER NOT NULL DEFAULT 0,
  verification_token_hash TEXT,
  verification_expires_at TIMESTAMPTZ,
  password_reset_token_hash TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_verification_token_idx ON users (verification_token_hash);
CREATE INDEX IF NOT EXISTS users_password_reset_token_idx ON users (password_reset_token_hash);

CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paypal_order_id VARCHAR(80) NOT NULL UNIQUE,
  tier_id VARCHAR(40) NOT NULL,
  tier_name VARCHAR(80) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS tier_id VARCHAR(40) NOT NULL DEFAULT 'legacy';
ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS tier_name VARCHAR(80) NOT NULL DEFAULT 'Legacy purchase';
