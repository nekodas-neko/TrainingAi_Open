# Session journal — batch folded 2026-09-27

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-25-rv67-nutrition-targets-ttl"></a>

# 2026-09-25 — RV-67's second key, and the audit it invalidated

**Branch:** `lane-b/rv67-nutrition-targets-ttl` · **Lane:** Implementation B

`nutrition-targets` now skips the network inside its 6-hour TTL. One line of code; the proof is the
work, and this one had two halves the first key did not.

## Is the payload a derivation?

That question had to be settled before anything else. If targets were computed from body weight or
from goals, then **every body-metric write would be a writer of this key**, and the writer set would
be far larger than the group that clears it. They are not: `GET /api/nutrition/targets` is
`repo.getNutritionTargets(userId)`, a stored row.

The guard test pins that, because it is the assumption most likely to quietly stop being true — if
the route ever starts deriving, the proof has to be redone from scratch rather than patched.

## The second writer is not where you would look

`upsertNutritionTargets` has **two** callers, and only one is the obvious route:

- `PUT /api/nutrition/targets`
- **`PUT /api/user/goals`** (`app/api/user/goals/route.ts:77`), which upserts targets as a side
  effect of a goal change.

So every *goals* writer is silently a *targets* writer. Four client files write through those two
routes — `tdee-adaptation-card`, `goal-recommendation-sheet`, `macro-targets-pane`, `goals-section` —
and all four call `invalidateGoalRecommendations()`, which holds the key. Nothing in
`lib/local-store/**` or `app/api/sync/**` carries `nutrition_targets` or `user_goals`, so there is no
sync writer; and `health-content.tsx` reads `/api/user/goals` but does not write it.

The test asserts that writer set rather than the fix: a goals writer that forgot the invalidation
would leave a stale target for six hours with **no crash**, which is the only failure mode here.

## What made this key safe is its subscription

`useNutritionTargetsRefresh` already wired `useInvalidationRefetch('nutrition-targets', …)`. That is
what makes the flag safe rather than merely legal: a write clears the entry **and** re-runs the read,
so the flag only ever suppresses a request nothing has invalidated. Without that subscription a
cleared entry would sit unread until something else happened to fetch it.

Same site policy as the first key: the flag goes on the read path only. `macro-targets-pane` is the
screen that *edits* targets and stays unflagged, and the sync-provider warm entry stays unflagged
too — flag component read paths, never warming ones.

## It invalidated a recorded audit, and CLAUDE.md cites it

`docs/reviews/2026-08-16-goal-invalidation-audit.md` concluded that all six keys of
`invalidateGoalRecommendations()` are **inert** — that none of them can render a stale value the
invalidation prevents. True when written. It is now **five of six**, because this key meets the
audit's own first condition.

That is the Q-262 caveat arriving in practice rather than a flaw in the audit: *a key that is inert
today becomes load-bearing the moment someone adds `freshWithinTtl` to it.* The correction is written
at the head of the audit itself, not only in the backlog entry — CLAUDE.md quotes the headline, and a
reader who opens the audit should not have to find the backlog to learn it has moved.

**Not exercised:** no device, no browser. What is verified is that the flag reaches `cachedFetchCore`,
that the writer set is complete, and that the payload is still a stored row. The behavioural claim —
fewer requests on a warm Nutrition tab — the sandbox cannot show end to end.

<a id="2026-09-25-rv68-supplement-tick-paints-first"></a>

# 2026-09-25 — RV-68: the supplement tick paints on the tap, not after the writes

**Branch:** `lane-b/rv68-supplement-tick-paints-first` · **Lane:** Implementation B

`applyOptimistic()` sat behind three awaited local writes and a native call, so the tick appeared
only once they had all returned.

## Why this is a measurement, not an intuition

"The local write is fast" is true almost always, and that is what makes this hard to see. The repo
had already hit the identical shape and written down why it fails: the Capacitor SQLite plugin has
**one connection**, so a tap landing during the sync pull's `applyDelta` transaction queues behind
the whole delta — which left the mood sheet's button reading "Saving…" for about two minutes on
2026-08-13 (`components/mood-checkin-sheet.tsx`). Supplements write to that same store from the
Nutrition tab, which is where `pullDelta` also lands.

So the fix copies that file's shape exactly: paint first, run the store writes and
`cancelSupplementReminder` in an un-awaited block, reconcile after.

## Two things the entry did not cover

**There is no haptic in this file.** The entry says to move "`applyOptimistic()` and the haptic"
above the `try`. None was added — that is new device behaviour on a surface used daily, with no way
to verify it from here, and the entry's phrasing reads as though one already existed.

