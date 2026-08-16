# 2026-08-02 — the vendored-model tree gets a dormancy check (Q-49 Phase A0)

_Branch `chore/oura-models-dormancy-sweep` · PR #1015 · no version bump · domain `platform`_

Queue head. Phase A0 of the [public-repo migration](../../superpowers/plans/2026-08-02-public-repo-migration-roadmap.md),
which is #999's Task 0: sweep `lib/oura-models/` of files nothing reaches, and assert the sweep so the
tree cannot silently re-accumulate them.

## What shipped

`scripts/check-oura-models-dormancy.js` — file-level reachability over the tree. Roots are the modules
imported from *outside* `lib/oura-models/`; everything transitively reachable is live; assets
(`.onnx`, `.constants.json`) are live when a live module names them. Wired as a Custom Rules CI step,
into `pnpm ci:local`, and pinned by a `pnpm test` case.

**Verified falsifiable rather than assumed:** dropping a one-line unreferenced module into the tree
makes the check fail and name it; removing it makes the check pass again.

**7 files deleted** — `lib/oura-models/onnx/constants/*.json` was a **byte-identical duplicate** of
`lib/oura-models/constants/*.json` (`cmp` clean on all seven), referenced by nothing. 4 MB.

## A0 was not "pure subtraction", which is what the plan called it

Of 28 initially-flagged files, exactly 7 could be deleted on evidence. The other 21 each needed a
judgement the sweep is not entitled to make, and both categories are now registered in the script's
`KEEP` map with their reason — so CI passes and the inventory is explicit rather than forgotten.

**19 constants with no importer are A1's payload, not deletions.** `constants/index.ts` statically
imports 12 of 31; the other 19 are all indexed by `MANIFEST.json` (31 keys, 31 files, no drift either
way), which is the provenance record carrying each file's original `.pt` sha256. Deleting one desyncs
the manifest — and Q-49 A1 *moves* these to private storage anyway.

**Two BDI weight files have no loader.** `sleepnet_bdi_0_3_0_core.onnx` / `0_4_0_core.onnx` are never
named by a `MODEL_FILE`; BDI comes from the moonstone model's own apnea head (`bdiFromApnea`). Filed
as Q-50 — they are extracted weights, unrecoverable from this repo, and a future BDI revision is
exactly what would want them.

## The plan told me to delete something the module map says to keep

Both the triage plan and the roadmap's pickup prompt say to delete `inference/dhrv` as "outright dead
code, deletable today". **I wrote the first version of that claim myself**, in the run-list row for
#999, so this is my error being corrected as much as anyone's.

It is half right. `runDhrvImputation` is reached only through `computeDaytimeStress` /
`buildDaytimeStressSeries`, and since D5 replaced that path with our own regression those two are
called from **tests alone** — production goes through `buildDaytimeStressSeriesFromModel`. So it is
production-dead.

But the unreachability is **deliberate and has a named exit condition**. `docs/module-map.md` and
`docs/oura-ondevice-hybrid-implementer-progress.md` both record that the ONNX path *"stays
golden-tested but unreachable from production **until D7**"* — that golden test is what pins our own
D5 regression against Oura's original, while the replacement is still young enough to want the check.
Deleting it is a D7 decision, not a sweep. Corrected in all three docs that carried the wrong wording,
and filed as Q-50 finding 1.

## A limit the script states about itself

This is **file**-level reachability, not function-level, and `inference/dhrv` is the worked example:
`daytime-stress.ts` imports it, so the script calls it live even though the only function that reaches
it is test-only. A module can pass this check and still be production-dead. The header says so
explicitly — a green run means "nothing here is unreferenced", not "nothing here is dead". Closing
that gap needs call-graph analysis, which is a different tool and not worth building for one tree.

## Not verified

Nothing device-, migration- or user-facing is touched, so no device gate applies and **no version bump
or changelog entry** — the only runtime-visible change is 7 duplicate JSON files no longer being
present, and nothing read them.
