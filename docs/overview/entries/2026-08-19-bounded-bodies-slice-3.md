# 2026-08-19 — Q-322 slice 3: the credential and admin-write routes

**PR #191** · branch `fix/bounded-bodies-slice-3` · Implementation Lane A · JS/server only.

Slice 1 (#182) took the three routes reachable without a session and added the ratchet; slice 2
(#185) took the offline-first hot paths. This takes the next group by consequence rather than by
traffic: the routes that change a credential, a profile, or another user's account.

| route | cap | why that number |
|---|---|---|
| `user/password` PATCH | 4 KB | two passwords; bcrypt only consumes the first 72 bytes |
| `user/profile` PATCH | 8 KB | eight fields, longest capped at 100 chars by the schema |
| `user/goals` PATCH | 8 KB | nine numbers and enums |
| `admin/users` PATCH + DELETE | 4 KB | a user id and a one-word action |
| `admin/vacuum` POST | 4 KB | one table name |

## Three of them were answering 500 for a malformed body

`user/password` and `user/profile` both called `req.json()` with no `.catch()` — on `user/profile` it
was written as `ProfileSchema.safeParse(await req.json())`, so the parse threw *before the schema
could answer*, turning a bad body into a 500 rather than the 400 the schema would have given it. On
`user/password` that 500 was on a credential route. Both answer 400 now.

## `admin/vacuum` deliberately keeps falling through

Its guard is an **allowlist**, not the body — `VACUUM` takes no bind parameter, so the table name is
validated against a fixed list and that list is the safety boundary. An unreadable body therefore
still falls through to the allowlist rather than short-circuiting, exactly as it did before; only the
oversized case short-circuits, with a 413. Verified: `{not json` still answers
`400 Unknown table` with the allowed list, unchanged.

## Typing followed from the body no longer being `any`

`user/password` compared `newPassword.length` and passed `currentPassword` to `bcrypt.compare` with
only a truthiness check; `admin/users` passed `userId` straight through. Both now check
`typeof === 'string'`. Same shape as the `auth/register` and `food-logs` corrections in slices 1 and 2
— three slices in, the pattern is consistent enough to expect: **converting the read is what surfaces
the missing type check.**

## The running total came out of the script

The header comment carried "104 bare reads across 92 route files remain", which has to be re-edited
every slice, is wrong the moment a slice lands, and conflicts on every parallel merge. The script
already prints the live figure on every run. That number is now the score and the BASELINE is the
worklist; the comment lists which slices took what, which does not go stale.

## Verified live

`pnpm dev`, seeded user, 10 MB body. The admin routes needed the seeded user temporarily promoted
(`is_admin`, reverted after — confirmed back to `f`) and the correct verbs; a first pass at
`POST /api/admin/users` returned 405 because that route is PATCH/DELETE, which is worth recording as
the reason to check the verb before believing a probe.

| route | oversized | malformed | valid |
|---|---|---|---|
| `user/password` | 413 | 400 | 400 `Current password is incorrect.` / 400 on a short password |
| `user/profile` | 413 | 400 | **200**, profile returned |
| `user/goals` | 413 | 400 | **200**; a 999,999 step goal still 400s on the schema |
| `admin/users` PATCH + DELETE | 413 | 400 | — |
| `admin/vacuum` | 413 | 400 `Unknown table` (unchanged) | **200**, a real `VACUUM FULL error_events` ran |

Full suite against the local DB: **488 files / 4,132 tests green**. Custom Rules 49 of 49.

## Not exercised

Production, and the APK. No native, safe-area, offline-store or WebView surface is touched. The
password change was exercised only on its **rejection** paths — a successful password change would
have invalidated the session cookie the rest of the probe depends on, so the happy path of that one
route is untested here.
