# BF-199 — the prescription's numbers from rules, the model kept for the prose

**Status:** plan (docs-only PR 1).
**Entries:**
- `BF-199` becomes Phase 1: shadow and measure (Lane A).
- `BF-199b` is Phase 2: rules own the numbers (Lane A, `Needs: BF-199, BF-201`).
- `BF-199c` is Phase 3: represcribe with no round trip (Lane A, `Needs: BF-199b`).

**The owner's question:** *"Do we NEED ai for this? Can we do this through logic so its easy to prescribe
and represcribe"*.

## 1. Where things stand (measured in BF-199)

- **One model call in the pipeline** (`generate-prescription.ts`, `generateObject`). Everything else
  is already deterministic TypeScript: `reconcilePrescription`, `applyRoleSetPlausibility`,
  `fitToBudget`/`dropToBudget`/`expandToBudget`, and the role floors.
- **A rules prescriber already exists.** `buildRulesPrescription` (BF-198/RV-202) turns each
  exercise's progression style into sets/reps/pct/rest, fitted to the time budget. Today it runs only
  as the fallback when the model fails, and for BF-198's Full revert.
- **Sets** are 2 in all 33 stored tuples: the budget fitter decides them, never the model.
- **Reps and pct** follow a tight curve (12→66 % … 6→80 %, about +2.25 % per rep fewer): a table in
  effect.
- **Rest** is the one free model output: 23 distinct values from 68 to 300 s, where the styles say
  60/90/120/130/180.
- **Reliability is not the argument:** 35 of 35 calls succeeded, averaging 2.1 s and 3.6k tokens.
  The case is what the model adds, and represcribing being slow, online-only and fallible.

## 2. The design, and the one thing it deliberately does not decide

**Numbers from rules; prose from the model; phases measured before deciding.**

- **What the model contributes to the NUMBERS is replaced.**
  - Set count is already the fitter's.
  - Reps and pct come from a per-role rep target for the session's phase plus a rep→%1RM table.
  - Rest comes from the style's own `rest_sec`.
- **The `reasoning` prose stays generative,** and becomes optional and non-blocking. The numbers
  render at once and the prose arrives when it arrives, or never, with no effect on the plan.
- **Phase decisions (`phase`, `phaseAction`) are NOT moved blind.** Nobody has measured how often
  the model's phase survives `reconcilePrescription`. Phase 1 measures it; Phase 2 decides with the
  number in hand.
- **⚑ Not decided here: the rep→%1RM table's VALUES.** Those are the loads he trains at, so they are
  calibration. `BF-201` decision 2 is with Tuning, which proposes candidate tables with how many past
  sessions each moves and by how many kilograms, and then the owner signs. The recommended default is
  the observed curve above, so the switch changes nothing on day one; a textbook table would
  re-weight every session the day it shipped.

## 3. Phases

### Phase 1 — shadow and measure (`BF-199`, Lane A). No user-visible change.

1. On every normal prescription, also compute `buildRulesPrescription(signals, …)` and record the
   per-exercise difference against the reconciled model output: sets, reps, pct, rest, and whether
   the phase and `phaseAction` were changed by reconciliation. Store it on the `ai_call_log` row's
   metadata (no new table), or in a small JSON column if that row cannot hold it; decide when
   building.
2. A read-only admin replay (TN-56's endpoint shape) that summarises it over N days:
   - the share of exercises where rules equal the model on reps and pct within 2.5 %;
   - the rest distribution for each;
   - **how often the model's phase survived reconciliation** (the §2 open question).
3. **Done when:** two weeks of his sessions are recorded and the summary is readable.

### Phase 2 — rules own the numbers (`BF-199b`, Lane A; `Needs: BF-199, BF-201`)

1. A **phase → rep target per role** table (accumulation / intensification / realisation /
   deload × primary / secondary / accessory), seeded from the observed distribution and **stated
   with its source**.
2. pct from the signed-off rep→%1RM table (`BF-201` decision 2); rest snapped to the style's
   `rest_sec`.
3. The numbers path no longer calls the model. The prose call is fired after the plan is stored and
   patched in when it returns. A failure leaves the plan untouched.
4. The phase logic follows Phase 1's measurement. If the model's phase rarely survives
   reconciliation, the schedule and volume rules already decide it and the model's phase input is
   dropped. If it often survives, it stays as the one advisory model output, and the numbers still
   come from rules.
5. **Done when:** a replay over his history reproduces the stored sets/reps/pct within the stated
   tolerance, rest lands only on style values, and the Full toggle is a re-evaluation (BF-198's
   stored-numbers workaround can retire).

### Phase 3 — represcribe with no round trip (`BF-199c`, Lane A; `Needs: BF-199b`)

1. Represcribing (a duration preset, Full versus deload) re-runs the rules on the device from the
   signals already on the client, or from one cached signals payload. There is no model call and no
   502 path, and it works in BF-195's low-reception case.
2. **Done when:** the device represcribes offline; this needs a Lane DV check.

## 4. Why not the alternatives

| | Better at | Lost because |
|---|---|---|
| Constrain the model harder (enumerate rest) | Keeps whatever adaptive judgement it has; a one-schema change | Still a 2 s online round trip per represcribe, which is the owner's actual complaint |
| Rules plus the model as a second opinion on numbers | Keeps a "this looks too hard" check | Two sources for one number, the shape One Formula, One Place forbids, and it keeps the network dependency |
| Leave it | Free today | BF-198, BF-189 and represcribe cost all trace to the same non-determinism |

**Reversal cost: moderate.** Phases 1 and 2 are reversible behind the existing route (the model path
still exists until Phase 2's switch). Phase 3 is one-way in practice, because instant represcribing
does not go back to 2 s gracefully.
