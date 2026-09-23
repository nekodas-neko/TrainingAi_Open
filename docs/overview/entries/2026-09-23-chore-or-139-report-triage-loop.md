# 2026-09-23 — the Orchestrator reads in-app reports, and can stop re-reading them

Orchestrator. Docs-only. Branch `chore/or-139-report-triage-loop`.

## What the owner asked for

> *"i want this agent to be able to read reports sent within the app — through the report feature.
> Can you make this happen? So you review; then assign it to a lane and clear it."*

## The capability already existed, and that is the finding

*Report an Issue* on `/more` (`components/more/feedback-section.tsx` → `POST /api/feedback`) writes
to `feedback_submissions`, and **`claude_ro.feedback_submissions` has been exposed since migration
142**. It was read live this session with the ordinary admin db-query endpoint before anything was
written. So no new access was needed — what was missing was **a line telling sessions to read it**
and **a way to stop re-reading the same report forever**.

Worth stating plainly because it nearly became a build: the answer to *"can you make this happen"*
was mostly *"it already does"*.

## The feature has essentially never been used

Measured 2026-09-23:

| | |
|---|---|
| rows visible in `claude_ro.feedback_submissions` | **0** |
| `feedback_submissions.n_tup_ins` (lifetime inserts, a counter not an estimate) | **1** |

The view is **row-scoped to the owner** like every `claude_ro` view, so that single report belongs
to someone else and is invisible here by design. **A zero from this read means *none of the
owner's*, never *nobody has reported anything*** — the same trap the `error_events` rule already
records, in a new table.

That number drove the design rather than decorating it: see below.

## Two owner decisions

**Clearing is a watermark in the Orchestrator's baton, not a status column.** Offered against a
migration adding `status`/`triaged_at`/`backlog_id` plus a Lane B surface so a reporter would see
*"triaged → LB-xyz"* in the app. The owner took the watermark. **The argument that decided it is the
usage number**: a migration and two lanes' work is a lot of machinery for a feature with one
lifetime submission, a migration's revert is a corrective migration, and a line in a markdown file
costs nothing to abandon if reports start arriving and the answer changes.

**The screenshot gap is real and is now filed.** The view withholds `screenshot_data` and exposes
`octet_length(...) AS screenshot_bytes`, so a UI bug arrives as *"screenshot, 240 KB"* — and for a
layout or rendering fault reported from a phone, the picture is most of the report. The owner chose
to fix it. **Not by adding the column to the view**: it is a base-64 data URI up to 500 KB, which
would drag into every `SELECT *` on that table and make the endpoint unusable for ordinary triage.
Filed as `OR-137` for Lane A — a route returning **one** screenshot by id, carrying the same owner
scoping the view uses, and explicitly marked not urgent.

## What shipped here

- **`CLAUDE.md`** — the report read joins the session-start list beside `error_events` and the
  database size, with the query, the loop, and both things the read cannot tell you.
- **`docs/agents/state/orchestrator.md`** — the watermark, starting at the epoch, with the rule for
  moving it: only once every report above it has become a backlog entry or been recorded as
  not-a-defect with its reason.
- **`docs/implementation-backlog.md`** — `OR-137` for the screenshot route.

**The loop is read → review → file with a lane → move the watermark.** A report is never answered by
replying to it; it becomes a queue entry, per **No orphaned findings**.

## Reading the reporter's data — the owner widened the scope

Second owner request the same session:

> *"The orchestrator or a set agent should be able to use the claude read only feature and read the
> data of the user who made the report. The app is in development mode so each user has consented to
> having their data used for training."*

**No migration is needed, and that is the finding that makes this small.** Every `claude_ro` view
already filters on `current_setting('app.claude_ro_owner', true)::uuid` — Q-456 moved them off the
hard-coded id. The views do not change. What is fixed is **where that setting comes from**:
`bootstrapClaudeRoOwner` issues `ALTER ROLE claude_readonly SET app.claude_ro_owner = '<uuid>'` once
at boot, binding the scope to the **role**, globally, for every request.

So the change is one endpoint: an optional `userId`, applied as
`BEGIN; SET LOCAL app.claude_ro_owner = '<uuid>'; <the caller's SELECT>; COMMIT`. Absent `userId`,
behaviour is byte-identical to today. Filed as **`OR-138`**, Lane A, third in the queue.

**`SET LOCAL` rather than `SET` is load-bearing.** The endpoint reads through a **pool**, so a plain
`SET` would persist on that pooled connection and silently re-scope whichever later request reused
it. That is a cross-request data leak, not a tidiness point.

**This is an auth/security change and the carve-out still applies** — it widens the endpoint from
*one user, structurally* to *whichever user the caller names*. The owner asked for it and the
consent basis is recorded. The entry recommends one restriction: **allow the pivot only to a user
who has actually filed feedback**, so the widening stays tied to the justification given. One
predicate to delete if he wants it broader later; the broad version cannot be un-shipped.

**A probe I did not run, deliberately.** The obvious next question is whether a caller can *already*
pivot today by sending a bare `SET` as its own statement — the endpoint rejects SQL containing a
`;`, so it cannot be smuggled alongside a `SELECT`, but a lone `SET` on a pooled connection is a
different question. The attempt was blocked as credential exploration, which was the right call: the
answer came from reading the route instead, and the entry records it as **unverified** rather than
asserting it either way. If it does stick, the current single-user guarantee is already softer than
it reads.

## Not done

- **No report was triaged**, because none of the owner's exist. The loop is armed, not exercised.
- **No product code**, no migration, no device run.

## Gate

`pnpm ci:local` — exit 0. Full log kept, not tailed.
