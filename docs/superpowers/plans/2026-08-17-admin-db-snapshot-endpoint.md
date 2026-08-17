# Plan — admin DB snapshot endpoint (Q-530)

**Written:** 2026-08-17 · **Status:** ready to implement · **Backlog:** Q-530
**Supersedes shape (a) of** [Q-251](../../implementation-backlog.md) — the rescoped "prod-shaped
database to run against" half. Q-251's shape (b), a second Railway service, stays deferred.

**Verdict up front: build it, and it is much smaller than Q-251 implies.** The scoping map does not
need to be shared, extracted, or duplicated, because `claude_ro` **is already the export** — 80
views, one user, default-deny, secrets withheld, served by a role that cannot write. The endpoint is
a paginated `SELECT *` over that schema plus a drift gate. No new scoping logic is written, so there
is nothing to drift.

---

## 1. What was measured, against production, on 2026-08-17

Via `POST /api/admin/db-query`. Every number below is the owner's, per the row-scoping constraint in
`CLAUDE.md`.

| | |
|---|---|
| Database size | **477 MB** |
| `oura_raw_samples` | **1,098,183 rows / 360 MB** — of which **1,098,005 are the owner's** |
| `error_events` | 13,196 rows / 49 MB |
| `oura_heartrate` | 61,353 rows / 32 MB — **all** the owner's |
| `rr_intervals` | 53,044 rows / 11 MB — 53,027 the owner's |
| Everything else, combined | **~25 MB**, and mostly index overhead on near-empty tables |
| Base tables in prod | 83 · `claude_ro` views **81** · denied **2** — currently in sync |

**The finding that reshapes the design: filtering to one user removes 0.02% of the volume.** The
owner owns 99.98% of `oura_raw_samples`. Scoping to one user is a *consent* fix, and Q-251 is right
that it removes the consent problem structurally. It is **not** a size fix, and nothing in Q-251
should be read as implying it is.

**The second finding is the one that makes this cheap.** The data that migration rehearsal and
data-shape realism actually need is tiny: 90 workout sessions, 1,019 set logs, 76 sleep sessions,
114 body metrics, 205 food logs, 62 `oura_daily` rows. Excluding the four bulk tables gives a
snapshot of **a few megabytes** covering every shaped domain. The 360 MB table is one domain, and it
is the one domain nobody rehearses a migration against by loading all of it.

So the default export excludes `oura_raw_samples`, `oura_heartrate`, `rr_intervals` and
`error_events`, and a `?bulk=<days>` parameter includes a trailing window of each. That is where the
value is, and it sidesteps nearly all of the volume engineering.

---

## 2. Who the consumer is — and it is not the owner

This matters because it decides whether an HTTP endpoint is the right artifact at all.

The owner has `pg_dump` and network access to Railway;
[`docs/runbooks/db-backup-restore.md`](../../runbooks/db-backup-restore.md) already documents that
path. For the owner an endpoint is **strictly worse** than `pg_dump --format=custom`: lower
fidelity, more code, another secret. If the owner were the consumer, this plan would end here with
"use the runbook".

The consumer is the **agent sandbox**, which reaches production over 80/443 only — Railway's
Postgres port is blocked by the network policy. An HTTPS endpoint is the sole transport into a
session. That is the whole justification, and it should be stated in the code comment so nobody
later "simplifies" this into a script that shells out to `pg_dump`.

Two alternatives were considered and rejected:

- **The owner dumps and hands the file over.** The sandbox still needs to fetch it over HTTPS from
  somewhere, which is an endpoint with extra manual steps in front of it.
- **A GitHub release asset.** The repo is public. Months of one person's health data on a public URL
  is not a candidate.

---

## 3. Design — read `claude_ro`, write no new scoping map

`scripts/generate-claude-ro-views.js` already answers *for every table, how does a row reach a
user?*, and fails rather than emitting an unscoped view for anything it cannot classify. The
endpoint does not reimplement that, mirror it, or import a shared copy of it. It reads the views the
generator produced.

That inherits, for free and structurally:

| Property | Where it comes from |
|---|---|
| One-user row scoping | the view's own `WHERE` predicate |
| Default-deny on new tables | a table with no view is not in the enumeration |
| Column withholding (9 columns) | the view's `SELECT` list |
| Cannot write, ever | the `claude_readonly` role — `default_transaction_read_only`, no write grants |
| Cannot starve the app pool | `getReadonlyPool()`, `max: 2`, separate from the app's `max: 10` |
| Third-party tables absent | `invited_emails` / `rate_limits` have no view |

**This is the answer to "can the scoping map be shared rather than duplicated".** It can do better
than shared: there is exactly one map, in one file, and the second consumer reads its *output*
rather than its source. Nothing to keep in step.

