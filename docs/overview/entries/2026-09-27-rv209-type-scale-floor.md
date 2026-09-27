# The type scale has a floor, and the rest of the debt is frozen rather than swept

Implementation Lane B, 2026-09-27. `RV-209`, steps 1 and 2.

## What the audit found

42 font sizes — 13 named plus 29 arbitrary ones (`text-[10.5px]`, `[11.5px]`, `[12.5px]`,
`[13.5px]`…), from 7 px to 34 px — and **1,035 uses under 12 px**: 583 at 10, 287 at 11, 128 at 9,
down to 7. There was no token below `text-xs`, so every one of them was a per-site decision
written as a literal. That is how a scale grows half-pixel steps: not by anyone choosing them, but
by there being nothing to choose instead.

## What shipped

`--text-2xs: 11px` and its line height are in `@theme`, and the **nine sites the entry names on
the workout screens** are on it. Each was verified against `main` first, and every line number in
the entry was right — worth recording, because several entries this week were not.

**11 px rather than 12.** That is where the existing mass sits (287 uses against 583 at 10 px), and
it is reachable without re-laying out cards that a 12 px floor would. The four `set-card` sites
were already at 11 and look identical; what they gain is a place *on* the scale, so the next edit
cannot reach for `text-[10.5px]` without a reviewer seeing it. The five at 9–10 px move up.

The two uppercase eyebrows among the nine — `workout-clocks`'s label and the `1RM` / `REP MAX`
caption — went to 11 rather than 12 deliberately: the entry says eyebrows may sit at 10–11, and
they were below even that.

## Step 3 is a ratchet, not a sweep

`components/workout/**` still holds **103 sub-11 px literals across 24 files**, plus 41 more
written as `text-[11px]` now that a token exists. A hundred blind edits across twenty-four files
is a worse risk than the debt — one wrong class in a card read mid-set is a real cost, and nothing
would catch it.

So `components/workout/__tests__/rv209-type-floor.test.ts` baselines both counts **per file and
shrink-only**. Nothing new lands below the floor, every future touch of a file pays a little of it
down, and lowering a number is a one-line diff next to the fix. The exact-match assertion is
deliberate: a stale baseline means the debt was paid and nobody updated the number, which should
be visible rather than silently tolerated.

Chart axis text is P36's, and it is inside the baseline rather than exempted — "is this string an
axis label" is not a question a scan can answer, and a wrong exemption is worse than a frozen
count.

## Failure surfaces not exercised

The S25. Rendered at 412 px dark on the active workout screen: set cards, the percentage label and
the RPE strip all sit clean and nothing overflows. **Two of the nine were not on screen in that
state** — the last-session panel's `Last session —` line and its `1RM` caption — so those two are
read from source only.

The entry's other finding is untouched and still true: **26 of the small sites also sit at 40–70 %
opacity**. A size floor does not fix a contrast one.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` clean, with `.text-2xs` confirmed in the generated CSS rather than
assumed · `tsc --noEmit` · `check-test-typecheck` none above baseline. Control run: putting a
`text-[9px]` back into `set-card` fails the ratchet.
