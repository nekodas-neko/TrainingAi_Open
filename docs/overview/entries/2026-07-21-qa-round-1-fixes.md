## 2026-07-21 — QA round 1: fixes from on-device testing (v1.195.1)

**Branch:** `fix/qa-round-1` — owner ran the on-device QA checklist and reported 11 items; this fixes
the P0 breakages. Refinement asks (ACWR/sleep-vs-perf graph, Heart & Recovery visual polish, Body
Battery diagrams, Activity detail depth, Trends-pill vs tab-swipe gesture) are noted for a round 2.

- **Workout screen crash + lost carousel (regression from #14).** The 3-card rewrite's `RunCard` did
  `.reduce` on `zoneTargets`, which is a `WeeklyZoneTargets` **object** (`.totalMinutes`/`.perZone[]`),
  not an array — "reduce is not a function", page wouldn't load for anyone with a real running plan
  (the seed had none, so it passed dev). Owner also wanted the beloved swipe carousel back. **Restored
  `app/workout-select/workout-select-content.tsx` to the pre-#14 carousel** and added a Run + Log
  Activity button row beneath it; deleted the unused `run-card.tsx`.
- **Detail-screen back button did nothing.** The full-cover decoration SVG in `DetailHero` had no
  `pointer-events-none`, so it swallowed the back-button tap. Added it (and to the gradient layer).
- **Energy Budget card hidden until a meal was logged.** `useEnergyBudget` returned null when today's
  calories were null; now treats un-logged as 0 so the card shows the full budget as soon as the
  profile (weight/height/age/sex) is set.
- **Sleep night detail showed contradictory numbers.** The Oura 0-100 sleep sub-scores (frozen/near-zero
  since the BLE re-key) rendered next to real stage hours (e.g. "REM 0" beside "2.5 h"). Added a
  `hideContributors` prop to `HealthScoreDetail`, set on the Sleep detail; hypnogram + real metrics stay.

### Verification
- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm test` (1804 passed), `pnpm build` — green.
  (Ran `pnpm install --frozen-lockfile` first — main's #722 added `onnxruntime-web`.)
- `pnpm dev`: `/workout` renders HTTP 200 (carousel restored, no RunCard); `/health` + `/health/sleep`
  200; `/api/body-metadata` confirms the budget's profile inputs are present so the card now shows.

### Still open (owner QA notes → round 2)
- Muscle card renders first in code (pinned at the top of the Body panel) — asked owner to confirm the
  tab / send a screenshot.
- Refinements: ACWR/Sleep-vs-Performance want a graph + less text; Heart & Recovery visual integration
  (screenshot pending); Body Battery "how it moves" wants diagrams not paragraphs; Activity wants
  stress/recovery + score-ranking detail; Trends pill-swipe also drags the Body/Training/Progress
  carousel; "More paints instantly" flagged without a note (need detail).
