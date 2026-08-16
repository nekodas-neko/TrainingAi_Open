# Review Quick Fixes (2026-07-03 backlog review)

> **✅ RESOLVED — all 8 tasks verified shipped on `main` 2026-07-20.** These landed piecemeal across
> later cache-group / TTL-consolidation / push-parity sessions without this plan being closed out. Do
> NOT re-implement. Per-task confirmation is in `docs/planned_upgrades.md` § "R — 2026-07-03 review
> correctness findings". This doc is retained for historical context only.

**Branch:** `fix/review-quick-fixes` · **One PR.** Eight small, independent correctness/hygiene
fixes surfaced by the 2026-07-03 backlog review (session 184). All S effort; no migrations;
no new features. Each task lists its own verification. Standard gates apply: tests + lint +
`tsc` + local dev-server exercise of every touched flow before presenting.

Findings context: `docs/planned_upgrades.md` § "2026-07-03 backlog review".

---

## Task 1 — `invalidateHealthTrends()` cache group

**Problem:** the Trends card reads `health-trends:<view>` keys (`components/health/trends-section.tsx:25`,
TTL_MEDIUM) but no group helper in `lib/cache-groups.ts` includes the `health-trends:` prefix, and the
session-RPE tap on the done screen (`components/workout/done-screen.tsx`) fires **no** invalidation at
all. Tapping session RPE, saving a morning check-in, or completing a workout leaves the Session-effort /
Recovery-calibration / Rest-discipline trends stale until TTL expiry.

**Fix:**
- Add `invalidateHealthTrends()` to `lib/cache-groups.ts` clearing the `health-trends:` prefix.
- Call it from: the done-screen RPE save, `invalidateWorkoutSummaries()` (workout completion feeds
  session-rpe/rest-adherence/recovery-vs-strength views), the morning-checkin save (alongside its
  existing `invalidateReadinessInputs()`), the End of Day review save, and `invalidateOuraSync()`
  (readiness/sleep/meal-timing views).

**Verify:** dev server — log a workout, tap RPE, open Health > Progress > Trends: session-rpe view
shows the new session without waiting out the TTL.

## Task 2 — Mirror web-route validation in `pushMutations` for `session_rpe` + `day_checkins`

**Problem:** the web routes enforce `int().min(1).max(10)` (session RPE) and `min(1).max(5)`
(check-in scales); the sync-push branches (`lib/data/postgres/adapter.ts:2646-2664`, `:2834-2839`)
only check `typeof === 'number'` — an out-of-range outbox payload writes straight through and skews
the Foster session-load trend. This is the CLAUDE.md "sync-push must mirror the web route" rule.

**Fix:** clamp/validate identically to the routes in both branches; an invalid value is a 4xx-class
poison pill (rejected per-mutation, quarantined by the existing dead-letter path), not written through.

**Verify:** unit test pushing a `session_rpe` mutation with `sessionRpe: 42` and a `day_checkins`
mutation with a `6` scale — both rejected as validation errors, valid siblings still apply.

## Task 3 — Rate-limit `health-trends`

**Problem:** `app/api/health-trends/route.ts` has no `rateLimit` call, and views like
`rest-adherence` / `recovery-vs-strength` each load 90 days of full workout-session trees per hit.
CLAUDE.md: every expensive route gets the standard rate limit at creation.

**Fix:** add the standard `rateLimit` guard matching sibling aggregate routes (e.g.
`sleep-performance-correlation`).

**Verify:** `curl` the route past the limit → 429; normal use unaffected.

## Task 4 — Move `readCacheSync` seeds out of `useState` lazy initializers (2 sites)

**Problem:** `components/health/trends-section.tsx:47` and `components/home-day-timeline.tsx:212`
seed state via `useState(() => readCacheSync(...))` — the exact hydration-mismatch anti-pattern
CLAUDE.md bans (session 165). The trends one is redundant (an effect at `:52-55` already seeds).

**Fix:** initialize null and seed in the existing effects.

**Verify:** dev server with React strict/hydration warnings visible — Home and Health > Progress
render with no hydration mismatch warnings; repeat visits still paint instantly from cache.

## Task 5 — One canonical TTL for `readiness-score` and `muscle-recovery`

**Problem (stalled since the 2026-07-02 audit):** `readiness-score` is fetched with three different
TTLs (`health-content.tsx:382` MEDIUM, `heart-rate/page.tsx:24`/`session-select-content.tsx:673`/
`health-score-detail.tsx:125` LONG, `overview-screen.tsx:139` SHORT); `muscle-recovery` mixes
MEDIUM/LONG across 5 sites. Freshness is last-writer-wins.

**Fix:** define one TTL constant per key next to the key name (e.g. in the shared cache-keys/ttl
module) and use it at every call site. These are the only two mixed-TTL keys — this clears the class.

**Verify:** grep shows a single TTL source per key; screens still seed/paint as before.

## Task 6 — Stable row ids in `style-editor-sheet.tsx`

**Problem:** `components/config/style-editor-sheet.tsx:67` keys editable per-set rows with
`key={i}` — deleting a middle row makes rows below inherit stale input state (documented failure
class).

**Fix:** assign a client id at row creation and key/update by it.

**Verify:** dev server — create a 4-set style, delete set 2, confirm sets 3/4 keep their own values.

## Task 7 — Delete dead code: `components/chat-overlay.tsx` + `app/workout-mockup/`

**Problem:** both have zero importers/links; `chat-overlay.tsx` statically imports chart.js — a
re-import trap that would drag chart.js into any bundle that touches it.

**Fix:** delete both (confirm zero references first with a grep).

**Verify:** `pnpm build` passes; grep confirms no references.

## Task 8 — Replace the `invalidateCache('')` full-cache nuke

**Problem:** `app/health/health-content.tsx:527` calls `invalidateCache('')` (empty prefix = clears
the entire cache) then refetches — every warmed key app-wide is dropped for one health refresh,
guaranteeing skeleton flashes elsewhere.

**Fix:** replace with the specific group helpers (`invalidateOuraSync()` + `invalidateBiometrics()` +
`invalidateHealthTrends()` from Task 1 — confirm the exact set the refresh needs at implementation
time).

**Verify:** dev server — trigger the health refresh, confirm health data updates; navigate to Home —
cards still paint instantly from cache (no full-cache wipe).

---

**Done when:** all 8 tasks verified, tests/lint/tsc green, dev-server pass complete. Remove the
queue entry from `docs/implementation-backlog.md` in the same PR. Not exercisable in-sandbox:
native SQLite outbox behaviour for Task 2 (unit tests cover the server side; note it in the PR).
