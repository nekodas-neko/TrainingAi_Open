# 2026-08-19 — Q-498 closed, Q-322's first slice: request bodies get bounded before they are parsed

**PR #182** · branch `security/body-size-guard-coverage` · Implementation Lane A · JS/server only.

## The defect

`req.json()` buffers the whole body before anything can decide it does not want it. A Zod schema
afterwards bounds what gets **stored**; it does not bound the transfer or the parse. Measured on
2026-08-18: a 20 MB body to `auth/register` and to `health-connect/ingest` was accepted in full —
20,000,048 bytes read, buffered and parsed — and then answered 400.

Of the ~93 routes doing this, **three are reachable without a session**: `auth/register`,
`auth/exchange-mobile-token`, `health-connect/ingest`. Those three are what shipped here.

## The ordering fix mattered more than the cap

`auth/register` and `exchange-mobile-token` rate-limit before parsing, so the *rate* was bounded even
without a size cap. `health-connect/ingest` did not: it read at line 35 and Zod-parsed at 40, but
rate-limited at 53 and compared the secret at 58. An unauthenticated caller **holding no secret**
made the server buffer and fully parse an arbitrary body, and the limiter could not throttle it
because it ran afterwards.

The limiter now runs above the read. **Q-498 said this needed the secret moved out of the body into a
header — it did not.** The brute-force limiter is keyed on the IP from the request headers, so it
needs nothing out of the body. Moving the secret would have broken the owner's Tasker profile for no
extra benefit, and moving only the limiter gets the whole win.

## Verified live

`pnpm dev`, 20,000,049-byte body, `curl` reporting what it managed to upload before the connection
closed:

| route | before | now |
|---|---|---|
| `health-connect/ingest` | 20,000,048 accepted → 400 | **413**, cut off at 2,949,120 |
| `auth/register` | 20,000,048 accepted → 400 | **413**, cut off at 2,949,120 |
| `auth/exchange-mobile-token` | unbounded | **413**, cut off at 2,949,120 |

2,949,120 is the TCP window curl fills before the server closes, not something the server read — the
same figure the original review measured, which is why it is consistent across all three.

**The ordering fix, proven separately:** 22 bad-secret calls to trip the per-IP limiter, then the
20 MB body → **401**, not 413. The limiter answered before the read happened at all. A real Tasker
payload (`{"secret":…,"date":…,"steps":1234}`) still returns 200.

## The ratchet, so this cannot erode again

`scripts/check-bounded-request-body.js`, in the Custom Rules job (now **48** steps). Every route file
is baselined at the number of bare `req.json()` reads it has, shrink-only, and a file not listed must
have none. The three converted routes are **deliberately absent from the baseline**, so re-adding a
bare read to any of them fails immediately — verified by reverting `auth/register` and watching it go
red naming that file.

**104 bare reads across 92 files remain, and that is on purpose.** Converting 92 route files in one
diff is how a mistake hides. The ratchet is what makes doing it slowly safe, which is what Q-322 asked
for in its own words. Q-322 is rewritten to describe only the remaining sweep, with the suggested next
slices ordered by exposure.

## Also corrected

`auth/register` destructured from an `any`; the body is now `unknown`, so the email check says
`typeof email !== 'string'` out loud. The regex would have coerced and failed anyway — same answer,
stated rather than implied.

## Not exercised

Production, and the APK. Railway's edge may impose its own request-size limit, which would reduce
practical exposure — not checked, same as when the finding was filed. The actual ceiling was never
probed: 20 MB proved there was no cap and going further risked destabilising the server for no extra
information.
