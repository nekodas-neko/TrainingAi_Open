# 2026-09-21 — BF-7 PR 2b (engine): the duration ladder takes minutes, and the labels were persisted

**Branch:** `lane-a/bf7-duration-minutes` · **Lane A** · the engine half of PR 2b. The control is
Lane B's and is unchanged.

## What the owner asked for

2026-08-23, verbatim: *"id like to have the ability to choose a 45min session - maybe we have a
slider - and the default one is shown - but have the option to to slide to 15/30/45/60/90options?"*
Then, settling the shape: *"yes I agree lets anchor to session; dont need 15minutes"*.

So: absolute minutes **around** the session's own configured length, which stays the anchor and the
default. 15 is dropped, which leaves `MIN_PRESET_BUDGET_MIN = 20` and the `WARMUP_CEILING_FRACTION`
arithmetic that meets it exactly untouched.

## Why this is Lane A at all

The entry's `Lane:` field says A; the plan labels the remaining PR 2b "Lane B". Both are partly
right and the path rule settles it: PR 2b widens `DurationPreset`, the prescription's default test,
and **the route's Zod schema** — `app/api/**` is Lane A — while the control is `components/**` and is
Lane B. Standing rule for a change that spans both: **Lane A first**. This is that half.

## The plan's cheapest claim is the one that was wrong

Its §5 is titled *"What makes this unusually cheap"* and says:

> There is no `duration_preset` column in the Postgres schema, in the local SQLite tables, or in
> `lib/local-store/types.ts` … **It also means the type can change freely: there is no stored value
> to be compatible with.**

The first sentence is true. The conclusion is not. **`durationPreset` is a field on
`AiPrescription`**, and an `AiPrescription` is stored whole in `session_periodization.prescription`.
Measured in production 2026-09-21: **10 of 10 stored prescriptions carry one.**

So the plan's step 1 — *"`DurationPreset` becomes `number`"*, with `DURATION_PRESET_DELTA_MIN`
*"deleted rather than left as a stale constant"* — would have made every stored prescription's
duration unreadable by the code that reads it back, and removed the only thing that knows what the
stored word means.

**What shipped instead:** `DurationPreset = number | LegacyDurationPreset`. A number is the canonical
form and an absolute request; the three labels stay legal because they are what is stored and what
older clients send. Both resolve in exactly one place, `requestedBudgetMin`, so nothing downstream
learns that two forms exist. `DURATION_PRESET_DELTA_MIN` survives with a changed job — it is the
legacy decoder now, not the ladder's step, and its comment says so and names the condition for
deleting it.

**The labels are RELATIVE and the numbers are ABSOLUTE, which is why this is a data change and not a
rename.** On a 60-minute session they agree, which is what makes it easy to miss. On a 45-minute
session `'short'` means 15 and the number `30` means 30. A test pins that disagreement.

## One more label test that had to become a comparison

`generate-prescription.ts` decided whether to override the budget with
`durationPreset !== 'standard'`. That was the same question as "is this the anchor?" only while the
single way to say "the session's own length" was that word. A number equal to the anchor means it
too and must produce no override. It now compares the **requested** budget against the session's —
the unclamped half, which is the trap PR 2a split `requestedBudgetMin` out for, extended to numbers.

## Verification

- **13 new tests**, plus the pre-existing `duration-presets.test.ts` passing unchanged (29 together).
  They cover the plan's own §6 list — the 45-minute session anchoring at 45 and expanding at 60, the
  anchor never expanding, the direction surviving the floor clamp — plus the persisted-label cases
  the plan did not think were needed.
- **Mutation pass, three mutations:**
  - a number read as RELATIVE (the bug the union exists to avoid) → **7 of 29 red**.
  - the labels dropped, exactly as the plan instructed → **16 of 29 red**, including the
    pre-existing suite. That is the plan's own step 1 failing loudly.
  - an equivalent restructure of the same early return (the deliberate control) → **29 green**.
- `npx tsc --noEmit` clean — the four Lane B component files still compile untouched, because the
  labels they send are still legal.
- `pnpm check:rules` — **Ran 75 of 75**, all passed. The route's new numeric field needed real
  bounds to clear *"Numeric validators carry an upper bound"*.

## Not exercised

- **No control yet.** Nothing in the UI can send 45 until Lane B's PR 2b ships; this half only makes
  45 expressible and correct when it arrives. BF-7 stays queued for it.
- **Not device-verified**, and nothing here needs an APK — TypeScript only, so it ships via Railway.
- **The bounds are a request guard, not the model's floor.** `MIN_PRESET_BUDGET_MIN` still clamps
  what is achievable; the schema's 1..1440 only stops a nonsense minute count reaching the planner.
  The floor is deliberately 1 rather than 20 so an under-floor request is clamped with its direction
  intact rather than 400'd.
