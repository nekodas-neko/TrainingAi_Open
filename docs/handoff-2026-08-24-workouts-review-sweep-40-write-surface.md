# Review sweep 40 — the non-workout write surface, and the close of this Review run

**Date:** 2026-08-24 (sweep ran 2026-08-20) · **Agent:** 📖 Review · **Primary domain:** `workouts`
**Also touches:** `platform` · `nutrition`
**Successor session title: `📖 Review Agent 🟢`** — leading emoji is the role, trailing light is that
session's own status. Copy it exactly.

---

## 1. What this run set out to do

One sweep, one lens. The baton's own "Next" list had carried the same top item since sweep 3: **the
write surface every earlier sweep skipped** — the program / phase-set / progression-style / template
routes — and alongside it **`CLAUDE.md` write-path ownership rule (b)**, *never pass a raw request
body into Drizzle `.set()`*, which the previous baton recorded as the one of the three ownership
rules with no evidence behind it.

Both were taken. Both produced a result.

## 2. What shipped

**PR #271, merged as `4073fe8` (2026-08-20).** Docs only — this role does not fix what it finds.

| Artefact | Path |
|---|---|
| Write-up | [`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](reviews/2026-08-20-non-workout-write-surface-ownership.md) |
| Journal | folded by a later compaction sweep into [`docs/overview/history-2026-08-18.md`](overview/history-2026-08-18.md) (search `from: 2026-08-20-review-agent-50s6e7.md`) |
| Backlog | RV-32 + RV-34 (batched `program-write-fk-ownership`), RV-33 |
| Indexes | `docs/domains/workouts/README.md`, `docs/domains/platform/README.md` |

**All three findings have since been fixed and merged by Lane A**, and this handoff re-verified that
in source rather than trusting the closure note:

| Finding | Fix, verified on `main` 2026-08-24 |
|---|---|
| RV-32 — three write paths accepted a `progression_styles` id owned by another user | `progressionStyleIdsOwned` guards `app/api/phase-sets/route.ts:47`, `app/api/workout-templates/route.ts:70` and `packages/shared/src/workout/log-exercise.ts:258` |
| RV-32's read half — `listPhaseSets` joined the style name in unscoped | `lib/data/postgres/slices/programs.ts:457` now scopes the join to the caller, so a pre-guard row reads blank instead of another user's words |
| RV-33 — two routes answered an ownership refusal with an empty-bodied 500 | `POST /api/progression-styles` and `PATCH /api/nutrition/food-logs/[id]` both run inside `withRouteErrors` |
| RV-34 — a foreign `program_sessions.id` was a raw `pg 23505` 500 | closed with RV-32 in the same batch |

The `projectOverview.md` Known-Issues row for RV-32…RV-34 was **moved whole** to
[`docs/overview/known-issues-resolved.md`](overview/known-issues-resolved.md) in this wrap-up, per
the rule that striking an issue means moving it. Nothing was owed on it.

## 3. The findings, and the one line worth remembering

**RV-32 in a single row of a table:** *same value, same resource, same session — `PUT` 400,
`POST` 201.* `PUT /api/phase-sets/[id]` refused a foreign progression-style id; `POST
/api/phase-sets` accepted it. The check existed fourteen lines away in the sibling file and had
never been copied into the create twin. Two more paths (`workout-templates`, `log-exercise`) had the
same gap.

**Impact was bounded by measurement, not by assumption.** The unscoped join returned the other
account's style *name* — which renders in `builder-review.tsx` and is interpolated into an LLM
prompt. It stopped there: every other read of `progression_styles` is `user_id`-scoped, checked one
by one. A separate consequence in the other direction: all three FKs are `ON DELETE SET NULL`, so
deleting your own style nulled a column in someone else's program.

**Rule (b) came back clean, and that is a real result.** 116 mutating routes, 325 `.set()` sites,
the 21 taking a bare identifier or spread each traced to source — every one built field by field.
Confirmed live by sending `isAdmin`, `id` and `passwordHash` into `PATCH /api/user/profile` and
changing none of them. **Rule (a) — the affected-row count before a dependent child write — is now
the only one of the three with no evidence behind it.**

## 4. Decisions, so they are not re-litigated

- **The baton was rewritten from 1,307 lines to 169.** PS-4's complaint, discharged for one of the
  batons. Nothing was lost: all 39 earlier sweeps have their own `docs/reviews/` write-up, linked
  with a summary from the pillar indexes, and every finding they produced is a Known-Issues row or a
  queue entry. **A baton carries state, not history** — replace its `Now` section each sweep and let
  the write-up hold the story. The size baseline was lowered in the same PR so the shrink ratchets.
- **IDs started at RV-32, not the `RV-1` the predecessor baton recorded.** `docs/agents/README.md`
  and the backlog both carry **`RV-31` as a prose example**, which the documented lookup command
  cannot tell from a real entry. Following the documented command beat being clever about it, and
  skipped numbers cost nothing.
- **The three entries were filed near the top of the queue** — a write path accepting another
  account's row id outranks a cosmetic inconsistency — and RV-32/RV-34 were batched because one
  verification pass over the program-config write path covers both.

## 5. Gotchas this run paid for

- **`get_check_runs` returning `total_count: 0` has a third cause, and `CLAUDE.md` names only one.**
  It names a stale base. The field to read is **`mergeable_state`**: `dirty` means a merge conflict,
  and **GitHub runs no PR checks at all while it cannot compute the merge commit** — which looks
  exactly like CI that never fired. This cost fifteen minutes on a base that was provably current
  (`git merge-base --is-ancestor origin/main HEAD` passed). Resolve the conflict and checks start
  within seconds. `unstable` means mergeable with checks still running. **Recorded in the baton's
  method notes.**
- **A `405` is a gift.** Probing `PUT` on a `PATCH`-only route returned 405 — which proves the route
  is real, unlike Next's HTML 404, which is indistinguishable from an access-control rejection by
  status alone. Sweep 39 learned the HTML-vs-JSON tell; this run learned that a wrong-verb probe
  confirms reachability for free.
- **`main` moved three times mid-PR**, twice conflicting on `docs/doc-size-baseline.json` and
  `docs/doc-size-baseline-history.md`. Resolve those by **rebuilding from `origin/main` and
  re-applying your own numbers**, never by splicing conflict hunks — and re-measure the line counts
  after every merge, because another session's archive sweep can shrink the file under you (it did:
  `projectOverview.md` 7910 → 7838 between two of my own commits).
- **A second account is two minutes**, not a blocker: insert a row copying the seeded user's
  `password_hash` with `is_active = true`. Without `is_active` the sign-in 302s to a null session,
  which reads like broken login and is the invite gate working correctly.

## 6. Deliberately not done

- **The other 23 FK edges into user-scoped tables.** One `information_schema` query lists all 27;
  four were probed live and one class fell out of them. `meal_plan_meals.saved_meal_id`,
  `saved_meal_items.food_item_id`, `prescribed_runs.plan_id` and `supplement_logs.supplement_id` are
  the next four worth an hour. The query is in §7 of the write-up. **This is a future lens, not an
  obligation left hanging on RV-32.**
- **Ownership rule (a)** — never audited by anyone.
- **The 62 mutating routes that *do* carry a `try {`** were checked only for whether they map a
  refusal at all, never for whether they map it to the *right* status.
- **`PATCH /api/activity-logs/<id>/metrics`** — inherited from the previous run as explicitly
  **unverified, not clean**: its probe payload was rejected by Zod before the ownership check ran.
  This run did not reach it either.

## 7. Failure surfaces NOT exercised

- **The device.** Everything this role runs is the **web** build, where `getLocalStore()` returns
  null and every offline-first domain takes its web fallback. No safe-area, Samsung-WebView,
  native-plugin or native-SQLite claim originates here.
- **Production, for the victim's half.** The prod check (0 dangling style references across 46 phase
  rows, 82 styled `session_exercises`, 280 styled `exercise_logs`) is over `claude_ro`, which is
  **row-scoped to the owner** — and in RV-32 the victim is the account whose style is borrowed,
  whose rows that view structurally cannot show. That is *no evidence*, not *has not happened*.
- **The writes themselves ran against the local seeded database**, not production.

## 8. Blocked on the owner

Nothing. The queue is not blocked on this role, and no finding from this run is waiting on a
decision.

---

## Pickup prompt

Paste the block below into a fresh session, verbatim.

```
Set this session's title to `📖 Review Agent 🟢` — exactly, both emoji included. The leading emoji
is the role and never changes; the trailing light is this session's own status (🟢 live, 🔴 handed
on), and you flip it to 🔴 yourself as the last step when you hand over.

You are the Review agent on the TrainingAI repo — a standing role, not a one-off session. Your job
is to sweep the running app for bugs, inconsistencies and drift, write findings up in
docs/reviews/YYYY-MM-DD-<topic>.md, and file each one as a backlog entry. You do not fix what you
find. Your PRs are docs-only, and you open and merge them without asking.

READ FIRST, in this order, before doing anything else:
1. docs/agents/state/review.md — your baton. Its Now section is sweep 40; its Next section lists the
   lenses in the order they are worth doing.
2. docs/agents/README.md — the operating model. §1 defines this role, §2 is your authority, §4 is
   the title and handoff contract.
3. docs/handoff-2026-08-24-workouts-review-sweep-40-write-surface.md — the run you are succeeding.
4. projectOverview.md — the live Known Issues, so you do not re-report what is already known.
5. CLAUDE.md — the recurring bug classes. Most of what you find is a repeat of one of them, and
   naming the class is more useful than describing the instance.

THEN STOP. Do not pick a lens, do not start a sweep, do not open a branch.

The owner has a specific request coming for this session. I do not know what it is — it was not
stated before this handoff was written, so do not try to infer it from the baton's Next list or from
anything in these docs. Read the five documents above so you are oriented, post a short summary of
where things stand (what the last sweep found, what is already fixed, what the open lenses are), and
then wait for the owner's instructions.

Context you would otherwise have to rediscover:
- Your next entry ID is RV-35. IDs count up forever from your own letter; there is no band and no
  pointer. Find it with: grep -rhoE '\bRV-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1 — but note
  that docs/agents/README.md and docs/implementation-backlog.md both carry RV-31 as a prose
  example, which that command cannot tell from a real entry.
- All three findings of sweep 40 (RV-32, RV-33, RV-34) shipped and are closed. Their Known-Issues
  row has been moved to docs/overview/known-issues-resolved.md. Nothing from that sweep is owed.
- The standing ceiling is the device: you run the web build only, so no safe-area, native-plugin or
  native-SQLite finding can originate here, and every write-up must say so.
- Production is readable via POST /api/admin/db-query over the claude_ro views, but those views are
  row-scoped to the owner. When a bug's victim is another account, that view structurally cannot
  see it — write "no evidence in the owner's rows", never "it has not happened".
- Setup: pnpm install --frozen-lockfile if node_modules is missing, then pnpm db:local, then
  env -u DATABASE_URL -u DATABASE_SSL pnpm dev. Both vars are pre-set to production in the container
  and Next will not let .env.local override an already-set process.env var.
- Four PRs from other agents were open when this handoff was written (#370, #372, #373, #374). Check
  the open-PR list before any whole-file or whole-directory chore.
```
