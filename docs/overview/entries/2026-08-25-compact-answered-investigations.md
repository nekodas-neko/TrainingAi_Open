# 2026-08-25 — move two answered investigations out of the queue

**Branch:** `chore/compact-answered-investigations` · **Lane A** · docs only.

The owner approved the compaction chore proposed in
[`doc-size-baseline-history.md`](../../doc-size-baseline-history.md): entries that are long because they
were written as *investigations*, and are now answered, belong in `docs/reviews/` with a pointer left
in the queue. `docs/implementation-backlog.md` is what every session reads to orient, and a concluded
investigation sitting in it buries the work that is actually startable.

**12,146 → 11,799 lines** in the queue file (−347), with nothing lost — 392 lines moved
to two review docs.

## What moved, and the rule for choosing it

Only entries whose investigation I could personally vouch was **concluded**, having done the
measuring today. Being *long* was not the criterion: the top 15 entries are 2,863 lines (23% of the
file) and most of them are long because they specify unbuilt work, which must stay.

| entry | was | now | extracted to |
|---|---|---|---|
| **BF-4** — photo-scan latency | 229 | 21 | [`reviews/2026-08-25-nutrition-scan-latency.md`](../../reviews/2026-08-25-nutrition-scan-latency.md) |
| **Q-388** — ring power budget | 165 | 23 | [`reviews/2026-08-25-ring-power-budget.md`](../../reviews/2026-08-25-ring-power-budget.md) |

Each queue entry now carries the **decision and the measured conclusions that bear on it**, plus the
pointer. Neither is a stub: BF-4 keeps the r=+0.958 input-token correlation and the fact that the
1024 px bound has never run; Q-388 keeps the drain figures and that SpO₂ is already 98.9% night-gated
by firmware, so "only run it at night" is a no-op rather than a fix. Someone deciding either question
does not need to open the review doc — that is the test a pointer has to pass.

## Two things this caught

**`check-backlog-pointers.js` caught a defect in my own edit.** Both replacements first wrote
`- **Lane:** A · **Gate:** owner`, and the tool only reads a `Gate:` that **starts its own bullet** —
so both entries would have stayed in READY while reading as gated, which is precisely the failure
the queue tool was fixed for twice this month (LB-11, LA-23). Now on their own bullets, and both
verified in PARKED rather than assumed.

**Relative links break when prose moves a directory deeper.** Five links written relative to `docs/`
(`oura-ble-operations.md`, `overview/entries/…`) resolved from `docs/reviews/` to nothing.
`check-doc-links` caught them; worth expecting on any future extraction rather than rediscovering.

## What was deliberately NOT moved

The other thirteen of the top fifteen. Q-395 (284 lines), BF-1 (266), Q-420 (235) and the rest are
mostly **specifications for unbuilt work**, where the length is the deliverable. Moving those would
make the queue shorter and less useful, which is the opposite of the point. A future pass should
apply the same test: *is the investigation concluded, and does the entry still say what to do without
it?*

## Verified

- `pnpm check:rules` **Ran 58 of 58** · `check-backlog-pointers` OK at 204 entries · `check-doc-links`
  OK (868 files) · size baseline ratcheted **down** to the file's real length.
- Both entries confirmed in **PARKED** with `Gate: owner` via `next-item.js`, not inferred from the
  diff.

## Not exercised

Prose only — no code, no database. The two extracted documents were not re-verified against
production; they are the same text that was in the queue an hour earlier, and their measurements
carry the dates they were taken.
