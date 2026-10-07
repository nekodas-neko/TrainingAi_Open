-- #2076 (PR a of 2): the refresh-token table for the native app's own sign-in token. Owner,
-- 2026-10-06: the native app gets its OWN token, separate from the browser session cookie; it lasts
-- about a day and renews silently through a refresh token stored server-side, per device, so any
-- device can be revoked. The browser cookie login is unchanged. This migration is only the place to
-- keep those refresh tokens. Nothing issues, reads or revokes one yet: the token flow is PR b, after
-- the owner has reviewed this design (the decision brief is in the PR body).
--
-- **Only a hash is stored, never the token.** The server makes a refresh token from at least 256
-- random bits, hands it to the app exactly once, and keeps `token_hash` = lowercase hex SHA-256 of
-- it. A presented token is hashed and looked up by `token_hash`. Reading this table, a backup or a
-- snapshot therefore yields nothing that can be replayed. No pepper (HMAC with a server secret): a
-- pepper earns its keep for guessable secrets such as passwords, and a 256-bit random token cannot
-- be guessed from its hash. `lib/auth/refresh-token-hash.ts` refuses a short token for that reason.
-- The CHECK accepts any 64-hex digest, so moving to HMAC-SHA-256 later needs no migration (it signs
-- every device out once).
--
-- **Rotation with reuse detection (the standard OAuth refresh-token design).** Every use of a
-- refresh token issues a new one in the same `family_id` and marks the old row `rotated_at`, linked
-- forward by `replaced_by`. A family is one sign-in on one device. A presented token that is
-- already rotated means two parties held it, so PR b revokes the whole family
-- (`revoked_reason = 'rotation_reuse'`) and that device signs in again. Rotated rows are therefore
-- KEPT until the family has expired: deleting them early would turn a replayed stolen token into
-- "not found" instead of "reuse, revoke everything".
--
-- **Lifetime.** `expires_at` is set by the issuer; PR b's recommended policy is 30 days from each
-- rotation, so a phone in daily use never signs in again and a phone left unused for a month does.
-- The CHECK caps any one row at 90 days, so a bug cannot mint a token that never expires.
--
-- **Revocation.** `revoked_at` and `revoked_reason` are set together (CHECK). A revoked row stays
-- until pruned, so "why was I signed out" can be answered. Reasons: `user` (revoked from a device
-- list), `sign_out` (the app signed itself out), `rotation_reuse`, `password_change`, `admin`,
-- `account_deactivated`. Account DELETION needs no reason: the rows go with the user (CASCADE).
--
-- **Device.** `device_label` is the name a person recognises in a revoke list ("Galaxy S25 Ultra"),
-- 1–80 characters. `device_id` is an optional random id the app generates once per install, so PR b
-- can end an install's previous family when it signs in again. It is not a hardware identifier.
-- No user agent or IP address is stored: neither is needed to revoke a device.
--
-- Server-only (docs/data-residency.md): nothing on the device reads this table. Not in the user
-- export (credential material). `claude_ro` withholds `token_hash`.
--
-- Additive: a new table and its indexes, nothing else touched.
CREATE TABLE IF NOT EXISTS native_refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Lowercase hex SHA-256 of the refresh token. Never the token itself.
  token_hash      text NOT NULL,
  -- One sign-in on one device. Every rotation keeps the family; reuse revokes all of it.
  family_id       uuid NOT NULL,
  device_label    text NOT NULL,
  device_id       text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  expires_at      timestamptz NOT NULL,

  -- Set when this token was exchanged for its successor; `replaced_by` is the successor.
  rotated_at      timestamptz,
  replaced_by     uuid REFERENCES native_refresh_tokens(id) ON DELETE SET NULL,

  revoked_at      timestamptz,
  revoked_reason  text,

  CONSTRAINT native_refresh_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT native_refresh_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT native_refresh_tokens_device_label_check CHECK (
    char_length(device_label) BETWEEN 1 AND 80 AND btrim(device_label) <> ''
  ),
  CONSTRAINT native_refresh_tokens_device_id_check CHECK (
    device_id IS NULL OR device_id ~ '^[A-Za-z0-9_-]{8,64}$'
  ),
  CONSTRAINT native_refresh_tokens_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '90 days'
  ),
  CONSTRAINT native_refresh_tokens_revoked_check CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT native_refresh_tokens_revoked_reason_check CHECK (
    revoked_reason IN ('user', 'sign_out', 'rotation_reuse', 'password_change', 'admin', 'account_deactivated')
  ),
  CONSTRAINT native_refresh_tokens_replaced_check CHECK (
    replaced_by IS NULL OR (rotated_at IS NOT NULL AND replaced_by <> id)
  )
);

CREATE INDEX IF NOT EXISTS native_refresh_tokens_user_idx ON native_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS native_refresh_tokens_family_idx ON native_refresh_tokens (family_id);
-- The device list and "sign out everywhere": a user's tokens that are neither rotated nor revoked.
CREATE INDEX IF NOT EXISTS native_refresh_tokens_active_idx ON native_refresh_tokens (user_id, expires_at)
  WHERE revoked_at IS NULL AND rotated_at IS NULL;

COMMENT ON TABLE native_refresh_tokens IS
  '#2076: refresh tokens for the native app''s own sign-in token, one family per device sign-in. Stores only the SHA-256 of each token. Rotated on every use; reuse of a rotated token revokes its family.';
COMMENT ON COLUMN native_refresh_tokens.token_hash IS
  'Lowercase hex SHA-256 of the refresh token, which is shown to the app exactly once and never stored. Withheld from claude_ro and the export.';
COMMENT ON COLUMN native_refresh_tokens.family_id IS
  'One sign-in on one device. A rotation keeps the family; presenting an already-rotated token revokes every row in it.';
COMMENT ON COLUMN native_refresh_tokens.device_id IS
  'Optional random id the app generates once per install. Not a hardware identifier.';
