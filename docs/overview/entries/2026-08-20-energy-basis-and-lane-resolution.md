# 2026-08-20 — Q-421's last Lane A clause, and a queue that was routing an entry to the wrong lane

**Branch:** `feat/migration-replay-check` → the work turned out to be Q-421's remainder · **Lane A**

## Q-421 was almost done, and nobody had added it up

Re-verifying the premise before starting is what settled it. Route **(a) shipped** 2026-08-19. Route
**(b) is owner-rejected** — *"I dont want to use oura models"* — and is retained on the entry as the
record of why, not as work. That left one clause: *"store which basis was used and label it."*

**Half of the storing was already done today** by Q-331 — `estSessionKcal` returns
`source: 'hr' | 'met'` and `GET /api/workout-sessions/[id]/energy` returns it. The other half was
missing: `computeActiveEnergy`'s `workoutKcalBySession` carried `{ id, kcal }` and nothing else, so
the day's per-session figures could not say which estimator produced them. That is now
`{ id, kcal, source }`.

**Why it matters, and why it is permanent.** 42 of the owner's 78 completed sessions carry an
`avg_bpm`; the rest never will, because the strap is not always worn. So two sessions side by side on
the same screen are routinely produced by two different formulas whose outputs overlap rather than
agree. Labelling that is a UI decision, and Lane B's — so **Q-421 is retagged `Lane: B`** and reduced
to the label, keeping its number and its record rather than being deleted.

The new test is meaningful under the scrubbed fixtures, which most tests here are not: the HR path is
pure arithmetic and needs no MET table, so `with-strap → 'hr'` has a non-zero estimate where the MET
session is 0.

## The retag did not take, and the reason was a live defect

`next-item.js` matched the first `Lane A`-shaped string in an entry's body. Q-421's shipped-banner
says *"(Lane A)"* twenty lines above its tag, so the retag was ignored.

**It was not only my entry.** Q-529 — *"a provisional sleep score is displayed as final"* — says
`**Lane:** B` and had been served to **Lane A's** queue for days, because fourteen lines earlier its
own body says *"Re-scoped from Lane A to Lane B."* The prose won.

**The obvious fix is wrong and measuring said so.** Requiring the colon would unclassify **75 of 205**
entries: the bare form (`**Lane B**`, `— Lane A`) is the dominant convention, not an accident. So both
forms are still read, and the **field form wins wherever an entry has one** — prose can no longer
outrank a tag. Extracted to `scripts/lib/lane.js` with 6 tests, mutation-verified.

## The near-miss worth recording

The first version of that fix **hid 96 of 203 entries from both lanes at once**. An entry that states
no lane defaults to `null`, which the filter reads as *visible to both*; my line overwrote it with
`undefined`, which reads as neither.

Nothing failed. `pnpm check:rules` was green, the two entries I was targeting moved correctly, and the
only signal was that READY fell from 149 to 53 — **further than a two-entry fix could explain**. That
gap is the whole detection. A queue tool that silently narrows its own output has no other tell.

## Measured

| | before | after |
|---|---|---|
| Q-421 in Lane A's READY | yes, position 1 | no — retagged B |
| Q-529's lane | **A** (from prose) | **B** (from its field) |
| Lane A entries visible | 149 READY | 148 READY |
| entries hidden from both lanes | 0 | 0 (the near-miss above: 96) |

`tsc` clean · `pnpm lint` **0 errors** · **Ran 51 of 51** Custom Rules steps · `pnpm build` clean ·
full suite green.

## Not exercised

Nothing user-facing shipped. The `source` field is now carried on the day's breakdown but **nothing
renders it yet** — that is Q-421's remaining Lane B half, and until it lands the field is stored and
unused. No device surface, no schema, no migration.
