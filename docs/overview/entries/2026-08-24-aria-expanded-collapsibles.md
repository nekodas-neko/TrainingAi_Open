# The "9" hand-rolled collapsible toggles were actually 2, and the ratchet wasn't worth building (Q-491)

**Branch:** `fix/aria-expanded-collapsibles` · **Lane B** · v1.358.0

## What was wrong

Nine components (per `CLAUDE.md` and Q-491's own re-count) supposedly rendered a chevron-based
expand/collapse toggle with no `aria-expanded` attribute, so a screen reader couldn't tell whether
the region was open or closed. Filed for the stated Play Store direction, not a live user report.

## The count didn't survive a file-by-file check

Went through all nine named files against current `main` individually, rather than trusting the
list a second time (the entry itself already flagged two earlier prose-count failures this run:
Q-480's `DEFAULT_TZ` claim and Q-490's "2" memoised components that were actually 66):

- `health/day-overlay-sheet` — the file is gone. LB-3 retired it this run (#370/#373).
- `deload-explanation`, `signal-sections`, `ai-prescription-card` — all three already wrap their
  toggle in Radix `Collapsible`/`CollapsibleTrigger`. Confirmed against the installed
  `@radix-ui/react-collapsible` package source rather than trusting memory: `CollapsibleTrigger`
  sets `aria-expanded` and `aria-controls` on the trigger element automatically, including when
  used with `asChild` (Radix's `Slot` merges the props onto the child). None of these three needed
  anything.
- `nutrition/meal-card` — same shape: `CollapsibleTrigger asChild` around a `role="button"` div.
  Already correct.
- `workout/active-workout-screen`, `nutrition/saved-meals-sheet` — their chevron is `ChevronLeft`,
  a back-button icon. Never a collapse toggle in the first place.
- `weights-summary.tsx`, `workout/added-weight-toggle.tsx` — genuinely hand-rolled `onClick`
  toggles with no `aria-expanded` anywhere. The only two real violators.

A chevron-icon grep can't tell a Radix-wired trigger from a hand-rolled one, or a collapse chevron
from a navigation one — which is exactly how a specific "nine" became a different nine, and now a
different two.

## What shipped

`weights-summary.tsx`'s collapse `Button` and both of `added-weight-toggle.tsx`'s buttons (closed
state and open state are different buttons, not one toggle) now carry `aria-expanded` and
`aria-controls`, pointing at an `id` on the toggled region via `useId()`. Neither was converted to
Radix `Collapsible` — each renders materially different content by state rather than showing/hiding
one region, so a Collapsible wrap would have been more code than the two-line fix.

## What was NOT built, and why

The entry's own recommended fix shape was "prefer the ratchet over the sweep" — a Custom Rules
check counting chevron-toggle-without-`aria-expanded` sites, shrink-only. Tried the obvious
heuristic (a file imports a Chevron icon, has no `CollapsibleTrigger`, has no literal
`aria-expanded`) against current `main`: **34 files matched**, the large majority legitimate
non-violators for the same two reasons found by hand above (Radix-wired, or a navigation chevron).
A script whose false-positive rate requires auditing 34 files to save auditing 9 isn't a ratchet,
it's a bigger version of the same problem it's meant to solve. Left as a `Keep:` line rather than
shipped as noise — a real version would need to recognize Radix's trigger pattern (direct import or
`asChild`) and distinguish collapse chevrons from navigation ones, neither of which a text grep does
reliably.

## Verification

- `pnpm tsc --noEmit` / `eslint` on both touched files — clean.
- Rendered both components directly (scratch route, removed before committing) against the running
  dev server, logged in as the seeded user, and drove the toggle with Playwright: `aria-expanded`
  flips correctly on click for both components, and each `aria-controls` id resolves to a real
  element in the DOM.
- `pnpm check:rules` — Ran 55 of 55.

## Not exercised

No screen-reader/TalkBack pass on either component — the claim was that the attribute was absent,
not that a specific announcement reads correctly, and TalkBack is the relevant reader on the APK,
not tested here. No device check.
