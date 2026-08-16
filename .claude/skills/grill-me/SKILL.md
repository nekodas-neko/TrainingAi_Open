---
name: grill-me
description: Interrogate the user's plan or design one sharp question at a time — each with a recommended answer — until every open decision, hidden assumption, and contradiction is resolved, then produce a concrete spec. Use before implementing anything non-trivial, or when the user says "grill me", "grill my plan", "pressure-test this", "interrogate me", or "ask me questions before you build".
version: 1.0.0
---

# Grill Me

Pressure-test a plan or design **before** any code is written. The failure mode this
prevents: an agent runs off a vague request, guesses the ambiguous parts wrong, and builds
the wrong thing. Instead, surface every assumption and open decision, get an explicit answer
to each, and only then implement.

## Method

**One question at a time.** Ask a single question, get the answer, let it shape the next
question. Do **not** dump a checklist of ten questions — the point is to adapt and drill into
what the answers reveal.

For each question, use the `AskUserQuestion` tool with a **single** question and a small set
of concrete options, and **put your recommended answer first, labelled "(Recommended)"** with a
one-line rationale. The recommendation keeps momentum — the user reacts to a strawman instead of
generating an answer from nothing, and can always pick "Other".

### Before you ask anything

1. **Read the code first.** Never ask something `grep` or a file read could settle — existing
   patterns, current behaviour, what a table/route already does. In this repo also skim
   `projectOverview.md`, `CLAUDE.md`, and `docs/module-map.md` — the answer to "does this
   already exist?" usually lives there. Asking a question the codebase already answers wastes the
   user's turn and erodes trust.
2. **Map the decision tree.** Privately list the branches that must be resolved: scope,
   data model, edge cases, offline/sync behaviour, timezone handling, cache invalidation,
   UI states, failure modes, migration/versioning. This repo's `CLAUDE.md` strict rules
   (timezone, cache groups, offline-first, safe-area, one-formula-one-place) are common
   sources of hidden requirements — probe them.

### While grilling

- **Resolve dependencies in order** — don't ask about set colours before you know whether the
  feature exists at all. Earlier answers prune later branches.
- **Drill into contradictions.** If an answer conflicts with something said earlier or with how
  the code actually works, name the conflict and ask them to reconcile it — don't paper over it.
- **Prefer specific over open.** "Should a failed sync of this write quarantine (poison-pill) or
  retry?" beats "how should errors work?".
- **Stop when the tree is resolved**, not after a fixed count. Some plans need three questions,
  some need fifteen. When you can no longer find a question whose answer would change the
  implementation, you're done.

### When done

Write a short, concrete **spec** capturing every resolved decision (what's being built, the
data/write path, edge cases, and explicitly what's out of scope). Then offer the next step:

- Hand the spec to the `writing-plans` skill (for backlog-driven / multi-step work — the repo's
  two-PR plan-then-build flow), or
- Proceed to implement directly if the user asked for an in-session change.

## Guardrails

- One question per turn — never batch. Momentum comes from the recommended answer, not from
  asking everything at once.
- Every question carries a recommendation with a reason.
- Don't ask what the code answers — go read it.
- The output is a decision record, not vibes: the user should be able to hand the resulting spec
  to a fresh agent and get the thing they meant.
