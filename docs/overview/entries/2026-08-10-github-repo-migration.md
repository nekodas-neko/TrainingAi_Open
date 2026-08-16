# 2026-08-10 — the public cut gets an inventory, a CI story, and a dry-run (Q-49 Phase A)

_Branch `claude/github-repo-migration-vc83mp` · domain `platform`_

Session goal: audit where the public-repo migration stands, make sure the Oura models cannot reach a
public repo, and take every part of Phase A that does not need the owner.

## The audit found the plan was scoped to the wrong half

Q-49, `required-models.ts`, `model-files.json`, `scripts/upload-model-assets.js` and both plans
cover the **8 `.onnx` files (22.8 MB)**. `lib/oura-models/constants/` (11.6 MB) is known and
deferred with a stated reason. A measured sweep of the tree finds **81.2 MB across seven
directories**, so **46.9 MB was in no plan, no script and no ignore rule**:

| Uncovered | Size | What it is |
|---|---|---|
| `lib/oura-models/weights/` | 43.6 MB | 14 `.npz` — the vendor's full trained tensors |
| `docs/oura-models/` | 2.3 MB | **271 `.py` — the vendor's decompiled model source** |
| `scripts/oura-models/_source/` | 0.9 MB | **148 `.py` — a second copy of the same** |
| `.agents/skills/oura-models/` | 0.1 MB | Six documents on the vendor's model internals |
| `.agents/skills/oura-native-ble/` | 40 KB | The BLE protocol knowledge base |

Following the roadmap literally would have published decompiled third-party source and a raw weight
archive in the public repo's first commit. **The `.onnx` files were never the sensitive item.**

The compensating find: nothing imports any of those five paths — they appear only in comments. So
the unplanned half is also the half that leaves for free.

## What shipped

**The inventory is a gate, not a document.** `scripts/private-paths.json` records each path with its
kind, reason and archive destination; `scripts/check-private-paths.js` proves the `importedByCode`
claim each entry makes, rather than restating it. Custom Rules CI step, `pnpm ci:local`, pinned by a
test. Verified falsifiable: injecting a real import of `weights/` fails it by name.

**The stated blocker is gone.** Fourteen test files read the `.onnx` files off disk and CI has no
bucket credentials — that, not the decision, was what stopped the models leaving. They now run from
recordings of themselves (`inference/__tests__/helpers/replay-session.ts`): the frozen binary is
replaced by its output, and every line of our code around it still executes. Recordings are keyed by
a hash of the feeds, so a changed test input fails with "no recording for this input" instead of
comparing against a stale one. **Measured with all ten `.onnx` removed: every model-dependent test
in the repository passes.** 240 KB of recordings replaces 22.8 MB.

Two tests are skipped rather than converted, both deliberately. `wasm-parity` compares two runtimes
over the same bytes, so replaying either side would assert a recording against itself — it needs the
real models and now says so. The `required-models` disk-presence check holds only while the tree is
where the models live.

**Personal details and vendor-source pointers are out.** Three files carried the owner's email;
seventeen comments named the decompiled-source directories. Migration 006's admin grant moved to an
`ADMIN_EMAIL` boot-time bootstrap — the migration form was wrong regardless of the address, since a
migration runs once and cannot notice a row that appears later. The MIT licence named an unrelated
third party, inherited from a template.

**The dry-run is what makes the cut safe.** `scripts/publish-dry-run.js` builds the tree as the
public repo would have it and runs the full gate against it, reporting a failure only when the
unmodified tree passes the same gate. It earned its keep immediately: three test files reach the
models transitively and never matched a grep for the ONNX directory.

## Where it leaves the migration

- `--ready` (46.9 MB, every decompiled-source file): **green**. Can be removed today.
- `--all` (81.2 MB): blocked on **one static import** — `constants/index.ts`. The ~170 test failures
  it reports are one root cause: `adapter.ts` fails to import, taking every DB test with it.

A3 is scoped in [`2026-08-10-constants-runtime-loader.md`](../../superpowers/plans/2026-08-10-constants-runtime-loader.md)
and is smaller than Q-49 assumed — no client component imports the constants, so it is a lazy
`readFileSync` behind ten existing getters, plus the MET table, which should be **replaced** from the
public Compendium rather than moved (it is the one file on a client chain).

## A second review found three more gaps

The owner asked for a scope re-check before the cut. It was warranted.

**The "public code is a shell" claim was wrong for one file.** `lib/health/daytime-stress.ts` had
the dHRV feature scaling and four saturation tables typed inline, not imported — invisible to a
check that looks for imports. `scripts/check-inlined-constants.js` now compares numeric arrays
against the vendor constants *and* against literals in the vendor's traced source, filtered to
arrays that cannot be coincidence. Swept over the repository it returned that one file and nothing
else. Fixing it surfaced a second bug: tensor attributes are wrapped, not bare, so reading one as an
array typechecks and yields `undefined` at every index — every feature became NaN and every
inference a silent `null`. The golden tests caught it.

**Three docs are recipes, not records.**
`docs/superpowers/plans/2026-07-09-oura-ble-accurate-sleep-staging.md` carries provenance detail of
the most sensitive kind — the category `scripts/private-paths.json` calls `vendor-procedure`, which
is of use to a reader holding none of the rest. It was the most sensitive file in the repository and
nothing had flagged it. (What it contained was described here in full until 2026-08-16, which
defeated the point of excluding the file; the detail is in the archived private repository.) Plus the
bundle-provisioning doc and the extracted-model inventory. Removing them breaks five links, so the
dry-run runs the link check too: those links resolve in the working tree and break only in the
published one.

**The deploy would not have been smooth.** `.env.example` documented 13 of 33 variables — missing
the storage credentials that now serve the models, the Oura token encryption key, and both push
keys. Also found: `lib/github-release.ts` hardcodes the old repo (must change at B4),
`capacitor.config.ts` hardcodes the Railway domain (must **not** change), and
`exercise-gif-matcher.ts` fetches from a separate `exercises-dataset` repo that must be public for
`raw.githubusercontent` to serve it — unverified, outside this session's repo scope.

**Empirically, not by grep:** the whole suite now passes with all ten model files removed. Six more
tests reached a model transitively and none mentioned the ONNX directory. `--ready` is green on all
six gates.

## Orientation cost, raised by the owner

`CLAUDE.md` (~27k tokens) plus `projectOverview.md` (~167k) is **~194k tokens of mandatory reading
before any session acts**. `CLAUDE.md` calls the second file "a lean index"; it is 8,068 lines.
Known Issues is 72% of it — 267 entries averaging 22 lines, 63 resolved and 204 open. Archiving the
resolved ones buys 17%; the rest is a real backlog, not formatting. Filed as **Q-220** with a plan.

## Not verified

No device run: nothing here touches an offline-first domain, a native plugin, safe-area or
notifications. `bootstrapAdmin` has **not** been exercised against a real fresh database — it is
auth-adjacent and wants the owner's sign-off before merge. The bucket upload for the newly-identified
private paths cannot run from a session sandbox (the credentials here are non-authenticating
placeholders), so nothing has been archived yet and nothing has been deleted.

**Correction, same day.** That bucket upload was written up as a required owner action. It is not:
the old repository is archived rather than deleted, so its git history keeps every private path
retrievable, and the decrypted `.pt` originals those paths were derived from are already in the
bucket. `scripts/archive-private-paths.js` is redundancy for the residual case — re-deriving from a
`.pt` needs tooling this project no longer has, and the hand-written skills and extraction docs were
never derived from one. The owner caught the overstatement by asking whether it was already
uploaded.
