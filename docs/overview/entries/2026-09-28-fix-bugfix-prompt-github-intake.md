# 2026-09-28 — the BugFix contract said to read GitHub; its pickup prompt did not

**Branch:** `fix/bugfix-prompt-github-intake` · Orchestrator

Answering the owner's question about how an outside contributor's PRs and issues get actioned in
future, I checked whether the intake path actually exists rather than describing the intent.

## The gap

`docs/agents/README.md` §1 assigns GitHub intake to BugFix — `list_issues`, `list_pull_requests`,
and the same read → triage → file loop — added 2026-09-25 after the contributor said his items were
never touched.

**`docs/agents/prompts/bugfix.md` did not mention GitHub at all.** `grep -E "list_issues|GitHub|
issue|inbound"` over it returned **zero** hits. A fresh session is told to read four documents and
then start triaging owner reports; reaching the GitHub instruction depends on it getting to §1 of
the README and carrying it over. The prompt is the operative instruction, and it is what a session
actually follows.

**That is the same shape as the original failure.** The channel existed in principle and nobody was
told, at session start, to look.

## The fix

The prompt now names **three intake channels** to read at session start, before any owner report:

1. **GitHub** — open issues and every PR not self-authored, with the 2026-09-27 rule attached: an
   inbound PR is review/comment/approve, never merge.
2. **`claude_ro.feedback_submissions`** — *Report an Issue* on `/more`.
3. **`error_events`** — faults nobody saw, which prune at 30 days.

Two of the three are silent — nothing chases the agent for them — so the prompt says to do this at
session start rather than when owner reports run out. The contributor's own words are quoted in the
prompt, because a rule with its incident attached survives compaction better than a rule alone.

## Not covered by a check

Nothing verifies that a pickup prompt and the contract agree; this was found by reading. The other
six prompts were not audited for the same class of drift, and that is worth a sweep rather than an
assumption.

**Not exercised:** documentation only, no code. Gates: `Ran 83 of 83` Custom Rules,
`check-doc-links: OK (897 files)`.
