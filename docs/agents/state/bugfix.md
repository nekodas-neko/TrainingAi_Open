# BugFix Intake Agent 🪲 — baton

> **Successor sessions are titled `BugFix Intake Agent 🪲`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

The standing intake role. Owner reports (screenshots, descriptions, "why is this doing that")
come in; each leaves as a traced backlog entry in `docs/implementation-backlog.md`, landed and
merged in a docs-only PR. **This role does not fix.** A fix that skipped the queue is one nobody
else can see coming.

Rewrite this file **in full** — never append — before the session ends or context runs out.

---

## Standing facts for this role

- **Q number band: 387–449.** Take numbers directly from that band. Do **not** read or update the
  backlog header's "Next free Q number" pointer — that belongs to other lanes, and touching it is
  how two lanes race for a number. Nothing in 387–449 was claimed as of 2026-08-17.
- **No migration numbers.** Intake never claims one. If an entry needs a corrective migration, say
  so in the entry and leave the number to the implementer.
- **Docs-only PRs, opened and merged without asking** (CLAUDE.md Standing Instructions). CI still
  has to be green; a markdown-only PR does run the full pipeline, because the `pull_request`
  trigger has no `paths-ignore`.
- **Entry model to copy: Q-310** (`docs/implementation-backlog.md`). Owner report verbatim +
  screenshot described in words + traced file/line + why it is one bug with N symptoms + fix
  direction + what to verify. That is the bar.
- **Dedup before filing.** `grep` the backlog *and* `projectOverview.md`'s Known Issues (253
  headings, newest first, from line ~3383). If it's already filed, amend that entry in place with
  the new evidence — don't file a second number.
- **Escalate loudly, don't just file**, if a report reveals something destructive already happening
  in production: data loss, a security hole, auth breakage.

## Tools available for tracing

- `pnpm dev` against seeded local Postgres (port 5433, `.env.local`; `DATABASE_URL`/`DATABASE_SSL`
  must be unset in the shell first — the session-start hook does this).
- `pnpm e2e` — the E2E harness (Q-249).
- `POST /api/admin/db-query` over the `claude_ro` views for production. **Row-scoped to one user
  and pruned at 30 days** — every count from it is "the owner's, recently", never "the system's".
  Write findings that way.

## Framework docs — resolved 2026-08-17

The previous version of this baton recorded that `docs/agents/README.md` did not exist, and that
orientation had to come from `projectOverview.md` and `CLAUDE.md` instead. **It exists now** — the
operating model landed the same day. Read it: §1 defines this role, §2 is the authority table, §4
is the handoff ritual this file is part of. The cold-start prompt for the role is
[`docs/agents/prompts/bugfix.md`](../prompts/bugfix.md).

The Q band recorded above (387–449) matches the band table in that document, which was written
independently — no reconciliation was needed.

---

## Session log

### 2026-08-17 — first session under this role

- Read: `projectOverview.md` (structure + Known-Issues index), `CLAUDE.md`,
  `docs/implementation-backlog.md` (protocol, queue headings, Q-310 as the format reference).
- Created this file. `docs/agents/` did not exist.

**Filed: Q-387** — `[nutrition]` adaptive-TDEE counts a partially-logged day as complete.
Owner asked what stops the tuner treating "breakfast + lunch, skipped dinner" as the whole day;
the answer is nothing. Traced to the `intakeKcal > 0` filter at `adaptive-tdee.ts:96`, measured
with the real module (6 partial days of 14 → 514 kcal low, all gates passing, `confidence:
'medium'`), and the error reaches the recommended calorie target via
`energy-balance-service.ts:180`. Latent today because the Q-302 gate is not passing.
Queued below the three live user-facing bugs (Q-450/451/452) and above the tooling items, since
it is a prescription-correctness bug that is not firing *yet*. Known-Issues row added.

**Rebase note for next time:** `main` moved twice during a single ~30-minute intake. Q-310 shipped
and left the queue, and Q-306 was renumbered to Q-313, both inside the window between reading the
file and committing. The rebase conflicted on the renumbered heading I had anchored to. Resolution
that worked: `git checkout --ours <file>` to take `main` whole, then re-insert the new entry by
script against a *fresh* anchor. Do not hand-splice these two files — queue position is priority,
so a bad splice silently reprioritises someone else's work.

**Two things learned that are worth reusing:**
- The probe pattern is cheap and much stronger than argument: import the real shared module in a
  scratch `.ts`, run it with `npx vite-node <file>` from the repo root, print a table. `tsx` is not
  installed; `vitest run` ignores a file that has no test in it. Write the probe **inside** the repo
  (imports resolve) and delete it before committing.
- When a module already has a guard against a *related* case, read that guard's comment before
  assuming it covers yours. Both Q-387 protections were real, deliberate and documented — and the
  documented rationale is what proved the gap, because it named the trap and then handled only the
  self-correcting half of it.

**Nothing mid-triage. Nothing received-but-unfiled. Nothing blocked.**

Next intake session starts at **Q-388** (band 387–449; 387 is now taken).
