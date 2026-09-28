# RV-208 ② — one spacing for a lifted load, and a guard that first checked half of it

**Branch:** `fix/one-load-unit-spacing` · **Lane B** · `components/**`, `app/session-select/**`.

The sweep found `7 × 68kg` on one screen against `98 kg` two cards down. Lane A settled the form on
2026-09-27 with `formatLoadKg` (`68 kg` / `67.5 kg` / `71.25 kg` — two decimals, trimmed, because a
1.25 kg plate step rounds to `71.3` at one). This converts the render sites.

## The entry named six sites; there were nine

`next-workout-card`, `week-day-sheet` and `formatVolume` were not on the list — it was a snapshot of
when the entry was written, and the sibling-surface rule says fix every surface in the same PR.

Eight are lifted loads and now call `formatLoadKg`. **`app/profile/[userId]/page.tsx`'s
`formatVolume` is excluded with its reason:** it renders a lifetime tonnage through `kT`/`T`/`kg`
tiers, deliberately rounded whole. It is not a load anyone lifted in one go, and spacing only its
bottom tier would leave the three tiers disagreeing with each other.

`app/api/**` is excluded too. Its five `${x}kg` are LLM prompt text (`nutrition-goals/recommend`)
and a Google Calendar event description (`log-calendar-event`) — neither is the app drawing a load
on a screen, a prompt's wording is tuned against the model rather than for card consistency, and
both files are Lane A's. Noted on the entry rather than swept.

## The guard passed its own control run, which is the thing worth recording

`rv208-one-load-unit-spacing.test.ts` is a sibling of the duration guard. Its **first version
matched only `${x}kg`** — a template literal. Half these call sites are JSX `{x}kg`, which is a
different construction, so reverting `pip-view` and re-running produced a **pass**. It keys on
`}kg` now and is control-run against both forms, with a reverted site of each kind.

A widened regex then flagged the *correct* `} kg` sites, so the no-space case is what it matches:
the form is the defect, not the unit.

## A fourth clock form is still live, and it is Lane A's

While checking ①, both functions were **run** rather than read: `formatTime12h('06:40')` returns
**`6:40am`** against `formatTimeOfDay`'s **`6:40 am`**. It sits in `packages/shared/src/date-utils.ts`
and feeds `activity-detail-sheet.tsx` and `activity-history-card.tsx` — **the "Health's activity
list reads 6:40am" surface this entry opened with.** Lane A's fix reached the day-timeline route and
`fmtAest`; it did not reach this. One character in a Lane A file, so it is written onto the entry
rather than taken here, along with the two minutes-of-day formatters that need a shared sibling
before their call sites can be converted.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 827 warnings · full unit suite green ·
build clean · the new guard 3/3, red with either form reverted.

**Not exercised — no render.** The seeded account has no weights on any of the eight surfaces, so
nothing was seen at 412 px, and building eight fixtures for a spacing change was judged out of
proportion. The residual risk is a **wrap, not a wrong value**: one added character in two tight
cells, `pip-view`'s overlay and `week-day-sheet`'s truncated row. Both are `tabular-nums` and neither
is near its container's width in source, but that is a reading rather than a measurement — it is
recorded on the entry as owed.
