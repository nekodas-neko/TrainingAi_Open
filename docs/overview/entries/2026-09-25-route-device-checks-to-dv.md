# 2026-09-25 — route the device checks the DV agent can actually answer

Owner instruction: *"Make sure anything that can be done by DV agent is assigned to it. I shouldn't
need to do device checks are possible by DV."* Docs-only: field changes and notes on existing
entries, no new backlog entry.

## The honest size of it: one reassignment out of twelve

Twelve entries sat in `--sittings` as blocked on a device check. Reading each one's *next action*
rather than its gate, only one was genuinely the device agent's:

**`OR-162` → `Lane: DV`, ungated.** Its own text says what it needs: *"count
`document.querySelectorAll('canvas')` per panel, then attribute."* A measurement nobody has taken,
objective result, runnable over the DevTools protocol with nobody looking at anything. It carried
`Lane: B` + `Gate: device`, and the gate is what parked it into the owner's list. Removed rather than
kept beside the lane, because `Gate:` parks. The fix stays Lane B's once the count exists. It is now
top of DV's READY list.

## Two whose check is DV's, without changing the lane

- **`DV-12`** — `Lane: B` is right and `Gate: device` is right, because the check must follow the fix.
  What was never said is **who runs it**. `perf.js longtasks` under 50 ms is a number, not a look, so
  it should never consume an owner sitting. Noted, with instruction to run it in the same sitting as
  OR-162 — same screen, same batch.
- **`Q-34`** — its reachability half (*"tapping through from the sleep tile"*) either reaches the
  staging data or does not: a navigation reproduction with a yes/no answer, and it was on the owner's
  checklist. Its SpO₂ half turned out to be **wrongly posed**: `spo2Var` is not a stored column at all,
  it is computed per epoch in the rollup, so "is the debug column populated" has no referent.
  `oura_bucket.spo2_pct` is empty (0 rows), which is suggestive and **not decisive**, because the
  stager reads from the rollup's own accumulator. Tracing that source is a read, not a sitting.

## Nine correctly not DV's, and why — so nobody re-routes them

| entry | why the phone is involved but DV is not next |
|---|---|
| `Q-545` | Tasks 3/4/6 end in objective comparisons, but **the device half does not exist yet** — its own text says so. Next action is Lane A code. Trap (a). |
| `Q-418` | What remains is Kotlin and a new APK. CLAUDE.md names this entry as the example of trap (a). |
| `PS-8` `PS-9` `PS-12` `PS-16` | Colmi R09 hardware, not the S25 — and PS-16 records the ring being with a second wearer. |
| `Q-114` | Needs a capture of real weight-stabilisation time, i.e. the owner on a scale. His body, not DV's. |
| `Q-388` | Needs an overnight worn-ring drain reading on the current APK. |
| `PS-7` | DV could run the pose-landmarker probe, but Lane A has to build it first; owner placed it at the tail as *"a good future move"*. |

## One thing flagged and deliberately not changed

`Q-545`'s `Gate: device` parks work whose next action is Lane A code — the `DV-12`/`RV-166` defect in
reverse. Whether Lane A can meaningfully start the model-session injection from a sandbox is a
judgement about the entry's substance rather than a routing call, so it is recorded for the
Orchestrator and left alone rather than re-laned by a Tuning session reading it from outside.

## Not exercised

Docs-only; nothing ran. No device involved, and no entry was re-routed on the basis of a gate field
alone — each was read for its next action. The `oura_bucket` count is a `claude_ro` read and therefore
the owner's rows only, which is why it is offered as suggestive rather than as an answer.
