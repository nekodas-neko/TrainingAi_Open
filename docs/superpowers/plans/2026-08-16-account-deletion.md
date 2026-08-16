# Plan — self-service account deletion (Q-287)

**Written:** 2026-08-16 · **Status:** ⛔ **DRAFT AWAITING OWNER DECISIONS — do not implement**
**Backlog:** Q-287 · **Why:** Google Play has required an in-app *and* web-accessible account-deletion
path since 2024, and the Play Store listing is a stated goal in `CLAUDE.md`.

Q-287 says the first deliverable is a plan, not a route, because deletion is destructive and
irreversible and `CLAUDE.md`'s *Safety & Reversibility* rule makes it confirm-first. **This document
is that plan. Nothing here is built.** Seven decisions are marked **🔸 OWNER** — each changes what
gets written, and none can be inferred from the code.

---

## 1. The part that is already solved — reuse it, do not rebuild it

`scripts/generate-claude-ro-views.js` had to answer exactly the question deletion asks: *for every
table, how does a row reach a user?* It classifies all ~80 tables into four buckets and **fails
loudly on anything it cannot classify** rather than guessing:

- **`user_id` column** — the common case, deleted directly.
- **`VIA` FK path** — 17 tables reachable only through a parent. The map is written out, including
  the two-joins-deep cases (`set_logs`, `schedule_days`, `session_exercises`, `meal_plan_meals`) and
  the `program_phases` subtlety where `program_id` is nullable and `phase_set_id` is the real path.
- **`GLOBAL`** — shared catalogue (`exercise_library`, `activity_types`, `dietary_restrictions`, …).
  **Never deleted.**
- **`DENIED`** — `invited_emails`, `rate_limits`.

**The deletion routine should be generated from, or at minimum validated against, that same map**,
with the same default-deny failure mode: a table that is neither user-scoped, FK-reachable, nor
explicitly global must **fail the build**, not be silently skipped. A table added later and missed by
a hand-written delete list is a row of someone's health data surviving their deletion request.

**Deletion order = reverse of the FK path**, leaves first: `set_logs` → `exercise_logs` →
`workout_sessions`; `schedule_days` → `schedules`; `meal_plan_meals` → `meal_plan_variants` →
`meal_plans`; `style_sets` → `progression_styles`; `session_exercises` → `program_sessions` →
`programs`. `CLAUDE.md` records that an `ON DELETE SET NULL` once wiped session identity across four
deploys — **do not rely on cascade behaviour; delete explicitly in order.**

---

## 2. 🔸 OWNER DECISION 1 — hard delete or tombstone?

| | Hard delete | Tombstone (`deleted_at` on `users`, rows retained) |
|---|---|---|
| Play compliance | ✅ unambiguous | ⚠️ needs the data genuinely inaccessible + a stated retention window |
| Reversible within a grace period | ❌ | ✅ trivially |
| Effort | higher (order matters) | lower |
| Leaves orphaned rows | no | yes, until a purge job — **and there is no cron layer** (`module-map.md` §0) |

**Recommendation: hard delete, after a grace period (Decision 3).** The tombstone route needs a purge
mechanism this app deliberately does not have, so "deleted" would mean "hidden indefinitely" — which
is the thing the Play requirement exists to prevent.

## 3. 🔸 OWNER DECISION 2 — `oura_raw_samples` is 341 MB and ~1M rows for one user

A synchronous `DELETE` of that volume inside a request will exceed `statement_timeout: 15_000`
(`lib/data/postgres/client.ts`). Options:

- **(a) Batched background delete** — needs something to drive it, and there is no job queue. Could be
  driven by subsequent requests, which is fragile.
- **(b) Delete in chunks inside the deletion request, largest table last**, accepting a slow response
  (10–60 s) behind a progress UI.
- **(c) `DELETE ... WHERE user_id = $1` on a partitioned/indexed path**, measured first — it may be
  faster than feared given the index exists.

**Recommendation: measure (c) first on the local seeded DB** — the load-test seeder already produces
realistic volumes — and fall back to (b). Do not build a job queue for this.

## 4. 🔸 OWNER DECISION 3 — grace period?

Play permits a delay if it is disclosed. **Recommendation: 7 days, `deletion_requested_at` on `users`,
sign-in during the window cancels it.** Requires something to execute the delete when the window
expires — and with no cron, the honest options are: execute on the user's next sign-in attempt
(unreliable — they may never return), or **execute immediately and offer export-before-delete
instead**. The second is simpler and still compliant.

**Sub-recommendation: no grace period; make export mandatory-offer before the final confirm.** It
avoids inventing a scheduler for one feature.

## 5. 🔸 OWNER DECISION 4 — the export must be fixed first

`/api/export` covers **27 domains of 80 tables** (**Q-288**). If deletion offers "download your data
first", that export is the user's last chance at their own history — and it currently omits their
heart rate, derived scores, AI conversations and nutrition plans. **Q-288 should land before Q-287
ships**, and this plan treats it as a hard dependency.

## 6. 🔸 OWNER DECISION 5 — `friendships` is two-sided

`friendships` is scoped `requester_id = $OWNER OR addressee_id = $OWNER`. Deleting user A removes
rows that are also user B's data. **Recommendation: delete the row** (a friendship with a deleted
account is meaningless) but confirm you agree, since it mutates another user's visible state.

## 7. 🔸 OWNER DECISION 6 — deleting the only admin

You are the only admin. Deleting your account removes admin access to `/api/admin/*`, including the
`db-query` endpoint every one of these reviews used. **Recommendation: refuse deletion for the last
remaining admin** with a clear message, rather than allowing a self-lockout.

## 8. 🔸 OWNER DECISION 7 — the web-accessible path

Play requires deletion to be initiable **outside the app** too. Options: a route on the Railway
domain reachable after web sign-in (cheapest — the app already has web auth), or a documented email
process. **Recommendation: a web route**, since the sign-in path already exists.

---

## 9. Implementation sketch (only after the seven decisions)

1. **Migration** — `deletion_requested_at` on `users` only if a grace period is chosen (Decision 3).
2. **`lib/data/deletion.ts`** — a single ordered delete driven by the `claude_ro` scoping map, with a
   test asserting **every table in the schema is either deleted, explicitly global, or explicitly
   exempt** — failing on an unclassified table, mirroring the generator's default-deny.
3. **`DELETE /api/account`** — session-auth, requires re-authentication, rate-limited, refuses for the
   last admin, returns a summary of what was removed.
4. **UI** — More → Settings → Delete account: export-first offer, typed confirmation, explicit list of
   what is destroyed, no default-focused destructive button.
5. **Web route** — the same flow at a URL reachable from a browser.
6. **Tests** — a seeded user is fully removed; a *second* user's rows are untouched (the cross-user
   check `CLAUDE.md` says 90% of the DB suite is blind to); an unclassified table fails the suite.

## 10. What this plan deliberately does not do

- **No cron / job queue.** `module-map.md` §0 is explicit and one feature does not justify reversing it.
- **No soft-delete-everything refactor.** Several domains already have `deleted_at` for sync
  tombstones; that is a different mechanism for a different purpose and should not be conflated.
- **No "anonymise instead of delete".** It reads as compliance theatre and the data here is health
  data.

---

## 11. What I need from you

Answer the seven 🔸 decisions — or just say *"go with your recommendations"*, in which case the
defaults are: **hard delete · measure the big-table delete first · no grace period, export-first ·
Q-288 lands first · friendship rows deleted · last admin protected · web route.**

**I will not write any of it until you have.**
