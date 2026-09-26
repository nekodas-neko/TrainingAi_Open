# 2026-09-26 — `lane-b/lb161-keep-advisory-ordering` (LB-161) — the advisory that argued against the entries someone got right

**Lane B · one checker fix, one field correction. No product code.**

Lane B's queue reached READY 0, so this session verified that properly rather than taking the
runner's word for it, and the verification is what found the work.

## The two advisories `check-backlog-pointers.js` prints on every run

**`BF-196` carried `Gate: device` on shipped work.** Its own fields said so —
*"shipped; only the width check is owed"* — and `Gate:` PARKS an entry, so it sat beside work that
genuinely cannot start. That is what BF-90 measured and what the advisory exists to name. Converted
to `Verify: device`, which prints in its own section. One field.

**`DV-2`'s advisory was WRONG, and that is the one worth the diff.** The rule fires when an entry
records a device outcome while its `Keep:` still asks for a check. DV-2's body opens with
`❌ FAILED ON THE S25, 2026-09-23` — but that is the **original defect report**, from the pass that
found it. The fix shipped 09-25, and the `Keep:` correctly asks for the pass test **on the fix**.
The advisory was telling the reader to strike a residue that was right.

## Why it fires, and the shape of the fix

`keepIsSettled` matched `(VERIFIED|FAILED|REPORTED BROKEN) ON THE S25` anywhere in the body. That
broadening was itself a fix (TN-13): keying on `VERIFIED` alone let an entry whose check came back
BROKEN advertise itself as finished. **The broadening created the mirror blind spot** — every entry
*found* by a device failure carries a FAILED line for ever, so every one of them reads as settled
the moment it ships a fix.

The evidence available is **position**: a shipped marker below the last outcome means the outcome
predates the fix, so nothing has looked at what is on the device now. Deliberately not a date
comparison — plenty of these lines carry no date, and a date on an outcome can be the date of the
report rather than of the look.

`SHIPPED_HERE` is narrow on purpose (`✅`/`⚠` + `FIXED|SHIPPED|LANDED`). DV-2 also contains the
prose *"ships as one fix with BF-165"*, and a loose marker would suppress the rule wherever that
sentence happened to sit.

## Mutation pass

| mutation | killed |
|---|---|
| drop the ordering guard | 2 of 23 |
| first outcome instead of last | 1 |
| broaden the marker to any `fix` | 3 |
| `>=` instead of `>` | **0 at first** |

The last one is why the pass was worth running. A single line recording *both* the fix and the look
is a real shape for a same-day entry, and `>=` would suppress the advisory on exactly the entries it
should fire for. Nothing pinned it; a case now does, and it kills the mutation.

## Both advisories are now zero

What remains is the long-standing OR-100 one — 34 `Keep:` residues that read as buildable work
rather than a check. That is a real backlog of mis-filed entries and is the Orchestrator's, not a
checker bug.

## One drive-by, stated because it is unrelated to the entry

Merging `main` brought RV-200 (#1674), which deleted the run card's explain fetch and left six dead
imports behind in `components/running/prescribed-run-card.tsx` — `useEffect`, `useState`,
`readCacheSync`, `setCached`, `todayInTz`, and a `tz` local. The repo's lint floor went 811 → 817.

Removed here rather than filed. It is a Lane B file, the deletion is six lines and carries no
behaviour, and a drifted floor costs every other session the same minute it just cost me: I had to
prove the six were not mine before I could trust the gate. `run-chip-text.test.ts` — the only suite
that reaches this card — passes, and the card's own render is unchanged.

## Not exercised

No product code changed, so there is nothing to see on the device and no version bump. Full suite
**1,077 files / 10,079 tests passed**; `check:rules` **Ran 80 of 80**; lint 0 errors / 811 warnings.
