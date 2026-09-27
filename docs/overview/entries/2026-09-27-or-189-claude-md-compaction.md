# `CLAUDE.md` gets its first tighten: evidence out, every rule in

Orchestrator, 2026-09-27. Docs only. Second half of the repo cleanup.

## Why this file and not another

**131,431 characters — about 33,000 tokens — paid automatically by every session**, before it reads
anything it chose to read. And it had been raised five times in two days (1056 → 1061), every raise
justified on its own, **all five by the agent that then approved them.**

The contrast with the journal is the actual finding. The journal has a ratchet *and* `fold-journal-entries.js`,
so when it hit its ceiling this week it self-corrected in one command. `CLAUDE.md` had a ratchet and
no script, so every raise was a judgement call by whoever was adding the line. Nobody was checking
that work.

## The principle applied

**Evidence moves; rules stay.** A rule needs to be readable at all times. The three-week
investigation that *proves* the rule is needed only by someone who doubts it or is working in that
area — and a rule that gets doubted is a rule that gets broken, so the working has to survive
somewhere findable rather than be deleted.

Two reference docs, each holding its material whole:

- **`docs/session-start-reads.md`** — the three production queries (`error_events`,
  `feedback_submissions`, database size) with every correction and trap: the 30-day prune argument,
  the 52 MB that is bloat not payload, the 1.71 MB/day attribution and its falsifiable step-down
  prediction, the `n_live_tup` estimate that read 0 against 764 real rows.
- **`docs/git-sandbox-investigations.md`** — the branch-cleanup investigation (why
  `git branch --merged` reported 3 of 1,562) and the shallow-fetch defect (why a PR can get zero CI
  runs), both including the wrong turns.

What stayed inline is each rule plus its one-line consequence. The session-start bullet still says
`error_events` prunes at 30 days and that a fault you saw and did not record is dropped; it no
longer carries the measurement that established the prune.

**131,431 → 118,777 characters. 1,061 → 937 lines.** The first tighten this file has had.

## The check that mattered, and its two false positives

Extracting blocks by boundary risks swallowing a neighbouring rule, so every **bolded phrase** in
the old file was diffed against the new file plus both new docs. It reported **one lost rule** —
*"commit before you switch branches, and never `git add -A`…"*.

It was a false positive: the rule is at line 726, present and unchanged. A second apparent loss,
**No orphaned findings**, was the same thing — that bullet was *edited* earlier today to repoint at
the moved Known-Issues file, so its exact text differs.

Both were settled by an exact string check rather than by reasoning about the regex. That is OR-187
rule 1 twice more in one day: **the scan produced candidates; it did not produce the answer.**

## Deliberately not done

**No script to keep this file compact**, which is the asymmetry named above and the obvious thing to
reach for. A fold script works on the journal because entries are append-only and independent;
`CLAUDE.md` is a rule set where the judgement is *which* text is evidence, and that is not
mechanical. The control is this precedent: **when the file next approaches its baseline, tighten it
rather than raise it**, and the two reference docs are where the material goes.
