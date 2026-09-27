# 2026-09-26 — BF-198: `Full` cannot override a whole-session deload

Owner, on a Saturday Upper showing *"AI Prescription · Deload"* with `Full` selected:
*"How am I supposed to select a full workout when the prescription is deload?"*

**He cannot, and the card is right to say so.** `Full` works by reverting each exercise to the
`preDeload` block the prescription recorded. The whole-session deload builder stamps `deloaded: true`
on every exercise and **never writes that block**, so there is nothing to revert to and the toggle is
inert by construction.

Both shapes are live in his own data (`session_periodization`, six most-recent):

| session | `deload` | deloaded | with `preDeload` | `Full` works? |
|---|---|---|---|---|
| **Upper (screenshot)** | true | **5 of 5** | **0** | **no** |
| Pull | true | 5 of 5 | 0 | **no** |
| Lower (earlier) | true | 1 of 5 | **1** | yes |

A whole-session deload always produces the dead toggle; a per-exercise one never does; and nothing on
screen distinguishes them before he presses it.

**The remedy the card names does not exist.** It says *"you would need a new prescription for that"* —
but `PrescribeBodySchema` is `.strict()` and takes only `excludeSessionId` and `durationPreset`.
Intensity is not an input on that route, so regenerating re-derives the same deload. The card is
honest about the first fact and wrong about the second.

**The cost that is worse than the dead toggle:** loading the bar heavier anyway does not help, because
`ex.deloaded` stays true on all five, and the PR gate requires `!ex.deloaded`. A genuinely full session
would be recorded as a deload and earn no 1RM credit, invisibly.

**Recommended fix:** have the session-level builder record `preDeload` as the per-exercise path already
does — four fields it is holding at that moment, no route or schema change, no LLM call, works offline.
Filed `Lane: A`.

Left undiagnosed and flagged: `deloadReason` is NULL on all six stored prescriptions, so nothing can
say *why* the session was deloaded — worth its own look, since an unexplained deload is the one a
lifter overrides.
