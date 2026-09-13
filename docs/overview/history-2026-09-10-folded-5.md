# Session journal — batch folded 2026-09-10

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-01-chip-wrap-and-swipe-marker"></a>

# 2026-09-01 — the pill that wrapped, and the marker nothing read

**Branch:** `fix/header-chip-and-swipe-marker` · **Entries:** BF-96, BF-95 · **Lane:** B · **Version:** v1.418.3

Two one-change fixes in the same layer, batched because each is a line and neither can be finished
without the device.

## BF-96 — nothing moved the chip; it was wrapping

Owner, with a Home screenshot: *"I dont like how the temperature/uV pill sits. can we go back to the
old way when it was side by side. you can make it smaller if needed."*

**It was already side by side.** The chip's root is `flex items-center gap-1` rendering `21° · UV 5`
inline; what the screenshot shows is `UV 5` breaking at its own space so `5` drops under `UV` and the
pill goes two lines tall.

**The cause is an asymmetry with its sibling.** The header row holds exactly two items, and the date
carries `whitespace-nowrap shrink-0` while the chip carried neither — so the chip was the only
compressible item and absorbed 100% of any shortfall. The fix is the two classes its sibling already
had: the sibling-surface rule, where a row had decided how items behave under pressure and one of
the two was never told.

**Why it looked fine before — and a correction to the entry's own figure.** `EEEE d MMMM` varies
across the year, and the entry put the range at 12–20 characters. **Measured against a real render
at the worst case, it is 12–22**: *"Wednesday 30 September"* is 22, and *"Friday 1 May"* is 12. So
there are up to ten characters of variance and *"the old way"* the owner remembers is the same code
on a shorter date. That is also why nudging the symptom would have brought it back on its own
schedule.

**On *"you can make it smaller if needed"* — not needed, and size is the wrong lever.** Wrapping is a
`white-space` problem, not a width shortage. If the longest dates still overflow on the device, the
entry's guidance is to shorten the **date** (`EEE d MMMM`, −4 chars) rather than the chip: the date
is partly recoverable from the phone's own UI; the temperature and UV are not.

## BF-95 — a declared contract that nothing honoured

`components/ui/swipe-actions.tsx` sets `data-swipe-actions` on every row, with a comment stating
exactly what it is for — *"marks the row as owning horizontal gestures that start on it, the way
`data-swipe-carousel` already marks a carousel."* The tab navigator's exclusion list did not contain
it. **The marker was set and never read.**

It has not bitten because the navigator only arms a tab swipe within 24 px of a screen edge, so it
takes a swipe-to-delete begun in that strip to run both gestures from one touch. Meal rows are
full-width, so the strip is reachable: latent, not impossible, and exactly the failure the marker was
added to prevent. The fix is one selector.

**The guard asserts the pairing from both ends**, because the entry warns against the opposite
"fix" — deleting the marker as unused. Removing it would make the next swipe surface re-derive the
whole problem, so a test that only checked the navigator would have called that a pass.

## Verification

- **Four source guards, five mutations, all killed**: the navigator dropping the marker again, the
  primitive ceasing to declare it (the wrong fix), and the chip losing either class, plus a carousel
  marker falling out of the list.
- **One guard could not fail as first written** — it located the chip root by
  `rounded-full bg-muted/60`, which also matches the loading skeleton five lines above: a fixed
  `h-[26px] w-14` box that cannot wrap. It now requires `flex items-center gap-1` too.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers, doc-size and
  doc-links all exit 0, each read by exit code.

**Not exercised: the chip rendering.** The seeded sandbox has no weather snapshot, so `WeatherChip`
never reaches its content root — only the skeleton renders, and the wrap cannot be reproduced or
disproved here. What *was* measured on a real render is the sibling: the date reads
*"Wednesday 30 September"* at the forced worst-case date, which is the pressure that causes the wrap.

**Not exercised: the swipe.** The navigator listens on `document` and the web sandbox does not
reproduce the WebView's touch behaviour. Both entries carry `Verify: device`; BF-95's check is a
swipe-to-delete begun at the far left edge of a meal row, which must open the tray and not change
tab.

<a id="2026-09-01-chore-la-42-drop-dead-training-boost"></a>

# 2026-09-01 — LA-42: the score ring's second arc could not be reached

**Branch:** `chore/la-42-drop-dead-training-boost` · **Domain:** `app-shell` / `activity` · **Lane:** B · **No version bump**

`ScoreDisplay` in `components/health/health-score-detail.tsx` took a `trainingBoostFrom` and drew a
second, brand-coloured arc over the ring for the part of an activity score that came from a same-day
training blend. The prop is gone, with its `hasBoost` / `baseFrac` / `boostFrac` and the `<circle>`
they fed.

**Verified against `main` before deleting**, per the re-verify rule — the entry was filed two days
ago and a plan can go stale in the queue. It has not: `blendActivityScore` is gone (Q-284), and
`adjustment` is a literal `0` at **both** construction sites of this payload —
`lib/health/readiness-payload.ts:426` and the offline seed literal inside this same file at line 174.
So `adjustment > 0` is unreachable, `trainingBoostFrom` is always `null`, and `hasBoost` is always
false. `ScoreDisplay` is local to this file and had one call site.

**Not a regression, which is the whole reason this is safe.** The blend last had an Oura score to
adjust on **2026-07-07**, the re-key day, so the arc had been dead in practice for two months. Q-284
turned that into dead by construction — the difference between "nobody has hit this lately" and
"nobody can", and only the second licenses a deletion.

**No guard, deliberately.** The invariant a test could pin is *`adjustment` stays 0*, which lives in
Lane A's file and would block the revival it is meant to protect. If the blend ever comes back, this
arc should come back with it — a test forbidding that would be wrong. The reasoning is in the
component's doc comment instead, where someone reviving the blend will read it.

The offline-seed literal at line 174 stays: it satisfies the `ReadinessScoreResponse` shape, so it is
contract rather than dead code.

## Verified on `pnpm dev`

`/health/activity`, `/health/readiness` and `/health/sleep` all render their hero ring with the score
and band label intact — 19 LOW, 46 LOW, 55 MODERATE against the seeded data. The deleted arc was the
only thing that changed, and it was drawing nothing.

## No version bump, deliberately

Nothing a user can see changes: the arc was unreachable, so removing it renders the same pixels. The
convention bumps on *user-visible* changes, and inventing a changelog line for an invisible one would
put a claim in front of the owner that they cannot check and that is not true.

## Not exercised

- The S25. Nothing here is device-verified. It is a deletion of an unreachable branch on a surface
  that already rendered correctly, so the risk is low, but low is not zero and the ring is drawn with
  SVG stroke-dash — the thing Samsung's WebView compositor has been odd about before.

<a id="2026-09-01-current-password-field"></a>

# 2026-09-01 — an account with a password could not change it

**Branch:** `fix/lb-40-current-password-field` · **Entry:** LB-40 · **Lane:** B · **Version:** v1.416.4

## The defect

`EditProfileSheet` held `const [hasPassword, setHasPassword] = useState(false)` and **nothing ever
fetched it**. The only thing that set it true was a *successful* password save later in the same
session. The *Current password* field renders behind that flag, so for anyone who already had a
password it never appeared, the PATCH went up without `currentPassword`, and
`app/api/user/password` answered *"Current password is required."* — an error naming a field that
was not on screen.

**So the change-password flow was completely non-functional for every account with a password**, and
functional only for an account with none, which is the case the flag exists to detect.

Reproduced against the running route before touching anything: `{"newPassword":"…"}` → **400
Current password is required.** `GET /api/user/profile` was returning `hasPassword: true` the whole
time, in the same payload the More tab already reads.

## The fix, and the direction it fails in

The flag is fetched when the sheet opens, through **the key and TTL the More tab already warms**
(`more-user-profile` / `TTL_MEDIUM`) — so on the common path it is a cache read rather than a new
request, and it revalidates, which matters after a password is set on another device.

**Unknown shows the field.** The state is `boolean | null`, and the field renders unless the flag is
known `false`. `cachedFetch` swallows a failed request, so a cold cache plus a dead network would
otherwise land back on `false` and reproduce the bug silently. Of the two ways to be wrong, an
OAuth-only account seeing one optional field it can ignore is recoverable; a password account unable
to change its password is not. The route is the authority either way — it ignores `currentPassword`
when there is no hash.

The submit button blocks on a missing current password **only when `hasPassword === true`**, never
on the unknown or no-password cases.

## Verification

- **Rendered.** Opening More → Edit Profile → Change Password shows the *Current password* field,
  which is the whole of what was missing.
- **All four route paths exercised live**, against the seeded account (which has a bcrypt hash):
  no current password → 400 *required*; wrong current password → 400 *incorrect*; correct current
  password → 200; changed back → 200; and signing in with the seed password afterwards still
  works, so the round trip left nothing behind.
- **Six source guards, five mutations, all killed** — reverting the initialiser to `useState(false)`,
  reverting the render condition to `{hasPassword && …}`, deleting the fetch, minting a second cache
  key for the same endpoint, and dropping the submit guard.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers and doc-links all exit
  0, each read by exit code.

**Not exercised: the OAuth-only account.** The seeded user has a password, and the sandbox has no
Google-only account to sign in as, so the `hasPassword === false` branch — the field being *absent*
— is verified by source and by the route's behaviour, not by rendering it. It is the branch that was
working before this change.

**Not on the S25.** A password field in a bottom sheet with the keyboard up is a device check; the
sheet is `max-h-[90dvh] overflow-y-auto`, which is the thing that would be wrong.

<a id="2026-09-01-docs-lb-46-closed-lb-47-filed"></a>

# 2026-09-01 — LB-46 closed by measurement, and it casts doubt on BF-64

**Branch:** `fix/lb-46-card-deload-numbers` · **Domain:** `workouts` · **Lane:** B · **No version bump** (docs only)

## LB-46 was not a bug, and the entry's own caveat was the answer

I filed LB-46 while building BF-64: the AI Prescription card showed `4×5 @ 128.75kg (80%)` for an
exercise I had stored as `3×5 @ 60%` — the *pre-deload* figures under a `Deload session` subtitle. I
recorded it with an explicit caveat that the row was hand-built and might be a shape the engine never
emits, and that this should be settled against production before touching code.

Settled. **The card renders the prescription faithfully.** `reevaluateForToday` self-reverts a
per-exercise deload once the soreness that caused it clears — swapping the `preDeload` values back
in, setting `deloaded: false`, and dropping the `preDeload` block. My fixture had no mood log, so the
reverts fired on the first read. Through the API: `Deadlift: 4x5 @80% deloaded=false pre=none`.

**The tell was on screen and I missed it.** The card suppresses its intensity-zone chip when
`ex.deloaded`, and the chip was showing — so the exercise it was drawing was not deloaded at all.

## The fixture merged two mechanisms production keeps apart

Of **5** stored prescriptions in production: **1** has a session-level `deload: true`, **2** have
per-exercise `deloaded: true`, and **0 have both**.

A **session** deload has its low intensities baked into the LLM's own `pct` values at generation. A
**per-exercise** deload is an overlay applied afterwards, which stores the original in `preDeload`
precisely so it can be undone. Only the second has anything to revert *to*.

One latent inconsistency stays open and is **Lane A's**: `reevaluate` returns
`{ ...prescription, exercises }` and never touches the top-level `deload` flag, so if both were ever
set and the per-exercise ones reverted, the subtitle would read `Deload session` over full-intensity
numbers. n = 5, so "has never happened" is not "cannot".

## And the same measurement questions BF-64, which I shipped four hours earlier

**LB-47.** BF-64's premise, quoted from its entry: *"Every deloaded prescription exercise carries a
`preDeload` block."* True of per-exercise deloads. But those occur when `prescription.deload` is
**false** — and BF-64's override only triggers when it is **true**. On the one real session-level
deload in production, no exercise carries `deloaded`/`preDeload`, so `deloadRevertNames` returns an
empty list and **the override reverts nothing**: exactly the behaviour BF-64 was filed to fix.

BF-64 reused the per-exercise mechanism to implement the session-level one, and the two do not
overlap. Its per-exercise path is correct and does work; what is unproven is the case the owner
actually reported.

**Not reverted, deliberately.** Nothing regressed, the card copy is right, and the mixed case it was
measured against is real in the sense that each half occurs — just not together. LB-47 records the
open question and the three candidate answers, and notes that the honest cheap one is probably to
disable the toggle on a session deload and say why.

## What this session should have done differently

The fixture was built to make an unreachable path testable, which was right. What was missing was
**checking the shape against production before trusting what it rendered** — the same
`db-query` call that closed LB-46 in two minutes was available the whole time, and would have caught
the mismatch before BF-64's verification leaned on it.

## Not exercised

No code changed. Nothing runtime, on device or otherwise.

<a id="2026-09-01-docs-q354-nutrition-tap-gotcha"></a>

# 2026-09-01 — Q-354: the e2e README said the opposite of what was measured

**Branch:** `docs/q354-correct-the-nutrition-tap-gotcha` · **Domain:** `app-shell` / `platform` · **Lane:** B · **No version bump** (docs and comments only)

## Why this was the right thing to do with Q-354

It headed Lane B's READY list, and its own text says **"Recommendation: do not pursue without a
reason"** — touch is the only input the canonical runtime has, touch works, and a rewrite risks it.
An entry that argues against itself sitting at the head of the queue is offered to every session in
turn, which is how it got skipped repeatedly rather than resolved.

So it is now a **`Reference:`** entry: read, not built. `next-item.js` prints it in its own section
and it no longer heads the work list. Lane B's READY count went 7 → 6, and nothing was lost.

## The stale claim, which was worse than a gap

The entry names its real cost precisely: *"a trap for the next spec author"*, and *"the failure gives
no clue"*. So the useful work is signposting, and the signpost was **pointing the wrong way**.

`e2e/README.md` read: *"On Nutrition a real touch sequence does not open the water sheet while a
synthesised `click` event does."* That is Q-309's suspicion, written before anyone measured. It was
measured the same week, in `water-log-write-path.spec.ts`, and came out **reversed**:

| Input | Water sheet |
|---|---|
| `.click()` | never opens |
| `touchscreen.tap()` | opens, first time, every time |
| `dispatchEvent('click')` | opens — the old workaround |

The README was never updated. Someone hitting a dead tap on Nutrition, consulting the file written to
save them from exactly that, would conclude **touch** was broken and reach for
`dispatchEvent('click')` — the workaround that spec deliberately moved away from. A wrong signpost
costs more than no signpost, because it is followed.

Rewritten with the measured direction, the proven cause (the date-swipe `useDrag`; removing
`{...bindDateSwipe()}` makes every input work, and `pointer: { touch: true, mouse: false }` does
not), why it is deliberately unfixed, and the two specs carrying the reasoning inline. The
hydration-race case it used to be conflated with is now its own bullet, with the idempotence caveat
that spec learned the hard way.

## And the spec's own conclusion was superseded

`water-log-write-path.spec.ts` concluded *"the gesture code is not implicated: the failing case never
produces a touch event for `filterTaps` to filter."* That reasoning covers the **touch** path, and
`useDrag` binds mouse and pointer too — which is the path that breaks. Q-354 proved it by removing
the binding.

So Q-309 named the right component by the wrong mechanism, and this note then *cleared* that
component on reasoning that only covered half the binding. Both halves are corrected in place.

## Verification

Nothing executable changed — the diff is one markdown file, one comment block, and a backlog field.
`tsc` clean, `pnpm check:rules` **Ran 67 of 67**, and `next-item.js --lane B` no longer offers Q-354
as work.

## Not exercised

Nothing runtime. This changes no behaviour on any surface, device or otherwise.

<a id="2026-09-01-double-macros-footer"></a>

# 2026-09-01 — the footer that repeated a group's own macros

**Branch:** `fix/bf-98-double-macros` · **Entry:** BF-98 · **Lane:** B · **Version:** v1.418.2

## The report

Owner, with a screenshot: *"the combined item UI doesnt look great with the double macros at the
bottom."* `P 30g C 7g F 5g` twice, stacked, under PRE WORKOUT (BREAKFAST) — once as the Protein
Shake group's own row, then again as the section's totals footer, with the calories doubled too.

**The condition counted the wrong thing.** `meal-card.tsx` gated the footer on `logs.length > 1` —
the **flat** list — so a group of three ingredients passed it. What the footer needs is how many
**rendered** rows there are, which the file already computes as `entries` from `groupDiaryEntries`.
One group is one row.

The rule was already written twelve lines above and applied to the *collapsed* branch: *"a single
row already states its own macros, so a footer would repeat it."* A group is also a single row; the
expanded branch was never told.

`entries.length > 1`, checked against every case: one loose row → no footer (unchanged); two loose
rows → footer (unchanged); one group plus a loose row → footer, correctly, because the numbers then
differ; **one group alone → suppressed**, which is the only behaviour that changes and is the report.

## What is NOT verified, and it is the interesting part

**The duplication could not be reproduced in e2e.** `diary-nested-meal.spec.ts` already seeds this
exact case — one saved meal, three ingredients, alone in its section — and in that fixture the
totals footer **does not render on either condition**. A page-scoped test written against it
asserted the macros appear once and **passed with the fix reverted**, which makes it a guard that
cannot fail. It was deleted rather than kept green.

Measured while diagnosing, with the revert verified in place: `P 24g` renders **once**, `450 kcal`
**not at all**. So `MealTotals` is not rendering in that fixture at all — not in the expanded branch
and not in the collapsed one. What differs between the owner's diary and the fixture is unresolved:
a `savedMeals` map that resolves differently, a meal type carrying other content, or the collapsed
branch being what was photographed. **That question is recorded on the entry rather than closed.**

That first test's own comment had described the duplication as a known fact — *"the meal card's own
totals footer prints the same figures whenever the meal is the only thing in that meal type"* — and
scoped around it. The measurement says that comment is wrong for this fixture. It was left
untouched rather than rewritten on a premise this session could not confirm either way.

## Verification

- **17 unit tests** (10 pre-existing, 7 new): five pinning what `groupDiaryEntries` returns for each
  of the entry's enumerated cases, and two source guards that the card reads `entries.length` and
  that the collapsed branch still reads `logs.length` — a different question with a different right
  answer. **Mutation-checked:** reverting to `logs.length > 1` fails the guard.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers, doc-size and
  doc-links all exit 0, each read by exit code.

**Not exercised: the rendering, and the device.** Both vitest projects run `environment: 'node'`, and
the e2e that would have covered it does not reproduce the case. The owner's screenshot is the only
place the duplication has been seen, so the entry carries `Verify: device`.

## Also: BF-97's lane, measured rather than guessed

BF-97 (a scanned meal still lands as N loose rows) was filed *"Lane: B for the diary rule; A if the
scan write path has to mint the group id."* It does: `app/api/nutrition/scan/route.ts` only
*analyses*, and the write is `logFoodEntries` in **`packages/shared/src/nutrition/log-food.ts`**,
called from `food-logger-sheet.tsx`. That is `packages/shared/**`, and the recommended fix also
needs the diary rule in `components/` — both lanes, so **Lane A, engine half first**. The entry now
says so, so the next implementer does not re-derive it.

<a id="2026-09-01-drop-unused-hr-index"></a>

# 2026-09-01 · Lane A — 21 MB of index for a code path nothing calls (BF-55)

Branch `lane-a/drop-unused-hr-index`. Migration **249**, one `DROP INDEX`. No runtime code changed.

## What it was

`oura_heartrate_user_updated (user_id, updated_at, id)` — migration 130's keyset-pagination index
for `getOuraTimeseriesDelta`, the Track-B restore pull. That method's own doc comment records the
**Q-180** decision to keep it despite having no production caller, on three measured grounds, the
third being that *"it costs nothing at runtime"*.

That was true of the **method**. The index was never in the accounting.

## Measured against production, twice, a day apart

| | |
|---|---|
| `oura_heartrate_user_updated` | **`idx_scan` 0 · `idx_tup_read` 0 · 21 MB** |
| `oura_heartrate_user_id_timestamp_key` (same table) | 47,922 scans · 22.7 M tuples read · 9.7 MB |
| whole database | 84 MB index against 63 MB heap |

So it is a quarter of the entire index budget, on a table that is anything but idle, taking write
amplification on the app's highest-volume insert. It had also grown between the two readings —
18 MB on 2026-08-30, 20 MB, then 21 MB — so the cost compounds while the caller does not exist.

The owner approved the drop conditionally: *"yes if we are not using it and you are sure its
reversible then get rid of it."* Both halves were re-verified here rather than taken from the entry:
`getOuraTimeseriesDelta` is referenced by its own tests, the adapter and the repository interface,
and **invoked by nothing**; the index is a plain btree, one statement over 9.6 MB of heap.

## The correction inside the entry, which is the part worth keeping

The entry opened with *"an index never scanned is a candidate to drop"* and then **falsified its
own rule**. `idx_scan` counts **reads**, not constraint enforcement — a PRIMARY KEY or UNIQUE index
is consulted on every insert to reject a duplicate, and that work never touches the counter.

Three of the four zeros in its first table were constraints. `rr_intervals_pkey` read **0** on
2026-08-30 and **5,034** the next day; `oura_heartrate_pkey` reads 0 today and is the primary key.
Had "never scanned" been applied as a rule, this change would have dropped constraints.

Only one index goes, and the test asserts the survivors by name rather than checking that *some*
index remains.

## The guard that matters is a paragraph, not an assertion

`getOuraTimeseriesDelta` still works without its index — it falls back to a scan, which is fine at
test size and is **not** fine over 87 k production rows. So its existing tests pass either way and
nothing would notice a slow restore until someone investigated one.

The doc comment now carries the `CREATE INDEX` statement and says the driver must recreate it in the
same change. The test asserts the comment is still there, because **a paragraph is the only guard a
not-yet-written driver can have** — and it also pins the retraction, so the "costs nothing at
runtime" sentence cannot quietly return to meaning the index too.

Mutation-tested three ways: removing the `CREATE INDEX` line from the comment, rewording the
retraction, and recreating the index in the database each turn it red.

## Not done

The other half of BF-55 — the ~2.9 MB/day growth against a ~0.4 MB/day expectation — is untouched.
This removes 21 MB and one write-amplification source; it does not explain the trend. At Railway's
$0.15/GB/month the whole database is about three cents a month, so the reason to act is that a 7×
trend compounds, not that the bill hurts.

**Not exercised:** nothing runtime changed, so there is no app or device surface. The `DROP INDEX`
has run against the local dev database via the migration runner, not against production — Railway
applies it on the next cold start.

<a id="2026-09-01-e2e-layout-assertions"></a>

# 2026-09-01 · Lane A — the visual assertions that already existed, and the one flow that had none (BF-91)

Branch `lane-a/e2e-visual-assertions`. One new E2E spec, one README section, one follow-up entry.
No runtime code changed.

## The entry's headline, checked

*"58 E2E specs run at the S25 viewport and assert nothing visual."*

`grep -rl toHaveScreenshot e2e/` returning 0 is true. *"Assert nothing visual"* is not: **21 of the
58** assert layout through `boundingBox`, `stableBox` or computed style. And the four flows the
entry named as needing coverage — BF-73, BF-75, BF-52, Q-406 — have dedicated specs already
(`nutrition-sheet-surface`, `meal-label`, `food-row-shared`), each written around the exact claim
that would otherwise regress.

So the gap is not "nothing looks"; it is "no pixel baselines", and those turn out to be blocked.

## A session cannot generate a baseline CI would accept

`playwright.config.ts` runs the sandbox Chromium at a fixed path because the managed download is
proxy-blocked — its own comment says so. Measured:

| | |
|---|---|
| sandbox binary | **141.0.7390.37** |
| `@playwright/test` | 1.62.1, pinning chromium revision **1234** |
| what CI installs | **151.0.7922.34** |

Ten major versions of font rasterisation and compositing apart. A baseline committed from here fails
on its first CI run and every one after. That is a property of the sandbox rather than of any spec,
so it is split out as **LA-50** with what a CI-side `--update-snapshots` job would actually cost:
Actions write permission, a human approving the first images, and every baseline pinned to CI's
Chromium so a Playwright bump regenerates all of them.

## The flow that genuinely had nothing

BF-73's own `Keep:` records measurements — *"`New` 324×48 filling the row, the bin 48×48"* — and
**nothing asserted them**, so the claim lived in prose while the layout was free to drift back.
`e2e/meal-library-action-hierarchy.spec.ts` pins it: `New` at least four times the bin's width, the
bin square, both on one row, together filling it, and the bin still announcing itself as
`Delete meals` while deleting nothing on tap.

Ratios rather than pixel counts, so a viewport change cannot fail it — only a layout that stops
distinguishing the two controls.

## The assertion worth having, which is about a global rule

Both controls are written `h-11` — **44 px** — and both render **48**, because `globals.css` sets a
bare `button, [role="button"] { min-height: 48px }` that beats the utility. BF-73 found the same
rule in the other direction: `min-h-[84px]` on a `<button>` computes 48, so BF-50's `min-h-[62px]`
tile never applied and measured its content's 60 px instead (LB-32).

That makes the global floor load-bearing rather than incidental. **Mutation-tested: deleting the
`min-height` line from `globals.css` turns two of these tests red** — the buttons silently fall to
44, under this repo's own tap floor, with no class in the diff having changed. A source-level check
would read `h-11` and call it fine.

## Two spec bugs found by running it

The bin renders only when `canSelect={meals.length > 1}`, so a spec that seeds nothing asserts
against a control that is not there. It seeds two meals now, and says why in the comment.

And `getByRole('dialog', { name: /delete/i })` — meant as "no destructive confirm opened" — matched
the library sheet itself, whose accessible name contains the bin's label. It asserts on the data
instead: both meals are still listed after the tap.

## Why not a screenshot, stated once so it is not re-litigated

A baseline proves **change**; someone has to approve the first image, which converts a recurring
check into a one-time one rather than removing it. These assertions can be **wrong on the first
run**. Both halves are now in `e2e/README.md`, next to the existing note that nothing in this
harness touches the S25 — insets render as 0 here, which is the bug class that keeps recurring and
the one no browser test will ever catch.

Verified by `pnpm check:rules` (**Ran 67 of 67**), the full vitest suite, and the E2E spec passing
5/5 with three mutations each turning it red. **Not exercised:** no runtime code changed, and this
harness never touches the device.

<a id="2026-09-01-energy-constants-leaf"></a>

# 2026-09-01 · Lane A — a display constant stops being a copy (LB-43)

Branch `lane-a/energy-constants-leaf`. Four constants moved one file over. No migration, no device.

## The chain, and that it has now broken twice

`daily-energy.ts` → `workout-energy.ts` → `lib/oura-models/constants` → a node builtin. Turbopack
refuses the client chunk and `/nutrition` returns 500. BF-87 hit it wanting `STEP_BASELINE` for a
**line of copy**, and shipped a mirrored `STEP_BASELINE = 3_000` with a test to stop it drifting.

**The same chain broke the same tab before**, in Q-401, through `goal-recommendation` →
`calorie-balance` → `calorie-zone-bar` — with `node:path` rather than `node:fs/promises`. The fix
then was `energy-baseline.ts`, a leaf module holding `SEDENTARY_MULTIPLIER` and importing nothing.

## The entry proposed a new file. The right answer was the one already there.

LB-43 says to move the constants into *"something like
`packages/shared/src/health/energy-constants.ts`"*. It did not know `energy-baseline.ts` existed —
which is understandable, since only `SEDENTARY_MULTIPLIER` lived there and the name does not suggest
step conversions.

Creating the proposed file would have left **two dependency-free leaf modules for one purpose**,
which is precisely the drift the one-formula rule exists to prevent, arriving one level up from the
usual place. The three constants went into the existing module instead, its doc now carries both
incidents, and `daily-energy.ts` re-exports all four so every server-side importer is untouched.

This is the "re-verify the plan against current `main`" rule paying for itself: the entry was
written from a true measurement and a stale assumption about what the repo already had.

## The test that guarded the mirror could no longer fail

`expect(STEP_BASELINE).toBe(SHARED_STEP_BASELINE)` was the whole thing keeping the copy honest. With
one re-exporting the other it is **tautological** — and a test that cannot fail is worse than no
test, because it reads like coverage.

