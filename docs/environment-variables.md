# Environment Variables

Reference for every environment variable this app reads — Railway production config and
session-local overrides. Consulted when setting up or debugging config, not needed for
everyday feature work. Moved out of `CLAUDE.md` on 2026-09-02 to keep that file to what
every session needs; nothing here changed in the move.


Required in Railway:
- `DATABASE_URL` — PostgreSQL connection string
- `AUTH_SECRET` — NextAuth session-cookie signing (`auth.config.ts`'s `secret`); without it the credentials callback returns `?error=Configuration` and nobody can log in. **It was missing from this list until Q-311 (2026-08-30) while ~~`SESSION_SECRET`~~ — read by nothing — sat in it**: `SESSION_SECRET` was `auth.config.ts`'s fallback until that fallback was deleted, and it outlived the deletion here, in the README, and in two CI workflow env blocks, where it read as a credential in a public repo. Safe to remove from Railway; `grep -rn SESSION_SECRET` now finds only prose.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — OAuth
- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini (used by every `@ai-sdk/google` route)
- ~~`GEMINI_API_KEY`~~ — **no longer used by any code (Q-189, 2026-08-12).** Its only consumer was the text-to-speech route, which was deleted with the unreachable legacy chat surface. Safe to remove from Railway; the app never reads it. The `@google/genai` package stays — `lib/exercise-image-gen.ts` still uses it, but on `GOOGLE_GENERATIVE_AI_API_KEY`, so nothing reads `GEMINI_API_KEY` any more.
- `HEALTH_CONNECT_INGEST_SECRET` + `WEBHOOK_USER_ID` — Tasker auth for `app/api/health-connect/ingest/route.ts`

Optional:
- `CLAUDE_DB_READONLY_URL` + `CLAUDE_DB_QUERY_SECRET` — enables `POST /api/admin/db-query`, a read-only
  SQL endpoint over the curated `claude_ro` view schema (whole-history audits: counter drift,
  null-rates, orphans, blast-radius measurement). **Read-only is enforced by the `claude_readonly`
  Postgres role, never by inspecting the SQL** — a keyword allowlist loses to
  `WITH x AS (INSERT … RETURNING *) SELECT * FROM x`; the role does not. Fail-closed on either var
  and still `requireAdmin`-gated. The role is created out-of-band (it carries a password, which must
  never live in a committed migration) and uses its own `max: 2` pool, never the app's `max: 10`.
  Approved **for the beta period only** — see the beta-exit review row in `projectOverview.md`.
  Emergency stop, no deploy: `REVOKE ALL ON SCHEMA claude_ro FROM claude_readonly;`
  **Row-scoped to ONE user** (`CLAUDE_RO_OWNER_USER_ID` at generation time): production holds several
  real accounts with months of sleep/weight/food data, and they cannot consent on the owner's behalf.
  Tables without `user_id` are scoped via a documented FK path; a table that is neither user-scoped,
  FK-reachable, explicitly global, nor explicitly denied makes the generator **fail** rather than emit
  an unscoped view. `invited_emails`/`rate_limits` are denied outright (third-party PII, no audit value).
  **The owner's user id is NOT in the generated SQL any more (Q-456)** — views scope on
  `current_setting('app.claude_ro_owner', true)`, set at boot by `bootstrapClaudeRoOwner()` from
  `CLAUDE_RO_OWNER_USER_ID` ?? `ADMIN_EXPORT_USER_ID` ?? `WEBHOOK_USER_ID`. **No manual step** — but
  if none of those is set the views return **zero rows**, which is fail-closed and is why
  `/api/admin/db-query` answering nothing is a missing setting rather than a quiet production. The
  boot log names the variable it used.
  **When you add a table, re-run `CLAUDE_RO_OWNER_USER_ID=<id> node scripts/generate-claude-ro-views.js`
  into a NEW migration number** (never overwrite the previous one — `ensureSchema` tracks by filename,
  so an edited already-applied migration is skipped forever and the change silently never lands) — the schema is default-deny, so a new table is unreadable
  until it has a view, and a DB-backed test fails if the counts diverge. The migration DROPs and
  rebuilds the schema each run: `CREATE OR REPLACE VIEW` would leave a stale unscoped view serving its
  old definition forever.
- `ADMIN_EXPORT_SECRET` (+ `ADMIN_EXPORT_USER_ID`, falling back to `WEBHOOK_USER_ID`) — enables the
  `Authorization: Bearer …` path on `GET /api/admin/day-review`, so a window of score-audit days can be
  pulled without a browser session (offline score-calibration review). **Read-only, GET-only, and
  fail-closed**: unset either var and the bearer path is disabled entirely — never skipped — and the
  resolved user must still be an admin, so the token widens *transport*, never authority. Anyone holding
  it can read that user's health history, so treat it as a credential: generate with
  `openssl rand -hex 32`, never commit it, rotate by changing the Railway var. Leave it unset and the
  route is session-only. `ADMIN_SNAPSHOT_SECRET` is the same idea for `GET /api/admin/db-snapshot` (Q-530) — a separate secret, since that route returns the whole database, not scores.
- ~~`GITHUB_RELEASES_TOKEN`~~ — **no longer needed (Q-49, 2026-08-17).** It was required while the
  releases lived in a private repo, where an unauthenticated call could only 404. The repo is public,
  so `lib/github-release.ts` now sends the `Authorization` header only when a token happens to be
  set, and works without one. **It had been unset in Railway since 2026-08-04**, which is why the
  update card and More → Download APK were dead for two weeks — going public is what revived them.
  Setting it is still harmless and buys a higher rate limit (5,000 req/hr against 60 per IP), but
  neither limit is close, so treat it as an optimisation and never as a dependency.
  The route queries `/releases/tags/apk-latest` (not `/releases/latest`) because
  `.github/workflows/android.yml` publishes the rolling APK release with `--prerelease`, which the
  `/latest` endpoint excludes regardless of repo visibility.
- `APK_RELEASE_REPO` — which repo `lib/github-release.ts` reads releases from. Set to
  `nekodas-neko/TrainingAi_Open`. The code falls back to the pre-cut repo, which is archived, so
  leaving it unset means reading a release whose version never changes again.
