# 2026-09-25 — RV-67: the TTL the comment promised, and the proof one key needed to earn it

**Branch:** `lane-b/rv67-meal-types-ttl-gate` · **Lane:** Implementation B

A comment in `health-content.tsx` said `cachedFetch` "honours its TTL, so re-firing a group on a tab
revisit is a cache hit rather than a request". It does not, unless the call site opts in — and 183
of 191 cached read sites do not. This fixes the comment and earns the flag for exactly one key.

## The entry's numbers are right, and my first scan was wrong

**191 cached read sites, 8 with `freshWithinTtl`** — reproduced exactly. Worth recording how nearly
I "corrected" a correct entry: my first count returned **7 and 0**, because call sites are
`cachedFetch<MealType[]>(…)` and my regex required `(` immediately after the name. Generics. That is
the fourth scanner trap this session, and the first one where the scanner's answer would have
discredited the entry rather than the code.

> **Corrected later the same day.** Measured against this very commit with a fixed scanner, the
> figures were **198 read sites and 8 flagged** — so the *flagged* count was right and the *site*
> count was not (198, not 191). My scanner skipped each call's type argument with a **paren-free**
> character class, so every `cachedFetch<{ x: import('…').T }>` was invisible to it, and the entry's
> author evidently had the same blind spot, which is why we agreed. **"Reproduces exactly" meant
> "reproduces the same error": two scanners agreeing is not corroboration when they share a blind
> spot.** The conclusion is unaffected — 190 of 198 did not opt in. Both scanners now skip the type
> argument by balancing angle brackets, and the then-figure above was recovered by running the fixed
> one in a worktree at that commit rather than by reasoning back from today's count.

## The proof, which is the actual work

`freshWithinTtl: true` means a read inside the 6-hour TTL never touches the network, so a missed
writer turns a stale flash into six hours of hard staleness. CLAUDE.md requires a written proof per
key. For `nutrition-meal-types`:

- **Server writers** are four repository methods — `createMealType`, `updateMealType`,
  `deleteMealType`, `reassignAndDeleteMealType` — reached from exactly two routes,
  `/api/nutrition/meal-types` and `.../[id]`.
- **Those routes are called from exactly one client file**, `meal-type-manager.tsx` (lines 99, 123,
  157, 182, 221), and every one is followed by `invalidateMealTypes()` (105, 116, 193, 230, 236),
  whose group holds the key.
- **No sync writer**, which is the bullet that nearly sank it. There *is* an offline mirror,
  `replaceMealTypes` — but it has one non-test caller, and that caller hydrates the store **from**
  this cached response. It is downstream of the cache, not independent of it, so no pull-delta path
  can change meal types behind the cache's back.

## Two things the entry did not know

**`useCachedValue` had no `freshWithinTtl` option at all**, so one read site could not be flagged
without widening the hook. Done — `lib/hooks/**` is Lane B's — with the flag ignored when `today` is
set, since `cachedFetchToday` has no such parameter.

**The writer screen is deliberately left unflagged.** `meal-type-manager.tsx` edits meal types, is
visited rarely, and a network read there costs nothing anyone notices — whereas being wrong about
the writer set costs six hours of a stale list on the one screen where it would be obvious. Every
write there does invalidate before reloading, so the flag would be safe; this is defence in depth.

## What bounds cross-device staleness, and why two sites stay unflagged

A flagged read is cleared by any local write, so the residual risk is a change made on **another**
device: this one would not see it until the TTL lapsed. Two sites deliberately keep revalidating and
between them close that window.

`components/sync-provider.tsx` holds both — the warm-list entry at :85, and a real `cachedFetch` of
the key at :276 inside the notification-scheduling path. Neither is flagged, so a sync pass refetches
the list unconditionally and refreshes the entry every other read then hits. That is the design:
**flag the component read paths, not the warming ones.** Flagging the warm pass would be the actual
mistake here, because warming exists precisely to go and look.

## The guard

`components/nutrition/__tests__/rv67-meal-types-ttl-gate.test.ts` pins the fragile half — a new
mutating caller outside the manager would break the proof with no crash, just a stale list. Its
first cut had a bug worth keeping in mind: it anchored a fixed 700-character window on the key, and
the flag sat at 720 because my own explanatory comment pushed it out, so it reported a missing flag
that was present. It now extracts the whole brace-balanced call. A fixed window is the same class of
error as a regex that cannot balance parens.

Control-run: the flag assertion fails against `origin/main`; the two writer-set assertions pass
there, correctly — they pin a premise that predates this change.

**Not exercised:** no device, no browser. The behavioural claim here is "fewer requests on a warm
cache", which the sandbox cannot demonstrate end to end; what is verified is that the flag reaches
`cachedFetchCore`, that invalidation still clears a flagged key (the group deletes the entry, so the
freshness check misses), and that the writer set is complete.
