# 2026-08-19 — Q-320: a caught error's message stops being the response body

**PR #181** · branch `fix/error-message-as-response-body` · Implementation Lane A · JS/server only.

## What was wrong

Q-483 closed four routes that returned `errorLog(...)` output as their JSON body. The first draft of
its CI check also flagged a second spelling of the same habit — `const msg = e instanceof Error ?
e.message : 'fallback'` followed by `{ error: msg }` — and was right to. A Drizzle error's `.message`
*is* the failing statement. Captured live against the local DB, this is what
`DELETE /api/phase-sets/not-a-uuid` published to the client at 500:

```
Failed query: select "id", "user_id", "name", "is_default", "created_at", "owner_program_id",
"template_base_name" from "phase_sets" where ("phase_sets"."id" = $1 and "phase_sets"."user_id" = $2)
```

That widening was deferred because **the same variable served two habits**, and this is the whole
reason it needed its own item: some sites echoed a message someone had *written for the user*
("An exercise with that name already exists", "Cannot add yourself"), and telling those apart from a
driver failure was the work. A check that fires on correct code gets deleted rather than obeyed.

## How they were told apart

Not by an allowlist of message strings at each route — that drifts the moment someone rewords one.
By **marking the deliberate ones at the throw**, the same way `NotFoundError` already worked:

- `packages/shared/src/errors.ts` gains `UserFacingError(message, status)` with the same string-marker
  `isUserFacingError` guard (`instanceof` is unreliable across bundles).
- Nine repository throws that had user-facing text became `UserFacingError` with the status they
  actually mean — 403 for "Not authorized to rename this exercise", 409 for the name clashes, 400 for
  "In use by: …" and "Cannot add yourself".
- `lib/api/route-errors.ts` gains `refusalResponse(err, fallback)` and `isRefusal(err)`. A marked
  error is echoed with its own status; anything else gets `fallback` at 500 and keeps its detail in
  the log and `reportServerError`, which already had it.

**Substring status-matching went with it, and that was a latent bug of its own.** `phase-sets`
DELETE chose its status with `msg.includes('default') ? 403 : msg.includes('In use') ? 400 : 500` —
which fires on *any* error carrying the word "default". The status now travels on the error that
chose it.

## Two of the fourteen sites were not leaks

Recorded because the original entry claimed fourteen:

- **`app/api/coach/apply/[id]/undo`** — its `detail` comes off a structured result and is always an
  author-written literal, never a caught error. No fix needed and none applied.
- **`app/api/admin/db-query`** — the admin SQL console, where the DB error text (permission denied,
  syntax, timeout) *is* the answer the operator asked for. It already said so in a comment. Exempted
  in the check with that reason written out, the same shape as `check-api-no-store.js`'s one
  exemption.

## A second fault found while fixing the first

`app/api/admin/invites` caught `requireAdmin` and picked its status by comparing the caught message
to the string `'Unauthorized'`. So a **database outage inside the admin check** answered `403` with
the connection error as the body — wrong status and a leak in one line. It now runs through the
`adminGate()` helper and `adminErrorResponse`, which is the existing rule that a failure to *check*
admin is a 503 outage, not a 403 refusal.

`app/api/admin/exercises` PUT answered **409 for every error**, so a missing row read as a name clash.
It now answers 404 / 409 / 500 from the thrown error.

## Verified

The check was widened and **proven to bite**: reverting one site to the old shape turns
`check-no-raw-error-in-response.js` red naming that line, restoring it turns it green. 209 route files
scanned.

Full suite against the local DB: **485 files / 4,087 tests green**, 2 files skipped. Custom Rules 47
of 47.

Live against `pnpm dev`, logged in as the seeded test user — both halves, because a fix that hides
everything is as wrong as one that hides nothing:

| request | answer |
|---|---|
| add yourself as a friend | 400 `Cannot add yourself` — the written message, echoed |
| friend request to an unknown email | 404 `User not found` |
| `PATCH /api/friends/not-a-uuid` | 500 `Could not update that request` |
| `PUT /api/phase-sets/not-a-uuid` | 500 `Could not save that phase set` |
| `DELETE /api/phase-sets/not-a-uuid` | 500 `Could not delete that phase set` |

The last three are the ones that used to publish the statement above.

## Priced honestly

Unchanged from the entry: this was disclosure to an **authenticated** user, and Q-483's production
check found zero `22P02` rows, so the sibling shape has most likely never been served either. It is
still the only class of place in the app that publishes table structure, and redacting cost nothing.

## Not exercised

Production, and the APK. No native, safe-area, offline-store or device surface is touched — the
device reaches these routes through the Railway deploy.
