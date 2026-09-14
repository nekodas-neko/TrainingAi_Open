# 2026-09-14 — PS-35a: five alias routes deleted, and the condition attached to the approval

**Lane B.** Branch `chore/ps35a-delete-alias-pages`. v1.456.7.

## What was approved, and the part that was not a blanket yes

Owner, 2026-09-14: *"We only use the APK - delete them if not needed."* Then, in the same breath:
*"What page? we only use the APK; so if its not accessible via the APK and is needed; then make
sure there is a way to access it from APK."*

So the entry's condition: for each of the five, establish whether its destination is reachable
inside the APK by a route the owner walks, and **where the only path to a needed screen is that
page, give it a real entry point before deleting anything.**

Checked, one at a time. All five destinations are reachable without them:

| Deleted | Was | Destination | Reachable in the APK by |
|---|---|---|---|
| `/session-select` | `redirect("/workout")` | Workout tab | the bottom nav |
| `/stats` | `redirect("/health?tab=training")` | Health → Training | the bottom nav + that tab |
| `/config` | `redirect("/program")`, forwarding the query | Program Builder | More → Program builder |
| `/profile` | `redirect("/more")` | More tab | the bottom nav |
| `/workout-select` | **not a redirect** — a second copy of the Workout tab's content | Workout tab | the bottom nav |

**None was the only path to anything**, so no new entry point was needed and the condition is
satisfied rather than waived.

## `/workout-select` was the one that was not an alias

The other four were one-line redirects. This one rendered `WorkoutSelectContent` plus a `BottomNav`
directly — the same screen as the Workout tab, mounted **outside the tab shell**. Going there
dropped the persistent shell, so the other four tabs had to re-mount on the next switch. Three exits
from the activity-done screen and two from the workout-done screen pointed at it.

They point at `/workout` now, which is the same content inside the shell. It also picks up LB-107's
fix, landed this morning: `/workout` is a tab root, so the back gesture from it goes Home, where
`/workout-select` would have tried to pop a history entry that a tab flip never created.

## What the deletion took with it

`/stats` and `/workout-select` were the only two routes that could produce the `stats` and
`workoutSelect` screen palettes, so those keys, their `pathnameToPaletteKey` branches and their four
`--screen-palette-*` custom properties are gone too. Leaving them would have been scenes nothing can
reach — the rot the entry is about, one layer down.

`app/config/__tests__/config-redirect-tab.test.ts` moved to
`app/program/__tests__/legacy-builder-entry-points.test.ts` rather than being deleted with its
subject. **Its invariant has now outlived every specific that named it, twice**: Q-235 removed the
`tab=` value it asserted on, and this removes the redirect hop. What still has to hold is that every
entry point to the Builder lands on it carrying its parameters — so the Q-256 forwarding guard was
re-pointed at the two halves that can now drop `new=program`, the prescription card that sends it and
the route that reads it.

## Verified

- `pnpm check:rules` **Ran 74 of 74**, all passed — and it **caught a real one**: the workouts domain
  index still named `app/config/` and `app/stats/` as live UI routes. That check exists because an
  orientation doc is read as *"what exists and where"* before work starts.
- `pnpm lint` 0 errors · production `next build` clean (the first `tsc --noEmit` after the deletions
  failed on five `.next/types/validator.ts` entries — a **stale generated file**, not the source;
  a clean rebuild regenerates it).
- Unit tests: the relocated Builder-entry test and the background routing test pass.
- `e2e/first-run-empty-states.spec.ts` navigated to `/workout-select` twice and now navigates to
  `/workout` — without that the spec would 404 on a route this PR deletes.

## Not exercised

- **No device.** The changed exits (activity-done, workout-done) are ordinary navigations and the
  destination content is identical, but *"lands on the Workout tab"* has not been watched on the S25.
- **The 404s themselves.** Nothing in the repo links to the five any more, which is what the test
  above asserts; a bookmark or a shortcut outside the repo would now 404. The owner dismissed that
  risk directly — a browser bookmark is not a surface they use.

## Queue

PS-35a removed. Lane B READY 6 → 5. **LB-109 filed** for the Orchestrator: three of the remaining
five READY entries (BF-141, BF-135, LB-47) are finished work whose headings still say a device check
is owed while their bodies record it done — so the top of the lane is items that cannot be started.
Clearing a completed entry is the Orchestrator's sweep, which is why it is filed rather than done.
