## 2026-08-08 — defeated memos, a contradictory skeleton, and four bypassed cache keys (Q-135)

**Branch:** `perf/render-and-fetch-batch` · **Domain:** `app-shell` / `platform` / `workouts`

### Memos defeated at their own call sites

A `React.memo` is silently useless when the parent mints a new identity for a prop each render.
Two of the three sites the review names are fixed:

- **`ModalityPicker`** ← `cardio-content.tsx` passed two inline arrows. Now `useCallback`'d.
- **`MuscleHeatmap`** ← `sore-muscle-picker.tsx` passed
  `assignments={selected.map(…)}`. This is the costly one: it renders an SVG body map and was
  re-rendering on **every unrelated state change in the mood check-in sheet**, including each
  keystroke in the notes field. Now `useMemo`'d on `selected`.

**The third — `AiChatOverlay` ← `stats-content.tsx` — is not fixed, deliberately.** That file is
deleted outright by Q-136 (#1157) as 389 lines with zero importers. Fixing a memo in a file being
removed would only create a merge conflict between the two PRs. Whichever lands first, the site is
gone.

### A `loading:` skeleton over a cache-seeded card

`overview-screen.tsx` wrapped `ReadinessCard` in `dynamic(..., { loading: () => <Skeleton/> })`
while `readiness` is seeded synchronously from cache in the same component. The skeleton wins the
first paint, so the seed never shows — the exact contradiction CLAUDE.md's instant-paint rule names.
`ReadinessCard` is 268 props-only lines with no fetch and no heavy dependency, so it never met the
bar for `dynamic()` at all. Now a static import.

### Four screens bypassed the shared `hr-profile` cache key

`activity-detail-sheet.tsx`, `done-activity-screen.tsx`, `exercise-review-sheet.tsx` and
`walk-summary.tsx` each bare-`fetch`ed `/api/hr-profile`, while five other sites use
`cachedFetch('hr-profile', …, HR_PROFILE_TTL)`. So the post-run and post-walk summaries fired a
redundant round-trip with a fresh copy already in cache, and **could not render HR zones offline at
all**. All four converted to the shared key.

### The two-stage waterfall: documented, not changed

`session-select-content.tsx` awaits `Promise.all([workout-data?tab=meta, streak-data, next-session])`
and *then* awaits `workout-data?tab=all`, which consumes nothing from the first. The backlog asked to
*"check whether there's a real bandwidth-priority reason for the sequencing before parallelizing it,
and if there is, add the comment explaining why."*

There is one, so the comment was added and the behaviour left alone. **CI made me pay for it
properly:** `check-component-size.js` holds `session-select-content.tsx` to a shrink-only 1484-line
baseline, and the first draft of the comment grew it by nine lines — exactly the "extract, don't
append" rule the ratchet exists to enforce. The explanation now rides inside the existing comment
block at **net zero lines**, paid for by tightening the invalidation-proof paragraph beneath it. The
reason: the first batch paints what is
on screen (the recommendation card, the streak strip) while the second only seeds
`workout-card:<id>` for tabs the user has not opened. Racing them puts a larger, not-yet-needed
payload in contention with first paint on mobile data. The existing comment block explained the
*batching* and never the *ordering*, which is why it read as accidental.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors (warning count unchanged at 120 — the now-unused
  `Skeleton` import was removed with it) · `vitest run` **3240/3241**, the one failure being the
  known seeded-local-DB harness problem in `scale-ble-multi-reading.test.ts` (backlog **Q-141**).

### Not exercised

No device run — React identity and fetch wiring, no native, safe-area, gesture or notification path.

**No render counts or profiles were captured**, so the memo fixes are structurally correct rather
than measured — the claim is that the prop identities are now stable, not that a specific number of
renders was saved. Q-51 already records that real render-cost numbers need an on-device Performance
profile the owner has to capture.

**None of the four HR-profile screens was opened after the change.** They sit behind a finished run,
a finished walk, an activity detail sheet and an exercise review — flows this session did not drive.
The conversion is mechanical and typechecks, and the offline claim in particular (that HR zones now
render from cache with no network) is **reasoned from `cachedFetch`'s behaviour, not observed**.
