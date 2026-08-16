# Handoff — Q-49 public repo cut, at the Phase B boundary

**Date:** 2026-08-16 (updated the same day) · **Domain:** platform · **Branch to use:** cut a fresh
one from `main`

**A4b has shipped.** Oura's material is out of the repository and both boot checks are fatal against
the bucket. What remains is Phase B, the cut itself. The A4b sections below are kept because two of
them describe things that are still true and one records a measurement that turned out to be short;
see **What A4b actually cost** before trusting the 16-file list.

Journal: [`overview/entries/2026-08-16-public-repo-cut-a4b.md`](overview/entries/2026-08-16-public-repo-cut-a4b.md).

---

## What A4b actually cost, beyond what was predicted

Three things the plan above did not have, recorded so Phase B does not inherit the same assumptions.

**1. The constants were still a build-time dependency, and the dry-run could not see it.** A3's green
`--all` was read everywhere as "nothing in the published tree needs these files at build time". It
was wrong: `next build` imports every route to collect page data, so seven module-scope loader calls
across six modules opened the files during the build. With them deleted the build died with `ENOENT
... energy-expenditure-features.json` at *Failed to collect page data for /api/achievements* — a
failed Railway deploy, had it been merged blind. Those modules now read on first use, and parity
against the real vendor values was re-proven either side of the change. `publish-dry-run.js` runs no
build gate; that is **Q-306**.

**2. The 16-file list was 17.** It was measured by moving `constants/` aside, which never exercised
the `.onnx` deletion. `oura-ble-rollup-worker.test.ts` compares *durations*, and with no models the
rollup finishes in ~65 ms and trips its own degenerate-comparison guard. Guarded on
`hasRealModels()`.

**3. Guarding per `describe` was still too coarse in three files.** The failures were 49 of 122
assertions and they do not align with block boundaries. Each was guarded on what it asserts, and
verified **both ways** — with the vendor's files restored via `git show` all 122 run; without them 73
run and 49 skip. Only checking the second direction proves nothing, because an over-guard is silent.

**Also worth knowing:** nine of those 49 are guarded not because they are parity checks but because
the synthetic MET table carries values below 1.0, which makes `estWorkoutKcal` return null and leaves
both sides of a consistency assertion empty. Fixing the generator would bring them back, and only a
machine holding the vendor's files can regenerate fixtures. That is **Q-307**.

---

## What shipped

| PR | What |
|---|---|
| #1234 | Inventory, `check-private-paths`, the dry-run, hygiene pass |
| #1311 | Constants read at runtime instead of statically imported (A3) |
| #1323 | Step-decoder table served from an authenticated route, not the bundle (Q-221) |
| #1353 | Constants delivered from object storage at boot (A4a) + the admin bucket report |
| #1384 | Synthetic test constants so CI survives the deletion |

**The new repo exists:** `nekodas-neko/TrainingAi_Open`, public, empty, default branch `main`.

**The bucket is verified.** `GET /api/admin/model-assets` reports `constants.bucket.verdict:
"complete"` — all 34 files present and non-empty, with sizes matching the local copies byte-for-byte.
The models half has read `complete` since A1. Two extras (`README.md`, `index.ts`) rode along in the
console upload; they are inert, the downloader filters `.json`.

---

## [DONE] The one thing A4b still needed, and why it was not mechanical

Deleting `lib/oura-models/constants/*.json` makes **16 test files** fail. Measured on `main` at
`47b331d` by moving the directory aside and running the suite:

```
lib/data/postgres/__tests__/oura-ble-step-rollup.test.ts
lib/data/postgres/__tests__/activity-log-calories.test.ts
lib/health/__tests__/daytime-stress.test.ts
lib/health/__tests__/stress-resilience.test.ts
lib/oura-ble/__tests__/step-counter-pipeline.test.ts
lib/oura-models/__tests__/astd-event-detection.test.ts
lib/oura-models/__tests__/constants-delivery.test.ts
lib/oura-models/__tests__/cumulative-stress.test.ts
lib/oura-models/__tests__/required-models.test.ts
lib/oura-models/__tests__/steps-motion-decoder.test.ts
lib/oura-models/constants/__tests__/index.test.ts
lib/oura-models/inference/__tests__/ots.test.ts
packages/shared/src/health/__tests__/chronic-stress-assembly.test.ts
packages/shared/src/health/__tests__/training-stress.test.ts
packages/shared/src/health/__tests__/workout-energy.test.ts
packages/shared/src/health/daily-energy.test.ts
```

Each needs a `describe.skipIf(!hasRealConstants())` guard, plus this helper re-added — it was in
#1384 and removed again because nothing imported it yet and `check-oura-models-dormancy` fails on
tracked-but-unreachable files:

```ts
// lib/oura-models/__fixtures__/real-constants.ts
import fs from 'node:fs'
import path from 'node:path'
export const REAL_CONSTANTS_DIR = path.resolve(__dirname, '..', 'constants')
export function hasRealConstants(): boolean {
  return fs.existsSync(path.join(REAL_CONSTANTS_DIR, 'MANIFEST.json'))
}
```

**Do not apply this with a regex over every top-level `describe`.** That was tried and backed out
unmerged. It over-guards: `required-models.test.ts`'s `verifyModelAssets` block tests pure functions
against temp directories and has nothing to do with vendor values, so blanket-guarding it gives up CI
coverage for nothing. `constants-delivery.test.ts` is likely the same shape. **Guard per `describe`,
after reading what each one actually asserts.**

Note also: `packages/shared/**` cannot use the `@/` alias into the app root — those four files need a
relative import.