It was replaced with the invariant nothing else checks: **`energy-baseline.ts` imports nothing at
all**, no `import` and no `require`. That is the only property keeping it client-importable, `tsc`
would say nothing if it changed, and it is exactly what broke twice already.

Mutation-tested both ways. Adding an import to the leaf module turns the suite red. Changing
`STEP_BASELINE`'s value does **not** — and that is correct rather than a gap: with one constant,
drift is impossible, and the movement tests derive their fixtures from the constant instead of
restating it.

## Verification

`/nutrition` returns **200** on `pnpm dev` with the client component importing the shared constant,
and the dev log carries no *"chunking context does not support external modules"*. `pnpm check:rules`
Ran 67 of 67. Full suite green.

**Not exercised:** native SQLite, Capacitor, safe-area, the APK path — nothing here touches them.
The 500 was a bundler failure, so the browser render is the real check and it is the one that ran.

<a id="2026-09-01-error-events-prune-refuted"></a>

# 2026-09-01 · Lane A — the prune that was working (BF-93, refuted)

Branch `lane-a/error-events-retention`. No runtime code changed. One retraction in CLAUDE.md, one
regression test, one entry removed.

## What the entry claimed

*"`error_events` does not prune, and every doc says it does."* Searched 2026-09-01: **no
`DELETE FROM error_events` outside tests, no `pg_cron`, no retention trigger.** Corroborated, it
said, by the data — the oldest row was **2026-07-31, 32 days old**, past a retention that supposedly
enforces 30.

It was wrong on every count.

## The prune is in `insertErrorEvent` and has never been absent

`lib/data/postgres/adapter.ts` fires
`DELETE FROM error_events WHERE created_at < now() - interval '30 days'` after each insert,
throttled to once a day by the shared `shouldPrune`. `git log -S` puts it in the **initial public
snapshot**. Nothing regressed; the search missed it.

## The evidence for the finding was the prune working

This is the part worth carrying. The prune fires **from a write path**, not a scheduler — there is
no cron layer, and `retention-throttle.ts` says so in its own comment. So it runs only when a fault
is recorded, and faults are now rare: 5 rows in the last week against 3,324 two weeks ago, after
Q-539's dedupe landed. Between faults the oldest row drifts past the window and stays there.

Measured against production the same day:

| | |
|---|---|
| last write | **2026-08-30** |
| oldest row | **2026-07-31** |
| span | **exactly 30 days** |
| 30-day cutoff computed from the last write | **2026-07-31** |

The oldest row is the cutoff **to the day**. Reading its age against *today* rather than against the
*last write* is what produced "32 days old", and from there the whole false conclusion.

## The expensive part was CLAUDE.md

The finding was written into the file every session reads first, as *"It does NOT prune, despite
what this line said until 2026-09-01"* — so every session after it would have started from a false
model of the fault record, and `lib/export/export-map.ts`'s correct *"pruned at 30 days"* was named
as the thing still to fix. CLAUDE.md is retracted with the measurement and the reason the mistake
was easy to make. `export-map.ts` is untouched, because it was right.

The file also contradicted itself: line 47 kept saying *"on top of the 30-day prune"* the whole time.

## The test, and why it is behavioural

`lib/data/postgres/__tests__/error-events-prune.test.ts` writes a fault and asserts a row past the
window is gone — plus the inverse, that an aged row survives while nothing is writing, which is the
production shape that was misread. **A grep is what failed the first time**, so the guard is not one.

Mutation-tested: removing the `DELETE`, widening the interval to 90 days, and closing the throttle
each turn it red.

## Two owner answers, asked twice

The retention question went to the owner on the entry's premise — *add a prune or delete the claim*
— and came back **"keep forever, fix the docs"**. Once the premise was falsified that answer meant
something else: **deleting a working prune** rather than declining to add one, trading a bound this
database has always had. Put again with the correction, the answer was **leave it alone**.

The approved message truncation (5,780 rows over 1,000 chars, ~39 MB) went the same way. Under a
working 30-day prune those rows age out by themselves and new ones are already capped by Q-539, so
an irreversible `UPDATE` over production buys about one month of 39 MB — roughly half a cent.
**Skipped**, with the owner's confirmation.

**The lesson is not "ask twice".** It is that a question inherits the premise of the entry it comes
from, and an entry can be wrong. Re-verifying the plan against current `main` before building is the
standing rule; this is the case where doing it after asking meant going back.

## What the 52 MB actually is

`error_events` is the second-largest object in the database — and that is **30 days of retained
payload**, not unbounded growth. 12 MB heap, 728 kB index, the rest TOASTed message text. A fact
about how much this app writes when it is failing, not a leak.

Verified by `pnpm check:rules` (**Ran 67 of 67**) and the full suite. **Not exercised:** no runtime
code changed, so there is no app or device surface here.

<a id="2026-09-01-feat-bf-100-scroll-restoration"></a>

# 2026-09-01 — BF-100: back navigation returns to where you were

**Branch:** `feat/bf-100-scroll-restoration` · **Domain:** `app-shell` · **Lane:** B · **Version:** v1.424.0

Owner: *"when I scroll down to a button; then click on it and it takes me to a new page; when I press
back I want to go back to that page at the same scroll level I was at. It usually starts me at the
top of the page. This is on many pages if not all pages."*

## One cause, all pages

The app does not scroll the document — it scrolls an inner container. Next's App Router scroll
restoration operates on the window scroller, so it cannot see, save or restore a nested element's
`scrollTop`, and nothing in the app did it either. Measured before building: `/health` reads 600 on
its container after scrolling, the document reads 0 throughout, and a push-and-back returns 0.

So `lib/hooks/use-scroll-restoration.ts`, called once from `pull-to-sync.tsx` — every screen using
the shell inherits it, rather than 62 separate fixes.

**A tab-to-tab move was never affected**, which took a retraction to establish: the shell keeps every
tab screen mounted, so the container holds its own offset unaided. Measured, with Health's container
still reading 840 while the URL was `/nutrition`.

## Six traps in the implementation, none visible by reading

Every one produced code that runs, does what it says, and achieves nothing:

1. **A `popstate` flag to tell back from forward** — StrictMode's double-invoked effect consumes it
   on the first pass, so the surviving pass always sees `false`. Removed entirely: clearing the entry
   as it is restored gets the same outcome, because a fresh arrival has nothing saved.
2. **Reading `el.scrollTop` in the cleanup saves 0** — React has already detached the node, and a
   detached element reports 0. Tracked from a `scroll` listener instead.
3. **Setting the offset once lands 144–231 px past it** — content keeps arriving above and the
   browser's scroll anchoring pushes the offset down. Re-asserted for the window.
4. **Judging user takeover by comparing the offset to what we set** treats that same settling as a
   finger, so it yielded every time and the re-assert never held. Takeover is an **input event**
   (`wheel`/`touchstart`/`keydown`).
5. **Consuming the saved value on read** — StrictMode again, in a different shape. Pass one takes it,
   finds the container too short, waits; pass one's *cleanup* writes 0 over the pending target; pass
   two reads 0 and discards it. The trace that caught it:
   ```
   [SR] mount /more target 1051 gap 766   <- pass 1 takes 1051, waits for growth
   [SR] save  /more 0                     <- pass 1's cleanup overwrites it
   [SR] mount /more target null gap 766   <- pass 2 finds nothing
   ```
   Read without consuming, clear when the restore lands, never write 0 over an unlanded target.
6. **A screen can come back shorter than it was**, so abandoning the restore drops the user at the
   top — the bug. The window now lands at `min(target, available)`.

**The restore window was not the cause, though it looked like it twice.** Raised to 120 s as a
controlled experiment and the run stayed red, which is what forced the instrumented run that found
(5). The wider value is kept on its own merits; the timer was never the safety mechanism — takeover is.

## Four traps in the spec, which cost more

`e2e/scroll-restoration.spec.ts` took four attempts, and **all four failures reported
`expected 840, received 0`** — indistinguishable, from the summary line, from a broken feature:

- text-matching *Sleep* hits a card that opens a **sheet**, so nothing unmounted;
- `Sleep details →` does the same;
- `a[href^="/health/"]` matches nothing, because these screens navigate from `router.push` buttons;
- driving the push through the bottom nav makes `page.goBack()` land on **`about:blank`**.

`/more` → *Profile details* → back is the verified path. The spec asserts its own preconditions — that
the push navigated, and that something was saved — which is what tells a fixture problem from a
regression, and is why the third and fourth rounds took minutes rather than an hour.

## Verified

`e2e/scroll-restoration.spec.ts` **4 passed** against a cold harness server, and manually against a
warm one: `/more` scrolled to 840 → push → `ta_scroll:/more = 840` → back → **840, exactly**. A fresh
forward arrival still starts at the top.

## Not exercised

- **The S25.** The system back gesture is not the same input as `page.goBack()`, and the WebView's
  scroll anchoring may differ from desktop Chromium's — which matters, because trap (3) was anchoring.
  BF-100 stays queued on `Verify: device`.
- Home (`session-select`) uses the same shell and inherits this, but was not the screen measured.

<a id="2026-09-01-feat-bf-101-recommended-values"></a>

## 2026-09-01 — a Recommended value per goal field, computed rather than generated (BF-101, v1.426.0)

**Branch:** `feat/bf-101-recommended-values` · **Lane:** B

The owner asked for a recommended value under each Profile goal field and assumed it would need a
model: *"id assume we use AI here to choose but maybe we could have some logic to decide so not
using the ai if not needed?"* It does not. `calculateBaseline`
(`packages/shared/src/nutrition/goal-recommendation.ts`) already returns a deterministic figure for
every field on that screen except sleep, and `/api/nutrition-goals/recommend` computes exactly that
baseline before handing it to `generateObject` to *adjust*. The work was plumbing.

### What shipped

- `components/profile/goal-baseline.ts` — assembles the same `BaselineInput` the recommend route
  assembles and calls the same `calculateBaseline`. Returns `null` — not a partial result — when
  weight, height, date of birth, sex, activity level or fitness goal is missing.
- `components/profile/recommended-value.tsx` — the control, in two states. It **offers** the value
  when the field differs and **states that the field matches** when it does not, on exact equality.
- Wired into steps, water and calories on `goal-targets-section.tsx`, and calories, protein, carbs
  and fat in `macro-targets-pane.tsx`. `goals-section.tsx` computes the baseline once and passes it
  down.

### Decisions worth not re-litigating

- **The measured RMR is fetched and carried through.** `calculateBaseline` routes it via
  `personalRmr` (BF-33), so omitting it would have quoted a *predicted* resting rate on a screen
  whose Health card shows the measured one — the same "two numbers for one thing" defect LA-45 and
  BF-99 both closed. Cost: one `GET /api/measured-rmr` on the profile tab, at `TTL_LONG` to match
  the clinical console's existing use of that key (a divergent TTL would fail
  `check-cache-ttl-divergence.js`, and did on the first draft).
- **The matching state is half the feature, not decoration.** The entry was filed on live drift: the
  steps goal held 7,000 — the *sedentary* figure — while the activity level said Moderate, whose
  target is 10,000, and water tracked its own formula correctly. A control that only ever offered a
  value would render those two fields identically.
- **Equality is exact**, deliberately. A tolerance would let "matches" cover a number the formula did
  not produce, which is the claim this control exists to make honestly. Water at 2,600 against a
  computed 2,616 therefore shows the offer, which is correct.
- **Sleep and fiber get no button.** `BaselineResult` carries no figure for either. Both are pinned
  by the guard, because the risk is not a typo but a later session adding "8 hours" for consistency.
- **Tapping goes through the field's existing change handler**, so it behaves exactly like typing the
  number. The goals form has no Save button — it debounce-patches on change — so "fills without
  saving" could not be honoured literally there. The macro pane does have one, and there the fill is
  local until Save Targets.

### Verification

- `components/profile/__tests__/goal-baseline.test.ts` — 14 tests. **Five mutations kill it:**
  dropping `measuredRmr` from the call, removing the completeness guard, a `fetch` in the
  deterministic path, a Recommended control in the Sleep block, a `baselineKey` on fiber.
- `e2e/recommended-goal-values.spec.ts` — drives the real screen: clears the activity level and
  asserts **no** control renders, selects Moderate, puts the steps field on 7,000, taps the offer,
  and asserts the field reads `10000` and the control flips to the matching state — with a request
  listener asserting **zero** calls to `/api/ai*` or `nutrition-goals/recommend` throughout.
  **Five mutations kill it**, including the model call. It passes twice consecutively; the first
  draft passed once and then failed forever, because its own successful run left the goal at 10,000
  — it now drives the field to a known-different value first.
- Full unit suite, `pnpm check:rules` **Ran 67 of 67**, `tsc --noEmit` and lint all clean.

### Not exercised

- **The S25.** Six new controls land inside an already-dense collapsible, and the offer button
  carries two lines at 412 dp. Whether it crowds the fields, and whether the macro pane still reads
  as a form, is unchecked — BF-101 stays in the queue with a `Keep:` line for it.
- Native SQLite / Capacitor paths (none touched), safe-area (no anchored control added), drifted
  production data — the baseline was computed against the local seed, not the owner's real profile.

### Found on the way

- **`main` was red** and not from this branch: the BF-103 guard merged in #773 matches its own
  matcher and its own test name. Confirmed by running the suite against a clean `origin/main`
  worktree. Another session had already opened **#775** to fix it, so this branch merged that in
  rather than duplicating the work.
- **LB-48 filed** — `POST /api/measured-rmr` invalidates nothing and `measured-rmr` is in no cache
  group. Narrow, and stated as measured rather than as the rule implies: both readers revalidate, so
  the cost is one app session of a stale Recommended calorie figure after saving an RMR test, not
  hard staleness. Lane A's, since the fix is a key in `lib/cache-groups.ts`.

<a id="2026-09-01-feat-bf-82-more-page-grouping"></a>

# 2026-09-01 — BF-82: the More page is two groups, not nine

**Branch:** `feat/bf-82-more-page-grouping` · **Domain:** `app-shell` · **Lane:** B · **Version:** v1.419.0

Built §3 and §4 of [`docs/superpowers/plans/2026-08-31-more-page-grouping-and-interaction-model.md`](../superpowers/plans/2026-08-31-more-page-grouping-and-interaction-model.md).

## What was wrong

`MoreRowGroup` is an uppercase 10px heading plus a bordered container. The app had **nine** of them
wrapping exactly one `MoreRow` — seven on the More tab (Profile, Program, Health, Devices, Settings,
Data, About, Admin — Profile arrived with BF-79), one on the Settings sub-screen (`Developer`), and
one hand-written copy in `feedback-section.tsx` that re-implemented the primitive's markup rather
than importing it. Three stacked elements to present one tappable line, nine times over. That is
most of why the screen read as long and empty at the same time.

`goals-section.tsx` was a tenth copy of the same markup — heading and shell hand-written, with an
inline disclosure inside — which is what made an expanding card look like the navigating rows below it.

## What shipped

- **Seven headings → two.** `Your setup` (Profile details · Program · DEXA & RMR · Devices) and
  `App` (Settings · Data & Sync · About · Admin, the last `isAdmin`-gated). Admin sits inside `App`
  rather than keeping its own heading — that is how it became a single-row group in the first place.
- **`MoreRowGroup`'s `label` is now optional.** Omitting it renders the card with no heading, which
  is the supported way to draw one row. `DeveloperSettingsGroup` uses it; it stays a separate card
  because it is admin-only and folding it into the settings block would leave a visibly short card
  for everyone else.
- **`FeedbackSection` is a bottom action**, beside Edit Profile and Sign Out. It opens a sheet rather
  than navigating, so it was never a destination; it is now a ghost button and no longer copies
  `MoreRowGroup`'s markup.
- **`GoalsSection` lost the copied heading** and presents as a card like `StatsGrid` and `TrophyCase`
  directly above it. The bordered shell stays — without it Goals is a bare button among cards. The
  disclosure button, `ChevronDown` and `aria-expanded` are untouched.

## The guard

`components/more/__tests__/more-row-group-arity.test.ts` fails a **labelled** group holding fewer
than two `MoreRow`s; an unlabelled one is a plain card and is exempt by construction. It also asserts
it found at least four groups, because §5 asked for this to be *asserted* rather than read — the
plan's own inventory was wrong by one when read by eye.

**Mutation-verified:** restoring `label="Developer"` on the single-row Developer group turns it red.
This session shipped four guards that could not fail before that became a habit.

## Verified on `pnpm dev`, not on the device

Rendered `/more` and `/more/settings` through Playwright at the Galaxy viewport, signed in as the
seeded user and again with `is_admin` flipped on:

- Headings on `/more`: `YOUR SETUP | APP` — and nothing else. `/more/settings`: none.
- **Destination parity, clicked rather than read** — every row navigates where it did before:
  Profile details → `/more/details` · Sessions, progression & schedule → `/program` · DEXA & RMR
  results → `/more/clinical` · Ring, strap, scale & permissions → `/more/devices` · Notifications,
  appearance & home layout → `/more/settings` · Data & Sync → `/more/data` · TrainingAI v… →
  `/more/about`. Admin Console (with its pending badge) renders inside `App` for an admin and is
  absent otherwise; `Device consoles & diagnostics` renders on the settings sub-screen with no
  heading above it.
- Goals expands (`aria-expanded` false → true, fields visible), Report an Issue opens the feedback
  sheet, Edit Profile opens its sheet.

**Not exercised:** the S25 itself, which is where *"reads as long and empty"* was diagnosed and the
only place the result can be judged. Safe-area insets render as 0 in the sandbox and the bottom
actions row moved, so the spacing under Sign Out is unverified on-device. `BF-82` stays queued with
`Verify: device`.

## The "sliders" question — asked and answered, no control change

The plan deliberately made no control decision, because the owner's *"some items could be changed
from sliders to text or buttons etc."* did not match the screen: there are no sliders on it. Asked
directly on 2026-09-01, and the answer was that the word was loose — *"yes it wasnt the sliders
specifically; more that its messy and needs re'organisation."* Which is what this PR does, so
**nothing changes and no follow-up entry is owed.**

Worth recording because it is what stops the next session acting on the original wording: More and
its six sub-screens carry **no slider and no `<select>` anywhere**, measured by rendering each one
and enumerating its controls. The value controls are typed number boxes (goal targets, birth year,
height, the clinical figures); activity level and fitness goal are already roving radio-button
groups; the five Settings toggles are `Switch`es over booleans, where a switch is correct. The one
`input[range]` in the whole tree is the accent-colour hue picker, which is a hue and wants a slider.

## Filed while here

**LB-44** — `scripts/__tests__/dead-repo-methods.test.ts` writes a real `lib/zz-dead-repo-methods-probe.ts`
and deletes it, so any concurrent test that walks `lib/` and reads every file can list it and then
fail `ENOENT` reading it. It fired on this branch's full-suite run in
`lib/media/__tests__/no-data-url-fetch.test.ts` — a file unrelated to the diff, with a message that
reads like a missing source file. Both pass alone. Lane A, since the fix is under `scripts/`.

<a id="2026-09-01-feat-la-45-corrected-body-fat-display"></a>

# 2026-09-01 — LA-45: the screens now show the DEXA-corrected body fat

**Branch:** `feat/la-45-corrected-body-fat-display` · **Domain:** `body` / `app-shell` · **Lane:** B · **Version:** v1.420.0

## What was wrong

BF-2 step 4 shipped the engine: `/api/body-metadata` and `/api/day-log` carry `bodyFatCorrected` and
`bodyFatIsCorrected` per reading, and `body-metadata` returns `bodyFatCalibration` once per response.
**Nothing read any of it.** Every screen rendered `bodyFat`, the raw scale value — while the calorie
goal, the protein dose and `personalRmr` were already computed from the corrected one. Two numbers
for one measurement, with nothing on screen to say which was which, which is worse than neither being
corrected.

## What shipped

`components/health/body-fat-display.ts` holds the display rule in one place: `displayBodyFat`,
`isCorrectedReading` and `correctedSpan`. Seven surfaces now use it — the Health body-fat card, its
metric sheet, the lean-mass/BMR derivations, the BMI classification, the day-detail body row, the
week-day sheet's chip, More → Profile details, and the Goals card.

**Two invariants the module exists to hold, both easy to get backwards:**

- **`bodyFat` stays the value the log sheet seeds from.** `openLog` POSTs it back at source `manual`,
  which outranks `scale_ble` — so a corrected number round-tripped through the edit sheet would
  overwrite the measurement permanently and collapse the next calibration toward zero. Seed raw,
  display corrected.
- **"Corrected" is never inferred from the two values differing.** An offset can round to zero, and
  "corrected by 0.0" and "not corrected" are different claims. `bodyFatIsCorrected` is the only
  source for it.

**The card says why its number differs from the scale.** `DEXA-corrected +3.2% · 1 scan compared` —
the offset, because the owner asked to see it, and the pair count beside it, because at one pair this
is one comparison and not a settled calibration. On a window mixing instruments it adds
`3 of 4 corrected — earlier readings are on another instrument`, so the real step at the changeover
is explained rather than drawn.

**The local seed no longer clobbers the correction.** `health-content.tsx` runs the local-store read
and the network fetch concurrently and both write `setMetaRecent`; a local row carries the raw
reading and no calibration, so whichever landed second won. The seed now carries the correction
forward per date. Without it the number would have flickered back to the scale's value on the APK —
invisible here, since `getLocalStore` returns null on web.

**`app/health/health-sections.tsx` crossed 800 lines**, so the body-fat card moved to
`components/health/body-fat-card.tsx` — the rule for that hotspot is extract, not append. It is
**deliberately not `memo`'d**: `openLog` is re-created on every render of the orchestrator, so a memo
could never hit, and a wrapper that cannot fire reads as optimised to everyone after you. The
extraction also took `health-sections.tsx` from 50 hex literals to 43 and the new file to 2 — net −5,
because five repeats of the card's rose folded into one constant. Both baselines moved in the diff.

**`check-body-fat-correction.js`**: `health-sections.tsx`'s exemption is gone, as LA-45 asked. The
check now counts an import of `body-fat-display` as handling the correction, alongside
`body-fat-calibration` — a screen consumes a value some route already corrected, which is the only
way it can work, since correcting client-side would need the calibration on the device.

## The guard, and what killed it

`components/health/__tests__/body-fat-display-sites.test.ts` pins all six display files to the
helper, pins `openLog` to the raw field, and unit-tests the rule.

**Every assertion was mutation-verified — eight mutations, eight failures.** Reverting each display
site to the raw field turns its case red, and making `openLog` seed the corrected value turns the
inverse case red. One mutation nearly slipped: `body-fat-card.tsx` calls `.map(displayBodyFat)`
point-free, so the first sweep did not rewrite it and the guard "passed" on an unmutated file. It was
re-mutated properly (`.map(r => r.bodyFat)`) and does fail. **A mutation that does not change the
file is not a mutation** — that is a new shape of the same trap this session hit four times.

The file assertions read stripped source: comments in these files name the raw field constantly,
explaining why it must stay raw, and a guard matching prose is the failure mode already on record.

## Verified on `pnpm dev` against a fixture that exercises the real path

The seed has no DEXA scan and no `source_map`, so out of the box every reading returns
`corrected: false` and the whole feature is unreachable. Seeded locally: one DEXA at 21.2% on
2026-08-25, `scale_ble` provenance on the four newest readings and none on the older ones, giving
`offsetPct 3.2 · pairCount 1` and a genuinely mixed window.

- Payload: `2026-08-31 raw 18.1 → 21.3 corrected true`, `2026-08-29 raw 17.6 → 17.6 corrected false`.
- Health card: **21.6%**, `DEXA-corrected +3.2% · 1 scan compared`, `3 of 4 corrected`.
- **The log sheet seeded `18.4` while the card showed `21.6`** — the invariant that would otherwise
  destroy the measurement silently, checked on the running app rather than by reading.
- Metric sheet: 21.2 / 17.6 / 21.3, matching the card it opens from.
- Day detail 2026-08-31: `Body fat 21.3%`. More → Profile details and the Goals card: `21.6% · Today`.
- Lean mass 63.6 kg from 80.8 kg at 21.3% — the corrected figure, so the panel agrees with the goal.

## Not exercised

- **The S25.** Nothing here is device-verified. The local-seed fix in particular is only reachable
  on the APK, since `getLocalStore` returns null on web — the exact class where "works locally" has
  been wrong before.
- **The week-day sheet's `% BF` chip** did not render in the browser: reaching it needs a tap on the
  Home week strip that the harness could not drive. The change is a one-line swap covered by the
  source guard and the typecheck, but it was not seen.
- **The local dev database now holds a fabricated DEXA scan** (2026-08-25, 21.2%) and `source_map`
  stamps added by hand, so LA-45's path stays testable. It is fake, like the rest of that seed.

<a id="2026-09-01-feat-q-187-plan-rescale"></a>

## 2026-09-01 — the meal plan recalculates against what was actually eaten (Q-187, v1.428.0)

**Branch:** `feat/q-187-plan-rescale` · **Lane:** B

The owner, in the sentence Q-187's first four steps deliberately held back: *"then as you input your
actuall food it can recalculate food based on the macros left. I.e if you eat too much during lunch
it will cut some portions for other meals or vice versa."* The gate was opened and answered the same
day — *"Happy to spread or take it out of next meal: would be nice to have the option; but if
choosing one then spread is fine"* — so this is spread, at read time, with a floor.

### What shipped

- **`components/nutrition/plan-rescale.ts`** — `rescaleRemaining` returns the adjusted figures for
  the meals still to come, plus one sentence when the floor binds. `remainingMeals` is the set it
  acts on.
- `plan-meal-row.tsx` renders the adjusted figure with `(planned N)` beside it; `meal-plan-section.tsx`
  computes the re-scale and renders the sentence.

### The entry pointed at the wrong set, and it is the opposite one

Q-187 said `fillableMeals` *"already answers which meals are still ahead of you, which is exactly the
set a re-scale would act on."* It answers which meals are **due enough to log now** — on today it
keeps meals whose hour has already **come** (`hour <= nowHour`), because logging food you have not
eaten is the thing it exists to prevent.

A re-scale wants the complement: what you have **left** to eat, with hour not entering at all. A
lunch you skipped past is still food you might have, and dropping it from the remaining budget would
silently hand its calories to dinner. `remainingMeals` is unlogged-and-undeclined, full stop, and the
guard pins the distinction.

### Decisions

- **Read time, never stored.** The plan stays what the owner chose; deleting the module restores
  today's behaviour exactly. A stored rewrite loses the original plan and would be Lane A's.
- **The floor is per meal, not all-or-nothing.** A meal whose scaled figure falls under 250 kcal is
  left as planned and counted in the sentence; meals that clear it are still adjusted. Printing
  *"eat 180 kcal for dinner"* is what makes a plan ignored once and then always.
- **Macros ride the meal's own factor**, so a meal keeps the split the plan chose for it. Scaling
  each macro against its own remaining budget would let a day that went over on fat alone quietly
  rewrite every meal's shape.
- **The planned figure stays on screen** beside the adjusted one. Replacing it outright would make
  the plan look as though it had changed, and it has not.
- **Four scalar props, not one object.** `PlanMealRow` is `memo`ed and rendered in a `.map()`, where
  a fresh `{ calories, … }` literal defeats the memo silently while the component keeps its wrapper —
  the shape `check-memo-prop-stability.js` exists to catch. `meal-macro-bars.tsx` is the reference.
- **Nothing is logged.** The prefill's property is that nothing enters `food_logs` unconfirmed; this
  changes what is *suggested*. A guard asserts the module contains no `fetch`, `queueMutation`,
  `upsert`, `localStorage` or `setCached`.

### Verification

- `components/nutrition/__tests__/plan-rescale.test.ts` — 16 tests. **Ten mutations kill it:**
  next-meal-only instead of spread, no floor, re-scaling a past day, ignoring declines, macros not
  riding the factor, a `fetch` in the module, the card never calling it, the note not rendered, the
  today gate dropped, and the scalars replaced by one object prop.
- **One of those mutations initially survived and the guard was wrong, not the code.** The wiring
  assertion matched `/rescaleRemaining\(\{/` anywhere in the file, so
  `const rescale = null && rescaleRemaining({…})` passed it — the text is present while the feature
  is dead. Re-anchored on the assignment, which kills both that and deleting the call outright.