**Painting first means failure has to undo it.** The old `catch` could stay silent and let the
checkbox "snap back" precisely because nothing had been painted yet. It now calls an explicit
`revertOptimistic()`, which hands back the same array `applyOptimistic` maps from — that array *is*
the pre-tap state.

## The guard is deliberately not released with the paint

Moving the writes off the await path has a consequence the entry does not mention: `setToggling(null)`
sat in a `finally` that would now run almost immediately, clearing the in-flight guard and re-opening
the double-tap window — the class that once turned five rapid taps into four `complete-workout`
POSTs. It now clears when the write settles. **What comes back instantly is the tick, not the ability
to tap again**, which is the right trade: the complaint was never that the row was briefly disabled.

## The guard test

The property is an **ordering**, and no assertion about rendered output could catch it — on an
uncontended store the old code looks fine, and contention is exactly what the sandbox cannot stage.
So `rv68-supplement-tick-paints-first.test.ts` asserts on the source: the paint precedes the first
`await`, the catch reverts, and the guard is released in a `finally` after the paint. 2 of its 3
assertions fail against `origin/main`; the third pins a premise that already held.

**Not exercised:** `getLocalStore()` returns null off the APK, so the contention was never reproduced
here — which is precisely why the entry named a device look as its verification, and why RV-68 keeps
its entry with `Verify: device` rather than being struck.

<a id="2026-09-25-rv74-score-ring-eased"></a>

# 2026-09-25 — RV-74: matching the duration was not enough to make it one gesture

**Branch:** `lane-b/rv74-score-ring-motion` · **Lane:** Implementation B

The health hero eased its number over 600 ms and snapped its ring. One component, two behaviours, on
the app's most prominent element — which is what makes it a defect rather than a preference, and why
it was Lane B's to fix rather than the owner's.

## The prescribed curve does not make them one gesture

The entry says to add `transition: stroke-dashoffset 600ms cubic-bezier(0.05,0.7,0.1,1)` and to
"match 600 ms so ring and number are one gesture". The duration is right; the curve is not.

`useCountUp` eases with `1 - (1-t)³` — a cubic ease-out — and the two curves diverge sharply in the
middle:

| t | count-up `1-(1-t)³` | entry's curve |
|---|---|---|
| 0.5 | **0.875** | **0.762** |

So the ring would trail the digits by eleven points of progress halfway through, and still read as two
things happening. Matching only the duration gets you two gestures of equal length.

The exact CSS form of the hook's easing is **`cubic-bezier(0.333, 1, 0.667, 1)`**. That is derivable
rather than a guess: for a CSS Bézier to be a pure function of elapsed time, x(t) must be linear,
which fixes the x-controls at 1/3 and 2/3; solving y(t) = 3a·t − 6a·t² + 3a·t³ + 3b·t² − 3b·t³ + t³
against 3t − 3t² + t³ gives a = b = 1. Verified numerically to 1e-16 on both axes, and the test
re-derives it rather than asserting the literal — so if anyone changes the hook's easing, the test
fails with the reason rather than the number.

## Why CSS and not an inline transition

The entry offers both. The inline route wanted gating on `useReducedMotion()`, and the component
cannot: `useCountUp` reads that hook **internally**, so the boolean never reaches the caller. Adding a
second `useReducedMotion()` call beside it would work but duplicates the source of truth.

`.score-ring` in `globals.css`, with `transition: none !important` in the reduced-motion block beside
`.border-run`, is the route the entry itself pointed at — the same class of thing (a
`stroke-dashoffset` animation), handled the same way, needing no new hook call.

## A near-miss worth recording

Mutation-testing the curve left `globals.css` mutated, and I cleaned up with `git checkout -- <file>`.
That restores from the **index**, which never held my changes — so it silently reverted the whole CSS
half while the component half survived. The final verification run caught it (3 failed, 1 passed)
because I re-ran the tests after cleanup rather than assuming the cleanup was a no-op. Had I not, the
PR would have shipped a class that nothing defines.

**Not exercised:** no device. `docs/mobile-ui-and-performance.md` warns that stroke-dash donuts in
card grids can wipe sibling cards' gradients on Samsung's WebView compositor; this ring is in a hero
rather than a grid, so it is *probably* outside that failure mode — and "probably" is exactly why the
entry named a device look as its verification. It keeps `Verify: device` and prints in `--sittings`.

<a id="2026-09-25-rv79-mood-cached-fetch"></a>

# 2026-09-25 — RV-79: one bare fetch converted, and the 68 others counted

**Branch:** `lane-b/rv79-mood-cached-fetch` · **Lane:** Implementation B

Home read today's mood with a bare `fetch`, against the standing rule that client GETs of `/api/*`
go through `cachedFetch`. The conversion is one line. What it took to be safe, and what counting the
rest of the class turned up, are the parts worth keeping.

