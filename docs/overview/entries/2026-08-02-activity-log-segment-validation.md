# 2026-08-02 — a guided walk could never sync (Q-36)

**PR:** #987 · **Branch:** `fix/activity-log-segment-validation` · **Version:** 1.249.5

## What was wrong

`computeWalkSegmentStats` rounds segment means to 1dp (`lib/walk/segment-stats.ts:23`), so a
segment mean HR of `130.5` was routine. `WalkSegmentStatSchema.avgHr` was `z.number().int()`, so a
single fractional mean rejected the **entire** `activity_logs` payload — on the web route and the
`pushMutations` branch alike. The walk retried five times and dead-lettered in the outbox.

The owner reported two symptoms that turned out to be one bug: a "1 change failed to sync" card,
and a walk missing from the training calendar. `getCalendarData` reads `activity_logs` from
Postgres, so an activity that never synced structurally cannot appear there.

## What shipped

Both ends, and the order is the point:

- **The schema was relaxed** (`.int()` dropped from `avgHr`/`maxHr`/`hrAtStart`). This is what lets
  the payload *already frozen in the device's outbox* drain. Rounding alone would have stranded it
  forever.
- **HR is rounded to whole beats at source** via a new `avgWhole()`, keeping new payloads clean.
  It is separate from `avg()` because `avg()` is shared with `avgCadenceSpm`, where a decimal is
  meaningful.
- **The push path now names the failing field.** A rejected mutation surfaces only the message we
  attach, and `Invalid activity_logs payload` cost a full session to trace to `segments[0].avgHr`.
  `describeZodFailure` (`lib/data/postgres/push-error-detail.ts`) appends the path and reason,
  capped at 200 chars for the sync-health card.

`maxHr`/`hrAtStart` also lost `.int()` despite being whole today — they share the JSONB column and
the same `number | null` type, and leaving one in place would preserve the identical
whole-payload-rejection trap for a future change.

## Verification

Full suite 366 files / 2820 tests green. Exercised against `pnpm dev` + local Postgres as the
seeded user: `POST /api/activity-logs` with `segments[0].avgHr = 130.5` → 201 with `130.5`
persisted in the JSONB; the same payload with `avgHr: 0` → 400, so the plausibility guard still
holds. The change widens the numeric *type*, not the accepted range.

**Not verified on device.** The actual drain of the stranded outbox row can only be confirmed there.

## Gotchas for the next session

- **The plan said to *create* `lib/walk/__tests__/segment-stats.test.ts`. It already existed with 6
  tests.** Following the plan literally destroys them. This PR appends (33 additions, 0 deletions).
  Fixed in the plan doc? No — flagged in the PR body only.
- **First full-suite run showed 2 failures** (`oura-ble-sleep-fallback`, `push-mutations-web-parity`),
  both `beforeAll` hook timeouts. That is the documented DB-connection oversubscription flake; both
  pass in isolation and the re-run was clean. `push-mutations-web-parity` was re-run specifically
  because this diff touches `pushMutations`.
- **`node_modules/@trainingai` was not linked** in a fresh container, so every test importing the
  shared package failed to resolve. `pnpm install --frozen-lockfile` fixes it. This is not a repo
  fault but it looks like one for a few minutes.

## Owner action outstanding

**Tap Retry on the sync-health card** after this deploys. A dead-lettered row is not re-attempted
on its own; once it drains the walk should also appear on the training calendar.

## Follow-ups already queued

Q-3c holds four findings from this investigation in the same "one bad field kills the whole
activity" class — including `distanceKm: z.number().positive()` rejecting a legitimate
zero-distance GPS activity, which is the identical failure mode this PR fixed for HR.
