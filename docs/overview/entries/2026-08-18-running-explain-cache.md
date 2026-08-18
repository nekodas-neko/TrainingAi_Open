# 2026-08-18 — Q-469: the prescribed run was re-described on every visit

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.324.3** · **Lane:** Implementation B

`components/running/prescribed-run-card.tsx` asked `/api/running-plan/explain` for a warmer
restatement of the run's deterministic rationale from a bare `useEffect` with no cache. Measured in
the AI double-trip sweep: **31 redundant calls across 9 distinct runs** — the same run explained
about seven times.

The author had already handled the obvious re-fire: `gateReasons` is joined into a stable string so
a new array ref does not re-trigger the effect. **Mount was the remaining trigger**, and every
navigation back to the running screen is a mount.

## Why it was worth fixing, given the call is cheap

It is — 62 calls, 6,864 tokens, and explicitly never load-bearing (the deterministic `rationale`
paints immediately; the AI copy only swaps in if it arrives). **The reason is content consistency:**
the model rewords the sentence each time, so the same prescribed run was described differently on
every visit. That is the part a user notices.

## What shipped

A cache keyed on everything that can change the sentence — the local date plus the prescription
fingerprint (`type`, `durationMin`, `rationale`, the gate reasons). `readCacheSync` first, and only
a real answer is written back: a `degraded` response is the deterministic text wearing an AI hat,
and caching that would pin the fallback for the whole TTL.

`RUNNING_PLAN_EXPLAIN_TTL` is `TTL_LONG`, declared once in `packages/shared/src/cache-ttl.ts` per
the one-canonical-TTL-per-key rule. Expiry is a backstop rather than the freshness mechanism — the
key already carries everything that matters, so a long TTL is the honest choice.

Seeded in an effect, not a `useState` initializer: a cache read in an initializer is what caused the
hydration mismatches this repo already fixed once.

## Guard

`runningPlanExplainCacheKey` is a pure function in its own `.ts` module, unit-tested on the property
that actually matters: **the key changes exactly when the sentence should.** Too loose and a stale
sentence outlives its prescription; too tight and the redundant calls come straight back. Eight
tests — stable for an unchanged prescription, distinct for each of date / type / duration / gate
reasons / rationale, day-scoped, and a missing duration distinguished from a zero one.

**Mutation-checked**: dropping the date and rationale from the key fails three of them.

**It is a `.ts` module rather than an export from the card, and that is not cosmetic** — the unit
project runs in `node` and cannot parse JSX, so anything exported from a `.tsx` cannot be imported by
a test at all. Worth knowing before trying to test a helper that lives in a component file.

## What was NOT exercised

- **No E2E.** The seed has **zero** running plans, so the card is unreachable from the harness
  without seeding a plan and its prescription — a table chain out of proportion to a caching change.
  The key is where the correctness lives and it is unit-tested; the "no second fetch" behaviour is a
  direct consequence of `readCacheSync` returning a hit.
- **The redundancy was not re-measured after the fix.** The 31-across-9 figure is from the sweep's
  production data; confirming the drop needs another production read, not a local run.
- **The device.** Chromium only; nothing here is native, but the cache layer is the one that behaves
  differently on the APK (native SQLite rather than the web fallback).
