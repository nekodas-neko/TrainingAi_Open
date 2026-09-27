# RV-150 — the probe's own untested case was the one that mattered

**Branch:** `fix/failed-read-says-so` · **Lane B** · `components/more/**`, `app/more/**`.

RV-150 blocked each of 24 read endpoints in turn on the phone and found **nothing visible changed
anywhere** — every card kept its cached value as if current. Its last line: *"Not tested: a failure
with no cache (cold start)."* That is the case the standing rule (Q-499) is actually about, and it
gives a different answer.

## What a cold failure looked like

Storage cleared, every `GET /api/*` returned 500, at 412 px:

| surface | before | verdict |
|---|---|---|
| Home | *"Your week in review didn't load"*, *"Couldn't load today's timeline"*, em dashes for numbers | **honest** — the reference |
| More | name, email, level, XP and trophy case all absent; identity fields fell to their `??` defaults | reads as a new account |
| Profile details · readings | **"What the app has measured"** absent, heading included | unreportable |
| Profile details · tests | **"Tests and scans"** absent, heading included | unreportable |
| Nutrition | **`0 KCAL`**, `0 g` protein/carbs/fat, *"Set a calorie goal"* | states a falsehood |

Three are fixed here. Nutrition went to **RV-103**, which owns that hook and is next in the queue;
Home's body-battery card and Health's three missing sections are **LB-175**, because the leaf cards
do not fetch — the screen does, so the fix is a flag per read in the parent, not an `onError` on a
card.

## The grep was wrong about three of five

23 of 43 `useCachedValue` call sites pass no `onError`. That list and the render diff do not line up:
`body-battery-card.tsx` and `energy-card.tsx` **do not fetch at all** — both take their data as a
prop and default it — so neither appears in the grep's list and neither is fixable there. Reading the
symptom back to the component that owns the read is the whole job; the call-site list is a starting
set of candidates.

## What shipped

`measured-overview-section.tsx` and `performance-overview-section.tsx` both end in `return null` when
they have nothing, so a failed load removed the heading too. Each now separates the two: nothing
recorded still renders nothing, a failure renders the heading and one line. In
`performance-overview-section.tsx` the existing `onError` **set `tests` to `[]`**, which collapsed
into the same empty branch — the flag is what tells them apart.

More's profile is the RV-87 shape one level up: with no user loaded, every field is a `??` default,
so a failure rendered *"No name set"* and a blank email as fact. `more-content.tsx`'s two
`cachedFetch` calls had `.catch(() => {})`, which **cannot fire** — `cachedFetch` resolves a boolean
rather than rejecting (RV-84) — so they now pass `onError`, and the flag clears on a load that lands.

Nothing was added over data that did arrive: a partial load keeps its readings and says nothing. A
banner over good data is worse than the gap it explains.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors · full unit suite green · build clean.

`e2e/rv150-failed-read-says-so.spec.ts` drives a cold start with the reads failing. **Control-run:**
both failure tests go red against `origin/main`, and the **healthy** cold-start case passes in both
runs — without it a component that always rendered the line would pass everything. The healthy-path
capture is byte-identical before and after on both screens.

**Not exercised:** the device. This is render-only — no native, safe-area, gesture or offline-first
surface — so the 412 px harness covers the path it has. One thing the harness cannot reproduce is a
service-worker-served response: `page.route` does not see those, which is why RV-103's device work
had to block at the network layer.
