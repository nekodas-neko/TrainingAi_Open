# Review — the secret-gated Health Connect ingest route, driven for real

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 30** · **Findings:** Q-493 … Q-496

## Why this lens

`app/api/health-connect/ingest/route.ts` is the **only unauthenticated write into `body_metrics`**.
It has been on this role's baton as an untested surface since sweep 1 — every earlier sweep read it
and moved on, because exercising it needs `HEALTH_CONNECT_INGEST_SECRET` set. This sweep set the
secret locally and drove the route.

Everything below is **reproduced against a running server**, not read off the source.

## What the route already gets right

Worth stating first, because three of the four findings are refinements of a design that is mostly
sound:

- The **SEC-I3 brute-force gate exists**, runs **before** the compare, and returns an identical
  401 body on trip — deliberately indistinguishable from a bad secret.
- `safeCompare` is constant-time and length-safe, and is the shared one-definition helper.
- The date regex accepts **both** separators (`[-/]`), the Q-130 lesson.
- Both stated garbage examples in the route's own comment — `"75kg"` and `1e308` — **are rejected**.
- Writes are stamped `health_connect`, rank 1, the lowest non-unknown rank.

## Q-493 — the brute-force gate is bypassed by rotating one request header

The limiter keys on `req.headers.get("x-forwarded-for")?.split(",")[0]`. The **leftmost** hop of
`X-Forwarded-For` is the value the *client* supplied; a proxy appends its peer to the right. So the
rate-limit key is chosen by the caller.

**Measured.** 30 wrong-secret attempts each way, limit 20 per 60 s. Both sets return 401 throughout
(by design), so the status code proves nothing — the observable is the `rate_limits` table:

| Attack | Distinct limiter keys | Max count on any key | Attempts that reached the compare |
|---|---|---|---|
| Fixed `X-Forwarded-For` | **1** | **20** (capped) | 20 of 30 — gate engaged |
| Rotating `X-Forwarded-For` | **30** | **1** | **30 of 30 — gate never engaged** |

The mitigation's own comment states its purpose: *"Gate ALL attempts per IP before the constant-time
compare."* An attacker sets the IP.

**Seven sites share the pattern**, and the sensitive ones are not this route alone:

| Route | What the limiter is protecting |
|---|---|
| `health-connect/ingest` | brute-force of the only unauthenticated write secret |
| `admin/day-review` | bearer path to the owner's **full health history** |
| `admin/db-query` | read-only SQL over `claude_ro` |
| `auth/register` | account creation |
| `auth/exchange-mobile-token` | token exchange |
| `status` ×1, `db-query` ×2 | liveness / abuse |

**Nothing in the docs records this** — checked `docs/`, `CLAUDE.md`, `projectOverview.md`. The one
place it is discussed, `docs/superpowers/plans/archive/2026-07-09-r1-security-ownership-hardening.md`,
**propagates** it: the `status` route's note says it is keyed by `x-forwarded-for` *"matching the
existing pattern in `auth/register` and `auth/exchange-mobile-token`"*. A security-hardening plan
spread the defect by treating consistency with the existing sites as the standard.

**What is NOT verified:** whether Railway's edge proxy sanitises or overwrites the header before the
app sees it. That cannot be determined from this sandbox, and probing production's limiter to find
out was not something to do unasked. The code-level bypass is proven; the production exploitability
depends on that one unknown. Note the fix does not depend on the answer — trusting the leftmost hop
is wrong under the header's own semantics either way.

**Fix shape:** derive the client IP from the **rightmost** hop, or from a configured
trusted-proxy count, in one shared helper — the same "one definition, one place" treatment
`safeCompare` already has. Seven call sites should not each re-decide this.

## Q-494 — a far-future date is accepted and permanently captures every "most recent" read

The regex bounds the date's *shape*, nothing bounds its *range*. `9999/12/31` is accepted.

**Measured, and this is the sharp one:**

```
before:  getMostRecentConfirmedWeightKg → 2026-08-18, 81 kg
POST {"date":"9999/12/30","weightKg":499}  → {"success":true}
after:   getMostRecentConfirmedWeightKg → 9999-12-30, 499 kg
```

`ORDER BY date DESC LIMIT 1` on `body_metrics` now answers **499 kg, and will until the year 9999**.
No later write can outrank it. Two readers use that shape: `getMostRecentConfirmedWeightKg` (the
BLE-scale confirmation path) and `deriveActivityKcal` (which multiplies body weight into every
activity-calorie estimate).

**The source-rank merge cannot protect against this, and it is worth being precise about why.**
`lib/data/health-source.ts` ranks per **column, per date** — it stops a worse source overwriting a
better one *on the same day*. A row on a date nothing else will ever write has no competitor, so
rank 1 (`health_connect`, the lowest) wins outright. The documented protection is orthogonal to this
attack, not weak against it.

## Q-495 — `z.coerce.number()` launders non-numbers into readings

The schema's own comment says the bounds *"reject clearly-garbage values (a stringified `75kg`, a
1e308 double)"*. Both named examples are indeed rejected. Three unnamed ones are not:

| Sent | Stored | |
|---|---|---|
| `"steps": []` | **0** | `z.coerce.number([])` → 0 |
| `"steps": true` | **1** | → 1 |
| `"weightKg": ""` | **0 kg** | → 0 |

Each landed in `body_metrics` with `source_map` stamped `health_connect`. A **0 kg body weight** is
in range for `.min(0)`. The comment is accurate about what it tested and silent about the coercion
that runs before the bounds are applied.

**Fix shape:** `z.number()` rather than `z.coerce.number()` (Tasker can send real JSON numbers), or
keep coercion and reject non-primitive input first. Also `.min(0)` on a body weight should be a
plausible floor, not zero.

## Q-496 — a regex-passing but invalid date returns 500 and writes an `error_events` row

| Sent | Result |
|---|---|
| `2026-13-45` | **HTTP 500** + `error_events` row `[pg 22008]` |
| `2026-02-31` | **HTTP 500** + row |
| `0000-00-00` | **HTTP 500** + row |

The regex accepts any `\d{4}[-/]\d{2}[-/]\d{2}`, so month 13 and day 45 pass validation and fail at
the driver. This is the class `CLAUDE.md`'s `normalizeDateParam` rule exists to prevent — the rule
lists the routes retrofitted with the guard, and this one is not among them.

Two consequences beyond the wrong status code: a client input error is recorded as a **server**
fault, and it pollutes `error_events` — the table `CLAUDE.md` requires every session to read first
and which prunes at 30 days. Reaching it needs the secret, so this is not an open spam vector; it is
a validation gap that makes the fault table less trustworthy.

## Priced

| | Severity | Why |
|---|---|---|
| **Q-493** | **high** | Defeats a mitigation written specifically to stop it, across 7 sites incl. two secret-gated ones. Production exploitability has one unverified dependency. |
| **Q-494** | **high** | Permanent, silent, single-request corruption of a value that feeds the scale pipeline and every activity-calorie estimate. |
| **Q-496** | medium | Wrong status code; degrades the fault table every session must read. |
| **Q-495** | low | Needs the secret; writes at the lowest rank; implausible values, not dangerous ones. |

## Not exercised

Local dev server against the seeded database. **Not on device**, not against production, and not
against Railway's real proxy — which is exactly the unknown Q-493 turns on. All test rows,
`error_events` rows and `rate_limits` rows created by this sweep were deleted, and
`getMostRecentConfirmedWeightKg` was verified back at 81 kg afterwards.
