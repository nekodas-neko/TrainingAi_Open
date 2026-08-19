# 2026-08-19 — the rate limiter no longer lets the caller pick its own key (Q-493)

**Branch:** `security/client-ip-from-trusted-hop` · **Lane:** Implementation A

## The defect

Seven routes each did
`req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'` — the **leftmost** hop. A
proxy *appends* the peer it received the connection from, so the leftmost entry is whatever the
**caller** sent. The caller therefore chose its own rate-limit key.

Measured by the review with 30 wrong-secret attempts at a limit of 20/60 s: a fixed header gave
**1 key at count 20** (10 attempts blocked); a rotating one gave **30 keys at count 1** — every
attempt reached the secret compare. It defeated a mitigation (SEC-I3) written specifically to stop
this, on the only unauthenticated write into `body_metrics`, and the same pattern guarded the bearer
path to the owner's full health history.

Seven sites: `health-connect/ingest`, `admin/day-review`, `admin/db-query` ×2, `auth/register`,
`auth/exchange-mobile-token`, `status`.

## What shipped

`packages/shared/src/http/client-ip.ts` — one helper, seven call sites converted, none of them
re-reading the header. It counts in from the **right**: the rightmost entry was written by the hop
nearest this app and cannot be forged; each step left is one proxy further out.

`TRUSTED_PROXY_COUNT` configures the depth, defaulting to **1** (Railway's shape — one edge proxy).
**Being wrong is not symmetric, which is why it is configured rather than assumed:**

- **Too high** → the key is drawn from back inside the forgeable region and the bypass returns.
- **Too low** → the key is one of our own proxies, the same constant for everybody, so every caller
  shares one bucket and one attacker locks out all traffic.

A malformed or zero `TRUSTED_PROXY_COUNT` falls back to 1 rather than to 0, because 0 means "trust
the leftmost hop" — a typo in an env var must not reopen the bypass. There is a test for that.

## Verified end-to-end, not just in the helper

Against `pnpm dev`, driving `POST /api/health-connect/ingest` with a wrong secret and reading
`rate_limits` — the same observable the review used, since the route answers 401 throughout by
design:

| | keys | count |
|---|---|---|
| 30 attempts, **rotating** leftmost hop | **1** | **20** — gate engaged, 10 blocked |
| 4 genuinely different clients × 3 | **4** | **3 each** — no bucket collapse |

The first row is the bypass closed: it now matches what the review measured for a *fixed* header.
The second is the opposite failure mode checked rather than assumed — at depth 1 real clients still
key apart.

Unit: 10 cases including the rotating-caller case and the env fall-back. Full suite with
`DATABASE_URL`: **502 files, 4,267 tests, 0 failed.** `tsc` clean, `pnpm check:rules` **49 of 49**.

## The one thing still unverified, and it is the review's own caveat

**Whether Railway's edge proxy appends exactly one hop.** The review flagged it, and it is not
determinable from a sandbox: production's `rate_limits` is in the `claude_ro` DENY list (third-party
PII), so the stored keys cannot be read to infer the shape.

The default of 1 is the standard Railway assumption and **the code-level fix does not depend on it** —
the leftmost hop is untrustworthy under the header's own semantics regardless. But if Railway
actually has two hops, the limiter goes global after deploy. That failure is **loud** (unexpected
429s across the app, quickly) rather than silent, and the fix is one env var, no code change:
`TRUSTED_PROXY_COUNT=2`.

**Owner check after deploy:** make a couple of normal requests and confirm nothing starts 429-ing.

## Not exercised

Production itself — no probing of the live limiter was done. Nothing on device. No migration, no
schema change; this is auth/security, so it is presented for confirmation rather than self-merged.
