# BF-82 — the More page's plan, and why its own premises needed correcting first

**Branch:** `docs/bf-82-more-page-ia-plan` · **Lane B** · docs-only (planning PR, no version bump)

BF-82 is marked a planning item, so this is its PR 1: the plan, plus the two fields the entry was
missing. No code.

## What the inventory found

**Eight `MoreRowGroup`s wrap exactly one row each** — seven on More (Program, Health, Devices,
Settings, Data, About, Admin) and one more, `Developer`, on the Settings sub-screen that the entry
missed. The only two groups in the app that group two or more rows are on that Developer screen,
which nobody complained about. So the primitive is fine and is being used as decoration everywhere
else. A heading plus a bordered container around one tappable line is three elements presenting one,
which is most of why the screen reads as long and empty at the same time.

The plan proposes seven headings → **two** (`YOUR SETUP`: Program, Health, Devices · `APP`: Settings,
Data, About, Admin), each covering three or more rows. Not zero headings, though a flat seven-row
list would be simpler: `Admin` is `isAdmin`-gated and destructive-adjacent, and appended to a flat
list it reads as a mistake.

## Three corrections, and they are the useful part

**The screen already signals navigate-vs-expand.** `MoreRow` draws `ChevronRight`; `GoalsSection`
draws a rotating `ChevronDown`. *"The user cannot predict whether tapping navigates or expands"*
overstates it — the conventional affordance is there.

**The real defect is underneath: `goals-section.tsx` does not USE `MoreRowGroup`, it re-implements
it.** Same heading classes, same shell classes, its own button inside. That is a copied pattern under
the repo's extract-before-the-third-copy rule, and it is why the two shapes can drift — nothing makes
them agree.

**Goals staying inline is a 2026-08-16 OWNER DECISION, not an oversight.** The
[2026-08-14 IA plan](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md)
records it: `GoalsSection` and the five content sections above it stay on the surface, and
`/more/goals` "was never built and is not going to be". So the fix is to stop it *dressing* as a
navigation row, not to move it.

**And there are no sliders.** Five `Switch`es on the Settings screen, all booleans, all correct. The
likely referent is the goal *value* fields in the Goals accordion — which is an owner question, so
the plan proposes no control change at all.

## The sequencing the entry stated in prose and not as a field

BF-82 decides placement; **BF-79** decides the content that placement holds; BF-79 is parked behind
**BF-78**, which is **Lane A**. The entry said so in a paragraph, and a paragraph is not a field — so
`next-item.js` offered BF-82 as READY at the head of Lane B while its dependency sat PARKED. It
carries `Needs: BF-79` now, which is what the protocol asks for and what makes the queue honest.

The plan's §3 and §4 are separable from BF-79 if the screen needs fixing sooner — they touch neither
the profile route nor any personal-detail field — but only in that order.

## Not exercised

- **No code changed**, so nothing is verified beyond `pnpm check:rules` (**Ran 65 of 65**) and the two
  doc scripts. Nothing here has been on the S25, and "reads as long and empty" is a judgement only the
  device can settle.
- **The grouping is a proposal, not a measurement.** Whether `YOUR SETUP` / `APP` are the right two
  labels is taste; what is measured is that seven single-row headings is the wrong answer.
