# The collaborator was right: nothing read GitHub

Orchestrator, 2026-09-27. Docs plus one baseline. A collaborator told the owner his issues and pull
requests *"are never getting touched/reviewed"*. Checked rather than assumed, and he is right.

## What was actually open

- **Issue #1620** (`jsboiss`, 25 Sep) — replace the manual migration counter with a calculated next
  number. **Nothing in the repo references it.**
- **PR #1607** — bearer tokens for native mobile login. Named in `TN-80` as waiting on the owner;
  **never reviewed.**
- **PR #1608** — HealthKit sample storage. Its branch name appears in one entry; **not tracked as a
  PR at all.**

## Why, and it is structural rather than an oversight

BugFix owns intake, and its two channels were spoken reports and `claude_ro.feedback_submissions`.
Neither is GitHub. `grep -c list_issues` over `CLAUDE.md` and `docs/agents/README.md` returned
**zero**.

Inbound pull requests were worse: **`CLAUDE.md`'s whole CI/CD section is written for *our own* PRs**
— *"when the user pushes a feature branch and opens a PR"* — so a PR from outside arrived into a
channel with no reader in any role. `TN-80` caught two of the three sideways while doing something
else, which is luck rather than a channel.

## The call

**GitHub issues are BugFix's third intake channel.** Same loop as the in-app feedback it already
reads: read → triage → file an entry with a lane → move the watermark. An issue is never answered by
replying to it.

**Inbound pull requests are Review's.** Reviewing a diff against this repo's rules is what that role
does, and an inbound PR is a code review with an author attached. BugFix takes the report, Review
takes the patch.

**Review may not merge one.** Outside code entering the owner's app, and both live PRs hit a
standing carve-out immediately — `#1607` is auth, `#1608` is storage. Review's authority stays
docs-only plus a posted review.

Both are in the session-start list (one line, compressed from eleven) and in both roles' sections of
`docs/agents/README.md`.

## What this does not fix

**The three already open.** A rule change reaches the next session, not the backlog of a channel
nobody was reading. `OR-184` carries them, with what each needs: `#1620` needs a read and an entry,
`#1607` needs a review and the owner's merge, `#1608` splits at the schema line where Lane A takes
over. It carries an `Ask:` — whether Review should post reviews on a contributor's PRs at all, which
is the owner's call about his own repo rather than mine.

**Not established:** whether the collaborator wants review comments or just merges. Worth asking him
rather than inferring.
