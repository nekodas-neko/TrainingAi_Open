# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-19 · **By:** the third session to run as Lane A · **Q band:** 314–349 (next free: **319**)
**Migrations:** 189–202 taken; next free is **203**. Local SQLite **v27**.

## Now

**The nutrition cluster is the owner's stated priority** (*"lets focus on the nutrition changes now"*,
2026-08-18) and it is ordered by dependency, not Q number, at the top of
`docs/implementation-backlog.md`. Lane A's share of it is **done**: Q-401, Q-387 and Q-409's route
half have all merged. **Everything remaining in that cluster is Lane B** — the label canvas (Q-411),
the `food-row.tsx` extraction that gates the rest (Q-406), the visual pass (Q-395), and the recipe-URL
picker (Q-409's other half).

**So Lane A is currently working the general queue below the cluster, not the cluster.** That is
correct, not a drift — there is nothing in it for this lane until Lane B's gate lands.

### The database reclaim is still the standing deadline item, and it has not moved

Inherited unchanged from the previous baton, because **nothing in this session touched it**:

| Step | Worth | State |
|---|---:|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ merged, landed on deploy |
| Pack the raw frames (Q-541 Task 5 backfill) | **~630 MB** | ⛔ **needs a press against production** |
| `VACUUM FULL error_events` (Q-315) | **~49 MB** | ⛔ **needs a press against production** |

**Nothing has been packed and no row has moved.** Every reclaim is admin-session-gated and a sandbox
session cannot authenticate to production (`CLAUDE_DB_QUERY_SECRET` is read-only;
`ADMIN_EXPORT_SECRET` is GET-only on one route). Either the owner runs the curls, or Lane B builds the
buttons (Q-316), or a **confirm-first** bearer path is added — **do not build the third without an
explicit yes, it is an auth change.** Runbook:
[`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).

## Shipped this session (for orientation, not credit)

All on `main`: **Q-473**, **Q-475**, **Q-481**, **Q-485**, **Q-484**, **Q-487**, **Q-548**, **Q-401**
(retire the second TDEE model), **Q-387** (day-completeness gate on calibrated maintenance),
**Q-320** (a caught error stops being the response body), **Q-498 + Q-322 slice 1** (bounded request
bodies + ratchet). **Q-409's Lane A half** (recipe URL → meal, behind an SSRF-closed fetch).

**#124 (Q-479) is deliberately open and must NOT be merged.** The owner's decision, verbatim:
*"leave that as a known issue for now - only admin will be me for a long time."* Do not re-implement
it either.

## Next

1. **Q-486** `[workouts][devices]` sits above most of the queue but is **Lane B** (`components/**`).
   Skip it; do not take it because it is next in the file.
2. **Q-322 slice 2** — the ratchet is in place and the baseline is the worklist: **104 bare
   `req.json()` reads across 92 route files**. Take a slice, not the sweep. Suggested order by
   exposure: `nutrition/food-logs`, `log-exercise`, `complete-workout`, `sync/push`, `water-log`,
   then `user/password`, then the rest.
3. **Q-482** `[platform][nutrition][workouts]` — a non-UUID id reaches Postgres and 500s on 21
   route/method pairs. Adjacent to Q-320/Q-483 which are now both done, so the context is fresh.
4. **Q-489** `[platform][readiness]` — five sites turn an ms offset into a calendar day; in a DST zone
   three compute "today" when they mean "yesterday".
5. **Q-323** `[nutrition][app-shell]` — the Lane A half is small (which macro absorbs earned
   calories, in `packages/shared/src/nutrition/calorie-balance.ts`) but the entry says it needs the
   product call first. Q-401 recorded the answer as *carbs*; confirm before building, and do not scale
   all three uniformly — that reintroduces Q-401's shape inside one card.
6. **Q-321** is owner-gated by its own text. Leave it.

**Filed by this session and not started:** Q-321, Q-322 (rewritten), Q-323.

## Blocked

- **Q-541 Task 5 and Q-315** — on the owner (the three options above).
- **Q-537** — approved, unverifiable from the sandbox.

**Owed rather than blocked:** the device check on Q-310, filed as a `projectOverview.md` Known-Issues
row. Confirm at the next engine-chosen deload: header "Deload", reduced weights, no PR badge.

## Claimed paths

- **`lib/net/`** — new this session (`safe-fetch.ts`), engine-side, Lane A's. Listed in
  `docs/module-map.md`.
- `app/api/admin/vacuum/`, `app/api/oura-ble/rekey/`, `lib/data/postgres/slices/oura-raw-{frames,pack}.ts`
  — inherited, still Lane A's.

## Findings recorded, so they are not re-derived

**From this session:**

- **One defect shape recurred three times: deriving a decision from a read taken *before* the write.**
  Q-460, Q-473 and Q-481 were all this. Every fix is the same — read the write's own affected-row
  count (`.returning()`, `onConflictDoNothing().returning()`), never a prior SELECT. Expect a fourth.
- **A deliberate refusal and a driver failure are indistinguishable through `e.message`**, which is
  what made Q-320 an item rather than a sed. Marked at the throw now:
  `UserFacingError(message, status)` in `packages/shared/src/errors.ts`, answered by
  `refusalResponse(err, fallback)` in `lib/api/route-errors.ts`. **Substring status-matching is gone
  with it** — `msg.includes('default')` fired on any error carrying the word.
- **`app/api/admin/db-query` echoing its raw error is correct and exempt.** There the DB's error text
  *is* the answer the operator asked for. `coach/apply/[id]/undo`'s `detail` was never a leak either —
  an author-written literal off a structured result. Both were false positives in Q-320's own list.
- **A rate limiter keyed on the request IP can move above the body read with no contract change.**
  Q-498 claimed `health-connect/ingest` needed its secret moved to a header to gate before parsing.
  It did not — the limiter reads the IP from headers. Moving the secret would have broken the owner's
  Tasker profile for nothing.
- **A recipe page is ~550 KB and its first 4,000 characters are navigation.** Both measured against
  real sites and both changed the code (Q-409): the byte cap is 3 MB, and the model fallback strips
  page furniture and starts at the "Ingredients" heading.
- **DNS rebinding is NOT closed out in `fetchPublicUrl`.** The address is validated and then the
  hostname is connected to by name. Closing it needs connecting to the pinned IP with the Host header
  preserved, which undici does not expose. Written in the module's docstring; do not claim otherwise.

**Inherited and still true:**

- **All raw-frame reads go through `lib/data/postgres/slices/oura-raw-frames.ts`.** A hot-only read
  silently returns a 7-day history and raises nothing.
- **An aggregate cannot use that reader's dedupe** — count via an anti-join on `(epoch, tag, ds_bucket)`.
- **`oura_raw_samples.measured_at` and `event_name` are DEAD COLUMNS.** Do not add a reader; dropping
  them is data-dropping and owner-gated.
- **A ds regression is NOT evidence of a ring-clock reset** (Q-314). A re-drain produces one. The
  discriminator is the ratio to the epoch ceiling, and it is unvalidated in the direction it exists
  for because there is no observed true reset in the data.
- **The `VACUUM FULL` allowlist is a safety boundary, not validation.** `hasOwnProperty`, never `in`.
- **`error_events`: 4 live rows in 49 MB.** Not a leak — space MVCC never handed back.
- **The redecode's `?async=1` job path is opt-in** and the default is unchanged deliberately (Q-535);
  **Q-318** is the other half.

## Do not re-litigate

- Lane contract, authority limits and Q bands: [`docs/agents/README.md`](../README.md). Take Q numbers
  from the band, never from the backlog's next-free pointer.
- **Q-479 is the owner's decision to leave open.** See above.
- **Q-322's piece 1 already exists** — `readJsonLimited`. Do not build a second bounded reader.
- **Q-541 Task 0 is answered structurally and must not be re-answered by counting.**
- **Q-540 is superseded by Q-541.**
- **Q-310's fix-direction items 2 and 3 were refuted and deliberately not built.**
- **Q-185 is closed**, despite `docs/domains/workouts/README.md` saying otherwise.

## Method notes worth keeping

**Learned this session:**

- **An in-process concurrency test can pass on broken code.** Q-473's four parallel calls did not race
  because the first paid for the lazy import, the `getRepository` singleton and cold pg connections.
  Add a warm-up pass before the parallel one, or the test proves nothing.
- **Unit tests passing is not a rehearsal.** Q-475's retryable classifier passed every test and
  returned `retryable: None` live, because the dev `DATABASE_URL` is the **Unix-socket** form — a dead
  server gives `ENOENT`, not `ECONNREFUSED`. Rehearse through `pnpm dev`.
- **`next build` catches what `tsc` and 4,165 tests do not.** Q-401 dragged `node:path` into the client
  bundle through a shared import; only the real build saw it. Fix shape: a zero-import leaf module.
- **Node's `fetch` ignores `HTTPS_PROXY` in this sandbox** — outbound requests 403 until you set
  `NODE_USE_ENV_PROXY=1`. `curl` works either way, which makes the failure look like the remote site
  blocking you. Cost a diagnosis this session.
- **A guard proven only against a mocked resolver is not proven.** Every SSRF case in Q-409 was also
  fired at `pnpm dev` with a real session cookie, and both halves matter: the refusals still echo
  their message, the faults do not.
- **Prove a new CI check bites.** Revert one site to the banned shape, watch it go red naming that
  line, restore it. Done for both checks added this session; it is thirty seconds and it is the only
  thing separating a check from a comment.
- **Log in to `pnpm dev` with:** `GET /api/auth/csrf` for the token, then
  `POST /api/auth/callback/credentials` with `email=test@local.dev&password=testpass123&csrfToken=…&json=true`
  into a cookie jar. Everything session-gated is then testable by `curl`.
- **Kill the dev server by port, never `pkill -f "next dev"`** — that matches and kills your own shell
  (exit 143/144). Use `ps -eo pid,args | grep next-server` and kill the pid.

**Inherited:**

- **A migration verified on a fixture is not verified.** Ask the production row count *before* writing
  a data migration; the pool's `statement_timeout` is **15 s**.
- **The tell that a migration silently failed:** absent from `schema_migrations` while `/api/version`
  reports the release carrying it. There is no `error_events` row.
- **A new table needs a regenerated `claude_ro` view migration**, generated **after** the table exists
  locally, into a **new** migration number — `ensureSchema` tracks by filename, so editing an applied
  migration means the change never lands. The generator needs the production owner id
  `fe481797-4114-4f59-824d-223e0281823e` and `2>/dev/null` (its log line otherwise lands in the SQL).
  `claude-ro-readonly-role.test.ts` pins the newest views migration by filename — repoint it in the
  same commit.
- **A Next.js `route.ts` may not export arbitrary symbols.** Put test helpers in a sibling module.
- **`CLAUDE_DB_QUERY_SECRET` works from the sandbox**, but the `claude_ro` search_path makes
  `pg_total_relation_size('oura_raw_samples')` resolve to the **view** and return 0. Join `pg_class`
  to `pg_stat_user_tables` on `relnamespace = 'public'::regnamespace`.
- **The seed user is not an admin.** `UPDATE users SET is_admin = true WHERE email='test@local.dev'`
  and **revert after**.
- **The rate limiter has an in-memory L1 in the dev-server process.** `DELETE FROM rate_limits` does
  not clear it — restart `pnpm dev` if you 429 yourself. Do clear the table before believing a
  `Too many requests` assertion failure in the suite.
- **The local DB is shared across branches.** A table from another branch's migration fails the
  `claude_ro` coverage guard on a branch that lacks it — local skew, not a defect.
- **`scripts/check-doc-index-size.js` conflicts on nearly every merge, every session.** Resolve
  mechanically: keep **both** prose blocks, re-measure the merged files, write the numbers back. Never
  splice. Same for `package.json`/`changelog.ts` — rebuild from `git show origin/main:…`.
- **`get_check_runs` returning `total_count: 0` minutes after opening a PR is a stale base, not slow
  CI.** Fetch, merge, push. Conversely, when it looks frozen on a current base, attempting the merge
  is the reliable check — branch protection refuses a genuinely pending required check.
- **Bash `curl` to `api.github.com` is unauthenticated here.** Use the `mcp__github__*` tools.
- **After merging another lane's work, `pnpm install` before believing a `tsc` error.**
- The local dev DB reports three pre-existing `ensureSchema` failures (`038`, `040`, `041`). Ignore.
