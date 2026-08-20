# Review Agent 📖 — baton

> **Successor sessions are titled `Review Agent 📖`** — exactly, emoji included. The title is how five
> concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-20 · **By:** forty sweeps (2026-08-17 ×2, 2026-08-18 ×37, 2026-08-20 ×1) ·
**Next ID: `RV-35`.**

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

## Now — sweep 40 (2026-08-20)

**Lens: the non-workout write surface** — the program / phase-set / progression-style / template routes —
**plus ownership rule (b)**, the one of `CLAUDE.md`'s three write-path rules the previous baton recorded
as having no evidence behind it. Both were the top of that baton's "Next" list.
Write-up: [`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](../../reviews/2026-08-20-non-workout-write-surface-ownership.md).

**Filed RV-32 + RV-34 (batched, `program-write-fk-ownership`) and RV-33.**

- **RV-32 — three write paths persist a `progression_styles` id owned by another user**
  (`POST /api/phase-sets`, `POST /api/workout-templates`, `POST /api/log-exercise`), while
  `PUT /api/phase-sets/[id]` refuses the **identical value** 400. The check exists fourteen lines away in
  the sibling file. `listPhaseSets` then joins the style name in **unscoped**, so `GET /api/phase-sets`
  returns the other account's style *name* — which renders in builder-review and goes into an LLM prompt.
  It stops at the name: every other read of that table is `user_id`-scoped, and that was checked rather
  than assumed.
- **RV-34** — a client-supplied `program_sessions.id` that is not yours is a raw `pg 23505` 500.
- **RV-33** — `POST /api/progression-styles` and `PATCH /api/nutrition/food-logs/[id]` answer a correct
  ownership refusal with an **empty-bodied 500** and file it into `error_events` as a server fault
  (Q-462/Q-463's class, two routes that fix missed).

**✅ Rule (b) is clean, and now has evidence.** 116 mutating routes, 325 `.set()` sites, the 21 taking a
bare identifier or spread each traced to source: all built field by field. Confirmed live —
`PATCH /api/user/profile` sent `isAdmin`, `id` and `passwordHash` and changed none. **Rule (a) — the
affected-row count before a dependent child write — is now the only one of the three with no evidence.**

**Method worth reusing: the FK inventory.** One `information_schema` query lists every foreign key into a
user-scoped table — **27 edges**. Four were probed live and one class fell out of them. The remaining 23
are the cheapest next lens this role has.

**A cheap contrast beats a long argument.** The whole of RV-32 is one row of a table: *same value, same
resource, same session — PUT 400, POST 201.* Look for the surface that already does the thing correctly
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
