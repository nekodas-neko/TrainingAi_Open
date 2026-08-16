# Plan: safe read-only production-DB access for Claude sessions

**Source:** owner directive 2026-07-26 — *"what would be the correct way to give you read access to
view the DB so when you are testing or I am asking why scores or data is what it is you would be
able to see the actual data rather than have me upload?"* Branch (when implemented):
`feat/claude-readonly-db`.

**Status:** PLAN ONLY — not implemented. This touches auth, secrets and production data access, so
it is confirm-first per CLAUDE.md. **Do not implement without the owner explicitly approving the
open decisions in §8.**

---

## 1. Problem

Every question of the form "why is this score/number what it is on real data?" currently ends in a
manual dump: the owner runs a query or taps Copy JSON and pastes the result. That is slow, it is
lossy (the answer often needs a *different* slice than the one pasted), and it means diagnosis
happens one round-trip per question.

The `Admin → Day Review` tool (v1.210.0) removed this for exactly one shape of data — the four
score pillars for a day. It does not generalise. Anything else (raw BLE samples, set logs, food
logs, program structure, sync state) still needs a dump or a new bespoke endpoint.

## 2. The hard constraint: only 80/443 are open

**A read-only Postgres role alone does not solve this.** Claude Code sessions run in a sandbox whose
network policy permits outbound 80/443 only; Railway's Postgres proxy port is blocked. `psql` from a
session fails regardless of credentials. This is the same constraint documented in CLAUDE.md's "Local
Development Database" section, and it is why the local seeded Postgres exists at all.

Therefore **read access must be SQL-over-HTTPS**: a route on the Next app that executes a query and
returns rows. Every design below follows from that.

## 2b. The stronger case: whole-history auditing (owner, 2026-07-26)

The framing in §1 — "answer the owner's questions faster" — undersells this. The larger value is
**questions nobody thinks to ask**: sweeping the full recorded history for drift, orphans and silent
breakage. This codebase's own history is the argument, because a striking number of its worst bugs
were only ever detectable in real production data:

- **Stored counters drift.** `sessions_in_phase` has been fixed *three separate times* (over-counted
  on re-sync, never decremented on delete, inflated by manual edits). CLAUDE.md's rule is
  "derive, or reconcile on read" — but nobody can currently check whether today's stored values
  actually match a derived recount.
- **Prod data drift vs the fresh local seed.** CLAUDE.md explicitly says *"a bug that reproduces in
  prod but not locally: suspect prod data drift before suspecting code"* — and the treadmill
  `is_distance_based` flag sat wrong in production for months precisely because no one could see it.
  That advice is currently unfollowable from a session.
- **"Prove a non-null value lands in the DB column."** The standing rule for every external-API
  integration. `sleep_sessions.onset_latency_sec` was NULL from the day the Oura integration shipped
  because of a wrong field name. Verifying the current null-rate of every such column is a single
  query and is exactly the check the rule demands.
- **The readiness-persist-day bug** found by Day Review on 2026-07-26 (`projectOverview.md` Known
  Issues): the composite is written under `latestSummary.date` rather than the day its inputs
  describe. **How many rows are affected, and over what span, is unanswerable today.** That is the
  shape of the problem — a bug is identified but its blast radius can't be measured.
- **Sync integrity** — dead-lettered outbox mutations, tombstones that never propagated, local/server
  row-count divergence per domain. All invisible without production reads.
- **Storage growth** — `oura_raw_samples` hit 92% of the 1 GB volume and needed an owner-run
  `REINDEX`. Per-table growth rates are a query, not a crisis response.

None of these are "the owner asks a question". They are **standing audits** that would find problems
before they surface as symptoms, and they are the reason this is worth more than the §1 framing.

**What read access does NOT verify.** A clean audit must not be mistaken for "everything works".
Large parts of this app's failure surface leave no trace in Postgres: native SQLite migrations on the
S25, BLE drain behaviour, safe-area insets, Samsung WebView rendering, gesture handling, local-store
reads. The device smoke checklist stays the authority for all of it. Read access proves things about
*recorded data*, not about the app.

### Time-boxed access as the middle path

Standing access is not required to capture most of the audit value. Because the secret is a single
Railway variable and the grant is one `REVOKE`, access can be opened for a defined window:

1. Owner sets `CLAUDE_DB_QUERY_SECRET`.
2. A session runs the full-history audit sweep (§2c) and writes findings to
   `docs/reviews/YYYY-MM-DD-prod-data-audit.md`, with fixes queued as normal backlog items.
3. Owner unsets the variable (or runs the `REVOKE`). Exposure ends.

