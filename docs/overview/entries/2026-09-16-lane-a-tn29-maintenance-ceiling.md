# 2026-09-16 — Lane A · TN-29: the maintenance estimate gets a ceiling it can be measured against

**Branch:** `lane-a/tn29-maintenance-ceiling` · **v1.457.4**

The app computes two independent maintenance estimates on every request and compared them never. One
comes from intake and scale weight; the other from resting rate plus measured movement. They fail in
unrelated ways, which is what makes the second a usable check on the first — and it was already in
the same function, as the fallback the calibration overrides.

For the owner on 2026-09-09: calibrated **2,245** against a measured-movement **1,895** — activity
factors of **1.67** and **1.41**. 1.67 is "hard exercise 6–7 days a week" for someone averaging 3,572
steps a day.

## The change is the mirror of a gate that already existed

`estimateMaintenance` already took the user's BMR as `minMaintenanceKcal` and **rejected** anything
below it — *a maintenance below resting burn is impossible by definition*. The same argument runs the
other way with better evidence: *a maintenance implying training the user demonstrably did not do is
impossible by measurement.*

So it now takes a `measuredMovementKcal` ceiling and rejects above it, with its own
`above_measured_movement` exclusion and message. **Rejected, never clamped** — the same rule the
floor follows, and for the same reason: clamping reports a number the data never supported, where
rejecting lets `resolveMaintenance` fall back to the formula baseline.

Keeping the reason distinct from `implausible_result` is deliberate and is pinned by a test. 2,245 is
a perfectly fine maintenance for *someone*; it is not one for this person, whose movement the app has
measured. A caller that lumped them together could not word the message honestly.

**One ordering change made it work.** `avgActiveKcal` sat *below* `resolveMaintenance` and was gated
on `source === 'calibrated'` — the very result the ceiling now bounds. It is hoisted above, ungated,
and the post-hoc `avgActiveKcal` reuses it.

## The number this entry deliberately did not settle

`MAX_MEASURED_MOVEMENT_RATIO = 1.15`. TN-29 says outright that the band width *"wants fitting against
more than one owner-month"*, so it is one exported constant with the reasoning beside it.

At the owner's 1,895 it rejects at 2,179 — so it rejects the 2,245 that prompted the entry and allows
about 15% for expenditure the step count cannot see (NEAT, thermogenesis, unlogged activity). **The
ceiling tracks the measurement rather than being a constant**, which is what stops it rejecting a
genuine training block: a real block raises the measured-movement estimate and the ceiling with it. A
test pins that — the same window refused at 1,895 is accepted at 2,400.

## BF-137: the general guard shipped, the specific fix is blocked on one date

TN-29 says to read BF-137 first and build the two together. BF-137's cause is different: the
estimator is fitting a **GLP-1 weight drop** and reading it as metabolic rate. Its recommended fix is
to exclude days after a known intervention start, keyed on `supplement_vials.opened_on`.

**Three findings, in order:**

1. **BF-137's `Needs:` says "nothing" while its body calls BF-136 "a prerequisite in fact if not in
   form".** Same prose-dependency shape as TN-31, fixed earlier today.
2. **BF-136 has shipped** (v1.446.2, 2026-09-10) — `opened_on` is user-settable now, bounded 180 days
   back and correctable in place. So the mechanism is buildable, and per the protocol an absent
   `Needs:` target counts as shipped.
3. **But the owner's data was never corrected.** Measured 2026-09-16: one vial — Retatrutide,
   `opened_on` = **2026-09-10, identical to its `created_at`**, the auto-set date BF-136 was filed
   about. BF-137's own measurement puts the first dose near **2026-09-04**. **An exclusion keyed on
   09-10 would leave the six confounded days inside the window** — the exact span driving 2,245.

So building it now would ship a filter that does not filter. BF-137 gains `Gate: owner` for a **data
correction, not a decision**: set that vial's *Opened on* to the real first dose, one edit, and the
entry is unblocked.

**What did land for BF-137:** TN-29's ceiling catches *this instance* — the 2,245 is refused because
the owner's movement cannot account for it. That is the instance, not the cause, exactly as BF-137
says, and the cause will recur on the next vial.

## Verification

- `pnpm test` **924 files / 8780 tests** green (with `DATABASE_URL` set). `pnpm check:rules`
  **75 of 75**. Typecheck and lint clean (0 errors).
- **Mutation pass, 5 mutants, all killed:** no ceiling, clamp-instead-of-reject, wrong exclusion
  reason, ratio widened to 3.0, ratio tightened to 0.9. **Equivalent control** (`>` → `>=` at the
  boundary, which these fixtures cannot distinguish) stayed green.
- Seven new tests, including two controls: an estimate *inside* the band must come out identical with
  and without the ceiling, and an absent/zero measurement must not reject everything.
- `pnpm dev`: `/api/nutrition/energy-balance` compiles and returns 401 unauthenticated.

**Not exercised.** The authenticated path never ran — the sandbox cannot mint a session — so nothing
here was observed changing a number on a real screen. No device. The production figures quoted
(2,245 / 1,895 / the vial date) are the owner's rows only (`claude_ro` is row-scoped), read through
the admin endpoint. Nothing is stored: maintenance is recomputed per request from a trailing window,
so **no history is re-scored** and the one written artefact — `nutrition_targets.calories` = 1,660 —
is untouched and still inside the honest band.
