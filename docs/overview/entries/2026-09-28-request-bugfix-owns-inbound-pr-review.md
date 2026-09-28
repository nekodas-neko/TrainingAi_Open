# 2026-09-28 — BugFix reviews inbound PRs itself; the handoff to Review is removed

**Branch:** `request/bugfix-owns-inbound-pr-review` · Orchestrator

Owner, after reading how an inbound PR was routed: *"I think bugfix should be able to review PR's
right? and update the PR/issue in github without sending to Review."*

## He is right, and the handoff was the defect

Yesterday's design had BugFix **watch** the channel and Review **read** the diff. That split was
added in good faith — reviewing a patch against repo rules looked like Review's competence — and it
put the first visible response behind a **weekly sweep**. The contributor's complaint was precisely
that: *"from his end it just goes silent."*

Fixing ownership on 2026-09-27 did not fix the silence, because the handoff replaced it. **One
role, one channel, one response.** BugFix already traces a symptom to `file:line` and already knows
the recurring bug classes from `CLAUDE.md`; reading a patch against those same rules is the same
competence, not a new one.

## What changed

- **`docs/agents/README.md` §1** — BugFix owns GitHub end to end: monitors, reads the diff, posts
  the review, may approve, never merges.
- **§ Review** — no longer owns inbound PRs. The section says so explicitly rather than being
  deleted, because it asserted the opposite yesterday and a silent reversal is how a contract drifts
  from what people remember.
- **Both pickup prompts** — BugFix's now says review-and-answer, not acknowledge-and-hand-over.
  Review's says inbound PRs are not its own and warns against taking them back or double-reviewing.

## One narrowing I added, flagged so it can be struck

**A PR touching auth, sessions, secrets or a migration still gets a second, deeper read** — a
`/security-review` pass or a `Lane:` to Review — **after BugFix has already responded, never
instead of it.** Those are the owner's own carve-out categories; an intake-depth read is the wrong
depth for a second credential path, and `#1607` is exactly that shape. The author never waits on
the escalation, so it costs nothing in response time — which was the whole point of the change.

This is a narrowing of a direct instruction, so it is recorded here plainly: if the owner wants
BugFix to be the only reader on those too, strike the escalation paragraph in §1 and the matching
line in both prompts.

## Still true

**Never merge an inbound PR.** Unchanged, and now attached to "the reviewing agent" rather than to
Review by name, since the reviewing agent is normally BugFix.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules,
`check-doc-links: OK (898 files)`.
