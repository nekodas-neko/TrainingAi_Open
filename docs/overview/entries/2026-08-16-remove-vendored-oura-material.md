# 2026-08-16 — Phase A of the public-repo cut is done; A4b is teed up

**Branch:** `feat/remove-vendored-oura-material` · **Handoff:**
[`docs/handoff-2026-08-16-platform-public-repo-cut-a4b.md`](../../handoff-2026-08-16-platform-public-repo-cut-a4b.md)

Two PRs landed and the last blocker on the migration was solved. **Nothing has been deleted yet** —
that is A4b, and it is the next session's work.

## What shipped

**#1353 — constants delivered from object storage at boot (A4a).** A3 made them readable at runtime;
nothing put them anywhere else, so deleting them would have left production with no source.
`ensureConstantsAvailable()` prefers the repo copy, then a per-deploy cache, then the bucket. Awaited
in `instrumentation-node.ts` rather than `void`-ed, because the loader is synchronous and a
fire-and-forget download would race the first request.

It also made the upload **verifiable**: 34 filenames pinned in `model-files.json`, cross-checked
against the tree by a test that skips itself once the tree is gone, and reported through
`GET /api/admin/model-assets`. That earned itself within the hour — the owner's console upload landed
**33 of 34**, dropping `stress_daytime_sensing_1_1_0.tables.json`. Without the pinned list a
33-of-34 upload is indistinguishable from a complete one, and the gap would have surfaced weeks later
as an unexplained 500. Root cause was a stale clone, not a bad upload: the file was not in the
owner's working copy.

**#1384 — synthetic test constants.** The last unsolved problem in Q-49, and it had been hiding
behind a green dry-run: `publish-dry-run --all` gets its green with `OURA_CONSTANTS_DIR` pointed at
the real directory, which models production but not CI. Removing the vendor JSON and running the
suite the way CI would fails ~24 files.

A bucket credential in Actions secrets was the obvious fix and was rejected: **a public repo's test
suite must not require secrets** — fork PRs are not given them, so the suite would be red for any
outside contributor forever.

Fixtures keep every key and non-hash string and replace every number. That split is what makes
publishing them safe: our ports must *name* the keys they read, so those names are already in the
published source, while the numbers are the vendor's tuning.

## Three things measurement corrected

**The first scrub leaked SHA-256 provenance.** `MANIFEST.json` and every `source.sha256` carry hashes
of the original `.pt` binaries — not the IP, but a fingerprint sufficient to confirm a suspected file
is the one we hold. Now mapped through a shared table so equal hashes stay equal.

**Hand-tracing which constants to fixture was wrong within the hour.** Following imports found seven
consumers and six files; the suite then failed on `cumulative_stress_1_2_2`, read at module scope
through a getter the grep pattern missed. The list now comes from the filename literals in
`constants/index.ts` — the one file that decides what is readable.

**"Tests always use fixtures" did not survive contact.** The design shipped as fixtures-when-absent
instead. Eighteen files are parity tests pinned to the vendor's forward pass, and a synthetic table
makes those assertions arbitrary rather than merely different. The divergence argument that motivated
the stricter rule does not hold either: a parity test cannot run in CI under *any* design, so the
tests that run in both places are exactly the ones insensitive to the values.

## Where it stopped, and why

A4b was started and deliberately not finished. The 16 files that fail once the constants go are
measured and listed in the handoff. The `skipIf` guards were applied with a regex over every
top-level `describe` and **backed out unmerged** — it over-guards, because
`required-models.test.ts`'s `verifyModelAssets` block tests pure functions against temp directories
and has nothing to do with vendor values. That wants per-`describe` judgement, not a pattern match.

## Not verified

**The bucket download path has never executed anywhere.** Every run takes the repo-copy branch and
returns before touching object storage; sandbox storage credentials are placeholders. Its first real
run is the deploy that merges A4b — which is why that change must make the boot check fatal in the
same commit.

E2E flaked once on #1384 and passed on an identical tree after an empty-commit re-run. Worth knowing
it is two commits old and not yet trustworthy.
