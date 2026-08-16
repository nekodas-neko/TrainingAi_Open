## 2026-07-30 — Backlog cleanup + a batch of small real bugs, then the offline meal-type mirror

Started from a request to clean up `docs/implementation-backlog.md` and the handoff docs, and pick
up whatever was actually left in the queue. A background audit agent read the full ~3,050-line
backlog, all four handoff docs, and `projectOverview.md`'s Known Issues, cross-checking every claim
against current `main` (source greps, git log). Headline: ~2,300 lines described work that had
already shipped and was never removed after landing (against the file's own stated protocol), and
several status claims were stale enough to actively mislead — a migration-number line 38 behind the
actual directory, two Known-Issues rows still marked OPEN after their own fix had shipped a few
paragraphs later, and a PR citation pointing at the wrong (still-open) PR.

### PR #922 — docs cleanup + bundled bug fixes

**Docs:**
- Trimmed the backlog from ~3,050 to ~380 lines — kept only genuinely open items, corrected the
  migration-number line (127 → 165+), flagged several open PRs the old file didn't know about
  (dedup hazards — e.g. #906 already covers guided-walk Phase D, so a future session wouldn't
  restart it).
- Fixed the two contradictory `projectOverview.md` rows (sleep-nap scoring, offline
  `exercise_library` mirror) and the mis-attributed PR citation.
- Fixed `docs/planned_upgrades.md`'s migration-number line (111/v13 → 165/v20).
- Deleted `docs/handoff-2026-07-20.md` (fully superseded) after folding its two still-useful
  CI-monitoring facts into `CLAUDE.md` (the bash `$GITHUB_TOKEN` is a non-authenticating proxy
  placeholder in this environment; a check failing in 2-3s with no logs is a transient Actions
  blip). Also corrected CLAUDE.md's stale "6 required CI checks" claim (it's 5 — type-checking
  rides inside Build).
- Trimmed `docs/handoff-phase-3-bundled-shell.md`'s stale branch-status section.

**Bundled bug fixes** (all small, independent, each verified against current source before fixing):
- `norwegian-4x4` had no entry in `lib/running/zone-targets.ts`'s `ZONE_WEIGHTS`, so the Intervals
  running goal silently fell back to the polarized-80-20 zone-target split.
- `activity-store`'s `mode:'active'` had no staleness bound on rehydrate — an abandoned session's
  elapsed timer ran away indefinitely (owner-reported: 25,723 minutes on a 0.51 km route). Capped
  recovery at 12h, mirroring the guided-walk/auto-detection stores.
- The offline activity-log card's local→server mapper (`activity-history-card.tsx`) dropped 9
  display fields (route, splits, elevation, segments, notes) for a pending-sync activity.
- The BLE HR-series rollup (`adapter.ts`) keyed its accumulation bins on bin-start alone; since the
  workout bin width evenly divides the resting bin width, the two could collide and silently merge
  different-width averages together. Now keyed on `(binDs, binStart)`, with a final merge-by-final-
  timestamp pass so the `(user_id, timestamp)` unique constraint can't throw mid-batch.
- `gait-confirm`'s locomotion streak had no gap check between windows — a drain delivering an
  hour-old burst of windows "in order" (not temporally consecutive) could confirm a walk backdated
  to the first one.
- The guided-activity store computed average pace from the phone wall clock while every other
  route metric derived from GPS fix time.
- The Atwater macro/calorie cross-check the AI food-scan path already applies was missing from the
  manual food-entry route and its offline push-mutation mirror.
- The step orchestrator's auto-post was fire-and-forget with no retry, and set `lastPosted` before
  the POST resolved. Added a localStorage retry buffer mirroring the manual tester's pattern.
- `/api/oura/sync` could write a day row carrying only a fresh `non_wear_time_sec` with every real
  scoring field absent, making "sync succeeded" a false-positive once the Cloud API went frozen.
- Three exercise names two prior data migrations (163/164) merged into canonical siblings stayed
  selectable in every exercise picker (Q-26). Migration 165 adds a nullable `merged_into` column,
  backfilled for the three known rows; filtered out of the pickers that offer a *new* selection
  (`program-editor-sheet.tsx`'s datalist, `builder-review.tsx`'s swap alternatives,
  `injury-substitution.ts`'s substitute list) while leaving the shared `exercise_library` list
  itself unfiltered — it's a global table other users' history/digest views also read.

Merged as #922 (squash), CI green (Lint/Tests/Build/Migration Check/Custom Rules).

### PR (this one) — offline meal-type mirror

While scoping the audit's remaining local-mirror suggestion (`exercise_estimates` +
`meal_types`), found that `exercise_estimates` would be **inert** if mirrored on its own:
`lib/local-store/program-assembler.ts` deliberately renders offline programs as *structure only* —
`estimated1rm`/`target80`/`latestWeight` are all hardcoded null in the offline path by design, so
`computeInitialWeights` (`components/workout-screen.tsx`) always falls through to its `return 60`
fallback regardless of any local estimate. Actually wiring an estimate into that hot weight-
computation path is exactly the change the Q-5b handoff deliberately deferred (its own `return 60`
follow-up), and it wants a device check per that entry's own reasoning — so building the mirror
alone here would just be dead weight. Left it in the backlog for a session with device access
rather than build something unused.

`meal_types` had no such entanglement — pure read-only display categorization, no hot-path
computation. Added the mirror:
- SQLite v21: `meal_types` table (id, name, emoji, sort_order, time window, reminders/required
  flags), registered in `RECONCILE_TABLES`.
- `SQLiteLocalStore.replaceMealTypes()` (delete-all + insert in one transaction — safe since
  meal-type editing stays online-only, so there's never a pending local edit to protect) and
  `getMealTypes()`.
- `nutrition-content.tsx`: local-first read on mount (paints before the network cache resolves),
  and the existing `/api/nutrition/meal-types` fetch now hydrates the mirror on every successful
  response.

### Tests
`pnpm exec tsc --noEmit` clean, `pnpm lint` 0 errors (pre-existing warnings only), full `vitest`
suite green except the one pre-existing `claude-ro-readonly-role.test.ts` failure (confirmed
identical on unmodified `main` in this sandbox — a Unix-socket `DATABASE_URL` isn't parseable by
the JS `URL` constructor the test uses; CI's TCP connection string doesn't hit this). Added
DB-independent unit tests for `replaceMealTypes`/`getMealTypes` (mocked `runSQL`/`querySQL`,
covering the transaction rollback-on-failure path) and for the `norwegian-4x4`/gait-confirm/
activity-store fixes. `check-reconcile.js` and `check-push-mutations.js` clean. `pnpm build` clean.

### Not yet verified
Everything here is server/JS/client-only — no native code touched, nothing needs an APK rebuild.
The meal-type mirror's actual offline behavior (open the app in airplane mode after the cache has
expired, confirm food logs still group under real names) is only provable on-device
(`getLocalStore` returns null in the web sandbox) — flagging as not-yet-device-verified rather than
claiming it works.

Version bumped to 1.242.2 (patch; a parallel PR landed 1.242.1 in between and re-based ahead of
this one) — this entry covers the version bump that PR #922 itself should have included and
didn't (an oversight caught while writing this note), plus the meal-type mirror.
