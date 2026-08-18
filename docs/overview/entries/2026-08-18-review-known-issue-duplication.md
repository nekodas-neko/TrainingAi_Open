# 2026-08-18 — Review sweep 35: a Known Issue in two lists at once

**Agent:** Review 📖 · **Branch:** `review/domain-index-drift` · **Docs + one CI check.** Filed and fixed **Q-553**.

Sweep 34's baton set the direction — *audit prose that duplicates a machine-checked fact* — after
three instances of the pattern had accumulated. This sweep looked for the same shape somewhere with
**no** check at all. The obvious candidate: the two Known-Issue lists.

`CLAUDE.md` states the invariant plainly — *"Striking a Known Issue means MOVING it … Cut the entry
whole, append it to the archive, leave nothing behind"* — and nothing enforced it.

**Two entries were in both lists**, each the result of the same two-part mistake: the move was done as
a **copy**, and it was done **early**.

**Q-139** read `🔴 Q-139 — resolveDsToMs compresses ring time by up to 18× … (found 2026-08-07, OPEN)`
in `projectOverview.md` — 69 lines describing the bug as unfixed — while the archive recorded it
`✅ fixed 2026-08-08, v1.270.25`. That stood for ten days, in the one artefact every session is
required to read before starting work. Both halves are genuinely fixed, and that was verified **in
source** rather than taken from the archive: `resolveDsToMs` applies a fixed slope with a per-epoch
p10 offset, and the sibling gap the live row called *"worth closing as a backstop"* is closed at
`packages/shared/src/health/step-estimate.ts:176`, whose comment names Q-139.

**Q-81** was a byte-identical 31-line entry in both files.

**Both were also archived while something was still owed** — the half that is easy to miss. The rule
permits a move only when nothing is outstanding, *including a pending device check*, and both entries
name one: Q-139 is not verified on device, Q-81 does not yet know whether the model fits the owner's
real data. So neither belonged in the archive at all. Resolution: **cut the premature archive copies,
keep the live entries**, which is the conservative direction since the live list is what everyone
reads and is where an owed check belongs. Q-81's copy was identical so nothing was lost; Q-139's
unique material was folded into the live entry first, and its stale 69-line body replaced with a
compact `⚠️ FIXED, not verified on device` row. `docs/domains/activity/README.md` carried the same
stale claim — *"needs one owner decision"*, which had been made — and was updated.

**The check is now step 41 of 41** in Custom Rules. Worth recording how it behaved: **its first
version reported four and only two were real** — in a script written to catch exactly this kind of
error. The archive heading for Q-75 mentions Q-76 in passing, and a live *batch* heading spans
`Q-63…Q-69` where one member has since been fixed. Two narrowings followed, both written into the
script's own header so the next reader inherits the reasoning rather than the conclusion: a heading's
identity is its **first** Q number, and **range headings are skipped**, because a stale range wants a
human splitting the batch rather than a red build. An earlier, cruder pass over the domain indexes had
also flagged Q-107 — whose only appearance in the archive is a note *retracting* a link to it — and
two domains that merely reference Q-139's fix, one of which correctly calls it *"already-shipped"*.
Four apparent sites became one.

**Why it matters more than a tidy-up:** a false `🔴 OPEN` in the live list is a standing instruction to
five concurrent agents to treat a working subsystem as broken, or to fix it again.

**Not exercised:** static reconciliation against the repository. Q-139's own outstanding item is an
on-device check after the next real history drain, and Q-81's needs production — neither is possible
in this harness, which is exactly why both entries stay in the live list.
