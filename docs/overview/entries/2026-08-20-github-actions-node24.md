# 2026-08-20 — every workflow was pinned to a runtime GitHub is withdrawing (LA-17)

**Branch:** `chore/bump-github-actions` · **Lane A** · closes **LA-17**

## What it was

Every job in all three workflows pinned actions targeting **Node 20**, which GitHub already
force-runs on Node 24 while warning on every job of every run. Nothing was broken — the shim works —
but it is a **dated** failure: when the shim goes, every workflow fails at its first step at once, on
a day nobody chose.

## The finding that decided how to do it

**Bumping uniformly would have been wrong, and would have looked right.** The versions were resolved
per action, from each one's own `action.yml` `runs.using` — the pinned source, not release-note prose:

| action | was | `runs.using` | bumped to |
|---|---|---|---|
| `actions/checkout` | v4 | `node20` → v5 is `node24` | **v5** |
| `actions/setup-node` | v4 | v5 is `node24` | **v5** |
| `actions/setup-java` | v4 | v5 is `node24` | **v5** |
| `pnpm/action-setup` | v4 | `node20` → v5 is `node24` | **v5** |
| `actions/upload-artifact` | v4 | **v5 is still `node20`** | **v6** |

`upload-artifact` is the one that matters: a uniform *"everything to v5"* would have left it on Node 20
while the deprecation looked cleared. Its own v5 release notes even say *"this update supports Node
v24"* — and the `action.yml` at that tag says `node20`. **The file beat the prose**, which is the
external-field-names rule doing exactly what it exists for.

These are **minimum** bumps, not latest: `checkout` is on v7 and `upload-artifact` on v7 by now.
Minimum clears the deprecation with the smallest behaviour delta, and this is not the change to take
extra risk in.

Every bump is runtime-only with no input-schema change — checked, because Custom Rules now depends on
`checkout`'s shallow default plus an explicit `git fetch --depth=1 origin main` (Q-424), and
`pnpm/action-setup` still takes the `version` input this repo passes. All require Actions runner
≥ 2.327.1, which `ubuntu-latest` has.

## What this PR can and cannot verify

- **`ci.yml`** — verified by this PR's own run, as always.
- **`android.yml`** — also verified here, because its path gate includes **itself**, so editing it
  triggers the workflow. That was worth checking rather than assuming: it is otherwise gated to
  native paths a workflow-only change does not touch.
- **`android-emulator.yml`** — **cannot be verified by any PR.** Its `pull_request` trigger is
  commented out pending Q-250; it is `workflow_dispatch`-only. The bump matches the versions the
  other two proved on a real run, and a note at the top of that file says it is unverified and to
  re-check when Q-250 turns it back on.

## Not exercised

Nothing user-facing; no route, schema, or device surface. The APK publish path in `android.yml` runs
on this PR as a build, but **the release-publishing step only runs on push to `main`** — so that half
is exercised by the merge, not by the PR.
