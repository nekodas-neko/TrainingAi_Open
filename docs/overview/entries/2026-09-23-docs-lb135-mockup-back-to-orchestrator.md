# 2026-09-23 — LB-135: hand the IA mockup back to the Orchestrator, and undo a deletion I caused

**Branch:** `docs/lb135-mockup-back-to-orchestrator` · **Lane B** · docs-only

## The correction that unblocked this

LB-135 was filed saying the 2026-09-22 mockup was lost. **The owner corrected that: it is in the
Orchestrator's chat.** So it is an EXPORT gap, not a design to redo — that session still holds what
he approved, and the recovery is cheap.

RV-117, RV-118 and RV-119 are re-channelled **`Lane: O`**, asking the Orchestrator to save the
mockup under `docs/design/` and set the lane back to `B`. The queue is the channel between agents;
there is no messaging and no two sessions awake at once, so the `Lane:` field *is* the handover.

The proposed rule stands and is worth more, not less: a mockup living only in one session's
transcript is invisible to every other agent and to the owner later. The repo is the only shared
memory.

## ⚠ A deletion I caused, found and undone here

**PR #1481's auto-merge of `docs/implementation-backlog.md` silently deleted RV-117 and RV-118** —
two Review-filed entries carrying owner-approved gates. Present at `ef199122700`, gone at
`5ed93e4b1a9`.

Both are restored from `ef199122700`, with the handback bullet applied. Verified by heading parity:
the only difference from the pre-damage file is the intended addition of LB-135.

**Why my verification missed it.** After that merge I counted the headings I had *touched* —
RV-116, RV-119, LB-135 — and all three were present, so it read as clean. Counting what you edited
cannot see a neighbour that vanished. The check that does:

```
diff <(git show origin/main:docs/implementation-backlog.md | grep "^### " | sort) \
     <(grep "^### " docs/implementation-backlog.md | sort)
```

Every line of that diff must be an add or a remove you intended. Recorded in the Lane B baton.

This is the class CLAUDE.md already warns about from the other direction — a backlog conflict is
usually two deletions, and "keep both" resurrects shipped entries. The mirror case is just as real:
an auto-merge that keeps one side drops the other side's entries with no marker to notice.

## Also here

- **RV-116 removed from the queue.** It shipped in #1481 and its own `Keep:` says nothing is owed,
  so leaving it was wrong — a finished entry must not still print as READY.
- **Doc-size baseline raised back**, with the reason in `docs/doc-size-baseline-history.md`: the
  baseline had ratcheted DOWN to match my deletion, so restoring the entries is an undo rather than
  growth.

## Verification

`pnpm check:rules` **Ran 77 of 77** · backlog-pointers clean · doc-size clean · full heading diff
shows exactly the three intended changes (+RV-117, +RV-118, −RV-116). Docs-only: no code touched.