- **Driven on the real screen**, because both vitest projects run in `environment: 'node'` and
  nothing renders there. A plan and a logged meal were inserted into the local database and the
  Nutrition tab opened. All three states observed:
  - **900 of 2,000 eaten** → Breakfast **330 (planned 600)**, Lunch **385 (planned 700)**, Dinner
    **385 (planned 700)**. They sum to **1,100**, exactly the remaining budget.
  - **1,900 of 2,000** → nothing adjusted, rows show planned figures, and the card reads *"Only 100
    kcal left, which is under a meal — the remaining meals are left as planned."*
  - **2,400 of 2,000** → *"You're 400 kcal past today's target, so the remaining 3 meals are left as
    planned."*
  The fixtures were removed from the local database afterwards.
- `pnpm check:rules` **Ran 67 of 67**; `tsc --noEmit` and lint clean.

### Not exercised

- **The S25.** Two numbers now share a line that held one, at 412 dp.
- **There is no committed e2e, and the reason is worth recording: `scripts/local-db/seed.sql`
  creates no meal plan and no food logs**, so every plan-card behaviour is unreachable from the
  harness — not just this one. Filed as **LB-51** with the shape that would work without touching
  the seed (which is Lane A's) and with the gotcha that cost the most time here: the expand toggle
  needs `touchscreen.tap()`, because a forced `.click()` leaves `aria-expanded` at `false`. That is
  Q-354 on the Nutrition screen, and it is exactly what `e2e/README.md` records for the water sheet.

### Deliberately not built

The owner's *"would be nice to have the option"* — spread vs next-meal-only as a preference. Q-187
says to file it only once spread has been lived with and found wanting in a specific way, because
that way decides where the control lives and what it defaults to. A preference shipped alongside the
behaviour it toggles has no evidence behind either branch. It is recorded on the entry's `Keep:` line
rather than as a queue item.

<a id="2026-09-01-fix-bf-103-my-foods"></a>

# 2026-09-01 — BF-103: one label, `My Foods`, on every surface

**Branch:** `fix/bf-103-my-foods-one-label` · **Domain:** `nutrition` · **Lane:** B · **Version:** v1.425.0

Owner: *"can we change Meals to → My foods, so we can have meals + singular items saved."* Then,
deciding it the same day: *"no I'm happy to rename Saved to → My Foods. the issue was having saved +
MyFoods. we only need one. lets go with MyFoods."*

## Why the owner's version is better than the entry's

The entry originally proposed `Saved` for the tab with `My Meals` left on the page button — a
*second* name, which is the thing that caused the trouble in the first place. **The historical
failure was never the wording; it was two labels for one list.** One name cannot be confused with
itself.

It also describes the contents more honestly: of the owner's 10 saved meals, **5 contain exactly one
item**, saved as one-item meals because that was the only shelf available. The label had been
mis-describing the list.

## The sweep, and the two comments that would have undone it

Eight files carry the user-visible strings — tab, page button, toast (both arms), picker hint and
empty state, two plan buttons, and a badge, an action and an **`aria-label`** on the plan row. A
rename that skips the aria-label leaves a screen reader saying a name the screen no longer uses.

**BF-37 and BF-60 both removed `My Foods`**, and their comments read as a standing prohibition:

- `nutrition-action-row.tsx` — *"`My Meals`, not `My Foods` (BF-37)."*
- `saved-meals-sheet.tsx` — *"`My Foods` against `My Meals` is the pair the owner could not tell
  apart."*

Both were solving *two labels differing only in their last word*. Unifying satisfies that reasoning
rather than contradicting it — but left as they were, the next session reverts this on their
authority. Both rewritten in the same PR, saying so.

## The guard found four surfaces the entry did not enumerate

`components/nutrition/__tests__/one-saved-list-label.test.ts` fails on any user-visible `My Meals`,
reading comment-stripped source so the two history-quoting comments do not trip it.

**It immediately caught what the entry's own file table missed: `e2e/` specs clicking a button named
`My Meals`.** Not four — **twelve files**, including aria-label lookups, an `In My Meals` assertion
and a `Save all N to My Meals` regex. A rename that leaves its tests asserting the old label breaks
CI on the next run rather than at review. All swept.

**Four mutations, four failures:** reverting the page button, reverting the tab label, missing *only*
the aria-label, and re-merging the tab strip.

That last one guards a different mistake. **`My Foods` was once the name of a merged list** (v1.382.0),
split back three versions later because a recipe and a single ingredient in one list made "log this"
mean two different things. **That revert was about the merge, not the name.** An implementer who reads
"My Foods" and re-merges the tabs reintroduces a defect the app already paid for, so the guard pins
the strip at `Recent · My Foods · Search`.

## Verified on `pnpm dev`

The Nutrition page button reads `My Foods`; the sheet it opens shows `Recent · My Foods · Search`;
neither the page nor the sheet contains the string `My Meals` anywhere.

## Not exercised

- **The S25.** A label change is low-risk, but `My Foods` is two characters longer than `Meals` in
  the tab strip, and three tabs share that width. Whether it wraps or truncates at 412 dp is unchecked.
- The changelog's historical entries still say `My Meals`. Left alone deliberately — they describe
  what shipped at the time, and rewriting them would make the record wrong.

<a id="2026-09-01-fix-bf-99-base-label"></a>

# 2026-09-01 — BF-99: the line said "base" and showed base minus the goal deficit

**Branch:** `fix/bf-99-base-label` · **Domain:** `nutrition` / `body` · **Lane:** B · **Version:** v1.423.0

## The bug was the word, not the arithmetic

The owner, with a Health screenshot: *"why is my base rate under the 1350 RMR value."*

`budgetProvenance().base` is `restingBaseKcal + targetNetKcal` — the resting base with the **goal
delta already folded in** — and the line printed it beside the word *base*. On a recomp that is
~200 kcal below his measured RMR, so a goal choice was presented as a metabolic fact and he went
looking for a broken calculation. **Every number on that screen reconciled.** That is what made this
worth fixing rather than explaining: correct maths described incorrectly sends someone hunting for a
bug that does not exist.

## What changed

The line separates the two and they still sum to the same budget:

- Recomp: `1,972 base − 200 for your goal + 1 earned from movement`
- Lose weight: `1,972 base − 500 for your goal + …`
- **Maintain: `1,972 base + 1 earned from movement`** — no goal clause, because the delta is zero and
  *"+ 0 for your goal"* is noise. That is also BF-99's own check: a maintain user sees the same number
  under both wordings.

Split in the component, **not in `budgetProvenance`** — that is shared, and a single combined number
is the right answer for a caller that wants one. `restingBaseKcal` and `targetNetKcal` were already
props here; nothing new is computed.

**Neither the floor nor the goal maths was touched**, as the entry warns. `restingBaseKcal` is
`Math.max(Math.round(bmr), …)` on both branches, which is what stops a base falling below measured
resting metabolism; the displayed figure was below 1,325 only because the deficit is subtracted after
the floor, which is also correct.

## The second half of his question, which was unanswered anywhere on screen

The measured RMR is **re-scaled, not used raw**: 1,325 was measured at 51.5 kg of lean mass and he
carries ~50.6 kg today, so his personalised figure is ~1,304. That is `personalRmr` doing exactly
what BF-42 built it for — and nothing told him, so a measurement he paid for looked ignored.

The measured-RMR form is the only place the number appears, so the line goes there, under the
fat-free-mass field: *"The app works from this test re-scaled onto your current lean mass, not the
number as entered, so the resting rate it uses day to day drifts a little above or below it as your
body composition changes."* The field's own hint says why the input is needed; this says what the app
then does with it.

## The guard

`components/nutrition/__tests__/base-label-reconciles.test.ts`. It pins the specific regression —
destructuring `base` off `budgetProvenance` and printing it beside the word — and, more usefully,
that **what the line prints still sums to the bar's own budget** across four goal shapes. A screen
that contradicts itself is the failure the old label was a symptom of.

**Two mutations, two failures:** restoring `budgetProvenance().base` as the printed base, and dropping
the goal-delta clause. Assertions read comment-stripped source, since the comments quote the old
wording while explaining the bug.

## Verified on `pnpm dev`

Rendered `/nutrition` with the seeded user's goal set to `recomp`, `lose_weight` and `maintain` in
turn — the three wordings above, measured rather than reasoned. The RMR copy renders on
`/more/clinical`.

## Not exercised

- **The S25.** The line is denser by a clause and Home's copy of the bar is `compact`, so whether it
  wraps at 412 dp is unchecked — insets and text metrics are the sandbox's weakest ground.
- **The owner's actual numbers.** The entry's reconstruction (1,565 · 1,264 · 163 over) is arithmetic
  against live production values and it says so; this fix relabels what the component already holds,
  which is true regardless of whether that reconstruction is right in every step. The seeded figures
  here are the local database's, not his.

<a id="2026-09-01-fix-deload-full-override"></a>

# 2026-09-01 — BF-64: `Full · Override` now overrides something

**Branch:** `fix/deload-full-override-actually-reverts` · **Domain:** `workouts` · **Lane:** B · **Version:** v1.422.0

## The bug

The owner, on the Pull pre-workout screen: *"pressing full or deload doesnt change the
'prescription' not sure if its over writing it."*

It was overwriting in one direction only. `session-data.ts` applies the deload override inside an
`else if` that runs **only when the prescription's exercise is not already deloaded** — so the
pipeline could ADD a deload and never remove one:

| Prescription | Toggle | What ran |
|---|---|---|
| full | Deload | deloaded — the override lands (Q-109/Q-175 built this) |
| deload | Deload | deloaded |
| deload | **Full** | **still deloaded — nothing un-deloaded it** |

Meanwhile the toggle rendered `Full · Override`, because `prescribedDeload` is derived from the live
prescription. The word **Override** is the app stating it will override the prescription. It did not.
That is worse than BF-8, which it descends from: BF-8 was the toggle *disagreeing* with the card;
this was the toggle *offering a control that does nothing*.

The tell was the picker directly below it. `SessionDurationPicker` POSTs `/prescribe` and regenerates;
`DeloadToggle` set local state that only re-keyed a cache. Two controls side by side, one wired to the
engine and one not — and the prescribe route takes no intensity input at all
(`PrescribeBodySchema` is `excludeSessionId` + `durationPreset`), so intensity had no server path even
in principle.

## The fix, which the entry had already argued for

Session-level `Full` is the **per-exercise revert applied to every deloaded exercise**. The machinery
was already built and already on the device: each deloaded prescription exercise carries a `preDeload`
block, `session-data.ts` unpacks it into `preDeloadStyle`/`preDeloadSets`, and `applyDeloadReverts`
already reverted one exercise at a time from `DeloadInfoSheet`. No LLM call, no 429 budget, works
offline. A `/prescribe` round-trip would have cost a rebuild to reach numbers already in hand.

Three rules were extracted to `components/workout/utils.ts` — partly because `workout-screen.tsx` is a
shrink-only hotspot where the rule is *extract, do not append*, and partly because they are what the
guard needs to reach:

- **`isFullOverride`** — keyed on the **explicit choice**, never `deload === false`. `deload` seeds
  false and only adopts the prescription in an effect, so on first render it is false while the
  prescription is a deload and the user has chosen nothing. Keyed on `!deload`, the revert would paint
  full weights for a frame and snap back.
- **`deloadRevertNames`** — the union of the user's per-exercise reverts and, under an override, every
  deloaded exercise with pre-deload numbers.
- **`deloadOverrideBlocked`** — the deloaded exercises it could **not** revert. `preDeload` is
  optional, so those stay deloaded, and the card names them. Reverting most and silently leaving two
  is the failure this fix would otherwise have introduced while fixing the first one.

**1RM accounting follows without a separate change, and that is design rather than luck:** the revert
clears `deloaded`, `handleLogSet` already reads the reverted array, and `deload` is false under an
override — so a reverted exercise runs full weights and counts, and one that could not revert does
not. `fix/deload-provenance-and-previous-1rm` fixed a bug in this exact area before, so it is live.

The card gains `· Full override on` and a block naming the blocked exercises. **The card's heading was
not changed to match the toggle** — the prescription is still a deload; the session running is not,
and both are true.

## The guard

`components/workout/__tests__/deload-full-override.test.ts`, 11 tests. **Five mutations, five
failures:** keying the override on `!deload`, reverting exercises with no pre-deload numbers, applying
the override when it is off, dropping the blocked-exercise list, and — the data-corrupting one —
making `applyDeloadReverts` stop clearing `deloaded`.

One assertion was wrong on the first write and the test caught it: `estimateOneRm` returns
`estimated1rm: 0` for a deloaded exercise, not `null`. Asserted against the real function afterwards.

## Verified on `pnpm dev`, against a hand-built fixture

The local seed has **zero `session_periodization` rows and no `ai_dynamic` program**, so the toggle
does not even render and the whole path is unreachable out of the box. Seeded: an `ai_dynamic`
program, an `auto_applied` deload prescription on the session the scheduler actually offers, with two
exercises carrying `preDeload` and **one deliberately without** — the blocked case.

| State | Result |
|---|---|
| Nothing chosen | No override notice; 3 `Deload` badges. **The first-render flash guard holds.** |
| `Full` chosen | Card: `Deload session · ~45 min · Full override on`, and *"Most exercises are back to their pre-deload weights and sets. Bicep Curl stays deloaded — the prescription did not record full numbers for it, so its sets will not count toward your 1RM."* Deadlift and Lat Pulldown lose their badge; **Bicep Curl keeps it.** |
| `Deload` again | Notice gone, all three badges back. |

## Filed while here

**LB-46** — the expanded prescription card rendered `4×5 @ 128.75kg (80%)` for a stored exercise of
`3×5 @ 60%`, i.e. the *pre-deload* figures under a `Deload session` subtitle. **Attribution measured:
it reproduces on `main`** with the same row, so it is not this change. **But the row was hand-built**,
so it may be a fixture shape the engine never emits — the entry says to settle that against a real
production prescription before touching any code.

## Not exercised

- **The S25.** Nothing here is device-verified, and the entry scopes its verification to the device
  outright. What was checked is the revert, the blocked-exercise wording and the badges on a
  fabricated prescription; what was not is a real AI-dynamic day, and **completing a set under each
  toggle position to see the 1RM actually count or not** — which is the half that corrupts data.
- The reverse case (a **full** prescription with `Deload` picked) was not re-exercised. It is
  untouched by this diff — the `else if` it runs through is unchanged — but untouched is not tested.

<a id="2026-09-01-fix-device-console-ia"></a>

# 2026-09-01 — Q-531: the device consoles have one home, and the page is a runbook

**Branch:** `fix/device-console-ia` · **Domain:** `app-shell` / `devices` · **Lane:** B · **Version:** v1.421.0

## The correction that changed the work

The entry's **hard half was already satisfied and nobody had checked.** It reads as though the three
device consoles needed moving back behind `/admin` with a `requireAdmin` guard. They were already
there: `/admin/oura-ble`, `/admin/cadence` and `/admin/data-capture` are routed under `/admin` and
every one calls `isAdminUser` and redirects. **Q-234 moved the LINKS, not the routes.**

Which reframes the owner's report. *"It was moved away from the admin section = bad"* was literally
true of the navigation and literally false of the routing — they went to `/admin`, and the consoles
were not listed there, so they concluded the consoles had left. That is a reachability defect, not an
access-control one, and it needed the opposite fix from the one the entry proposed.

This is the "re-verify the plan against current `main`" rule paying off. Implementing the entry as
written would have been a no-op dressed as a security fix.

## What shipped

- **`/admin` grew a `Devices` tab** listing the three consoles. The owner's instinct about where to
  look was right; the app was wrong.
- **`/admin/oura-ble` is in runbook order.** It was fourteen consoles stacked in the order they were
  written — *"everything is spread out sporadically"*, one page down. Six numbered sections now
  follow §4 of [`oura-ble-operations.md`](../oura-ble-operations.md): **1 Before you start** ·
  **2 Drain & re-sync** · **3 Verify what landed** · **4 Validate against a reference** ·
  **5 Feasibility probes** · **6 Maintenance & corrections**. Each carries a one-line *when you'd be
  here*, because a console's title says what it reads and never says when to read it.
- **Settings → Developer lost its device rows.** Diagnostics — error log, AI usage, day review —
  stay, because those are about the app rather than a device. Two homes was the grievance.
- `components/admin/console-section.tsx` is the heading, since six of them is a pattern.

**Nothing moved routes, so this is Lane B alone** — which is what the entry's own lane rule says.

## What the guard pins

`app/admin/__tests__/device-console-access.test.ts`, and it pins the owner's requirement rather than
my layout: *"it should be behind the admin portal — as regular users should not be able to touch
it."* Nothing asserted that, and the shape that had already decayed once — links in one place, guard
in another — is exactly the shape that decays silently.

1. Each console page calls `isAdminUser` and redirects. **Hiding a page is not gating it.**
2. `/admin` lists all three (reachability, the actual defect).
3. Settings → Developer lists none of them (one home).
4. **Q-544 survives the re-ordering:** `DbFootprintCard` and `DeviceMetricsPanel` stay above
   `OuraBleDebug`. They read the server only, so they answer on a desktop — and inside `OuraBleDebug`
   they were reachable only from the APK, the one client a `VACUUM FULL` blocks, and unreachable at
   all while the APK is broken, which is when a full volume is most likely. Introducing sections made
   this newly easy to break by tidying.
5. The section numbers are ascending and unique.

**Five mutations, five failures.** Removing the gate from `/admin/cadence`, un-listing a console from
`/admin`, re-adding a device row to Developer, moving `DbFootprintCard` below `OuraBleDebug`, and
renumbering a section out of order each turn it red. Assertions read stripped source: these files
quote the route paths in comments while explaining the history, so a raw-source match would pass on
prose.

## Verified on `pnpm dev`

Signed in with `is_admin` flipped on, then off, against the local database.

- `/admin` shows the `Devices` tab; all three rows navigate to `/admin/oura-ble`, `/admin/cadence`
  and `/admin/data-capture`.
- `/admin/oura-ble` renders the six sections in order.
- Settings → Developer shows `DIAGNOSTICS` and no device row.
- **As a non-admin, all three consoles and `/admin` itself redirect to `/`** — the owner's stated
  requirement, checked rather than assumed.

## Not exercised

- **The S25, and here that is most of the value.** The entry says so outright: *"Verification:
  device-only."* Every console below step 2 needs the native plugin, so what was checked is the
  page's structure and its gating, not one drain. **The flow itself is unverified**, and whether the
  runbook order matches what the owner actually does is a question only walking it can answer.
- Safe-area clearance on the re-sectioned page; insets render as 0 in the sandbox.

<a id="2026-09-01-fix-la-52-windowed-walk-speed"></a>

## 2026-09-01 — the walk pacer reads speed now, not the whole walk (LA-52, v1.427.0)

**Branch:** `fix/la-52-windowed-walk-speed` · **Lane:** B

`appendPoint` set `currentPaceSecPerKm` from **cumulative** distance over **cumulative** elapsed, and
`walk-active.tsx` fed `kmhFromPace(currentPaceSecPerKm)` straight into `readPacer`. So the speed
rung's input was the average speed of the whole walk. Three consequences, all of which LA-52 states
and none of which a passing test could see.

### What shipped

- **`windowedSpeedKmh(points, windowSec = SPEED_WINDOW_SEC)`** in `lib/walk/walk-pacer.ts` — distance
  over elapsed across the last 20 s of `rawPoints`. Null under two points or a zero span, which drops
  the pacer to the heart-rate rung rather than reading zero and announcing "Stopped".
- **`recentSpeedKmh`** on `useGuidedWalkStore`, recomputed on every appended point.
  `currentPaceSecPerKm` is untouched and stays cumulative — the summary derives from `rawPoints`
  directly, so nothing there moved.
- `walk-active.tsx` feeds `recentSpeedKmh` to `readPacer` **and** to the big km/h readout.

### The half the entry did not name

**The on-screen km/h was the average too.** It came off the same `currentPaceSecPerKm`, under a
comment claiming *"Both come off the one pace series — there is no second computation."* So a walker
reading `4.8 km/h` mid-walk was reading their average since starting. That is now live, and the
min/km beside it is labelled **`avg`**. Two numbers side by side with nothing saying which is which
is how the cumulative one came to be trusted as "now" in the first place.

### Decisions

- **20 s.** Shorter and a single wandering GPS fix swings the band; longer and the reading stops
  being *now*. LB-36's device check asks for movement within ~10 s, and a 20 s window has moved most
  of the way there by then.
- **A sparse fix rate reaches back past the window rather than going null** — an absent speed
  silently demotes the whole rung to heart rate, which is the worse failure.
- **It reads the points and nothing else.** A wall clock would decay the figure toward zero while the
  walker stands still producing no fixes — right when they have stopped, wrong in a tunnel — and the
  store only recomputes on a new point anyway. A GPS dropout therefore freezes the reading, exactly
  as it already froze the cumulative one.
- **`BAND_TOLERANCE` untouched**, per the entry: widening it treats an inert signal as a noisy one
  and would make the cadence rung worse in the same move.

### Verification

- `lib/walk/__tests__/windowed-speed.test.ts` — 11 tests. Every movement case walks at one speed and
  then changes it, because a test that never changes effort mid-walk cannot see this defect.
  **Eight mutations kill it:** reverting to the cumulative reading (5 of 11 fail), returning 0 instead
  of null, dropping the sparse-fix reach-back, measuring elapsed from the walk start, widening the
  window to 10 minutes, putting the screen back on `kmhFromPace`, stopping the store recomputing, and
  removing the `avg` label.
- The suite asserts the old reading's behaviour too, computed the same way the store computed it:
  after 20 min at 5 km/h and 30 s at 2, the cumulative figure is still **above 4.9**, and after 30 s
  standing still it is still **above `STOPPED_KMH`**. The finding is asserted, not described.
- **`e2e/walk-pacer-speed-rung.spec.ts` asserted the two readouts were one number in two units**, and
  that claim is now false by design. Updated in the same PR: the `avg` label is the assertion, and
  the unit agreement moved to the fixture, which can hold effort constant. All 3 specs pass.
- `pnpm check:rules` **Ran 67 of 67**; `tsc --noEmit` and lint clean; the 9 walk/store/guided-walk
  suites are 102 green.

### Not exercised

- **The device, which is the whole point.** Slowing deliberately mid-segment and stopping at a
  crossing are LB-36's device checks 2 and 3 — they could not have passed before this and are still
  unverified. LA-52 stays in the queue with a `Keep:` line for exactly that.
- Real GPS: every case here is a synthetic track. Fix jitter, dropout and Android's actual update
  cadence are not reproducible in the sandbox.

### Queue hygiene done alongside, and why it is here

Working the Lane B queue top-down, the two entries above LA-52 could not be started:

- **BF-104** (log a meal at 0.5×/1×/1.5×) needs one argument threaded through `logMealFromSaved` in
  `packages/shared`, called from the web route and the `pushMutations` branch — all Lane A. Split:
  **LB-49** is the engine half, and BF-104 now `Needs:` it.
- **BF-102** ("Calibrated" activity level) needs the measured factor, which comes from the energy
  model and the recommend route. Split: **LB-50** is that half, plus the independent prompt bug it
  names — the route tells the model the TDEE was computed *for* the user's activity level when it is
  `bmr × 1.2` regardless. **That string should be fixed whether or not the picker ever ships.**

Both were `READY` for Lane B before this and are `PARKED` after, which is what makes the queue honest
rather than a list of things that stall on contact.

<a id="2026-09-01-lane-drift-note"></a>

# 2026-09-01 · Lane A — the queue tool stops pointing at another lane's finished work (LA-53)

Branch `lane-a/lane-drift-check`. Three files, no migration, no product behaviour.

## An entry that contradicts itself keeps heading the wrong lane's list

`next-item.js` reads an entry's `Lane:` field, and nothing re-reads it when the remaining work moves
lanes. **Q-535 sat at the top of Lane A's READY list for two weeks** after its Lane A half landed on
2026-08-18 — everything still owed there is Q-318's and Lane B's. The cost lands on whoever starts
next: they read the entry to discover it is not theirs.

Three of these turned up in one session, and only one is mechanical:

| entry | drift | detectable? |
|---|---|---|
| **Q-535** | says its Lane A half shipped, `Lane:` still A | **yes** — the entry contradicts itself |
| **BF-64** | filed A; its own recommended fix is entirely client-side | no — that took reading the code |
| **LA-47** | says its proposed split *"does not compile"* | no — judgement |

So the check tests one thing: a body line saying the Lane X half has shipped while `Lane:` still
says X. Both halves were already parsed, so this is a comparison rather than a new heuristic.

## The rule reported its own documentation, twice

Running it against the tree flagged **LA-53 itself** — the entry that defines the rule — for two
different reasons, one after the other:

1. **Undated prose describing the shape**: *"an entry whose Lane A half has shipped keeps heading
   that lane's list"*. Fixed by requiring a date on the line, which every real claim carries by
   convention (`✅ THE LANE A HALF SHIPPED 2026-08-18`).
2. **A dated citation of another entry**: *"Q-535 — Lane A half shipped 2026-08-18"*. Fixed by
   skipping a line that names an entry id other than the current one.

**A guard that cannot survive its own documentation is not ready to be enforced**, which is the
concrete reason this prints as a note rather than failing CI — not a general preference for caution.
Both exclusions are pinned by tests, because "catch more" is the obvious edit and it turns the note
into noise nobody reads.

The accepted cost is stated in a test of its own: an **undated** claim is missed. In an advisory
check a miss is cheaper than reporting every entry that discusses the pattern.

## Verified against the real case, not a synthetic one

Flipping Q-535's `Lane:` back to `A` — its actual state until this morning — makes the note fire and
name it. On the current tree it reports **0**. Three mutations, three caught: dropping the date
requirement (2 tests), dropping the citation exclusion (1), and ignoring the lane comparison so any
shipped-half line matches (1).

## What is left, and it is the larger half

BF-64 and LA-47 are the same drift and no phrase-matcher will ever see them. The entry keeps them,
plus the question of whether to enforce: if the note's count stays at zero for a few weeks the
phrasing is stable enough to fail on. Not before.

<a id="2026-09-01-local-day-rollover"></a>

# 2026-09-01 — the app notices the day changed, without restarting

**Branch:** `fix/bf-86-local-day-rollover` · **Entry:** BF-86 · **Lane:** B

## The report

Owner: *"when the app is opened first thing in the morning or after 12 at night, I'd like it to
close/do a full reset so I open the fresh app… when I open the app in the morning and it just
resumes, it doesn't give me the morning check-in."*

**The cause is structural, not specific to the check-in.** The tab shell is persistent — it does not
unmount — so an effect keyed on `[userId, tz]`, neither of which changes while the app runs, executes
**once per app launch**. Leave the app open overnight, resume at 6 am, and nothing re-asks what day
it is. That is the `check-fetch-once-effects` class CLAUDE.md already names.

## What shipped

`LocalDayProvider` (`components/shell/local-day-provider.tsx`) holds the current local date and
re-evaluates it on mount and `visibilitychange`. `useLocalDay()` returns it, and subscribers use it
as an **effect dependency** — so they re-run on the first resume of a new day and at no other time.

**It is a value, not an event.** React already knows how to act on a changed dependency, where an
event bus needs every consumer to remember to unsubscribe. And `setState` with an unchanged string is
a no-op, so a same-day resume costs nothing and wakes nobody.

**Three subscribers, all of them existing day-scoped state:**
- `WorkoutDayRollover` — which is where this mechanism came from. It already ran exactly this
  listener for the workout store's `todayLogged`; rather than write a second copy, the listener moved
  up and that component became its first subscriber. **One listener in the app, not two.**
- The **morning check-in prompt** — the reported bug. Re-running was already safe:
  `isMorningCheckinPromptDone` compares a date-stamped marker against `todayInTz(tz)`, so it prompts
  once on a new day and no-ops on the same one. The state was right; only the trigger was missing.
- The **today-mood read**, which re-derives the date itself and had the same never-re-runs shape.

## The "close / full reset" half is answered rather than built

The entry argued against implementing it literally and the argument holds: **BF-80 forbids fixing a
resume problem with a reload** (it would give a blank screen two candidate causes while that entry is
still being diagnosed), instant paint exists so a repeat open shows data rather than a spinner, and
an unsynced outbox and an in-progress workout both survive today without being tested on a schedule.
**The signal delivers the ask without the reset**: on the first resume of a new day the app
re-prompts and re-reads; on any other resume it does nothing.

## The test drives the boundary, and the first version of it was worthless

A rollover fault is invisible except across local midnight, so the spec installs Playwright's clock
at **23:55 Brisbane**, closes the prompt (asserting the date-stamped marker is written), then
fast-forwards ten minutes and dispatches `visibilitychange`. A second test fast-forwards **two**
minutes and asserts nothing re-prompts — because "prompt on every resume" would be a worse bug than
the one being fixed.

**The first version passed with the fix reverted.** It used `isVisible()`, which is a point-in-time
check and not a wait: the sheet is a `dynamic(ssr:false)` import behind an async lookup, so it had
not rendered when the setup asked, the close branch never ran, and the final assertion was simply
waiting for that first appearance. **Mutation found it; reading did not** — and this is the second
time in two sessions that a guard which could not fail was caught only by breaking the code under it.

Both mutations now fail the spec: removing `localDay` from the check-in's deps, and deleting the
provider's `visibilitychange` listener.

## The size ratchet made this better

Adding the fix pushed `session-select-content.tsx` past its 1458-line baseline, and its rule is
**extract, do not append**. Rather than trimming comments to squeeze under, the check-in's marker
helpers moved to `app/session-select/morning-checkin-marker.ts` — a real unit, and the reason the
effect is safe to re-run. The file came out at **1449**, so the baseline shrank rather than held.

## Verification

- **The boundary test passes and both mutations fail it.** 4 tests green locally.
- `pnpm check:rules` — **Ran 67 of 67**, including the component-size gate that caught the append.
  `tsc`, `pnpm lint`, backlog-pointers and doc-links all exit 0, each read by exit code.

**Not exercised: the device.** A real overnight resume on the S25 is the verification the owner's
report describes — Playwright's clock proves the logic, not Android's process lifecycle, and a
WebView that was evicted and restored is a different path from a resume.

**Deliberately not swept: the today-scoped reads.** ~30 `cachedFetchToday` sites and 59
`readTodayCacheSync` sites exist. Both already treat a past-dated entry as a miss, so they are correct
**whenever they run**, and most sit behind the `tabEpoch` re-show pass. Whether any is both
persistently mounted and never re-read is Q-359's question; subscribing them all blind would be a
large diff justified by a guess. `useLocalDay()` is the mechanism if one turns out to need it.

<a id="2026-09-01-one-weight-goal"></a>

# 2026-09-01 · Lane A — one weight goal, one column (LB-42)

Branch `lane-a/one-weight-goal`. Migration 246, so it ships alone — a migration is never batched.

## The defect

`users` carried **two** columns for one goal. `weight_goal_kg` was edited in the Edit Profile sheet
and read by exactly one consumer: the nutrition-goal recommendation prompt, as *"goal weight"*.
`target_weight_kg` was edited in the Goals accordion and is what the Health page **renders** — the
number, the progress bar, the weight-rate band.

So the goal the user sees and the goal the AI is told could differ, and nothing reconciled them.

## What shipped

`target_weight_kg` wins, as LB-42 predicted: larger reader set, and it is the one on screen.

- **Migration 246** fills it from `weight_goal_kg` **only where it is NULL**. A value the user
  cannot see never overwrites one they can, and where both exist and disagree the visible number
  stands. Idempotent and unconditional; a second run matches no rows.
- **The API keeps the field name `weightGoalKg` and repoints it** — `rowToUser` reads
  `target_weight_kg`, `updateUserProfile` writes it. That is what let both editors converge with
  **no client change at all**. Repointing one screen would have left the other still diverging,
  which is the shape of the original bug rather than a fix for it.
- BF-78's presence guard survives the move: a PATCH that omits the field leaves the value alone, an
  explicit `null` still clears it. Both pinned.

## What is deliberately NOT done

**`weight_goal_kg` is not dropped.** Nothing reads or writes it now, and both the schema and a
`COMMENT ON COLUMN` say so. Dropping it is the one step here that cannot be undone, and the
row-scoped audit view **cannot show other accounts' values** — so what would be lost cannot be
checked first. That is the owner's call, recorded on the entry.

## Honest about the measurement

The owner's two columns **agreed** (60 / 60.00), and no other account is visible from the audit
view. So this fixes a live hazard rather than an observed wrong number — worth saying plainly,
because "the AI was told the wrong goal" would be a stronger claim than the evidence supports.

## Verification

Full suite green; `pnpm check:rules` **Ran 67 of 67**; `tsc` clean. Three mutations, all dead:
sending the profile write back to the retired column, sending the read back, and dropping the
presence guard. Exercised live on `pnpm dev` in **both** directions — set through the profile route
and read back from goals (73.5), set through goals and read back from the profile (69) — with the
retired column confirmed untouched at its old value.

**Not exercised:** native SQLite / Capacitor, safe-area, Samsung WebView, the APK path. Nothing here
touches them, and the local store holds no copy of this field.

<a id="2026-09-01-personal-details-consolidation"></a>

# 2026-09-01 — the personal details are one screen, and one writer

**Branch:** `feat/bf-79-personal-details` · **Entry:** BF-79 · **Lane:** B · **Version:** v1.416.0

## The request

Owner: *"can we combine all the personal information fields into 1 section in the more/details. Like
height/weight/bodyfat etc."*

They were split in two. `EditProfileSheet` owned the display name; the Goals accordion's
`RequiredInfoSection` owned height, birth year and biological sex. Until BF-78 each editor also
**resent the other's fields** from a possibly stale `user` prop, so a save from one could overwrite a
change made in the other. BF-78 deleted the resends; what was left was the mess — two places to look
for one row of the `users` table.

## What shipped

**A new screen at `app/more/details/`, reached from a `Profile` group on the More tab.** It holds
the display name, biological sex, birth year and height as editors, and weight and body fat as
**read-only measurements** with a button to where they are actually logged.

**Weight and body fat are deliberately not editable here.** They are measurements with a history —
logged daily, with the profile only ever showing the latest — so an input on a profile screen would
open a second write path into `body_metrics`, which is the shape the offline-first rules exist to
prevent.

**Targets and activity level stayed in Goals.** A target weight or a step goal is not a personal
detail, and moving them would have relocated the split rather than closed it. What used to be headed
*Required Information* now holds only the two body targets and activity level, and is headed
**Targets & Activity** because that is what it is.

**The Goals section gained the way back.** It still refuses an AI recommendation until height, birth
year and sex are filled — and it can no longer edit them, so naming a field the user cannot reach
from there would have been a dead end the move itself created. Its missing-field list is split, and
an **Open Profile details** button ships with the move.

## Two findings that are not this entry's to fix

**A user who already has a password cannot change it (LB-40).** `EditProfileSheet` initialises
`hasPassword` to `false` and never fetches it, so the *Current password* field is never rendered —
while `app/api/user/password` requires it whenever a hash exists. The flag is already in the
`/api/user/profile` payload the parent reads.

**`weight_goal_kg` and `target_weight_kg` are two columns for one goal (LB-42).** The first is edited
in the Edit Profile sheet and read only by the AI recommendation prompt; the second is edited in
Goals and is what the Health page renders. So the number the user sees as their goal and the number
the model is told can differ. Resolving it picks a winner and migrates the loser — a schema decision,
so **Lane A**, and deliberately not settled from a UI PR.

A third, smaller one: the **Weight Units toggle has no consumer at all** (LB-41) — nothing in the app
mentions `lbs` outside that one file, and the state resets to `kg` every time the sheet opens. Gated
on the owner, because removing a row they may believe in is theirs to hear first.

## A bug the gate caught in my own new code

The date label beside each measurement was copied from `goals-section.tsx`, which built it as
``new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', …)`` — no `timeZone`, so it renders in the
**device's** zone rather than the user's. `check-timezone-rendering.js` failed on the new file
immediately. Both sites now use the shared `formatDateDisplay`, which builds the date component-wise
and cannot shift; the check's grandfather list shrank by one in the same commit, as its shrink-only
contract requires.

## Verification

- **Against a running `pnpm dev`**, signed in as the seeded user: the screen returns 200 and renders
  all six rows; each of the four fields PATCHes and persists; **saving one leaves the other five
  untouched**, including the sheet's narrowed two-field body, which no longer nulls the display
  name; an emptied height clears to `null` rather than being indistinguishable from untouched.
- **Four source guards, six mutations, all killed** — re-adding `displayName` to the sheet's body,
  re-adding `sex` to the Goals body, removing either of the details screen's own writes, dropping the
  More row, and dropping the Goals link.
- **The first version of that guard could not fail on one case, and mutation is what found it.**
  Deleting the details screen's `heightCm` write still passed, because the screen also *seeds*
  `heightCm` into form state and a whole-file match cannot tell a write from a read. It now extracts
  the `JSON.stringify({…})` / `patch({…})` spans and matches only inside them.
- **E2E:** `profile-group-labelling.spec.ts` follows Biological Sex to its new screen rather than
  losing the assertion with the move — the baton's rule about grepping `e2e/` for a moved
  affordance's accessible name, applied deliberately this time. A new
  `profile-details-consolidation.spec.ts` walks More → Profile details, types a name, and reads the
  **database row** back to prove the other columns did not move; mutated by making the write resend
  its siblings, which fails it.

**Not exercised: the device.** The screen is web-verified only — safe-area clearance under
`MoreSubScreen`'s floored padding, the tap targets on the sex row, and the two measurement buttons at
S25 width are all unchecked on hardware.

## The compaction sweep rode along, because the ceiling made it blocking

Adding this entry took `docs/overview/entries/` to **251**, one over its 250 total ceiling, and that
is a `check-doc-index-size` **failure** rather than the note it prints at the 20-file chore
threshold. So the sweep the check has been asking for since 20 happened here rather than waiting for
an Orchestrator pass: the **22 oldest unlinked** entries folded into
`docs/overview/history-2026-08-30.md` (110 KB → 184 KB, still under the ~250 KB rule), leaving
**229 total, 21 foldable**.

**Only unlinked entries were folded**, per the rule the first sweep learned the hard way — a durable
doc citing a folded path is a broken link, and 48 of them once broke at once, several inside another
lane's baton. Every relative link in a folded body loses exactly one level (`](../x)` → `](x)`,
`](x)` → `](entries/x)`), and a link to a sibling entry that this same sweep was folding is re-pointed at
the history file rather than left dangling. `check-doc-links` passes on 933 files.

