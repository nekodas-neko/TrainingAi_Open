# LA-164 — a chin-up on the day card read `0kg`

**Branch:** `fix/day-card-bodyweight-lift` · **Lane B** · `components/health/day-detail/**`.

Health → a day's workout card printed **`0kg`** for a chin-up. That is not a small number, it is the
wrong quantity: nothing was added to the bar and the lift is the body. RV-219 ① found it; Lane A
shipped the engine half, so `/api/day-log`'s `DayExercise` already carried `exerciseType`
(`'bodyweight'` / `'weighted'` / `null`, resolved from `exercise_library` via
`exercise_logs.exercise_id`). The card ignored it.

## What shipped

`exerciseWeight()` in a new `components/health/day-detail/exercise-weight.ts`, read by a `WeightCell`
in `day-sections.tsx`:

| stored | before | now |
|---|---|---|
| bodyweight, 0 kg | `0kg` | `BW` |
| bodyweight, 10 kg | `10kg` | `BW +10kg` |
| weighted, 60 kg | `60kg` | `60kg` |
| weighted, null | `—kg` | `—kg` |

**`BW` alone rather than `BW 0kg`** — printing the zero is how this read wrong in the first place.
Added weight keeps its unit, because `BW +10` is ambiguous without one.

Two decisions worth not re-litigating. **A non-bodyweight lift is returned byte-identical, em dash
and all.** `—kg` for an unrecorded weight reads oddly and tidying it here would be a second change
hiding inside this one — absent is not the same as bodyweight, and only `exerciseType` separates
them. And the helper is a **plain `.ts` sibling** rather than an export from the `.tsx`: that is the
repo's existing shape (`components/ui/sparkline-geometry.ts` beside `sparkline.tsx`), and a `.ts`
test importing a `.tsx` module fails Vite's parse outright — *"content contains invalid JS syntax"* —
which is what sent me looking for the convention.

## The control run is the evidence

Six unit tests pin the copy. The round trip is pinned by `e2e/la164-bodyweight-weight-cell.spec.ts`,
which seeds a `bodyweight` library row, a chin-up log carrying its `exercise_id` at 0 kg, and a
weighted row with no `exercise_id` at all — so the null-`exerciseType` path is asserted to stay on
kg in the same run. *"Reads as bodyweight"* is only correct if it is not what every row now says.

**Reverted the component and re-ran at 412 px:** the row read **`Spec Chin-Up 3 × 8 0kg`** — the
reported defect, observed rather than inferred — and the spec failed on the expected substring.
Restored, green. A spec that passes either way proves nothing, and this session has already filed
one entry on a static read that measurement refuted (LB-169).

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · **10,561** unit tests passed
· build clean · the new spec green with the fix and red without it.

**Not exercised:** the APK. This is a WebView-delivered render change with no native, safe-area,
gesture or offline-first surface, so the web harness at 412 px covers the only path it has. The
`weighted`/`null` split was asserted against seeded rows, not against the owner's 504 real logs —
Lane A measured that his Chin-Up resolves to `bodyweight` on production, and nothing here re-reads
it.