---

## [DONE] The rest of A4b

1. Delete the ten paths in `scripts/private-paths.json` (89 MB on disk; `lib/oura-models/weights/`
   44 MB, `onnx/` 28 MB, `constants/` 12 MB, `docs/oura-models/` 3.7 MB, the rest small). The
   manifest's `excludes` correctly keep our own code — the loader, its types, its tests, the README.
2. Add them to `.gitignore` so a local working copy does not get committed back.
3. **Flip both boot checks to fatal** in `instrumentation-node.ts`. `checkModelAssets` currently
   verifies files **on disk** — it must be repointed at the bucket in the same change or it fails the
   boot immediately. `deliverConstants` already reports; make its failure throw.
4. Write the `NOTICE`. It cannot be written earlier: it states that no third-party model weights are
   included, which is false until they are gone.
5. Verify `node scripts/publish-dry-run.js --all` green with the files **actually deleted**, and
   `next build` clean.

---

## What has never been tested, and is STILL the real risk

**The bucket download path has never executed** — merging A4b did not change that; the deploy will.
 Every run so far has taken the repo-copy branch in
`ensureConstantsAvailable()` and returned before touching object storage. Session sandboxes hold
placeholder storage credentials that reject with `SignatureDoesNotMatch`, so it cannot be exercised
here at all — only the pure report-building logic is covered by tests.

Its first real run is the Railway deploy that merges A4b. That ordering is deliberate — a delivery
mechanism added *after* a deletion is one nobody tested — and it is exactly why step 3 above makes
the check fatal in the same change. A failed download must fail the deploy, not quietly serve a
half-populated directory.

Also never verified: the offline path for the decoder-constants cache (#1323) on the S25 — one
online session, kill, relaunch with no network, walk, confirm detection still fires. There is a
Known-Issues row for it.

---

## Phase B, after A4b

Runbook: [`docs/public-repo-cut-runbook.md`](public-repo-cut-runbook.md). Steps 7 (create repo) is
done. Remaining: push the snapshot (fresh `git init`, one commit — **not** a history rewrite, because
89 MB sits across the old history and missing one trace is the failure mode), CI + branch protection,
verify the `apk-latest` URL logged-out, repoint Railway with
`APK_RELEASE_REPO=nekodas-neko/TrainingAi_Open`, set `ADMIN_EMAIL`, archive the old repo last.

**Rollback stays available throughout:** the old repo remains a working Railway target until the
final step, and that step archives rather than deletes it.

---

## Two process notes worth carrying

**Parallel sessions collide on this backlog.** #1322 was 90% wasted work because another session took
Q-221 off the queue and merged it as #1323 nine minutes later. The collision was invisible until
`git merge` reported an add/add conflict on a route file. Check the open-PR list, not just the queue
file, before starting an item.

**`check-oura-models-dormancy` only sees tracked files.** A new helper added but not yet imported
passes locally until it is committed, then fails CI. Cost one CI round on #1384.

---

## Pickup prompt

```
Continue the TrainingAI public-repo migration (Q-49) at Phase B.

Read in this order: projectOverview.md -> docs/domains/platform/README.md ->
docs/handoff-2026-08-16-platform-public-repo-cut-a4b.md -> docs/public-repo-cut-runbook.md.

Phase A and A4b are done. Oura's material is out of the tree (check-private-paths reports
"total tracked: 0.0 MB"), both boot checks are fatal against the bucket in production, and the
NOTICE is written. The public repo nekodas-neko/TrainingAi_Open exists, is public, and is empty.

FIRST ACTION, before any Phase B step: confirm the A4b deploy is healthy. The bucket download
path had never executed anywhere until that deploy, so this is the one unproven mechanism in
the whole migration. A healthy Railway boot log has two lines —
  [instrumentation] model constants: bucket - downloaded 34 file(s)
  [instrumentation] model assets: 8 file(s) in object storage
Anything else and the process did not come up. GET /api/admin/model-assets as a logged-in admin
answers why; reverting the deploy restores a tree that still has the files. Do not start step 8
until those lines exist.

Then Phase B is runbook steps 8-14: push the snapshot (fresh git init, ONE commit - not a
history rewrite, because ~89 MB sits across the old history and missing one trace is the
failure mode), CI + branch protection with the same six required checks, verify the apk-latest
URL logged-out, repoint Railway with APK_RELEASE_REPO=nekodas-neko/TrainingAi_Open, set
ADMIN_EMAIL, and archive the old repo LAST. Steps 8, 9 and 13 are the agent's; 10, 11, 12 and
14 are the owner's.

Constraints you would otherwise rediscover:
- Rollback stays available throughout. The old repo remains a working Railway target until the
  final step, and that step archives rather than deletes it.
- publish-dry-run runs no `next build` gate. That gap is what let a real build-time dependency
  through in A4b (Q-306). If you change anything about what the published tree contains, run
  `next build` yourself; the dry-run's green does not cover it.
- Session sandboxes hold placeholder storage credentials that reject with SignatureDoesNotMatch.
  Anything bucket-shaped cannot be exercised here, only in a deploy.
- CI has six required checks, not five; E2E was added 2026-08-16 and has flaked once. Re-run
  with an empty commit before diagnosing an E2E failure.
- Job logs end with a long Postgres container dump, so get_job_logs needs tail_lines 600+.
- Check the OPEN PR LIST before taking any backlog item, not just the queue file. Parallel
  sessions work this same queue - #1322 was 90% wasted because another session shipped the same
  item as #1323 nine minutes later.
```