## The predicate is the fix, not the conversion

This entry had already been corrected once by Lane B: the obvious conversion **reintroduces a live
bug**. `cachedFetchCore` writes the response after any 2xx, outside every null check, so a server
`null` overwrites an optimistic local mood log — and `readCacheSync` parses a stored `"null"` back
as a value rather than a miss, so this screen's seeds then paint `null` and the check-in card
re-prompts. That is the session-167 bug, arrived at by fixing a rule violation properly.

`shouldCache` shipped since (#1394, RV-189), so the read now passes `{ shouldCache: d => d != null }`
and the null branch keeps its guard. Without the predicate the change would satisfy the rule and
break the screen, which is why the guard test asserts the predicate rather than the conversion.

## Counting the rest of the class

RV-79 and `LB-154` (which I filed hours earlier, for the food-logger sheet reading meal types the
same way) both read as one-off violations. They are not: **68 bare `fetch()` calls of an `/api/` GET
exist in client code**, measured with a brace-balanced scan that drops any call with an explicit
`method:`, ternaries included.

> **Corrected 2026-09-25 (LB-155):** this said **69**. The scan dropped `method:` but not the
> SHORTHAND `{ method, headers }`, which has no colon, so one POST in `supplements-section.tsx` was
> counted as a GET. 68 was the figure at the time; it is 67 now, because this PR's own fix removed
> one. The scan is unit-tested from LB-155 onward.

By area: `components/oura-ble` **18**, admin consoles **15**, `components/nutrition` **10**, then a
long tail. So roughly half sit in BLE and admin debug surfaces where a cached read is *actively
wrong* — you want a live value while holding the device, which is the same reasoning CLAUDE.md
already uses to exempt those consoles from the timezone rule. Others are per-query by nature
(`food-items?q=`, `barcode?code=`), and `/api/version` is the one route deliberately exempt from the
no-store rule, read by the update check, which must not be cached at all.

That is filed as `LB-155`. The point of it is not the conversions — it is that **a rule with 69
violations and no written exemption list cannot be enforced**, and every future entry citing it will
single out one site as though it were exceptional. Which is exactly how these two were filed.

## Scope

RV-79 is removed from the queue: the fix is invisible (the screen already seeds from this key, so no
new paint), so nothing is owed, not even a device look. `LB-154` stays and now carries the
population. The remaining ~36 product-surface sites are `LB-155`'s, deliberately not swept here —
RV-79 is the proof that a conversion is not mechanical.

**Not exercised:** no device, no browser. The entry's own "not established" also stands — on the APK
the local-store branch short-circuits before this fetch, so how often it fires on device is still
unmeasured, and this change does not measure it.

<a id="2026-09-25-rv99-workout-clocks-green"></a>

# 2026-09-25 — RV-99's one real defect, and why the other 113 sites went to the owner instead

**Branch:** `lane-b/rv99-workout-clocks-green` · **Lane:** Implementation B

RV-99 asks Lane B to replace ~180 copy-pasted band hexes with the design tokens. Measuring before
migrating turned one sweep into two quite different jobs, and only one of them is engineering.

## Measured first

**116 occurrences across 48 files** in `components/**` + `app/**` (65 green, 48 red, 3 amber). None
of the four must-not-touch files the entry names is in Lane B's paths at all.

Then the question that decides everything — does migrating change what renders? The app is
dark-only, so against the `.dark` tokens:

| | today | after | sRGB distance |
|---|---|---|---|
| green | `rgb(34,197,94)` | `rgb(86,238,102)` | **67 — clearly visible** |
| red | `rgb(239,68,68)` | `rgb(255,100,103)` | **50 — visible** |
| amber | `rgb(234,179,8)` | `rgb(239,175,0)` | 10 — imperceptible |

The green figure matches the number RV-99 itself states, which cross-checks both. So ~113 of the 116
are a visible, app-wide restyle of colours the owner reads daily.

## So most of it is not Lane B's call

A whole-app colour shift is a product preference, the one category CLAUDE.md keeps with the owner,
and building it correctly would still risk producing an app he does not want — which is exactly the
failure the mockup rule exists to prevent. Split out as **`LB-152`, `Lane: O`, `Ask: owner`**, with
the table above and three answers that each unblock it. Notably (b) — retune the token to today's
hex, then migrate — gets the same one-source benefit with no visual change at all, so the question
is genuinely open rather than rhetorical.

`Ask:` turned out to be a real field, not prose: `check-backlog-pointers` rejected a sentence there
and told me its only value is `owner`, which is what puts the entry in the always-visible section.
The wrong shape would have filed a question nobody sees.

## What shipped: the one genuine defect

`components/workout/workout-clocks.tsx` painted the same `isDone` state two ways — the ready ramp in
`var(--accent-green)`, and the warmup ramp **directly below it** in `#22c55e` and
`rgba(34,197,94,…)`, at the *identical* 30/7/12% mixes. Two greens for one meaning, stacked on one
screen. Five literals migrated.

**Its `#ef4444` was deliberately left alone.** Checked before touching it: the overtime red agrees
with three sites in `rest-ring.tsx`, so nothing disagrees, there is no defect, and migrating it
would have been an unrequested restyle.

That test — *is there a second value for this same meaning?* — is what separates a defect from a
preference, and it is the tool for the remaining 46 files whichever way the owner answers.

The comment at `:101` claiming these hexes were "not this component's to churn" is replaced. It was
true for the PR that wrote it; RV-99 is the entry that churns them.

## Not exercised

The rendering. This is a colour change and nothing here was opened on the S25 or in a browser — what
is verified is that the literals are gone, the percentages match the ramp above, and the hex ratchet
(shrink-only) went down rather than up. A device look at the warmup ramps is the real confirmation
and is owed whenever the next sitting happens.

<a id="2026-09-25-tuning-queue-the-pr-approvals"></a>

# 2026-09-25 — the owner-question rule does not cover pull requests, and three slipped

Docs-only, one entry. Owner: *"I can answer some of those backlog entries here; but everything should
go to ORC for my review/input."*

## What I checked

All seven decisions I had listed for him are correctly `Lane: O` — verified through `laneFromLines`,
not by eye. They were already with the Orchestrator.

The three **pull requests** I handed him in the same message were not. `grep -cE '#1607|#1592|#1499'`
over the backlog returns **0**. They existed only in GitHub's review-request list and in one chat
message — which is exactly the failure CLAUDE.md's owner-question rule exists to prevent, one category
wider than the rule's wording. #1499 had been waiting since 2026-09-24.

## Filed as TN-80, `Lane: O`, ungated, at the head of the queue

Carries all three with a recommendation each: #1607 (bearer tokens, auth, external — he reads it
himself, no agent merges it), #1592 (active energy — mergeable but revives the input Q-204 removes, and
it invalidates the Q-524 amendment I published yesterday), #1499 (approve; the widening is narrow and
the no-leak behaviour was proven rather than asserted).

