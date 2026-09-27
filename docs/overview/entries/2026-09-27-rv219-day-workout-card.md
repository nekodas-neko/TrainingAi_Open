# The exercise name stops being cut where it matters, and the "0 kg" is Lane A's

Implementation Lane B, 2026-09-27. `RV-219` item ②. Item ① is confirmed and belongs to Lane A for a
specific reason; ③ is RV-208's.

## What shipped

`"Chest-Supported Dumbb…"` cut exactly the words that tell that row from every other one. The name
now wraps (`truncate` → `line-clamp-2`, on both the button and span branches). Rendered at 412 px
dark with an injected long name: **"Chest-Supported / Dumbbell Row"** over two lines, with the sets,
the weight and both icons still aligned on the row.

## The entry's other suggestion is ruled out by a different standing rule

It offered an alternative: *"shrink the edit and delete icons, which take about 25% of the row twice
over."* **The measurement is right** — `ICON_BTN` is `h-12 w-12`, so 96 px of roughly 380 usable at
412 px. But **48 px is the Android minimum touch target** and this repo's tap-target floor, so
taking that option trades a naming problem for an accessibility one.

The test pins `h-12 w-12` alongside the wrap, so the trade is not made later by someone who has not
read this. That is the more useful half of the guard: the wrap is obvious once seen, and the reason
the icons must stay large is not.

## Item ① is real, and the card cannot fix it

Rendered and confirmed: a bodyweight row shows **`0kg`**.

The repo already has the resolver *and* already states the rule — `isBodyweightType`
(`packages/shared/src/1rm.ts`), whose module comment reads *"Every surface that shows a stored 1RM
resolves its unit here rather than hardcoding kg"* (BF-162, Q-19). So this looks like RV-214's shape:
a surface that skipped a documented convention.

It is not. **`DayExercise` carries no `exerciseType`** — only `name`, `weightKg`, `sets`, `reps` —
and every existing consumer of `isBodyweightType` receives the type as a *prop*. There is no
name→type lookup on the client to copy, so building one here would be new machinery beside an
established pattern.

The fix is one field on `app/api/day-log/route.ts`, after which the card resolves the unit the way
every other surface does. That is a route change, so the entry is re-laned to **A** with the
reasoning on it.

## Not exercised

**Not verified on device.** Rendered at 412 px dark. No APK needed — a Tailwind class reaches the
device through a normal Railway deploy.

**No e2e spec was added, deliberately.** `LB-166` (filed earlier today) records that the E2E job
already exceeds its own 45-minute limit, and the unit guard plus the render covers a CSS class
change. Adding a spec here would spend the budget that item is about.
