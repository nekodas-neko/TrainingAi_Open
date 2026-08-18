# Review — verifying the server side: timezone threading and rate-limit scoping

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** verification, not bug-hunting
**Findings filed:** Q-480 (a stale rule line) · **Clean results recorded:** six

## Why this sweep exists, and why it is short

Sweep 11 found that the *client* resolves "today" three ways while the *server* is correct, and based
the "server is correct" half on counting `todayInTz()` calls **inside route files**. That is not the
whole server: a route can be blameless and still get a Brisbane answer if the repository function it
calls defaults the timezone and the route omits the argument.

`CLAUDE.md` says exactly that is the case:

> *"Repo day-window helpers currently **hardcode** `DEFAULT_TZ` — thread the session tz through when
> touching them"*

So this sweep set out to find the server-side half of Q-477. **It is not there.** Everything below is
a clean result, and the one finding is that the rule line above is wrong.

The same pass swept rate-limit coverage, which had never been measured either.

---

## Finding (Q-480) — the `CLAUDE.md` line points at a problem that does not exist

The repo helpers do not hardcode `DEFAULT_TZ`; they take it as a **default parameter**, and **every
caller passes the session timezone**:

| Helper | Callers | All thread tz? |
|---|---|---|
| `getCalendarData(…, timezone = DEFAULT_TZ)` | `app/api/calendar-data` | ✅ `session.user?.timezone` |
| `getRecentTrainedDays(…, timezone = DEFAULT_TZ)` | `app/api/streak-data` | ✅ `session.user?.timezone` |
| `getNextSession(…, timezone = DEFAULT_TZ)` | 5 sites incl. `lib/ai-chat/tools.ts` | ✅ `tz` at every one |

A default parameter that every caller overrides is a safety net, not a hardcoded value — the
opposite of what the rule describes. The cost of the stale line is that it marks the repository layer
as known-broken, so an implementer picking up Q-477 would go looking there first and find nothing,
and a reviewer would treat a repo call site as suspect when it is the reference pattern.

**Fix:** replace that clause with what is actually true — the helpers default to `DEFAULT_TZ` and
every current caller threads the session tz; keep the instruction to keep doing so. The other half of
the same sentence (*"never re-declare `DEFAULT_TZ` locally"*) **is** holding: zero local
re-declarations outside `date-utils`.

Filed as a queue entry rather than edited directly, because `CLAUDE.md` is the contract all five
agents read and a Review agent quietly rewriting a rule line is a change the others should see coming
through the queue.

---

## Clean results

### Timezone threading below the route layer

- **Repository helpers** — the three day-window helpers above, plus `previewLbsToKgFix` /
  `applyLbsToKgFix`. Every caller passes the tz.
- **Timezone-sensitive SQL** — all **four** sites in `lib/data` interpolate a parameter
  (`AT TIME ZONE ${tz}`); there is **no hardcoded zone string anywhere in the repository layer**.
- **Shared health/domain math** — the more consequential set, because sleep-night windowing decides
  which calendar day a night belongs to. `nightSessions`, `isNightWindow`, `sleepScoreBaselines`,
  `sleepDurationTrend`, `sleepScoreTrend` all default to `DEFAULT_TZ`, and **every call site passes
  `tz`** (health-insight, health-trends, bedtime-estimate, nutrition-goals, body-battery,
  readiness-payload, the score-audit path, the ai-periodization signals, and the adapter).
- **No local re-declarations of `DEFAULT_TZ`** outside `packages/shared/src/date-utils.ts`.

**This bounds Q-477.** The wrong-timezone problem is *exclusively* client-side, at every layer that
was checkable here. An implementer taking Q-477 does not need to touch `lib/data` or
`packages/shared/src/health`.

### Rate limiting

- **Every AI route is limited.** All **13** routes calling `generateObject`/`generateText`/
  `streamText` carry a `rateLimit(...)`, matching `CLAUDE.md`'s *"Every new AI or expensive route gets
  the standard rate limit at creation."*
- **All 104 `rateLimit` keys are user- or IP-scoped.** Zero global keys — no route where one user's
  traffic can throttle another's, which is the failure this check was looking for.
- Three admin routes key on `session?.user?.id ?? 'anon'`, so unauthenticated callers share one
  bucket. Not filed: those routes are admin-gated, so an anonymous caller cannot reach the expensive
  work regardless, and the shared bucket only ever throttles other anonymous callers who also cannot
  use the route.

---

## What this sweep does **not** cover

- **The client half of rate limiting** — whether a UI surface retries into its own limit. Untested.
- **Whether a limit is set at the right *number***. This checked that limits exist and are scoped
  correctly, not that `20/hr` is the right budget for any given route.
- Anything on the APK, and anything against production.

## A note on shape

A verification sweep that finds nothing is a result, not a failed sweep, and it is written up at this
length deliberately: the value is the recorded list of what was checked, so sweep 13 does not spend
its budget re-deriving that the server threads its timezones. The one finding is a documentation
correction, and it is filed at the priority a documentation correction deserves — low.
