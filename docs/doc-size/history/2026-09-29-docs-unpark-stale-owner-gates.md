# 2026-09-29 · `docs/unpark-stale-owner-gates`

**`docs/agents/state/orchestrator.md` 97 → 119 (+22).**

The baton's owner-gate section carried a shape estimate — *"~25 engineering calls wearing an owner
gate"* — that invited the next session to plan a bulk unpark. Reading a sample of six found five
correctly gated, so the estimate is retracted in place rather than left to be acted on.

The +22 is mostly the **trap that produced the wrong guess**: a ✅ recorded owner decision inside an
entry says nothing about whether its gate is stale, because the gate usually names a different
question. That is written out with the two worked cases (`PS-41`, `TN-2`) because this session fell
into it and reverted an edit mid-flight; a one-line version would not have stopped the next session
repeating it.

It belongs in the baton rather than a journal entry because it changes what the next Orchestrator
should *do* with the remaining 34 gated entries, which is baton state, not history.