The owner list goes 7 → 8 with this at the top.

## The durable half

The rule routing owner questions is written about backlog entries and says nothing about PRs, so a PR
awaiting the owner has no home in the queue. Recommended extension: when a PR needs the owner — auth,
secrets, money, a data-dropping migration, or an external contribution touching any of those — the
opening agent files a `Lane: O` entry with an `Ask:` naming the PR, struck when the PR merges or
closes. Filed as a recommendation rather than edited into CLAUDE.md, since a standing-rule change is
his to accept.

## Not done

**None of the three diffs was reviewed.** This entry routes them; #1607's auth surface in particular
deserves a real read, and a security pass before he reads it would be worth more than my summary. No
claim is made about the two external PRs' CI state, coverage or provenance.

---

## Scope correction — owner, same day

> *"The only questions asked from me in this agent should be about tuning in general for our pillars or
> workouts etc — nothing to do with other avenues."*

Over several turns this session put to the owner: three PR approvals (#1607 auth, #1592 health imports,
#1499 admin scoping), a branch-protection correction, a device-routing sweep, and a proposed change to
the owner-question rule. **Every one was someone else's to raise.**

The findings were sound and the routing was wrong, which is the harder mistake to see — useful work
still spends attention he had not agreed to spend on a Tuning session. Filing them `Lane: O` was
correct; `Lane:` is explicitly the channel between agents. Briefing him on them *here* was not.

Recorded in `docs/agents/state/tuning.md` rather than only here, because a journal entry is read once
and a baton is read at the start of every session of the role. The test it records: if the answer
changes a score, a threshold, a goal or a prescription, ask it in this session; otherwise file it.

The same edit flags the baton stale below "Now" — its header says `Next ID: TN-30` while the real next
free is TN-81, and everything under it predates the TN-55…TN-80 run. A full rewrite is owed.

**TN-80 stands.** The three PRs genuinely were tracked nowhere, and the entry routes them to the
Orchestrator, which is where they should have gone in the first place.

---

## The prediction landed the same day, and my amendment was wrong

TN-80 said of #1592: *"If this merges it has one, and the steps/energy double-count becomes live…
whoever merges it should add that line to Q-204 and Q-524, or my amendment is wrong on `main` with
nothing marking it."*

It merged as **#1616** (*"…, rounded"*, superseding #1592) before the entry reached the owner, and the
line was not added. So the amendment sat wrong on `main`. **Corrected here.**

`app/api/sync-health/route.ts` now accepts `dailyMetrics[].activeCalories` and writes it rounded into
`body_metrics.active_calories` — the column feeding the `activeEnergy` contributor. What survives of
my 2026-09-24 answer: it is still not live *today*, because no client sends the field yet. What does
not: **"probably never" rested on the source being dead, and it is not dead any more.** The collision
now needs only a client, not a decision. The original text is kept rather than deleted, because its
measurements hold and only the forecast failed.

## Two collisions this PR hit, both worth recording

**Another session ran the same journal compaction.** #1617 folded **40** entries into
`history-2026-09-25-folded-1.md`; this branch had folded **12** into a file of the *same name*. Keeping
both would have duplicated entries. Main's landed first and is larger, so this branch's fold was
**dropped entirely** and rebuilt on main — CLAUDE.md's warning that two sessions running the same
chore once cost a whole PR, met in practice.

**A green run is not a mergeable PR.** All ten checks read `success` with `failed_jobs: 0` and the
merge was refused with *"Pull Request has merge conflicts"*. Mergeability has to be read separately;
a green run says nothing about it.

<a id="2026-09-26-art-cat-collection-art"></a>

# The cat collection gets drawn art, and a v2 ruleset is planned

**Branch:** `art/cat-collection-art` · **2026-09-26** · **v1.466.0**
**Shipped:** BF-126 (art) · **Filed:** PS-48 (Lane O), PS-49 (Lane A), PS-50 (Lane A, APK)
**Plan:** [`docs/superpowers/plans/2026-09-26-cat-collection-rules-v2.md`](../superpowers/plans/2026-09-26-cat-collection-rules-v2.md)

## Why BF-126 had not moved

The owner said yes to artwork on 2026-09-14. The entry was re-gated a day later on an asset nobody
could produce, and Lane B kept reaching an afternoon's wiring with nothing to wire. **The missing
option was that a session can author the art itself**, as SVG committed to the repo. Put to the
owner, he took it and then widened it.

## What the owner decided in-session

- **Style.** A first pass in pixel art (24×24 grids) was rejected: *"these are too small dont have
  enough detail"*. He supplied references: a flat bold-outline grey cat and a hand-drawn sticker cat.
  The shipped set follows the first: ink outline, flat fur with shade and light tones, big eyes. It
  was approved at the tier-1 stage before the other sixteen were drawn.
- **Four MMO classes.** Tank (workouts, "strong, getting bulkier"), Ranger (steps), Rogue (cardio)
  and Cleric (tracking consistency, *"a 'you have kept up to date with tracking'"*). Steps and
  cardio stay separate.
- **The healer is the "Health cat"**, which earns points for any health logging (sleep, nutrition,
  weight): *"So you are more inclined to track/sleep well"*. That answered PS-48 ①; the points
  numbers in the plan are provisional.
- **v2 mechanic.** Three-to-one merges and a **constant daily drain that movement counteracts**:
  *"if I make 5000 steps in the day its an effective 4000 profit"*. Recorded in the plan and filed as
  PS-49. His numbers are provisional by his own account.

## Structural calls made here (the owner delegates these)

- **SVG files in `public/cats/`, generated by a committed script**, not inline JSX. The source is
  diffable data, a test pins the output against the source, the service worker's catch-all caches
  the files after first view, and PS-50's Android widget can convert the same files. Hex colours
  stay out of `.tsx`, so the hex-literal ratchet is untouched.
- **A shared cat body plus layered gear per tier**, which is BF-126's own brief. Size and gear carry
  the tier, and fur, eyes and headgear carry the class, so the class survives at widget size.
- **Rendered at 56 px (card) and 48 px (`/collection`)**, up from emoji size. BF-126 warned detailed
  art at 32 px would lose to the emoji; the answer was size, not less detail. `/collection` stacks
  each tier's label under its sprite so three fit across 412 dp.
- **The glyph map stays as the fallback**, per the entry.

## Found while running it

**A hydration race left broken-image boxes instead of the glyph.** A server-rendered `<img>` begins
loading before hydration, so a load that fails early fires `error` before React attaches
`onError`. On `pnpm dev` an unauthenticated `/cats/*.svg` 307s to sign-in, and whether the box or
the glyph showed depended on which finished first. `CatSprite` now checks `complete &&
naturalWidth === 0` on mount. The same bug would bite the APK offline before the SW has the files.

## What was not exercised

- **The signed-in card on `pnpm dev`.** This machine has no local Postgres. The real component ran
  on the dev server through a temporary public page, not committed.
- **Anything on the S25**: Samsung WebView rendering, first view offline. There is a Known-Issues
  row, and BF-126 carries `Verify: owner`.
- **The owner's cat counts under v2.** The read-only query secret was not available to this
  session, so PS-49 owes that measurement in its PR.
- `pnpm typecheck:tests` cannot spawn `npx.cmd` on Windows (Node 22); `tsc -p tsconfig.tests.json`
  was run directly instead and showed no error in any touched file.

## Gates run

`pnpm check:rules`: **Ran 80 of 80 Custom Rules steps**, exit 0. The collection unit tests pass
(5 files, 43 tests, plus the new sprite drift test), eslint is clean on the touched files, and
`tsc --noEmit` exits 0.

<a id="2026-09-26-bf204-bf206-home-crowding"></a>

# The pen was crowded by construction, and the Coach button sat on the last row of Home

Implementation Lane B, 2026-09-26. `BF-204` and `BF-206`, both from the owner's own screenshot of
Home, shipped together because they need one look at one screen.

## BF-204 — three mechanisms, each of which guarantees crowding

The owner, on his first real use of the collection: *"Its a bit cramped in there. Might be too many
at once."*

**It was not the hash clustering them.** `penCats` sorted `b.tier - a.tier` and sliced twelve, so
the drawn set was always the twelve **largest** — and his collection is ≈ 22 cats of which ≈ 13 are
top-tier, so "all one tier" was the normal case rather than bad luck. A tier is a 12 px `BAND`
interval, so the depth-by-tier design that is meant to separate them did nothing and they landed on
one line. On top of that, `348 / 12 = 29 px` slots against 34–50 px sprites overlap by ~13 px
*before* the ±115 px wander, and twelve `whitespace-nowrap` tags came to ~456 px against 348.

Fixed, in the order the entry ranked them:

- **① The selection round-robins from the rarest tier down** instead of sorting and slicing. The
  rare cats are still led with — that is what the sort was for — but the drawn set spans several
  bands, which is what spreads them vertically.
- **② `MAX_SHOWN` is a ceiling, not the count.** `shownForWidth` reads the pen's own
  `ResizeObserver`: **six at 348 px**, from 56 px slots.
- **③ `tagsForWidth` draws three tags** at that width, rarest first, rather than twelve.
- **④ deliberately not done.** Stretching the bands into the empty sky is work PS-49 undoes when
  six tiers make bands 3–5 and the flyers reachable.

Rendered at 412 px dark against a stubbed collection of the owner's shape: six cats across three
sizes, nothing occluded, no clipped names.

## BF-206 — the reserved space was one control short, exactly

Home's scroll used `pb-nav-safe`, which reserves the nav bar and a gutter. The FAB is
`bottom-fab-safe` and `h-14`, so its top edge sits **56 px above everything that padding
reserved** — and the bottom 56 px of the scroll, on the right, could never be scrolled clear of it.
On the owner's screenshot that was the day timeline's last row.

`.pb-fab-safe` is the same calculation plus the button's own `3.5rem`, and Home uses it. **The
guard is the part worth keeping:** every file rendering `<CoachFab` must also carry `pb-fab-safe`,
because the failure arrives by omission — the next screen to mount a FAB will reach for
`pb-nav-safe` like every other screen, and nothing will look wrong until something lands under the
button.

The second half was filed as the owner asking what *"that button on the widget, the white circle"* was. **⚠ That reading was wrong — see the correction at the foot of this entry.** A
sparkle is this app's generic AI mark — the weekly-recap banner, the meal-source row and the
profile tab all use it — so it names a category, not a destination, and an `aria-label` is not an
answer to someone looking at it. It is an extended FAB now: the icon with a **Coach** label beside
it. The alternative, a one-time tooltip, teaches only the person who does not dismiss it.

**Checked and not changed: the colour.** `bg-foreground text-background` reads as a stark white
circle in the dark theme, but it is the repo's standard filled-control treatment, and changing it
here alone would make this control the odd one out.

## Failure surfaces not exercised

The S25, for both. BF-204's pass/fail is explicitly a Samsung WebView one — *no name clipped by a
neighbour, and no cat fully hidden behind another* — and the cats wander, so a screenshot at one
instant is weaker evidence than a look. The sandbox render is the before/after, not the verdict.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline. Six new
unit tests on the pen's selection and sizing, four on the FAB. Control run: reverting Home to
`pb-nav-safe` fails the clearance scan. Both surfaces rendered at 412 px dark and looked at.

## ⚠ Correction, same day — the second half was filed against the wrong button

The owner was not pointing at the Coach FAB. *"No not the ai coach white button; its the one on
the collection widget."* He meant the **moon in the collection pen's backdrop** — a 28 px
near-white disc at full opacity in the upper-right corner of a night sky, which is `BF-208`.

Of the two halves shipped here:

- **① the clearance stands.** It was measured from the CSS — `pb-nav-safe` reserves the nav, and
  the FAB is a further `h-14` above it — not inferred from his words, so it is true whatever he
  meant.
- **② the extended label does not, and is reverted** in `BF-208`'s PR. `BF-206` struck the finding
  as an unrequested restyle of a working control, and that is right: it existed only because the
  misread made it look like his complaint. Keeping it because it had already merged would be the
  thing CLAUDE.md's mockup rule exists to prevent. The case for a label is real and is now
  `LB-164`, an owner preference rather than a defect.

The lesson is narrower than "check the report". The trace *was* plausible; what went wrong is that
this entry presented it as established, in the same list as a finding measured from the CSS. A
reading of what somebody meant is a hypothesis and needed to be labelled as one.

<a id="2026-09-26-bf205-home-section-drag"></a>

# The "Reorder sections" button can reorder sections

Implementation Lane B, 2026-09-26. `BF-205`.

## The defect

The owner: *"when I click the grid button on the home screen I cannot move widgets and re-arrange
them."*

It was not a broken drag — there was no drag. `HomeSortableSection` was named *Sortable*, took an
`id`, and held one hide button: no `useSortable`, no `DndContext`, no pointer handler, no handle.
Everything around the gesture was built, which is why it read as broken rather than absent — the
header button set `sectionEditMode` and said `aria-label="Reorder sections"` with `aria-pressed`,
the order was state with `loadSectionOrder`/`saveSectionOrder` behind it, and a `useLayoutEffect`
kept a ref fresh *"so drag/sync handlers can read it synchronously"*. Only the `/sync` half of that
comment had ever been written: `setSectionOrder` had four call sites and not one was a gesture.

## What shipped

- `components/home-sortable-section.tsx` is a `useSortable`, with a grip that appears in edit mode
  beside the existing eye-off, and `disabled` outside it.
- `lib/hooks/use-home-section-drag.ts` reorders on `dragover` and persists on `dragend`.
- `components/home/section-order.ts` is the move itself, by key.
- `e2e/bf205-home-section-drag.spec.ts` drags a section and reloads the page.

## The drag is on a handle, and that is the device fix

Home's sections scroll vertically. A whole-card drag would put the reorder and the scroll on the
same touch, which is the direction-lock class `docs/mobile-ui-and-performance.md` warns about and
exactly what this entry's own pass test says to check. A handle makes "a plain vertical scroll
does not pick anything up" true by construction rather than by tuning a threshold.

`touch-none` on the grip is the other half: without it the browser claims the gesture for the
scroll before `PointerSensor` ever sees it, and the drag silently never starts — on the device
only. A source guard holds both, because that class is what a later tidy-up removes.

## Two things the entry could not have known

**`savePreference` is not a `localStorage` write.** It also PATCHes the server, so persisting on
`dragover` would have put a request behind every position the thumb passed. It persists on
`dragend` instead, and the guard pins that the per-event handler does not save.

**The reorder has to address by key, not index.** Home renders
`sectionOrder.filter(k => !hiddenSections.has(k))` and then drops any section whose content comes
back `null`, so the list on screen is a subset with gaps: dropping onto the third visible card
must not move the third stored key. `moveSection` works in keys, and the unit tests pin the
hidden-section case along with the two races — an unknown key on either side is a no-op, because
the card-widget reconciliation rewrites this list when a widget is toggled in More.

## The size check earned its keep

The first version put both handlers inline and `check-component-size` failed:
`session-select-content.tsx` at 1,465 lines against its 1,448 baseline. That file is a known
hotspot and the rule says extract rather than append, so the handlers became a hook. The check
caught it before the diff was ever pushed.

## A harness lesson worth more than this entry

The spec was flaky at first and **the flake looked exactly like the defect**. Two fixes, in order:

`getByRole('button', { name: 'Drag to reorder section' })` matched **twelve** elements against six
handles — Home's cards are `role="button"` wrappers and the grip sits inside one, so the name
resolved onto both, and `.all()[0]` handed back a 412×266 box. The drag began on a card. An
attribute selector fixes it.

Then it still failed about one run in three. `@dnd-kit/dom`'s `PointerSensor` defaults say why: a
mouse press lands with **no activation constraint only when its target is the handle**; anything
else gets a 200 ms delay, a 5 px distance, and `preventActivation` for interactive elements — and
Home's sections are interactive, so a press that misses the grip by a pixel is blocked outright.
Cards resolve asynchronously here, so the layout shifts between measuring and pressing. The spec
now re-measures, confirms with `elementFromPoint` that the point is over the grip, retries, and
**throws a message that says the harness missed** rather than letting it read as the app not
reordering. Three clean runs, and the control (unwiring `onDragOver`) still fails with the other
message.

## Failure surfaces not exercised

The S25. A CDP pointer is not a thumb on a Samsung WebView, and the third clause of the pass test —
a plain vertical scroll in edit mode picking nothing up — is only answerable there.

## Verification run here

`pnpm lint` 0 errors / 827 warnings (828 on the base — one fewer here) · `pnpm check:rules` Ran 80
of 80 · `pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline ·
11 unit tests · `e2e/bf205-home-section-drag.spec.ts` 2 tests, three consecutive clean runs, with
a control run that fails on the unwired build.

<a id="2026-09-26-bf208-pen-moon-and-chip"></a>

# The button on the collection widget was the moon

Implementation Lane B, 2026-09-26. `BF-208`, and the revert of half of `BF-206`.

## What the owner was pointing at

*"there is that button on the widget the white circle"* — then, after a first trace landed on the
wrong control, *"No not the ai coach white button; its the one on the collection widget."*

It is decoration drawn to look exactly like a control: in `scene-meadow.svg`,
`<circle cx="300" cy="36" r="14" fill="#f3ecd2"/>` — a **28 px solid near-white disc** on a night
sky, rendering near 1:1 into the pen, in the upper-right corner. Four things converge: it is the
highest-contrast element on the card, brighter than any text; it is a hard-edged filled circle,
the shape of every icon button in the app; it sits in the corner that means "control"; and
`+12 more` sat 30 px to its left, styled as a pill.

## What shipped

Each offending disc is softened and moved off the corner — meadow `cx 300 → 72` at `.55`, space
`cx 300 → 82` at `.8`, kitchen `cx 290 → 232` at `.6`, staying inside its drawn window frame. That
breaks two of the four factors, which is what the entry asked for. And `+N more` is a caption now
rather than a pill, keeping a text shadow in place of the background plate because the scene
behind it ranges from a night sky to a kitchen wall.

**Making the chip a real button was the wrong call and stays rejected:** the whole card is already
the link to `/collection`, so a button inside it is a second tap target for the same destination —
the nested-interactive shape the repo's own Custom Rules check exists to catch.

## The scenes are generated, and a guard caught me editing the output

The first pass hand-edited `public/cats/scene-*.svg`, and
`collection-sprites.test.ts` failed with *"an edit to the art source without a rebuild fails
here"* — the twelve backdrops come out of `scripts/collection-art/scenes.mjs` via
`build.mjs`, and the test compares every file on disk against the generator's output. It was
right and the fix went into the generator. Worth knowing before touching this art again:
`public/cats/` is build output, not source.

(Space's disc turned out to be a *ringed* planet, so the `<ellipse>` had to travel with it. The
hand edit would have left the ring behind in the corner.)

## The sweep found a different set than the entry predicted

The entry expected `space`, `snow` and `bedroom` to have their own bright disc in the same corner.
Measured across all twelve: it is **`meadow`, `space` and `kitchen`**. `snow` and `forest` have no
large disc at all; `bedroom`'s sits at `cx=90`, the left quarter, so the corner factor fails; and
`kitchen`'s is a moon inside a drawn window frame, which nothing in the entry would have suggested.

`components/home/__tests__/bf208-pen-corner.test.ts` holds the corner for the thirteenth scene:
any `<circle>` of r ≥ 6 at opacity ≥ .9 with `cx > 240, cy < 60` in any `public/cats/scene-*.svg`
fails it. That is the half a one-file fix leaves open, and the reason the entry called for a sweep.

## And the revert

`BF-206` was filed against the wrong button by the same misread, and the Orchestrator struck its
second finding — *"nothing identifies the Coach button"* — as an unrequested restyle of a working
control. **#1730 had already shipped it.** The extended "Coach" pill is reverted here.

Keeping it because it was already merged is the tempting move and the wrong one: it is a visual
change to the screen the owner opens first, he did not ask for it, and CLAUDE.md puts that on his
side of the line. The case for a label is genuine — a sparkle is this app's generic AI mark, so on
its own it names a category rather than a destination — so it is filed as `LB-164`, an owner
preference with a recommendation attached, rather than deleted.

The clearance half of `BF-206` stands untouched: it was measured from the CSS rather than inferred
from his words, so it is true whatever he meant.

## Failure surfaces not exercised

The S25. Whether a moon at 55 % still reads as a moon rather than a smudge is the owner's eye, and
the pen is his screen. Rendered at 412 px dark here with a stubbed collection: the corner is clear
and the caption is legible over the sky.

## Verification run here

`pnpm lint` · `pnpm check:rules` Ran 80 of 80 · `pnpm test` · `pnpm build` · `tsc --noEmit` ·
`check-test-typecheck` · doc-size, backlog-pointers and doc-links green. 13 new assertions across
the twelve scenes; control run: restoring meadow's moon fails the corner guard.
