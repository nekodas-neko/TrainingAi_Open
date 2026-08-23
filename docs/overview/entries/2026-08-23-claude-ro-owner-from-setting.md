# 2026-08-23 — The owner's user id left 18 committed migrations (Q-456)

**Branch:** `security/claude-ro-owner-not-in-migrations` · **Lane A** · migration 207

`fe481797-…` is the owner's production `users.id`. `scripts/generate-claude-ro-views.js` interpolated
it into every `claude_ro` view as the row-scoping predicate, and the generated SQL is **committed** —
so it sat in 18 tracked files. Worse, `CLAUDE.md` requires re-running the generator into a *new*
migration whenever a table is added, so the documented process **re-published it on every schema
change**, indefinitely. Invisible while the repo was private; permanent once it was not.

**It is not a credential**, and the entry is emphatic about that: `/api/admin/db-query` needs
`CLAUDE_DB_QUERY_SECRET` **and** `requireAdmin`, and no health data, email or name is exposed with
it. What it is, is one half of a pair — `WEBHOOK_USER_ID` and `ADMIN_EXPORT_USER_ID` resolve to a
user id that is almost certainly this one, so a leak of either secret no longer needs the id guessed.

## Resolved at query time, not generate time

```sql
-- before
WHERE t.user_id = 'fe481797-4114-4f59-824d-223e0281823e'::uuid
-- after
WHERE t.user_id = current_setting('app.claude_ro_owner', true)::uuid
```

The id moves to where the role's password already lives: in the database, set once out of band,
never in a committed file.

```sql
ALTER ROLE claude_readonly SET app.claude_ro_owner = '<the owner user id>';
```

**The two-argument form is the fail-closed choice and is deliberate.** It returns NULL when the
setting is absent, and `user_id = NULL` is never true — so an unconfigured role reads **zero rows**
rather than every user's. One-argument `current_setting` throws instead, which would surface as a
driver error from inside a view rather than an empty result a caller can diagnose. Both directions
are safe; this one is diagnosable.

Migration **207** DROPs and rebuilds the whole schema rather than editing the 18 existing files —
`ensureSchema` tracks by filename, so an edited already-applied migration is skipped forever.

## The test's migration pin was stale again, so it stopped being a pin

The test read `202_claude_ro_views_food_logging_complete.sql` while 205 existed. Its own comment
records the same thing happening between 181 and 185, and notes that a green suite never proves the
pin current — only that no table has been added since. That is a check reporting nothing until it is
too late.

It now resolves the newest `NNN_claude_ro_views*.sql` by filename sort, which is the order
`ensureSchema` applies in, so "newest by sort" is the file production ends up with.

## Verified

Measured against the local database, which has all 207 migrations and **the same 87 tables as
production** (checked, because a generator run against a drifted schema would emit the wrong views):

| | no setting | setting applied | ground truth |
|---|---|---|---|
| `claude_ro.body_metrics` | **0** | 90 | 90 of 466 rows |
| `claude_ro.set_logs` (joined VIA a parent) | **0** | 1,050 | — |

Two mutations, each applied and reverted:

| mutation | fails |
|---|---|
| bake a uuid back into the migration | `no committed views migration names a user id` |
| use the throwing one-argument `current_setting` | `returns ZERO rows when the owner setting is absent` |

Generated SQL contains **zero** occurrences of the owner id; 85 views, 10 columns withheld, 2 tables
denied — unchanged from before. Full suite 559 files / 4,593 tests; `pnpm check:rules` 54 of 54.

## ⚠️ This needs one command from the owner, and the audit endpoint is empty until it runs

Deploying migration 207 without `ALTER ROLE claude_readonly SET app.claude_ro_owner = '<uuid>'`
leaves `/api/admin/db-query` returning zero rows for every query. That is the fail-closed direction
working as designed, and it is still a break in the tool every session uses at start-up to read
`error_events` and the database size.

**So this is presented rather than merged.** It is a security-surface change that also needs an
owner action to land cleanly — both halves of the confirm-first carve-out.

**Not verified: production.** The scoping is proven against the local database with the same table
set, and the role provisioning in the test is the same SQL production uses, but no production view
has been rebuilt.
