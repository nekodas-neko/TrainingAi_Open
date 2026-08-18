# 2026-08-18 — "not authorised" and "could not check" are different answers (Q-548)

**Lane A** · branch `fix/db-query-403-masks-outage` · 46 call sites, one shared helper, one CI rule ·
no migration, no Kotlin, no APK.

`requireAdmin` makes a DB round-trip and throws `AdminError` for "not an admin". Every route wrapped
it in a **bare `catch {}`**, so *any other* throw — including a connection failure — became
`403 Forbidden`.

That is the one status a caller will neither retry nor escalate, and it actively points an
investigation at credentials. During the 2026-08-18 volume incident every `/api/admin/db-query` call
returned `{"error":"Forbidden"}`, which reads as "your credential was revoked", and the first several
minutes went into checking env vars and the admin flag while the Railway dashboard already said the
service was offline. `/api/version` does not touch the database, so it returned 200 throughout and
offered no contradiction.

## What changed

`lib/admin.ts` gained the discrimination, and the 46 catch sites call it rather than each re-deciding:

- `isAdminRefusal(err)` — `AdminError`, or an object whose `name` is `AdminError` (the marker
  fallback, because `instanceof` is not reliable across module realms — the same reason
  `isNotFoundError` carries one).
- `adminErrorResponse(err)` → 403 `{error:'Forbidden'}` for a refusal, 503 `{error:'Service
  unavailable'}` otherwise. 42 sites.
- `adminFailureOutcome(err)` → the same two answers as a value, for the two routes
  (`db-query`, `day-review`) that resolve auth before responding. 4 sites.

The entry asked for a grep rather than a one-site fix, and the grep found exactly two shapes across
46 sites — so the sweep was mechanical and the whole class is closed rather than one instance of it.

`scripts/check-admin-guard-catch.js` keeps it closed: it fails on `requireAdmin` followed by a catch
that does not reach one of the helpers. Zero baseline, not a ratchet — the sweep cleared all 46, so
anything above zero is new. Custom Rules is now **40 of 40**.

## Live proof

Against `pnpm dev`, `/api/admin/db-query`:

| | before | after |
|---|---|---|
| non-admin session, database up | 403 `Forbidden` | **403 `Forbidden`** |
| admin session, database up | passes the guard | passes the guard |
| admin session, **database stopped** | 403 `Forbidden` | **503 `Service unavailable`** |

`/api/admin/vacuum` (the `adminErrorResponse` path rather than the outcome path) answers 503 the same
way. A refusal is still a refusal — that row is the one that matters, because the risk of this change
is loosening the guard, and it does not.

The "before" column's third row is the incident's own measurement, not a re-run here; the mechanism
is a one-line bare catch and needs no re-proving. The "after" column is observed.

## Not exercised

Production (Railway), and the APK — none of these routes have a device path. Inducing a production
outage is not on.

## Note for whoever reads this next

No version bump or changelog entry: every touched route is admin-only, so nothing here is
user-visible.
