# 2026-08-24 — `.env.example` reconciled against what the code actually reads (Q-458)

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · docs-only, no migration, no APK.

`.env.example` is the public configuration contract now the repo is public. It was wrong in both
directions: eight declared keys were read by no code, four real config vars were undeclared.

## Verified before touching anything

Re-checked every one of the entry's twelve claims against `main` individually (`grep -rn
"process\.env\.KEY\b"` per key), rather than trusting the entry's own table — two turned out to
need a slightly different search shape than a literal grep would find (`CLAUDE_RO_OWNER_USER_ID` is
read through an array lookup in `claude-ro-owner.ts`, not a literal `process.env.CLAUDE_RO_OWNER_USER_ID`).

## What shipped

**Removed** (confirmed zero reads anywhere under `lib app packages scripts instrumentation*`):
- `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`, `OURA_WEBHOOK_CALLBACK_URL`,
  `OURA_WEBHOOK_VERIFICATION_TOKEN` — the Oura Cloud integration was deleted 2026-08-13, and
  `CLAUDE.md` is explicit it must never be re-added (a re-onboard risks a firmware update that
  breaks the reverse-engineered BLE protocol). The file was inviting a contributor to do exactly
  that.
- `GEMINI_API_KEY` — retired at Q-189.
- `AUTH_URL` — unread.
- `TOKEN_ENC_KEY` — the sharpest edge. Its comment said it encrypts stored tokens at rest; nothing
  reads it, so nothing does. A dead variable naming a security property the app doesn't have is
  worse than an ordinary dead variable.

**Added** (confirmed real reads, previously undeclared):
- `PG_POOL_MAX` — `lib/data/postgres/client.ts`.
- `LOCAL_DATABASE_URL` — dev-tooling only, set automatically by `scripts/local-db/setup.sh`;
  documented as such rather than presented as something to configure.
- `CLAUDE_RO_OWNER_USER_ID` — `claude-ro-owner.ts`'s resolution order.
- `RAILWAY_GIT_COMMIT_SHA` — informational note only (no blank field to fill in), since Railway
  injects it automatically and it stamps the service worker's cache name.

**Drive-by:** `GITHUB_RELEASES_TOKEN`'s comment claimed it was required while the repo was private.
The repo went public 2026-08-17 (Q-49) and it's now genuinely optional (buys a higher rate limit,
nothing more) — corrected in the same file rather than filed separately.

## Verified

- `pnpm check:rules` — 55 of 55.
- No code changes, so no test suite implications — this is a documentation-contract fix.

**Not built:** the entry suggested a Custom Rules step that differences `.env.example` against real
`process.env` reads automatically, the same shape as the hex-literal and TTL-divergence ratchets.
Deliberately deferred — it's a separable, smaller follow-up, and the drift it would catch is exactly
what this fix just cleared.
