# 2026-09-16 — `fix/workout-completion-surface`

**BF-169 · BF-168 · BF-167** — three defects on the surfaces either side of finishing a workout,
shipped as one PR. Batched on the verification, per the backlog's rule: all three are settled by the
same device run — complete a session, press back, land on the select tab — and each costs the same
workout to reach. v1.456.22.

## BF-169 — the COMPLETED stamp waited on a fetch it has nothing to do with

The stamp rendered on `trainedToday && muscleActivations.length > 0`. The second term is the
exercise **library**, a separate fetch: until it lands `muscleActivations` is `[]` and the stamp does
not draw, however complete the session is. A session whose exercises produce no muscle assignments
yields the same empty array. That is exactly the owner's *"some days dont… it may be some specific
excercises or how long it takes to leave the last screen"* — both of his guesses were right and they
were the same cause.

Every other completion signal on the card — the green ring, the screen-reader text, the button
reading **Start Again** — is driven by `trainedToday` alone, so the card said "complete" three ways
with no stamp. His screenshot shows precisely that.

The stamp now renders on `trainedToday` alone. The heatmap keeps its own
`muscleActivations.length > 0` guard, which was always correct for the diagram — a silhouette with no
assignments is nothing. The entanglement came from a guard that is right for one and wrong for the
other. `CompletedStamp` is `absolute inset-0`, so the container gains a `min-h-24` when there is no
diagram behind it to give it height; applied only in that case, so the working card keeps exactly the
height the heatmap gives it.

## BF-168 — two defects, and the entry's own proposal for the second would not have worked

**The path term.** `/workout` is *both* routes: `app/workout/page.tsx` renders `WorkoutScreen` when
`?session=<id>` is present and the tab shell otherwise — the same distinction `tabKeyForHref`
already encodes. `window.location.pathname` drops the query, so the old
`pathname.startsWith("/workout")` could not tell the workout screen from the session-select tab (and
matched `/workout-select` besides), and raised "Leave workout?" on a screen with nothing to leave.
Now `pathname === "/workout" && searchParams.has("session")`. `isWorkoutActive` is untouched, as the
entry required — both of its terms are load-bearing for the `beforeunload` warning and for the
guided-walk and activity guards.

**The undismissed dialog**, which the entry found while looking and which fits the screenshot: the
three confirm flags were cleared *only* by the user tapping Stay or Leave, so a prompt raised
legitimately on one screen survived any navigation. Press back while the last exercise's summary is
up and the prompt is **correct** at that instant; the session then reaches `done`, navigates to the
select tab, and the prompt rides along over a card reading COMPLETED.

**The entry proposed keying the dismissal on `pathname` change. That would not have fired for the
case it was filed on** — `/workout?session=<id>` → `/workout` is the *same pathname*. Keyed on the
subject instead: each flag clears when its own active-predicate goes false. All three, not just the
workout one, because any of the three guards can outlive its screen.

## BF-167 — shipped as a union, and the entry's recommendation was a regression

`prescription.deload` means *this is a deload prescription* — a phase decision.
`exercises[].deloaded` means *this exercise's load was cut*, which is what the illness radar and the
soreness quadrant set **after** the model has produced its plan. A safety deload therefore leaves the
phase flag false, and the toggle — which read only that flag — said *Full — as prescribed* over a
session prescribed at 52% of 1RM.

The entry recommended **replacing** the flag with `exercises.some(e => e.deloaded)`. Reading the
fixture before running it caught that this breaks BF-8's own guard:
`e2e/deload-visible.spec.ts` seeds `deload: true` with `exercises: []`, which a `.some()` alone reads
as *Full*. Shipped as the union instead — `deload || exercises.some(deloaded)`. The defect here is a
false **negative**, and the phase flag is never a false positive: when it is set the session
genuinely is a deload, so keeping it costs nothing and drops nothing. `deload-toggle.tsx` was not
touched; BF-8 already made it label correctly, and it does the right thing when told the truth.

## What was verified, and what was not

- `components/__tests__/workout-completion-surface.test.ts` — **5 of its 10 assertions fail against
  `main`**. The other five are deliberate "must not change" pins (the heatmap's own guard,
  `isWorkoutActive`, the `consumed` guard, `deload-toggle.tsx`) and pass on both sides, which is
  stated rather than counted as evidence.
- `e2e/deload-visible.spec.ts` + `back-dismiss-sweep.spec.ts` — **7 passed** in the browser. BF-8's
  guard holds unchanged under the union, which is the runtime confirmation that the union was right.
- The session-select card paints with no uncaught error both with the exercise library present and
  with `/api/exercise-library` aborted — the empty-diagram case BF-169 asked to be checked. Run from
  a throwaway spec, not committed: it proves the render, and a committed version would read as
  proving the stamp.
- Full suite **7508 passed**, `pnpm check:rules` **Ran 75 of 75**, lint 0 errors, build clean.

**NOT exercised.** The device, which is what all three actually need. Android's hardware back is a
Capacitor channel Playwright cannot fire, so **no harness run can touch BF-168's gesture at all** —
the tests pin the predicate and the dismissal, not the press. BF-169's `trainedToday` comes from
`readCacheSync('workout-card:<id>')`, whose web and device paths differ, so a seeded web
reproduction would prove the wrong runtime. Native SQLite, safe-area insets, drifted production data
and Samsung WebView rendering were all untouched. All three entries carry `Verify: device`.

## Also fixed in passing

`components/__tests__/bf166-back-closes-overlay.test.ts` — its ordering assertion anchored on
`indexOf('setConfirmLeaveOpen')`, and BF-168's new dismissal effects add an earlier occurrence of
that string at the top of the component, so the check would have gone on passing over a file where
the listener's guards had moved below the overlay check. Tightened to `setConfirmLeaveOpen(true)` —
the raise, which only the listener does — and the tightened form was proven red by moving the
overlay guard above the mode guards. Same trap as the import-vs-call-site one that test already
documents.