This bounds the window to hours rather than forever, while still getting the sweep. Repeat quarterly,
or whenever a bug's blast radius needs measuring. **Recommended over standing access for the first
run** — it also produces evidence about how useful the capability actually is before committing to
leaving the door open.

### 2c. Audit sweep the first session should run

A concrete work-list, so "do an audit" isn't hand-waving:

| Check | Shape |
|---|---|
| Stored-counter drift | `sessions_in_phase` vs a derived recount per program phase |
| Readiness-persist blast radius | `oura_daily_derived` rows whose `readiness_*` provenance disagrees with the day's own signals |
| Null-rate per integration column | % NULL for every Oura/Health-Connect-populated column, flagging any at 100% |
| Orphans / FK integrity | child rows whose parent is missing (`set_logs`→`exercise_logs`→`workout_sessions`) |
| Sync health | dead-lettered outbox rows by domain and age; tombstones older than the pull window |
| Duplicate-key smells | the known migration-number collisions (081×2, 087×2) and any rows they produced |
| Storage growth | per-table size + row counts, growth vs the 1 GB volume cap |
| Timezone boundary bugs | rows whose `date` disagrees with their timestamp converted to the user's tz |
| Score sanity | distribution of each pillar's score over all history — the check the tuning work actually needs |

## 3. Non-goals

- **Write access of any kind.** Not reduced-privilege writes, not "just for migrations". Never.
- **Replacing the local dev DB.** Day-to-day development and testing continue against the local
  seeded Postgres, which sessions already have full access to. This endpoint is for questions that
  can *only* be answered by real production data.
- **Replacing Day Review.** That stays the ergonomic path for score tuning; this is the escape hatch.

## 4. Design

### 4.1 Read-only is enforced by the Postgres role, not by inspecting the SQL

This is the load-bearing decision. **Do not implement an "is this a SELECT?" regex or keyword
allowlist** — that class of check is routinely bypassed:

```sql
WITH x AS (INSERT INTO users(...) VALUES (...) RETURNING *) SELECT * FROM x;  -- "starts with WITH"
SELECT some_function_with_side_effects();                                      -- "it's a SELECT"
```

Instead, a dedicated role that is physically incapable of writing:

```sql
CREATE ROLE claude_readonly LOGIN PASSWORD '<generated>';
ALTER ROLE claude_readonly SET default_transaction_read_only = on;
ALTER ROLE claude_readonly SET statement_timeout = '10s';
ALTER ROLE claude_readonly SET idle_in_transaction_session_timeout = '15s';
REVOKE ALL ON SCHEMA public FROM claude_readonly;   -- default deny
```

Even a successful injection through this role cannot write, cannot DDL, and cannot run past 10s.

### 4.2 A curated `claude_ro` schema of views — default-deny, not `GRANT SELECT ON ALL TABLES`

A blanket grant over `public` would expose live credentials. Confirmed present in the schema today:

| Column | Why it must never be readable |
|---|---|
| `users.password_hash` | bcrypt hash of the owner's password |
| `oura_tokens.personal_access_token` | live Oura Cloud credential |
| `oura_tokens.access_token` / `refresh_token` | live OAuth credentials |
| `feedback_submissions.screenshot_data` | base64 screenshots — arbitrary on-screen content |

So: grant on a **separate schema of views** that project only safe columns.

```sql
CREATE SCHEMA claude_ro;
GRANT USAGE ON SCHEMA claude_ro TO claude_readonly;

CREATE VIEW claude_ro.users AS
  SELECT id, email, display_name, timezone, date_of_birth, height_cm, sex,
         activity_level, is_admin, is_active, created_at
  FROM public.users;                                  -- password_hash deliberately absent

CREATE VIEW claude_ro.oura_tokens AS
  SELECT user_id, created_at, updated_at,
         (personal_access_token IS NOT NULL) AS has_pat   -- presence, never the value
  FROM public.oura_tokens;

GRANT SELECT ON ALL TABLES IN SCHEMA claude_ro TO claude_readonly;
```

Set the role's `search_path` to `claude_ro` only, so an unqualified `FROM users` resolves to the
view, and `FROM public.users` fails on missing grant.

**Default-deny is the point.** This project adds tables regularly (68 today). With a blanket grant, a
future table holding a new secret is exposed the moment it ships and nobody notices. With a view
schema, a new table is invisible until someone deliberately adds a view — the safe failure mode.

**Cost, stated honestly:** ~64 views to author, and a new table is unreadable until its view is
added. That maintenance burden is the price of default-deny, and it is worth paying. Generate the
initial set with a script that emits `SELECT *` views for every table with no sensitive columns, and
hand-write the four exceptions above.

### 4.3 Its own connection pool, `max: 2`

