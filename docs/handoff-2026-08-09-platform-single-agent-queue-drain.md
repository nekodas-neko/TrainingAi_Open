# Handoff — 2026-08-09/10 · Single-agent queue drain (17 items, 18 PRs, all merged)

_Domain: `platform` (also touches `app-shell`, `devices`, `readiness`, `heart-rate`, `activity`,
`workouts`) · **Nothing left open — every PR from this session is merged.** Last merge:
[#1230](https://github.com/nekodas-neko/TrainingAI/pull/1230), `main` at `14910f3`._

> **The queue's unblocked items are drained.** Everything still in
> `docs/implementation-backlog.md` needs either an owner decision, the S25, or a confirm-first
> approval. Do not start a fresh item expecting it to be actionable — read its gating note first.

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/platform/README.md`](domains/platform/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md). This file covers only what *this*
> session did. Predecessors: [`handoff-2026-08-08-app-shell-review-backlog-ui-batch.md`](handoff-2026-08-08-app-shell-review-backlog-ui-batch.md)
> and [`handoff-2026-08-08-platform-review-backlog-drain-and-production-audit.md`](handoff-2026-08-08-platform-review-backlog-drain-and-production-audit.md).

## Goal

First session with no territory split — one agent owning the whole queue. Clear the three
housekeeping items from the previous handoff, then work the ready items top-down.

## Current status

- **Build/test (final):** `tsc --noEmit` clean · `eslint` clean (only pre-existing warnings) · full
  suite **433 files / 3444 tests** green · all **16** custom-rule scripts pass.
- **Two PRs from OTHER agents were open at the end and are not mine**: #1225 (Coach output tokens)
  and #1218 (Q-175, early-deload vs AI-dynamic weight). Do not assume they are yours to merge.
- **Device-verified: NO — nothing ran on the S25.** Verified against `pnpm dev` with a scripted
  Chromium at 412×915. Two of this session's changes have device surfaces that were **not**
  exercised and are flagged in `projectOverview.md`:
  - **Q-143** is the ring ingest path. The new reads were proven equivalent to the old ones against
    a real Postgres, but no live BLE drain ran.
  - **Q-145** and **Q-150**'s four native-only reconciler gates only matter on the APK.

## What shipped

Seven PRs. Six merged, one green and awaiting its post-rebase CI.

| PR | Item | What |
|---|---|---|
| #1174 | Q-156 | Unblocked the stranded sleep_score handoff; renumbered Q-150→156 |
| #1182 | **Q-150** | `SyncProvider` no longer calls the API before login |
| #1143 | Q-141 | AI-chart-follow-up planning entry (was open 20h) |
| #1184 | **Q-151** | **Refuted** — downgraded to a dated re-check |
| #1186 | **Q-152** | `ensureSchema` classifies by SQLSTATE; filed Q-159 |
| #1189 | **Q-143** | Anchor table no longer read whole on every ingest batch |
| #1190 | **Q-145** | Uncaught server errors attributed to a user |
| #1198 | **Q-159** | `001_initial.sql` stops re-failing every boot (migration 174) |
| #1203 | **Q-42** | Body Battery anchors on readiness from the first read of the day |

New: `components/__tests__/sync-provider-auth-gate.test.ts`,
`lib/data/postgres/__tests__/ensure-schema-error-classification.test.ts`,
`lib/data/postgres/__tests__/oura-clock-anchor-scoping.test.ts`,
`lib/observability/__tests__/request-error-user-attribution.test.ts`,
`isIdempotentMigrationError`, `getOuraClockEpochHead`, `getNewestOuraClockAnchorByUtc`,
`userIdFromSessionCookie`, `sessionCookieFromHeader`.

### Three entries whose own premises were wrong

This is the theme of the session. **Verify the entry against reality before implementing it** — the
protocol already says so, and it paid three times today.

1. **Q-151 does not reproduce and the class looks closed.** Filed as a live second React #418 on
   `/sign-in`. Production has **never** recorded a #418 on that page — `0` of `272` rows, all on
   `/`, `/more`, `/health`, `/workout`. The whole series stopped 19 minutes after Q-73's fix
   deployed (last hit 2026-08-07 20:53 UTC, #1130 merged 21:12 UTC) against a 1–13/day baseline. And
   eight runs across dev *and* a production build, under four localStorage theme states, produced
   zero console messages. Downgraded to a re-check around 2026-08-15, not deleted — one clean day
   is one day.
2. **Q-145 was filed as "not implementable"** because `onRequestError` is handed only
   `{ path, method }`. That was the repo's own narrowed local type being read as if it were Next's.
   `InstrumentationOnRequestError` passes `{ path, method, headers }`. The option the entry advised
   against is the one that works.
3. **Q-143's title blamed the rollup.** The hot caller is `insertOuraRawSamples`, so the 17,045
   sequential scans were one per **ingest batch**.

### Q-150's real number is 22, not 12

Phase 3 sleeps 2.5 s then warms all 20 `CACHE_TASKS` in chunks of five, so the review's network-panel
read caught about the first two chunks. Measured before/after: **22 → 0**.

## Second half (after context compaction) — 11 more items

Same rules, same gate. In queue order:

| item | outcome |
|---|---|
| **Q-165** | Triaged, not swept. Of ~24 "render-path GETs", **3** were genuine; the rest were sanctioned offline-first fallbacks, non-GET mutations, deliberate freshness re-reads, or already hand-seeded streams. Converting the real ones exposed that `/api/oura/hr-window` gated times on `HH:MM` while `activity_logs.start_time` serialises as `HH:MM:SS` — **the activity detail sheet's HR chart had never rendered, for any activity**. |
| **Q-166** | **Did not do it.** Measured the header first: `private, max-age=60` is a second cache under the app's own that `invalidateCache()` cannot reach. `DELETE /api/supplements/<id>` then `GET /api/supplements` returned the deleted row — on a route already shipping the header. Fixed the bug (`cachedFetch` + the SW `/api/` branch now send `cache: 'no-store'`); left the sweep on hold, because with the SW bypassing, the header governs almost nothing. |
| **Q-160** | Entry said pad the 7×7 dots to 48px. Measured pitch is **15px**, so 48px boxes overlap by 33px and the later sibling steals the tap. Shipped 24×44 on a 24px pitch, and extracted `components/ui/carousel-dots.tsx` (3 byte-identical copies). |
| **Q-154** | **Half the list was misclassified.** Three "inline sparklines" are *time-axis* charts (the primitive projects x by index); converting them would have moved every unevenly-spaced point. Moved to `EXEMPT`. The three real ones are blocked on primitive features, not effort. |
| **Q-173** | Deload card now shows the two numbers and thresholds that raised it. Thresholds travel in the payload so the card cannot state a bound the server dropped. |
| **Q-155** | Added `scripts/check-repository-user-scoping.js` — the entry's stated goal ("fails loudly when a new unscoped method appears"). 368 methods take `userId`, all 368 use it. Catches an *omitted* scope, not a wrong one; entry stays open. |
| **Q-171** | The flake is not an unscoped `DELETE`. Migration 163 is table-wide and rewrote the Cable test's PR **99 → 20**. Six migration-executing files now hold an advisory lock. |
| **Q-176** | Two remaining `tap-dense` controls, fixed in **opposite** directions — invisible box for the isolated one, grown ink for the one with an 8px neighbour. |
| **backlog integrity** | Found **Q-173 and Q-174 resurrected** by #1220's stale-base merge. Cleared after checking the code, not the titles. |
| **Q-177 (part)** | `reconcile-counters.test.ts`: only 1 of its 7 tests runs a migration, so the lock goes inside that `it`. |
| **Q-177 (correction)** | My own stated reason for excluding `claude-ro-readonly-role.test.ts` was a guess. It runs **DDL-only** (`DROP SCHEMA claude_ro CASCADE`) and was never in the class. Its real hazard is narrower and did not reproduce. |

**The through-line: eight of these had a premise that did not survive reading the code.** Including
two of my own measurements taken from CSS arithmetic instead of a browser (Q-176's "16px" was 21px;
Q-160's fix would have made things worse). Verify before implementing — every time.

## Deliberately NOT done

- **Q-42 — shipped (#1203), and the entry's premise was the fourth wrong one.** It framed the fix
  as "one shared function both routes call", which would have run ~11 repository reads on a route
  the sync provider warms at every app open. But the readiness route **already** compute-and-
  persists and Body Battery **already** prefers that row, so the only gap was the *first read of
  the day*. Owner chose blocking-once over a background variant. Measured ~48 ms added, once daily.
  The formula was never inline either — `computeReadinessComposite` was already in shared.

- **Q-7b — the entry is ⛔ gated**, despite the previous handoff listing it as "the largest ready
  piece of real work". It needs Phase-1 Task 5/6 (`rollup-device.ts`, does not exist) and the D2
  device run.
- **Q-104 and Q-114** — both need an on-device `chrome://inspect` capture before any code, and
  Q-114 additionally needs a Kotlin change plus a new APK. Owner confirmed no device this session.
- **Q-159 — shipped (#1198)** once the owner ran the production index query, which **retracted my
  own Q-107 hypothesis**: `idx_bm_user_date` is present in production, so it cannot be contributing
  to `/api/sync/pull` slowness. `idx_el_name_date` is absent **by design** (009 replaced it with the
  superset `idx_el_name_date_ws`) — I had counted a deliberately-retired index as missing. Production
  was never missing anything; the gaps were a drifted local dev DB.
- **The BLE radio effects in `sync-provider.tsx`** stay ungated on purpose. They own hardware, a
  failed step post re-queues in its own retry buffer against a server that dedups on
  `(user_id, start_ds)`, and changing when the ring radio starts is unverifiable here.

## Key decisions (with rationale)

- **Q-152 logs loudly but does not throw.** A migration that cannot apply is usually permanent, so
  failing closed would crash-loop every boot rather than surface anything new — and a crash loop has
  taken production down before.
- **Q-145 retries the INSERT with `NULL`.** `error_events.user_id` is a `uuid` with an FK; a token
  can outlive the row it names. Losing the error report to save the attribution inverts the priority.
- **Q-145 returns `{ name, value }` from the cookie parser.** Auth.js salts the decrypt with the
  cookie name, and `__Secure-authjs.session-token` contains `authjs.session-token` as a substring —
  substring-matching picks the wrong salt and silently decrypts to nothing forever.
- **Source-text tests where behavioural ones are impossible.** The repo has **no jsdom environment
  and no component tests** — every vitest project is `environment: 'node'`. Adding jsdom is a
  dependency decision, so `sync-provider-auth-gate.test.ts` brace-matches the source instead, in the
  shape of `lib/local-store/__tests__/insert-arity.test.ts`.
- **Every new test was verified against a planted regression**, not just written.

## Gotchas / what did NOT work

- **I asserted CI was stalled for 20–35 minutes without checking the wall clock.** It never was:
  runs took ~4m40s throughout. Each of my tool calls advances the clock only seconds, so elapsed
  time *feels* much longer than it is. **Run `date -u` before claiming anything about duration.** A
  404 from `get_job_logs` means the job has not finished, **not** that it hung — the previous
  handoff's "stalled runner" signature is much rarer than it reads.
- **`instrumentation.ts` registers once at server boot and does NOT hot-reload.** A working Q-145
  looked broken purely because the dev server predated the edit.
- **`NODE_ENV === 'production'` hard-forces `ssl: true`** (`lib/data/postgres/client.ts:16`) and the
  local Postgres refuses SSL — so a local `next build` + `next start` can only exercise
  **signed-out** routes. Login fails with `CallbackRouteError: The server does not support SSL`.
- **`pkill -f "next dev"` kills the shell running it** (the pattern matches its own command line).
  It bit me twice. Kill by PID from `ps -eo pid,cmd`.
- **Q numbers moved three times for one entry** (157 → 158 → 159) while it sat in CI. Two other PRs
  took those numbers. Re-grep `main` **and** the open-PR list at the moment you push.
- **`git stash` + `git merge` interleaved badly** — the stash reintroduced a backlog entry `main` had
  already removed, as a conflict. Commit before merging, not stash.
- **The previous handoff's ready-list was stale in three places** (Q-7b gated, Q-104/Q-114
  device-blocked). Read each entry, not the summary list.

### Second-half gotchas (all cost real time)

- **Playwright's `page.route` deadlocks against this app.** The service worker intercepts every
  `/api/` request, and re-fetching through it from a route handler hangs — two runs timed out at
  10 minutes before I worked it out. Patch `window.fetch` via `addInitScript` instead.
- **A blocking `pg_advisory_lock` in a pooled test harness parks one connection per waiter.** My
  first version of the Q-171 fix tipped an unrelated test (3.32 s solo against a 5 s default) over
  its timeout in 2 of 5 runs. `pg_try_advisory_lock` in a poll loop, releasing between attempts,
  fixed it. Serialization was never the cost — all six files together take 1.96 s.
- **Measure the BASELINE, not just your branch.** Eight clean runs on my branch looked like proof;
  what actually identified the regression was running unmodified `main` eight times. A low-rate
  flake in an already-flaky suite makes single-sided evidence worthless.
- **A stale-base merge can resurrect a completed backlog entry.** #1220 restored Q-173 in full and
  re-added a bare Q-174 heading. **A heading with no body under it is the tell.** Confirm an entry's
  ask is still missing from the *code* before working it.
- **A merged PR title is part of the Q-number claim surface.** I filed a follow-up as Q-174 while
  #1219 already held it — and grepping the backlog would not have caught it, because that PR
  correctly removed its own entry on completion.
- **Cold Next dev-server route compilation looks exactly like a hang.** An 8 s wait after an
  interaction is not enough; warm routes with `curl` first, or wait 35 s. This burned three runs
  where a click appeared to fire no request at all.
- **A static check's first run should be spent hunting FALSE POSITIVES** among methods you already
  know are correct. My first unscoped-read detector flagged 29 correct methods (multi-line return
  types opened a brace first); the second, over-tightened, left 73 unclassified.
- **`check-component-size.js` is shrink-only and it will catch a two-line comment.** Mine pushed
  `profile-tab.tsx` 849 → 851. The comment came out; the reasoning went in the test and the journal.

## Files to look at

- `components/sync-provider.tsx` — six effects gated on `userId`; two BLE ones deliberately not.
- `lib/observability/request-error.ts` — `userIdFromSessionCookie`, the FK retry, the dedup key.
- `lib/data/postgres/adapter.ts` — `getOuraClockEpochHead` / `getNewestOuraClockAnchorByUtc` and why
  the epoch scoping is load-bearing.
- `lib/data/postgres/client.ts` — `isIdempotentMigrationError` and the six benign SQLSTATEs.

## Open questions / blockers

**Nothing in the queue is startable without one of these.** Each is gated, and the gate is real:

- **Owner decision needed:** Q-141 (chart follow-up: prompt vs. deterministic safety net) ·
  **Q-166** (should API responses be `private, no-store`? The evidence says yes; it contradicts a
  standing CLAUDE.md rule, so it is an architecture call) · Q-72 (Sleep Score) · Q-137 (Activity
  Score) · Q-136 and Q-138 (decide-then-delete, and which extractions are wanted).
- **Confirm-first:** **Q-172** — `components/chat.tsx` has two sign-out buttons that clear neither
  the cache nor the local store, while More → Profile clears both. It is a genuine cross-account
  data-exposure path, and the fix drops local data on session teardown, so it needs approval.
- **Device (S25) needed:** Q-104, Q-114, Q-116, Q-7b — and **everything this session shipped**.
- **Q-177** — the DB-test isolation half nobody has solved: every DB test shares one
  `trainingai_dev`. The advisory lock only covers whole-migration interference. A schema per vitest
  worker is the likely answer and is a real piece of work.
- **Q-107 still has no evidence.** Do not build the batching fix without a `[pg …]` prefixed row.
- **Q-151's re-check** around 2026-08-15.

### Not device-verified — the list to hand a device

Everything below shipped this session and was verified only in Chromium at 412×915:

1. **The service worker's `/api/` branch** (v1.276.3) — this is the APK's network path *and* its
   offline cold-start mechanism, and it deploys automatically. Highest-risk item on this list.
2. The activity detail sheet's HR chart, which has **never** rendered before (v1.276.1).
3. Carousel dot and `tap-dense` hit areas (v1.276.4, v1.277.2) — a mouse click is a point, a thumb
   is not. This is what a desktop browser can least vouch for.
4. The early-deload card's "why" section (v1.277.0) — and note its **real trigger path is unproven
   end-to-end**: the render was verified by patching the response in-page, because the seeded DB
   cannot reach `score < 45 && acwr > 1.2` (`acwr` is null).

## Pickup prompt

```
Work the TrainingAI backlog on nekodas-neko/TrainingAI as the only agent.

READ THIS FIRST, because it changes what you should do:
the queue's UNBLOCKED items are drained. Every remaining entry in
docs/implementation-backlog.md is gated on an owner decision, on the S25, or on a confirm-first
approval. Do NOT pick the top item and start building — open it and read its gating note. If
everything is genuinely gated, say so and ask which gate the owner wants to open, rather than
manufacturing work.

Read in order:
  1. projectOverview.md — current status and the live Known Issues table
  2. docs/domains/<pillar>/README.md for whatever you end up working in
  3. docs/handoff-2026-08-09-platform-single-agent-queue-drain.md (this file — read the Gotchas
     and the "Not device-verified" list)
  4. docs/implementation-backlog.md — the live queue

FIRST, the standing session-start production read (CLAUDE.md):

    curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
      -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
      -d '{"sql":"SELECT url, source, left(message,120) AS message, count(*) AS hits, max(created_at) AS latest FROM claude_ro.error_events WHERE created_at > now() - interval '"'"'7 days'"'"' GROUP BY 1,2,3 ORDER BY hits DESC LIMIT 30"}'

Anything new gets a projectOverview.md Known-Issues row or a backlog entry the SAME session. That
table prunes at 30 days and is row-scoped to ONE user, so write findings as "nothing else of the
owner's", never "nothing else is failing". If a server row now carries a `[pg ...]` prefix, that is
Q-107's missing evidence: 57014 = statement_timeout (chase the slow query); no code at all means a
pool-acquisition timeout (chunk getSyncDelta's fan-out). Do NOT build Q-107's fix without one of
those two answers.

SECOND, pay particular attention to the shipped-but-unverified list in this handoff. The service
worker's /api/ branch changed (v1.276.3) and is the APK's network path AND its offline cold-start
mechanism, deployed automatically. If the owner has the S25, that check is worth more than any new
feature: install the current APK and confirm the app loads, syncs, and works offline. If it is
broken, the revert is one line in public/sw-template.js.

If the owner opens a gate, the highest-value items are, in order:
  Q-172  the chat.tsx sign-out clearing neither cache nor local store. Real cross-account data
         exposure. Confirm-first because the fix drops local data on session teardown.
  Q-166  decide whether API responses should be `private, no-store`. The measurement is done and
         points that way; it contradicts a standing CLAUDE.md rule, so it needs the owner.
  Q-177  DB test isolation — a schema per vitest worker. Real work, no decision needed, but scope
         it properly and measure the BASELINE before and after (see Gotchas).

Follow CLAUDE.md exactly: one feature branch per item cut fresh from origin/main, the full gate
(tsc --noEmit, eslint, vitest run, plus `pnpm dev` exercising every changed route and UI flow), and
the journal entry (a NEW file in docs/overview/entries/) + projectOverview.md update + backlog-entry
removal + version/changelog bump all bundled into that SAME PR. Re-confirm base currency immediately
before merging. Merge without asking once CI is green and tested — except destructive/irreversible
changes (data-dropping migrations, auth/session/security, secrets), which are confirm-first.

VERIFY EVERY ENTRY AGAINST CURRENT MAIN BEFORE IMPLEMENTING. Across this session, EIGHT entries had
premises that were factually wrong — a prescribed fix that would have made the problem worse
(Q-160's 48px hit areas), three "violations" that were correct code (Q-154's time-axis charts), a
header that was inert and harmful (Q-166), an 8x over-count (Q-165), a flake blamed on the wrong
mechanism (Q-171), and two of my own measurements taken from CSS arithmetic instead of a browser.
Reading the code first paid every single time, including against my own earlier work.

Constraints that would otherwise be re-discovered:
- Run `date -u` before claiming anything about elapsed time. CI takes ~4m40s end to end. A 404 from
  get_job_logs means the job has not finished, not that it hung.
- Q numbers collide constantly. Claim against origin/main AND the open-PR list AND recently MERGED
  PR titles — a completed entry is removed from the backlog, so grepping the file misses its number.
- A stale-base merge can RESURRECT a completed entry. A heading with no body under it is the tell.
  Confirm an entry's ask is still missing from the code before working it.
- Resolve package.json / packages/shared/src/changelog.ts conflicts by rebuilding from
  `git show origin/main:packages/shared/src/changelog.ts` and prepending. Never splice the hunks.
- Playwright's page.route DEADLOCKS here (the SW intercepts /api/); patch window.fetch via
  addInitScript instead. Warm routes with curl first — cold Next compilation looks like a hang.
- Never `pkill -f "next dev"` — it kills your own shell. Kill by PID.
- Commit before switching branches; prefer `git add <paths>` over `git add -A`.
- Any production SCHEMA question needs the owner: claude_ro exposes curated views, not pg_indexes.
  The local dev DB is drifted and is not evidence about production.
- No S25 access throughout this session (owner confirmed). Nothing from 2026-08-08 onward is
  device-verified.
```
