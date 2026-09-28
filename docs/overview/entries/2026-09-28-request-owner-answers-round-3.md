# 2026-09-28 — eight more owner answers, and three of them refused the question

**Branch:** `request/owner-answers-round-3` · Orchestrator

Eight decisions put to the owner in two rounds. Five were straightforward; three replaced the
question with a better one.

| Entry | Answer |
|---|---|
| `LA-126` | Delegate the tap to Device Verification — **and the tap should not exist** |
| `BF-137` | **Refused the date.** Make the estimator supplement-agnostic instead |
| `Q-4` | Wearing the Polar H10 tonight |
| `Q-222` | Add confirm/reject to a detected activity |
| `LA-61` | Normalise on the way in, plus the functional index |
| `LA-65` | Five exercises fit the hour — **and he wants mixed set counts** |
| `RV-119` | Redraw the lost Home-banner mockup and re-approve |
| `RV-161` ⑤ | PS-17 moves up. Entry fully closed |

## `BF-137` — the date was the wrong question, and the data already exists

He refused to supply the GLP-1 vial start date: *"Try incorporate supplements usage with other
factors. We want it to be supplement agnostic essentially."*

**Checked, and it is buildable from what is already stored.** `supplement_logs` (`schema.ts:1149`)
holds a dated log per intake with a `doseText` snapshot — kept deliberately so that titrating
2 mg → 4 mg does not rewrite history. That is exactly the series a maintenance estimator needs:
what, at what dose, from when. And `grep supplement` across `packages/shared/src/health/**` and
`lib/health/**` returns **nothing** — the estimator cannot see any of it.

So the entry was blocked since 2026-09-16 on a date that was derivable the whole time. Re-laned
`T`: it changes a computed number he reads daily, so a Tuning proposal comes first.

## `LA-126` — a target the app can compute should not wait on a tap

He delegated the tap to the device agent, **explicitly overriding this entry's own line** that
nobody may run it for him. Recorded as his authorisation rather than as an agent deciding it was
acceptable.

His second sentence is the larger one: *"this should be calculated by us rather than manually
set."* Filed as **`OR-201`**, and it is the same change `OR-191` asks for from the other end — a
number defined by a formula cannot also be a number he sets by hand. Building either alone leaves
the contradiction standing, so they work together.

## `LA-65` — the answer closes the entry and opens a requirement

Five exercises are fitting the hour *"at 2 sets per one"*, so the two errors that cancel at five
are doing no harm and the constant stays. The entry becomes a `Reference:` whose job is stopping
someone "fixing" them into the overrun he originally reported.

His second sentence — *"might need to mix and match to get 3 sets where needed"* — makes the
sessions non-uniform. **Checked before filing:** `duration-model.ts` costs time per **set**
(`SET_SETUP_SEC`, `SECONDS_PER_REP`), not per exercise, so mixed counts price correctly with no
change. What is **not** established is whether the prescription generator will actually produce
them, or whether BF-128's "five exercises" carries an implicit uniform-2. Lane A's to verify. It
also raises the stakes on `BF-201`'s p75 margin, since a 5×3 session is materially longer than a
5×2.

## Still owed

The `RV-119` redraw is the Orchestrator's next piece of work. `Ask: owner` is **21 → 13**.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.
