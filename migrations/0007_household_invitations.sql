PRAGMA foreign_keys = ON;

ALTER TABLE household_members ADD COLUMN relationship TEXT NOT NULL DEFAULT 'other'
  CHECK (relationship IN ('spouse', 'child', 'flatmate', 'other'));

CREATE TABLE household_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('spouse', 'child', 'flatmate', 'other')),
  role TEXT NOT NULL CHECK (role IN ('adult', 'viewer')),
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at TEXT NOT NULL,
  accepted_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'queued', 'sending', 'sent', 'failed')),
  provider_message_id TEXT,
  delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
  delivery_error TEXT,
  queued_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX household_invitations_pending_email_idx
  ON household_invitations(household_id, invited_email) WHERE status = 'pending';
CREATE INDEX household_invitations_token_idx ON household_invitations(token_hash);
CREATE INDEX household_invitations_inviter_rate_idx ON household_invitations(invited_by_user_id, created_at DESC);
CREATE INDEX household_invitations_household_rate_idx ON household_invitations(household_id, created_at DESC);
