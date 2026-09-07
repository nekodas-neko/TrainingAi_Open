## 2026-09-07 — Wear time: a complete day overwritten by the sliver the rollup window left of it (PS-30)

**Branch:** `fix/oura-nonwear-overwrite` · **Lane A**

### What was wrong

`oura_daily.non_wear_time_sec` recorded the ring worn 15–90 minutes on **22 consecutive days**
(2026-08-14 → 09-04) that each carry a 7–10 h scored night with HRV — physically impossible. The
backlog entry (PS-30) filed the mechanism as *not established*, and two of its details were off:
the span is 22 days ending **09-04**, not 20 ending 09-02, and the column lives in `oura_daily`,
not `oura_daily_summary`.

### The mechanism

`wornBinsByDay` is built only from the raw frames inside the run's window, but a wear row is
written for **every** day that has at least one bin — including the day the window floor lands
part-way through. An incremental run's floor is `effectiveSinceDs − 3 days`, which is a wall-clock
instant, not a midnight, so that day contributes only the frames after it. Because the floor
advances monotonically, that partial write is also the **last** write the day ever receives.

Three pieces of production evidence pin it, none of which needed a code read:

- Every bad day's `synced_at` is **exactly the 3-day margin after its own date** — 08-14 last
  written 08-17T20:03Z, 09-04 last written 09-07T14:20Z, and so on for all 22.
- The stored non-wear values are all `86400 − n × 900` for **n = 1…6**: whole 15-min bins, 15 to
  90 minutes, which is the sliver between a late-evening floor and midnight.
- The two edges are the same fact, not two. On the left, 08-05→08-13 all share one `synced_at`
  (08-17T07:50:13.919Z) — a single full pass that repaired them and then left them permanently
  outside the 3-day window. On the right, 09-05→09-07 share 09-07T16:38:32.683Z: they are simply
  **not yet three days old**. The fault had not stopped; 09-05 was one run away from being
  clobbered like the rest.

### What shipped

`lib/oura-ble/rollup/run.ts` drops the day containing `rollupCutoffDs` from `wearRows`, unless the
cutoff falls exactly on that day's local midnight (where the day *is* fully covered and the run may
be the only one able to write it). Nothing else is dropped: earlier days have no frames in the
window, and the two runs before this one already wrote the floor day in full, so the day keeps a
complete value rather than losing one.

`lib/data/postgres/__tests__/oura-ble-wear-window-floor.test.ts` seeds an unbroken on-finger frame
per 15-min bin across four fixed days and runs the rollup with a floor at 22:00 on the middle day.

### Verification

- New test: 3/3 against local Postgres. **Mutation-checked both branches** — removing the filter
  fails with `expected 79200 to be +0`, which is the production signature exactly (8 bins = 2 h);
  removing the midnight exemption fails the third case with `"no row"`.
- Neighbouring rollup suites (incremental-window, sleep-fallback, aggregate, daily-summary,
  step-rollup, spo2-daykeying): 28 passed, 1 skipped.
- `pnpm check:rules` — **Ran 68 of 68**, all passed. `tsc --noEmit` clean, ESLint clean.

**Not exercised:** on-device. This is server-side rollup code reached through Railway, so no APK is
involved, but the fix's effect is only observable on the next real BLE ingest — nothing here was run
against the ring. The corrective for the 22 stale days was **not** shipped (below).

### Deliberately not done

The 22 days stay wrong. No incremental window reaches back that far again, so only a **fullHistory**
Redecode rewrites them — and that needs an admin session, which this environment does not have. The
alternative, a migration nulling the column for those dates, is data-dropping under the standing
rule and would leave a gap where a Redecode restores the real numbers. Filed as **LA-68**,
`Gate: owner`, with the exact console action.

### Docs

`docs/oura-ble-operations.md` §1 gains failure row **I29**. Backlog: PS-30 removed, LA-68 added.
`projectOverview.md` carries a Known-Issues row for the stale span until the owner's Redecode.

**Version:** 1.436.36 (patch).