**Must not share the app's `pg.Pool`.** That pool is `max: 10`, and exhausting it took production
down in session 165 (CLAUDE.md, "Database — Connection Pool"). An ad-hoc query of mine must be
structurally incapable of starving the app.

A separate `Pool` in a new `lib/data/postgres/readonly-client.ts`: `max: 2`, its own
`pool.on('error')` handler (same non-negotiable as the main pool), same `statement_timeout` /
`idle_in_transaction_session_timeout` settings, lazily constructed so it does not exist at all when
the feature is disabled. Connection budget: `10 × replicas + 2` must stay under the Railway limit.

### 4.4 Auth — the pattern already shipped, with its own secret

Reuse the `/api/admin/day-review` bearer shape verbatim (`lib/security/constant-time.ts`,
fail-closed, per-IP rate limit *before* the compare, `requireAdmin` on the resolved user).

**A different secret from `ADMIN_EXPORT_SECRET`** — different blast radius deserves an independently
rotatable credential, and revoking this one must not break Day Review exports.

### 4.5 Bounds on every request

- **Row cap** — wrap the submitted query: `SELECT * FROM (<query>) _q LIMIT 1001`, return 1000 and a
  `truncated: true` flag. Never stream unbounded rows.
- **Byte cap** — hard-stop serialisation past ~5 MB.
- **Single statement** — reject a body containing `;`-separated statements. The read-only role
  already makes multi-statement harmless, but one-query-per-request keeps the audit log honest.
- **Timeout** — 10s, set on the role (so it holds even if the route forgets).

### 4.6 Audit log

Every query writes one row to a new `db_query_log` table (`ai_call_log` is the precedent): timestamp,
the SQL, row count, duration, truncated flag, caller IP, auth path. Written through the **app's
normal writable pool** — the read-only pool cannot write, which is the whole point.

This is what makes the credential auditable after the fact: if the token ever leaks, the log says
exactly what was read.

### 4.7 Schema discovery

Queries can't be written blind. A `GET …?schema=1` mode returns the `claude_ro` view names and their
columns (from `information_schema`), so a session can orient without guessing table shapes.

## 5. Files

| File | Change |
|---|---|
| `lib/data/postgres/migrations/1XX_claude_readonly_schema.sql` | `claude_ro` schema + views. **Idempotent** and containing no password — the role/password is created out-of-band by the owner (§7), because a migration file must never carry a credential. |
| `lib/data/postgres/migrations/1XX_db_query_log.sql` | audit table |
| `lib/data/postgres/readonly-client.ts` | isolated `max: 2` pool, lazily built, `pool.on('error')` handler |
| `app/api/admin/db-query/route.ts` | POST route: auth → bounds → execute → log → respond |
| `lib/security/constant-time.ts` | already exists (shipped v1.210.0), reused |
| `scripts/generate-claude-ro-views.js` | generates the view DDL; re-runnable when tables are added |
| `CLAUDE.md` | env vars + a standing rule that new tables need a `claude_ro` view (or a deliberate omission) |
| `docs/module-map.md` | one row for the read-only pool + route |

## 6. Testing

Route/unit tests mirroring `app/api/__tests__/admin-day-review-auth.test.ts`:

1. **Auth matrix** — no token 401; wrong token 401 at matching *and* differing lengths; malformed
   header 401; unset secret ⇒ token path disabled (fail closed); token resolving to a non-admin 403.
