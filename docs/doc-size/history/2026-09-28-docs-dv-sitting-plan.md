# 2026-09-28 · `docs/dv-sitting-plan`

**`docs/agents/state/device-verification.md` 52 → 58 (+6).**

The Device Verification baton gained a pointer to the new
[`docs/device-sitting-plan-2026-09-28.md`](../../device-sitting-plan-2026-09-28.md), which orders
the 126 owed device checks into five sittings, failure-first.

**The plan itself is NOT in the baton, and that was deliberate.** It was written there first, at
+69 lines, and `check-doc-index-size` flagged it — correctly. The baton's own rule is that it
carries **state only**, because that is what stops it accreting; a sitting plan is a working
document with a date on it, so it lives in `docs/` and the baton links to it. The +6 that remain
are the pointer, the two standing blocks that outrank the plan's order (`DV-13` gating the admin
console), and an attribution line saying which part of the baton the Orchestrator touched.

That last line matters because the rest of the baton is the sweep-4b session's and must not read
as rewritten by someone who did not run the sweep.
