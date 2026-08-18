# 2026-08-18 — Review: verifying the server side (timezone threading, rate-limit scoping)

**Agent:** Review 📖 · **Branch:** `claude/review-rate-limit-coverage` · **Docs-only.**
**Filed:** Q-480 · **Review:** [`docs/reviews/2026-08-18-server-tz-and-rate-limit-verification.md`](../../reviews/2026-08-18-server-tz-and-rate-limit-verification.md)

## Why

Sweep 11 concluded "the server is correct" by counting `todayInTz()` calls **inside route files**.
That is not the whole server: a blameless route still gets a Brisbane answer if the repository
function it calls defaults the timezone and the route omits the argument. `CLAUDE.md` says that is
the case — *"Repo day-window helpers currently **hardcode** `DEFAULT_TZ`"* — so this sweep went
looking for the server-side half of Q-477.

**It is not there.** Everything checked came back clean.

## What was checked

- Every caller of the three tz-defaulting repository helpers (`getCalendarData`,
  `getRecentTrainedDays`, `getNextSession`, plus the two `LbsToKgFix` helpers) passes the session
  timezone.
- All **four** timezone-sensitive SQL sites in `lib/data` interpolate a parameter. **No hardcoded
  zone string anywhere in the repository layer.**
- Every call site of the shared sleep helpers — `nightSessions`, `isNightWindow`,
  `sleepScoreBaselines`, `sleepDurationTrend`, `sleepScoreTrend`, the ones deciding which calendar day
  a night belongs to — passes `tz`.
- Zero local re-declarations of `DEFAULT_TZ` outside `date-utils`.
- All **13** routes calling `generateObject`/`generateText`/`streamText` are rate-limited.
- All **104** `rateLimit` keys are user- or IP-scoped. No global key, so no route where one user's
  traffic throttles another's.

**This bounds Q-477**: the wrong-timezone problem is exclusively client-side, and its fix does not
need to touch `lib/data` or `packages/shared/src/health`.

## Q-480 — the one finding is a stale rule line

`CLAUDE.md` calls the repo day-window helpers timezone-*hardcoded*. They take it as a **default
parameter** that every caller overrides — a safety net, not a hardcoded value. The cost is
misdirection: an implementer picking up Q-477 starts in `lib/data`, finds nothing, and a reviewer
treats a repo call site as suspect when it is the pattern to copy.

Filed as a queue entry rather than edited directly, because `CLAUDE.md` is the contract all five
agents read and a Review agent quietly rewriting a rule line is a change the other four should see
come through the queue. The other half of the same sentence — *"never re-declare `DEFAULT_TZ`
locally"* — is holding and should be kept verbatim.

## Not covered

Whether any limit is set at the right *number*, the client half of rate limiting, the APK, or
production.

## Shape

A verification sweep that finds nothing is a result, not a failed sweep. It is written up so sweep 13
does not spend its budget re-deriving that the server threads its timezones — the inventory of what
was checked is the deliverable, and it costs lines exactly once.
