# 2026-08-19 — Q-482: a non-UUID path param stops reaching Postgres

**PR #186** · branch `fix/dynamic-route-uuid-guard` · Implementation Lane A · JS/server only.

## What was wrong

Postgres rejects a non-UUID cast with `22P02 invalid_text_representation`, which surfaces as a **500**
on a request that is plainly a 400. The 2026-08-18 review measured all 30 dynamic route files, every
method, twice — once with a well-formed-but-nonexistent UUID (**the control**) and once with
`not-a-uuid`. **21 route/method pairs answered 5xx** while answering the control correctly, which is
what made it a missing input guard rather than a broken route. Only 2 of the 30 files validated the id
at all.

## The fix

`invalidUuidResponse(id)` in `lib/api/route-errors.ts`, run immediately after every
`const { x } = await params` — **39 destructures across 29 route files**, all of them, in one PR. The
NextAuth catch-all is the only dynamic route excluded; it takes no id of ours.

**400, not 404, and the reasoning is worth recording** because this repo has a rule that points the
other way in a neighbouring case. `errors.ts` argues that a row owned by someone else must not be
distinguishable from one that does not exist, because 403-vs-404 would be a membership oracle. UUID
*syntax* is not that: anyone can apply the same regex, so answering 400 for "not a UUID" and 404 for
"no such UUID" distinguishes nothing they could not already tell. A malformed id means the request is
malformed.

`activity-logs/[id]/metrics` had its own inline `z.string().uuid().safeParse(id)` check; that copy is
deleted in favour of the shared helper.

## The check has no baseline, on purpose

`scripts/check-dynamic-route-uuid-guard.js`, in the Custom Rules job (now **49** steps). Since all 29
files were converted in the same PR there is nothing to grandfather, so a new dynamic route cannot
inherit an allowance.

**It is scoped per handler, not per file, and the first version was not.** A file with two verbs has
two destructures of the same name; searching the whole source let one verb's guard vouch for the
other's — exactly what a route grows into when a method is added later. Caught by trying to prove the
check bites and finding it did not: removing one of two guards from `supplements/[id]` left it green.
Rescoped, it names that line.

## An existing test failed the moment the guard went in, which is the proof

Q-483's `workout-sessions/[id]/recap` tests asserted a **500** with a redacted body for `not-a-uuid`.
That is now a 400 that never reaches the driver. Both halves are still tested, because they test
different things: the guard proves the repository is not called, and the redaction proves that when
something else *does* throw — the case the guard cannot cover — the statement still does not reach the
client. The redaction test now uses a well-formed id, which is the only way to reach the driver at all.
Deleting it because the guard exists would have dropped the only test of the redaction.

## A second bug, found by the probe rather than by the entry

`PUT /api/nutrition/meal-types/[id]` was the one route the entry excluded, on the grounds that it
"also 500s on the control and is already Q-463". **That attribution was wrong.** Q-463 is fixed on that
route — with a real field the response is a clean 404. The 500 came from the **empty body the probe
sends**: every field of `MealTypePutSchema` is optional, so `{}` parses, and Drizzle's `.set({})`
throws "No values to set".

So a client sending a PUT with nothing changed got a 500. Guarded in `updateMealType` rather than at
the route, so a second caller cannot repeat it, and it now answers `400 No fields to update`. Swept the
siblings per the sibling-surface rule: **every other PATCH/PUT dynamic route already handled `{}`
correctly**, so this is one route and not a class.

`routeErrorResponse` learned about `UserFacingError` to carry that, which it should have done when
that type was added in Q-320 — otherwise a typed refusal thrown inside `withRouteErrors` rethrows into
Next and answers 500, which is the exact failure the helper exists to stop.

## Verified

**All 21 pairs re-probed live** against `pnpm dev` with the seeded user, using the entry's own method.
Every one answers **400** on `not-a-uuid`, and — the half that matters more — **every control matches
the value the entry recorded**: 404s stayed 404, the `friends` DELETE 204 stayed 204, the six 200s
stayed 200, `workout-review/session` stayed 400. No legitimate behaviour changed.

The other 15 dynamic route/method pairs were probed too, since they were not in the table: all 400 on
malformed, **no 500s anywhere**.

Full suite against the local DB: **488 files / 4,132 tests green**. Custom Rules 49 of 49. Production
build green.

## Priced honestly, unchanged

Not a security hole. A malformed id cannot read anyone's data — Postgres refuses the cast before any
row is touched and every route is `auth()`-scoped — and production showed **zero `22P02` rows**, so
this had never actually been served. It is an error-shape gap with a cheap shared fix and an obvious
ratchet, which is the kind that grows back unless something checks.

## Not exercised

Production, and the APK. Nothing native, safe-area, offline-store or WebView-shaped is touched.
