# 2026-08-18 — a revoked admin could still write to the shared catalogue (Q-479)

**Lane A** · branch `fix/exercises-route-admin-db-check` · one argument, one docstring, one CI rule ·
no migration, no Kotlin, no APK.

`lib/admin.ts` holds two admin checks that disagree **on purpose**:

- `requireAdmin(userId, _isAdmin?)` accepts the flag for call-site compatibility and **refuses to
  trust it**, reading the row every call. 61 API routes use it.
- `isAdminUser(userId, isAdmin?)` **returns the passed flag** when one is given.

Ten sites call `isAdminUser`; nine are page guards, which is UI and correct. The tenth was
`app/api/exercises`, gating `createExercise` — a write into `exercise_library`, the catalogue every
user reads. The claim it trusted is refreshed at most once a day (`ISACTIVE_RECHECK_MS`), so
revoking admin did not close that route for up to 24 hours.

## Reproduced, then re-run on the fix

Admin granted → fresh login → token warmed → admin revoked in the database, **no re-login**, cookie
rotation persisted (`-b` and `-c` on the same jar, which is what the entry warns about — without it
the throttle never engages and the bug hides):

| | before | after |
|---|---|---|
| `POST /api/exercises` — still admin | 201 | **201** |
| `POST /api/exercises` — **revoked** | **201**, row created | **403** |
| `GET /api/admin/errors` — revoked (control) | 403 | 403 |
| session claim | `isAdmin = True` | `isAdmin = True` |

The first row is the one that matters for risk: the danger in tightening a guard is breaking the
legitimate case, and a real admin is still admitted. The claim stays stale in both columns — that is
by design, and now it governs only what it was documented to govern.

## The comment was the more dangerous half

`lib/auth/is-active-refresh.ts` said:

> *"This governs the **UI** only: `requireAdmin` reads the row from the database on every call and
> never trusts this claim."*

True of `requireAdmin`, false of the route, and a reviewer who reads it stops looking. It now states
the rule rather than describing the world — **an API route must never pass this claim to an
authorisation check** — and records that it was false for one route until today.

`scripts/check-admin-claim-in-api.js` enforces it: `isAdminUser(` with a second argument, in a
`route.ts` under `app/api/**`. Page guards are untouched, deliberately. Zero baseline, not a ratchet
— there was exactly one site. Custom Rules is now **41 of 41**.

One thing worth carrying forward: the check fired on its **own** first run, against the comment
explaining the rule at the site it had just cleaned. It strips comments before scanning now. A rule
that matches prose about itself is a rule that gets deleted rather than obeyed.

## Not exercised

Production, and the APK — its WebView keeps cookies, so it behaves like the corrected harness.
`ISACTIVE_RECHECK_MS` is read from source; the 24-hour window was not observed end to end.

## No version bump

The affected route is admin-only, so nothing here is user-visible.
