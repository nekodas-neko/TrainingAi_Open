## 2026-08-24 — The outgoing agent creates its own successor, with the model baked in

**Branch:** `claude/model-recommendations-ey670v` · docs-only · completes #352 / #404

#404 put each role's model into its prompt twice — an instruction to the owner above the paste line,
a self-check below it. That was as far as a prompt can go, because **a session's model is fixed at
creation and no tool changes it afterwards**. The owner still had to pick it by hand, and the
evidence from #404 is that a manual step in this position does not get taken: every agent started
after the assignments shipped came up on the UI default.

So the outgoing session now creates the incoming one. `create_session` (claude-code-remote MCP)
takes a `model`, which makes the moment of creation the only moment the assignment can be applied —
and moves it from a person who has to remember to an agent following a ritual it already runs.

**What it passes:** `title` (its own, green light), `model` (its role's), `prompt` (everything below
the `---` in its own prompt file), and nothing else — environment and permission mode inherit.

**`create_session` takes no effort parameter.** Model is settable; effort is not. The successor
inherits an effort level rather than getting its role's, and its own first action re-reads both and
reports the mismatch. The self-check from #404 is therefore not redundant with this change — it
covers precisely the half this change cannot set.

**Three guards, because this spawns a live session that starts working and costs money:**

- One successor per session, ever — a retried handoff must not create a second. A spawn loop is the
  failure mode with real cost, and nothing else prevents it.
- Only after the baton is committed **and pushed**; the successor's first act is to read it.
- Standing roles only. Ad-hoc sessions have no successor and no baton.

A failed `create_session` is reported in the closing message with the title and model the owner
should use, never retried — a handoff that reads complete while no successor exists is worse than
one that reports the failure.

**Owner decision, recorded:** the concern raised was that this spawns a live session without a click
and removes the owner's per-handoff choice about whether a role continues. The owner's answer was
that these are standing roles built to run, so a successor coming up and working is the intent.

**Updated:** `docs/agents/README.md` (handoff ritual gains step 7, plus a *Creating your successor*
subsection) and all six `docs/agents/prompts/*.md`.

**Verification:** `pnpm check:rules` — `Ran 55 of 55`. Docs-only.

**Not exercised — and this is the important line.** No successor has been created this way. The
mechanism is documented, not demonstrated: `create_session`'s `model` parameter is read from its
tool schema, not from a session observed coming up on the right model. The first real handoff is the
test. #404's journal entry records the cost of treating a matching value as proof once already;
this one is not making that claim.
