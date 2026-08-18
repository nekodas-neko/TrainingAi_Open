# Review — do the module map's `path → symbol` claims hold? (they do)

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 37** · **Finding:** none · **Shipped:** one ratchet

## Why this lens

Sweep 36 shipped `check-index-doc-paths.js` and recorded its limit in the same breath: *"The check
verifies a path **resolves**, never that the description beside it is accurate — row 232 was caught
only because its path happened to be wrong too. A row naming a real file while describing behaviour it
does not have would still pass."*

This sweep took that limit as the lens. The mechanically checkable part of a description is the
`→ symbolName` claim, which is also the part a reader acts on: it is what sends them to a specific
function.

## Result — clean, all 110

**Every `path → symbol` claim in `docs/module-map.md` names a symbol that exists in the file it is
attributed to.** 110 of 110, zero exceptions.

That is a real negative result and it **bounds the worry sweep 36 raised** rather than leaving it
open. Row 232's failure — a module map row for something never built — was not the tip of a pattern
of sloppy attribution. It was one row, and its path was wrong too, which is why the cheaper check
caught it.

Worth saying plainly because a sweep that finds nothing is easy to under-report: the map's
*attribution* is in good shape.

## The measurement, and a correction inside it

The first probe reported **72 of 110** rows having a resolvable file, which would have implied 38
broken paths — flatly contradicting sweep 36's check, which had just certified every path in the same
document.

The probe was wrong, not the check. It resolved paths literally, without the `lib/…` →
`packages/shared/src/…` remap that the monorepo extraction made necessary (Q-153) and that
`check-index-doc-paths.js` already applies. Adding it gave 110 of 110 resolvable, 0 unresolved.

**A new measurement that contradicts an existing green check is a bug in the measurement until proven
otherwise.** Reporting "38 broken paths" would have been a confident, checkable, wrong claim — and it
would have been reported an hour after shipping the check it contradicted.

## The three claims that are skipped, and why they are not a gap

The domain indexes carry three further `path → symbol` claims, all skipped. All three are prose
*about* the Q-554 finding, quoting `lib/oura-ble/steps-motion-decoder.ts` → `decodeStepsPacket` — the
path that does not exist, which `check-index-doc-paths.js` carries as a `DELIBERATE` entry.

Both checks skip it by the same test, so they cannot disagree. This is the third time in two sweeps
that **documentation describing an absent path trips a checker looking for absent paths**; the pattern
is now explicit in both scripts' headers.

## The guard

`scripts/check-module-map-symbols.js`, step **43 of 43** in Custom Rules. It is a ratchet on a
property that currently holds, in the same spirit as the hex-literal and component-size baselines —
not a backlog of known breakage.

Deliberately a **presence** check, not a resolver: it asks whether the identifier appears in the file
at all, not whether it is exported or whether the signature matches. A real resolver needs the
TypeScript program, and the failure actually worth catching — a symbol that moved or was renamed,
leaving the map pointing at its old home — shows up as absence.

**Why this specific claim earns a check even at zero current violations:** `CLAUDE.md`'s *"One
Formula, One Place"* rule names the module map as the way to find an existing implementation before
writing a new one, and calls two implementations of the same metric *"a bug by definition"*. A row
sending a reader to the right file for a function that is not in it is precisely how the second copy
gets written — by someone who checked first, as instructed.

## Not exercised

Static. The check cannot see whether a row's **prose** is accurate beyond the symbol name — a row
naming a real file and a real function while describing behaviour neither has still passes. That
half remains unmeasured and is not addressed here. No runtime, no device.
