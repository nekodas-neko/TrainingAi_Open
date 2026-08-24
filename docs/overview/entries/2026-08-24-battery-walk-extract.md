# The Body Battery walk is now a pure function, so TN-2's offset can be fitted (refactor)

**Branch:** `refactor/battery-walk-extract` · **Lane A** · enabling step for TN-2

## Why

TN-2 replaces Body Battery's charge-window offset — the reserve fraction has become structurally
unreachable as the owner's fitness improved, so the tank only drains. Its entry is explicit that the
offset **"must be fitted, not taken from this entry"**, and specifically *"against the shipped
TypeScript with the stress term included, not against [the SQL replay] table"*.

That was not possible. The integration loop was inline in `buildBodyBattery`, a ~200-line async
function that also does eight DB reads, anchor resolution and the daytime-stress fit — so the
arithmetic could not be driven without a database, which is why the only evidence so far is a SQL
re-implementation agreeing with stored values to 13 points mean absolute error. Good enough to
propose with; not good enough to calibrate against.

## What shipped

`packages/shared/src/health/body-battery-walk.ts` → `walkBodyBattery(samples, params)`, lifted
verbatim. **No behaviour change** — the route now calls it and uses the returned totals.

The constants stay declared in the route and are passed in, rather than being re-declared in the new
module. The route remains the one place they are chosen, so the extracted function cannot silently
drift from them.

## What this sets up, and why it is only a substitution

TN-2's change lands entirely in one parameter. `restThreshold` is a reserve fraction, so an explicit
bpm offset above resting HR is `offsetBpm / reserve` — nothing else in the walk moves. Two tests pin
that, so the calibration PR's diff is a constant and a `MODEL_VERSION` bump rather than a rewrite:

- the ceiling sits at exactly `restingHr + offsetBpm` for reserves of 80, 100 and 137;
- and it is **immune to `hrMax` re-estimation**, which the fraction form is not — reproducing the
  2026-08-05 step (hrMax 187 → 168) and showing the fraction-form ceiling moves while the offset
  form's does not. That is the whole mechanism TN-2 is fixing, now under test.

## Verification

15 unit tests in `packages/shared/src/health/__tests__/body-battery-walk.test.ts`, every expected
value **hand-computed from the formula** rather than captured from a run — a golden-file capture
would happily bless a regression. They cover charge, the charge-neutral boundary (the two branches
meet at zero rather than stepping), drain, the `hrr` clamp, gap-hold, the per-sample dt cap,
pre-wake filtering, zero-dt, stress drain and its book-keeping, positive-stress being ignored, and
both bounds.

One of them documents why TN-4's guard is safe: a null stress lookup is arithmetically identical to
having no stress series at all, which is exactly the state a failed stress build leaves behind.

- All 5 body-battery route test files (18 DB-backed tests) pass unchanged — that is the behaviour
  -preservation evidence, since they exercise the real walk end to end.
- Full suite: 4712 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` in this
  sandbox).
- `pnpm check:rules` — Ran 55 of 55.
- `tsc --noEmit` clean.

## Not exercised

**No production data was replayed and no calibration was changed here** — this is the refactor only,
and `MODEL_VERSION` is deliberately untouched, so nothing re-scores. The fit itself is still TN-2's
work, and still needs the stress term reproduced offline (the dHRV model, its baselines, and the
temp/met signals, which come from decoded raw BLE frames).

Not run on device; `pnpm dev` unavailable in this sandbox (missing `@sentry/nextjs`).
