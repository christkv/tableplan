PRAGMA foreign_keys = ON;

CREATE TABLE shopping_list_shares (
  id TEXT PRIMARY KEY NOT NULL,
  shopping_list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX shopping_list_shares_list_idx ON shopping_list_shares(shopping_list_id, created_at DESC);
CREATE INDEX shopping_list_shares_expiry_idx ON shopping_list_shares(expires_at, revoked_at);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  shopping_list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  share_id TEXT NOT NULL REFERENCES shopping_list_shares(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'sending', 'sent', 'failed')),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  queued_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX email_deliveries_user_rate_idx ON email_deliveries(user_id, created_at DESC);
CREATE INDEX email_deliveries_household_rate_idx ON email_deliveries(household_id, created_at DESC);
CREATE INDEX email_deliveries_status_idx ON email_deliveries(status, created_at);
