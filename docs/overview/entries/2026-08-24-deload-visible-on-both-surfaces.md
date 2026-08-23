# 2026-08-24 — a deload session says so, on both surfaces (BF-8)

**PR:** `fix/deload-visible-on-both-surfaces` · **Lane B**

## What was wrong

The Intensity control read **"Full · As prescribed"** while the AI card directly below it read
**"Deload session · Auto-applied"**. Mid-session the header read **"Accumulation · S1 · Ex 1/5"**
with no deload marker anywhere. The owner trained one of those believing it was a full session and
confirmed it: *"I was under the assumption I was doing my full session but it looks like it has been
deload... its too hidden."*

**Both surfaces failed on the same predicate, and that is the root cause.** `isDeloadActive` answers
*"is the current PHASE a deload week"*. Neither surface asked *"is today's session a deload"*, which
is what `prescription.deload` holds — so a readiness-driven, auto-applied deload was invisible from
the pre-workout screen through to the last set.

## What shipped

- **`components/workout/utils.ts` → `sessionContextLabel(phaseStatus, sessionIsDeload)`.** The
  header's line, resolved in one place. A session deload is called out **and keeps the phase
  context**: a phase deload has no cycle position worth printing, but a readiness deload inside
  Accumulation still happens somewhere, and dropping "Accumulation · C2/4" to say "Deload" alone
  trades one missing fact for another.
- **`use-deload-choice.ts` adopts the prescription.** The state was seeded from `?aiDeload=1` and
  nothing else, so with no param it said "Full" regardless of what was prescribed. **A later choice
  still wins** — adoption stops the first time the user touches the toggle (the URL param counts as a
  touch), because the toggle is live and what it says is what will run.
- **The sublabels follow the prescription.** "As prescribed" sat permanently under Full, which is the
  sentence that contradicted the card. When the engine has applied a deload, Full is now labelled
  **Override** and Deload carries "As prescribed".

## Decisions worth not re-litigating

**The toggle is not hidden on an auto-applied deload**, per the entry and the comment at
`pre-workout-screen.tsx:215`: gating it on an existing prescription would leave no way to pick Deload
before one exists.

**A `consumed` prescription is ignored.** Its deload flag describes a session that has already run,
so adopting it would relabel the next one.

**`prescribedDeload` is derived inside `pre-workout-screen.tsx` from the periodization it already
holds**, not passed down. The label is a statement *about* that prescription, and reading it from
somewhere else is how the two came to disagree in the first place.

**`ActiveWorkoutScreen` takes the finished label, not `phaseStatus`.** That prop was used for nothing
else in the file, so passing the resolved string removes a prop rather than adding one — which is
also what kept `workout-screen.tsx` off its size ratchet.

## Verification

- `components/workout/__tests__/session-context-label.test.ts` — six cases, including that the phase
  context survives a session deload and that a phase deload still prints on its own.
- `e2e/deload-visible.spec.ts` — the state the entry says would confirm the bug: an **auto-applied
  deload in a non-deload phase**, with no `?aiDeload=1`. It asserts on `aria-checked` rather than
  styling (the selected half is distinguished by background colour, and colour alone is not a state),
  that "As prescribed" lands on the prescribed half, and that choosing Full still overrides and holds.
  **Mutation-checked: both tests fail with the adoption removed.**

Full local gate: 4,568 tests, 53 of 53 Custom Rules, lint clean.

**Not exercised:** the active workout header end to end. Its label logic is pinned by the unit tests
and the prop wiring is one line in the diff, but no spec starts a workout and reads the header — and
none of this ran on the device.