Note the [account-deletion plan (Q-287)](2026-08-16-account-deletion.md) §1 independently reached
"reuse that map, do not rebuild it" for a third consumer. Three consumers now depend on that
generator being the authority. Anyone tempted to hand-write a table list should read all three
first.

### 3.1 Route

`GET /api/admin/db-snapshot` — read-only, GET-only, NDJSON, `Content-Disposition: attachment`.

Auth mirrors `app/api/admin/day-review/route.ts` exactly, which is the established fail-closed
pattern in this repo:

1. `Authorization: Bearer <ADMIN_SNAPSHOT_SECRET>` — per-IP rate limit **before** the compare, so a
   brute force cannot run at full throughput; `safeCompare`; identical 401 for a trip and for a bad
   token.
2. Both `ADMIN_SNAPSHOT_SECRET` and `ADMIN_EXPORT_USER_ID` (falling back to `WEBHOOK_USER_ID`) must
   be set, or the token path is **disabled** — never skipped.
3. The resolved user must still pass `requireAdmin`. The token widens transport, never authority.
4. `isReadonlyDbConfigured()` must be true, or 503. Unconfigured means off, not open.
5. An admin session cookie is the second way in, same as day-review.

**Use a new secret, not `ADMIN_EXPORT_SECRET`.** Day-review returns 31 days of derived scores; this
returns the database. Different value warrants a different key and an independent rotation cadence,
and it keeps a leak of one from being a leak of both.

> **Settled 2026-08-17.** The owner approved the separate secret and set `ADMIN_SNAPSHOT_SECRET` in
> both Railway and the Claude Code environment. Neither copy has been exercised, and neither can be
> until this route exists — no code reads the variable yet. The first verification is a `200` plus a
> manifest line from
> `curl -si …/api/admin/db-snapshot -H "Authorization: Bearer $ADMIN_SNAPSHOT_SECRET"`; a `401`
> there means the two copies disagree rather than that the route is wrong.

### 3.2 Parameters

| Param | Default | Effect |
|---|---|---|
| `bulk` | `0` | Trailing days of `oura_raw_samples` / `oura_heartrate` / `rr_intervals` / `error_events` to include. `0` omits them; `all` includes everything. |
| `tables` | all | Comma-separated allowlist, for pulling one domain. |

Every response opens with a manifest line — snapshot time, view count, per-table row counts, the
resolved `bulk` window, and the list of tables **deliberately omitted**. A consumer must never have
to infer completeness from what happens to be in the file.

### 3.3 Streaming

`pool.query` buffers a whole result set in memory. `lib/export/full-export.ts` does exactly that per
table today (harmless at 26 small tables; an OOM the moment anything large is added — see §7).
`pg-cursor` is **not** a dependency and this does not need it.

Instead: **keyset pagination by primary key**, ~5,000 rows per query, streamed out as NDJSON through
`ReadableStream`. Verified against production — **every one of the 83 tables has a primary key**, so
there is no fallback case to design. The primary-key columns are read from `pg_index`/`pg_attribute`
at request time.

Chunking also fits the readonly pool's `statement_timeout: 10_000` without touching it, which is the
point: a chunk is small enough that the existing bound is never the thing that breaks, so no safety
setting has to be relaxed to make the feature work.

---

## 4. What happens when a new table is added and nobody regenerates the views

**The export fails, with the table named in the error.** Not omitted, and never included unscoped.

The gate is computed at request time from the live database, not from a committed list:

```
public base tables  −  claude_ro views  −  claude_ro deliberately-excluded  =  ∅
```

Verified against production: the `claude_readonly` role **can** read `pg_class` and `pg_attribute`
for `public` — 83 tables, 944 columns — even though it holds no `SELECT` privilege on any of them.
`pg_catalog` does not filter by privilege the way `information_schema` does. The gate is therefore
implementable from the read-only connection, which is what keeps it honest: it inspects the database
being exported rather than a schema someone believes is current.

Two supporting changes to `scripts/generate-claude-ro-views.js`, both small:

- Emit `claude_ro._meta_excluded_tables` — the `DENIED` set as a view. Without it the endpoint would
  need its own copy of `['invited_emails', 'rate_limits']`, which is exactly the two-copies-drift
  this design exists to avoid, however small the list.
- Emit `claude_ro._meta_withheld_columns` — the `DENY` map as `(table_name, column_name)` rows. This
  makes the gate **column-level**: for every public table, every column must appear either in its
  view or in this list. A column added to an existing table without regenerating the views is the
  same drift as a whole table, and it is the quieter half.

### Why a runtime gate when a CI test already exists

`lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts` asserts
`views == tables - 2`. Keep it — but it is not sufficient here, for four reasons, three of them
recorded in the test file's own comments:

1. It is a **count**, not a set of names. Two offsetting changes pass.
2. It is **column-blind**.
3. It pins the views migration by filename, and **that pin went stale silently between 181 and 185**
   — the file says so. A green suite proves no *table* was added, not that the pin is current.
4. It runs against the **local** schema. `CLAUDE.md`'s standing root cause is prod drifting from the
   fresh local seed, so a local-only gate is the wrong place to guarantee a property of a production
   export. (It also skips entirely under the Unix-socket `DATABASE_URL` the session-start hook
   writes, so in a sandbox session it does not run at all. CI uses the TCP form and does run it.)

The runtime gate closes all four, and it fails the *export* rather than a test run — the failure
lands on the person about to rely on the file.

---

## 5. Round-trip into local dev — yes, first-class

A snapshot nobody can load is a file, not a capability. `pnpm db:snapshot`:

1. **Refuse unless the target is the local socket/loopback DB on port 5433.** Hard guard, first
   thing, before anything is fetched. This command drops tables; pointing it at a Railway URL must be
   impossible rather than discouraged.
2. Fetch the NDJSON to the scratch directory, streaming to disk.
3. `pnpm db:local` first so every migration is applied — the snapshot carries **data, not schema**.
   That is deliberate and it is the property that makes migration rehearsal work: apply migration N,
   load prod-shaped rows, then run N+1 and see what it does to real values.
4. `TRUNCATE` the target tables, then `COPY` in, under `session_replication_role = replica` so FK
   order stops mattering. The local `postgres` user is a superuser, so this is available.
5. Resync any sequences.
6. Stamp a known bcrypt hash onto the owner's `users` row (§5.1).
7. Print per-table loaded counts against the manifest's counts, and **fail loudly on any mismatch**.

### 5.1 Two round-trip constraints, verified against the live schema

- **`push_subscriptions` cannot round-trip and must be skipped outright.** All three of its withheld
  columns — `endpoint`, `p256dh`, `auth` — are `NOT NULL`, so a view row cannot be inserted. Skip the
  table; a local dev DB has no use for real push subscriptions, and synthesising placeholders would
  put a fake credential in a table whose whole content is credentials. Record the skip in the
  manifest.
- **`users.password_hash` is withheld and nullable**, so a restored owner row has no password and
  cannot log in with credentials. The restore stamps the same bcrypt hash `scripts/local-db/seed.sql`
  already uses (`testpass123`), so `pnpm dev` is usable immediately. The other six withheld columns
  are all nullable and restore as `NULL` without incident.

---

## 6. What an attacker gains if `ADMIN_SNAPSHOT_SECRET` leaks

Stated plainly, because the repo is public and this is the part that has to be right by construction
rather than by review.

