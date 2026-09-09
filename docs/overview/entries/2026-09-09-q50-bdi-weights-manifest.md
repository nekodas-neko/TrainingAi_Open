# 2026-09-09 — "keep them" is only a decision if something uploads them (Q-50 item 2)

**PR:** `lane-a/q50-bdi-weights-manifest` · **Lane A** · no migration, no client change.

## The gap

The owner decided on 2026-08-03 to keep the two BDI weight files (`sleepnet_bdi_0_3_0_core.onnx`,
`sleepnet_bdi_0_4_0_core.onnx`) rather than delete them — extracted assets that cannot be re-derived
from this repo, and a future BDI revision is exactly what would want them.

**Nothing acted on that decision.** The `.onnx` files are gitignored and live in object storage;
`model-files.json` is the manifest that decides what gets uploaded there, and the BDI weights were in
neither its `required` list nor any other. Their *constants* were listed. The weights were not. So
"keep them" was a sentence in a backlog entry with no mechanism behind it, and the next rebuild of
the bucket from this manifest would have quietly dropped them.

They could not simply go in `required`: that list is what the boot check demands, and
`required-models.test.ts` asserts it equals exactly the set of `.onnx` literals in `inference/`.
Adding an unloaded file there would both fail that test and turn a healthy deployment into a reported
fault.

## What shipped

A second list, `keptNotLoaded` → `KEPT_MODEL_FILES`. `scripts/upload-model-assets.js` sends
`required + kept`; the boot check reads `required` alone and ignores the rest. Two tests hold the
distinction in both directions: kept ∩ required = ∅, and no kept file is named by an `inference/`
loader — so a file that *gains* a loader must be **moved** rather than left in a list nothing
verifies. Four mutants, all caught (folding a kept file into `required`, emptying the list, listing a
loaded file as kept, aliasing the export back to `required`).

## A stale claim in the entry, corrected

Q-50 closed with *"Both are registered in `scripts/check-oura-models-dormancy.js`'s `KEEP` map with
these reasons, so CI passes and the inventory is explicit rather than forgotten."* That has not been
true since Q-49 A4b, which removed every vendored-asset entry from that map on the correct reasoning
that *"an exemption for a file that cannot be listed exempts nothing"* once the files became
gitignored. The map holds one entry now.

Nothing was broken by it — the sweep cannot see these files either way — but the entry was pointing
at a safety net that no longer exists, which is precisely the state in which a decision gets
forgotten. Second stale backlog claim found today; the other one was hiding a live bug.

## What is deliberately not done

**Item 1 (`inference/dhrv`) is untouched and stays deferred to D7**, per the entry's own reasoning:
that ONNX path is unreachable from production on purpose, and its golden test is what pins our D5
regression replacement against Oura's original. Deleting it now would discard the validation while
the replacement is still young. The entry keeps a `Keep:` line saying so, so it no longer prints as
startable work.

**Not exercised:** the upload itself. `scripts/upload-model-assets.js` needs bucket credentials this
sandbox does not hold, so the manifest change is verified by tests and by reading, not by a run
against storage. `--check` against the real bucket is the confirmation, and it is owed.
