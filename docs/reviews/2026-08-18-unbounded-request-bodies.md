# Review — request-body size guards, and which routes never got one

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 32** · **Finding:** Q-498

## Why this lens

Sweep 31's method note was: *"the guard that fires is where to look next, not the guard that is
missing — the defect was in the relationship between two correct guards."* This sweep took the
generalisation: **find bounds that are declared one way and enforced another.** `MAX_BODY_BYTES` is
the obvious candidate, because the classic version of that mistake is trusting `Content-Length`.

## The shared guard is correct

`readJsonLimited` (`packages/shared/src/http/request-guards.ts`) checks `Content-Length` as a **fast
path** and then streams with a real byte counter, cancelling the reader on overflow. The
client-controlled header is an optimisation; the authoritative check is the measurement. That is the
right shape and it is not the defect here.

**Measured**, 20 MB body against a guarded route (`/api/client-error`, cap 16 KB):

```
HTTP 401   uploaded 2,949,120 of 20,000,048 bytes   in 1.15s   <-- stream cancelled
```

## Q-498 — three unauthenticated routes never got it

| | Count |
|---|---|
| Route files exporting `POST`/`PUT`/`PATCH` | **113** |
| Using `readJsonLimited` | **7** |
| Bare `req.json()`, no size guard | **93** |
| …of those, reachable **without a session** | **3** |

The three:

- `app/api/auth/register/route.ts` — public account creation
- `app/api/auth/exchange-mobile-token/route.ts` — public token exchange
- `app/api/health-connect/ingest/route.ts` — secret-gated, no session

**Measured**, the same 20 MB body:

```
/api/auth/register          HTTP 400   uploaded 20,000,048 bytes   (full body buffered, then rejected)
/api/health-connect/ingest  HTTP 400   uploaded 20,000,048 bytes   (full body buffered, then rejected)
```

A 400 *after* the whole body uploaded is the point: the route read, buffered and parsed all 20 MB
before deciding it did not want it. The seven guarded routes — avatar, feedback, client-error,
scale-ble samples, oura-ble samples, oura-ble battery-poll — are all **less** exposed than these three.

## Ordering separates them, and one is much worse

| Route | Rate limit | Body read | Verdict |
|---|---|---|---|
| `auth/register` | line 9 | line 13 | ✅ limiter **before** parse — the rate is bounded even without a size cap |
| `auth/exchange-mobile-token` | line 8 | line 12 | ✅ same |
| **`health-connect/ingest`** | line **53** | line **35**, Zod at **40** | ❌ **body buffered and fully parsed before any limiter or secret check** |

On the ingest route an unauthenticated caller **holding no secret at all** makes the server buffer an
arbitrarily large body and run a full Zod parse over it, and the limiter cannot throttle that because
it runs afterwards. The secret check is at line 58 — twenty-three lines after the work has already
been done.

## It compounds with Q-493

All three limiters key on `x-forwarded-for`'s leftmost hop. Q-493 proved that rotating the header
defeats the limiter entirely. So the ordering that protects `auth/register` and
`exchange-mobile-token` — their limiter running first — is itself bypassable, which removes the only
bound those two have. The two findings are independent defects that happen to remove each other's
mitigation.

## The other 90

The remaining unguarded routes all require a session, so an attacker needs an account. That is a real
mitigation on an app with a handful of users, and it is why this finding is scoped to the three rather
than to 93. It is worth recording that the count is 93 and not, say, 5 — if the app ever opens
registration more widely, the exposed set grows with the user base, not with the code.

## Fix

Two changes, and the second matters more than the first:

1. Route the three through `readJsonLimited` with caps appropriate to their payloads. The helper
   already exists and seven routes already use it — this is coverage, not design.
2. **On `health-connect/ingest`, move the rate limit and the secret compare above the body read.**
   That is independent of the size guard and is the larger of the two: it converts "anyone can make us
   parse anything" into "only a caller past the gate can". The Zod schema needs `secret` out of the
   body or read from a header to do this cleanly, which is a small shape change worth making.

## Severity

**Medium.** No data is exposed or corrupted; this is memory and CPU amplification on unauthenticated
endpoints. Rank it above the ordinary because the ingest route does the work before *any* check, and
because Q-493 removes the rate bound that would otherwise contain it.

## Not exercised

Local dev server. **The actual ceiling was not probed** — 20 MB proved there is no cap and going
further risked destabilising the server for no additional information, so no claim is made about what
size actually breaks it. Not on device, not against production, and not against Railway's edge, which
may impose its own request-size limit — that would reduce the practical exposure and was not checked.
