# Review — 2026-08-18 · the AI Coach's write path

_Lens: **the one surface no review has ever covered.** The Coach appears in eight prior review docs
and five backlog entries — all about cost, latency, model ID and navigation. **No review document
mentions `coach_changes`, `applyCoachChange`, or the pending-change/undo mechanism**, verified by
grep across `docs/reviews/`. It is also the only place in the app where an LLM-initiated flow writes
to the data that decides what the user is told to lift._

_Findings: **Q-467, Q-468**. The apply path itself came back **clean** and is some of the most
carefully built code in the repository._

## What the Coach can write

`lib/coach/domains/` holds five handlers: `session-exercise`, `goals` (nutrition targets + user
goals), `injury`, `program-phase`, `early-deload`. So an accepted Coach patch can swap or remove an
exercise from a programme session, change calorie/macro/step/water goals, record an injury, move the
programme phase, and start an early deload — all inputs to what the app prescribes next.

## Method, and what it does not establish

Live against `pnpm dev` on the seeded local Postgres, as two authenticated accounts. Real patches were
POSTed to `/api/coach/apply` and the resulting `session_exercises` and `coach_changes` rows read back
from Postgres after each step. Reachability claims were established by enumerating **every** client
fetch to an `/api/coach*` path across `app/`, `components/` and `lib/`, excluding the route handlers
themselves. The local DB was restored afterwards.

**What this does not establish.** The **web** build only — no device path. **The model was never in
the loop**: every patch here was hand-written, which is the correct way to test this path (the design
deliberately keeps the model out of it, see below) but means nothing here says whether the model
*proposes* good patches. Only `session_exercise` was exercised end to end; the other four handlers
were read, not driven. `/api/coach/preview` was not probed.

---

## Q-467 — the Coach can change your programme and nothing in the app can undo it

**Severity: medium-high. A complete, working undo subsystem with no caller.** `[app-shell][workouts][platform]`

Everything needed to reverse a Coach change exists:

- `POST /api/coach/apply/[id]/undo` — auth-gated, rate-limited, ownership-scoped, with a
  **thoughtfully designed window guard** ("until the next workout started after the change", with a
  written rationale for why a clock-based window would be wrong).
- `undoCoachChange()` in `lib/coach/apply.ts`, with a double-undo guard.
- An `undo()` handler in **all five** domain modules.
- `captureBefore()` in each, existing solely to make undo possible — including a documented fix for a
  past bug where restoring the display name without the `exercise_id` FK left the row inconsistent.
- A `coach_changes.undone_at` column.
- `components/coach/coach-history.tsx` already **styles for undone changes**: strikethrough, muted
  colour, and a "· undone" suffix.

**Nothing calls it.** Every client fetch to a Coach endpoint, enumerated:

```
/api/coach            /api/coach/threads      /api/coach/preview
/api/coach/apply      /api/coach/options
```

`/api/coach/apply/[id]/undo` appears in **no** client file. `coach-history.tsx` renders the change
list read-only — there is no Undo button, and no other component references the path. So the
strikethrough styling can only ever render for a change undone by something outside the app.

**This is not the known "no user-facing entry point" note.** `docs/implementation-backlog.md` records
that the Coach's **phase 1** shipped its apply path deliberately without an entry point, and phases 2
and 3 then added the route and the write domains. Apply *is* wired now — `change-preview.tsx`,
`number-dial.tsx`, `confirm-content.tsx` and `lib/coach/pending-change.ts` all POST to it, and it
works (verified below). **Undo was never wired with it.** The asymmetry is the finding: the write half
shipped, the reverse half did not.

**Why it matters at this severity.** The user is asked to approve a change per row, which reasonably
implies it is reversible; the history screen then shows the change with styling that implies undo
exists. The only route back is to re-open the Coach and ask it to change the thing back — which is a
*new* change against current state, not a restore, and which for `early_deload` or `program_phase`
may not be expressible at all.

**Fix shape:** wire an Undo control into `coach-history.tsx` for changes that are not `undoneAt` and
still inside the window, and handle the route's 409 ("you've trained since") as a first-class state
rather than an error. **Do Q-468 first or at the same time** — wiring the button onto today's undo
would ship the defect below. **Lane B** for the control; the route already exists.

---

## Q-468 — `undo` restores its captured state without checking the target still holds what the change set

**Severity: medium, latent until Q-467 is wired — and it is exactly what Q-467 would expose.**
`[workouts][platform]`

