# 2026-08-18 — the two cache today-guards now take the user's timezone (Q-478)

Lane B. v1.324.8. Seven files, nine call sites, one new Custom Rules step.

## The defect

`isBodyMetadataFresh` and `isWorkoutDataToday` (`lib/sqlite/cache.ts`) compare a date the **server**
stamped in the user's timezone against a date the **client** computed with bare `todayInTz()` —
which is `DEFAULT_TZ`, Brisbane. Two zones Δ hours apart hold different calendar dates for |Δ| hours
out of 24, so for a New York user (Δ=14 in summer) both guards returned false **fourteen hours a
day**, on data that was current.

Measured against a live `/api/body-metadata` response, with the seeded user's timezone set to a
fixed-offset zone chosen to be on a different calendar day than Brisbane at that moment:

```
planted body_metrics row : 2026-08-18, steps 7777   (the user's true today)
server stamped today.date: 2026-08-18
todayInTz()              : 2026-08-19  -> guard says fresh?  false
todayInTz(userTz)        : 2026-08-18  -> guard says fresh?  true
```

The row was in the response the whole time. The guard threw it away.

Downstream of that false: the Health screen leaves today's metrics and active energy blank;
`workout-screen` rewrites every exercise to `loggedTodayInSession: false`, so sets already logged
show as not yet done; the "Trained today" badge never appears; nutrition drops today's water and
active energy; the end-of-day review nulls its metadata.

## The fix

Both helpers take an optional `tz`, and every call site passes one. Two sites already had the
timezone in hand two lines away and were not using it — `getLastTrainedLabel(session, tz)` in
`workout-select-content.tsx:31`, whose very next line reads `dayKeyInTz(tz, 0)`, and
`goals-section.tsx:110`, three lines above a correct `todayInTz(user?.timezone)`. The other four
components take it from `useUserTimezone()`, and `tz` joins the dependency array of each callback
that reads it, so a Profile timezone change re-runs them.

**For a Brisbane user this is byte-for-byte unchanged**, which is what makes it safe to ship
without a device run, and there is a test asserting exactly that.

## Why a CI step and not just the sweep

The parameter has to stay optional — some call sites legitimately have no session, and the default
is right for the owner. That is precisely why prose cannot hold it: the wrong call compiles,
type-checks, lints clean, and behaves correctly on the only device anyone tests on.
`scripts/check-tz-aware-cache-guards.js` (Custom Rules, step 44 of 44) fails on any call to either
helper without a second argument, walking the argument list to its matching paren so a nested call
or an object literal in argument one is not mistaken for a second argument. A site with genuinely
no timezone passes `undefined` explicitly — a decision in the diff rather than an omission.

Mutation-checked both ways: dropping `tz` from the helper bodies turns two unit tests red, and
dropping it from one call site fails the new CI step.

## Line-limit accounting

Two 800-line hotspots had to pay for the two lines each needed. `nutrition-content.tsx` funded it
entirely — a dead `Droplets` import, two dead lucide names, and two `@trainingai/shared/types/nutrition`
imports merged — and stayed at exactly 800. `health-content.tsx` reclaimed one line the same way
(its two `body-metadata/route` type imports merged) and its baseline goes 911 → 912 for the
remainder, with the reason in the script. There is no smaller shape: a hook cannot be called from
inside the callback that needs its value.

## Deliberately not done

`unwrapToday` / `readTodayCacheSync` / `cachedFetchToday` still use bare `todayInTz()`. Per the
Q-478 entry they are **not** the same defect: their envelope date is client-written and client-read,
so they are self-consistent — mislabelled rather than wrong. Threading `tz` through them would touch
every `cachedFetchToday` call site for no behaviour change. Not filed as a defect.

Q-477's step 1 — a ratchet on bare `todayInTz()` across all client code — is still owed. This
check is a narrower shape: two named helpers, not the general case. Q-477's pointer says so now.

## What was NOT exercised

- **No device run.** JS-only, so it reaches the APK through a Railway deploy with no rebuild.
- **No end-to-end non-Brisbane render.** The guard verdict was verified against a live API response
  and the helper is mutation-checked, but no Playwright run drives a non-Brisbane user through the
  Health or workout screens to watch the values appear.
- Every changed screen was loaded against `pnpm dev` on the local DB (`/health`, `/nutrition`,
  `/workout`, `/workout-select`, `/more`) — all 200, no server errors.
- The 100 other bare `todayInTz()` client call sites of Q-477 are untouched.