**They get.** The owner's entire health history in one request: every sleep session, HR and HRV
sample, weight and body-fat reading, food log, mood entry, workout and set log, AI-coach
conversation (`coach_messages`), AI call log, and — with `bulk` — 1.1 million raw ring samples. Plus
the owner's `users` row: email, name, timezone, admin flag. Plus `db_query_log`, which is the SQL
text of every admin query ever run and therefore a schema map and a record of admin behaviour. Plus
the *user ids* on the far side of any `friendships` row (an id, not that person's data).

**They do not get.** Write access of any kind — the role has no write grants and
`default_transaction_read_only` is on, and `claude_ro` exposes views only. No credential: the nine
withheld columns cover `users.password_hash`, all four `oura_tokens` secrets including the webhook
signing key, all three Web Push credentials, and `feedback_submissions.screenshot_data`. No other
user's rows — every view is predicated on the owner's id, and `invited_emails` / `rate_limits` have
no view at all.

**So the honest characterisation is: total health-data disclosure for one person, no account
takeover, no write path, no third-party exposure.** Serious, bounded, and not escalating.

**The marginal risk over today is smaller than it looks, and this is the load-bearing point.**
`CLAUDE_DB_QUERY_SECRET` already sits in every agent session's environment and already reads exactly
this data through `POST /api/admin/db-query` — same views, same role, same scope, 1,000 rows and 5 MB
at a time. The snapshot adds **no new data class and no new authority**. It adds bulk egress speed
and a second key to manage. That is the true delta, and it is what makes this a modest incremental
risk rather than a new exposure.

**Mitigations to build in, none of them novel:** per-IP rate limit before the compare;
`safeCompare`; identical 401s; `requireAdmin` on the resolved user; fail-closed on either env var;
the `max: 2` pool so bulk reads cannot starve the app; and an audit row per snapshot in
`db_query_log` (table list, byte count, caller IP) so an unexpected pull is visible after the fact.
Rotation is a Railway variable change with no deploy.

**One residual worth naming:** a snapshot is a read-amplification lever — repeated `bulk=all` pulls
scan 360 MB each. The `max: 2` pool bounds the blast radius to the readonly pool, and the rate limit
bounds frequency. Set that limit low (2/hour is generous for the actual use).

---

## 7. Why not extend `/api/export` — and a defect found while checking

`/api/export` is a different product wearing a similar name:

| | `/api/export` | `/api/admin/db-snapshot` |
|---|---|---|
| Auth | any logged-in user | admin + secret |
| Scope | the **caller's** rows | the configured owner's rows |
| Purpose | GDPR-style takeout of user content | prod-shaped DB for rehearsal |
| Must include ops tables | no — actively must not | **yes**, that is the shape |

Merging them means one route with two authorization models and two table sets, which is worse than
two routes. **Separate route.**

**The defect, folded into the existing Q-288 rather than filed fresh.** Checking whether the route
could be extended re-measured its coverage at **26 of 82 tables** — Q-288 was filed on 2026-08-15 at
"27 of 80" and already prescribes the right fix (drive the list from the generator's classification
rather than hand-extending the array). Two things this session adds to it: a corrected count and ten
further omissions including the user's own `users` profile row, and — the new one —

> **the route cannot stream a large table at all, and its comment claims it can.** `exportUserData`
> calls `pool.query` per table, buffering each result set whole; only the per-table `ReadableStream`
> enqueue is genuinely streaming. Harmless across 26 small tables, an OOM the moment a bulk table is
> added to close the coverage gap. **Q-288 must fix the buffering and the coverage together**, with
> the keyset chunking from §3.3.

No new Q number was taken. A duplicate was drafted here first and caught by grepping the queue before
landing — worth repeating, since Q-288's own heading names the same file this section is about.

---

## 8. Implementation order

1. `scripts/generate-claude-ro-views.js` — emit `_meta_excluded_tables` and `_meta_withheld_columns`.
   Regenerate into a **new** migration number (never overwrite an applied one), and re-point the
   filename pin in `claude-ro-readonly-role.test.ts` in the same commit.
2. `lib/export/db-snapshot.ts` — view enumeration, the §4 drift gate, PK discovery, keyset chunking,
   the manifest. This is where the tests go, and they are cheap: the gate is a pure set operation
   over catalog rows.
3. `app/api/admin/db-snapshot/route.ts` — auth (copy day-review's `authorize`), params, stream.
4. `scripts/local-db/snapshot.js` + `pnpm db:snapshot` — the §5 restore, guard first.
5. Docs: an env-var row in `CLAUDE.md` for `ADMIN_SNAPSHOT_SECRET`, a `docs/module-map.md` row, and
   a section in `docs/runbooks/db-backup-restore.md` distinguishing this from `pg_dump` (fidelity vs
   reachability) so the two are not confused later.

### Tests that carry weight

- Drift gate: a table present in `pg_class` with no view **fails the export**, and the error names it.
- Drift gate: a column present on a table but absent from both its view and `_meta_withheld_columns`
  fails the export.
- Auth: unset secret → 401 on the bearer path (disabled, not skipped); non-admin resolved user → 403.
- Chunking: a table larger than one chunk emits every row exactly once, with no gap at the boundary.
- Round-trip: manifest counts equal loaded counts; `push_subscriptions` is skipped and **said so**.

---

## 9. Deliberately not in scope

- **A second Railway service.** Q-251 shape (b), still deferred. This closes the data half only.
- **Schema in the snapshot.** Migrations are the schema. §5 step 3 depends on that.
- **Anonymisation or scrubbing.** Filtering to one consenting user replaced it — that was the
  owner's call on 2026-08-17 and is the better answer, since scrubbing is a property you have to keep
  getting right and scoping is one you get once.
- **Writing back to production.** No path, by construction — the role cannot write.
- **Whether the ~10 data-gated device-verification rows actually close.** They should, since
  `pnpm dev` against a restored snapshot renders real data — but `CLAUDE.md`'s rule is that a row is
  struck when it is *observed* working, not when a capability that should cover it lands. Re-check
  each row; do not bulk-strike.

## 10. Failure surfaces this plan has NOT exercised

Nothing here is built. The production measurements in §1, the `pg_catalog` readability in §4, the
primary-key coverage in §3.3 and the column nullability in §5.1 were each run and are quoted from
output. Not exercised: the endpoint (does not exist), the restore path, load behaviour of a
`bulk=all` pull against the live database, and any device surface — this touches no client code and
needs no APK.
