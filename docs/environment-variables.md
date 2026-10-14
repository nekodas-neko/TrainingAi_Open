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
- **Oura Cloud API** (#2858, part 1 of #2808). Read only by `lib/oura/cloud/`. The owner registers
  the app at cloud.ouraring.com → OAuth applications and sets these in Railway; agents never set them.
  - `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` — the registered app's credentials. The secret also
    authenticates webhook management (part 2).
  - `OURA_REDIRECT_URI` — the callback registered with Oura, exactly:
    `https://trainingai-production.up.railway.app/api/oura/callback`. Its origin is also where the
    connect link points, so the nonce cookie and the callback share a host.
  - `OURA_TOKEN_KEY` — **new with #2858.** Any long random string (at least 32 characters; e.g.
    `openssl rand -base64 48`). The AES-256-GCM key that encrypts `oura_tokens.access_token` and
    `refresh_token` is derived from it with HKDF-SHA256. Missing or short: connecting answers 503
    and nothing is stored. **Changing it orphans every stored token** (they read as not connected,
    and the user connects again); it is not rotated in place.
  - `OURA_WEBHOOK_CALLBACK_URL` — `https://trainingai-production.up.railway.app/api/oura/webhook`.
    Part 2 (#2859): the `callback_url` every webhook subscription is created with
    (`lib/oura/cloud/subscriptions.ts`). Subscriptions at any other URL are left alone.
  - `OURA_WEBHOOK_VERIFICATION_TOKEN` — part 2 (#2859): sent with each new subscription, and checked
    on Oura's verification `GET /api/oura/webhook?verification_token=…&challenge=…`. Event `POST`s
    are checked with `OURA_CLIENT_SECRET` (`x-oura-signature`), not with this token.
  - Without both webhook settings (or without the OAuth three or `OURA_TOKEN_KEY`), `/api/oura/webhook`
    answers 503 and the 12-hour subscription renewal does not start. The renewal runs only when
    `NODE_ENV` is `production`, so a dev server never reaches Oura.
  - Without the first three, or without `OURA_TOKEN_KEY`, the connect routes answer 503 and the rest
    of the app is unaffected. Local development never uses production's values: tests mock Oura.
- ~~`GEMINI_API_KEY`~~ — **no longer used by any code (Q-189, 2026-08-12).** Its only consumer was the text-to-speech route, which was deleted with the unreachable legacy chat surface. Safe to remove from Railway; the app never reads it. The `@google/genai` package stays — `lib/exercise-image-gen.ts` still uses it, but on `GOOGLE_GENERATIVE_AI_API_KEY`, so nothing reads `GEMINI_API_KEY` any more.
- `HEALTH_CONNECT_INGEST_SECRET` + `WEBHOOK_USER_ID` — Tasker auth for `app/api/health-connect/ingest/route.ts`

Optional:
- `NATIVE_AUTH_ALLOW_ANDROID_DEV=1` — explicitly allow the separate Android development callback on production for internal testing. Off by default; use a test account.
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
- `AGENT_ACTIONS_SECRET` — the agent key (issue 2381). Enables `POST /api/agent-actions` (and its
  `GET` job poll): `Authorization: Bearer …` runs one job from the allow-list in
  `lib/agent-actions/jobs.ts` on the owner's account (`ADMIN_EXPORT_USER_ID`, falling back to
  `WEBHOOK_USER_ID`, which must still be an admin), and every run is a row in `agent_action_log`.
  **Fail-closed:** unset, or shorter than 32 characters, and every agent route answers 401; the
  session cookie is never accepted there. Read in one place only (`lib/agent-actions/guard.ts`, held
  by a source-scan test). **Set by the owner, never by an agent**: generate with
  `openssl rand -hex 32`, rotate by replacing the Railway var, switch off by deleting it
  ([owner manual](owner-manual.md#the-agent-key-turning-it-on-rotating-it-turning-it-off-issue-2381)).
  Tests use a fake value.
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
- `AI_DEV_DAILY_CALL_LIMIT` — **local and agent machines only; never set on Railway.** How many live
  Gemini requests this machine may make in a rolling 24 hours before `lib/ai/dev-call-budget.ts`
  refuses the next one with `DevAiBudgetError` (#2816). Unset, blank or not a non-negative integer
  means the default, 100. `0` means no live calls at all — a mocks-only session. The cap exists
  because every key draws on the one prepaid balance production uses; raising it needs the owner's
  say-so ([rules](rules/ai-security-and-integrations.md#live-ai-calls-in-testing-one-key-one-balance)).
  The cap is off whenever `NODE_ENV=production` or a Railway environment variable is present, so it
  can never apply to the live app.
- `AI_DEV_CALL_LOG_PATH` — **local and agent machines only; never set on Railway.** Where the cap
  above keeps its request timestamps. Defaults to `trainingai-dev-ai-calls.json` in the OS temp
  directory; deleting that file resets the count.
- `APK_RELEASE_REPO` — which repo `lib/github-release.ts` reads releases from. Set to
  `nekodas-neko/TrainingAi_Open`. The code falls back to the pre-cut repo, which is archived, so
  leaving it unset means reading a release whose version never changes again.
