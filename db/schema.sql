-- PropJournal schema (idempotent)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS ctrader_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ctid_trader_account_id bigint NOT NULL,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reauth_required')),
  broker_title text,
  trader_login text,
  is_live boolean,
  granted_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  UNIQUE (user_id, ctid_trader_account_id)
);
CREATE INDEX IF NOT EXISTS ctrader_connections_user_idx ON ctrader_connections (user_id);

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('local','ctrader')),
  external_ref text,
  trade_date date NOT NULL,
  symbol text NOT NULL,
  dir text NOT NULL CHECK (dir IN ('buy','sell')),
  lots numeric(14,2),
  entry_price numeric(18,5),
  exit_price numeric(18,5),
  pnl numeric(18,2),
  smart_exit boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trades_user_ext_ref_idx ON trades (user_id, source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS trades_user_date_idx ON trades (user_id, trade_date DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
