# BF-141 (Lane A half) — one lb↔kg constant, so the toggle cannot grow a second one

**Branch:** `lane-a/bf141-lbs-to-kg-constant` · **Lane A** · no migration, no native change.
**The entry stays open** — the dial and the toggle are Lane B's, and this hands over to them.

## Why a constant move is the engine half of a UI feature

`LBS_TO_KG = 0.45359237` was a private const in `lib/data/postgres/adapter.ts`, written for the
2026-06-15 repair tool that corrected three dumbbell exercises logged in pounds into the `weight_kg`
column — inflating 1RM, target80, volume and the all-time PR until an admin preview/apply tool undid
it. The toggle that stops that recurring needs the same number on the client. Writing a second copy
there is how two implementations of one metric begin, which is the class **One Formula, One Place**
exists for.

It now lives in `packages/shared/src/workout/units.ts` with `lbsToKg`/`kgToLbs`, and the adapter
imports it.

## Neither helper rounds, and that is the load-bearing decision

The entry flags the hazard precisely: `mround125` clamps to **[5, 250]**, so a 5 lb dumbbell —
2.268 kg — would floor to **5 kg**, silently more than doubling it. A converted value must not pass
through the kg grid at all.

A helper that rounded itself would bury that decision one call away from where it matters, so both
functions convert exactly and the call site rounds for storage. The test pins it from the failure
side: `lbsToKg(5)` must be **less than 5**.

## The guard that needed narrowing, for the third time today

My first version asserted that `0.45359237` appears in exactly one file. It failed on two
**legitimate** hits: the adapter's comment, which still names the value while importing it, and the
test's own assertion. Matching raw text catches prose.

The assertion now strips comments and looks for a *declaration* (`const|let|var … = 0.45359237`).
This is the third time today the comment-vs-code distinction has bitten a source-level guard —
LA-101's and RV-41's both failed the same way first. Worth noticing as a pattern rather than three
coincidences: a source guard's first draft matches text, and text includes the explanation of why
the guard exists.

## Verification

7 tests. Mutation pass: the constant truncated to `0.4536`, the conversion made to snap onto the
1.25 kg grid, and the adapter re-declaring its own copy — **three mutants, all killed**; an
equivalent control (`kg / LBS_TO_KG` → `kg * (1 / LBS_TO_KG)`) survived.

## Already done, checked rather than repeated

The entry says the false `projectOverview.md` LB-41 claim — *"with real unit display filed as the
feature it would actually be"*, where no such entry ever existed — is *"corrected in this same PR"*.
It was already corrected when BF-141 was filed. Nothing owed.

## Not exercised

No device path, no APK, no API route — a shared constant and its two callers.
