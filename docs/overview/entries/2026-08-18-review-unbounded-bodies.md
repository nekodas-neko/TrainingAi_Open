# 2026-08-18 — Review sweep 32: request-body size guards, and which routes never got one

**Agent:** Review 📖 · **Branch:** `review/unbounded-bodies` · **Docs-only.** Filed **Q-498**.

Sweep 31's method note was that the defect had been in the *relationship* between two individually
correct guards. This sweep took that generalisation — **find bounds declared one way and enforced
another** — and `MAX_BODY_BYTES` was the obvious candidate, because the classic version of that
mistake is trusting `Content-Length`.

**The shared guard turned out to be correct, and that is worth recording.** `readJsonLimited` treats
`Content-Length` as a fast path only and then streams with a real byte counter, cancelling the reader
on overflow. Measured: a 20 MB body to `/api/client-error` (16 KB cap) was **cut off at 2,949,120
bytes**. The client-controlled header is an optimisation; the authoritative check is the measurement.

**The defect is coverage.** 113 route files export `POST`/`PUT`/`PATCH`; **7** use the guard; **93**
call bare `req.json()`. Of those 93, exactly **3** are reachable without a session — `auth/register`,
`auth/exchange-mobile-token`, `health-connect/ingest`. The seven guarded routes are all *less* exposed
than those three. Measured with the same 20 MB body, `auth/register` and `health-connect/ingest` each
accepted the **full 20,000,048 bytes** and then returned 400 — read, buffered and parsed before
deciding they did not want it.

**Ordering separates them, and one is much worse.** `auth/register` (limiter line 9, parse line 13)
and `exchange-mobile-token` (8 / 12) rate-limit **before** parsing, so the rate is bounded even
without a size cap. `health-connect/ingest` reads at line 35 and Zod-parses at 40, but rate-limits at
53 and checks the secret at 58 — an unauthenticated caller **holding no secret at all** makes the
server buffer and fully parse an arbitrary body, and the limiter cannot throttle it because it runs
afterwards.

**It compounds with Q-493.** All three limiters key on `x-forwarded-for`'s leftmost hop, which sweep
30 proved is spoofable — so the ordering that protects the two auth routes is itself bypassable. Two
independent defects that happen to remove each other's mitigation.

**The fix is two changes and the second matters more:** route the three through `readJsonLimited`
(coverage, not design — the helper exists), **and** move the rate limit and secret compare above the
body read on the ingest route. The second converts "anyone can make us parse anything" into "only a
caller past the gate can", and is independent of the size cap.

**The other 90 all require a session**, which is a real mitigation at this user count and is why the
finding is scoped to 3 rather than 93 — recorded because that exposed set grows with the user base if
registration ever opens up, not with the code.

**Not exercised:** the actual ceiling was **not** probed — 20 MB proved there is no cap and going
further risked destabilising the dev server for no additional information, so no claim is made about
what size actually breaks it. Railway's edge may impose its own request-size limit, which would reduce
practical exposure; not checked. No device, no production.
