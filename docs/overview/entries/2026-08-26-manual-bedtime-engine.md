# 2026-08-26 — Manual bedtime, the engine half (Q-519)

**Lane A · branch `feat/manual-bedtime-entry` · migrations 233 + 234 · no version bump (no UI yet)**

The owner forgot the ring and fitted it at ~4 am. The session reads 04:23–08:03, 3 h 5 m, and their
concern was narrow: *"I don't want it to change estimated bed time values."* One such night moves the
14-day bedtime mean by **~23 minutes for a fortnight**, and that estimate pre-fills bedtime
everywhere.

## The design changed, because the audit the entry commissioned falsified it

Q-519 proposed writing the remembered bedtime into `sleep_start` at `manual` rank and letting the
per-field merge leave the measured columns alone. That rested on an invariant the entry stated
itself, and warned about: *"if anyone later recomputes duration or efficiency from the span, this
silently produces a 9-hour night at 34% efficiency."*

**Something already did.** [The audit](../../reviews/2026-08-26-manual-bedtime-write-audit.md), run
before building and shipped separately, found `aggregateNight` deriving both from the span, the
daytime-HRV model classifying samples by window membership off **stored** rows, and `primaryCluster`
unioning same-date rows within an hour of the window. Reproduced in a test rather than argued: on the
owner's own night plus one fragment, the rejected design gives **10.0 h at 35%** where the measured
window gives **4.62 h at 75%** — same night, same 3.48 h of measured sleep.

So the value gets its own column. **The per-field merge exists to let a better *measurement* of the
same quantity win; a remembered bedtime is a different quantity**, and sharing the observed window's
column was the entire cause.

## What shipped

- **Migration 233** — `sleep_sessions.manual_sleep_start timestamptz`, with a column comment saying
  what may read it. **234** — the `claude_ro` regen (default-deny, so a new column is invisible to
  the audit endpoint until a view carries it); diffed against 232 and it is exactly the one column.
- **`setManualSleepStart(userId, date, at|null)`** — user-scoped, writes one column, **creates
  nothing**, returns `false` when no night exists for the date. A night with no measured sleep has no
  bedtime to correct, and inventing a row would put a duration-less session into every consumer that
  counts nights.
- **`POST /api/sleep/manual-bedtime`** — Zod-validated (`.strict()`, both date separators, since the
  client's `localDateString()` emits slashes), rate-limited, 404 rather than a silent success.
- **The `manual_bedtime` outbox domain** and its `pushMutations` branch, calling the same repo
  function as the route — the two paths cannot drift, and a mutation for a date with no night is a
  permanent 4xx, so it quarantines rather than retrying forever.
- **The local column** via `RECONCILE_COLUMNS`, **no version bump** (additive — the Batch F pattern
  every other sleep column uses), plus the pull mapping and the read.
- **`bedtime-estimate` reads `manualSleepStart ?? sleepStart`** — and it is the only read site in the
  codebase, which is the property the whole design turns on. It substitutes *after* `nightSessions`,
  so the aggregation still decides which rows are one night.

## Verification

Full suite against local Postgres: **628 files / 5,201 tests, exit 0**. `tsc --noEmit` clean.
`check-reconcile`, `check-local-column-upgrade-path`, `check-push-mutations`, `check-api-no-store` all
pass.

**Eight mutations, each with an asserted anchor.** Two survived the first pass and both were real:

- **Nothing covered the local pull at all.** Deleting `manual_sleep_start` from the applyDelta upsert
  changed no test — the exact sync-drift shape the standing rule names, where the server has the data
  and the device silently never sees it. Now covered both ways.
- **Counting placeholders does not catch a column-list skew.** Dropping a column *name* while keeping
  its `?` leaves placeholder count and params length agreeing, and only the column list short — so
  every value after it lands one slot to the left. The assertion now compares the column list against
  the VALUES arity.

## Not exercised

**On-device.** The local column arrives through `reconcileSchema` on a real device and no APK has run
— recorded as a `Keep:` on the entry. Nothing else here is device-dependent.

## What is deliberately not done

**The UI, which is Lane B's**, so nothing can write a bedtime yet. What it needs is on the entry: a
control to set and clear it, the POST, and a `queueMutation({domain: 'manual_bedtime'})` beside it so
the write survives offline. Whether a remembered bedtime should also *display* on the sleep card is a
separate question nobody has asked — the card shows the measured start today, and that is defensible.

Q-520 (the partial-night flag) stays parked behind this: the 3 h 5 m still reaches the sleep score,
readiness's `previousNight`, resilience and the Body Battery anchor. That was always its scope.
