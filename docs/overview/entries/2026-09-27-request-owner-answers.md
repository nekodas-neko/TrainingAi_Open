# 2026-09-27 — eleven owner decisions answered in one sitting, and five traps found on the way

**Branch:** `request/owner-answers-2026-09-27` · Orchestrator

The owner asked for a single bulk prompt to unblock the lanes. All 22 `Ask: owner` entries were
read first; twelve were genuine decisions and were put to him in three rounds of four, each with a
recommendation first. Eleven came back. This is what they were and what moved.

## Answered

| Entry | Answer | Now |
|---|---|---|
| `TN-78` | A moderate minute starts at **40% HRR** (107 bpm), not 60% (134) | Lane A |
| `RV-161` ① | **Run `rederive-baselines`** — dry-run then run | Releases BF-13, TN-6, Q-506, TN-8, TN-42 |
| `TN-67` / `Q-72` | **Outlier-only** rating prompt; he will not rate daily again | Lane B |
| `LB-153` | **Merge all three palettes**, workout set colours included | Lane A |
| `LB-164` | **No** — the Coach button stays iconic | Entry removed |
| `LB-159` | Meal plans **default to the saved library** when it is non-empty | Lane B |
| `LA-136` | **Yes** to a Home sleep line from `sleepQualityFeel` — **mockup first** | Lane B |
| `RV-218`/`RV-164` | He rejected the premise: **one number**, = RMR + live activity ± goal deficit | `OR-191` |
| `BF-207`+`BF-209` | Redesign `/collection` — **after `PS-49`** | Lane B, `Needs: PS-49` |
| `TN-80` | **Security review on #1607, then he reads it.** No agent merges it | Lane O |
| `BF-201` ① | Size the finish-early margin to his **75th percentile** | Lane A |

`Q-30` was deferred, with a steer that is nearly an answer.

## The answer that was not on the menu

Offered three calorie numbers on his screen — the ring's 1,534, a goal of 1,660, a budget of 1,356 —
he took none of them: *"I just want one number the correct one - the one thats rmr + live activty
+/- deficit for weight goal"*. That is a formula, and **none of the three computes it** (the ring's
1,534 has the right inputs with no deficit applied). Filed as **`OR-191`**, Lane A, blocked on one
line from him: whether the 09-14 recommendation of 1,618 kcal was meant to replace the 1,660 the app
still budgets.

The lesson for the next brief: three numbers to choose between is not a decision, it is a menu.
He was asked which existing thing to show and answered what it should mean.

## Five traps found while writing the answers in

1. **My own prose set a field.** The bullet *"the run is the device agent's (`Lane: DV`)"* re-laned
   `RV-161` to DV — first-match-wins reads inside backticks. The same class CLAUDE.md already
   records for `Lane: T`, hit again within a day of writing it down.
2. **`BF-201` was parked by a `Needs:` line that said it wasn't.** Its own text read
   *"**Needs:** — nothing, deliberately. **Neither lane is blocked on this.** BF-197's … BF-199 …"* —
   and the parser took the two ids out of the prose after the dash. An entry declaring itself
   unblocked was unreachable in both lanes. Reworded to carry no `Needs:` field at all.
3. **`RV-161` item ④ was stale.** It asked for a decision on Q-527's corrupt 07-29 row; that was
   **approved 2026-09-25**, two days before. Corrected rather than re-asked — the owner would have
   been asked twice for the same answer.
4. **`RV-213` was `Gate: owner` with a mockup owed and no mockup drawn**, so the gate parked the
   entry and nobody was tasked with drawing it. The exact inversion `LB-163` documents. Ungated.
5. **`Q-30`'s retention question would have died inside a parked entry**, so it is split out as
   **`OR-192`** — ungated Lane O, with the measurement that has to precede re-asking him.

## Also reconciled

`TN-80` routed three GitHub items that **BugFix has since filed properly** as `BF-211`/`BF-212`/
`BF-213` — and `BF-213` carries a finding `TN-80` does not have: **inbound PR #1608 takes migration
numbers 288/289 that `main` already used**, and the collision destroys its `claude_ro` twin. Those
three are now the live record; `TN-80` is routing history and is struck once the #1607 security
review is posted.

## Not done

- **`BF-201` decision 2** — the rep→%1RM table — was dropped for room and is still owed.
- **`RV-161` ⑤**, PS-17's queue position, likewise.
- Gates at close: `Ran 82 of 82` Custom Rules, `check-doc-links: OK (879 files)`,
  `check-backlog-pointers: OK — 545 entries`. **No code changed, so no runtime surface was
  exercised and none needed to be** — this PR is documentation only.