2. **Write attempts fail** — `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, and the
   `WITH … INSERT … RETURNING` CTE form each error against the read-only role. **These must be run
   against a real Postgres with the role applied**, not mocks — the property under test is a
   Postgres grant, and a mocked test proves nothing.
3. **Sensitive columns absent** — `SELECT password_hash FROM users` errors; `claude_ro.users` has no
   `password_hash`; `claude_ro.oura_tokens` exposes `has_pat` but no token value.
4. **`public` unreachable** — `SELECT * FROM public.users` fails on grant.
5. **Bounds** — a 5000-row query returns 1000 + `truncated: true`; a `pg_sleep(30)` query is killed
   by `statement_timeout`; a `;`-separated body is rejected.
6. **Pool isolation** — the read-only pool's `max` is 2 and it is a distinct instance from the app pool.
7. **Audit** — a successful query and a failed query each write exactly one `db_query_log` row.

The local dev Postgres can host the role and schema, so all of this is sandbox-testable — unusually
for this project, there is **no device gate and no real-data gate** on the security properties.

## 7. Owner rollout steps

1. Generate a password: `openssl rand -hex 32`.
2. Against production, create the role (out-of-band, not in a migration — it carries a password):
   the `CREATE ROLE` / `ALTER ROLE` / `REVOKE` block from §4.1.
3. Deploy; the migration creates `claude_ro` and the views and grants `SELECT` on them.
4. Set in Railway: `CLAUDE_DB_READONLY_URL` (the connection string using `claude_readonly`) and
   `CLAUDE_DB_QUERY_SECRET`. **Unset either and the route is disabled.**
5. Rotate by changing the role password + the env var. Emergency stop:
   `REVOKE ALL ON SCHEMA claude_ro FROM claude_readonly;` — takes effect immediately, no deploy.

## 8. ✅ RESOLVED — owner decision 2026-07-26

> *"as this app is 90% a solo app — I'd rather you have the access until we move out of the 'beta'
> phase and know everything is wired up correctly and working as intended."*

**Approved: standing access for the duration of beta**, not the time-boxed window of §2b. The owner
weighed §9 and accepted it. Rationale on record: effectively a single-user app, and the beta phase is
exactly when whole-history wiring verification (§2b) has the most value.

**Defaults taken** (the recommendations from the original §8, unchanged):

1. **Views are unscoped** — all users, not filtered to the export user. Single-user app; the admin
   console already exposes all users.
2. **Arbitrary `SELECT`** over the curated views, not a fixed query catalogue. The audit queries in
   §2c are not knowable in advance; that is the whole point.
3. **Screenshot bytes are NOT exposed** — `claude_ro.feedback_submissions` carries presence and byte
   length only.

### ⏰ Beta-exit review — this access is explicitly temporary

The approval is scoped to beta. It must not decay into a permanent grant by default. **On beta exit
(first non-owner user onboarded, or the owner declaring beta over), whoever is working the repo must:**

1. Unset `CLAUDE_DB_QUERY_SECRET` in Railway, **or** consciously re-approve standing access with the
   §9 risks re-read.
2. If re-approved, revisit decision 8.1 — unscoped views stop being defensible the moment a second
   real user has data in the table.

Tracked as a Known-Issues row in `projectOverview.md` so it surfaces at every session start rather
than living only in this plan.

## 8b. Original open decisions (superseded by §8 above, kept for the record)

1. **Scope views to a single user, or expose all users?**
   48 of 68 tables carry `user_id`; the other 20 are child tables owned transitively (`set_logs`,
   `exercise_logs`, `session_exercises`, …) or true reference data (`exercise_library`,
   `activity_types`). Filtering every view to the configured export user limits a token leak to one
   person's data, but costs ~20 joins to write and makes any future "why does this other user see X"
   question undebuggable through this channel. **Recommendation:** unscoped for now — this is
   effectively a single-user app and the admin console already shows all users — and revisit if real
   other users ever accrue data.
2. **Is arbitrary `SELECT` acceptable, or should this be a fixed query catalogue?**
   Arbitrary SELECT over curated views is far more useful (it is the whole point — the questions
   aren't known in advance). A fixed catalogue is safer but degenerates into the bespoke-endpoint
   treadmill this plan exists to end. **Recommendation:** arbitrary SELECT; the views are the
   security boundary.
3. **Should `feedback_submissions.screenshot_data` be exposed at all?**
   **Recommendation:** no — expose presence + byte length only. Screenshots can contain anything.

## 9. Risks this does NOT eliminate — read before approving

- **A leaked `CLAUDE_DB_QUERY_SECRET` means someone can read the owner's full health history.** Not
  credentials, not writes — but everything else the views cover. That is the deal being made.
- **Query text and results transit Railway logs and this conversation.** Anything read here is in a
  transcript.
- **The audit log is after-the-fact.** It tells you what was read; it does not prevent it.
- **This widens the public attack surface by one authenticated route.** It is rate-limited,
  fail-closed and admin-gated, but it is one more door.

### Recommendation (revised 2026-07-26 after the owner's audit argument)

An earlier draft of this section recommended deferring, on the reasoning that only one bespoke export
had been needed so far. **That reasoning was too narrow** — it counted only owner-initiated questions
and ignored §2b: the standing audits nobody thinks to ask for, several of which this codebase's own
history shows are needed (three separate `sessions_in_phase` drift fixes, a months-long wrong flag in
production, an integration column NULL since ship, and a live bug whose blast radius currently cannot
be measured). Bespoke endpoints do not address that class at all, because the queries aren't known in
advance — which is precisely the argument for arbitrary `SELECT`.

**Build it, and start with time-boxed access** (§2b): open the window, run the §2c sweep, write the
findings up, close the window. That captures the audit value, bounds exposure to hours, and produces
evidence about whether standing access earns its keep before anyone commits to it.

**The narrow-endpoint alternative remains valid for the other half** — a recurring, known-shape need
(like Day Review) is still better served by a purpose-built endpoint than by ad-hoc SQL. The two are
complements, not rivals: fixed endpoints for things looked at repeatedly, query access for
investigation.
