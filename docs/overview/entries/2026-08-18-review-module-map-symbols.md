# 2026-08-18 — Review sweep 37: the module map's symbol claims all hold

**Agent:** Review 📖 · **Branch:** `review/module-map-symbols` · **Docs + one CI check.** No finding filed.

Sweep 36 shipped a path check and recorded its limit in the same breath — it proves a path *resolves*,
never that the prose beside it is true. This sweep took that limit as the lens. The mechanically
checkable part of a description is the `→ symbolName` claim, which is also the part a reader acts on,
since it is what sends them to a specific function.

**The result is clean: 110 of 110.** Every `path → symbol` claim in `docs/module-map.md` names a
symbol that exists in the file it is attributed to.

That is worth stating plainly, because a sweep that finds nothing is easy to under-report — and
because it **bounds** the worry sweep 36 raised rather than leaving it hanging. Row 232's failure, a
map row for a module that was never built, was not the tip of a pattern of sloppy attribution. It was
one row, and its path was wrong too, which is exactly why the cheaper check caught it.

**A correction inside the measurement, and the more useful half of this entry.** The first probe
reported 72 of 110 rows having a resolvable file — which would have meant 38 broken paths, flatly
contradicting the check shipped an hour earlier that had certified every path in that same document.
The probe was wrong, not the check: it resolved paths literally, without the `lib/…` →
`packages/shared/src/…` remap the monorepo extraction made necessary (Q-153) and which the shipped
check already applies. With the remap, 110 of 110 resolve. **A new measurement that contradicts an
existing green check is a bug in the measurement until proven otherwise** — reporting "38 broken
paths" would have been a confident, checkable, wrong claim.

Three further claims in the domain indexes are skipped. All three are prose *about* the Q-554
finding, quoting the one path that check carries as deliberately absent. Both checks skip it by the
same test so they cannot disagree — the third time in two sweeps that documentation describing an
absent path has tripped a checker looking for absent paths, now noted in both scripts' headers.

**Shipped:** `scripts/check-module-map-symbols.js`, step 43 of 43 — a ratchet on a property that
currently holds, in the spirit of the hex-literal and component-size baselines. Deliberately a
presence check rather than a resolver: the failure worth catching is a symbol that moved or was
renamed, leaving the map pointing at its old home, and that shows up as absence. It earns a check at
zero current violations because *"One Formula, One Place"* names this map as the way to find an
existing implementation before writing a new one — so a row pointing at the wrong file is how a
second copy of a formula gets written, by someone who checked first exactly as instructed.

**Not exercised:** static. A row naming a real file and a real function while describing behaviour
neither has still passes; that half is unmeasured. No runtime, no device.
