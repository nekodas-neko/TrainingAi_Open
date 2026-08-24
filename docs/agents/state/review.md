# 📖 Review Agent — baton

> **Successor sessions are titled `📖 Review Agent 🟢`** — exactly, both emoji included. The **leading**
> emoji is the role and never changes; the **trailing light** is that session's own status (🟢 live,
> 🔴 handed on) and is the only part that moves. A session self-titles 🟢 on its first instruction and
> flips itself to 🔴 as the last step of its handoff, after the baton and every PR have landed.

**Updated:** 2026-08-24 (session closed) · **By:** forty sweeps (2026-08-17 ×2, 2026-08-18 ×37,
2026-08-20 ×1) · **Next ID: `RV-35`.**

> **The run that produced sweep 40 is closed.** Its record, including the paste-ready pickup prompt,
> is [`docs/handoff-2026-08-24-workouts-review-sweep-40-write-surface.md`](../../handoff-2026-08-24-workouts-review-sweep-40-write-surface.md).
> **All three of its findings — RV-32, RV-33, RV-34 — shipped and are closed**, re-verified in source
> on 2026-08-24 rather than taken from the closure note, and their `projectOverview.md` row was moved
> whole to [`known-issues-resolved.md`](../../overview/known-issues-resolved.md). Nothing is owed from
> that sweep.

**This baton was rewritten from 1,280 lines to this on sweep 40** (PS-4's complaint: no baton fits on a
screen). Nothing was lost — every sweep's narrative is in its own `docs/reviews/` write-up, indexed from
the eleven `docs/domains/*/README.md` files, and every finding is in `projectOverview.md` or the queue.
**A baton carries state, not history.** Keep it this length: replace §Now each sweep, and let the
write-up hold the story.

---

## IDs

`RV-<n>`, counting up forever. No band, no pointer, no ledger.
`grep -rhoE '\bRV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`.

Two traps in that command, both hit: `docs/agents/README.md` and `docs/implementation-backlog.md` carry
**`RV-31` as a prose example**, not an entry. Sweep 40 started at **RV-32** anyway rather than at the
`RV-1` its predecessor recorded — following the documented lookup beats being clever about it, and
skipped numbers cost nothing. Legacy `Q-` numbers stay valid where already used and are never renumbered.

## Previous run closed 2026-08-20 — read this before filing anything

