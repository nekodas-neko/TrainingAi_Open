# Review sweep 53 — stale surfaces, movement, and what should be one thing

**Date:** 2026-09-22 · **Scope:** the angles the owner named — animations and page swaps, caching
(from a live bug report), and which widgets or pages should merge.
**Method:** three read-only lanes plus a coordinator investigation of the owner's own report, with
every load-bearing claim re-verified at source. Nothing was rendered: no device, no WebView.
**Ranked by traffic:** Home 22 · Nutrition 14 · Health 11 · More 7 · Workout 2.

## The owner's report is a re-report, and the fix could not report its own failure

He said: *"nutrition calorie macro not updating on screen when food added - requires page swap"*.
**The repo already quotes him saying it** — `app/nutrition/use-energy-balance-refetch.ts` exists
because of BF-177, whose docblock opens with *"The kcal left in the top right; doesnt load on the
same page: it requires page switching to show."*

So BF-177 did not close it. The mechanism:

```ts
void cachedFetch(`energy-balance:${date}`, …, d => setBalance(d ?? null)).catch(() => {})
```

No `onError`, and per RV-84 `cachedFetch` never rejects — so that `.catch` is dead. A 500, bad
signal or offline, and the refetch silently does nothing: the pre-meal object stays, "kcal left" and
the macro targets stay stale, **no retry and nothing on screen says so**. A page swap re-runs
`fetchData`. That is the owner's report, twice.

Three things that are *not* the cause, so the fix aims correctly: eviction works and always did
(BF-177 says so); Home's version of this card is fine (Q-402 gave it `useCachedValue`); and the
eaten totals do update, because they reduce from optimistically-appended `logs`. It is the
server-derived budget half that goes stale.

**A second defect in the same callback is worse than staleness:** `d => setBalance(d ?? null)` sets
null on an empty payload, and `balanceForDate` is gated on a date match — so a null or wrong-date
payload makes the budget and macros **disappear** rather than go stale (RV-103).

## The class is wide, and one asymmetry proves it

**Deleting a food refetches the weekly calorie chart. Adding one does not** (RV-104). Same screen,
same quantity. The delete site's own comment says it is *"BF-177's third site, which that entry did
not name"* — so BF-177 was patched site-by-site and a fourth site was always likely. The 7-day chart
and the adherence percentages hold their launch values until the app restarts; a tab switch does not
help, because `useRefreshOnTabShow` re-runs `fetchData`, never `fetchMountData`.

Four more of the same shape: a ring sync updates Home's HR strip and leaves Health's HR card on
pre-sync data (RV-106); editing macro targets leaves Nutrition banding against the old target
(RV-107); on-device a weigh-in calls **no invalidation at all** on the local-store branch while its
sibling `water-log-sheet` does it correctly two files away (RV-108); Health's Activity History never
shows an activity confirmed from Home (RV-109).

### Why the existing guard missed four of them

`check-fetch-once-effects.js` only matches `useEffect(…, [])`. Its comment calls a non-empty dep
array *"a different (and usually correct) shape"*. **That is right in general and wrong here:**
inside the persistent tab shell `[userId]`, `[today]` and `[trendsProp]` never change either.

Widening it is not a one-line change, and the file records why — the first version used a non-greedy
regex, swallowed code between effects, and **inflated its own baseline by 11 of 25**. The narrow fix
is to treat a dep array containing only shell-stable identifiers as fetch-once (RV-105).

## Movement: one number tells the story

**37 cross-tab `router.push` sites against 5 using `navigateToTab`.** A push unmounts the entire
`TabShell` — every panel's state and every `scrollTop` — and re-mounts four code-split tabs. The
illustration is two adjacent lines on Home: `handleNavigateStats` pushes, `handleNavigateHealthBody`
flips. Two taps on one screen, one slow and one instant (RV-110).

Also: Home and More both pass **no** scroll key while Health passes three, so those two mounted
panels overwrite each other's saved offset (RV-112). The tab switch removes the outgoing panel in
the same commit the incoming one starts at `opacity: 0`, over transparent `bg-page` — a hide-then-
fade rather than the M3 fade-through the comment claims (RV-113). Six pushed routes have no
transition, and the friends→profile pair **opens hard and animates closed** (RV-114).

**One real bug:** back while the barcode scanner is open closes the whole Log Food sheet. The
scanner replaces the sheet's body instead of registering its own back-stack entry — neither
`capture-actions.tsx` nor `ingredient-picker.tsx` does. It also injects a global
`visibility: hidden` on every body child, so this is the one back press in the app that touches a
global visibility switch, and the ordering is what must be tested (RV-111).

## Consolidation: what should be one thing

**Home offers two widgets answering "how much can I still eat" from one cache key** — both call
`useEnergyBalanceToday()`. This exact shape already produced Q-401/Q-415: two budgets 271–274 kcal
apart, both labelled "left". They agree today only because `budgetProvenance` was centralised
(RV-116).

**Health → Body shows two different energy answers nine cards apart** — `netKcal` in the Body group,
`remainingKcal` in Activity & intake — and `use-health-calcs.ts` records that these two surfaces
already disagreed once by each deriving its own TDEE. The data was unified; the presentation was not
(RV-117). **"Weight Trend" exists twice in Health, and the card with that title has no trend
number** (RV-118). **Seven banners stack above Home's first real content** — each correct, the
failure cumulative (RV-119).

Two housekeeping findings: `aiVolume` is built, has a live render arm, is in no order array, and has
**zero** backlog entries despite a comment promising a merge — an orphaned finding by the repo's own
rule (RV-120). And `/collection` has exactly one in-app link, behind a widget that is off by default,
so on a fresh install the route is unreachable (RV-121).

## Deliberately separate — the lane found the reasoning and did not propose these

Home's HR chip vs `/health/heart-rate` (OR-116: *"different metrics sharing a name"*, resolved by
labelling). `/more/clinical` vs the read-only clinical rows. The six single-entry screens, which
Q-239 decided with a per-screen table. Nutrition "End of Day" vs Home's day-review banner, already
merged under Q-112a. Water's three sheet mounts — *"convenient and correct"*.

## Clean — verified, do not re-sweep

Mood check-in, water log, the Home day timeline, the end-of-day read-through, `WeekDaySheet`, and
`sleep-sessions` on both tabs all refresh correctly. Set log and complete workout are a real route
push, so the shell remounts and every tab refetches. The View-Transition layer, sheet timing,
`SwipeCarousel`, `TabSwipeNavigator` and the back stack are all sound. **No animation of a layout
property anywhere**, with one documented and correct exception (Radix collapsible height). No
gesture handler that can swallow scroll.

## Not established

**Nothing was rendered or reproduced** — no device, no WebView, no `pnpm dev`. Every "what the owner
sees" is derived from the mount graph and dependency arrays. RV-108 is **device-only**: the branch
that misbehaves is the local-store one, which does not run off the APK. RV-113 turns entirely on two
device questions — whether a 180ms blink is perceptible, and whether `bg-page` resolves transparent
under the owner's wallpaper — and those decide whether it is worth doing at all. Whether the owner
has both energy widgets enabled is unknowable from the repo; RV-116's argument is about the picker
offering two answers, not an observed state.
