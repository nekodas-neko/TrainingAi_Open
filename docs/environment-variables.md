# Environment Variables

Reference for every environment variable this app reads — Railway production config and
session-local overrides. Consulted when setting up or debugging config, not needed for
everyday feature work. Moved out of `CLAUDE.md` on 2026-09-02 to keep that file to what
every session needs; nothing here changed in the move.


**Changing a Railway variable:** the banner's **Deploy** button rebuilds the latest `main`, not the running release. Cancel that build straight away and tell the Orchestrator, who applies the value with **Release** `rollback_to` = the current tag ([owner manual](owner-manual.md#changing-a-railway-variable-cancel-the-build-it-starts); found 17 Oct 2026 adding `OURA_TOKEN_KEY`).

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
  **The same three variables decide who the protected owner is** (#3368, `lib/admin-owner.ts`): only
  that account removes admin from anyone, and nobody else deactivates it (or, with #3369, resets or
  deletes it). Same order: `CLAUDE_RO_OWNER_USER_ID`, then `ADMIN_EXPORT_USER_ID`, then
  `WEBHOOK_USER_ID`. The id must be a uuid that names an **existing, active admin**; anything else
  (unset, malformed, no such user, a non-admin, a database error) leaves the owner unresolved, which
  fails closed: no one can remove admin, and no admin account can be deactivated. So changing one of
  these changes who is protected, not just which rows the audit views show. The day-review export
  and the agent key do **not** use this helper; they read `ADMIN_EXPORT_USER_ID ?? WEBHOOK_USER_ID`
  directly.
  **When you add or drop a table or column, regenerate `lib/data/postgres/claude-ro-views.sql` in the
  same PR**, overwriting that one file (`scripts/generate-claude-ro-views.js`; the command and the
  reasons are in [`docs/rules/offline-first-and-storage.md`](rules/offline-first-and-storage.md)).
  It is not a migration: it is applied after the migrations and re-applied when its hash changes, so
  never re-issue it under a new migration number (BF-214). The schema is default-deny, so a new table
  is unreadable until it has a view, and a DB-backed test fails if the counts diverge. The file DROPs
  and rebuilds the schema each run: `CREATE OR REPLACE VIEW` would leave a stale unscoped view serving its
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

## Also read by the server

Found by a `process.env` sweep of `app`, `lib`, `packages`, `scripts`, `mobile`, `instrumentation*`
and the config files on 15 Nov 2026 (#3798). **Secret** means a credential: set it in Railway or a
CI secret, never in a file.

- `ADMIN_EMAIL` — `instrumentation-node.ts` (`bootstrapAdmin`). At every boot, sets
  `users.is_admin = true` for the account with this email. Unset: nothing happens; there is no
  fallback email. Not secret, but it is a personal detail, so it stays out of the repo.
- `TRUSTED_PROXY_COUNT` — `packages/shared/src/http/client-ip.ts`. How many proxies sit in front of
  the app, which decides which `X-Forwarded-For` hop is the client's IP for rate limits. Default `1`
  (Railway's edge). A malformed value or `0` falls back to `1`, never to "trust the leftmost hop".
- `PG_POOL_MAX` — `lib/data/postgres/client.ts`. Lowers the pool size below the default of 10; a
  value outside 1–9 is ignored, so it can never raise the connection budget. Only the BLE rollup
  worker sets it (to 2). Leave it unset on Railway.
- `DATABASE_SSL` — `lib/data/postgres/client.ts` and `readonly-client.ts`. `true` turns on TLS
  outside production; in production TLS is always on. Default off.
- `OURA_AUTOPACK` — `lib/data/postgres/slices/oura-raw-pack.ts`. `off` stops the automatic packing of
  raw Oura rows without a deploy. Unset: packing runs, at most once per user every 6 hours.
- `OURA_CONSTANTS_DIR` — `lib/oura-models/constants/index.ts`. Where the model constants are read
  from. Boot sets it after downloading them; do not set it by hand. Without it the loader falls back
  to the cache directory, then the tree.
- `APPLE_NATIVE_CLIENT_ID` — `lib/auth/apple.ts`. The audience a native Sign in with Apple token must
  carry. Default `com.fitnessai.training`.
- `RAILWAY_GIT_COMMIT_SHA` — set by Railway. `lib/build-sha.ts` reads it as the build's commit, with
  the `BUILD_SHA` file as fallback; `next.config.ts` turns it into `NEXT_PUBLIC_BUILD_ID`.
- `RAILWAY_ENVIRONMENT_NAME` / `RAILWAY_ENVIRONMENT_ID` — set by Railway. `lib/ai/dev-call-budget.ts`
  reads either as "this is Railway" and switches the dev call cap off.
- `NEXT_RUNTIME` — set by Next. `instrumentation.ts` picks the Node or edge setup from it.

**Exercise media storage** (`lib/exercise-storage.ts`, also `scripts/upload-model-assets.js` and
`scripts/archive-private-paths.js`). An S3-compatible bucket. Each setting has an `AWS_*` name and a
`STORAGE_*` name; the `AWS_*` one wins. An empty string counts as unset, because Railway writes one
for a blank variable. Without endpoint, key id and secret, uploads return null and media falls back
to inline storage.
- `AWS_ENDPOINT_URL` / `STORAGE_ENDPOINT` — the bucket's endpoint. No default.
- `AWS_ACCESS_KEY_ID` / `STORAGE_ACCESS_KEY_ID` — **secret.**
- `AWS_SECRET_ACCESS_KEY` / `STORAGE_SECRET_ACCESS_KEY` — **secret.**
- `AWS_DEFAULT_REGION` / `STORAGE_REGION` — default `auto`.
- `AWS_S3_BUCKET_NAME` / `STORAGE_BUCKET_NAME` — default `trainingai`.
- `STORAGE_PUBLIC_URL` — the public base URL for media links. Default: endpoint + `/` + bucket
  (path-style).

**Error reporting (Sentry).**
- `SENTRY_DSN` — `sentry.server.config.ts`, `sentry.edge.config.ts`. Server and edge reporting.
  Unset: those report nothing, and the boot log says `server DSN MISSING`.
- `NEXT_PUBLIC_SENTRY_DSN` — `instrumentation-client.ts`. Browser reporting; inlined into the
  client bundle at build time. A DSN is not a secret.
- `SENTRY_AUTH_TOKEN` — `next.config.ts`, build time only. **Secret.** Uploads source maps and
  creates the release; unset, the build skips both.
- `NEXT_PUBLIC_APP_VERSION` / `NEXT_PUBLIC_BUILD_ID` — not set by hand: `next.config.ts` derives them
  from `package.json` and the build's commit. Sentry's release name and the app-load report read them.

**Client build-time.**
- `NEXT_PUBLIC_THUNDERFOREST_API_KEY` — `packages/shared/src/map-tiles.ts`. Map tiles for routes.
  Inlined into the client bundle, so it is public by nature; restrict it by referrer in the
  Thunderforest dashboard where the plan allows. Unset: OpenStreetMap tiles.

## The native app (`mobile/`)

Read at build time by Expo and EAS. `EXPO_PUBLIC_*` values are inlined into the app, so none of them
may be a secret.

- `EXPO_PUBLIC_API_URL` — the server origin the app talks to (`useAccount`, `AboutScreen`,
  `TooOldNotice`). Set per profile in `mobile/eas.json` to the production Railway URL;
  `mobile/.env.example` holds the same. No code default. **Never point the real app at a local
  server** (`CLAUDE.md`).
- `EXPO_PUBLIC_BUILD_SHA` — `mobile/src/integrations/app-info/`. The commit the build came from;
  default `dev`.
- `EXPO_PUBLIC_DEV_REPORT_URL` / `EXPO_PUBLIC_DEV_REPORT_KEY` — development builds only.
  `mobile/src/development/diagnostics/client.ts` posts diagnostics there, and
  `mobile/scripts/receive-diagnostics.mjs` receives them. The key is a shared token between your own
  build and your own receiver; it ships inside the build, so never reuse a real credential for it.
- `APP_VARIANT` — `mobile/app.config.js`. `side-by-side` builds `com.trainingai.app.preview`, the
  build that installs beside the real app.
- `EAS_BUILD_PROFILE` — set by EAS. Unset, `development` or `android-development` means a dev build
  (`com.trainingai.app.dev`); any other profile builds the real ID, `com.trainingai.app`.
- `ANDROID_VERSION_CODE` — `mobile/app.config.js`. The Android version code for non-development
  builds; CI passes a rising number. Unset: the config's default.
- `EAS_BUILD` — set by EAS. `mobile/src/development/build/shared-package.mjs` restores the shared
  package only inside an EAS build.
- **Signing** (`mobile/scripts/android-signing.mjs`, CI secrets, all **secret**): `KEYSTORE_B64`,
  `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Without `KEYSTORE_B64`, `LEGACY_KEYSTORE_B64`
  is used with the debug key's alias and password. `ANDROID_EXPECTED_CERT_SHA256`
  (`check-android-signing.mjs`) is the certificate fingerprint a build must match; a fingerprint is
  not secret. **Never install over the app with a differently signed APK** (`CLAUDE.md`).
- `AAPT2`, `APKANALYZER`, `APKSIGNER` — paths to the Android build tools for
  `verify-release-apk.mjs` and `verify-android-upgrade.mjs`. Default: the bare command name.

## Scripts, tests and CI

None of these is read by the running app. None is secret unless marked.

| Variable | Read by | Default / meaning |
|---|---|---|
| `LOCAL_DATABASE_URL` | `scripts/generate-claude-ro-views.js`, `scripts/local-db/rebuild.js` | The local Postgres the views are generated from; rebuild refuses a non-local target |
| `LOCAL_DB_PORT` | `scripts/local-db/snapshot.js`, `scripts/backfill-baseline-phase-tag.mjs` | `5433`; the only port those scripts accept as local |
| `SNAPSHOT_URL` | `scripts/local-db/snapshot.js` | The production `/api/admin/db-snapshot` URL; sent with `ADMIN_SNAPSHOT_SECRET` |
| `CI_LOCAL_PG_PORT` | `scripts/ci-local.mjs` | `5439` |
| `RUN_LIVE_AI_TESTS` | `lib/ai/dev-call-budget.ts` | `1` lets a test make live Gemini calls; otherwise tests make none |
| `VITEST` | `lib/data/postgres/user-read-memo.ts`, `observed-hr-day-cache.ts` | Set by Vitest; turns those per-process caches off in tests |
| `TZ` | `mobile/tests/` | Two native test files set it to pin the process timezone; the app never reads it |
| `E2E_BASE_URL`, `E2E_PORT`, `E2E_CHROMIUM_CHANNEL` | `playwright.config.ts` | Port `3100`; with a base URL set, Playwright starts no server |
| `SCAN_CHECK_FIXTURES` | `scripts/lib/fixture-dirs.js` | Lets the custom-rule checks scan their own fixtures |
| `USER_SCOPING_MIN_CHECKED` | `scripts/check-repository-user-scoping.js` | `670`; the check fails if it inspects fewer functions |
| `OWNERSHIP_MUTATION_FILE`, `_INDEX`, `_MARKER` | `scripts/ownership-mutation-sweep/vitest.config.mjs` | Which mutation the sweep applies |
| `PR_NUMBER`, `GITHUB_REPOSITORY`, `GITHUB_API_URL`, `GH_TOKEN` / `GITHUB_TOKEN` | `scripts/check-commit-attribution.js` | Set by CI to read a PR's commits; the token is **secret** |
| `GH_REPO` | `scripts/queue.js`, `sync-labels.js`, `sync-title-prefixes.js` | `nekodas-neko/TrainingAi_Open` |
| `GITHUB_ACTIONS` | `scripts/native-switch-over/install.mjs` | Set by Actions; with `CI`, makes the installer refuse to run |
| `APP_URL`, `EXPECT_SHA` / `GITHUB_SHA`, `DEADLINE_SECONDS`, `POLL_SECONDS` | `scripts/check-deploy-landed.js` | The production URL; the commit to wait for; `1500` s; `20` s |
| `AGENT_RUNNER_PROMPT` | `scripts/agent-runner.mjs` | Overrides the role's built-in prompt |
| `ADB_PATH`, `DEVICE_CDP_PORT`, `DEVICE_CDP_URL`, `DEVICE_PROBE_OUT`, `TRAININGAI_APP_ID`, `CHROME_PATH` | `scripts/device/` | `adb`; `9222`; derived from the port; `./device-probe`; `com.trainingai.app`; found on the machine |
| `SERIAL`, `CHUNKS`, `RTT_MS` | `scripts/load-test/sync-fanout.js` | Off, `0`, `0` |
| `ACCEL_MET_DIR`, `BB_REPLAY_DIR`, `CAL_REPLAY_DIR` | `scripts/tuning/` replays | Working directories under `/tmp` |
| `PGOPTIONS` | `scripts/tuning/activity-finalise-replay-2435.cjs` | The script appends `default_transaction_read_only=on`, so the replay cannot write |
