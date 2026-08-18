# Review — case (b): seed-only read paths

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** the other half of Q-262's staleness test
**Findings filed:** none · **Method correction:** one, and it is the deliverable

## Why

Sweep 21 audited case (a) of Q-262's test (`freshWithinTtl: true`) and found no gap, then named case
(b) as the next sweep and the likelier source of a real stale-value report:

> a read path is **seed-only** — a screen that `readCacheSync`s the key and never fetches it.

Seed-only is the worse half, because there is no revalidation at all: a missed invalidation is
permanent staleness rather than a brief flash.

## The naive test, and why it over-reports

Differencing `readCacheSync` keys against `cachedFetch` keys gives **51 vs 66** keys and five
seed-only candidates:

```
achievements:${userId}                  workout-screen.tsx
ai-health-insight:${section}:${date}    ai-insight-card.tsx
mood:${todayInTz()}                     session-select-content.tsx
workout-card:${sessionType}             workout-screen.tsx
workout-card:<id>                       recommendation-card.tsx, workout-select-content.tsx
```

**All five revalidate. None is seed-only.** The difference is that revalidation in this codebase
happens through **three** mechanisms, and `cachedFetch` is only one of them:

| Mechanism | Example |
|---|---|
| `cachedFetch` / `cachedFetchToday` | `workout-card` via `next-workout-card.tsx` |
| a raw `fetch(...)` then `setCached(...)` | `ai-insight-card.tsx:40-49`, `workout-screen.tsx:279-283` |
| a **local-store read** then `setCached(...)` | `session-select-content.tsx:606-621` (`mood:`) |

The third is the one worth remembering: for an offline-first domain the local store **is** the
source of truth, so "revalidate" correctly means reading SQLite, not the network. A test that looks
for a network call will call those paths stale when they are the most authoritative ones in the app.

**So the mechanical test for seed-only cannot be "`readCacheSync` without `cachedFetch`."** It has to
be "no write-back to the key from any source after the seed", which is not greppable in one pass —
each candidate has to be read. There were five; reading them took minutes.

## What each one actually does

- **`ai-health-insight:<section>:<date>`** — `readCacheSync` seeds, then `fetchInsight()` runs
  unconditionally, checking `getCached` first and POSTing if absent. Date-scoped, 6 h TTL, and the
  card documents itself as *"supplementary, not load-bearing"*.
- **`mood:<date>`** — `loadTodayMood()` reads the **local store first** (*"the on-device store is the
  source of truth, so a check-in saved offline shows here instead of the server's null"*), falls back
  to the API, and re-`setCached`s. It also refuses to cache a null response, so a race with the push
  cannot re-show the check-in card.
- **`achievements:<userId>`** — `recordXpEarned()` fetches `/api/achievements` and writes the value
  back. Also covered by **seven** invalidation groups.
- **`workout-card:*`** — fetched via `cachedFetch` in `next-workout-card.tsx`, and in the groups.

## Second time a `Q-NNN:` comment read as an open bug and was the fix

`workout-screen.tsx:272` says *"`achievements:<userId>` is written by exactly one screen (More →
Profile) but cleared by five invalidation groups, so the seed is often absent — logging a meal before
finishing a workout was enough. Defaulting the baseline to 0 then reported the user's entire lifetime
XP as this session's gain."* That is **Q-126's fix rationale**; the fix is the `if (xpBefore ===
undefined) return` two lines below, and `setCached` now writes the value back.

Sweep 21 hit the same shape with Q-117 at `session-select-content.tsx:896`. **In this codebase a
comment naming a Q number is usually the fix's rationale, not an open defect** — the convention is to
record why the code is shaped as it is, and it reads exactly like a live bug report. Worth knowing
before grepping for `never invalidated`, `was enough`, or a Q number and reaching for the alarm.

## Result

**Both halves of Q-262's test are now audited and both are clean.** Case (a): seven `freshWithinTtl`
keys, all grouped, all writers invalidating (sweep 21). Case (b): five candidates, all revalidating.
The most repeated bug class in this project currently has no live instance that either half of the
documented test can find.

## Not verified

Static audit plus source reading. Not on the APK, not against production. The audit covers the keys
these two tests identify; a stale-value bug arising some other way — a write path that updates the
DB without touching the local store, say — is outside what Q-262's test is designed to catch and was
not looked for here.
