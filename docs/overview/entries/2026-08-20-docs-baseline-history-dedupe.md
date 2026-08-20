## 2026-08-20 — the baseline history was duplicated eight times, not twice (PS-2)

**Branch:** `docs/baseline-history-dedupe` · docs-only, no version bump.

`docs/doc-size-baseline-history.md` is the 955 comment lines lifted verbatim out of
`scripts/check-doc-index-size.js` on 2026-08-19. The extraction was deliberately unedited so the
move would be reviewable as a pure move, and it carried the conflict-splicing damage that motivated
the move in the first place. PS-2 asked for that damage to be deduped.

**PS-2's premise was wrong in three ways, and the reason it was wrong is the part worth carrying.**

| PS-2 said | Actually |
|---|---|
| one duplicated block (Q-553) | **eight** duplicated records |
| duplicated **twice** | two of them appear **three** times — Q-356 and the Q-464 ratchet |
| **byte-identical** | none was; every copy had been reworded on the merge that re-landed it |
| `projectOverview -> 7785` contradicts `7805 -> 7785` | not a contradiction — one states the prior value, the other does not |

Three of the eight groups differ in their *opening line* (`… from the MERGED file.` against `… from
the MERGED file, on each merge this branch took.`), so grouping records by their first line finds
five of eight and looking for byte-identical blocks finds none. A similarity sweep over whole
records is what finds them: all eight sat above 0.80, and the file now reports zero pairs at 0.70.

**Deduping is a merge, not a delete.** Each copy had drifted, so each carried a fact the others did
not. Every surviving record is the union — Q-356 keeps its `1044 -> 1056` figure from one copy and
its recompute note from another; the Q-464 ratchet keeps `8257 -> 8310` from two copies and Lane A's
`+53` delta from the third. A sentence-level audit of the file before and after confirms
every distinct sentence survives exactly once (541 sentences → 514, all 27 removed being duplicates).

**Two independent records were nearly lost with the duplicates that had swallowed them.** A lost
blank line had glued the Q-310 Known-Issues raise inside the second `Q-548..Q-551` copy, and the
`1010 -> 1044` "Decisions That Come Back To Me" raise inside the Q-534 copy. Deleting the duplicate
wholesale would have taken both with it, and no per-record tool can see a record with no separator
in front of it. Both are records in their own right now.

**`git log` could not do the reconciliation PS-2 asked for.** The entry says to reconcile the
figures against the commits that raised them. This repository's history begins **2026-08-19**, with
no commit earlier than that, and every record in the extracted block is dated 2026-08-18 or before.
Those
commits are in the archived private repo. The reconciliation is therefore from the copies' own
content, and the file now says so rather than implying a provenance it does not have.

The file's own header repeated PS-2's "two blocks, duplicated verbatim" figure; it is corrected, and
a dated section at the foot of the file records the dedupe as the one deliberate exception to the
append-only rule.

**Verification.** `pnpm check:rules` — Ran 50 of 50 Custom Rules steps, all passed.
`check-backlog-pointers` OK, 209 entries. `check-doc-index-size` OK; no baseline moved, and this
file is not one of the ratcheted ones.

**Not exercised:** nothing runtime. This PR contains no code.