## Three merges, and each conflict was a different shape

`main` moved three times while this was in CI (#712/#710, #714/#715, #713/#716), and the resolutions
are worth recording because the repo's rules disagree with each other by file:

- **`docs/implementation-backlog.md`** — twice a pure **two-additions** conflict (my LB-40/41/42
  against BF-87), so both sides were kept. The standing "a backlog conflict is two deletions" rule is
  a common case, not the rule; read the headings.
- **`docs/doc-size-baseline-history.md`** — append-only, so both sides kept, main's first.
- **`docs/doc-size/*.size`** — the one genuine disagreement, twice. Two PRs raising the *same*
  document do not have a mergeable answer, and neither side was right: `projectOverview.md`'s
  baseline was **8593** on this branch and **8586** on main (main had *shrunk* it), with the merged
  file needing **8606**. Recomputed from the merged document each time, never picked.
- **`package.json` / `changelog.ts`** — rebuilt from `git show origin/main:…`, never spliced. The
  version moved v1.413.3 → v1.414.2 → v1.415.0 → **v1.416.0** as other PRs claimed each one.

<a id="2026-09-01-phase-aware-volume-targets"></a>

# 2026-09-01 · Lane A — a peaking week stops reading as a deficit (BF-59, the screen's half)

Branch `lane-a/phase-aware-volume-targets`. **No migration, no schema change** — the fix is that a
number stops being stored and starts being derived. **Not device-verified.**

## The target was measuring the wrong thing, and the owner said so first

> *"i did the full sessions for the week; and i was nowhere near hitting the reccomended amount of
> muscle sets."* … *"oh yes cause its realization phase its been less sets."*

MAV is an **accumulation** target. Showing it during a peak tells an athlete that doing the right
thing is wrong — which is worse than a wrong number, because a wrong number is at least ignorable.
Their week was correct training and the screen painted it red.

## Both halves of the entry were verified against production before anything was built

| claim | measured |
|---|---|
| the stored targets are a flat binary | 15 rows, all 14 or 10 — **seven at 14, eight at 10** |
| they ignore the program's goal | `Shikai` is `powerbuilding` = **×0.8**, and no stored row reflects it |
| a week is not in one phase | 10 sessions: **6 accumulation, 3 realisation, 1 intensification** |

The third is what makes this unstorable: phase lives in `session_periodization` **per program
session**, so there is no "this week's phase" that a column could hold. There is only the mix of
what was trained.

## Derived, not corrected

The entry proposed a corrective migration. That would have needed the landmark table expressed in
SQL — a second copy of the formula, which is the class the entry is filed under. So the route
computes the target instead:

```
weeklyVolumeTarget(goal, muscle, weekPhases)
  = max(1, round(volumeLandmarks(goal, muscle).mav × phaseVolumeScale(weekPhases).scale))
```

`program_volume_targets` keeps supplying **which** muscles the program trains. Its number is no
longer read by anything the user sees. That is the honest state and it is written into the entry, so
nobody "fixes" the rows back.

**The phase mix weights by workout session, and takes what was TRAINED rather than what was
scheduled.** The bar compares this week's logged sets against the target, so the target has to
reflect the sessions those sets came from; training one session twice is two sessions' worth of that
phase. An empty week scales by 1 — the accumulation baseline, which is exactly what the card showed
before this existed.

## The multipliers are the owner's, and they are a calibration

Accumulation 1.0 · intensification 0.8 · realisation 0.6 · deload 0.5, chosen 2026-09-01 from a
proposal. `baseline` sits at 1.0 deliberately: it is a testing phase with no volume prescription of
its own, and scaling it would invent one. The ladder follows behaviour the engine already had —
`explain.ts` calls realisation *"peak strength — heaviest load, lowest reps"* and `autoregulation.ts`
already refuses rep pushes in it.

## The formula test could not have caught the bug

`weeklyVolumeTarget` being right is worth nothing while the route still reads the stored column, so
the route test stores a target of **999** and asserts the response never contains it. That is the
only assertion that can tell *derived* from *read*. Four mutations, four caught:

| mutation | caught by |
|---|---|
| read `targetSetsPerWeek` again | *never returns the stored number* (3 cases) |
| ignore the week's phases | *asks for less once the week is a peaking one* |
| drop the `deleted_at` guard | *ignores a deleted workout session* |
| `SELECT DISTINCT` the program session | *counts a session trained twice as two sessions* |

One assertion was wrong and the correction is the interesting part: triceps' goal-adjusted MAV is
12 × 0.8 = 9.6 → **10**, which is exactly what the binary stored. One muscle in fifteen where a
coarse binary lands on the right answer by arithmetic accident — and a standing reason why "the
numbers look about right" was never evidence those rows were derived from anything. It is now its
own named test.

## Exercised on a running server, not only in tests

`pnpm dev`, seeded with three roster rows holding **999**:

- nothing trained → `phase {scale: 1, dominant: null}`, chest **10** (strength ×0.65 of MAV 16)
- one realisation session → `scale 0.6, dominant realisation`, chest **6**
- plus one accumulation session → `scale 0.8`, chest **8**

No 999 ever appeared. Fixtures deleted afterwards.

## What is NOT done, and it is a live inconsistency

`signals.ts` still builds the AI's per-muscle volume budget from the stored number. **Before this
change the screen and the engine were wrong together; now only the prescription is.** It is left for
its own PR because it changes prescribed sets on the device — a behavioural change needing a device
pass, where this one is a display change readable from a screenshot. It is the first `Keep:` on the
entry.

And **the card does not print the phase yet**. The route returns it; rendering is Lane B. Until that
lands the target simply moved with no explanation on screen, which is the option the owner
explicitly did not pick.

<a id="2026-09-01-quantity-box-spinner-reset"></a>

# 2026-09-01 — the quantity box centres, and the reset it needed has one definition

**Branch:** `fix/bf-85-quantity-box-centring` · **Entry:** BF-85 · **Lane:** B · **Version:** v1.414.2

## The report

Owner, on the Assign to Meal step: *"the text for quantity doesn't look centered."* The input already
carried `text-center`, which is the tell — Chromium draws the inner spin button **inside** the box, so
the value centres in what is left and sits visibly left of true centre in a `w-20` field.

## What shipped

Two halves, because the box was wrong in two ways at once.

**The spinner reset**, now defined once as `NUMBER_INPUT_RESET` in `components/ui/input.tsx` and used
by both quantity controls.

**The font size.** `assign-step` styled the input `text-sm`, but `globals.css` sets
`input { font-size: 16px !important }` under 640px to stop iOS zoom — so on the S25 the class was
silently inert and the value rendered 16 px beside 14 px chips. That is the "differently
proportioned" half of the report, and `!text-sm` is what makes the class win, exactly as
`quantity-editor` already did with `!text-3xl`.

## The entry's recommendation was wrong, and the measurement is why

BF-85 said to *"put the pair on the shared input primitive rather than a third copy."* Reading the
call sites first showed why that would not work: **both quantity controls are bare `<input>`
elements, not the `Input` primitive** — and across the app only **1 of 28** `type="number"` inputs
uses the primitive at all. A fix living solely in the component would have reached almost nothing,
including its own reported site.

So the extraction is a **class constant** rather than a component change — which still satisfies the
standing rule (a pattern at two sites is extracted before a third copy) at the granularity that
actually reaches these call sites. The primitive gained the reset too, conditional on
`type === "number"`, because it costs nothing and anything converted later gets it free; that is one
site today and is not the point of the change.

**Both siblings were fixed, not just the reported one.** `quantity-editor.tsx` had carried the
hand-copy for months and now imports the constant, so there is one definition rather than two.

## One risk this refactor introduces, checked rather than assumed

Tailwind generates utilities by **scanning source for class strings**, so moving
`[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none` out of a `className` literal
and into a `const` in another file could in principle have stopped the CSS being emitted — and the
symptom would be the original bug, silently back. Confirmed against the built stylesheet that both
rules are still generated with the change in place.

## Verification

- `pnpm check:rules` — **Ran 67 of 67 Custom Rules steps** (the count moved 65 → 66 → 67 while this
  was in progress, twice from other agents' merges; it is read from the runner for exactly that
  reason). Full unit suite green, `tsc`, ESLint and the backlog check all exit 0.
- **Four source guards, all five mutations killed** — dropping the reset at either site, re-inlining
  the classes instead of importing them, dropping the `!` from `!text-sm`, and trimming the constant
  to `appearance:textfield` without the pseudo-element.
- **Two of those guards could not fail as first written, and mutation is what found it.** One matched
  the *import line* rather than the use, so deleting the class from the element still passed; the
  other matched its own explanatory comment, which contains `!text-sm`. Both now strip comments and
  imports before matching. **That is the fourth time this repo has shipped a guard satisfied by the
  prose documenting its own fix** — the helper carries that note so the next author sees it.

**Not exercised: the rendering.** Both vitest projects run `environment: 'node'`, so nothing renders
and the *effect* — a value that sits centred, in a box matching the chips' height and text size —
cannot be asserted here. That is the S25 check the entry asks for, and it has not been run.

## Left behind deliberately

**27 other bare `type="number"` inputs have no spinner reset.** Not swept: six are in admin and
device-debug consoles where a spinner is harmless or wanted, and the entry is explicit that a blind
sweep is the wrong move. The constant now exists for the next one that is reported, which turns each
into a one-line fix.

<a id="2026-09-01-rest-day-stored"></a>

# 2026-09-01 · Lane A — a chosen rest day becomes a stored fact (BF-84, engine half)

Branch `lane-a/rest-day-stored`. Migration **247** (`rest_days`) + **248** (`claude_ro` views).
New outbox domain `rest_days`. No native change, so no APK — this reaches the device through
Railway. **Not device-verified.**

## What the feature actually was

`lib/home/rest-day.ts` — a `localStorage` key, and its own comment was the finding:

> `/api/log-rest-day` persists nothing (rest days are inferred from gaps in workout history), so
> refetching `/api/next-session` after choosing rest just recomputes the prompt and reverts the
> selection.

Three consequences followed. The second device never saw the choice. It died on a reinstall. And
any refetch undid it — which is the one the owner would have hit first, because the control is one
tap away from a screen that refetches.

The route existed and returned `{ ok: true }`. Reading a 200 as "saved" is the shape of this bug.

## The owner settled it as a fact, and the criterion is the reason

Asked *fact or hint?*, the owner answered *"whatever would be better in the long run"* — so the
call came back with the criterion attached:

- **Rest days are training data.** As a display condition only, training load, weekly cadence and
  phase counting all read a chosen rest as a *missed* session rather than a taken one.
- **"No workouts logged" is not the same claim as "I chose to rest."** A day with no logs is also a
  day you forgot, were ill, or logged late. No display logic recovers a distinction that was never
  written down.

## What shipped

`rest_days (id, user_id, date, created_at, updated_at, deleted_at)`, unique on `(user_id, date)`.

**A tombstone rather than a hard delete**, and the reason is specific to this domain rather than
inherited from the convention: the old marker expired at midnight, so a mistap cost you an hour.
Stored, a mistap is durable, and the undo has to be as reliable as the mark. Re-choosing resurrects
the same row.

**Deliberately not a row in `day_checkins`.** Every column there is a self-report scale keyed by
`(user_id, log_date, phase)`, and the calibration queries filter on those. A rest choice is not an
answer to a check-in question; putting it there means a row with every scale NULL under an invented
phase.

`getNextSession` prefers the stored row over inference, **after** the already-trained branch and
**before** the readiness/AI one:

- After already-trained, because logging a workout is a stronger statement than having said earlier
  that you would rest. The row survives that, so deleting the session tomorrow does not lose the
  choice.
- Before readiness, because that branch is the expensive one *and* the one that would otherwise
  offer a deload prompt on a day the user has already said they are resting.

`/api/log-rest-day` and the `rest_days` push branch both call one `setRestDay`. The client goes
through `chooseRestDay`, which queues the outbox row when the local store is there and POSTs when it
is not — so a choice made offline is carried rather than lost.

## No local SQLite table, and this was a decision

Every one of the entry's three failures is fixed by the server row alone: the second device reads
`/api/next-session`, a reinstall reads it too, and a refetch now agrees instead of reverting. The
only thing a local table would add is reading *historical* rest days offline, which nothing does —
`withRestDayOverride` only ever cares about today, and cadence and prescription are server-computed.

So the `localStorage` marker stays, with its job changed: it is the optimistic echo between the tap
and the next fetch, and the offline view of today's choice. That is a legitimate client cache. What
it could never be was the only copy. Adding a local table later is additive and cheap; standing one
up now for a reader that does not exist is not.

## The timezone bug found on the way

Every function in `rest-day.ts` took `todayInTz()`'s default — the owner's zone — while the seed
path calling it stamped its cache with `todayInTz(tz)`. For a user outside that zone the marker and
the seed disagreed about which day it was, for hours a day. `tz` is threaded through all four
functions and all five call sites now.

## Mutation testing, and the two that survived first

Fifteen mutations, each killed by the case named for it in the test file's header — dropping the
`restChosen` branch, moving it above already-trained, making the withdrawal a no-op, hard-deleting
instead of tombstoning, unscoping each read, defaulting a missing `resting` to a withdrawal, and a
dash-only date regex.

Two survived a first draft and are worth recording because both were tests that could not fail:

1. **The push branch's slash→dash replace.** Removing it failed nothing: `date` is a DATE column and
   Postgres parses `2026/08/22` to the same day. It stays for shape-consistency with the other
   nineteen branches, and the code now says it is not load-bearing rather than implying it is.
2. **`tz` dropped from the marker write.** The test used a zone four hours from Brisbane, and four
   hours apart means agreeing twenty hours a day. Fixed by *deriving* the test zone at runtime from
   a pair 26 hours apart — always different days, so whichever of them disagrees with the default
   right now is the one used. That is the standing rule for this class: a test that waits for its
   window is a test that mostly does not run.

## What is not done

The **surface half**, which is Lane B's: the owner asked for the rest button to be available on
Home's card when the app has *not* suggested rest. `recommendation-card.tsx` already renders
`onRestDay` — inside the `deloadOrRestRecommended` branch — so it is a rendering condition plus a
`Moon`/`BedDouble` icon and `variant="secondary"`, not a new control. It is safe to ship second:
the storage exists now, so the new button cannot lose a choice. BF-84 stays in the queue as Lane B
with that half named.

Verified on `pnpm dev` against the local database. **Not exercised:** native SQLite/Capacitor (the
outbox path runs only on the APK), safe-area, Samsung WebView, prod data drift.

<a id="2026-09-01-scan-meal-group"></a>

# 2026-09-01 · Lane A — a scanned meal gets a group, and a name (BF-97, engine half)

Branch `lane-a/scan-meal-group`. Migration **252** (`food_logs.meal_group_name`) plus **253**, the
`claude_ro` regeneration the new column requires. Local SQLite **v33**. No native change.
**Not device-verified**, and **nothing looks different yet** — see the last section, which is the
point rather than a caveat.

## The bug is a rule that was right, meeting a case it did not cover

BF-39 shipped diary grouping for **saved meals**: the rows share a `meal_group_id` and the group is
named from the `saved_meal_id` they also carry. The owner's report is that scans do not group, and
`groupDiaryEntries` says why in its own words — it refuses to head a group it cannot name, because
*"heading them 'Meal' would be inventing a name the app does not have"*. A scan has no saved meal,
so it has no name, so it cannot group. Eight ingredients, eight rows.

The entry offered three ways out and recommended the first, which is what this builds: **a group may
carry its own name instead of a saved meal.** The two rejected options are worth restating because
they are the tempting ones — having a scan create a saved meal puts a row in the user's library to
satisfy a display rule, and grouping on the id alone reintroduces exactly the unnameable group the
existing rule exists to refuse.

## `meal_group_name`, denormalised, for the reason `meal_group_id` already is

There is no group table: a group **is** the rows sharing an id. Adding one would mean a new synced
domain, an outbox domain, a local table and a pull mapping — for one string — and the local store
would then need a join it does not have to draw a header offline. So the name sits on every row of
the group, the same shape as the id beside it.

The write path mints **only alongside a name**, and only for more than one entry:

```ts
const mealGroupName = entries.length > 1 ? normalizeMealGroupName(groupName) : null
const mealGroupId = mealGroupName ? crypto.randomUUID() : null
```

Both halves are asserted, and both are negatives. A group of one is collapsed back to a plain row by
`groupDiaryEntries` anyway, so an id there would make a row render as a meal for one frame and then
not. And a batch with no usable name must mint nothing, or the diary is handed the un-nameable group
its own rule refuses — the bug, rebuilt one layer down.

## One normaliser, three writers, and it truncates rather than rejecting

`packages/shared/src/nutrition/meal-group-name.ts` is the only place that decides what a group name
is. Three surfaces write one: the web route, the `pushMutations` branch, and `logFoodEntries` on the
device — the exact shape the sibling-surface rule is about, and the value is model-authored text from
a photo scan, so "the client already trimmed it" is not a guarantee any of the three may lean on.

**It truncates at 120 characters instead of refusing.** An over-long name reaches the push branch
inside an outbox mutation, and a 4xx there is a poison pill the outbox quarantines — losing the whole
food log over a display string. Nothing about a long name makes the log wrong.

## Five mutations, five caught

The chain a new column on a synced table normally half-finishes, tested by breaking each link:

| mutation | caught by |
|---|---|
| mint a group for a single entry too | *mints nothing for a single entry* |
| drop the name from the outbox payload | *queues the grouping in the outbox payload* |
| drop the name from the push branch's write | the two push-branch storage cases |
| `?? null` in the upsert's conflict arm | *does not strip an existing name* |
| drop the column from the sync delta select | *carries the name in the sync delta* |

The `?? null` one is BF-39's lesson re-run rather than restated: it reads as equivalent and is not —
it would make every id-bearing upsert that knows nothing about groups strip the name off a row that
had one.

**What is NOT tested here:** the local SQLite half. The column, the v33 upgrade, the reconcile row,
the two upsert arms and the offline read are written by the same rules as their BF-39 siblings and
are verified by reading, not by running — native SQLite does not exist in this sandbox. That is the
device check the entry now carries.

## Nothing looks different yet, deliberately

`groupDiaryEntries` still requires a `savedMealId`, so a scan renders exactly as it did before this
PR. The ids and names are being written; the rendering rule that reads them is Lane B's half and is
what the backlog entry now holds. An engine half that changed the screen halfway would be the worse
outcome — this one cannot.

One call site in a Lane B file changed with it: `food-logger-sheet.tsx` passes the dish name the user
just confirmed. Writing the column without it would have shipped a column nothing populates, which is
the failure mode the entry itself names.

<a id="2026-09-01-settings-that-did-nothing"></a>

# 2026-09-01 — two settings that did nothing, both decided by the owner

**Branch:** `fix/settings-that-did-nothing` · **Entries:** LB-41, LB-29 · **Lane:** B · **Version:** v1.417.0

Both were **gated on the owner** and both were asked with a recommendation, alternatives and the
reversal cost, per the standing decision rule. Both recommendations were taken. They ship together
because each is small, neither needs a device, and the merge-race tax was running at roughly one
re-merge per PR — the batching rule's "aggregate on what has to be verified" cuts the other way when
the verification is this cheap.

## LB-41 — the Weight Units toggle had no consumer

`units` was `useState('kg')`: never persisted, never read, not even restored by `resetFromUser`, so
it silently returned to `kg` every time the sheet reopened. `grep -rn "'lbs'"` across `app`,
`components`, `lib` and `packages` found only that file's own three lines. **The row offered a
choice, appeared to take it, and changed nothing anywhere.**

**Owner's decision: remove it.** The alternative — real unit display — is a pass across every weight
the app renders (body metrics, the dial, PRs, goals, chart axes) plus a stored preference that
syncs; that is a feature, and filing it as one is honest where leaving an inert switch is not.
Reversal is the same nine lines.

**`e2e/profile-group-labelling.spec.ts` asserted this exact radiogroup** — found by grepping `e2e/`
for the accessible name before removing the affordance, which is the rule the baton carries because
a sibling sweep of the *code* once missed the spec whose whole subject was a moved button. The spec
follows the removal: Food Region inherits the always-one-checked assertion, and a new assertion
holds Weight Units at **zero**, so a re-added inert toggle fails.

## LB-29 — a choice could be overwritten by the server's older copy

`savePreference` writes `localStorage` and PATCHes fire-and-forget. Hydration then wrote **every**
key the bag carried, unconditionally — so a reload before the PATCH landed was answered with the
*previous* value, which overwrote the choice just made. **Offline it was not a race but permanent:**
the PATCH never lands, so every launch re-wrote the old value.

**Owner's decision: the change should follow to other devices**, which rules out the simpler
seed-if-absent rule (a device can never be clobbered, but a setting changed on the phone never
reaches the laptop). So the fix is a dirty mark, not a weaker hydration:

- `savePreferences` records the patched keys as unsynced in `localStorage` **before** the request,
  so a reload mid-flight finds the mark rather than racing it.
- Hydration **skips** a marked key, and **re-sends** the device's value instead of taking the
  server's — which is what makes the offline case self-heal on the first launch with a network
  rather than merely survive.
- Only a 2xx clears the mark. A 4xx/5xx leaves the key marked, so the device keeps winning.
- A mutually-exclusive pair with a member in flight is left alone, or the server's older half of the
  pair would delete the half the user just chose.

The mark lives in `localStorage`, not memory, because **the reload is the whole problem** — a
session-scoped set does not survive the navigation that loses the value, which is why the entry's
third alternative was rejected outright.

`decode` is new and load-bearing: a re-send has to put back the type the schema expects, so
`weightLookback` goes as `30` and not `"30"`, and `mealReminders` as `false` and not `"false"`.

## Verification

- **In a real browser, both.** Edit Profile shows **zero** Weight Units radiogroups and no
  `Kg / Lbs` text. With the PATCH route held open, tapping a Food Region wrote `US` locally and the
  mark `["foodRegion"]`, and **after a reload the value was still `US`** — which is the defect,
  reproduced and fixed on screen rather than argued from code.
- **21 unit tests** in `preferences-sync.test.ts` (13 pre-existing, 8 new), **six mutations, all
  killed**: hydration no longer skipping marked keys, never marking, clearing the mark on a failed
  response, dropping the re-send, letting the exclusive pair ignore an in-flight member, and a
  `decode` that returns the raw string for every encoding.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers and doc-links all exit
  0, each read by exit code.

**Not exercised: the S25.** Neither change is layout, so the device risk is low — but "a setting
survives an app restart" is a device claim, and the web reload is a weaker version of it.

**Not exercised: a real second device.** The cross-device promise the owner chose is verified as
"the device re-sends and the server accepts", not by watching a laptop pick the change up.

<a id="2026-09-01-step-base-credit"></a>

# 2026-09-01 · Lane A — steps count from the first one (BF-88)

Branch `lane-a/step-base-credit`. v1.418.0. No migration, no native change — this reaches the device
through a Railway deploy.

## The owner's question, and the version of it that works

*"is it possible to get rid of the baseline; and have it reference steps + exercise only?"* — and
then, once the first answer came back as no: *"cant we remove some calories for the base 3000 and
have it start from 0 steps?"* That second one is the shape that works, and it is what shipped.

The difference is conservation. Dropping the multiplier to 1.0 and counting every step removes
265 kcal of base and hands back 106 — a **lower** burn on **124 of 124** of the owner's days, mean
−177. Removing exactly what you hand back removes nothing: the first 3,000 steps' energy comes out
of the resting base, and the same 3,000 steps are then counted.

## What it changes, measured

| steps | 0 | 1,196 | 2,000 | 3,000 | 5,000 | 10,000 | 15,000 |
|---|---|---|---|---|---|---|---|
| delta | −110 | −66 | −37 | **0** | **0** | −1 | **0** |

Identical at and above 3,000. Below it the day drops, which is the intent: a day with no walking
should not be paid for incidental walking that did not happen. Reproduced on the dev server against
the real route — at 3,000 steps `restingBase 2087 + active 110 = 2197`, which is exactly what the
base alone read before.

## Three things that had to be got right, and one that nearly was not

**The credit is computed, never a constant.** 110 kcal for one profile, 102 for the owner's,
different again for anyone lighter. `stepEnergyKcal` in `daily-energy.ts` is the single conversion,
so the amount subtracted from the base is by construction the amount `computeActiveEnergy` adds
back. Two MET calls with different arguments would leave a silent per-day drift that no test of
either half alone would catch.

**Formula path only.** On the calibrated path the base is `maintenance − avgActiveKcal` and
`maintenance` is measured, so lowering the step floor raises `avgActiveKcal` and the subtraction
happens by itself. Applying the credit there too double-subtracts it. **That mutation survived every
test in the file** until a calibrated-path case existed — the entry warned about it in as many
words, and the warning alone did not catch it.

**And `formulaBaseline` has two consumers, which the entry does not say.** It is the resting base
*and* the uncalibrated maintenance estimate. Subtracting the credit there would move both, cutting
the user's recommended intake by ~100 kcal a day — a different change from the one that was
approved. Every relative assertion still passes under that version, including
`maintenance − restingBase === activeKcal`, because both sides shift together. Only an anchor the
mutation cannot move catches it, so the test recomputes the expected maintenance from the same
inputs with the same function rather than pinning a figure that would go stale.

## The rename was the mechanism, not decoration

`STEP_BASELINE` → `STEP_BASE_CREDIT`. The value stays 3,000 and its meaning inverts: it was steps to
skip, it is now steps whose energy is credited out of the base. **A test pinning `3000` cannot
notice a change of meaning**, so the rename is what broke every consumer on purpose and made the
compiler produce the list — including the three copy sites that would otherwise have gone quietly
false.

## The copy BF-87 shipped that day, now retired

BF-87 merged hours earlier and put a threshold into three sentences — *"steps count above
3,000/day"*. There is no threshold any more, so all three are rewritten here rather than left as a
follow-up: the two *"calories out"* explainers say **every step you take**, and the zero-state line
means what it now can mean — *"no movement recorded yet today"*. The case BF-87's line explained,
steps on screen earning nothing, cannot arise.

Its test moved with it. The assertion that a short day earns **zero** is now the assertion that it
earns **something**.

## Deliberately not done

A TEF term from logged intake is the genuinely more accurate version and is unusable at current
logging density — 45 of 124 days carry a plausible intake, so it would vanish on two-thirds of days
and make burn swing on whether food was logged.

`SEDENTARY_MULTIPLIER` is a Mifflin **BMR** activity factor applied to a **measured RMR** since
BF-42. Those are different quantities and the factors were never validated against the second. For
this owner measured (1,325) sits below predicted (1,481), so the direction is not clearly an
over-count; filed as a known imprecision, not touched here.

## The E2E failure this caused, and what it says about the harness

`one-calorie-budget.spec.ts` went red in CI on the first run — its assertion pins the day's earned
figure, and its own comment says that figure should be the strength session and nothing else. That
was true for free while steps counted only above 3,000: a small step count another spec left on the
shared day contributed zero and was invisible. Counting from the first step made it visible.

**It does not reproduce in isolation** — alone the day is undisturbed and the spec passes with or
without a fix. It needs the full serial suite against one shared database, which is a 22-minute run.
So the pin was shipped as fixture hygiene with its uncertainty stated in the comment, and the
evidence arrived afterwards: the same CI run that failed twice on the unpinned commit went green on
the pinned one. The precise writer was never identified and does not need to be; the fixture should
not have depended on one.

Worth carrying: **a change that makes a previously-inert input load-bearing turns shared-fixture
sloppiness into order-dependent failures**, and those look like flakes.

## Verification

Full suite **717 files / 6,118 tests** green; `pnpm check:rules` **Ran 67 of 67**. Five mutations,
all killed: no credit applied, credit hardcoded, credit taken off maintenance too, credit applied on
the calibrated path, and the step threshold restored. Exercised on `pnpm dev` across 0 / 1,196 /
3,000 / 10,000 steps with the target unchanged at every one, and no stale copy served on
`/nutrition` or `/health`.

**Not exercised:** the APK. Nothing native changed and no offline-first write path is touched, but
the cards themselves have only been seen in a browser.

<a id="2026-09-01-steps-threshold-copy"></a>

# 2026-09-01 — the calorie bar says why zero is zero

**Branch:** `fix/bf-87-steps-threshold-copy` · **Entry:** BF-87 · **Lane:** B · **Version:** v1.416.3

## The report

Owner: *"is basic steps being counted towards calorie burn? It says I've done 1000 but not sure if
that's counting towards nutrition."* His screenshot held both halves of the contradiction — **STEPS
1,196 Today** beside *"1,365 base — nothing earned from movement yet today"*.

**The app was right and the screen could not say why.** Only steps above `STEP_BASELINE` (3,000)
earn calories, deliberately: the sedentary base is BMR × 1.2, and a desk day's incidental stepping
is already inside that multiplier, so counting every step would count it twice. At 1,196 the honest
answer is zero — given without the reason, which is what produced the question.

## What shipped

**The zero case names the threshold**, because naming the shortfall alone does not answer it: a user
with a 7,000 step goal still cannot tell how many of those convert. It reads
*"2,478 base — nothing earned from movement yet; steps count above 3,000/day"*.

**The earned case now breaks down**, rather than rolling three addends into one figure at the exact
point of confusion: *"2,478 base + 1 earned from movement (1 activity)"*. `activeBreakdown` already
returned workout, activity and step calories separately (Q-391), so the data was in hand.

**Both "calories out" explainers name the same number** instead of *"steps above a baseline"*.

**The parts need no rounding here, and finding that out cost the best code in the change.** The
first version apportioned them by largest remainder, over a sweep of 480 fractional splits, on the
assumption that `activeKcal` is rounded once while its parts are not. Re-reading `daily-energy.ts`
against current `main` — the standing rule to re-verify a plan before implementing it — showed
`computeActiveEnergy` **already rounds all three parts** and sets `total` to their sum, which the
service passes through as `activeKcal`. So the parts are integers that already add up, and the
apportionment was arithmetic guarding a case its producer cannot produce.

It is deleted. What replaces it is a test that pins the guarantee *against the real
`computeActiveEnergy`* across four inputs: if Lane A ever stops rounding, or `total` stops being the
sum, the display's assumption breaks and the test says so. Mutation-checked by removing one of the
three `round()` calls upstream, which fails three of the eleven tests.

## The threshold is mirrored, and that is a deliberate exception

Importing `STEP_BASELINE` from `@trainingai/shared/health/daily-energy` **took `/nutrition` to a
500**. The chain is `daily-energy` → `workout-energy` → `lib/oura-models/constants`, which reads
`node:fs/promises`; Turbopack fails the client chunk with *"the chunking context (unknown) does not
support external modules"*. **No client component had ever imported `daily-energy`** — this was the
first, and it only wanted one number to print.

So `components/nutrition/movement-breakdown.ts` declares its own `3_000` with the reason above it,
and the test imports the shared constant — tests run in node, where the chain is harmless — and
fails if the two disagree. It cannot drift silently. It is still a second copy of a number, so
**LB-43** (Lane A, it edits `packages/shared/**`) proposes splitting the plain constants into a leaf
module, after which the mirror is deleted.

**`pnpm dev` is what found this. `tsc` was clean throughout.**

## Verification

- **Rendered, both branches, against a live server.** The earned line reads *"2,478 base + 1 earned
  from movement (1 activity)"*. Moving the seed's two activity rows off today reached the zero
  branch: *"2,478 base — nothing earned from movement yet; steps count above 3,000/day"* — the
  owner's exact question, answered on the screen that raised it. The seed was restored afterwards.
- **Eleven tests, six mutations, all killed**: removing one of the service's three `round()` calls,
  a drifted mirror, re-adding the server-only import, reverting the zero-earned copy, reverting
  either explainer, and dropping the breakdown render.
- **One guard could not fail as written, in the mirror image of the usual way.** The check that the
  server-only import is *absent* reused a source reader that **strips import lines** — added
  precisely so other guards cannot pass on the line naming their symbol. Here that removed the thing
  under test. It now reads a comment-stripped, import-preserving copy. Mutation found it; reading
  did not.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers, doc-links all exit 0,
  each read by exit code.

**Not exercised.** The two *"calories out"* explainer strings changed inside a paragraph that
already renders, and are guarded by source tests, but were not separately rendered — a probe spec's
click into that collapsed block timed out and was not worth more time than the change is worth.
Nothing here has been on the S25: this is copy at the bottom of a dense card, so line-wrapping at
S25 width is the device check it owes.

**Deliberately not done: the live step count.** The entry's example copy included *"— 1,196 so far"*.
None of the three call sites holds a step count, and threading `body-metadata` into all three to
echo a number the owner can already see on the same screen is not worth the fetch. The **threshold**
is what the entry's own ⚠ asks for, and it is what answers the question.

**Deliberately not touched: `STEP_BASELINE` itself.** The entry is explicit — it is the guard against
double-counting, and changing it silently re-scores every historical day. That is a Tuning proposal
with the owner's sign-off, not a copy fix.

<a id="2026-09-01-supplement-contributions"></a>

# 2026-09-01 — a day's dose is a sum of contributions (BF-69 stage 1)

**Lane A · branch `lane-a/supplement-contributions` · migrations 254 + 255 · local SQLite v34 · v1.426.0**

Plan: [`docs/superpowers/plans/2026-09-01-dosed-substance-exposure.md`](../superpowers/plans/2026-09-01-dosed-substance-exposure.md).
Stage 1 of four. Stages 2 and 3 are Lane B's; stage 4 stays gated on data.

## What the entry was actually about

BF-69 reads as *"dosed substances are stored but nothing reads them"* — a missing reader. The
planning session had already found that framing incomplete (there is essentially nothing to read:
**2 supplements, 1 log ever, `amount` NULL**), which is why the trends overlay is stage 4 rather
than stage 1. Building this half surfaced the other thing the framing hides: the storage was not
merely unread, it was **shaped so that a second writer would destroy data**.

`supplement_logs` was `unique (supplement_id, log_date)`. One row per substance per day, with the
upsert's own comment saying *"the row is one act of taking it"* — which was true only while there
was exactly one writer. Add the meal attachment the owner asked for and the same day has two writers,
and under that constraint:

- a meal carrying creatine plus a hand-tick left **one** value, last writer wins;
- the same meal logged twice recorded **one** dose;
- `unlogSupplement` soft-deleted **the day**, with no notion of who had written it — so unticking on
  the supplements page would wipe a dose a meal contributed, and deleting a meal would wipe a
  hand-logged one.

That third one is silent data loss, and it is why the schema had to move before the UI could.

## What shipped

Each act of taking something is now its own row carrying `source` (`'manual' | 'meal'`) and, for a
meal, `source_ref` — the `food_logs` row it came from. The day's amount is `SUM(amount)` over live
contributions, **derived on read**, never stored (the Stored Counters rule: every stored counter in
this project has drifted). `supplements` gained `started_on`/`stopped_on`/`dose_prompt`.

`listSupplements` returns a new `loggedAmount` — the day's total with a contribution count — beside
the unchanged `loggedDose`.

## Three decisions worth not re-deriving

**1. The replacement constraint is partial and manual-only, and the plan argues against something
adjacent to it.** §3 of the plan warns that replacing the whole-day unique with a narrower one would
break the feature, and names `(supplement_id, log_date, source)` — a three-column unique, which
would indeed cap meal contributions at one per day. What shipped is a *partial* index over
`source = 'manual'` alone. Meal rows are outside it entirely and add without limit; the tick stays
idempotent, which matters because a double-tap or an outbox mutation replayed after a retry would
otherwise double the recorded dose. The plan has been corrected in place rather than left to be
re-litigated.

**2. Its predicate deliberately covers soft-deleted rows.** The first version added
`AND deleted_at IS NULL`, which looked more correct and made an existing test fail: an untick
followed by a re-tick left **two** manual rows for one day, where the old code revived one in place.
Chasing that was worth more than the test — with two rows, the pull has to apply the tombstone and
the re-log in the right order or it deletes the live one, and `applyDelta`'s manual branch addresses
a row by its **natural key** (a locally-created log and its server row have different ids; the
server generates its own). Dropping the clause restores the far simpler invariant — **at most one
manual row per substance per day, ever** — and with it, every existing reconciliation behaviour.

**3. `loggedToday` still tracks the manual contribution only.** It first summed all contributions,
which reads as the more honest answer to *"did I take it today"* — and it is wrong for what the field
does. It is the checked state of the supplements page's tick, and that tick writes and removes
exactly the manual row. A meal's dose turning it on leaves a control rendered checked that refuses to
turn off, because DELETE has no manual contribution to remove. `loggedAmount` is what answers the
day-level question. This was caught against the running dev server, not by a test.

## The local migration is the risky part

SQLite cannot drop an inline table constraint, so v34 does what no local migration in this repo has
done: creates a second table, copies every row, drops the original, renames. Every other version in
that file only adds columns — and the two local migrations that have killed this app both did it by
**throwing on retry** and leaving `open()` throwing forever (#27's PRAGMA inside the upgrade
transaction, #85's non-idempotent `ADD COLUMN`).

So v34 is written so that any prefix of it can be re-run to completion: a resurrection stub before
the copy (without it, a retry after a successful `DROP` but a failed `RENAME` reads from a table
that no longer exists), `INSERT OR IGNORE` keyed on the primary key, and a `SELECT` naming only
columns present in both shapes. The two `supplement_logs` `ALTER`s were removed once the rebuild
existed — they were a second, non-idempotent way for the version to fail for nothing.
`RECONCILE_COLUMNS` carries all five new columns, and the replacement partial index is in
`RECONCILE_INDEXES` rather than only in the upgrade, because reconcile is the real schema authority
after a partial upgrade and a half-applied v34 would otherwise leave the tick able to double a dose.

**None of that is a device run.** See the `projectOverview.md` Known-Issues row.

## Two guards that reported their own documentation

`check-reconcile.js` failed on `supplement_logs_new`, the rebuild's scratch table — correctly, by its
own rule, and wrongly in substance: the table is gone before `reconcileSchema()` ever runs, so
registering it would make reconcile recreate a table nothing reads. It now carries a named
`TRANSIENT_TABLES` exemption which itself asserts that a listed table is actually dropped or renamed
away, so the exemption cannot hide a real gap. Named individually rather than matched by a suffix
convention, because a pattern-based escape hatch is how a data-loss guarantee gets widened by
accident.

The new chain test's PRAGMA check matched the migration's own comment saying *"No PRAGMAs here"*. It
strips comment lines now. That is the third time in this repository a source-scanning guard has found
its own documentation first.

## Verification

- Full suite green twice consecutively: **6,217 passed, 59 skipped, 737 files**. An earlier run
  showed one transient failure that did not reproduce and could not be identified on re-run — a
  `pnpm dev` server was being killed as that run started, which CLAUDE.md names as a contention
  cause. Recorded rather than claimed clean.
- `pnpm check:rules` — **Ran 67 of 67**, all passing.
- Twelve new assertions across two files: `supplement-contributions.test.ts` (server behaviour,
  against a real Postgres) and `supplement-contribution-chain.test.ts` (the offline chain, at
  source, because `getLocalStore` returns null under vitest's node environment).
- **Mutation-tested**: removing the `source = 'manual'` scope from `unlogSupplement` turns
  *"unticking removes only the manual contribution"* red. The assertion is absolute — one live row,
  and it is the meal's — so a mutation cannot move both sides of it.
- **Exercised against `pnpm dev`** with a real credentials session: create with a slash-form
  `startedOn` (normalised to dashes before it reaches the `date` column), PATCH `stoppedOn`,
  double-tick → one manual row, a meal contribution added alongside → day reads 5 mg over 2
  contributions, untick → meal survives at 3 mg with `loggedToday` false, re-tick → revives the
  manual row in place, `startedOn: "not-a-date"` → 400.

**Not exercised:** native SQLite and the v34 rebuild (Capacitor plugin, APK only), safe-area,
Samsung WebView rendering, drifted production data. The meal write path does not exist yet — the
tests insert a `source = 'meal'` row directly, which is the schema half this PR is proving, not the
stage-3 writer.

## What is next

Stage 2, Lane B: an amount and `dose_prompt` on the supplements page. Until it ships nothing can
write a number, so no series can start — which is the whole reason the overlay is stage 4 and gated
on data rather than on effort.

<a id="2026-09-01-typecheck-tests"></a>

# 2026-09-01 · Lane A — test files are typechecked now (LB-37)

Branch `lane-a/typecheck-tests`. No migration, no schema change, no product behaviour.

## Every "TSC_OK" in this repository's history excluded every spec

`tsconfig.json` carried `exclude: ["node_modules", ".claude", "**/__tests__/**"]`. Across ~700 spec
files a test could reference a type that does not exist, call a function with the wrong arity, or
assert against an interface that had since changed shape, and `tsc` said nothing.

That matters more than it sounds because of what the gate is used for. Every session here treats a
clean `tsc` as its first check, and CI's Build job runs the same project — so the sentence *"tsc
clean"*, written in dozens of PR bodies including several of mine this session, carried **no
information about any test file**. A guard that cannot fail.

**Verified before building**, not taken from the entry: appending
`const deliberateTypeError: number = "not a number"` to a spec and running
`npx tsc --noEmit -p tsconfig.json` produced zero errors naming that file.

## 320 across 90 files, and the split is exact

| project | errors |
|---|---|
| `tsconfig.json` (tests excluded) | **0** |
| `tsconfig.tests.json` (exclusion dropped) | **320**, across 90 files |

Every one of the 320 is in a test file — there are no pre-existing non-test errors mixed in, so the
baseline has nothing to argue about. The entry measured **282 across 83** on the same day; it is now
320 across 90, which is itself the argument for a ratchet rather than a sweep.

**A real broken reference, and it is the case the entry was opened on.**
`lib/__tests__/ai-dynamic.test.ts` uses `import('../types/program').MuscleAssignment` twice and
`lib/types/program.ts` does not exist. The spec passes today.

## A ratchet, copying the hex-literal pattern

Every file holding errors is recorded at its current count and may only shrink; a file not listed
must have zero; a row for a file that is now clean must come out, or the list rots into an allowlist
that lets errors back into a file somebody already fixed. Three mutations, three caught:

| mutation | result |
|---|---|
| a type error in a file with no baseline row | *this file had none* |
| push a baselined file one over its number | *9 error(s), baseline 8* |
| a baseline row for a file with no errors | *rows to delete* |

**A run that produces no diagnostics at all is treated as a failed run, not a clean one.** `tsc`
exits non-zero whenever it reports errors — which is the normal case here — so the exit code cannot
distinguish "320 errors as expected" from "tsc fell over". Against a non-empty baseline, zero
diagnostics means the run did not happen.

## Two placement decisions, and the second was nearly wrong

**A second tsconfig rather than editing the first.** `tsconfig.json` is what `next build` reads;
dropping the exclusion there would put 320 errors in front of the Build job — a different and much
larger change than making new specs typecheck. `tsconfig.tests.json` extends it and overrides only
`exclude`, so the two projects cannot disagree about anything else.

**The step is in Build, not Custom Rules — the entry said Custom Rules and that would have failed
CI.** Custom Rules has no `setup-node` and no `pnpm install`: every step there is a dependency-free
`node scripts/*.js`, which is what keeps that job at ~25 seconds. This check needs `tsc`. Build
already installs and already typechecks, so it costs ~27 s there and nothing anywhere else. Found by
reading the workflow rather than by a red run.

Locally it is `pnpm typecheck:tests`, and `ci:local` now includes it — otherwise the local gate would
be quieter than CI, which is the failure this entry is about.

<a id="2026-09-01-verify-main-nightly"></a>

# 2026-09-01 · Lane A — the flake had a cause, and `main` gets a nightly (LB-31)

Branch `lane-a/verify-main-nightly`. Two files, no migration, no product behaviour.

## ① The test was passing on a race, and the entry had half the mechanism

`anchor-source.test.ts` failed once on CI — `expected 'readiness' to be 'sleep'`, then 55 where 77
was written — and never anywhere else. The entry recorded an hour of hunting: green in isolation,
green across `app`, green on the full suite against a fresh database, green on a re-run of the
identical commit.

Its diagnosis was that the second test's own sleep row lets the route build **and persist** a
readiness, out-ranking the `sleep` rung it asserts. That is right, and on its own it predicts a
failure every run — which is not what happens. The missing half:

```ts
if (derivedReadiness == null && !todaySnapshot && readinessPlausible) { … }
```

…and the route's snapshot write is **fire-and-forget**:

```ts
repo.upsertBodyBatteryDaily(userId, { … }).catch(() => { /* best-effort */ })
```

So test 1's GET returns before its snapshot row lands. If the row arrives before test 2 runs,
`!todaySnapshot` gates the build off and the anchor falls to `sleep` — pass. If it loses that race,
the build runs, persists, and the anchor comes back `readiness` — the CI failure, followed by test 3
reading 55 instead of 77 because `resolveAnchor` prefers a persisted snapshot already sourced
`readiness`.

**The whole file was passing on a race between an unawaited write and the next test.**

## Reproduced on demand, which is what makes this a diagnosis

Run the second test **alone** on the unstubbed file — test 1's snapshot never exists — and it fails
with CI's exact message, every time. That is why a whole-file run never reproduced it: in order,
test 1's write almost always wins.

The fix stubs `buildReadinessPayload`, which is the entry's own second option (*"make the readiness
build injectable so the precedence ladder can be exercised one rung at a time"*) with vitest as the
injection, so no production code is shaped to suit a test. The same isolated run then **passes**.

**I nearly shipped the stub with a wrong justification.** A first pass asserted the builder *is*
called in test 2, to prove the stub was load-bearing. It failed — the builder is not called in file
order — and chasing that is what turned up the snapshot gate and then the unawaited write. An
assertion that fails for a reason you did not predict is worth more than one that passes.

## ② A nightly `Tests` run against `main`

`ci.yml` has no `push: [main]` trigger, and the reasoning is sound: `main` is protected, reachable
only through an already-green PR, and re-running costs ~11 billed minutes per merge for a result the
PR run already produced. **That is not touched.**

The gap it leaves is different: a PR is green against the `main` it was cut from, and nothing
re-checks the *combination* after several land together — five merged during the run that produced
this entry. A defect from that interaction first appears as the **next** contributor's red check, on
code they never wrote.

So: `schedule: '0 17 * * *'` (03:00 Brisbane, after the day's merges), with `if: github.event_name !=
'schedule'` on every job except `test`. A night costs one job rather than six, and a failure names
`main` and the merge window instead of an innocent PR.

It is not a merge queue and does not pretend to be — it reports the combination breaking, it does not
stop it landing. If it ever fires, that is the evidence for the larger change. Reversing it is
deleting the `schedule:` block and six `if:` lines.

<a id="2026-09-01-verify-vs-gate"></a>

# 2026-09-01 · Lane A — a gate that does not gate (BF-90)

Branch `lane-a/verify-vs-gate`. Tooling and a field sweep. No migration, no runtime code, no device.

## The owner's question, and the answer he did not expect

*"is there anything we can do to lower that? with our e2e and sentry etc cant you do the testing
thats needed?"* — asked about the number of queued items waiting on him.

The assumption was that his decisions are the bottleneck. They are **10 of 41**. Device verification
is the other 31, and eleven of those thirty-one sat on entries whose own headings said *"shipped;
device check owed"*. They block nothing. But `Gate:` **parks** an entry, so `next-item.js` filed
finished work under PARKED beside work that genuinely cannot start.

## `Gate: device` meant two opposite things, and the docs had picked the wrong one

The protocol block said, in bold: *"`Gate: device` means SHIPPED and awaiting a device check — never
'will need one when built'."* That made it the one gate that does not gate. Meanwhile PS-8 carries
*"Phase 0 cannot start without the physical R09 in hand"* and PS-11 needs the ring worn overnight —
real blocks, written as gates, in direct contradiction of the documented rule.

So the field genuinely carried both meanings and the documentation had committed to the half that
should not park.

`Verify: owner` / `Verify: device` is the second meaning, given its own field and its own **VERIFY**
section. `Gate:` now means blocked, uniformly — which is what the word says, and what makes the
parking behaviour follow from the field name instead of from a rule nobody re-reads.

## The entry said eleven. The existing tooling found six more.

BF-90 identified its eleven by their headings. Running `keepKind` — the classifier OR-100 shipped
this morning — over every remaining `Gate: device` found **six more** whose own `Keep:` residue is a
check rather than a build: BF-76, BF-53, BF-26, BF-27, TN-13, Q-93. Seventeen converted, not eleven,
and the extra six came from a rule already in the repo rather than from a judgement call.

`check-backlog-pointers.js` now reports any `Gate: device` whose `Keep:` reads as a check, using
that same classifier — advisory, never failing, in the posture OR-100 established. An empty list is
today's real state rather than an untested branch.

## The mutation that mattered

Four mutations, three killed immediately. The one that survived was **moving the `Verify` check
above the park test** — and it survived because no entry in the queue happens to carry both a
`Verify:` and a real block, so the rule that stops a `Verify:` rescuing blocked work was completely
untested.

That is why the classification came out of `next-item.js` and into `scripts/lib/queue-buckets.js`:
one pure `bucketFor(entry, reasons)` with the ordering argument written above it, exercised against
synthetic entries the real queue does not contain. Both surviving mutations die now.

A second test bug came out of the same pass. `expect(parked).not.toContain('BF-53')` failed while
BF-53 was correctly in VERIFY — another entry's `Needs: BF-53` line prints inside PARKED, so the id
appeared there without the entry doing so. The assertion was wrong, not the code. It matches at the
start of a row now.

## The bigger half, measured and deliberately not shipped (LA-49)

`next-item.js` also parks on any `⛔` in an entry body. **34 entries contain one. Seven use it to
mean blocked** — and one of those seven is struck through and marked `✅ CLEARED`. The other 27 use
it as emphasis: *"⛔ Do NOT impute the check-in on unlogged days"*. So the false-park count from this
one glyph is larger than the entire `Gate:` problem BF-90 was opened for.

Narrowing the detector to the file's own documented `⛔ blocked:` form was measured: 27 entries leave
PARKED, **16 of them into READY**. And that is why it is not in this PR. The 16 include `BF-14`,
whose heading opens *"❌ REFUTED 2026-08-24"*, and `Q-49`, marked 🔴. They are mis-filed today, held
out of sight by a `⛔` and nothing else; narrowing the detector would move them to the top of the
work list rather than fix them. Trading a section nobody reads for a section an implementer starts
from is the worse failure.

Filed as **LA-49** with the measurement and the required order: triage the 16 first, then narrow the
detector.

One `⛔` was corrected here, because it needs no judgement: TN-13's sat on a question its own
sentence calls *"ASKED AND ANSWERED 2026-08-31. No. Do not re-open."* An answered question was
parking a shipped entry.

## Result

PARKED 114 → 97. VERIFY 17. READY and KEEP unchanged — nothing was mis-promoted. The count the owner
was given is now honest: **10 items wait on him**, seventeen wait on a phone, and the rest are work.

Verified by `pnpm check:rules` (**Ran 67 of 67**) and the full suite. **Not exercised:** nothing
runtime changed, so there is no device surface here.

<a id="2026-09-02-bf-105-walk-phase-cue"></a>

# BF-105 — the guided walk's phase change now lands on the screen

**Branch:** `feat/bf-105-walk-phase-cue` · **Lane:** B · **Domain:** `[activity]` `[app-shell]`

The owner, mid-walk, with a screenshot: *"there isn't enough of a queue to indicate session phase
changed. needs more sound and possible visually cues."*

## The cue was firing; it carried nothing

The entry had already established this and it held up: `scheduleWalkCues` posts one local
notification per boundary, the `workout-timers` channel exists at importance 4 with vibration, and
`USE_EXACT_ALARM` puts it on the `setExactAndAllowWhileIdle` path. Nothing about the timing was
wrong.

What did not exist was any in-app response. `walk-active.tsx` called `hapticSuccess()` once, at
`e >= plan.totalSec` — the end of the whole walk. On a segment boundary the screen's entire reaction
was one word swapping and changing colour, with the countdown resetting beside it. Everything else —
bpm, spm, steps, the pacer bar — was unchanged. That is easy to miss while walking and looking up,
which is the reported failure.

## What shipped

A haptic per boundary, keyed on `active.segment.index` rather than a timer, so it fires exactly once
per change however often the 1 Hz tick re-renders. `hapticSuccess` for fast, `hapticLight` for
everything else: through a pocket the pattern is the whole signal, because the notification's text is
unreadable and both directions post to one channel with one sound.

**It deliberately does not fire on mount.** The screen mounts with an active segment when a walk
already in progress is reopened, and buzzing there announces a change that did not happen. That is
`shouldCuePhaseChange`'s only job, and it is the assertion a naive version fails.

Visually, a vignette wash of the incoming phase's colour plus the phase word scaling in rather than
swapping. **A vignette rather than a full overlay, deliberately:** peripheral vision is what has to
catch this — the walker's eyes are on the path — and a centred wash would dim the readout it is
drawing attention to. Under `prefers-reduced-motion` the wash still fires, longer and without the
word's scale, per the repo's convention that a functional indicator keeps its state and loses its
motion. Here the flash *is* the state.

`walk-cues.ts:44` said the opposite of the truth — its catch block claimed *"the in-app timer still
drives cues when foregrounded"*, and there was no such path. That comment is why the entry read as
handled for as long as it did. Corrected.

## Two corrections to the entry's second half

Both measured rather than reasoned, and both change what that half costs:

**Do not delete `workout-timers`.** The entry says the old channel should be deleted "so the app's
notification settings don't accumulate a dead row". It is not dead: `lib/notifications.ts:76` posts
the workout rest-timer alert to it. Deleting it silences every rest alert in the app.

**Two channels cannot differ by feel without a sound file.** The pinned plugin's `Channel` type
exposes `vibration?: boolean` — a flag, not a pattern — so `walk-cue-fast` and `walk-cue-slow` could
only differ by one of them not vibrating, which is worse than today. Distinguishing them needs
`sound?: string` against a file in `android/app/src/main/res/raw/`, **which is an APK change**. So
the whole second half is APK-gated, not the JS-only work the entry describes. BF-105 stays queued on
`Gate: device` with that written down.

## Verification

14 unit tests driving the two exported decisions directly, with **seven mutations killing them**:
cueing on mount, one haptic for every kind, firing on every render, advancing the last-cued index
only when a cue fired, dropping `relative` so the wash escapes its container, flashing before any
change, and ignoring reduced motion.

One e2e spec seeds a walk in progress and watches a real boundary in a browser: the walk opens on
Slow with no flash in the DOM, and after the boundary the word reads Fast and the flash is there.
Both assertions are durable rather than racy — the flash stays mounted once cued, so nothing has to
catch an 800 ms animation mid-flight.

`pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint clean.

## Not exercised

**The haptic, which is the half the report is actually about.** `Haptics.impact` is a Capacitor call
that no-ops off the APK, so the pocket case cannot be reached from the sandbox at all — the e2e spec
proves the visual half and nothing about the feel. Also unexercised: whether the two patterns are
actually tellable apart through a pocket while walking, which is a judgement only the owner can make,
and the notification path itself, which was already working and was not touched.

<a id="2026-09-02-bf-107-walk-calories"></a>

# 2026-09-02 — the walk summary shows its calories (BF-107)

**Lane B · branch `fix/bf-107-walk-calories` · v1.434.0**

*"the final screen doesnt show calories burned."* The walk summary rendered three tiles — Duration,
Avg HR, Max HR — and no energy, on a screen that already carries per-interval cadence, a heart-rate
chart, time in zone and Session Load.

## The number was already reaching the client

`POST /api/activity-logs` answers `{ activityLog }` with the derived calories on it. The web branch
checked `res.ok` and threw the body away.

The value is computed server-side and cannot move: `estWorkoutKcal`'s MET table is read through
`node:path`, so it cannot be imported into a client bundle. That is why the client sends
`caloriesBurned: null` and why the figure exists only *after* this screen has painted.

## The device path needed more, and that is the half that matters

The entry noted it in passing and it turns out to be the whole fix on the canonical runtime:
`pushMutations` only flips the row to `synced` — **the derived value lands on a pull.** So the fix
forces one (`pullDelta(userId, true)`) inside `pushThenRevalidate`'s callback and reads the row back.

**Without that the tile is a dash forever on the device**, which is the reported bug left unfixed
while looking fixed. It stays inside the callback rather than replacing it, because that callback runs
only when something was actually pushed, and because revalidating *around* a local write rather than
after it is its own bug class with a CI rule attached.

Until either path lands, the tile reads `—`. Never `0`: a zero is a claim about a walk that burned
nothing, and offline that is the only state the tile ever reaches.

## The sibling claim in the entry was wrong

It said `done-activity-screen.tsx` takes the same write path and has the same gap, to be fixed in the
same PR. It does take the same write path — but it **navigates away the instant it saves**
(`router.push('/workout-select')` at lines 264 and 310), so its stat grid is a *pre-save draft
summary*. A calories tile there would render `—` and then the screen would vanish.

Checked rather than assumed, and recorded on the entry so the next reader does not add a dead tile.

## One tile, one primitive

The stat markup existed twice and had **already drifted** — `rounded-2xl` in the walk summary against
`rounded-xl` in the sibling — which is the drift a shared primitive exists to stop. It is
`components/ui/stat-tile.tsx` now. The sibling's inline copies are left: converting them is a pure
refactor of a file whose behaviour this entry does not change, and it is recorded as a `Keep:` rather
than used to widen the diff.

The grid went from three columns to four. Four tiles in a three-column grid strands one on a second
row, and the label is `kcal` rather than `Calories` because four labels share 412 dp minus the
gutters — the sibling screen already labels its tiles by unit (`min`, `km`).

## Verification

6 tests, **five mutations kill them**: the tile showing `0` instead of a dash, the grid staying at
three columns, the web response being discarded again, the device path pushing without pulling, and
the local `Stat` copy coming back. Full unit suite **6,351 tests**; `pnpm check:rules` **Ran 67 of
67** — including the rule about revalidating after a local write rather than around it, which the
device path had to satisfy. `tsc` and lint clean.

**Not exercised:** the device, and it owns both interesting cases. **(a) Offline** — finish a walk with
no signal and the tile must stay `—`; the push never happens, so nothing fills it, and the sandbox
cannot produce that. **(b) The fill itself** — the `—`-then-number transition depends on a real pull
returning a real derived row. Also unchecked: whether four tiles sit comfortably in one row at 412 dp.
Assertions here are source-level because the screen needs a canvas, a native SQLite store and a real
save, and both vitest projects run `environment: 'node'`.

<a id="2026-09-02-bf-108-activity-store-stale"></a>

# 2026-09-02 — a finished walk no longer arms the Start screen (BF-108)

**Lane B · branch `fix/bf-108-activity-store-stale` · v1.435.0**

The owner, after a guided walk: *"after closing it - it still opens with the activity naming screen"* —
with a screenshot of Walk / *"Walk Home From Train"* / **Start**. The app's answer to "you finished a
30-minute walk" was a screen offering to start one, pre-titled with the walk they had just done.

## The entry blamed the wrong path

It says *"`startActivity` already resets from `INITIAL_STATE`, so the gap is only on the completion
side"*. **The completion side already resets.** `done-activity-screen.tsx` calls `resetSession()` on
both save paths (lines 263 and 309), and `pre-activity-screen.tsx` calls it on Back. A saved or
cancelled activity has always left clean state.

**What survives is a session abandoned before saving.** `onRehydrateStorage` demotes two shapes to
`pre` — a `done` session, and an `active` one past the 12-hour recovery bound — and **neither cleared
`activityType` or `title`**. So `activity-screen.tsx` rendered `PreActivityScreen`, pre-armed, instead
of falling through to `SelectActivityTypeScreen`. Reached by killing the app at the summary, or by
leaving a recording running for half a day.

That is the persisted-store class CLAUDE.md already names — *screen modes, in-flight flags, and
per-screen payloads never survive a reload* — and a `title` typed for a finished activity is a
per-screen payload. The rule listed four incidents; this is the fifth shape.

## What shipped

`clearActivitySetup` runs on both demotion branches, clearing type, label, icon, distance flag, title
and prescribed run. With the type null, the screen falls to the picker.

**The reconciler was lifted out of `onRehydrateStorage` so it can be driven directly.** `persist` does
not expose the hook, so the first version of these tests mirrored it — and a mirror that drifts is a
test of itself. `reconcileRehydratedActivity` and `clearActivitySetup` are exported now and the tests
call the real functions.

**Q-450 is intact and pinned.** A live `active` session inside the bound keeps its type and its
points, so it still returns to its own screen rather than a picker that would drop the recording. The
boundary is asserted as `>` rather than `>=`, because an off-by-one there silently discards a
recording.

## Where Done goes

`/health`, not `/activity`. The walk was just saved, and the activity tab is a screen for *starting*
one; Health carries the activity-history card, so the walk that just ended is on the screen it lands
on.

`/cardio` was the other candidate — it is where the walk was launched from — and loses for the same
reason as `/activity`: it is where you go to begin one, not where you see the one you did.

## Verification

8 tests against the real exported functions, **six mutations kill them**: either demotion branch
dropping the clear, `clearActivitySetup` also wiping the recording, the bound flipping to `>=` so a
live session at the boundary is discarded, the reconciler clearing a live `active` session, and `Done`
going back to `/activity`. Full unit suite **6,359 tests**; `pnpm check:rules` **Ran 67 of 67**; `tsc`
and lint clean.

**Not exercised:** the device, and it owns the case that matters most. The Q-450 path — an activity
interrupted mid-record still returning to its own screen — needs a real kill and relaunch, which the
sandbox cannot do. The reported symptom is reachable there too: kill the app at a walk summary, then
open the activity tab.

<a id="2026-09-02-db-growth-archive-attribution"></a>

# 2026-09-02 — the database's growth is partly the archive the baseline predates

**Branch:** `claude/la-db-growth-archive` · **Agent:** Implementation Lane A · Docs only.

BF-55 asks for a re-read of the total (*"it has not been read since 2026-08-30"*) and for what is
adding ~2.5 MB/day beyond expectation. Both were done from production.

**The re-read: 200 MB**, down from BF-55's 206 because migration 249 landed on 09-01 and took the
21 MB `oura_heartrate_user_updated` with it. Verified rather than assumed — `oura_heartrate` now
carries exactly two indexes, the `(user_id, timestamp)` unique key at 84,909 scans and its primary
key.

**The attribution: the archive, and it must not be treated as a defect.** `oura_raw_packed` holds
1,072 rows / 18 MB, and its **first pack is dated 2026-08-18 — the same day as the 171 MB
baseline**. It has grown 18 MB in 15 days, about 1.2 MB/day, and it is never pruned because
`body_hex` is the archival source of truth. That is ~62% of everything the database has gained since
the baseline, and it means **the ~0.4 MB/day expectation cannot have included it**: the packing work
that produced the baseline created a new permanent writer on the same day, at a rate nothing had yet
observed. Part of the "7× trend" is an expectation that was never re-baselined against the archive it
made possible.

The design is working as intended. `oura_raw_samples` is a rolling window — `ring_timestamp_ds`
spans 7.58 days across 189,406 real rows at 73 MB — and the archive takes the overflow at roughly an
eighth of the raw size. Forward, that is ~440 MB/year of permanent archive on a 5 GB volume. The
remainder, ~0.7–1.7 MB/day depending on the window, is what BF-55 still owes, and the archive should
be excluded from the next attempt rather than counted again.

**Q-283 is stale by ~14× and probably wants closing, not implementing.** Its headline is
*"~11 MB of indexes have never served a scan"*. Its one real candidate is the 5.7 MB index BF-55
already dropped. What remains: 117 zero-scan indexes at 7,528 kB, of which all but **30 indexes /
800 kB** are primary keys and unique constraints the entry itself says must never be dropped. The
largest survivor is a 128 kB `db_query_log_created_at_idx`. That is 0.4% of the database, for a
destructive migration — so the entry is gated rather than struck, because closing it is a queue
decision.

One reading cuts the other way from how it first looks: `pg_stat_database.stats_reset` is **NULL**,
so the counters cover the database's lifetime, which makes "never scanned" *stronger* than the entry
assumes — and still does not make a constraint index droppable. BF-55's counter-example holds today:
`rr_intervals_pkey` read 0 on 2026-08-30 and reads 10,930 now.

**The estimator trap recurred, exactly as CLAUDE.md describes it.**
`pg_stat_user_tables.n_live_tup` reported **76** rows for `oura_raw_packed` against **1,072** from
`count(*)`, on a table whose `last_autoanalyze` is NULL — while the size columns in the same row were
exact. That is the reading that once produced a data-loss incident which had never happened.

**Also checked and needing nothing:** production `error_events` over 7 days holds four rows. Three
are `"SpeechRecognition.then()" is not implemented on android` (2026-08-27 → 08-30), and that fault
is **closed** — `getNativeSpeech()` returns `{ plugin }` rather than the proxy, with a regression
test and `scripts/check-plugin-proxy-thenable.js` enforced in the Custom Rules job. The other two are
`POST /api/oura-ble/samples` "aborted" on 08-30, a client disconnect mid-upload, which has not
recurred.

**Not exercised:** no code changed. Every figure is a production read through `claude_ro`; note that
`pg_stat_user_tables` and `pg_stat_user_indexes` are NOT row-scoped, so unlike the rest of that
schema these numbers are database-wide rather than the owner's only.

<a id="2026-09-02-docs-lane-b-queue-hygiene"></a>

## 2026-09-02 — the plan card gets an e2e, and Lane B's queue stops offering work it cannot start (LB-51, Q-297, Q-138)

**Branch:** `docs/lane-b-queue-hygiene` · **Lane:** B · **No version bump** — a spec and queue edits
change nothing a user can see.

### LB-51 — `e2e/plan-rescale.spec.ts`

Q-187 shipped verified by hand against a local database, which proves it worked once and leaves no
regression net. This is the net: two tests covering the re-scale and the floor. **Four mutations kill
it** — removing the re-scale, removing the floor, next-meal-only, and dropping the `(planned N)`
figure from the row.

- **The entry's own recommendation was the wrong shape, and the correction is the useful part.** It
  proposed stubbing `GET /api/nutrition/meal-plans`. **A spec here can talk to Postgres directly** —
  `food-logging-complete.spec.ts` opens a `pg` `Client` on `process.env.DATABASE_URL` — so the
  fixture is built in the database and torn down in `afterAll`, which works on CI's fresh instance
  with no stub at all. A stubbed plan against real food would have tested half the sum anyway:
  `eaten` comes from the day's real `food_logs` through the page's own pipeline.
- **The assertion is the invariant, not a number.** The adjusted figures sum to the target minus what
  was eaten, both read off the card, so the fixture's calories can change without touching it. It
  also asserts the *direction* — scaled down when the day is over its share — because "different from
  planned" would pass against an arbitrary rewrite.
- **The tap gotcha is written into the spec.** `Show N meals` needs `tapCentre`; a forced `.click()`
  leaves `aria-expanded` at `false`. That is Q-354 on the Nutrition screen, and it cost the most time
  of anything in Q-187.
- **Keep:** the rest of the plan card is still uncovered — log-all, per-meal log and decline,
  save-to-My-Foods. The fixture is the hard part and they can reuse it.

### Q-297 — down to two residues, one of them the owner's

Everything buildable had already shipped, four of the five under other entries' numbers. What is left:

1. **A warmed-server instant-paint budget.** The 20 s skeleton budget catches a card that *never*
   seeds; it cannot tell "seeds instantly from cache" from "seeds in 8 s off the network", because
   the harness runs `pnpm dev` and handlers compile on first call. Measuring the second wants a tight
   timing budget on a shared CI runner, which is a flaky-test generator. Deliberately or not at all.
2. **Whether the E2E job becomes a required check — the owner's, because it is branch protection.**
   **Measured rather than read: E2E is NOT required today** — PR #776 merged while its E2E job was
   still `in_progress`. LA-22 has since made the job always-run and always-report specifically so it
   is safe to require, so the only remaining question is whether to. Marked `Gate: owner`.

### Q-138 → `Reference:`

It was heading Lane B's work list while its own text says *"Take them opportunistically when already
touching the file, not as a dedicated PR."* An entry that offers a build it argues against costs
every session that reaches it a read — the same shape as Q-354, reclassified the same way the day
before. Re-measured the four files, since two had drifted from the table's numbers:
`workout-screen.tsx` **1833**, `session-select-content.tsx` **1448**, `config-screen.tsx` **997**,
`program-editor-sheet.tsx` **963**.

### The queue, before and after

Lane B's `READY` list went from **11 entries to 5**, and the five are genuinely startable — with the
exception of LB-47, which is flagged as needing an owner call. Three of the six removed were not
finished work: **BF-104** and **BF-102** were split (LB-49, LB-50) because their Lane B halves each
needed Lane A engine work first, and **Q-138** was reclassified. An implementer who reached any of
them before this would have read the entry, started, and stopped.

### The baton

`docs/agents/state/implementation-lane-b.md` rewritten in full — it still said *"Next ID: `LB-45`"*
and described the run before this one. Rewritten, never appended, per the contract: a baton that is
half last week's is worse than none, because it gets trusted.

### Not exercised

Nothing device-verifiable shipped here. The device debt from this run is enumerated on the baton and
is now roughly seventeen screens.

### Q-111 — two corrections, from reading the tree rather than the entry

Scoping the next item turned up an entry that describes code which is not there.

1. **The ring half's stated outcome is not in the tree.** Q-111 says *"✅ RING HALF DONE … wired into
   the Home header beside the weather chip"*, naming `oura-battery-chip.tsx`. **No such file exists,
   and the Home header renders `WeatherChip` and nothing else beside the date.** The ring battery
   renders on Health and More (`components/health/oura-section.tsx`, `components/more/oura-section.tsx`)
   — which fits the v1.270.30 changelog's own wording, *"The chip existed but was reading the Oura
   Cloud value"*. **Git cannot settle whether it regressed or never reached Home:** history begins at
   the public snapshot on 2026-08-16, after the 2026-08-08 claim. Either way the header is empty
   today, so the ring half is open.
2. **The strap battery is already read and displayed — during pairing, by a different route.**
   `components/settings/chest-strap-pairing.tsx:87-139` reads the standard Battery Service
   characteristic over browser BLE and renders `Battery N%`. The entry's *"no JS call site reads it"*
   is wrong as stated. What is true: **nothing reads `PolarBleStatus.battery`** — the native
   service's value, delivered by `getStatus()` and the `polarStatus` listener — and nothing persists
   either number. That is **a second source for one value**, the class this repo keeps paying for.

Neither was built here. The point of recording them is that an implementer taking the entry at its
word would build the strap half against a false picture of both ends — and would spend the first hour
looking for a file that does not exist.

<a id="2026-09-02-feat-bf-104-meal-scale"></a>

## 2026-09-02 — log a meal at ½× / 1× / 1½× (BF-104, v1.431.0)

**Branch:** `feat/bf-104-meal-scale` · **Lane:** B

The owner: *"when logging food/meals we should be able to choose how much of the meal; i.e full at 1x
or 1.5 or 0.5 etc."* LB-49 — the engine half this entry was split from earlier today — put the
`scale` argument through `logMealItems`. This is the surface that sets it.

**The split worked.** BF-104 was `PARKED` behind LB-49 this morning and became the queue head the
moment LB-49 merged, which is the whole point of filing the two halves separately rather than
skipping the entry.

### The picker had to change the sheet's own figures, and that was not in the entry

The meal detail sheet's headline calories and macro columns are documented in that file as *"per
portion — that is what `Log this meal` writes"*. **The moment the button can write 1.5 portions, a
figure fixed at one stops describing the button** — the two-numbers-for-one-thing class LA-45 and
BF-99 each closed. They scale with the picker now, and the label under the headline says which
portion it is showing (`per portion` → `1½× portion`).

### Decisions

- **`SegmentedTabs`, not `QuantityEditor`.** The entry said to reuse rather than add a third quantity
  control. `QuantityEditor` is the wrong one to reuse: it edits a **single food** in grams or
  servings, with a stepper, a unit toggle and macro tiles. This is a **meal-level** portion, and the
  primitive `QuantityEditor` itself uses for its own toggle is the one that fits.
- **Discrete taps, never a free-number field** — the entry is explicit, and a keyboard for a value
  that is almost always one of three is the worse control besides.
- **The values live in a `.ts`, the picker in a `.tsx`.** Both vitest projects run
  `environment: 'node'` and cannot parse a `.tsx`, so anything asserted directly rather than by
  source-scan has to live outside the component. The split is the better shape anyway.
- **The row's one-tap log is unchanged**, defaulting to 1. Only the detail sheet passes anything else.
- **Reset to 1× whenever a different meal opens.** A portion is a fact about one sitting.
- **The scanned-label path deliberately has no picker.** `handleScannedSavedMeal` is scan-and-go in a
  kitchen; interrupting it with a portion question is the opposite of what that flow is for.

### Verification

- 11 unit tests, **seven mutations kill them**: the factor never reaching `onLog`, the scale never
  reaching `logMealItems`, the displayed figures not following the picker, no reset between meals, a
  free-number field instead of taps, a fourth scale, and a changed quick-log default.
- `e2e/meal-portion-scale.spec.ts` — 2 tests on the real sheet, **three mutations kill them**. The
  headline moves **400 → 200 → 600** with the picker, and logging at 1½× writes
  `quantity_multiplier` **1.5** — **read back from the database**, not from a toast, because a UI
  that said "logged" while writing 1 would look identical.
- `pnpm check:rules` **Ran 67 of 67**; full unit suite (740 files, 6,292 tests), tsc and lint clean.

**Two locator traps, both found by the specs failing first:** `getByText('per portion')` matches the
library sheet's own footnote (*"Meal calories are per portion…"*), and `getByRole('tab', {name: '½×'})`
also matches `1½×`, whose label contains it. Both needed `exact: true`.

### Not exercised

- **The device.** Three segments join an already-full detail sheet at 412 dp, each on the 48 dp
  floor, directly above the action row. Whether the sheet still fits without scrolling to reach
  `Log this meal` is unchecked.
- **⚠ `saved-meals-sheet.tsx` is at 798 lines against the 800 limit** — two lines of headroom, and it
  is **not** in `check-component-size`'s baseline, so the next addition fails as a *new* file over
  the limit rather than as a tracked hotspot. Extract before adding there.

<a id="2026-09-02-feat-home-device-battery-chips"></a>

## 2026-09-02 — device battery chips on the Home header (Q-111, v1.430.0)

**Branch:** `feat/home-device-battery-chips` · **Lane:** B

The owner asked for small icon+battery chips on Home for the ring, chest strap and scale — ring
always-current, strap/scale live-when-connected and last-seen-when-disconnected.

### The entry was wrong about both halves, and finding that out was most of the work

- **It claimed the ring half was done and on the Home header.** There was no `oura-battery-chip.tsx`
  and no chip in the header — `session-select-content.tsx` rendered `WeatherChip` and nothing else
  beside the date. The ring battery rendered on Health and More only, which fits the v1.270.30
  changelog's own wording, *"The chip existed but was reading the Oura Cloud value"*. **Git could not
  arbitrate whether it regressed or never reached Home:** history begins at the public snapshot on
  2026-08-16, after the 2026-08-08 claim. So the ring chip was simply built.
- **It claimed no JS call site reads the strap battery.** `chest-strap-pairing.tsx` reads the Battery
  Service characteristic over browser BLE while pairing and renders `Battery N%`. The true half is
  that **nothing reads `PolarBleStatus.battery`** — the native service's value — and nothing persists
  either number. So the defect was never a missing read; it was **two numbers in two screens with no
  relationship**.

### What shipped

- `components/home/header-chips.tsx` — the header row: weather, then whichever devices have a
  reading.
- `components/device-battery-chip.tsx` — the shared pill. Presentational and scalar-only, because
  the two call sites differ entirely in where their number comes from.
- `lib/stores/strap-battery.ts` — the last-seen value, in `localStorage` with a timestamp.
- `lib/hooks/use-strap-battery.ts` — seeds from the store, then subscribes to `polarStatus` and
  calls `getStatus()`, writing every reading back.
- `chest-strap-pairing.tsx` now writes its reading into the same store. **The direct read stays** —
  at pairing time the native service is not running, so it is the only source there is — but it stops
  ending at a local `useState`. One store, two writers, so the chip has a value from the first
  pairing rather than waiting for a workout.

### Decisions

- **A stale reading is shown muted, not hidden.** A chip that vanishes on disconnect reads as "no
  strap" rather than "not connected right now", which is a chest strap's state most of the day. Age
  goes in the accessible name: the pill has room for a number and not a sentence.
- **`localStorage`, not a user preference.** It is a fact about one strap paired to one phone —
  syncing it would carry a lie to a second device.
- **The store refuses an implausible percentage** rather than storing it. A strap that has not
  finished its first Battery Service read reports `null`, and a stored `0` would render as a flat
  battery forever.
- **⚠ The header could not grow.** `session-select-content.tsx` is shrink-only in
  `check-component-size.js`, and the rule there is extract rather than append. The one `WeatherChip`
  dynamic-import line and its one usage became `HeaderChips` — **net zero** — with the new chips
  inside it.
- **`useCachedValue`, not a fetch-once effect.** The header is in the persistent tab shell, so a
  `useEffect(…, [])` around `cachedFetch` would hold its first payload until the app is killed
  (Q-402). `check-fetch-once-effects` caught the first draft doing exactly that — the rule earned its
  place again. `today: true`, because the existing Health site calls `cachedFetchToday` and the
  variant is a property of the key.
- **No scale chip.** No battery capability exists for it anywhere, not even a one-shot native read.
  A chip that could never have a value is worse than its absence.

### Verification

- `lib/stores/__tests__/strap-battery.test.ts` — 17 tests. **Seven mutations kill it:** storing an
  implausible percentage, trusting whatever JSON is present, the pairing screen not recording, the
  chip growing its own source, a second cache key for the ring, the hook not listening to
  `polarStatus`, and reverting to a fetch-once effect.
- `e2e/home-device-battery-chips.spec.ts` — 3 tests, **four mutations kill them**: dropping the
  weather chip in the swap, not rendering the strap chip, hiding a stale reading instead of muting
  it, and drawing a chip for a device with no reading.
- **One of those mutations initially survived, and the test was weak rather than the code wrong.**
  `toHaveCount(0)` is satisfied by a page that failed to render at all, so the "no chip without a
  reading" test passed against a header crashing on a null ring — the exact defect it exists to
  catch. It now anchors on a chip that *is* present first. That is the "assert the matcher found
  something" rule, hit again.
- **The weather assertion needed two stubs**, and without them it failed against a working header:
  `open-meteo` is an external host the egress proxy drops, and without granted coordinates
  `useWeather` never asks for it. A spec failing for its own reasons is indistinguishable from a
  broken feature until you look.
- `pnpm check:rules` **Ran 67 of 67**; full unit suite (738 files, 6,275 tests), tsc and lint clean.

### Not exercised

- **The device, twice over.** Three pills now share a header row that BF-96 already found compresses
  badly at 412 dp when the date is long. **And the strap's live path has never executed** —
  `getPolarBle()` returns null off-device, so every strap reading in every test here came from the
  store, not from a strap.
- The ring chip has no data in the sandbox either: the seeded account has no BLE battery reading, so
  only its absence is covered.

### Left for the owner

The scale (new Kotlin BLE work, not Lane B's, and flagged a stretch), and whether the header's manual
refresh button should go. Measured rather than guessed: pull-to-sync bumps `refreshTick`, which drives
Body Battery, training-load, muscle-recovery and the HR chart; **the manual button does not bump it at
all**, so it is strictly narrower rather than merely redundant. That supports removing it — against
the real counter-consideration that a visible button is discoverable and a gesture is not.

<a id="2026-09-02-fix-bf-109-macro-calorie-warning"></a>

# 2026-09-02 — the Review sheet was the one food surface with no macro/calorie cross-check (BF-109)

**Lane B · branch `fix/bf-109-macro-calorie-warning` · v1.431.1**

The owner scanned barcode `9350167000490` and got **173 kcal** beside **45.7 P / 52.1 C / 13.6 F** —
macros that come to **514** by Atwater, a **197%** disagreement — and read it as a calorie-calculation
bug.

## The screen was right and the row was wrong

The entry had already established this, and checking it confirmed it rather than re-deriving it. OFF
carries, on the **same** per-serving basis the app used for every field, `energy-kcal_serving 173`
against `proteins_serving 45.7`. `offProductToNutrition` read `_serving` consistently. The mapper is
correct; that product's energy is wrong at source, and `energy-kcal_100g` is 173 ÷ 3.5 — OFF derived
the per-100g figure from the same bad number, so there is nothing in the row to fall back to.

**This is the third BF-109-adjacent thing worth recording: the entry was right about all of it.**
Six of the last several entries this session were wrong about something load-bearing. This one had
read the source row, the mapper and both halves of the shared check before filing, and every claim
held.

## The guard already existed and this was the surface without it

`macroCalorieDisagreement()` and `MACRO_MISMATCH_VISIBLE_LIMIT = 0.15` have been in
`packages/shared/src/nutrition/scan-totals.ts` since they were written, for this exact failure against
this exact data source — the docstring names it. The OFF text-search list surfaces the disagreement;
`/api/nutrition/scan` and `/api/nutrition/food-items` run `sanitiseNutrition`. The barcode path does
neither, and `logFoodEntries` deliberately does not sanitise. A sibling-surface gap, and no new formula.

## It covers more than barcode, deliberately

The entry frames this as the barcode path. The fix went into `review-step.tsx`, which is reached by
`handleScanResult` (**barcode and photo scan**) and by `handleManual`, so all three roads now carry the
cross-check. That is the sibling-surface rule read forward rather than a widening: putting it on the
barcode branch alone would have left the photo scan — same OFF-shaped data, same sheet — without it.
The check returns `null` unless both the stated calories and the Atwater sum exceed zero, so a blank or
half-typed manual form shows nothing.

## It warns and offers; it never rewrites

The entry is explicit and the reasoning holds: Review exists for the user to decide, and a screen
showing one number while the store keeps another is a worse bug than the one being fixed. It would also
destroy the legitimate case — fibre and alcohol put real foods 10–20% out, which is exactly what the
15% limit sits above. Declining the correction logs the label's own number, unchanged.

## The number fields had no accessible name

`numField`'s label is a sibling `<span>`, tied to nothing, so a screen reader read "spin button" and no
more, six times over. It carries `aria-label` now. That started as what lets a test address the Calories
field by name among six identical inputs, which is the honest account of how it was found — but an
unlabelled number input is a real defect on its own, and this is the file the change was already in.

## Verification

- **9 unit tests.** Two pin the **premise** — the owner's row at 1.97, and the 514 the warning offers —
  so a change to the shared check or its limit surfaces here as a number rather than as silence. Three
  pin what must *not* be flagged: agreeing macros, a high-fibre food a little out, and a genuinely
  calorie-free item rather than a divide by zero. **Six mutations kill them.**
- **`e2e/macro-calorie-warning.spec.ts` — 2 tests against the rendered sheet, and it exists because the
  unit guards cannot see the thing that matters.** They assert arithmetic and that the source contains
  the component next to the Calories field; neither renders anything. The spec drives the real fields,
  reads the warning's own sentence, checks the field still holds 173 **before** the tap, taps `Use 514
  kcal`, and checks it holds 514 and the warning is gone. **Five mutations turn it red**: the warning
  never rendering (`{false && …}`), an inert button, the threshold removed so it warns on everything, a
  rewrite on mount instead of on the tap, and an Atwater sum missing fat.
- One unit assertion had to be rewritten. `expect(src).toContain('<MacroCalorieWarning')` passed against
  `{false && <MacroCalorieWarning` — the text is still there while the warning never renders, which is
  the shape of guard that reads as coverage and is not. It is adjacency to the Calories field now, and
  its regex needs `[\s{}]*` rather than `\s*`, because `source()` strips `/* … */` and a JSX comment
  leaves its braces behind.
- `pnpm check:rules` **Ran 67 of 67**; full unit suite green; `tsc --noEmit` and lint clean.

The first draft of the component copied `macro-targets-pane.tsx`'s existing banner and its `#f59e0b`
literals, and `check-hex-literals` refused it. `--accent-amber` through `color-mix` is the token, and
`components/cardio/time-picker-sheet.tsx` is the pattern. A literal being present in the repo is not
evidence it is allowed.

**Not exercised:** no barcode was scanned — the e2e reaches the identical `ReviewStep` with the
identical props by the manual road, because a barcode needs a camera. So what is proven is the sheet's
behaviour given those numbers, not `/api/nutrition/barcode` delivering them. The device, safe-area and
Samsung WebView are untouched by the diff, but the banner is new UI between the Calories field and
Protein inside a sheet that already scrolls, and it has not been seen at 412 dp. Both are held open by
the entry's `Keep:`.

<a id="2026-09-02-la-47-coach-plan-card"></a>

## 2026-09-02 — AI Coach draws the meal plan, and one button puts every meal in My Foods (LA-47)

**Branch:** `claude/implementation-agent-lane-a-a5ih6n` · **Lane:** A, with Lane B's renderer in the
same PR · **v1.432.0.**

LA-47's second piece shipped 2026-08-31 (the named nutrition scope). This is the first: the plan
widget, which is what the owner's review was actually asking for — *"I want it to make the meal plan;
then add each item to the saved meals/my foods"*. The conversation is finished when every meal is a
row in `My Foods`, and until now nothing in a Coach thread could put one there.

### One PR across two lanes, because the split does not compile

The entry had already established this and it holds: `components/coach/widget-registry.tsx` narrows
by early return and falls through to `widget.patch.domain`, so a new union member is a **type error**
until a branch handles it. A branch rendering `null` would be worse than none — `widgets.ts` says so
about the chart — because the provider refuses a request containing an unanswered client-side tool
call, and the thread wedges permanently rather than for one turn. So the schema, the tool, the
registry branch and the component are one change.

### What it carries: a title, and nothing else

`showMealPlan`'s whole input is `{ kind, title, planId? }`. The card reads each meal, its calories
and its ingredient count from the plan the app already holds, for the reason `CHOICE_SOURCES` exists
— a nine-meal plan typed out by the model is several hundred output tokens transcribing a database,
and output tokens are essentially all of Coach's latency.

**The honesty argument turned out to be the stronger one.** A model that can write the meals can
write *different* meals from the ones stored, and nothing downstream would notice: a rounded calorie
figure, a dropped meal, or a set of numbers quietly reconciled to a target nobody asked it to hit.
There is nowhere to put them, and a test asserts that `meals` and `targetCalories` are stripped from
a payload that supplies them.

### The two buttons are not a new result type

`save_all` and `redo` resolve as ordinary `chose` results with fixed ids in `PLAN_CARD_ACTIONS` — a
card with two buttons is a choice list with a rich body. A fourth `WidgetResultSchema` status would
have made every consumer handle a shape that says nothing the label does not.

Save-all calls `savePlanMealsToLibrary` (Q-398, on `main` since 2026-08-24), which skips a meal that
already carries a `savedMealId`, so pressing it twice is a no-op and a saved meal shows a tick
instead of an offer. The `chose` label is the honest count — `Saved 2 of 3 meals` when a copy fails,
because that string is both the user's bubble and what the model reads back.

### The no-plan case resolves itself rather than hanging

A card with nothing to show would otherwise sit unanswered until the user typed past it. It sends
`{ status: 'stale', detail }` once the fetch has actually answered — never while `data` is still
undefined, which would cancel every plan card before its rows arrived. Exercised: with the plan
deactivated the thread read *"There is no active meal plan yet."* and the model carried on.

### Verified with a real Gemini turn, and the numbers checked in the database

`pnpm dev`, a seeded three-meal plan, nutrition scope. The model called `getMealPlan`, then
`showMealPlan` with a title and no meals. Clicking Save-all wrote three `saved_meals` rows with 3, 3
and 2 items and stamped all three `meal_plan_meals.saved_meal_id` values. Re-rendering showed three
ticks and a disabled button. Both action ids were fed back as follow-up turns: `save_all` got a
one-sentence confirmation and no repeated widget, `redo` got an offer to rebuild. A general-scope
swap turn still opens with `renderChoiceList` `source: "exercises"`, so the sixth widget tool cost
nothing there.

**Not device-verified.** `getLocalStore` returns null in the web sandbox, so the save took the API
fallback and the local SQLite write plus outbox mutation were not executed from this surface —
Known-Issues row in `projectOverview.md`.

### One correction to the design while building

The model titles the card with the plan's own name, so printing `plan.name` in the subtitle too gave
*"Lean bulk — 3 meals / Lean bulk — 3 meals · 2,600 kcal · 3 meals"*, which reads as a rendering bug.
The name is now named only when it differs from the title. Found by screenshotting at 412×891, not by
reading the JSX.

### What this unblocks

**Q-407's `Needs: LA-47` is cleared** and it is now Lane B's third READY item. What remains there is
the *conversation* — answers as widgets replacing the seven-step sheet, and pointing the Nutrition
tab at `/coach` with `scope: "nutrition"`, which the route already reads and nothing yet sends. The
plan card is built; do not rebuild it.

<a id="2026-09-02-lb-38-dump-captured"></a>

# 2026-09-02 — the share-code dump was captured, and it refuted my own reading of it (LB-38)

**Lane B · branch `fix/lb-38-torn-canvas` · no version bump · comments and docs only**

LB-38 has been open on one question: capture the pixels ZXing refuses and decode them offline, because
*"if the failing buffer decodes offline, the fault is in how the decode is invoked in-run rather than in
the image or the reader"* — the last mechanism nothing had eliminated. No dump had ever been captured.

## The capture

First run of a fresh batch, on `Ingredients · centred`, in the every-style loop — exactly where the
entry predicted it would be cheapest to catch. Five further runs were green, which fits the recorded
~1-in-19 rate; the first one was luck.

`node e2e/decode-share-code-dump.js` returned **null under all four** binarizer × `TRY_HARDER`
combinations. **So the fault is in the image, not in the decode invocation.** That is the entry's own
criterion, and it closes the mechanism it was opened to test.

## Then I got the next step wrong, and one more measurement caught it

The dump's ink is **0.0807**. The entry records the normal band as **0.172–0.179**, and I read 0.0807
as less than half — a textbook mid-repaint signature — wrote it up as confirming the entry's
mid-repaint hypothesis, and implemented the gate the entry prescribes for that case: settle the canvas
across rAF-separated reads, so a torn canvas is never sampled while a stable-but-unreadable one still
fails.

Before shipping it I logged the ink on a **passing** run, to check the gate was not inert. It is
per-style:

| style | ink, passing run |
|---|---|
| `Ingredients · centred` | **0.0800** |
| `Black band` | 0.1341 |
| `Plaque` | 0.0914 |
| `Big code` | 0.1732 |

**0.0807 is exactly normal for the style it came from.** The 0.172–0.179 band is the share-code test's
own style, and `~0.17` — what `darkFraction`'s comment said a drawn share code reads — is `Big code`'s.
I had compared one style's ink against another style's band. The entry's original finding, that a
failing attempt's ink sits in band and the buffer is not degenerate, was right the whole time.

**So the gate was reverted unshipped.** It costs ~0.5 min on the file and fixes a cause that is not
established, and this entry is explicit that the wrong fix here masks the flake rather than curing it.
Nothing in this PR changes test behaviour.

## What shipped instead

- `darkFraction`'s comment now carries the four measured per-style figures and says outright that
  reading ink as one number is what produced the wrong conclusion. The old `~0.17` is what made the
  mistake easy.
- `decode-share-code-dump.js` no longer prints *"unreadable despite normal ink"* — it cannot know that,
  since it is handed one dump and the band depends on the style, which the filename carries. It now
  says so and lists the figures.
- LB-38 records the capture, the offline result, the correction, and the cumulative list of eliminated
  mechanisms.

## I destroyed the dump

The batch loop `rm -rf`'d `test-results/share-code-dumps` before each run, so the four green runs that
followed deleted the artifact — while the entry's standing instruction was to *keep the dump file before
doing anything else*. Both numbers that mattered were extracted first, so nothing above depends on it,
but a re-analysis needs a fresh capture. The entry's instruction is now literal: copy it somewhere
outside `test-results/` first.

## Where LB-38 stands

**Eliminated:** the `> 0.01` ink floor letting a text-only canvas through; `getImageData` returning a
degenerate buffer; decoder configuration; in-run decode invocation; and low ink as a signature.
**Remaining:** what was drawn — a real defect in the rendered symbol at that moment, cause unknown. The
mid-repaint hypothesis is neither confirmed nor refuted; it lost its only piece of evidence.

**Not exercised:** no fix was made, so there is nothing to verify beyond the file still passing (6 tests,
2.5 min including both setup projects). The device is untouched — this is a test harness and two comments.

<a id="2026-09-02-lb-38-root-caused"></a>

# 2026-09-02 — LB-38 root-caused: zxing cannot read certain valid QR symbols upright

**Lane B · branch `fix/lb-38-decode-rotations` · no version bump · test harness only**

LB-38 has been open for days as a rare e2e "flake". It is not a flake and it was never in the app.

## The cause

`@zxing/library`'s detector cannot read certain **valid** QR symbols in their upright orientation.
Measured over **3,000** freshly generated meal tokens, encoded by the same `qrcode` call the label
renderer makes and rendered synthetically at the label's own 13 px per module — **no app code in the
reproduction at all**:

| decode strategy | undecodable |
|---|---|
| upright, `HybridBinarizer` | **115 / 3000 (3.83%)** |
| any of four rotations | **4 / 3000 (0.13%)** |
| + `TRY_HARDER` and `GlobalHistogramBinarizer` | 4 / 3000 (0.13%) — no further help |

**The symbols are valid, and rotation proves it**: seven of eight sampled failures decode once turned,
and rotating changes nothing but the detector's traversal. The rate is independent of error-correction
level (L/M/Q/H all ~4%), QR version (25 and 29 modules alike), mask pattern (spread across all eight),
module size at 3 px and above, and quiet-zone width.

## The arithmetic is the confirmation

Each run seeds one meal, so one token, and every style draws that same symbol — a run fails on all of
them or none. **3.83% is 1 in 26, against the ~1 in 19 this file was measured at.** The "flake" was
deterministic per meal id the whole time, which is also why no retry ever helped.

## What shipped

`e2e/qr-decode.ts` exports `decodeQrRotating`, which tries the four orientations; `meal-label.spec.ts`
imports it in place of its local decoder. That is not a retry and not a workaround for a rendering
fault — it is what a real scanner does anyway, since nobody holds a phone square to a label.

**The residual 0.13% is real and is not claimed as zero.** One token in the sample failed all four
rotations under every binarizer, and it is in the test as a fixed case.

## The fix needed a guard the spec cannot give it

A good token decodes upright, so the rotation loop never runs and a green spec proves nothing about
it — and the spec cannot choose its meal's id. So `lib/__tests__/qr-decode-rotations.test.ts` pins a
**fixed token measured to fail upright**, which exercises the path on demand.

**Four mutations kill it**: the loop running once, the rotation being a no-op, dropping the
width/height swap, and throwing instead of returning null. The third one **survived the first
version** — every case was square, and square is exactly where the swap is a no-op. A non-square case
closes it.

The test deliberately does **not** assert that the upright read fails. That is true today and is the
whole reason the file exists, but pinning it would turn an upstream zxing fix into a red suite.

## Every earlier theory on this entry was wrong

The ink floor, a degenerate `getImageData`, decoder *configuration*, in-run decode invocation, low ink
as a signature, a torn canvas, and the render race published in #806 and refuted in #807. Three of
those were mine, published on the same day.

**The one thing never checked was the encoder/decoder pair in isolation** — and it took minutes once
tried, needed no failing run, and gave a rate that matched the observed one to within a rounding
error. Days of expensive 1-in-19 captures went into a question a 2,000-iteration loop answered
immediately. The lesson is not "measure more"; it is **reproduce the failure away from the system you
suspect** before instrumenting the system you suspect.

## Product note, flagged rather than claimed

The app's own scanner is `@zxing/browser`, the same core. So ~4% of meal labels may be unreadable
**upright** by the app that printed them. Two things make that less alarming and neither is a proof: a
real scan is a camera image at arbitrary rotation, and the continuous scanner tries many frames — and
rotation clears all but 0.13%. **Not measured on a real camera**, so this is a flag for the owner, and
it sits on the entry as a `Keep:` rather than as work.

**Not exercised:** the device, and a real camera scan. Nothing in this diff is app code — the label
renderer, the scanner and every component are untouched. `pnpm check:rules` **Ran 67 of 67**; full unit
suite **6,339 tests**; `e2e/meal-label.spec.ts` green.

<a id="2026-09-02-lb-47-deload-override-honesty"></a>

# 2026-09-02 — the `Full` override claimed a revert that had not happened (LB-47)

**Lane B · branch `fix/lb-47-deload-override-honesty` · v1.431.2**

LB-47 asked whether BF-64's `Full` override does anything on a real session-level deload. Its
measurement was exactly right and its conclusion was not — and what is actually wrong is worse than
what it described.

## The measurement held to the row

Re-measured against production: **5** stored prescriptions, **1** with a session-level `deload: true`
carrying **0** exercises with `deloaded`/`preDeload`, **2** with a per-exercise deload, **0** with
both. The entry's figures, confirmed. (The endpoint is row-scoped to one user, so the larger sample
the entry asked for does not exist to be taken — n = 5 is all there is.)

## But the screen does something the entry did not check

On that prescription the toggle **is not rendered at all**. It carries `phase: 'deload'`, so
`aiDynamicFallbackPhaseStatus` returns `isDeloadActive: true`, and `pre-workout-screen.tsx` gates the
whole `DeloadToggle` on `!phaseStatus?.isDeloadActive`. So `Full` is not "an override that does
nothing" on the owner's data — it is **not offerable**. The entry's proposed fix, *disable the toggle
on a session deload*, is already the behaviour.

## What is reachable is a false confirmation, which is worse

`deloadRevertNames` and `deloadOverrideBlocked` **both** return empty in that shape, and the card read
`blocked.length === 0` as *everything reverted*:

> Every exercise is back to its pre-deload weights and sets, and these sets count toward your 1RM.

Both clauses false, in the direction that misleads — the user reads a confirmation that the override
worked and trains the deload weights believing they are full ones. That is BF-8's complaint (*"I was
under the assumption I was doing my full session"*) arriving from the other side, inside the fix filed
to prevent it.

It needs `prescription.deload === true` while the server reports `isDeloadActive` false — a
prescription whose `deload` flag and `phase` disagree. Nothing forbids that and production has not
produced it (0 of 5), so this is **latent**, not the owner's reported symptom. Worth fixing anyway:
the cost is one branch, and the failure is a wrong claim about what is on the bar.

## What shipped

`deloadOverrideOutcome` returns `none` / `all` / `partial` / `nothing-to-revert`, and the card branches
on it **before** the blocked-list check, with a heading and a sentence that say the truth: this
prescription lowered the whole session rather than individual exercises, there are no pre-deload
numbers to go back to, and Full does not change today's targets. **No 1RM claim in that branch** — the
override did not happen, so nothing is owed either way, and the old sentence's 1RM half was the second
false clause.

**BF-64 was not reverted.** Its per-exercise path is correct and is untouched, exactly as the entry
insisted. Only the sentence shown when nothing was reverted changed.

## Verification

- 9 tests, **six mutations kill them**: `nothing-to-revert` collapsing into `all`, the branch disabled
  as `{false ? …}`, the branch moved after the blocked check so it is unreachable, `partial`
  collapsing into `all`, the heading no longer changing, and a 1RM claim added back to the honest
  sentence.
- **The `{false ? …}` mutation survived the first version of these tests** — the sixth time this
  session. Two reasons at once: the text of an unreachable branch is still in the file, and
  `overrideOutcome === 'nothing-to-revert'` also appears in the heading ternary above, so an
  `indexOf` for the condition still found one after the body's was deleted. Every card assertion now
  pins the **condition and its consequent in one pattern**, so they cannot be satisfied separately.
- One test guards a boundary the fix could plausibly get wrong: an undeloaded exercise beside a
  revertible one must read `all`, never `partial` — otherwise every ordinary prescription with one
  deloaded lift starts naming exercises that were never deloaded.
- Full unit suite **744 files / 6,320 tests**; `pnpm check:rules` **Ran 67 of 67**; `tsc` clean, lint
  clean (warnings pre-existing). **One suite run reported a single failure that a re-run did not
  reproduce, and it was not identified** — the run finished before the name could be captured and the
  next run was clean. Recorded rather than dismissed: the local DB accumulates `rate_limits` rows
  across runs and this session has run the suite many times, which is a documented cause of exactly
  this shape, but "flake" is not a root cause and CI on a fresh database is the better signal.

## Deliberately not done

- **A real "run this at full intensity" path on a session deload.** It needs a regeneration
  `/prescribe` cannot do — the route takes no intensity input — so it is a Lane A plus owner question,
  not a copy change.
- **A line of explanation where the toggle would be.** On a real session deload the control simply
  vanishes, so a user wanting a full session sees no control and no reason. That is cheap to add and
  is probably right, but whether it is wanted is the owner's call and is not assumed here.

**Not exercised:** the device, and the reachable case itself — it requires a prescription production
has not produced, so what is proven is the branch logic and the card's source, not a screenshot of the
new copy. The unit suite runs in `node`, so nothing here rendered.

<a id="2026-09-02-meal-log-scale"></a>

# 2026-09-02 — a scale argument on the meal log (LB-49)

**Lane A · branch `lane-a/meal-log-scale` · no version bump**

`logMealItems` takes an optional `scale`, applied at write time to each item's
`quantityMultiplier`. It defaults to 1, so nothing changes until Lane B ships the control that
passes one — which is why there is no changelog entry and no version bump.

## Three things the entry said that are not true

**`logMealFromSaved` does not exist.** The function is `logMealItems`. The three write sites the
entry cites by line number are correct, which is what makes the wrong name easy to miss.

**Its lane justification is false.** The entry says it is *"the single shared write function both
server paths call, which is the Canonical-Runtime rule the push branch is CI-gated on."*
`logMealItems` is client-side — its only callers are `food-logger-sheet.tsx:248` and
`saved-meals-sheet.tsx:451`, and neither an API route nor the `pushMutations` branch touches it.
Lane A is still the right lane, because `packages/shared/**` is Lane A's by the ownership contract.
Right answer, wrong reason.

**Its sync-chain warning contradicts its own decision, and is unnecessary.** It demands *"Local
table column, `queueMutation` payload, `pushMutations` branch and pull mapping in the same PR"* and
calls the change un-batchable. But the decision it also makes — **scale at write time, never store
the factor** — is precisely what removes that work: the payload already carries
`quantityMultiplier`, so the scaled value flows through the local row, the queued payload, the
optimistic object and the web-fallback POST with no schema change, no new payload field, and
nothing to mirror in the push branch.

## …and one thing it undercounted

It names three write sites. There are **five**: the two it missed are the optimistic pushes, on the
offline path and the fallback path. Those are the pair that decides whether the diary agrees with
the database — scale the stored multiplier and not the optimistic one and the user sees a single
serving while the row holds one and a half, which is the optimistic-vs-stored divergence this repo
has hit repeatedly. The scale therefore also goes on `savedMealItemToWithItem`, which is what builds
that row.

## The decision that is carried forward unchanged

The factor is **not stored**, and that is the owner-facing cost worth restating: *"I ate 1.5×"* is
not recoverable afterwards — only the scaled per-item amounts are. The rows are point-in-time
snapshots (the function copies the definition's multipliers rather than referencing them), so a
meal-level factor every reader had to remember to apply would put a second multiplier in the system
and break that. BF-3 went the other way for supplement doses because there the dose *is* the datum;
here the datum is the food.

## Verification

- Full suite: **6,281 passed / 59 skipped / 742 files**. `pnpm check:rules` — **Ran 67 of 67**.
  `tsc` clean; `check-test-typecheck` 320 across 90, none above baseline.
- Five new assertions: every write site scales and the stored row matches the optimistic one; the
  day gains 300 kcal at 1.5× against 200 at 1× (**absolute**, so a mutation moving both sides cannot
  survive it); `scale = 1` is byte-identical to passing nothing; and a 0.5 per-item multiplier
  becomes 0.75 rather than being replaced.
- **Mutation-tested twice.** Dropping the scale from the optimistic pushes fails two tests;
  dropping it from the queued payload fails one.

**Not exercised:** no UI passes a scale yet, so there is nothing to click. The APK (JS only — this
reaches the device through Railway), safe-area, Samsung WebView and drifted production data are all
untouched by a defaulted parameter with no caller.

## What is next

Lane B wires the control. The one thing it must not do is store the factor.

<a id="2026-09-02-measured-rmr-invalidation"></a>

# 2026-09-02 — a saved RMR test evicts the goal caches (LB-48)

**Lane A · branch `lane-a/measured-rmr-invalidation` · v1.430.1**

`POST /api/measured-rmr` invalidated nothing and `measured-rmr` was in no cache group, so after
saving an RMR test the Profile goals section painted the previous resting rate before the
revalidation corrected it. The fix is four lines: the key joins
`invalidateGoalRecommendations()`, and the RMR form calls that group on its success path — through
the named group, never a hand-rolled key list at the call site.

## The entry's severity claim was wrong, and measuring it is what kept this PR small

LB-48 said the stale value survives *"until the app is restarted"*, reasoning that
`goals-section.tsx` fetches inside a `useEffect(…, [user?.id])` in the persistent tab shell, where
`user?.id` never changes — functionally `[]`. That reasoning is sound and the conclusion is false,
because it stops one step early.

The tab shell does keep all five tabs mounted (`tab-shell.tsx` renders hidden panels with
`invisible … [content-visibility:hidden]` rather than unmounting). But the RMR form is not in the
shell: it lives at `/more/clinical`, a plain page reached with `router.push`, so navigating to it
tears the shell down. Driving `/more` → `/more/clinical` → back in Chromium logged the goals
effect **3 times, then 3 more**. It remounts. The stale value is a first-paint flash, not a
session's worth of hard staleness.

**I had already written the fix for the claimed symptom before checking it.** The first version of
this branch also converted `goals-section.tsx`'s read to `useCachedValue`, justified by "the effect
never re-runs, so the eviction lands on a component that cannot hear it". That justification is
false here, and under *do not refactor beyond what the task requires* the conversion went with it.
The eviction alone is the whole fix: it turns "stale, then correct" into "correct".

**A backlog entry (LA-54) was also written and then removed in the same session**, claiming
`check-fetch-once-effects.js` has a gap because it only flags empty dep arrays and not
session-stable ones. The general point may well be true — a `[user?.id]` dep on a component that
genuinely never unmounts is `[]` wearing a disguise — but this case does not demonstrate it, and
filing an entry on an undemonstrated premise is the failure this session has now corrected three
times. It is not in the queue.

## What is actually gained

The invalidation rule's own audit note applies: an entry is load-bearing only where a call site
passes `freshWithinTtl` or a read path is seed-only, and neither holds here — both readers
revalidate. So this is a first-paint accelerator, and clearing it replaces a briefly-wrong paint
with a correct one. That is worth doing and is what the rule asks for; it is not the hours-long
staleness the entry described.

The other reader, `more/clinical/clinical-content.tsx`, does not need the eviction at all —
`onSaved(record)` updates it locally.

## Verification

- `pnpm check:rules` — **Ran 67 of 67**, all passing. `tsc` clean; `check-test-typecheck` reports
  320 errors across 90 files, none above baseline.
- Two assertions in `lib/__tests__/measured-rmr-invalidation-reaches-goals.test.ts` (the form goes
  through the group and carries no ad-hoc `invalidateCache`; the group carries the key), plus the
  key added to the existing `cache-groups.test.ts` group assertion.
- **Against `pnpm dev`** with a real credentials session: `GET /api/measured-rmr` empty → `POST` a
  test (200) → `GET` returns it; `/more` and `/more/clinical` both render with no runtime error.
- **The remount measurement above was taken in Chromium against the dev server**, with a temporary
  `console.log` in the goals effect that is not in the diff.

**Not exercised:** the APK (this is JS only, so it reaches the device through Railway with no
rebuild), safe-area, Samsung WebView, drifted production data. The owner's production DB has no
`measured_rmr` row, so the first-paint difference is not observable there until one is saved.

<a id="2026-09-02-ps17-night-selection"></a>

## 2026-09-02 — a nap that did not happen scored a day, because the rollup kept its own wrong copy of a rule (PS-17, defect 2)

**Branch:** `claude/la-ps17-night-selection` · **Lane:** A · **No version bump** — an engine
correction with no user-visible surface; the stored day is still wrong until the back-fill runs.

### The fault

2026-08-27's `oura_daily_summary` reads **4.75 h, HRV 26.5, RHR 73.7**. The surrounding days read
7.5–8.25 h at HRV 53–71 and RHR 59–62. Those are awake daytime values, and readiness for the 27th
was computed from them.

### The entry's diagnosis was half right, and the wrong half mattered

PS-17 says *"the summary picks the wrong session when a day has several."* **The summary never reads
`sleep_sessions`.** Verified against production:

| date | `sleep_sessions` | `oura_daily_summary` |
|---|---|---|
| 08-27 | real night **+ phantom** | took the phantom ✗ |
| 08-29 | **phantom only** | correct, 8.25 h ✓ |
| 08-30 | **phantom only** | correct, 7.92 h ✓ |

On the 29th and 30th the summary holds a night that is **not in `sleep_sessions` at all** for that
date. Two different write paths. Had I built "pick the longest session for the summary" as written,
it would have been a fix to something that does not exist.

**Only 08-27 was ever corrupted.** The entry lists three phantoms but claims damage for one, and
that is exactly right.

### What it actually was

The rollup resolves its own one-night-per-date map, and that loop did a bare `.set()` per period —
**last-wins**. On the 27th the day carried two night *periods*: the real night (23:02→06:37) and the
phantom (11:35→16:52). The 5 h gap between them is past `MAX_INTRA_NIGHT_GAP_HOURS = 3`, so they
never merge, and the later one won on recency.

**The rule was never missing.** `nightForDate`, in the same module as the classifier, documents it:
*"When a day somehow carries more than one night period … the longer wins — total sleep, not
recency."* The rollup had a second, wrong copy — One Formula, One Place failing in the direction
that is hardest to see, because both copies look reasonable in isolation.

So the fix removes the duplication rather than correcting the copy: **`nightPeriodsByDate`** in
`sleep-night.ts`, called by both `nightForDate` and the rollup.

**A second last-wins site went with it.** `bdiByDate.set(wakeDate, …)` carried a comment saying it
was *"matching the last-window-wins semantics of nightInputsByDate below"* — so fixing one silently
drifts the other. BDI is now keyed per window and lifted out by the winning period.

### Why the phantom is called a night at all — identified, deliberately not fixed

`ALWAYS_NIGHT_MIN_HOURS = 4` short-circuits the circadian check, so a 4.75 h window is night sleep
wherever it sat; the phantom's midpoint is 14:13. **Raising that constant would be a calibration
decision on n=1** — it is the escape hatch that stops a shift worker scoring nothing, and the margin
is real but narrow (longest nap in the history 1.42 h, shortest real night 5.33 h). Along with the
detector emitting a sleep window over 468 logged steps, it stays open on PS-17.

### Verification

Six tests built from the actual production rows, pinning the three facts that combine: the escape
hatch admits the phantom, the day yields two periods, and last-wins picks the 4.75 h one.
**Mutation-tested** — reverting `nightPeriodsByDate` to last-wins fails exactly 2 of 28; restoring
passes all 28. An earlier version of the test inlined the selection loop and would have passed with
the rollup still broken; it now calls the function the rollup calls.

Full suites: rollup project 71 passed, health + Postgres 1,884 passed, `pnpm check:rules` 67 of 67.

### The back-fill has NOT run, and I could not run it

The 27th's summary is still wrong on disk — this changes what a *future* aggregate writes. The
re-aggregate is `POST /api/oura-ble/samples/redecode`, which is **session + admin gated with no
bearer path**, and this session has read-only database access. It needs the owner once this deploys.

<a id="2026-09-02-q-407-nutrition-coach-entry"></a>

# 2026-09-02 — Nutrition's plan button opens the coach, in the nutrition scope (Q-407)

**Lane B · branch `feat/q-407-nutrition-coach-entry` · v1.433.0**

Q-407 became startable when LA-47's plan card merged. Its remaining Lane B half was small and precise:
*"pointing the Nutrition tab's entry at `/coach` with `scope: "nutrition"` (the route reads a `scope`
in its body and nothing sends one yet)"*.

## Every premise checked out, which is worth saying

Four entries this session were confidently wrong about their own code, so all four claims were
verified against `main` first: `lib/coach/scopes.ts` exists and carries a `nutrition` scope;
`app/api/coach/route.ts` parses `scope: z.string().max(40).optional()` and resolves it through
`coachScope`; `app/coach/` is a real page; and **nothing on the client sent one** — a `grep` for
`scope` across `coach-content.tsx` and `components/coach/` found only an unrelated comment. Q-407's
description of its own remaining work was exact.

## What shipped

`/coach` takes `?scope=`, the page awaits `searchParams` and passes it down, and `CoachContent`
forwards it through `DefaultChatTransport`'s `body`. Nutrition's `Build a meal plan` navigates to
`/coach?scope=nutrition`.

**A search param rather than a route or a separate page**, because the API already treats the scope as
optional and falls back to `general` on an unknown one — so a link from an older build cannot 400, and
the entry point stays a plain navigation. The transport is memoised on the scope: `useChat` reads the
transport it is handed, and a fresh instance every render is how a chat loses its in-flight request.

## The stepper sits beside the conversation, not behind it

The entry is explicit: *"a conversational flow that stalls mid-plan with no fallback is strictly worse
than seven screens that finish."* The obvious reading — leave Rebuild as the way back — does not hold,
because **Rebuild does not exist until a plan does**. The user with no plan is precisely the one who
would be stranded, and that is the only state the create button appears in.

So a `Prefer the step-by-step setup?` control sits directly under the same button, in the same empty
state. `onCreate` is the conversation; `onStepByStep` is the sheet.

## Verification

- **`e2e/nutrition-coach-plan-entry.spec.ts`, 2 tests, four mutations kill them**: the scope dropped
  from the transport, the entry navigating to a bare `/coach`, the fallback control hidden, and the
  fallback opening the coach instead of the sheet.
- **The spec asserts the POST body, not the URL.** The scope decides the tool subset — *"a tool it
  never receives is a boundary it cannot cross"* — so a test that only checked `/coach?scope=nutrition`
  would pass against a coach running in the general scope, which is the failure worth catching. It
  drives one real turn so the transport actually posts; without that the page is on `/coach` having
  sent nothing.
- **`test.use({ serviceWorkers: 'block' })`, and the gate is what caught its absence.** The spec stubs
  `/api/coach`, the service worker re-issues every `/api/` request, and Playwright cannot intercept a
  service-worker fetch — so the stub would apply or not depending on whether the worker had claimed the
  page. It would have passed locally and failed on CI with the real route answering.
- Full unit suite **744 files / 6,326 tests**; `pnpm check:rules` **Ran 67 of 67**; `tsc` clean; lint
  clean (the one warning is pre-existing).

A mutation run was cut off by a timeout mid-sweep and **left the mutation applied to the working
tree** — the baton's own warning, met in practice. It was caught by diffing before continuing, and the
fourth mutation was then run on its own.

## What is deliberately not done

- **The conversation's own shape.** The coach does not yet *open* by stating what it already knows
  instead of asking, which is points 1 and 2 of the entry's three-part design. The widgets exist and
  the model can now reach them inside the nutrition scope; what is missing is prompt and tool-ordering
  work in `lib/coach/**` and `app/api/coach/route.ts` — **Lane A**. Nothing in Lane B blocks it.
- **The stepper is not deleted.** The entry's condition is that the conversation has been used
  on-device for a plan the owner actually keeps.

**Not exercised:** no real Gemini turn — the spec stubs `/api/coach` because it asserts what the client
sends, and a live call would make it depend on a model and a key. So the scope reaching the API is
proven; the coach *behaving* differently inside it is not. The device is untouched: the safe-area under
the composer and a widget inside a scrolling thread are both unverified at 412 dp.

<a id="2026-09-02-q510-stress-coverage"></a>

## 2026-09-02 — the number that says why resilience produced nothing (Q-510, first action)

**Branch:** `claude/la-q510` · **Lane:** A · **Migrations 256 + 257.** Additive and nullable; nothing
reads the column yet.

### The gap

`final_check_stress_coverage` decides whether a day contributes a resilience index:

```
resolutionMinutes × nonNaN_resampled_buckets  >=  minDaytimeStressHours × 60
```

**Neither side was stored anywhere.** `minDaytimeStressHours` is a vendored constant, and the bucket
count was computed inside `preprocessStress` and thrown away one line later. Measured 2026-08-18: a
daily index landed on **3 of 18 days** while all four `contributorsOk` inputs passed on every one of
them — and nothing in the database could say why the other fifteen produced nothing. The stored
extreme-bucket counts cannot stand in: 08-07, 08-13 and 08-17 each carry 90 minutes of extremes and
produce no index, while 08-16 carries the same 90 and does.

### What shipped

`preprocessStress` now returns the count it already had; `runStressResilience` surfaces it as minutes
on **every** branch including the failing one; and `oura_daily_derived.daytime_stress_coverage_min`
stores it. Migration **257** regenerates the `claude_ro` views — without it the column is invisible to
`/api/admin/db-query`, which is the only way anyone reads production data here, and the column exists
precisely to be read that way.

### Two decisions worth stating

**NULL means NOT EVALUATED, not zero coverage.** When a contributor is missing, `computeResilienceForDay`
deliberately feeds the model an empty stress series — so a 0 there would be an artefact of that
gating, and would send a later auditor after the coverage gate when the real cause was a missing
contributor. A number is always a real measurement of the day's own series.

**The entry did not mention the write condition, and it mattered.** The resilience upsert was guarded
by `if (res.dailyIndices || res.level != null)` — so a day producing neither wrote *nothing at all*.
That is exactly the day this number explains. Persisting the value without widening that guard would
have shipped a column that stays NULL on every row it was built for.

### Verification, and why the tests are written the way they are

The existing orchestrator suite is `skipIf(!hasRealConstants())` — those constants left the tree, so
it skips here and in CI. **Adding tests there would have meant shipping this unexercised**, so the new
ones inject a synthetic constant set through `setResilienceConstants` and assert *relative* behaviour:
a shorter series yields a smaller number, an empty one yields 0, a missing contributor yields null.
They run everywhere.

**Mutation-tested.** Reporting 0 instead of null on a missing contributor fails 1 of 4; dropping the
coverage entirely fails 2 of 4; restored, all pass. The file went from 3 passing to 7.

`tsc` clean, `pnpm check:rules` 67 of 67, both migrations apply to the local dev database.

**Local SQLite v35 is NOT device-verified**, and it lands on top of v34 which is not either (BF-69's
`supplement_logs` rebuild). v35 is a plain `ADD COLUMN` — no rebuild, nothing dropped — so it is the
mildest kind of local migration, but it has still never opened on the S25.

**Not verified on production data** either — the column is empty until the rollup next runs there, and
this session has read-only access.

### The chain was wider than the entry implied, and a guard caught it

The entry asks to "persist the coverage on the derived row". `DERIVED_COLS` in `slices/oura.ts` is
`Record<keyof OuraDailyDerivedPatch, string>`, and a test asserts **every** key of it appears in the
offline-sync push payload — with a comment naming this exact bug class: *"a new column added here
without updating the pushMutations branch would otherwise never back up."* It went red immediately.

So the column rides the whole chain: Postgres 256/257, local SQLite **v35** plus a `RECONCILE_COLUMNS`
row, the local record type, both local upserts (column list, placeholder count, bound values and the
`ON CONFLICT` list — none of which TypeScript can check, since they are SQL strings), the pull mapper
and two test fixtures. Column/placeholder parity was checked mechanically on both upserts rather than
by eye.

### What is still owed

`worn_hours_ble` is **0 of 107 rows** (0 of 96 when the entry was filed, 0 of 79 in the 2026-08-05
review). The entry says "populate it or drop the column". Populating needs a source and dropping is
destructive, so it stays on the entry for the owner rather than being decided here. And whether
`minDaytimeStressHours` is too strict is Tuning's question — which cannot be asked until real coverage
numbers accumulate, and must not be answered by lowering the constant until the score fires.

<a id="2026-09-02-q514-expected-rpe-clamp"></a>

# 2026-09-02 — Q-514: a clamped expectation is not an expectation

**Branch:** `claude/la-q514-expected-rpe-clamp` · **Agent:** Implementation Lane A

`expectedRpe` clamps the model's expectation to the 5–10 slider the owner reports on. The ceiling
never binds — `rir` is floored at 0, so the raw value tops out at exactly 10 — but the floor binds on
**37 of 570 rated sets**, hiding raw expectations as low as −10. Those are not warm-ups: 49.6–66.7%
of 1RM at 7–13 reps, ordinary accessory work, where a 10-rep set at 54% has ~9 reps in reserve and a
true expected RPE near 0.6. The model can only say 5, the owner reports 6.9, and the autoregulation
delta reads **+1.89** where every other set averages **−0.34**. A 2.2-point offset, in the direction
the back-off arm reads as "RPE ran high", and it produced **64% of all back-off triggers** while
leaving the push arm untouched — which is what makes it a bias, not a sensitivity setting.

**The fix is the entry's first action and nothing more.** `rawExpectedRpe` exposes the unclamped
`10 − RIR`, `isExpectedRpeRepresentable` says whether the clamp bound, and the per-exercise delta
drops those sets rather than neutralising them — the same choice `computeResilienceForDay` makes
with a missing contributor, and for the same reason: a fabricated neutral is a measurement that
isn't one. `RPE_DEAD_BAND` does not move (it sits on a flat part of its sensitivity curve and the
entry measured that too), and the clamp itself does not widen — an expectation of 0.6 against an
owner who never reports below 6 gives a delta of +6.3, which is worse.

**One thing beyond the letter of the entry, and why.** The delta loop moved out of `signals.ts` into
`perExerciseRpeDelta` in the same module. `aggregateSignals` takes a whole `WorkoutRepository` and
runs ~25 queries, so an inline loop is only reachable through a fixture nothing in this repo has
ever built — the rule would have shipped with the predicate tested and the call site not. As a pure
function it takes four tests, three of which fail when the filter is removed (verified by mutation).

**Deliberately not changed: `rpeTrendFromSets`.** It shares the biased input and feeds the
emergency-deload safety net. The bias makes that net fire slightly *early*, which is the safe
direction, and narrowing a safety net is a behaviour change this entry did not measure. Recorded in
the code beside the filter rather than left for someone to rediscover as an oversight.

**What this does not claim.** The 64% is a share of back-off *triggers*, not of load cuts issued:
the back-off arm needs a second signal (`rm1Trend === 'down'` or `repCompletionRate < 0.95`) that
the replay does not model, and the owner misses prescribed reps on only 7.1% of sets — so most
back-offs must come through a falling 1RM, and the number of cuts this prevents is well below 25.
The ratio is the finding; the absolute impact is not sized. The re-measure the entry asks for is
Tuning's and stays on its `Keep:`.

**Not exercised:** no device path, no migration, no schema. The change is pure computation inside
the prescription engine; `pnpm dev` was not needed to reach it and no API route or screen changed.

<a id="2026-09-02-q516-peak-bands"></a>

# 2026-09-02 — Q-516: the bands were wrong at the bottom, and the entry was wrong at the top

**Branch:** `claude/la-q516-peak-bands` · **Agent:** Implementation Lane A

`hr-recovery-profile.ts` justified its five peak-HR bands as giving *"stable per-bucket sample sizes
(spec §3)"*. That is an empirical claim, and Q-516 measured it as false. Both halves of what it found
turned out to need correcting before anything could ship.

**Wrong at the bottom, and worse than the entry thought.** The entry ruled out recovering hidden
signal — *"re-banding does not recover hidden signal"* — on a pooled mean of 3.0 below 110 against
14.9 above. That pooling is what hides the defect. Split three ways over 312 covered episodes, the
mean 60-second drop is **−3.5** under 90 and **5.1** at 90–104 — genuinely noise — against **12.2**
at 105–119. So the `<110` boundary was cutting through the middle of the informative range: **42
episodes peaking 105–109 shed 11.5 bpm in their first minute**, were dimmed as noise in the card, and
were dropped from the trend entirely by `hr-recovery-trend.ts`.

**Wrong at the top, and this is why the entry's proposed bands must not ship.** Its
`<90 · 90–104 · 105–119 · 120+` was measured over `set_hr_stats`, which is the strength half. **HRP-2
is built**: `hr-episode-detection.ts` feeds completed-workout cool-downs in as `run_cooldown`
episodes, and of 13 cardio workouts carrying HR the peaks run **96–168**, with 2 at ≥130 and 1 at
≥150. `130–149` and `150–169` are reachable, not structurally unreachable, and a `120+` top band
would put a **168 bpm cool-down in the same bucket as a 120 bpm lifting rest** — collapsing exactly
the cross-modal comparison the module exists for (*"from 150 bpm you shed ~X bpm/min"*). Only `170+`
was empty across both sources, and only it was removed.

**The stale comment is the root cause and it is fixed in the same diff.** The module header said
*"Phase 1 seeds exclusively from the durable set_hr_stats rows — zero new detection"*, and its §6
caveat said the cross-modal confound *"doesn't yet bite — it matters once HRP-2 mixes in run
cool-downs"*. Both were true once and are false now. An entry that read them and measured
accordingly reached a conclusion about half the feature. The header now says HRP-2 is built, and the
caveat says the confound bites today and that a top-band figure is a cardio figure.

**Shipped:** `<90 · 90–104 · 105–119 · 120–149 · 150+`; `lowSignal` becomes a threshold
(`LOW_SIGNAL_MAX_BPM = 105`) rather than a label match, because with five bands "the low ones" is no
longer expressible as one string; a test pins the threshold to a band edge, since a threshold that
lands mid-band dims part of a range and not the rest, invisibly. `lib/ai-chat/tools.ts` named the old
labels in a tool description and was updated with them — the sibling surface a band change reaches.

**Deliberately not shipped: the honesty sentence, which is Lane B's.**
`aggregateHrRecoveryProfile` now returns `informativeShare` so the card can state that HR recovery
informs a minority of lifting sets, but nothing renders it yet. The entry's warning still stands —
four populated buckets look like a working feature whether or not they are — and it is on the `Keep:`
along with the owner-facing question of whether the feature is aimed at the right activity at all.

**Not exercised:** no device path, migration or schema. 891 tests pass in `packages/shared/src/health`
(83 files); the band boundaries and the low-signal threshold are mutation-checked. The card itself was
not rendered — the change is in the shared aggregation, and its consumer is Lane B's file.

<a id="2026-09-02-q517-tdee-bmr-floor"></a>

# 2026-09-02 — Q-517: a maintenance below your own resting burn is impossible, not implausible

**Branch:** `claude/la-q517-tdee-bmr-floor` · **Agent:** Implementation Lane A

`adaptive-tdee.ts` opens by warning that an ungated estimate *"would tell the user their maintenance
is 1200 kcal — actively harmful advice"*, and then clamps at **1000**. The owner's worst window
computed **1052** and slipped through the 200 kcal gap between the module's own prediction and its
own floor. It is one tap from the calorie goal: `TdeeAdaptationCard` writes the accepted value
through `PUT /api/nutrition/targets`, which mirrors into `users.calorie_goal`.

The floor is now the user's own BMR, passed in rather than recomputed. Below it the window is
**rejected, not clamped up** — `resolveMaintenance` falls back to the formula baseline, and clamping
would report a number the data never supported. The new `below_bmr` exclusion is deliberately
separate from `implausible_result`: one says the food log is incomplete, the other says the
arithmetic left human range, and they want different words in front of the user. The universal 1000
survives as `max(MIN_PLAUSIBLE_MAINTENANCE, bmr)`, so a nonsense BMR cannot weaken the existing guard.

**The entry's addendum said to read `body_comp.bmr_kcal`; the call site already had better.**
`energy-balance-service.ts` resolves `personalRmr(measured) ?? comp.bmrKcal ?? mifflinStJeorBmr`
two dozen lines above — so the floor is the **measured** resting rate wherever one exists (BF-42),
which is the number the body-composition card renders. That also disposes of the addendum's fallback
problem (25 of 96 days have no `body_comp` row): there is nothing to fall back from, because this
resolution never returns null.

**What the entry did not notice, and it makes the case sharper.** The same file already floors
`restingBaseKcal` at BMR, one line below the change — *"a resting burn below BMR is not a number this
model is allowed to report"*. That floor protects what the energy balance **displays**. Nothing
protected the maintenance itself, which is what becomes the recommendation and then the goal. The
right rule was already written down and applied to the wrong quantity.

**It makes the estimate SAFE, not CORRECT** — the entry is explicit and it still holds. Survivors sit
well below the formula's 2,397, which is residual under-logging showing through. The durable fix is
detecting within-day incompleteness (a day with only breakfast still counts as fully logged, so a
50%-complete record clears a 70%-coverage gate), and that stays on the `Keep:` as a feature.

**Not exercised:** the local dev DB cannot drive this path end to end — `/api/nutrition/energy-balance`
compiles and answers 401 on `pnpm dev`, but there is no seeded user with 14 days of completed food
logs and four weigh-ins, so the gate was verified by unit test rather than by a live response. Seven
tests, three of which fail when the floor is reverted (mutation-checked). No device path, migration
or schema is touched.
