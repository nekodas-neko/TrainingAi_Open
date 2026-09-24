# RV-120 — the volume card that was already merged away

**Branch:** `fix/rv120-remove-superseded-volume-card` · **Entry:** RV-120 (Review sweep 53)

## What was wrong

`AiWeeklyVolumeCard` was imported into `health-sections.tsx` and had a live `case "aiVolume"`
render arm, but `aiVolume` appeared in no order array, so nothing ever mounted it. A comment
above `TRAINING_ORDER` explained the omission and promised the card would return "once it's
merged into a single volume card" — and that promised merge had no backlog entry anywhere,
which is what Review filed it for.

## What the entry left open, and how it resolved

RV-120 deliberately did not pick between merging the card in and deleting it. Reading the two
data sources settles it, and not in the direction the code comment implies.

`app/api/weekly-muscle-sets/route.ts:81-88` already does the merge:

> Overlay the active program's per-muscle weekly targets so this single card shows progress
> toward the program's real targets (replacing the separate "Weekly Volume vs Target" card).

So the deferral finished some time ago and nobody updated the comment that promised it. The
shipped `WeeklyMuscleSetsCard` carries the programme's targets already, and carries them
*better* — scaled by the week's actual phase mix (BF-59), with `listVolumeTargets`' stored
numbers read only as the roster of muscles the programme trains.

Rendering both would also have been a defect rather than a feature. `/api/weekly-muscle-sets`
takes no `programId` and counts the week outright; `/api/ai-periodization/weekly-volume` scopes
its logged sets by `programId`. The two would print different numbers for the same muscle in the
same week — the shape RV-117 describes as two different answers to one question.

Deleted, therefore: the component, the import, the render arm, the now-false comment, and the
component's row in `check-hex-literals.js`'s baseline.

## No version bump

The card mounted nowhere, so nothing a user can see changed. No changelog entry, no version bump.

## Follow-up filed, not swept in

`LB-137` (Lane A). The deleted card was the only client consumer of the `weekly-volume-target`
cache key and of `/api/ai-periodization/weekly-volume`; `lib/cache-groups.ts` still clears that
key at two sites for a reader that no longer exists. Both files are Lane A's, so it is an entry
rather than part of this diff. The route is not simply dead — `getWeeklySetsByMuscleGroup` stays
live through `signals.ts` — so the open question is whether the HTTP surface still earns its
place, which the entry states rather than presumes.

## Verification, and what was not exercised

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** ·
`check-hex-literals` clean against the reduced baseline · 45 tests across the 6 files touching
these modules · `pnpm build` succeeded, 245 static pages.

`/health` is auth-gated, so a dev-server GET redirects to `/sign-in` and never compiles the
changed files — the full build is what actually exercised them, and that is the claim being made
here. **Not exercised:** the S25 APK, Samsung WebView rendering, safe-area insets, native SQLite,
drifted production data. No device check is owed: the deleted card was unreachable on every
runtime including the device, so there is no on-device behaviour for it to change.
