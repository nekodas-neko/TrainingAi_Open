# 2026-09-16 — the reorder did not work, and three of the reasons were mine

**Tuning.** Docs-only. Yesterday's reorder (#1246) put TN-34, BF-13 and TN-6 at the top of the
backlog file on the owner's instruction. **Checking `next-item.js` afterwards showed all three still
invisible to Lane A** — the tool that implementers actually start from. File position was never the
only thing standing in the way.

**Recording this because the reorder was reported as done, and it was not.** Verifying with the tool
rather than the file is what caught it.

## Three separate causes

**1. A ⛔ anywhere in an entry parks it.** `next-item.js:97` flags any line containing `⛔` as an
*unmigrated blocked marker*. In TN-6, BF-13, TN-34, TN-36 and TN-37 the ⛔ was implementer guidance —
*"do not touch the 0.3/0.5/1.0 ladder"*, *"not a redesign"* — never a statement that the entry could
not start. **33 entries queue-wide are parked for this reason alone.** Converted to ⚠ in the five
that matter here; the sweep is Orchestrator's.

**2. TN-34 carried a `Needs:` its own sentence disclaimed.** The line read *"**Needs: TN-33** — only
for the later question of what replaces it; **the unwiring does not wait**"*. The field blocks, the
prose says it does not, and the tool believes the field. Restated as `Related:` with the history
attached.

**3. ⚠ `Reference:` does not mean "here is the supporting doc" — it means "this entry is a map,
never build it".** `scripts/lib/reference.js` is explicit: *"An entry that exists to be READ by other
entries, not implemented."* **Nine Tuning entries used it to link their review doc**, which filed
them under a heading that says *Never "next"*: TN-22, TN-25, TN-29, TN-31, TN-34, TN-36, TN-37,
TN-39, TN-44. Converted to `Review:`, which is prose and claims no field. TN-21 keeps its
`Reference:` — there the field describes the entry's actual role.

**The third one is mine, and it is the worst of the three**, because an entry in REFERENCE looks
filed rather than lost. Every entry this agent wrote yesterday carried it. TN-39 and TN-44 were
reported to the owner as ready work and were not.

## Result

| | before | after |
|---|---:|---:|
| READY (lane A) | 11 | **19** |
| REFERENCE | 18 | 10 |

Lane A's list now opens: **1. TN-34 · 2. batch `temperature-baseline` (BF-13 + TN-6) · 3. TN-39 ·
4. TN-44** — which is the order the owner set.

## The rule worth carrying

**A queue position is not a work assignment. Check `next-item.js`, not the file.** Three independent
mechanisms can hold an entry back and none of them is visible when reading the backlog top to bottom.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. The ⛔ → ⚠ conversion
changes only which section an entry prints under — the guidance text is byte-identical and every
warning it carried it still carries. **The 33-entry ⛔ sweep and any audit of whether other agents'
entries misuse `Reference:` are NOT done here**; only the nine Tuning entries and the five in the
owner's priority path were touched.