`applyCoachPatch` refuses to write over a moved target: every domain runs `driftAgainst(...)` and
returns `stale` → **409 with a per-field drift report**. `undoCoachChange` has no equivalent. It reads
the stored `beforeState` and writes it back. The route's guard asks *"have you trained since?"*, not
*"has this row changed since?"*.

**Measured, entirely within the Coach's own flow — no external edit needed:**

| Step | Action | `session_exercises.exercise_name` |
|---|---|---|
| 0 | initial | `Barbell Bench Press` |
| 1 | Coach change **A**: Barbell → Dumbbell | `Dumbbell Bench Press` |
| 2 | Coach change **B**: Dumbbell → Incline | `Incline Bench Press` |
| 3 | **Undo A** → `200` | **`Barbell Bench Press`** |
| 4 | **Undo B** → `200` | **`Dumbbell Bench Press`** |

Two things are wrong there.

**After step 3 the history contradicts the data.** `coach_changes` shows A struck through and B as
`NOT UNDONE` — the history states that "Swapped Dumbbell → Incline" is in effect, while the row says
`Barbell Bench Press`. The screen that exists to tell the user what the Coach has done to their
programme is wrong.

**After step 4 — undoing everything — the exercise is `Dumbbell Bench Press`.** It started as
`Barbell Bench Press`. Undoing every change the Coach made does not return the programme to where it
began, and leaves it holding a value the user never chose at any point.

**The gap is in all five domains, not just this one.** No `undo()` in any handler checks current
state; only `session-exercise` even re-verifies ownership on the way back (the single `drift` string
in `goals.ts` is a comment about a drifting local-storage copy, not a check).

**Fix shape:** run the same `driftAgainst` on the way back — compare the target's current values
against what the change *set* (`to`), and refuse with 409 + drift when they disagree, exactly as apply
does. The data is already there: `coach_changes.patch` holds the `to` values. Alternatively constrain
undo to the most recent un-undone change per target, which is weaker but simpler. **Lane A.**

---

## Clean — the apply path is a model of how to do this

Recorded at length because it is unusually good and worth protecting.

**1. The model is never in the write path, deliberately and documentedly.** `apply.ts` says it
outright: *"The model is not in this path. It proposed the patch; the user chose which rows to accept;
this writes them."* The backlog records *why* the SDK's tool-approval flow was rejected —
`ToolApprovalResponse` is binary and cannot carry a per-row selection — so the client POSTs a final
patch to an ordinary Zod-validated route. This satisfies `CLAUDE.md`'s rule that no LLM-reported value
may gate an automatic action, structurally rather than by care.

**2. Double-apply is refused with a useful error.** Re-POSTing an identical patch returned
`409 {"error":"This suggestion is out of date","drift":[{"field":"exerciseName","expected":"Barbell Bench Press","actual":"Dumbbell Bench Press"}]}`.
The drift check gives idempotency for free, and the 409-not-400 choice is deliberate and commented.

**3. Cross-user undo is refused.** User B undoing user A's change returned `404 Not found`; the
`coach_changes` lookup is scoped by `userId` in both the route and `undoCoachChange`.

**4. Ownership is established by join where the table has no `user_id`.** `session_exercises` has
none, so `loadTarget` joins `session_exercises → program_sessions → programs` and filters on
`programs.user_id` — the documented reference pattern, with a comment saying exactly why.

**5. The boundary is Zod-whitelisted with the reason written down.** The apply route notes it is
*"Zod-whitelisted at the boundary rather than passing a request body into `.set()` — `userId` and
timestamps are settable column keys and a TypeScript `Omit<>` is compile-time only"* — `CLAUDE.md`
rule (b), quoted back at itself.

**6. A model that mixes domains cannot aim a field at the wrong table.** `fieldsMatchDomain(patch)`
runs before any handler, with a comment naming the attack: *"A model that mixes domains would
otherwise be able to aim a calorie field at an exercise row."*

**7. Creating a shared-catalogue exercise is admin-gated**, matching `POST /api/exercises`, with the
reasoning recorded: `exercise_library` is one shared table, so a row one user adds is a row everyone
sees, and *"Coach must not become the way around a policy it did not set."*

**8. A merged-away catalogue row cannot be selected** — apply refuses a swap whose target has
`mergedInto` set, so migration 165's history-preserving rows can't be resurrected as live choices.

**9. A bad swap fails the whole apply rather than half-applying** — the replacement is resolved before
anything is written, and that ordering is commented as deliberate.
