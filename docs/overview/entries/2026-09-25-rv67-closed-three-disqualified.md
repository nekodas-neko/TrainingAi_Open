# 2026-09-25 — RV-67 closes: three of five candidates cannot take the flag at all

**Branch:** `lane-b/rv67-corrections-and-meta` · **Lane:** Implementation B

RV-67 listed five keys as candidates for `freshWithinTtl`. Two shipped. **The other three are
disqualified — each for a different structural reason, none of which an invalidation proof could
have fixed.** So the entry is closed rather than left with work that cannot be done.

## The three disqualifications

**`health-trends-summary` — wrong fetch variant.** Both read sites are `cachedFetchToday`, which
passes `undefined` for `freshWithinTtl` and has no such option. Unreachable by construction. It could
only be converted by moving the key to the plain variant, which would discard the today-envelope that
exists to stop yesterday's data rendering after midnight — trading a real protection for a saved
request.

**`workout-data:meta` — a derivation that includes `today`.** `phaseStatus` is computed from
`countAllSessionsSinceStart` *and* `todayInTz(tz)`. Completing a workout changes it, and so does
midnight passing. Under a 6-hour flag the phase status computed yesterday would survive into today —
the session-52 class, where a TTL happily serves yesterday's data across the boundary.

**`muscle-recovery` — it decays with the clock.** `computeMuscleRecovery` takes `now = Date.now()`
over a rolling 7-day window. The payload changes continuously **with no writer at all**, so there is
nothing an invalidation group could be made to catch; a flag would simply freeze the recovery
percentages for six hours while they should be climbing. This is the cleanest of the three: there is
no proof to write, because there is no write.

## The criterion the entry was missing

All five candidates were chosen because they were **already `TTL_LONG` and already in a group**. That
says nothing about the thing that actually decides it:

> **The payload must be a pure function of stored rows.**

Derived, date-dependent, or clock-decaying payloads are disqualified before any invalidation proof is
attempted — and the two that shipped are exactly the two that pass: `nutrition-meal-types` and
`nutrition-targets` are both stored rows. That criterion is now in CLAUDE.md beside the proof rule,
because the ordering matters: checking it first would have saved the whole candidate list.

## A correction to a number I called verified

In #1631 I wrote that RV-67's figures — **191 cached read sites, 8 flagged** — *"reproduce exactly"*.
They do not. The real figure was **199**. My scanner skipped each call's type argument with a
paren-free character class, so every `cachedFetch<{ x: import('…').T }>` was invisible; the entry's
author evidently had the same blind spot, which is why we agreed.

**Two scanners agreeing is not corroboration when they share a blind spot** — "reproduces exactly"
meant "reproduces the same error", and I presented it as the one entry that had held up. The
conclusion is unharmed (191 of 199 still do not opt in) but the figure was wrong and was published as
checked. Both scanners now skip the type argument by balancing angle brackets; #1631's journal entry
carries the correction inline.

That is the **fifth** distinct scanner trap in one day, each a different mechanism: a regex cannot
balance parens; requiring `(` right after the name misses generics; `{ method }` shorthand has no
colon; a same-line grep misses multi-line calls; and a generic can contain parens. Every one produced
a number that looked authoritative. One of them, this turn, also had me briefly conclude
`muscle-recovery` had no fetch sites at all — it has four.

**Not exercised:** nothing renders differently; this PR removes an entry, corrects two figures and
sharpens a rule.
