# 2026-08-03 — cross-domain bug review, 5 findings queued

_Branch `claude/review-changes-bugs-kwkot0` · docs-only · domains `workouts` `devices` `body` `sleep`_

## The ask

Review the changelog and recently shipped changes (v1.250.0 → v1.252.4) plus production data via
the admin read-only endpoint, hunt for bugs across workout/health/nutrition/sleep, and queue what's
found — no fixes in this session.

## Method

Four review agents in parallel, each with a scoped brief and instructed to cross-check
`projectOverview.md`'s existing Known Issues before reporting (so nothing already-tracked got
re-filed):

1. **Cache-Control staleness sweep** — every `GET` route with a `max-age` header, checked against
   any rapid-mutation UI flow that could be served a stale browser-cached response, following up on
   a "worth a sweep, not audited this session" note left in the v1.246.0 entry.
2. **Write-path ownership & offline-sync mirroring audit** — every write-capable route touched in
   the last 40 commits, checked against the project's four recurring bug classes (sync-push
   mirroring, ownership discipline, cache-group registration, outbox payload completeness).
3. **Auto-apply phase-transition & bodyweight-1RM logic deep-dive** — the two riskiest recent
   workout-logic changes, read end-to-end for edge cases the shipping PRs' own Known-Issues entries
   didn't already cover.
4. **Production DB integrity checks** (nutrition/body/sleep) — orphans, null-rate anomalies,
   duplicates, implausible values, via `POST /api/admin/db-query` against the `claude_ro` schema.

Followed up on the DB integrity agent's most significant finding myself (future-dated rows) with
direct queries before writing it up, to confirm scope and whether it's still live.

## What turned up

Two passes came back clean: sync-push mirroring across the whole 40-commit range, and nutrition
production data. Five real findings, all queued with their own plan doc — full evidence in
[`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../../reviews/2026-08-03-cross-domain-bug-review.md):

- **Q-56 [devices][body][sleep]** — real sensor data landed on dates up to 5 days in the future in
  production. A 5-row batch written 2026-07-30; four rows self-healed as those dates arrived, one
  (2026-08-04) is still live and wrong as of this session. Root cause not identified —
  investigation-first plan.
- **Q-53 [workouts]** — two cache-staleness bugs in the phase-transition/prescription flow, the
  same bug class the project already fixed once this cycle (`/api/running-plan`, v1.246.0) but two
  new unfixed instances in a sibling flow.
- **Q-54 [workouts]** — a prescription-generation write race reachable via two different dedup
  keys for the same session, found by source-reading (not yet reproduced — that's step 1 of the fix).
- **Q-55 [workouts]** — a third unfixed instance of the bodyweight-1RM-as-kg bug this session's
  predecessor (v1.252.4) partly fixed — the fix was scoped to the two surfaces found then, and this
  is a third the fix didn't reach.

## What I did NOT do

No code changes. No fixes attempted — each finding got a plan doc and a queue entry for an
implementer session, per the backlog-driven-implementation split (`CLAUDE.md`). Did not attempt to
root-cause Q-56 beyond confirming its scope and blast radius; that's explicitly deferred to the
queued item.

## Verification

All findings are grounded in either a direct source-code read (file:line cited in each) or an
actual query result against production (`claude_ro`, read-only role). Nothing here is speculative —
where an agent's confidence was medium rather than high, that's stated in the review doc rather than
presented as certain.

No version bump — no user-visible change shipped this session.
