# Review — the hand-maintained counts in `CLAUDE.md`, and what happened to one of them

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** control semantics
**Findings filed:** Q-491 · **A pattern named:** hand-maintained counts drift; ratcheted ones do not

## Why

`CLAUDE.md` states the rule with a count and a file list:

> Interactive elements are real controls … **9** hand-rolled chevron toggles ship no `aria-expanded`
> (re-counted 2026-08-09, down from ~18; `deload-explanation`, `signal-sections`, `more/profile-tab`,
> `health/day-overlay-sheet`, `workout/active-workout-screen`, `workout/ai-prescription-card`,
> `workout/added-weight-toggle`, `nutrition/meal-card`, `nutrition/saved-meals-sheet`).

A named list with a date is checkable, which is the whole reason to write one. Nobody had re-checked it.

## Result — still 9, but not the same 9

| File | State |
|---|---|
| `app/session-select/components/deload-explanation.tsx` | still 0 `aria-expanded` (**moved** from `components/workout/`) |
| `app/session-explain/components/signal-sections.tsx` | still 0 (**moved** from `components/session-explain/`) |
| ~~`components/health/day-overlay-sheet.tsx`~~ | **file deleted, LB-3 2026-08-24** |
| `components/workout/active-workout-screen.tsx` | still 0 |
| `components/workout/ai-prescription-card.tsx` | still 0 |
| `components/workout/added-weight-toggle.tsx` | still 0 |
| `components/nutrition/meal-card.tsx` | still 0 |
| `components/nutrition/saved-meals-sheet.tsx` | still 0 |
| `components/more/profile-tab.tsx` | **fixed** — 0 chevrons remain |
| `components/weights-summary.tsx` | **0 `aria-expanded`, and not on the list** |

So: **one was fixed, one was never on the list, and two moved paths.** The count is coincidentally
unchanged at 9 and the membership is not.

**`components/weights-summary.tsx` partially compensates** — its toggle carries
`aria-label={collapsed ? "Expand" : "Collapse"}`, so the state does reach a screen reader, just not
through the attribute that also expresses the control-to-region relationship. Better than the other
eight, and still not the rule.

## Finding (Q-491)

Nine collapsible chevron toggles ship no `aria-expanded`. A screen reader announces them as plain
buttons with no indication that they expand a region or what state that region is in.

**Severity: low today, and the reason is honest** — this is a personal gym tracker with no known
screen-reader user. It is filed because the stated direction is a **Play Store listing**, where
accessibility is a review surface rather than a preference, and because the fix is one attribute per
site on nine sites.

**Fix shape.** Add `aria-expanded={isOpen}` to each toggle, and `aria-controls` pointing at the
region's id where the region has one. The repo already ships the right primitive — `CLAUDE.md`'s own
rule says to prefer Radix `Collapsible`, which supplies both attributes for free; converting the
worst offenders is a better trade than hand-adding attributes that can drift out of sync with the
state again.

## The pattern worth more than the finding

This is the **third** hand-maintained count in `CLAUDE.md` found stale in this run:

| Rule | Recorded | Actual |
|---|---|---|
| *"Repo day-window helpers currently hardcode `DEFAULT_TZ`"* (Q-480) | broken | they take a parameter every caller passes |
| *"both long-standing memos in the codebase"* (Q-490) | 2 | **66** |
| *"9 hand-rolled chevron toggles"* (this) | a specific 9 | a **different** 9 |

And the counts that have **not** gone stale are the ratcheted ones — hex literals
(`check-hex-literals.js`), TTL divergence (`check-cache-ttl-divergence.js`), component size, doc-index
size, backlog pointers. Every one of those is enforced by a script and every one is current.

**The lesson `CLAUDE.md` already drew for hex literals applies to its own prose:** *"That trend was
recorded here as improving and it was not … unnoticed because this line was prose and nothing measured
it."* A count in prose is a claim with a decay date. A count in a script is a fact.

That argues for the fix here being a **ratchet**, not a sweep: a Custom Rules step counting chevron
collapsibles without `aria-expanded`, shrink-only, so the list stops needing a human to maintain it —
and the rule's prose can then cite the script instead of a number.

## Not verified

Static analysis. **No screen-reader testing was done** — the claim is that the attribute is absent,
not that a specific announcement is wrong. Not on the APK, where TalkBack is the relevant reader.
`coach-content.tsx` was examined and **excluded**: its chevron is a back button, not a collapsible.
