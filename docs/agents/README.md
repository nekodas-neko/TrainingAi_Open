# Standing agent roles

> **This file was created on 2026-08-17 by the first Review session, because it did not exist.**
> The Review role's briefing tells it to read `docs/agents/README.md` for the operating model and
> `docs/agents/state/<role>.md` for its baton — neither path was in the repo, so the first session
> ran without one and wrote these on the way out. **Only the Review role is described below, because
> it is the only one this session can describe honestly.** A session running under another standing
> role should add its own section rather than assume the shape here generalises.

Standing roles differ from ordinary sessions in one way: they persist across sessions through a
**baton** in `docs/agents/state/`. A role's session reads its baton first, and rewrites it in full
(never appends) before finishing, so the next session under that name continues rather than restarts.

---

## §1 — The roles

### Review

**Finds things and files them. Does not fix them.**

Sweeps the app for bugs, inconsistencies and drift; writes findings up in
`docs/reviews/YYYY-MM-DD-<topic>.md`; and files **every** finding as an entry in
`docs/implementation-backlog.md`. A finding without a backlog entry does not count — `CLAUDE.md`'s
*No orphaned findings* rule is the whole point of the role.

**Run the app; do not just read it.** This is the failure mode the role exists to avoid, and the repo
has paid for it more than once. Available: `pnpm dev` against a seeded local Postgres, `pnpm e2e` for
the browser harness, and production through `POST /api/admin/db-query` over the `claude_ro` views.

**Pick one lens and say which.** A sweep that tries to cover everything covers nothing. Prefer one
nothing has covered recently — the baton records what has been run. Lenses that have earned their
keep: measuring a model against production data · reachability (rendered but unreachable, written but
never read, computed but never shown) · sibling surfaces · the failure cells (error path, empty state,
offline path, first-run path) · cross-surface contradiction · null-rate and drift sweeps.

**Two rules about evidence.** State the method so it can be checked, and say what it does **not**
establish. And when something comes back clean, **say so explicitly** — a pillar reviewed and found
sound is a real result, and recording it stops the next sweep re-covering it.

**Placement is priority.** Queue position in the backlog *is* the priority: data-correctness and
prescription bugs near the top, cosmetic inconsistencies not. Tag every heading with its pillar(s),
primary first, or it is invisible to every per-pillar sweep.

---

## §2 — Authority

| Role | May merge without asking | May not |
|---|---|---|
| **Review** | Its own **docs-only** PRs (review write-up, backlog entries, `projectOverview.md` rows, domain-index links) | Fix anything it finds. Take migration numbers. |

Anything **actively harmful found in production** — data loss, a security hole, auth breakage — is
said immediately and prominently, not filed and moved past.

All the ordinary `CLAUDE.md` rules still apply: feature branch, PR, green CI, no direct push to
`main`.

---

## §3 — Q-number bands

Backlog entries are numbered `Q-<n>`. Standing roles take numbers **from their own band** rather than
reading or writing a shared next-free pointer, so two roles working concurrently cannot collide.

| Band | Owner | Notes |
|---|---|---|
| below 450 | general / ad-hoc sessions | The historical range. Highest used at 2026-08-17: **Q-310**. |
| **450–499** | **Review** | In use. **Q-450…Q-455 taken 2026-08-17.** |
| 500–529 | unallocated | |
| 530+ | overflow | A role whose sweep outgrows its band claims the next free block of 50 above 529 **and records it in this table in the same PR**. |

A Q number is claimed against the queue file **and every open PR** — the pointer cannot see an
unmerged PR, and that has already caused one real collision (Q-297, 2026-08-17).
