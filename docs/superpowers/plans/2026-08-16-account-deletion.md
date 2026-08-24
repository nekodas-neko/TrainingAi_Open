# Plan — self-service account deletion (Q-287)

**Written:** 2026-08-16 · **Status:** ✅ **ALL SEVEN DECISIONS RESOLVED 2026-08-23 — see §12.**
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

## 2. ✅ DECIDED 2026-08-23 (owner) — hard delete, not a tombstone.

| | Hard delete | Tombstone (`deleted_at` on `users`, rows retained) |
|---|---|---|
| Play compliance | ✅ unambiguous | ⚠️ needs the data genuinely inaccessible + a stated retention window |
| Reversible within a grace period | ❌ | ✅ trivially |
| Effort | higher (order matters) | lower |
| Leaves orphaned rows | no | yes, until a purge job — **and there is no cron layer** (`module-map.md` §0) |

**Recommendation: hard delete, after a grace period (Decision 3).** The tombstone route needs a purge
mechanism this app deliberately does not have, so "deleted" would mean "hidden indefinitely" — which
is the thing the Play requirement exists to prevent.

## 3. ✅ DECIDED 2026-08-23 (Orchestrator, per this plan's own recommendation — reversible, no
owner preference involved) — measure (c) first, fall back to (b).

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

## 4. ✅ DECIDED 2026-08-23 (owner) — a 14-day grace period, not the plan's own recommendation.

The owner chose the grace period over this plan's original "no grace period, export-first"
suggestion — a scheduled, reversible deletion beats an immediate one, and the mechanism problem this
section raised (no cron layer) has a known answer already used elsewhere in this repo: **check on
the next authenticated request, not on a schedule.** Q-270 solved the identical "no cron" gap for a
different feature by warming a route once per app launch; the deletion sweep is the same shape — on
sign-in (web or app), if `deletion_requested_at` is more than 14 days in the past, execute the delete
before serving the request. Sign-in during the window still cancels it, per this section's original
design. **Do not build a scheduler for this** — it is one more instance of a pattern that already
exists.

## 5. 🔸 OWNER DECISION 4 — the export must be fixed first

`/api/export` covers **27 domains of 80 tables** (**Q-288**). If deletion offers "download your data
first", that export is the user's last chance at their own history — and it currently omits their
heart rate, derived scores, AI conversations and nutrition plans. **Q-288 should land before Q-287
ships**, and this plan treats it as a hard dependency.

## 6. ✅ DECIDED 2026-08-23 (Orchestrator — cheap, reversible, not the owner's preference to
weigh) — delete the row. A friendship with a deleted account is meaningless on either side, and
this is what every other cross-user relationship in the schema already does on a hard delete. If
this ever needs a softer touch (notifying the other party, say) it is a small, independent addition
later, not a reason to hold this plan on it now.

## 7. ✅ DECIDED 2026-08-23 (owner) — refuse deletion for the last remaining admin. Matches this
plan's own recommendation exactly. `db-query` and every other admin-only tool this repo's session
routine depends on stays reachable.

## 8. ✅ DECIDED 2026-08-23 (Orchestrator, per this plan's own recommendation — reversible,
mechanical) — a web route on the Railway domain, reached through the sign-in path that already
exists. An email process is strictly more work for the same compliance outcome.

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

## 11. Where each decision landed (2026-08-23)

| # | question | who | answer |
|---|---|---|---|
| 1 | hard delete vs tombstone | **owner** | hard delete |
| 2 | big-table delete mechanism | Orchestrator | measure (c) first, fall back to (b) |
| 3 | grace period | **owner** | 14 days, executed on next authenticated request (no cron needed) |
| 4 | Q-288 must land first | (already settled — a hard dependency, not a preference) | unchanged |
| 5 | friendship rows | Orchestrator | delete them |
| 6 | last admin | **owner** | refuse the deletion |
| 7 | web-accessible path | Orchestrator | a web route on the existing sign-in path |

**All seven are resolved. Nothing here still needs the owner.** §9's implementation sketch is
buildable as written, behind `Needs: Q-288` in the backlog entry.
