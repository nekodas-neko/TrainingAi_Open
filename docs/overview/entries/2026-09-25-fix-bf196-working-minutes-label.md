# 2026-09-25 — BF-196: two duration numbers in different units, neither saying so

**Branch:** `fix/bf196-working-minutes-label` · **Lane B** (LB-146)

The owner asked two questions a day apart that turned out to be the same question:

> *"it says if I complete on time I will finish at 51 minutes which is less than the 60 — does this
> sound right?"*
> *"Like this workout says 48 thats way under 60? Is it not counting warmup?"*

Both numbers were correct. The prescription card's estimate is measured against the **working**
budget — the session budget minus the measured warm-up carve-out (60 − 9) — so 51 against a
51-minute working budget is a session that is exactly full. The done screen's `48:00` is wall clock
from the start of the warm-up, so it *is* counting it. Neither label said which unit it was in, and
the two are naturally compared.

## What shipped

`ai-prescription-card.tsx` renders `~51 min of work`. `done-screen.tsx`'s tile is labelled **Total
time** instead of Duration.

## The entry said one string; there were three surfaces, and one had already solved it

`session-duration-picker.tsx:46` renders the same `estimatedSessionDurationMin` as
`~{n} min of work` — and `pre-workout-screen.tsx:276-284` mounts that picker **directly above** the
card, feeding both from the same field. The entry recommended `~51 min working`, which would have
put two phrasings for one quantity six lines apart on a single screen.

Shipped as **`min of work`**, matching the sibling. The wording is marginally less crisp; the
consistency is worth more, and this is the copy analogue of One Formula. Finding it took a grep for
the field name rather than a read of the two files the entry named — the fourth entry in a row where
the named surface was not the only one.

## Why the summary's naming went on the label

`48:00 total` widens a fixed `grid-cols-2 max-w-xs` tile — about 124 px of content — and breaks its
`tabular-nums`. The label is `text-[10px] uppercase tracking-wide`, where "TOTAL TIME" fits
comfortably and "INCL. WARM-UP" would wrap. Naming it there keeps the number clean and the width
unchanged.

## What this is not

Not an engine change. The plan behind 51 is correct and `expandToBudget` stays gated — the entry is
explicit that the under-fill *is* the finish-early margin. BF-197's separate finding, that the
estimate over-charges by ~14.2 min, is Lane A's and is untouched here.

## Verification

5 tests in `components/workout/__tests__/bf196-duration-units-are-named.test.ts`, including that the
card and the picker carry the same phrase and that the naming stays on the label. **Control run:**
with `components/` reverted, 4 of 5 fail.

`pnpm lint` clean · `tsc --noEmit` clean · 105 tests pass across `components/workout/__tests__`.

**Not exercised: the device.** The card's row is `truncate`, so it clips rather than wraps, and
" of work" spends width ahead of the segments that follow it (`Phase transition suggested`,
`Deload recommended`). BF-196 stays queued as `Gate: device` with that as its `Keep:` and a concrete
pass/fail.
