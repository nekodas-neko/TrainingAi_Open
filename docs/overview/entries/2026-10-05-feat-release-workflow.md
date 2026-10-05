# 2026-10-05 · Release-train plumbing (Phase 2)

The workflow half of the release train
([spec §8, Phase 2](../../superpowers/specs/2026-10-05-release-train-design.md)): production stops
being "whatever merged last" and becomes a tag the owner approves.

## What landed

- **`.github/workflows/release.yml`** — `workflow_dispatch` taking a commit and a version. It
  verifies the commit is on `main` and that `package.json` agrees with the version, deploys with
  the Railway CLI under the `release` environment, confirms production is serving that commit,
  **then** tags and publishes notes, **then** attaches an APK built from the tag.
  The order is the point: the `v*` ruleset blocks tag deletion, so a tag created before a failed
  deploy would be permanent and wrong. It is also why the `release` environment must stay
  unrestricted by ref — at deploy time the tag does not exist yet.
- **`.github/workflows/deploy-check.yml`** — gains `workflow_call` with a `sha` input so the
  release can use it. Keeps its `push: [main]` trigger until auto-deploy is actually off.
- **`scripts/check-deploy-landed.js`** — `EXPECT_SHA` wins over `GITHUB_SHA`, because the release
  ships a commit chosen at dispatch rather than the one the run is checked out at.
- **`.github/workflows/android.yml`** — gains `workflow_call` with `release_tag`, checks out the
  tag, and attaches `app-v<x>.apk` to that release. The stable-signing-key condition had to widen
  with it: a release APK signed with a throwaway per-runner key cannot install over the owner's
  copy, and the way through would be an uninstall, which destroys the ring's BLE key.
- **`.github/labels.yml` + `scripts/sync-labels.js` + `.github/workflows/labels.yml`** — 28 labels
  on five axes (`area:` for the eleven pillars, `kind:`, `priority:`, `status:`, `role:`),
  synced additively from the file. They are what replaces the backlog's `Lane:`, queue position
  and `[domain]` tag once Phase 3 migrates.
- **Issue templates (bug / feature / chore), a PR template, `.github/release.yml`** — the
  collaboration surface, since a second person is meant to be able to file and pick up work
  without reading the agent docs first.
- **`scripts/check-workflow-job-timeouts.js`** — exempts jobs that are `uses:` a reusable workflow;
  GitHub rejects `timeout-minutes` on those, and the limit belongs to the called workflow's jobs.

## Deliberately not done

The `ci.yml` docs-skip, moving E2E into the release, and retiring the rolling `apk-latest` build —
all three with their reasons recorded in the spec's Phase 2 progress note. The short version: the
first two are one `ci.yml` restructure that must be revertable on its own, and the third would
leave nothing installable between releases until the `.dev` app exists.

## Verification

`pnpm check:rules` ran **86 of 86**, all passed. `check-doc-links` and `check-doc-index-size`
clean. `scripts/__tests__/deploy-landed.test.ts` (13), `run-custom-rules` and `github-release` (15)
pass. `node scripts/sync-labels.js --dry-run` reads all 28 labels and resolves each against the
live repo.

**Not exercised:** none of the new workflows has run. `release.yml` cannot be until the first
release is dispatched, and the APK path needs a runner with the Android SDK, which this sandbox
does not have. No app code changed, so there is nothing device-verifiable here.
