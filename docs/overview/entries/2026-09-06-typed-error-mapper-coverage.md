# The last route that let a typed repository error escape (RV-46)

**Branch:** `fix/rv46-activity-types-error-mapper` · **Lane:** A · **Domain:** platform
**Version:** 1.436.10

Q-463 put one mapper at the route boundary so a repository's typed `NotFoundError` becomes a status
instead of an unhandled throw. Eighteen repository methods throw one; thirteen mutating routes call
such a method; twelve mapped it. `PATCH /api/admin/activity-types` wrapped only `requireAdmin` in
its `try`, leaving `repo.updateActivityType(...)` uncaught on the handler's last line:

```
PATCH {"id":"walk",                  "sortOrder":1}  ->  200  {"activityType":{…}}
PATCH {"id":"no-such-activity-type", "sortOrder":1}  ->  500  (empty body)
```

Both symptoms `route-errors.ts` names in its own header — the wrong status, and the **empty body**
that makes a client's `res.json()` throw a parse exception on top of the failure. It also wrote the
row that helper exists to prevent: `PATCH /api/admin/activity-types | server | Activity type not
found`, a correctly-refused request filed as a server fault.

The fix is the six lines the other twelve routes already have. What made a one-line-class change
worth an entry is that it was the *last* unconverted site of a class the repo had already decided
how to fix — so the entry is only paid off if the thirteenth cannot become a fourteenth.

## The scan, and the trap it walked into first

The second test reads source rather than making requests: for every `app/api/**/route.ts`, if it
calls a method whose body throws a typed error and contains no mapper call, it fails and names the
file.

**Its first version was green against a fully reverted fix.** The regex matched the plain text of
the fix's own explanatory comment — which says the word `routeErrorResponse` — on the very route the
test was written for. Comments are stripped before the scan now, and the call form requires a paren.
Both mutations fail correctly: reverting the route fails the 404 case *and* the scan, and the scan's
message names `app/api/admin/activity-types/route.ts calls updateActivityType`.

The generalisable part: **a source check that reads prose is checking the wrong file.** The only
reason it surfaced is that the mutation was run after the test was written rather than assumed from
the passing run.

## The list of throwing methods is read, not grepped

`THROWING` was built by reading each implementation. A `grep -B40` for `throw new NotFoundError`
over the adapter attributes the throw to whichever `async` name happens to sit above it in the
window, which credited `createActivityType` and `createInjury` with throws neither of them contains
— two false positives that would have made the entry's "twelve of thirteen" read as ten of thirteen
and sent this PR to two routes that were already correct. Both were checked against their own
function bodies before being dropped.

## Verification

- `tsc --noEmit` clean · full suite green · `pnpm check:rules` 68 of 68
- New `lib/data/postgres/__tests__/typed-error-mapper-coverage.test.ts` — the route's 404 (asserting
  the **body** as well as the status, since the empty body was half the defect) plus the source scan
- Mutation-verified: reverting the route fails both tests, and restoring passes both

**Not exercised:** nothing native, safe-area or Samsung-WebView — this is a server route, no APK
needed. No production data was read. The route is admin-only with one caller
(`activity-type-manager.tsx:146`), which is why the entry was filed at low severity and shipped
without an owner check.