The run of sweeps 29–39 (PRs #140–#151) was closed by its own wrap-up, and its record is
[`docs/handoff-2026-08-20-platform-review-sweeps-29-39.md`](../../handoff-2026-08-20-platform-review-sweeps-29-39.md).
**10 of its 13 findings have since shipped** (verified in source, not inferred from the queue's
silence): Q-493, Q-494, Q-495, Q-496, Q-497, Q-498, Q-492, Q-552, Q-553, Q-554 — their
`projectOverview.md` rows are in the resolved archive.

**Three remain open — do not re-file them:** **Q-499** (self-fetching cards vanish on a failed fetch;
its ten unverified candidates are a **worklist, not a defect count**), **Q-555** (offline, a tab tap
is a silent no-op before the service worker claims the page), **Q-556** (`DELETE /api/activity-logs`
reports success for a row it did not delete).

**One surface that run left explicitly unverified, not clean:**
`PATCH /api/activity-logs/<id>/metrics` — its probe payload was rejected by Zod before the ownership
check ran, so that route's cross-user behaviour is **unknown**. Sweep 40 did not reach it either.

## Now — nothing in flight

The next session is **awaiting the owner's instructions**, by the closing session's request: read the
orientation docs, summarise where things stand, and wait rather than picking a lens. The sweep-40
record below is history, kept because its Next list is still the best answer to "what is worth doing".

## Sweep 40 (2026-08-20) — closed, all findings shipped

**Lens:** the non-workout write surface (program / phase-set / progression-style / template routes)
plus ownership **rule (b)**. Write-up:
[`2026-08-20-non-workout-write-surface-ownership.md`](../../reviews/2026-08-20-non-workout-write-surface-ownership.md);
the narrative is in the handoff linked at the top. **RV-32, RV-33, RV-34 — all fixed and closed.**

Three things from it that are still *state*, not story:

- **✅ Rule (b) is clean and now has evidence** — 116 mutating routes, 325 `.set()` sites, all built
  field by field. **Rule (a) is the only one of the three left with none.**
- **The FK inventory.** One `information_schema` query lists every foreign key into a user-scoped
  table — **27 edges**. Four were probed; the remaining 23 are the cheapest next lens this role has.
- **A cheap contrast beats a long argument.** All of RV-32 was one row of a table: *same value, same
  resource, same session — PUT 400, POST 201.* Find the surface that already does the thing correctly
  before writing a paragraph about why it should.

## Next — in the order they are worth doing

**Not this:** the documentation-integrity seam. Sweeps 34–37 were four consecutive passes over it and
left three CI checks behind (`check-known-issue-duplication`, `check-index-doc-paths`,
`check-module-map-symbols`). Pick a lens that runs the app.

- **The other 23 FK edges into user-scoped tables.** `meal_plan_meals.saved_meal_id`,
  `saved_meal_items.food_item_id`, `prescribed_runs.plan_id`, `supplement_logs.supplement_id` first.
  The query that produces the inventory is in sweep 40's write-up §7.
- **Ownership rule (a)** — after a user-scoped UPDATE whose row id came from the client, is the affected-row
  count checked before the dependent child write? Never audited. Rules (b) and (c) both now have evidence.
- **The 62 mutating routes that *do* carry a `try {`** were checked only for whether they map a refusal at
  all, never for whether they map it to the *right* status.
- **A clean clone, actually built.** Nobody has done `git clone` into an empty container and run
  `pnpm install && pnpm build && pnpm test`. It is the one check that would settle `NOTICE`'s claim outright,
  and Q-313 (no `next build` gate in the publish dry-run) is why it is worth doing.
- **The sync/outbox under a server that fails mid-push, on the device half.** Sweep 10 drove the
  server half; the local SQLite outbox has never been exercised, and it needs hardware.
- **Q-452's siblings** — only the four `AiInsightCard` sections were checked for absent-vs-zero;
  `weekly-digest` and the coach were not.

## Blocked

Nothing. The standing ceiling is **the device**: everything this role runs is the **web** build, where
`getLocalStore()` returns null and every offline-first domain takes its web fallback. No safe-area,
Samsung-WebView, native-plugin or native-SQLite finding can originate here, and every write-up must say so.

Production is partly open — `claude_ro` is **row-scoped to the owner**, so a second real account is out of
reach there specifically. When the *victim* of a bug is another account, that view structurally cannot see
it: write "no evidence in the owner's rows", never "it has not happened".

## Claimed paths

None. This role's PRs are docs-only.

## Do not re-litigate

- Authority limits and the lane contract are settled in [`docs/agents/README.md`](../README.md).
- **Queue position is priority; the ID is not.** An `RV-32` above a `Q-331` is deliberate.
- **Before writing a surface off as unreachable, spend ten minutes trying.** Three separate "structurally
  untested" items on this baton's own list turned out to need one env var, one `context.setOffline(true)`,
  and an account the harness already had. **Three for three.**

## Method notes — do not re-derive these

- `pnpm install --frozen-lockfile` first if `node_modules` is missing (`@sentry/nextjs` failing to resolve
  is the tell), then `pnpm db:local`, then **`env -u DATABASE_URL -u DATABASE_SSL pnpm dev`**. Both vars are
  pre-set to production in the container and Next will not let `.env.local` override an already-set
  `process.env` var — without the `env -u` the dev server silently tries production and fails.
- Launch the dev server with `nohup … &` through a **background** Bash call. A `(cmd &)` subshell gets
  reaped when the tool call returns.
- API sweeps: sign in with `curl` via `/api/auth/csrf` → `/api/auth/callback/credentials`
  (`test@local.dev` / `testpass123`) into a cookie jar. A second account is two minutes: insert a row
  copying the seeded user's `password_hash` with `is_active = true` — **without `is_active`, sign-in 302s
  and leaves a null session**, which reads like broken login and is the invite gate working.
- Screens: temporary specs in `e2e/`, run against the already-running server with
  `E2E_BASE_URL=http://localhost:3000` **and `DATABASE_URL=…` set** (`zero-data.setup.ts` fails loudly
  without it, before your spec runs). **Delete the spec and `test-results/` before committing.**
- **`get_check_runs` returning `total_count: 0` has a third cause, and it is the likeliest one here.**
  `CLAUDE.md` names a stale base; the PR field to read is **`mergeable_state`**. `dirty` means a merge
  conflict, and **GitHub runs no PR checks at all while it cannot compute the merge commit** — so a
  conflicted PR looks exactly like CI that never fired. Sweep 40 lost fifteen minutes to this with a
  base that was provably current (`git merge-base --is-ancestor origin/main HEAD` passed). Resolve the
  conflict and the checks start within seconds; `unstable` means mergeable with checks still running.
  **Check `mergeable_state` before waiting on anything.**
- **Assert every probe reached a real route.** Next's HTML 404 for an unmatched path is indistinguishable
  from an access-control rejection by status alone — the tell is the body, HTML vs JSON. A 405 means the
  route is real and the verb is wrong; check the handler before concluding anything.
- **Read the row back out of Postgres.** A 2xx cannot distinguish "did it" from "ignored it safely", and a
  response body echoing your input proves nothing about what was stored.
- **Expect your probe to be wrong in the direction of your hypothesis.** Sweeps 36–39 produced four
  measurement errors, every one plausible, specific and publishable as written. **Corroboration between two
  weak signals is not evidence when they can fail for the same reason** — prefer one signal that cannot be
  faked over two that agree.
- First-visit renders are confounded by Turbopack compile time; anything that looks sparse must be
  re-checked warm before it is believed.
- **Before running the docs compaction chore, check the open-PR list** — it is a whole-directory operation
  and has been done in duplicate twice. And when a durable doc cites a session, cite the **review or handoff
  doc**, never the loose journal entry: the linked-entry floor tracks durable-doc citations, not entry count.

## Where the first 39 sweeps live

All 39 write-ups are in `docs/reviews/` (`2026-08-17-*`, `2026-08-18-*`) and are linked, with a one-line
summary each, from the pillar indexes in `docs/domains/*/README.md`. Every finding they produced is either
a Known-Issues row in `projectOverview.md` or an open queue entry. Read them by subject through the pillar
index rather than in sweep order — that is what the index is for.

**All eleven pillars have been reviewed at least once.** `workouts` (write path, AI double-trips, write
concurrency) · `nutrition`/`cardio`/`activity` (writes cross-user, not-found posture) ·
`sleep`/`readiness`/`heart-rate`/`body`/`devices` (ingest auth, value validation, schema strictness) ·
`app-shell`/`platform` (failure cells, repo-migration architecture, the Coach write path, offline reads,
cross-user isolation).
