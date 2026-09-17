# Session journal — batch folded 2026-09-17

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-14-chore-or-114-round-four"></a>

# 2026-09-14 — round four: the ring key is backed up, and eleven entries closed

**Branch:** `chore/or-114-round-four` · backlog only. No product code.

## The one that mattered

**Q-537 is done — the Oura ring key is backed up.** It was the only irreversible gap in the project:
the ring runs on our own auth key, that key lived in one app's storage on one phone, and an uninstall
destroys it with no recovery from the repo, the server or any log. The entry is removed; **the
warning is not**, and is kept as a note beside where the entry was.

## Eleven entries left the queue

BF-136, BF-53, BF-71, LA-45, BF-108, BF-119, LB-36, LA-52, Q-537, BF-27, BF-34.

**Two groupings paid off exactly as designed.** One walk answered LB-36 and LA-52 together — the
owner asked *"How to check this?"* of LA-52 and the honest answer is that it could not be checked
alone, which is why the two were put on one walk. One back-press answered BF-27 and BF-34, and
archived a `projectOverview.md` row covering **four** entries across three versions.

**BF-107 is a conditional close and says so.** *"Treat this as complete for now and if I re-raise it
we know its not."* Neither the offline dash nor the dash-then-number fill was observed, so a repeat
report is a regression against an unverified fix, not a new bug.

## Four decisions

- **LA-76 — a deload must not decay the collection.** *"A deload week or session should still count
  as an 'excercise' so it wont decay cats."* Broader than the question asked: it covers a deload
  **session**, and a session is already dated (`workout_sessions.phase_type`), so **half of this
  ships with no schema change**. Do that half first; only the phase interval needs the migration.
- **PS-35a — delete the five redirect pages, with a condition.** *"If its not accessible via the APK
  and is needed; then make sure there is a way to access it from APK."* Not a blanket delete: where
  the only path to a needed screen is that page, it gets a real entry point before anything is
  removed.
- **Q-111 — build the scale battery chip.** The stated need is **advance warning**, not a live
  reading, which is what the scale can actually give. Native, so it needs an APK.
- **BF-105 — a spoken cue, not a second chime.** *"No we need something like a tone saying
  'fast'/'slow' or so."* That rules out a distinct-tone-per-phase as well, which was the cheaper
  option this entry left open.

## Three findings the checklist produced by accident

- **Q-34 changed shape.** *"The sleep staging data is still not accessible from the sleep tile."*
  The entry is about staging *quality*; this is a **reachability** failure. Start by reading whether
  `sleep_sessions` holds stage rows at all — a pipeline gap wearing a UI complaint will not be fixed
  on the destination screen.
- **Q-529 was answered and refused.** The provisional marking shipped and was seen; what the owner
  wants is the score **right on open**, which is sync latency, not labelling. Three candidate causes
  (drain, rollup, screen fetch) and no measurement yet of which dominates.
- **TN-13's check was asked with the wrong location — my error, now traced.** They were sent to
  Health and the tile is on **Home**, labelled `Heart Rate`, in the score chip row. The mistake
  exposed something real: Health's own Resting HR tile shows a bare number while Home's shows the
  same signal with a delta against baseline. Two surfaces for one metric, disagreeing about context.

## One new entry

**OR-115** — the admin surface, from the owner declining to stage a ring re-sync for Q-533: *"I'd
like to re-organize all the buttons and options we have in the admin section."* Filed with the
instruction not to start by deleting: two of those buttons are the only way out of a real failure and
are pressed once a year, so **rarity is not disuse**, and hide beats delete for anything recoverable.

## Result

Queue **332 → 322**. `Verify: device` **31 → 22**. Backlog **21,087 → 20,952**; `projectOverview.md`
**10,881 → 10,846**, two rows archived. Both baselines ratcheted.

`check-backlog-pointers` clean on 322 entries · `pnpm check:rules` **Ran 74 of 74**.

**Surfaces not exercised:** none apply — backlog only.

<a id="2026-09-14-e2e-budget-honesty-date-rollover"></a>

# 2026-09-14 — the nutrition-budget-honesty spec detonated on its own hardcoded date

**Branch:** `fix/e2e-budget-honesty-date-rollover` · Found from a red E2E on an unrelated PR (#1182,
BF-160), which is the only reason it was looked at.

## What happened

`e2e/nutrition-budget-honesty.spec.ts` stubs `/api/nutrition/energy-balance` with a fixed payload
whose `date` was written as the literal `'2026-09-14'`. `nutrition-content.tsx` renders both cards
the spec asserts on under a date guard:

```tsx
<EnergyCard        data={energyBalance?.date === selectedDate ? energyBalance : null} … />
<TdeeAdaptationCard energyBalance={energyBalance?.date === selectedDate ? energyBalance : null} … />
```

`selectedDate` is `todayInTz('Australia/Brisbane')`. At **14:00 UTC on 2026-09-14** Brisbane rolled
over to the 15th, the guard stopped matching, the page rendered its no-balance state, and both
locators became genuinely absent. Two tests, both `toBeVisible()` timeouts at 60 s, on every branch.

**It does not recover.** The literal recedes further from the user's day every hour, so this is the
`scale-ble-day-keying.test.ts` shape — detonates once, stays red — not the
`periodization-soft-delete.test.ts` shape that fires for two hours a day. Both come from the rule
CLAUDE.md already states: a fixture may hold an absolute date only when **both** sides of the
comparison are fixed, and here the other side is the clock.

## How it was established rather than assumed

BF-160's diff touches no nutrition file. That is suggestive and proves nothing, so the spec was run
locally against `origin/main` with the branch nowhere in it: **the same two failures, identically**.
The page snapshot in the Playwright error context was what named the cause — it showed the nutrition
screen rendering fine at the stored goal (*"0 of 1,900 · 1,900 kcal left"*) rather than the stub's
numbers, which is the no-balance state, not a crash and not a missing component.

## The fix

One line: the payload's date is derived from the seeded user's zone at run time.

```ts
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())
```

`Intl` rather than a DB round-trip because nothing in this file needs the database — the payload is
stubbed precisely so the estimator is not under test. `plan-day-fill.spec.ts:58` is the same shape.

Verified both ways on the local harness: **2 failed on `origin/main`, 4 passed with the fix** (two
setup projects plus the two specs).

## What is deliberately not done here

No guard against the next one. Thirteen specs derive the user's day correctly and this one did not,
which is a gap a check could close — a spec that compares a literal date against a clock-derived
value is statically visible. Filed as its own entry rather than folded in, because this PR's job is
to get `main` green for every branch and a new Custom Rules step is not that.

<a id="2026-09-14-generic-datasource-connector"></a>

# 2026-09-14 — a generic data-source connector contract, and six concrete gaps it found

**Branch:** `claude/generic-datasource-connector-ybe9tc` · one-off session (docs-only, no lane).
Owner request: a generic connector structure so a second user's own ring/strap/phone can feed the
app, and — since it touches how every score is calculated — a clear picture of what data each pillar
actually needs and where it comes from.

## What shipped

All docs, no code — deliberately, per the backlog-driven-implementation rule (design now, build
later, tracked as backlog entries rather than built inline):

- **[`docs/data-source-connector-guide.md`](../data-source-connector-guide.md)** (new) — the
  contract a new data source is checked against. Traced from the real code, not written from
  intent: the canonical shape of every data type (HR as a time-series list, sleep as a
  session-plus-stage-interval array, body metrics as sparse daily scalars), which calculation reads
  which field and what it does when a field is absent (§4 — readiness and sleep score genuinely
  degrade gracefully; chronic stress, resilience, Body Battery and the OTS training-stress score have
  no fallback at all today), the decode→normalize→write pipeline the Oura rollup already implements
  (§5, formalized rather than newly designed), a metric-by-metric classification of what the Oura
  ring's firmware computes for us versus what the app computes itself from lower-level signal (§5.6),
  and the full Layer-1 input list the app needs for every pillar to work at full strength (§13).
- **[`docs/sync-health-api-reference.md`](../sync-health-api-reference.md)** (new) — the actual
  JSON request/response contract for `POST /api/sync-health`, taken directly from its Zod schema:
  field names, types, nullability, value bounds, and the plausibility rules that can skip one record
  without failing a batch. Written because "connect your own device" turned out to need something
  code-shaped, not another design doc.
- **[`docs/superpowers/plans/2026-09-14-data-source-connector-interface.md`](../superpowers/plans/2026-09-14-data-source-connector-interface.md)**
  and **[`...-apple-healthkit-ios-connector.md`](../superpowers/plans/2026-09-14-apple-healthkit-ios-connector.md)**
  (new) — two buildable implementation plans, the second mirroring the real Health Connect sync
  field-by-field so an implementer isn't re-deriving the pattern.
- Six backlog entries (**PS-40 through PS-46**) filed for what the research pass actually found
  broken or missing, each with file/function evidence rather than a bare claim — see
  `docs/implementation-backlog.md`. Two are small and self-contained (PS-41: Health Connect's HR
  series is read but never normalized into the table Activity Score depends on; PS-42: illness
  radar's own formula degrades gracefully but its caller never invokes it for non-Oura users). Four
  are owner-gated decisions, not implementer tasks (PS-40: a typed connector registry; PS-43: Health
  Connect's 30-day backfill cap is a client heuristic nobody decided on purpose; PS-44: a working
  rMSSD-from-raw-beat-intervals calculator already exists and is only wired to workout summaries —
  swapping it into the live scoring path needs a validation pass first; PS-45/PS-46: no per-user API
  key exists for external device integration, and the Apple HealthKit connector needs a real Apple
  Developer account before it can start).
- Linked all of it from `docs/module-map.md` and `docs/domains/devices/README.md` so the next
  session touching a device integration finds it without being told where to look.

## Verification

- `pnpm check:rules` — **75/75 Custom Rules steps pass**, including the doc-link and orientation-doc
  size checks this session's own additions tripped (two broken relative links inside the new plan
  docs, and the backlog file's size baseline needing a ratchet — both are fixed in this branch, with
  the baseline raise recorded in `docs/doc-size-baseline-history.md`).
- `node scripts/check-index-doc-paths.js` and `node scripts/check-backlog-pointers.js` run clean
  after every addition across the session, not just at the end.
- No `pnpm dev` run — this PR touches no runtime code, so there is nothing to smoke-test on the local
  dev server. Every factual claim in the new docs (table names, function signatures, decode logic,
  formula inputs) was checked against the actual source via targeted research passes, not written
  from memory — per `CLAUDE.md`'s external-field-name rule, applied here to the app's own code
  rather than a third-party API.

## What this session deliberately did NOT do

- **No code changes.** Every finding became a backlog entry or a plan doc, not an inline fix — this
  is a planning session under the repo's own backlog-driven-implementation rule.
- **No decision was made on the owner's behalf.** PS-43/PS-44/PS-45/PS-46 all state a recommendation
  and the reasoning, but stop short of building, because each changes either a live score's input, a
  new authentication surface, or a real recurring cost.
- **Not device-verified**, because nothing device-specific was built. The one existing-code claim
  worth flagging for a future session to re-confirm on real hardware: PS-44's premise that
  `rmssdFromRr()` already runs correctly on live Polar-strap data — verified by reading
  `compute-workout-hr.ts`'s wiring, not by watching a live rest-window HRV number update on a strap.

<a id="2026-09-14-la102-tn28-nutrition-budget-honesty"></a>

# 2026-09-14 — two things the nutrition surface knew and did not say (LA-102 + TN-28)

**Branch:** `feat/nutrition-budget-honesty` · **Lane B** · v1.456.4 · batched

Batched because one verification pass covers both: same screen, same payload, and the fixture that
renders the nudge card also opens the ⓘ panel.

## LA-102 — what the base leaves out

Owner, on the resting-rate-anchored budget: *"1350 doesnt count some basic metabolic needs".*

He is right. RMR excludes the **thermic effect of food** (~10% of intake) and **non-step NEAT** —
standing, fidgeting, housework. BF-152 chose not to model either, and that decision is sound: a
multiplier *asserts* the overhead happened where the step credit *observes* it, and treating
intake-linked digestion as an earned credit makes the budget grow as you eat, a feedback loop the
card would then have to explain for a number inside food-logging error.

So the fix is copy. The ⓘ panel now carries a paragraph naming both omissions and saying the true
burn runs a little above the shown base on a still day. It is deliberately separate from the
paragraph above it: that one is about not *double-counting* movement that does get added, and these
two are never added by anything.

## TN-28 — the card that writes your goal

`TdeeAdaptationCard` renders the maintenance figure with a one-tap **Use 2,045** that writes straight
into the calorie goal — and it was the only surface omitting the confidence qualifier.
`energy-card.tsx` and `calorie-balance-bar.tsx` both already printed *"(low confidence, 10 of 14 days
logged)"* from the same payload fields. The estimate behind the owner's screenshot carried
`confidence: 'low'` with a 95% interval of **[1,990 – 2,500] kcal**: a 510 kcal band presented as one
number with a button under it.

Now it prints the siblings' exact wording. The action is **not** gated on confidence — that is
TN-27's trade, and this entry says so explicitly.

## The third finding: the ⓘ copy existed twice, and had drifted

Neither entry mentions this. Doing them together surfaced it.

`energy-card.tsx` and `calorie-balance-bar.tsx` each held the same three paragraphs inline — and the
card had grown a fourth (BF-134's resting-burn explanation) that the bar never got. So the same
figure came with different explanations depending on which screen you opened it from. Adding
LA-102's sentence to both would have made it three paragraphs out of step instead of one.

`calorie-zone-bar.tsx`'s own comment names the class: *"two hand-maintained copies of this scale is
the drift class that put two different calorie budgets on one screen."*

Both now render one `components/nutrition/energy-explainer.tsx`.

**A pre-existing guard caught the extraction, and it was right to.**
`movement-breakdown.test.ts` asserted that *both* files contain `every step you take` — a
source-text check that existed because the copy was duplicated. It is repointed at the single
explainer, plus a new sibling check that neither host re-states the copy, which is what stops the
drift returning. The invariant survives and can no longer be half-satisfied.

## Verification

`e2e/nutrition-budget-honesty.spec.ts` stubs a calibrated, low-confidence, drifting payload — the
estimator is not what is under test, the two sentences are, and building a real calibration means a
fortnight of logged intake against a weight trend. **Both tests fail against unpatched
`components/`.**

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `pnpm lint` 0 errors · `vitest`
817 passed · `bf154-budget-breakdown-reconciles` and `calorie-progress-bar` still green.

**Three drafts of the LA-102 test failed for three separate reasons, none of them the app:**

1. Clicked every `aria-expanded="false"` button on the page rather than the ⓘ — opened meal
   accordions and never touched the panel. Its accessible name is *"How energy balance is
   calculated"*.
2. `locator.click()` does not reach controls on the Nutrition tab. This is a standing gotcha in the
   lane's own baton and it still cost a run; `el.evaluate(e => e.click())` works. The test now
   asserts `aria-expanded` flipped, so a silent no-op fails at the click rather than downstream.
3. `getByText` resolved to the emphasised `<span>` inside the paragraph — four words, none of the
   substance — so `toContainText(/digest/)` could never pass. Scoped to the `<p>`.

## What was NOT exercised

- **No device.** 412 dp in Chromium. Two paragraphs were added to a panel that is already dense;
  how it reads on the S25 is unchecked.
- **The panel was only opened from one host.** Both render the same component, so the bar's copy is
  covered by construction — but the bar's ⓘ was never clicked, and it is the surface that just
  gained BF-134's paragraph it never had.
- **No real calibrated maintenance.** The nudge card has only been seen against a stub, so the
  qualifier has never been rendered from a figure the estimator actually produced.

<a id="2026-09-14-la104-stress-chart-one-baseline"></a>

# 2026-09-14 — the stress chart reads one baseline, and gets a past day to compare against (LA-104)

**Branch:** `feat/stress-chart-stored-series` · **Lane B** · v1.456.0

## What it was

TN-3b (2026-09-13) shipped a 24-hour stress chart on the Body Battery card, fed from
`battery.stress.series` — the **live** series `/api/body-battery` computes from `restingHr` plus a
28-day HRV mean. LB-102 (the same day, Lane A) shipped `GET /api/body-battery/stress-day?date=`,
which serves the **stored** buckets the rollup writes from `latest.rhrLowBpm` + `nightHrvMs`.

Two producers, one metric. `app/api/body-battery/route.ts:349` records what that costs: over the
eight days in production that carried both, **the sign differed on six of them and high-stress
minutes by 4–8×**. TN-3a had already refused to persist the live series for exactly this reason —
*"persisting both would put two numbers behind one metric"*.

So a chart drawing today live and a past day from storage would put two metrics on one axis, in
precisely the dimension the owner's approved pass test compares: *"open a past day, read a stressed
window off the axis, and say whether it matches what you were doing."*

## What shipped

- **`StressDayChart` fetches `/api/body-battery/stress-day` itself** (`useCachedValue`, key
  `stress-day:<YYYY-MM-DD>`, `BODY_BATTERY_TTL`) instead of taking buckets as a prop. Every day,
  today included, comes from storage.
- **It takes an optional `date`**, and is now **mounted on `/health/day`** beneath the read-through,
  swiping with the day. That is not padding: without a past-day surface the entry's pass test could
  not be run, and the one-baseline change would have had no observable effect at all.
- **`throughMs` is printed** — *"Measured through 15:15 — the last reading stored, not the end of
  your day."* This is the honest cost of serving today from storage, and Lane A returned the field
  so the surface could say it rather than imply the day stopped.
- **An error state**, because `cachedFetch` swallows `!res.ok` including the route's own 30/60s rate
  limit, and a card that vanishes reads as "no stress recorded".
- The caption stopped pointing at *"the reading above"* — the strip is only above it on the Home
  card — and names the `High` threshold directly, which is the same word `stress-strip.tsx` uses.

Four e2e tests. The load-bearing one leaves the **live** series full and empties the **stored** day:
the chart must not draw. Before this change it did.

## The finding worth more than the change: `Reference:` had never been documented

LA-104 sat in `next-item.js`'s `REFERENCE — read by other entries, not implemented. Never "next"`
section, carrying an explicit `Lane: B`. The field means *this entry is read, not built*. Lane A had
used it for *"here is supporting reading"*.

Nothing documented it. The only place its meaning was written down was
`check-backlog-pointers.js`, which enforces the *opposite* direction — a prose-only "not
implementable" must carry the field. So the name was all anyone had, and the name invites the other
reading.

**The tell is a printed reason that is a bare link**, where a real one reads as a sentence. Seven
entries have that shape. Three were opened and **all three were work, not reading**:

| Entry | What it actually was |
|---|---|
| `LA-104` | this change |
| `LA-102` | 64 lines of unbuilt Lane B nutrition surface — now READY #3 |
| `TN-28` | unbuilt Lane B card copy — now READY #4 |

Both were sitting under *"never next"* while Lane B's READY list held two items. Same shape as
`Gate: device` on unbuilt work (BF-45) and `Verify:` on unshipped work (OR-105): a field whose name
invites a second reading, and a queue that goes quiet rather than wrong.

The field is now documented in the backlog's fields section, with the misuse and the count. The four
remaining `TN-` entries are **left alone** — a Tuning entry can legitimately be read-only, and
guessing which from outside the lane is how this started — and tracked as **LB-104**.

**This is the fourth instance in two days** of the same class: work that exists but no queue shows,
because a field's meaning was carried in prose. TN-3b's unparking, Q-305's `push:pull` dependency,
LA-104's `Reference:`, now LA-102's and TN-28's.

## Also filed

**LB-105** — `day-review-read-through.spec.ts`'s first test fails on a clean checkout of
`origin/main`, confirmed by stashing and re-running. Probably the local seed (every read-through
section self-hides when empty), which is why the entry's first step is to read CI's E2E job rather
than to patch.

## What was NOT exercised

- **No device.** Home's card and `/health/day` were driven at 412 dp on `pnpm dev` through
  Playwright. Safe-area, the Samsung WebView compositor and native SQLite were not touched.
- **No real stored buckets.** The e2e stubs the route; the dev-server run confirmed the *wire* —
  `GET /api/body-battery/stress-day?date=2026-08-12 200` and `?date=2026-09-14 200` — against a
  local database with no ring data, so the chart rendered nothing there. The drawn output has only
  ever been seen against fixtures.
- **No past day with real data.** Which means the owner's pass test — matching a stressed window to
  what he was doing — is now *possible* and has not been *run*.

<a id="2026-09-14-la106-malformed-field-guard"></a>

# 2026-09-14 — a field the readers cannot parse is now a CI failure (LA-106)

**Branch:** `lane-a/la106-malformed-field-guard` · **Lane:** A · Entry **LA-106**, filed by Lane A
on 2026-09-14 while starting BF-158.

## The defect

Every field in `docs/implementation-backlog.md` is read by a regex of one shape — the name, wrapped
in at most `**`, then the colon:

```
/^\s*[-*]\s*\*{0,2}Needs:\*{0,2}\s*(.+)$/i        next-item.js:73
/^\s*[-*]\s*\*{0,2}Gate:\*{0,2}\s*([a-z]+)/i      next-item.js:76
```

Asterisks and nothing else. BF-160 wrote ``- **`Needs:` BF-158**`` with a **backtick**, the
dependency did not parse, and **BF-160 printed as READY #1 while BF-158 — the entry it needs — sat
at #2**. Nothing anywhere reported it; the field was simply invisible.

**The `Gate:` case is the one that matters and had not happened yet.** The same shape governs it, so
``- **`Gate: owner`**`` would park nothing, and an agent would be handed owner-gated work at the top
of its queue with no sign anything was wrong. `Needs:` mis-orders a list; `Gate:` crosses a line the
owner drew.

## What shipped

A section in `scripts/check-backlog-pointers.js` that fails on a line a human plainly meant as a
field — bullet, any run of emphasis characters, the name, the colon — which the canonical regex then
does not match.

**Not a widened parser.** LA-106 was explicit that teaching the readers to accept backticks rewards
the ambiguity, and it is right: that leaves two spellings of every field for the next reader to
disagree about. A malformed field should be loud, not tolerated.

**Seven field names, not the four the entry listed.** `Lane`, `Needs`, `Gate`, `Batch`, `Reference`,
`Verify` and `Keep` share the shape, so they share the failure, and the extra three cost one array
element each. `Batch:` is worth calling out — a batched entry that silently loses its batch ships
alone, which is the opposite of what the field is for.

**The baseline is EMPTY.** Zero malformed fields exist today — BF-160 carried the last one and that
entry left the queue hours ago — so this ships as a regression guard rather than a debt row, the
same footing as `check-aest-midnight-timezone.js`.

## Verification

**Mutation pass, real exit codes captured:**

| mutant | exit |
|---|---|
| ``- **`Needs:` BF-158`` — BF-160's exact shape | **1** — flagged |
| ``- **`Gate: owner`**`` — the case the entry says matters most | **1** — flagged |
| `- _Batch:_ some-slug` — a name the entry did not list | **1** — flagged |
| control: `- Needs: BF-158`, no emphasis at all | **0** — survived |

The control is a *valid alternative form* rather than an equivalent mutant, and that is the property
worth testing: `\*{0,2}` allows zero asterisks, so the readers do parse it, and a check that flagged
it would be over-catching.

`node scripts/next-item.js --lane A --all` and `--lane B --all` are **byte-identical** before and
after, which is the entry's own second verification step: nothing about how a well-formed entry
sorts has moved.

## Not covered

The check reads lines inside entries, so a malformed field written *above* the first `###` heading
is invisible to it. Nothing lives there today and the file's shape makes it unlikely, but it is a
gap rather than an impossibility.

<a id="2026-09-14-la107-e2e-stub-date-guard"></a>

# 2026-09-14 — a guard for the literal-date fixture, and what measuring first changed about it

**Branch:** `lane-a/la107-literal-date-fixture-guard` · **Lane:** A · Entry **LA-107**, filed hours
earlier in #1183 when the class it describes took E2E red on every branch.

## The entry's own method instruction was the load-bearing part

LA-107 said to measure the corpus before writing the regex, and it named a candidate discriminator:
a literal date *in the same file as* `todayInTz`, `AT TIME ZONE`, `Date.now()` or `new Date()`,
since that pairing is the both-sides-fixed rule being broken.

**Measured against the very case that motivated the entry, that discriminator does not catch it.**
The pre-fix `nutrition-budget-honesty.spec.ts` contained no clock reference of any kind — no
`new Date()`, no `todayInTz`, nothing. The clock lives in `nutrition-content.tsx`, the application
the spec drives, not in the spec. Nine of the twelve e2e files holding a literal date have zero
clock references. The signal does not discriminate at all, and a check built on it would have gone
in, passed, and proved nothing.

## What the corpus actually looks like

308 files hold a literal `YYYY-MM-DD` (12 under `e2e/`, 296 under `__tests__/`). Flagging all of
them is the noise the entry predicted. The shape the defect takes is narrower: a literal date handed
to the app **through a `page.route` stub**, where the app is free to compare it against today. That
flags five files, and all five were read:

| spec | why its literal is safe |
|---|---|
| `day-rollover-checkin` | `page.clock.install` pins the app clock to that instant |
| `nutrition-day-rollover` | same, across a pinned rollover |
| `stress-by-hour` | `at()` derives every timestamp from `Date.UTC(2026, 8, 8, …)`; the `date` field matches |
| `sleep-provisional` | green with a date **12 days stale** — the sleep list renders the nights it is given |
| `home-device-battery-chips` | sunrise/sunset labels, rendered as given; green 12 days stale |

**Zero current defects.** The only true positive in the corpus is the one #1183 already fixed.

That could read as an argument against shipping the check, and it is the opposite. The last two rows
are safe *by luck of their consumer*, and nobody had established that until today — a date-guarded
consumer would have failed on the first rollover rather than surviving twelve. The exemptions are
where that knowledge now lives.

## What shipped

`scripts/check-e2e-stub-dates.js`, wired into Custom Rules — the runner reports **75 of 75**, up
from 74, which is the number to quote rather than the word "pass".

Exemptions are per **(file, date)**, not per file, so a new literal added to an already-exempt spec
still fails. Each carries the reason measured above.

**The check caught a flaw in itself on its first run.** Its initial regex treated backticks as quote
characters and flagged a date inside its own header prose, which is exactly the sort of finding that
gets a check deleted rather than fixed. It now strips comments via the existing
`scripts/lib/strip-comments` helper and matches quote characters only.

## Verification

**Mutation pass, real exit codes captured** (`node … > log 2>&1; echo $?`, never piped to `head` —
the first attempt reported `head`'s zero while the script was failing correctly):

| mutant | exit |
|---|---|
| reintroduce `date: '2026-09-14'`, the literal that broke `main` | **1** — flagged |
| a new literal inside an already-exempt file | **1** — flagged, so the exemption is not a blanket |
| control: swap two exempt dates' declaration order | 0 — survived, as an equivalent change should |

## What is deliberately not covered

**Unit tests.** `scale-ble-day-keying.test.ts` is the same rule broken in a different shape — one
side of a rolling window hardcoded — and no `page.route` appears in it. 296 test files hold a
literal date, so the same coarse rule there would be all noise. This guard is narrower than the
class it belongs to, in the way `check-backlog-pointers`'s empty-heading rule is narrower than
resurrection: it catches the shape that has actually shipped twice, and says so rather than implying
the class is closed.

<a id="2026-09-14-lane-a-bf160-fitness-test-activity"></a>

# 2026-09-14 — a fitness test now logs the activity it was (BF-160)

**Branch:** `lane-a/bf160-fitness-test-activity` · **Lane:** A · Entry **BF-160**, filed by BugFix
intake from the owner's 2026-09-14 Cooper run. Asked whether the test should count, he answered
*"Yes it should count."*

## What was wrong

`computeActiveEnergy` has exactly three sources — strength sessions, logged activities, passive
steps — and a fitness test was none of them. `handleSave` in `components/fitness-tests/test-result.tsx`
wrote one row, to `fitness_tests`, and nothing downstream of the calorie budget reads that table. So
1,975 m in twelve minutes at an average of 156 bpm contributed **nothing** to the day's earned
calories, on the same screen BF-152 and BF-154 had just finished anchoring to measured movement.

**The half that hid it.** Zone minutes come from `oura_heartrate` via `getZoneMinutesRange`, so the
strap's 581 samples in the top zone *were* credited automatically. The test therefore looked counted
until someone checked the budget specifically — HR-derived credit flows without an event row,
event-derived credit does not.

**The steps path did not rescue it either.** `body_metrics.steps` read 894 for the whole day, fewer
than a 1,975 m run produces on its own, so the pedometer had not seen the effort.

## What shipped

`activityType` is now a field on `FitnessTestProtocol` — `run` for Cooper, `walk` for the 6MWT, null
for `resting_hrr` (sixty seconds of effort inside three minutes of sitting is not a cardio session).
Declared per protocol rather than switched on the id, so a new protocol row cannot forget to answer.

`buildTestActivity` (`packages/shared/src/fitness-tests/test-activity.ts`) turns a capture into the
activity it is worth, or null. `test-result.tsx` writes that row to the local store and queues an
`activity_logs` outbox mutation beside the test's own, then invalidates both cache groups — before
the push for its own screens and again after it, via `pushThenRevalidate`.

Three decisions inside the builder, each with a test:

- **It never consults the VO₂max.** BF-158, which shipped hours earlier, withholds the score when the
  distance cannot be real. The effort still happened, so the calories are still owed; gating one on
  the other would make a failed GPS fix cost the day's budget as well as the score.
- **A zero distance is omitted, not sent.** `ActivityLogBody.distanceKm` is `.positive()`, and a
  rejection on the sync-push path lands in `errors[]` — a dead letter, not an error the user sees.
  Confirmed against the running route: the omitted shape answers **201**, `distanceKm: 0` answers
  **400**.
- **No activity for a capture with no duration**, so a screen opened and closed leaves no row.

The activity write sits in its own `try`/`catch` *after* the test's. An uncaught throw there would
fall into the outer catch and re-POST the already-saved test to the API fallback under the same id.

## The double-count the entry warned about does not exist, and that was checked rather than assumed

`computeZoneQuota`'s only actual is `getZoneMinutesRange`, which reads the `daily_zone_minutes`
cache built from HR samples. An activity row is not an input to it at any point, so creating one
cannot add a second helping of the same minutes.

The overlap that *is* real is steps, and `computeActiveEnergy` already handles it: a logged `walk`,
`run` or `hike` has its step-equivalent subtracted from the passive total. Here that takes the
passive term to **zero** — 1.98 km implies more steps than the whole day recorded — so the change is
not purely additive, and the run's own estimate becomes the entire credit.

## Verification

Full gate green. **Mutation pass: six mutants, all killed** — the `activityType` guard, the duration
guard, `distanceM > 0` widened to `>= 0`, `captureDistance` ignored, minutes rounded to whole, and
Cooper re-declared as a walk. One deliberately equivalent control (`/60_000 * 10` rewritten as
`/6_000`) survived, as it should.

Driven against `pnpm dev` and the local database, signed in as the seeded user:

| probe | result |
|---|---|
| `/baselines` compiled and served with the new client imports | **200** |
| Cooper payload exactly as the builder emits it | **201**, row stored |
| 6MWT payload | **201** |
| distance omitted (GPS gave nothing) | **201** |
| `distanceKm: 0` — the shape the builder avoids | **400** `Invalid body` |
| `activeEnergyKcalToday` with the three rows present | **122** |
| the same after deleting them | **0** |

That 0 → 122 is the whole point of the entry, measured on the live path rather than argued. **The
number itself is not the production one**: this machine has only the synthetic MET fixtures, where
`hasRealConstants()` is false, so the magnitude assertion in the unit test is skipped in CI too. The
structure is CI-verified; the size of the credit is not, on any machine in this repo.

**Not exercised:** no device path or APK. The capture itself — GPS distance, strap HR, the Finish
tap — cannot be driven in the sandbox, so the one thing never run end to end is the flow a person
actually uses. BF-160's own verification step stands and is recorded in `projectOverview.md`: run a
protocol on device, confirm one activity appears in cardio history with the right duration and
distance, that the day's earned calories rise, and that the zone quota does **not** jump.

<a id="2026-09-14-lane-a-bf58-weight-band-attribution"></a>

# 2026-09-14 — one scale, two people: the band was already measurable and nobody had measured it (BF-58)

**Branch:** `lane-a/bf58-weight-band-attribution` · **Lane A** · v1.456.12

## What shipped

`/api/scale-ble/samples` now splits a weigh-in three ways instead of two:

| Distance from the last confirmed weight | What happens | Status stored |
|---|---|---|
| ≤ `SCALE_WEIGHT_CLAIM_PCT` (8%) | saved, no prompt | `confirmed` |
| up to `SCALE_WEIGHT_ANOMALY_PCT` (15%) | *"is this you"* | `pending` |
| beyond that | declined, no prompt | `dismissed` |

That is option D, which the owner chose on 2026-08-30: two phones hear one radio, each app claims
only its own owner's band, neither learns anything about the other person. No linking, no shared
account, no server-side scale owner, no cross-account write — and none of the consent surface that
option B (readings offered to a linked household member) would have needed.

**The raw frame is archived in all three branches.** BF-58's title is that the partner's weigh-ins
are *thrown away*; `insertScaleRawSample` now runs before every return, so a declined reading is
un-attributed rather than destroyed. The day her phone is paired, hers are in the table.

`dismissed` rather than a fourth status, deliberately: it is already what a reading the owner taps
*Not me* on becomes, and "not this user's" is exactly what the band decided. A new status means a
schema change, and BF-58's own scope guard says a design step reaching for one has left option D.
That guard fired for real — a first draft reached for a `'declined'` status and `tsc` rejected it
against `ScaleSampleStatus`, which is the guard working rather than an obstacle.

## The part worth keeping: both weights were already in the database

The entry said to pick the band width *"from the two real weights rather than a round number"* and
read as though that meant asking the owner. It did not. Both clusters were already stored, and
nobody had looked. Measured against production on 2026-09-14 (`claude_ro`, so **the owner's rows**):

- `body_metrics`, 100 confirmed readings — **67.6 – 72.8 kg**; day-to-day change **0.39 kg mean,
  1.40 at p95, 2.85 worst**.
- `scale_raw_samples` — `confirmed` n=100 at **70.0 – 72.8 kg**; `dismissed` n=6 at **57.5 – 58.0
  kg**. A **12.0 kg** gap, and the dismissed cluster is tight rather than scattered, which is what
  says it is a person and not decode noise.

8% of ~70 kg is ±5.6 kg. That is **wider than his entire five-kilogram history**, so no genuine
reading of his falls outside it even after a long gap, and still **6.4 kg clear** of her cluster.
The old single 15% band (±10.5 kg) reached down to 59.5 — 1.5 kg from her readings, which is the
thin margin the entry was written about.

The width is therefore arithmetic against two measured clusters, not a judgement call. It is written
into the constant's doc comment rather than only here, because the next person to touch it needs the
numbers, not the conclusion.

## What I did NOT do, and why it is filed rather than fixed

Turning the outer band from *ask* into *decline* has a failure mode for the owner that option D's
design does not cover: **the band is anchored on his last confirmed weight, and only a confirmed
reading re-anchors it.** A genuine change of more than 15% between two weigh-ins — a long gap plus
an illness or an injury — puts him outside his own band with nothing to move it, and every reading
after that is outside too. Before this change, that case raised the prompt and one tap fixed it.

It is narrow (drift is gradual and normally passes through the 8–15% prompt band first, where one
confirmation re-anchors) and nothing is lost (the frames are archived). But it is **silent and
self-sustaining**, which is the bad half, and `listPendingScaleSamples` is the only read path — it
filters to `pending`, so a dismissed reading has no way to be seen.

Filed as **LA-108**, immediately below BF-58 in the queue. The likely shape is a read for recent
dismissed samples (Lane A) and a list beside the existing pending one (Lane B) so a wrongly-declined
reading can be claimed and re-anchor the band. **Not** a wider band — the 8% is the measurement, and
widening it is the thing BF-58 was filed to stop.

## What BF-58 keeps

Everything that needs the hardware, none of which the band work could answer:

1. **Can both phones hold a GATT connection at once?** Inferred from the protocol shape, never
   measured. `ScaleBleScanManager` uses the advertisement only to wake the app; `ScaleGattClient`
   then opens a connection to read the frame, and a consumer scale of this class normally accepts
   one at a time.
2. **Does `REQUEST_STORED_MEASUREMENTS_CMD` (`0x22 0x04 0x15`) get a reply?** This is the one that
   decides whether the race matters at all — if the scale buffers, the losing phone catches up on its
   next connect. The code's own comment is candid that the command is speculative and borrowed from
   a different firmware generation.
3. **Have the partner pair the scale in her own app.** The pairing is `localStorage`
   (`ta_paired_scale_v1` — no `user_id`, no table, no uniqueness constraint), so nothing stops her
   phone pairing it today.

## Verification

Nine tests in `app/api/__tests__/scale-ble-weight-band-attribution.test.ts` cover the three bands,
both boundaries to within 10 g, the symmetry of a light reading, the first-reading case where there
is no band to be outside of, the partner's real 57.8 kg cluster, and that the frame is archived in
every branch.

Mutation pass, real exit codes captured directly:

| Mutation | Caught |
|---|---|
| claim band collapsed back to 15% (the old two-band behaviour) | ✅ |
| outer band prompts instead of declining | ✅ |
| declined frame not archived | ✅ |
| **control** — middle band rewritten as a closed interval (equivalent) | correctly passed |

**Not exercised:** the S25. This is a JS/server change and reaches the device through Railway with
no APK, but the behaviour it changes is a physical one — two people and a scale — and only the phone
can show it. Recorded as a Known Issue until it is.

<a id="2026-09-14-lane-a-la108-claim-a-declined-weighin"></a>

# 2026-09-14 — a declined weigh-in could never be claimed back, and that predates the change that exposed it (LA-108)

**Branch:** `lane-a/la108-claim-a-declined-weighin` · **Lane A** · no version bump — the list that reaches this is Lane B

## What was actually locked

I filed LA-108 earlier today as "a declined weigh-in is invisible", assuming the missing piece was a
read path. Reading the adapter before building it found something sharper.
`confirmScaleSample` matched `status = 'pending'` and nothing else:

```ts
.where(and(eq(id, id), eq(userId, userId), eq(status, 'pending')))
```

So a dismissed row could not be filed even by an id you already had. The missing list was the second
problem; **the predicate was the first**, and it is the whole reason the lockout sustains itself.

## Why that is worse than losing one reading

The band anchors on the last **confirmed** weight, and only a confirmed reading moves the anchor. A
genuine change of more than `SCALE_WEIGHT_ANOMALY_PCT` between two weigh-ins — a long gap plus an
illness or an injury — puts the owner outside his own band with nothing that can move it, so every
reading after that is outside too. No screen says so, and there was no action that could end it.

**And this predates BF-58.** An accidental *Not me* tap has always been irreversible and has always
failed to re-anchor. BF-58's outer band made the state reachable without a tap, which is what made
it worth finding — but it did not create it. My own Known-Issues row said "BF-58 introduced this"
and that was wrong; it is corrected here and in the entry.

## What shipped

- `confirmScaleSample` accepts `pending` **or** `dismissed`. Still not `confirmed` — claiming an
  already-filed reading twice would re-run `applyScaleReadingToBodyMetrics` on it.
- `listRecentDismissedScaleSamples(userId, limit)`, newest first.
- `GET /api/scale-ble/pending` returns `{ pending, dismissed }`, both arrays of the same
  `{ id, measuredAt, weightKg }` shape.

**`POST /api/scale-ble/pending/<id>/confirm` needed no change at all**, which is the pleasing part:
it was already status-agnostic beyond what the repository allowed, and it already files the weight
against the reading's own `measuredAt` rather than today (Q-25). Widening one predicate turned the
whole path on.

**What is left is a list**, and it is Lane B's: render `dismissed` under the pending section in
`scale-pairing.tsx` with a claim action pointing at the confirm route the pending rows already use.
The lane rule decides the split — reached by `app/api/**` or touching storage is Lane A, and both
lanes means Lane A's half first.

## Verification

Six adapter tests in `lib/data/postgres/__tests__/scale-declined-reading-reclaim.test.ts`, run
against a real Postgres rather than a mock because the fix is one SQL predicate: a dismissed row
confirms and its status changes, a pending row still confirms, an already-confirmed row is refused,
another account's dismissed row is refused, the list returns only this account's declines, and it
orders newest first while honouring its limit. Four route tests cover the response shape and that
the limit is bounded.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| confirm reverted to `pending` only | ✅ |
| `userId` scope dropped from the declined list | ✅ |
| status filter dropped from the declined list | ✅ |
| oldest-first instead of newest-first | ✅ |
| `limit` ignored | ✅ |
| **control** — `ne(status, 'confirmed')` instead of `inArray(['pending','dismissed'])` | correctly passed |

That control is worth keeping rather than just noting: over three statuses the two really are the
same set, and the tests cannot tell them apart because nothing distinguishes them. The explicit
`inArray` shipped anyway, because it stays correct the day a fourth status appears and the negation
does not.

**Not exercised: the S25.** Nothing renders the declined list yet, so there is no screen to look at —
the device check belongs with LA-108's Lane B half. What can be said is that the path is reachable:
the confirm route takes one of these ids unchanged.

<a id="2026-09-14-lane-a-la48-walk-segment-steps"></a>

# 2026-09-14 — a walk's segments count their own steps, and the entry that asked for it was wrong three times (LA-48)

**Branch:** `lane-a/la48-walk-segment-steps` · **Lane A** · no version bump — nothing renders this yet

## What shipped

`WalkSegmentStat.steps`: how many steps a guided walk's fast or slow block actually contained,
stored in the existing `activity_logs.segments` JSONB beside the HR, pace, distance and cadence it
already carried. The owner's ask was *"make sure all these values get stored so we can do data
analysis on it later like steps x distance x time"* — a segment had every one of those except steps.

No migration: `segments` is `jsonb` on the server and `TEXT` locally, so the field is a type change
in five places plus the wire schema, all in one commit.

## The entry said three things that were wrong, and each one changed the work

**1. There are five type places, not four.** The entry listed `WalkSegmentStat`, the `$type<>` in
`schema.ts`, `LocalActivityLog` and `WalkSegmentStatSchema`. It missed
`packages/shared/src/types/body.ts`, which keeps its own structural copy of the segment shape and is
what `ActivityLog` is assembled against. `tsc` found it; reading the entry would not have. This is
BF-70's fifth layer again — when a shape is declared in five places, a count written in a backlog
entry is not the authority on how many.

**2. `steps` was not "a clean derivation from `cadenceSeries` that depends on nothing".** The
obvious derivation — mean spm × duration — is wrong, and not subtly. `avgCadenceSpm` is cadence
*while moving* by construction: a stop contributes no readings, so it cannot pull the mean down.
Multiply that by the segment's wall duration and every pause gets counted at the walking rate. A
segment holding 30 s of walking at 120 spm inside a 180 s window is **60 steps** by integration and
**360** by multiplication. That comparison is now a test, written as the assertion rather than the
prose, so the wrong derivation cannot come back quietly.

It was also a second answer to a question the app already answers. `estimateSteps` in
`packages/shared/src/health/cadence.ts` integrates cadence bins for the walk's own saved `steps`
(Q-230), and its own comment warns against a second integration. Both now go through
`stepsFromCadenceSeries`, so a walk's total and the sum of its segments cannot drift apart.

**One divergence is real and is written down rather than smoothed over.** `estimateSteps` filters to
**strap** readings before binning; the persisted series carries no source, so a caller slicing it
cannot apply that filter. Today the two agree exactly — `pickLiveCadence` returns null on the ring
branch while `RING_CADENCE_VALIDATED` is false, so every reading in the series is a strap reading.
The day ring calibration ships, a mixed-source walk would have segment steps counting ring data the
total excludes. The comment on `stepsFromCadenceSeries` says so and says where to start.

**3. The correction the entry already carried was itself wrong, and this is the one that matters.**
On 2026-09-01 the entry was corrected to say the adherence roll-up "needs no Lane B producer",
because every `readPacer` input is reconstructible after the fact. Two of the three are. **Cadence is
not.** The live bar bands `snap?.liveSpm` (`walk-pacer-bar.tsx:34`) — the tracker's instantaneous
~1 Hz reading — while the only cadence a saved walk carries is `summarizeCadence`'s series, binned to
10 s and holding each bin's **median**. A ten-second median and an instantaneous value fall on
different sides of a target, which is precisely where adherence is decided.

So a post-hoc reconstruction would store a plausible number that is **not** the number the walker
was shown — the BF-59 class the entry invokes against itself two paragraphs earlier. The remaining
two thirds of LA-48 are therefore a design decision (accumulate live on the walk screen, or
reconstruct and label it an approximation) rather than the build the entry described. Both shapes are
written into the entry, along with a second obstacle the reconstruction route has to solve: the HR
and speed target pairs are not present at the save site at all.

## Why this half shipped alone

The entry sanctioned the split itself — *"Ship `steps` first if this is split; it is a clean
derivation."* Half of that sentence was wrong and the other half was right: it is independent of the
adherence design, it needed no producer, and holding it behind an unresolved design question would
have kept a field the owner asked for out of the archive for no gain.

## Verification

Eleven tests across `lib/walk/__tests__/segment-stats.test.ts` and
`packages/shared/src/health/__tests__/cadence.test.ts`: integration versus multiplication on a
segment with a stop, each bin landing in exactly one segment across a boundary, null rather than zero
with no cadence source, the walk total unchanged by the refactor, and — the trap the entry named —
that `steps` **survives** the wire schema rather than merely being accepted by it. Zod strips unknown
keys silently, so an acceptance test passes while the field is being dropped on both write paths.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| `steps` = mean spm × duration (the entry's derivation) | ✅ |
| `steps` removed from the wire schema (the Zod-strip trap) | ✅ |
| empty series returns 0 instead of null | ✅ |
| **control** — the same sum written as a `reduce` (equivalent) | correctly passed |

**Not exercised: a real walk.** Cadence needs a Polar H10 over BLE and no harness here has one, so
every segment written in the sandbox has `steps: null` — which is the correct value for a GPS-only
walk and tells you nothing about a strap-paired one. The first strap walk after this deploys is what
confirms a real number lands. Recorded as a Known Issue.

<a id="2026-09-14-lb105-day-review-seed-independence"></a>

# 2026-09-14 — the read-through spec was wrong in both directions (LB-105)

**Branch:** `fix/day-review-seed-independence` · **Lane B** · no version bump — no product behaviour changed

## The half that was visible

`day-review-read-through.spec.ts`'s first test failed on a clean checkout of `origin/main` in the
sandbox and passed on CI. Filed rather than fixed on the spot, because a guess about CI is not a
finding; the answer arrived when PR #1160's E2E job went green on the exact tree that failed here.

The cause is the seed. Every section of `DayReadThrough` self-hides when its domain is empty, and
the local database has **nothing at all** for today:

```
food_logs 0 · activity_logs 0 · body_metrics 0 · workout_sessions 0 · sleep_sessions 0
```

So the dialog was legitimately blank and the assertion was legitimately failing. A spec that is red
locally and green on CI is worse than one that is simply wrong: it trains a session to skip it,
which is how a genuine failure gets waved through.

## The half nobody was looking at

The **second** test — *"the same section labels appear on /health/day"* — passed on that same empty
day. It should not have been able to.

Its regex was `/^(Training|Activity|Energy|Sleep|Body|Heart rate through the day)$/`, unscoped. The
day screen renders its own score row above the read-through: `Ready`, `HR`, **`Sleep`**, `Move`. So
`^Sleep$` matched a score cell, and the test guarding *"both hosts render ONE implementation, not
two"* **would have passed with `DayReadThrough` absent entirely** — the precise failure it exists to
catch.

The label list was wrong as well. `day-sections.tsx` renders **`Body composition`**; `^Body$` never
matched it, and the anchors meant it matched nothing rather than matching loosely.

## What shipped

- `DayReadThrough`'s root carries `data-testid="day-read-through"`, and **both** tests scope to it.
  That is the only way an e2e can tell this component's labels from a word that happens to appear
  elsewhere on the host screen. (`data-testid` has one prior use in the repo,
  `meal-source-attribution`.)
- The spec records an activity for today in `beforeAll` and deletes it in `afterAll`, reading the
  user's local day back from Postgres in their own timezone rather than computing a UTC one — the
  app buckets by the user's day, and UTC is the wrong day for two hours of it.
- `SECTION_LABELS` is a named constant, checked against `day-sections.tsx` rather than remembered.

## Verification

All six tests in the file pass locally, where one failed before. `day-detail-sheets` and
`day-entry-edit-delete` still green on the same seeded row; teardown verified by reading
`activity_logs` back — zero fixture rows left.

**The soundness fix was falsified directly, not assumed.** With the seed suppressed, the
`/health/day` test **fails** — where before this change it passed on exactly that empty day. That is
the vacuity being gone, demonstrated rather than argued.

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean.

## What was NOT exercised

- **No device, and none needed** — this is a test-harness change plus one `data-testid`. No product
  behaviour changed, which is why there is no version bump or changelog entry.
- **CI was not re-verified for the opposite direction.** These tests were green on CI before because
  its seed records something for today; they should stay green now that the spec makes its own row,
  but a seed that already has an activity means the fixture is additive rather than load-bearing
  there. If CI ever goes red on this file, that is the thing to look at first.
- **The other four tests in the file were not audited** for the same class of unscoped matcher. Two
  of them assert on buttons and a network request, so they are not exposed to it; `the wrap-up steps
  through to a Save` was not examined.

<a id="2026-09-14-lb106-preferences-relaunch"></a>

# 2026-09-14 — LB-106: the flake was never where the entry said it was

**Lane B.** Branch `fix/lb106-preferences-relaunch`. Test-only — no product behaviour, no version bump.

## The entry's cause was wrong

LB-106 said the spec *"clears `localStorage`, reloads, and polls for `ta_weight_lookback` to
reappear from `hydrateUserPreferences`… A slow launch under a loaded CI runner is exactly the shape
that turns a poll timeout into a failure."* Plausible, and not what the log says.

From run `34814623905` (PR #1166, 2026-09-14 07:11 UTC):

```
Error: page.goto: net::ERR_ABORTED at http://localhost:3100/
> 53 |   await page.goto('/')
```

**Line 53 is the relaunch. The poll is line 57 and is never reached** — on the initial attempt *and*
on Retry #1, identically. `hydrateUserPreferences` was not slow; on the failing run it is never
called. The prescribed next step — *"instrument how long `hydrateUserPreferences` takes from launch
on CI"* — would have measured a function the failure does not execute.

This is the **second** entry today whose stated cause did not survive being checked against the
thing it described (LB-107 was the first, and its guess was wrong in both halves). Both were written
by a session that had the evidence available and reasoned instead.

## The spec had already written down how to falsify the last fix

Its header carries `test.use({ serviceWorkers: 'block' })`, added 2026-08-30 against this same
`ERR_ABORTED`, with the condition spelled out: *"If the abort returns, the SW was not it."*

**It returned, with the block in place.** That is the previous session's honesty paying off a
fortnight later — it converted a dead end into a conclusion without re-running anything. The header's
other claim, that `page.reload()` *"aborts the navigation every run"*, is also stale: measured today,
reload **and** a same-URL `goto` both complete in the sandbox.

## What changed, and what is deliberately not claimed

The relaunch is now a **new page** rather than a re-navigation of the live one.

This stands on fidelity alone, independent of the abort: clearing storage under a running app leaves
its React state, its timers and its sync provider alive, and that instance can write a preference key
back or start a navigation of its own. A reinstall is a cold process. `localStorage` is per-origin,
so the clear carries over — verified, the seeded keys still arrive.

**It is NOT claimed to fix the abort.** The abort is CI-only and does not reproduce here, so this
removes the operation that aborted without explaining it. The falsification condition is written into
the spec in the same shape that paid off above: **if a run aborts again, on `fresh.goto` this time,
the relaunch shape was not it either** — the SW block should then be dropped as justified by nothing,
and the runner becomes the remaining suspect, the same run having carried a native
`chrome-headless-shell` segfault on `plan-rescale.spec.ts`.

## Ruled out by reading, not by guessing

No `storage` event listener exists anywhere in the app; the two `window.location.assign` call sites
(`lib/native/rest-timer-chip.ts`, `run-status-chip.ts`) are behind a custom event only the native
layer dispatches; the single `beforeunload` handler (`components/workout-screen.tsx`) mounts only
mid-workout on the workout screen. None can supersede a navigation on `/`.

## Verified

`pnpm check:rules` **Ran 74 of 74**, all passed. The spec passes locally, 3 passed. **The abort
itself was not reproduced and could not be** — that is the whole difficulty, and it is why LB-106
stays open with a `Keep:` rather than being struck.

<a id="2026-09-14-lb107-back-on-tab-goes-home"></a>

# 2026-09-14 — LB-107: back on a tab lands on Home, because it was landing nowhere

**Lane B.** Branch `fix/lb107-back-on-tab-goes-home`. v1.456.6.

## What the owner asked for

*"Just need to make sure when you press back on a tab and there is no where to go it should go to
the home screen."* — 2026-09-13 app-shell pass. It had no entry of its own; it was recorded inside
**RV-36's body**, an entry that had already shipped, and would have been deleted with it. Clearing
RV-36 from the queue is what surfaced it.

## The entry's guess was wrong, and the measurement is the finding

LB-107 said *"exiting the app is the Android default when there is nothing to pop, so this is
likely absent handling rather than wrong handling."* Both halves are wrong.

The handling is **present**: `components/mobile-auth-handler.tsx` registers a Capacitor
`backButton` listener. Registering one **suppresses the Android default** — so the app was never
going to exit. The listener then called `window.history.back()` for every path except `/`.

`components/shell/tab-shell.tsx` flips tabs with `history.replaceState`, deliberately — its own
comment says *"tab flips are peers, not a history trail."* So a tab route has **nothing to pop**,
and `history.back()` there is a **silent no-op**. Back was not exiting the app on a tab. It was
doing nothing at all, on **all four** non-home tabs — not an edge case reached by a deep link.

The same comment claimed the design made *"Android back exit the app like a native tab app."* It
did not, because the listener intercepts first. That comment is corrected in this PR; a false
comment about the interaction under test is how this survived.

## The fix

`backActionForPath(pathname)` in `components/shell/tabs.ts` — `minimize` on `/`, `home` on a tab
route, `pop` otherwise — and the listener switches on it. Two things worth keeping:

- **Home is reached through `navigateToTab`, not `window.location.href = "/"`.** The shell is
  persistent and holds every mounted tab; a location assignment reloads the WebView and throws all
  of that away, turning an instant flip into a cold start.
- **Sub-routes are untouched.** `tabKeyForHref` matches the path **exactly**, so `/nutrition/meal/123`
  and `/workout?session=…` still `pop`. Only the five tab roots change behaviour.

## What was verified, and what was not

- `pnpm lint` 0 errors · `tsc --noEmit` clean · `pnpm check:rules` **Ran 74 of 74**, all passed.
- `components/shell/__tests__/back-action-on-tab.test.ts` — 7 tests. Includes a guard that fails on
  the old `pathname === "/" → minimizeApp … else history.back()` shape, checked against the real
  pre-fix text rather than assumed.
- `e2e/tab-flip-leaves-nothing-to-pop.spec.ts` — run locally, 4 passed. This is the part that is a
  claim about the app rather than about a function: it measures `history.length` across a tab flip
  (**unchanged**) against a sub-route push (**grows**). If a tab flip ever becomes a push, routing a
  tab back to Home would start skipping a real history entry, and this fails.
- **NOT exercised: the gesture itself.** The Capacitor `backButton` listener is native and the whole
  branch sits behind `Capacitor.isNativePlatform()`, so nothing in the sandbox reaches it —
  `pnpm dev` cannot, and `page.goBack()` is a different code path. **The S25 is the only real
  verification**, and it is recorded as owed in `projectOverview.md` and as LB-107's `Keep:`.

## Queue

LB-107 stays queued as a **KEEP** entry — shipped, device check owed. READY for Lane B went 8 → 7.

<a id="2026-09-14-ps35a-delete-alias-pages"></a>

# 2026-09-14 — PS-35a: five alias routes deleted, and the condition attached to the approval

**Lane B.** Branch `chore/ps35a-delete-alias-pages`. v1.456.7.

## What was approved, and the part that was not a blanket yes

Owner, 2026-09-14: *"We only use the APK - delete them if not needed."* Then, in the same breath:
*"What page? we only use the APK; so if its not accessible via the APK and is needed; then make
sure there is a way to access it from APK."*

So the entry's condition: for each of the five, establish whether its destination is reachable
inside the APK by a route the owner walks, and **where the only path to a needed screen is that
page, give it a real entry point before deleting anything.**

Checked, one at a time. All five destinations are reachable without them:

| Deleted | Was | Destination | Reachable in the APK by |
|---|---|---|---|
| `/session-select` | `redirect("/workout")` | Workout tab | the bottom nav |
| `/stats` | `redirect("/health?tab=training")` | Health → Training | the bottom nav + that tab |
| `/config` | `redirect("/program")`, forwarding the query | Program Builder | More → Program builder |
| `/profile` | `redirect("/more")` | More tab | the bottom nav |
| `/workout-select` | **not a redirect** — a second copy of the Workout tab's content | Workout tab | the bottom nav |

**None was the only path to anything**, so no new entry point was needed and the condition is
satisfied rather than waived.

## `/workout-select` was the one that was not an alias

The other four were one-line redirects. This one rendered `WorkoutSelectContent` plus a `BottomNav`
directly — the same screen as the Workout tab, mounted **outside the tab shell**. Going there
dropped the persistent shell, so the other four tabs had to re-mount on the next switch. Three exits
from the activity-done screen and two from the workout-done screen pointed at it.

They point at `/workout` now, which is the same content inside the shell. It also picks up LB-107's
fix, landed this morning: `/workout` is a tab root, so the back gesture from it goes Home, where
`/workout-select` would have tried to pop a history entry that a tab flip never created.

## What the deletion took with it

`/stats` and `/workout-select` were the only two routes that could produce the `stats` and
`workoutSelect` screen palettes, so those keys, their `pathnameToPaletteKey` branches and their four
`--screen-palette-*` custom properties are gone too. Leaving them would have been scenes nothing can
reach — the rot the entry is about, one layer down.

`app/config/__tests__/config-redirect-tab.test.ts` moved to
`app/program/__tests__/legacy-builder-entry-points.test.ts` rather than being deleted with its
subject. **Its invariant has now outlived every specific that named it, twice**: Q-235 removed the
`tab=` value it asserted on, and this removes the redirect hop. What still has to hold is that every
entry point to the Builder lands on it carrying its parameters — so the Q-256 forwarding guard was
re-pointed at the two halves that can now drop `new=program`, the prescription card that sends it and
the route that reads it.

## Verified

- `pnpm check:rules` **Ran 74 of 74**, all passed — and it **caught a real one**: the workouts domain
  index still named `app/config/` and `app/stats/` as live UI routes. That check exists because an
  orientation doc is read as *"what exists and where"* before work starts.
- `pnpm lint` 0 errors · production `next build` clean (the first `tsc --noEmit` after the deletions
  failed on five `.next/types/validator.ts` entries — a **stale generated file**, not the source;
  a clean rebuild regenerates it).
- Unit tests: the relocated Builder-entry test and the background routing test pass.
- `e2e/first-run-empty-states.spec.ts` navigated to `/workout-select` twice and now navigates to
  `/workout` — without that the spec would 404 on a route this PR deletes.

## Not exercised

- **No device.** The changed exits (activity-done, workout-done) are ordinary navigations and the
  destination content is identical, but *"lands on the Workout tab"* has not been watched on the S25.
- **The 404s themselves.** Nothing in the repo links to the five any more, which is what the test
  above asserts; a bookmark or a shortcut outside the repo would now 404. The owner dismissed that
  risk directly — a browser bookmark is not a surface they use.

## Queue

PS-35a removed. Lane B READY 6 → 5. **LB-109 filed** for the Orchestrator: three of the remaining
five READY entries (BF-141, BF-135, LB-47) are finished work whose headings still say a device check
is owed while their bodies record it done — so the top of the lane is items that cannot be started.
Clearing a completed entry is the Orchestrator's sweep, which is why it is filed rather than done.

<a id="2026-09-14-refile-shipped-rv36"></a>

# 2026-09-14 — a done entry was carrying two live findings (RV-36 → BF-100 + LB-107)

**Branch:** `chore/refile-shipped-rv36` · **Lane B** · docs-only, no version bump

## What I found taking the top of the queue

RV-36 printed as READY. It had **shipped on 2026-09-11**
([journal](history-2026-09-14-folded-1.md#2026-09-11-fix-nutrition-scroll-and-day-padding)) and was **verified on the S25 on
2026-09-13** — one of six that passed that sitting. There was nothing to build.

Re-verifying the premise before implementing is what caught it. The entry would otherwise have been
re-implemented, which is what its own text warns against: *"Do not re-fix this blind. It has been
declared fixed twice."*

## But it was not safe to just delete

Two live items were recorded **inside its body**, and nowhere else in the queue:

**1. BF-100 failed on the S25, for the second time.** Owner: *"Checked on more - and still doesnt
work"*. That failure had been pasted into RV-36's body, while BF-100 itself still read:

```
- **Keep:** the device pass, and only that.
- **Verify:** device — on the S25, scroll a tab screen well down…
```

So it printed under *"shipped; a look is owed, nothing is blocked"* — while the look had been taken
twice and failed both times. **That is the trap the `Verify:` field's own documentation names**
(OR-105): unbuilt work filed where nobody goes looking. Deleting RV-36 would have taken the only
record of the failure with it, leaving BF-100 reading as merely unchecked.

It is now a plain buildable entry and prints as READY.

**2. The owner asked for something that had no entry at all.** *"Just need to make sure when you
press back on a tab and there is no where to go it should go to the home screen."* A distinct
requirement — RV-36 was about restoring an offset, this is about where the back gesture goes when
the stack is empty. Filed as **LB-107**.

## The detail worth keeping about BF-100

It is a **device-only failure and the harness says the opposite**: measured in Playwright, `/more` →
*Profile details* → back restores **840**. A green `e2e/scroll-restoration.spec.ts` is therefore not
evidence, and the entry now says so, because reading it as evidence is how this gets declared fixed
a third time.

## This is the third burial this session, in a third field

- `Reference:` filed LA-102 and TN-28 as read-only (LB-104).
- `Verify:` filed BF-100 as awaiting a look it had already failed.
- A **shipped entry's body** held BF-100's failure and an unfiled owner request.

Same shape each time: a real item in a place the queue tells the lane not to look. The first two have
checks or documentation now. The third does not, and probably cannot — no tool can tell a note
parked in the wrong entry from one that belongs there. What it argues for is the habit the protocol
already states: clear a completed entry *when you reach it*, because the longer it sits the more
gets written into it.

## What was NOT done

- **Neither new entry was implemented.** BF-100 and LB-107 both need the S25 — one is a device-only
  failure the harness contradicts, the other is a hardware gesture Playwright cannot send. Filing
  them accurately is the whole of this change.
- **The other 32 KEEP entries were not audited** for the same mis-framing. BF-100 was found because
  RV-36 pointed at it, not by a sweep; there may be more, and a sweep is Orchestrator's.
- **RV-36's own journal and S25 verification were taken at their word**, not re-checked on device.

<a id="2026-09-15-bf100-touchstart-probe-inconclusive"></a>

# 2026-09-15 — BF-100: the probe was refuted, not the hypothesis

**Branch:** `docs/bf100-touchstart-probe-inconclusive` · **Lane B** · docs-only

BF-100 has failed on the S25 twice with its cause recorded as unknown, while `scroll-restoration.spec.ts`
passes in CI every run. That split is what made it look device-only and unreachable from here.

Its candidate cause says otherwise, and the candidate is testable in a browser:
`use-scroll-restoration.ts` cancels a pending restore on **`wheel`, `touchstart` or `keydown`** —
takeover is an input event rather than a scroll delta — and `stop()` latches `done = true` and
disconnects the observer **with no re-arm**. The S25's back gesture *is* a touch, landing on the
screen being restored to. `page.goBack()` fires no touch, which is exactly why the existing tests
never see it.

So Playwright can dispatch the missing half. It was worth trying, and the result is **not** what the
mechanism predicted.

## What was run, and what came back

The existing `/more` push-and-back, twice in one test with equal settle windows: once plain, once
dispatching `new Event('touchstart', { bubbles: true })` on the scroll container right after
`goBack()`.

| arm | restored? |
|---|---|
| control, no touch | **yes** |
| touch on arrival | **yes — 840** |

The touch did not cancel anything.

## Why that is not a refutation of BF-100

**It refutes the probe.** Two specific weaknesses, both mine:

1. **The element may be the wrong one.** It was picked as *"first node whose `scrollHeight` exceeds
   `clientHeight` + 100"*, which is not necessarily the `ref` the hook attached its listener to. An
   event dispatched on a sibling proves nothing about a listener on the real container.
2. **The timing may miss the window.** The dispatch fires as soon as the URL settles, which may be
   after the restore has already landed. `__scrollRestorationInternals` exports `RESTORE_WINDOW_MS`;
   nothing in the probe checked the event arrived inside it.

**The next attempt has to instrument rather than guess** — confirm which element carries the listener,
and that the event arrives inside the restore window, *before* reading anything into the outcome.
Until then this is one more thing that has not been established, and writing it down as "the
`touchstart` theory is dead" would be worse than not having run it.

## The draft that would have shipped a lie

The first version asserted only the touch arm, against `toBe(before)`, and marked itself
`test.fail()`. **It went green.** It would have gone green with no touch dispatched at all — because
the control does not hit that equality in every environment either. A `test.fail()` wrapper around an
over-precise assertion passes for any reason at all, and reports as a confirmation.

What caught it was running the control: restoring the file and re-running the two existing tests
against clean `main`.

## A second finding, about the spec rather than the bug

`scroll-restoration.spec.ts` asserts `toBe(before)` — an **exact** offset. Measured locally against
clean `main`: the restore landed at **1019** against a saved **778**, and the test went red. The
content grows on revalidation between save and restore.

**Restoration was working; the assertion was not.** It survives in CI, so this is a local/CI
divergence rather than a live regression — but an exact-offset assertion cannot tell *cancelled* from
*imprecise*, and that is exactly the distinction BF-100 turns on. Any probe for this class needs a
coarse measure — *did it move off the top at all* — rather than equality.

## Nothing shipped in code

No test was added: a red one makes CI red, and an inverted one would pin behaviour that is not
understood. The entry's own instruction still stands — a fix here changes takeover on every screen,
so it must not be built on a hypothesis. This narrows what the next session has to do, and removes
one probe it would otherwise have written.

<a id="2026-09-15-bf162-bf163-prescription-card"></a>

# 2026-09-15 — BF-162 and BF-163: two defects on one prescription row (BugFix intake)

Docs-only. The owner, reading his Legs prescription: *"Is this right? Is hypertrogpy the correct
tag?"* Two separate answers.

## BF-162 — 85 kg on a Hanging Leg Raise

Reproduced exactly from his stored values; this is arithmetic, not an anomaly.

| exercise | stored `estimated_1rm` | × pct | card shows |
|---|---|---|---|
| Hanging Leg Raise | **128** | × 66% = 84.5 | **`@ 85kg (66%)`** |
| Pull-Up (14 Sept) | **124** | × 72.5% = 89.9 | **`@ 90kg (72.5%)`** |

Both are `bodyweight` with `equipment = ['bodyweight']`. There is no bar to load; the kg figure is a
percentage of an internal index.

**The component already holds the answer and already documents the rule.** Its own prop comment reads
*"A bodyweight 1RM change in kg is a change in an internal index, not in weight lifted, so the
rationale must not quote it (Q-19)"* — and `exerciseTypeById` is right there. Q-19 applied that to the
**rationale** and not to the **exercise rows**, so line 283 computes `weightKg` unconditionally.

The fix is the branch that already exists: line 310 renders `@ {pct}%` when there is no 1RM, visible
on his own card as *Face Pull · 2×12 @ 66%*, which reads correctly. The entry warns against the
tempting alternative — relabelling 85 as "added weight" would turn a visibly absurd number into a
plausible wrong one, the trap BF-158 is already filed against.

## BF-163 — the tag is right and still contradicts its own row

`intensityZoneForPct` maps %1RM to a band with no reference to reps: 65–75% is **Hypertrophy**, and
his squat is at **72.5%**. So the label is correct by its own definition.

But the band carries `reps: '8–12 reps'`, rendered as the chip's tooltip, beside a prescription of
**2×6**. The row reads *"Hypertrophy · 65–75% … 2×6 @ 57.5kg (72.5%)"* — a load in the hypertrophy
band driving a rep count the **same table** calls Strength (4–6 reps).

The load and the reps genuinely disagree; `goal-ranges.ts` allows 5–12 reps for hypertrophy, so 6 is
legal for the goal — but the display band and the goal range are different tables with different rep
opinions and the card shows one of them. Recommended: label from the pair, or drop the `typically N
reps` clause so the chip claims only what it measures. The second is the honest one-line minimum.

**Not a defect in the plan itself** — the session note explains the reduced volume (low readiness,
reported lower-back soreness), so 2 sets is deliberate.

## Also observed: BF-156 has shipped

His screenshot carries the line *"Start the workout without accepting and you'll train the program's
normal loads, not these."* That is BF-156's fix on screen, on a `session_swap`-class prescription —
the opt-in half, which is exactly the case the entry was filed for.

## Not exercised

Docs only. Both mechanisms were read in the shipped component; the two kg figures were reproduced
from production `estimated_1rm` values.

<a id="2026-09-15-bf162-bodyweight-no-kg"></a>

# 2026-09-15 — BF-162: the prescription card told you to load 85 kg onto a Hanging Leg Raise

**Lane B.** Branch `fix/bf162-bodyweight-no-kg`.

## The report

The owner, reading his Legs prescription: *"Is this right?"*

It was not, and it was arithmetic rather than an anomaly — reproduced exactly from his stored values:

| exercise | stored `estimated_1rm` | × pct | card showed |
|---|---|---|---|
| Hanging Leg Raise | 128 | × 66% = 84.5 | **`@ 85kg (66%)`** |
| Pull-Up (14 Sept) | 124 | × 72.5% = 89.9 | **`@ 90kg (72.5%)`** |

Both are `exercise_type = 'bodyweight'`. There is no bar to load: the kg figure is a percentage of an
internal index derived from reps (BF-149), not a weight.

## The rule already existed and was applied to the wrong half

`packages/shared/src/1rm.ts` says it in its own module comment — *"Every surface that shows a stored
1RM resolves its unit here rather than hardcoding kg"* — and exports `isBodyweightType` /
`oneRmUnit` for exactly this. **Q-19 applied that rule to the card's RATIONALE and not to its
exercise rows**, which kept computing `oneRm × pct` unconditionally.

So the fix is one guard on `weightKg`, using the shared predicate rather than a ninth inline
`=== 'bodyweight'` (there were eight already). A bodyweight exercise now falls through to the
`@ ${ex.pct}%` branch **the card already renders** whenever a 1RM is missing — visible today on
*Face Pull · 2×12 @ 66%*, which reads correctly.

## What was deliberately not done

**Relabelling the number as added weight.** 85 is 66% of a 128 index, so calling it "added" would
turn a visibly absurd number into a plausible wrong one — the trap BF-158 was filed against. There
is a test asserting no such wording creeps in.

**A rep target.** `avg_reps` is stored and BF-151 is already about reading it. Percent with no kg is
complete on its own; a rep target is a further improvement, not this.

## Verified

- `pnpm check:rules` **Ran 75 of 75**, all passed · `tsc --noEmit` clean · `pnpm lint` 0 errors.
- `components/workout/__tests__/bf162-bodyweight-no-kg.test.ts` — 5 tests. It pins the owner's two
  real numbers, so the arithmetic that produced the report is the thing under test; it asserts the
  guard sits on the **`weightKg` computation** rather than on the render, because a guard on the
  render alone still computes a figure for the next reader to wire back in.

## Not exercised

**No e2e, and the reason is the seed rather than the change.** There are 27 bodyweight exercises in
`exercise_library` and **none of them is in any `session_exercises` row**, so the harness cannot
render a prescription row for one without inventing fixture state. Seeding that would test a
situation I had constructed rather than the one the owner hit.

**No device pass.** Per the entry: open a session containing a bodyweight exercise and confirm no kg
is shown for it while weighted exercises in the same list are unchanged.

<a id="2026-09-15-bf163-intensity-chip-load-only"></a>

# 2026-09-15 — BF-163: the intensity chip claims only the load it measures

**Branch:** `fix/bf163-intensity-chip-tooltip` · **Lane B**

The owner, on the prescription card: *"Is hypertrogpy the correct tag?"*

**Yes — and that was the problem.** `intensityZoneForPct` maps %1RM to a band with no reference to
reps: 65–75% → Hypertrophy. His squat is prescribed at **72.5%**, so the chip was right by its own
definition. The thing contradicting it was the chip's **own tooltip**, `typically 8–12 reps`, sitting
one line above a prescription of **2×6** — a rep count the same table calls **Strength**.

So the chip was a single UI element making two claims from one input, and only one of them was
supported by that input.

## What shipped

```
- title={`${zone.range} of 1RM · typically ${zone.reps}`}
+ title={`${zone.label} · ${zone.range} of 1RM — named from load alone`}
```

**Not a deletion.** The entry's "honest minimum" was to drop the rep clause, but dropping it outright
leaves a tooltip that only repeats the label already visible in the chip — and a reader whose reps do
not match the band's name still has no way to find out why. Naming the input is what makes the chip
honest rather than merely quiet.

`zone.reps` is now unused — it was that tooltip's only consumer repo-wide — and is **deliberately
left in place**. The better answer needs it, and removing it is a `packages/shared` edit, which is
Lane A's.

## The lane the entry got wrong

BF-163 was filed `Lane: B` while naming `packages/shared/src/workout/intensity-zone.ts`, which is
**Lane A** by the path rule. The two halves genuinely split: the tooltip string is composed in the
card, so the shipped half is pure Lane B and touched no shared file. Recorded on the entry so the
next reader does not re-derive it.

## What is deliberately not done

**The load and the reps genuinely disagree at 72.5% × 6.** The chip is not merely mislabelled, and
picking a side needs a rule the app does not have: `goal-ranges.ts` puts hypertrophy at
`repMin: 5, repMax: 12`, so 6 is legal for the goal, while the display band calls 6 Strength. Two
tables, two rep opinions, and the card shows one of them. Judging the **pair** is the better answer
and is Lane A's — kept on the entry, and not urgent now that the chip asserts nothing false.

## Verification

Two layers, and the second exists because the first is not enough.

The **unit test** reproduces the contradiction from the real prescription, but two of its four
assertions are source matches — exactly the shape that passes vacuously if an edit never reaches the
render.

So there is an **e2e that reads the rendered `title` attribute** off the chip, with the owner's own
row as the fixture (72.5% × 6, a real `session_exercise` on the seeded program). Run against `main`'s
unfixed card it captures the defect verbatim from the live DOM:

```
Expected substring: "named from load alone"
Received string:    "65–75% of 1RM · typically 8–12 reps"
```

That received string, one line above a rendered `2×6`, **is** the owner's report. Both layers go red
without the fix.

## Not exercised

**No device pass.** A `title` attribute is a hover affordance; on the S25 it is reachable by long
press in the WebView and worth confirming reads correctly there. Kept as BF-163's `Keep:` ②.

<a id="2026-09-15-bf164-rep-max-sibling-surfaces"></a>

# 2026-09-15 — BF-164: BF-149 fixed one surface of eight (BugFix intake)

Docs-only, and a correction to my own earlier work. The owner, on the Hanging Leg Raise ready screen
showing **"Last: 11 reps · 12 Sept"** four lines above **"REP MAX 8 RM"**: *"How is this right?"*

It is not. It is the exact defect BF-149 was filed for, still live on the surfaces BF-149 never
touched.

## What actually shipped

BF-149 swapped `exercise-summary-screen.tsx` to the AMRAP-scaled inverse; BF-151 replaced that with
`bodyweightRepMax`. **Both changed that one file.** `repMaxFromOneRm` — the inverse of the *unscaled*
`calc1RM`, which BF-149 itself proved wrong for a bodyweight estimate — is still what four helpers in
`1rm.ts` call:

| site | what it feeds |
|---|---|
| `displayOneRm` (:323) | ready screen, pre-workout list, stats sheet, strength-trend card, baseline hints, year review |
| `displayOneRmSeries` (:396) | every rep-max trend chart, including the one under his 8 RM |
| `displayOneRmDelta` (:344) | the rep-change arrow |
| `rescaleBodyweightReps` (:408) | **prescribed reps**, not display |

Same arithmetic as BF-149 published: stored **128** → `repMaxFromOneRm` gives **8**,
`repMaxFromAmrapOneRm` gives **11**, and `avg_reps` is **11**. The screen prints the true number and
the wrong one four lines apart.

## The half that is not cosmetic

`rescaleBodyweightReps` sets `reps = floor(pct/100 × repMax)` for the static progression style. An
understated rep max understates every prescribed rep count in proportion — at his numbers ~8/11, a
**27% shortfall** on any bodyweight exercise the AI did not prescribe directly. That is training
volume.

## Why it was missed, since the rule it broke is in CLAUDE.md

BF-149's journal checked the **direct** callers of `repMaxFromOneRm`, found the exercise stats sheet,
and concluded the other caller was sound. That was true and insufficient: it did not look for
**wrappers**. `displayOneRm` sits one call deeper and is what seven surfaces import. The
sibling-surface sweep has to follow the helper *up* as well as across — grepping the function name
finds callers, not the surfaces a wrapper serves.

The entry keeps `repMaxFromOneRm` exported rather than deleting it: BF-149 established it is right for
the stats sheet, whose comparison table is built from `calc1RM`, and that file imports it directly for
exactly that reason.

## Not exercised

Docs only. Every figure was reproduced from `1rm.ts` as shipped and his stored `estimated_1rm` and
`avg_reps`.

<a id="2026-09-15-bf165-activity-prefix-narrowing"></a>

# 2026-09-15 — BF-165: it is the `/activity` prefix, and there is a second dead button

**Branch:** `docs/bf165-activity-prefix-narrowing` · **Lane B** · docs-only

The previous entry left BF-165 with one surviving candidate — `router.push` not committing through
`animate()` — and one specified experiment: drive the same push from a control **not inside a sheet**.

`modality-picker.tsx` already provides it. Two buttons sit on `/cardio`, both using
`useTransitionRouter`, both with non-tab hrefs, **neither inside a sheet**.

| tap | destination | result |
|---|---|---|
| **Running** | `/running` | **navigates** ✓ |
| **Guided walk** | `/activity/guided-walk` | **stays on `/cardio`** ✗ |
| Other activity → Treadmill | `/activity` | stays on `/cardio` ✗ |

## What that kills

**`animate()` is not the defect.** Running commits through the identical code path — same router,
same `startViewTransition`, same 300 ms cap. The view-transition machinery works.

**The sheet is not the variable.** Guided walk fails with no sheet anywhere near it. The portal
context, the `BackDismiss` history entry, the close-in-the-same-tick — all irrelevant.

**Both failures share the `/activity` prefix and the success does not.** That is the variable.

## A second dead button, which the owner has not reported

**Guided walk on the Cardio hub does not navigate either.** The report covered only *"Other
activity"*. So BF-165's scope is wider than filed: anything reaching an `/activity*` route from a
client-side push is dead.

That matters beyond the diagnosis. BF-160 established that a fitness test earns no calories and that
*"Other activity → Treadmill"* is the recommended way to log a steady treadmill walk — and the guided
walk is the other half of that surface. Both routes into it from the hub are currently dead.

## It fails silently, which is why nothing was ever logged

During the failing tap: **no console errors, no `pageerror`, no failed requests, no response ≥ 400.**

That is consistent with `error_events` holding nothing for this across three days, and it rules out
the chunk-load failure that was candidate 2's fallback reading. Nothing throws. The navigation simply
does not happen.

## Not a routing-configuration difference

Checked rather than assumed: `app/activity/page.tsx` and `app/running/page.tsx` are both plain pages,
**neither has a `layout.tsx`**, and `middleware.ts` mentions neither. Structurally they are the same
shape.

So the difference is in what the page — or the tree it pulls in — does during a **client-side commit**.
A direct `goto('/activity')` renders fine (200, no errors), so whatever it is bites only on the push
path.

## The next experiment

Bisect what `app/activity/page.tsx` and its tree (`activity-screen.tsx`, `activity-store`,
`reconcileRehydratedActivity`) do on a client commit that `app/running/page.tsx` does not.

The comparison is unusually clean: two structurally identical routes, one working and one not,
reachable from adjacent buttons on the same screen.

## Nothing shipped in code

Same reasoning as before: the probe asserts a navigation that does not happen, so it is red by
construction. The cause is not yet identified, and the surviving suspect has moved from app-wide
navigation to something specific to one route tree — which is a much better place to be, and still
not a place to change code from.

<a id="2026-09-15-bf165-other-activity-dead-tap"></a>

# 2026-09-15 — BF-165: a dead tap whose source path is entirely correct (BugFix intake)

Docs-only. Owner: *"when I try click the treadmill; or any 'Other activity' nothing actually
happens."*

## Why this one matters more than it looks

BF-160 established that a fitness test earns no calories, and **Other activity → Treadmill** is what
the owner was told yesterday to use for a steady treadmill walk, because the guided walk is
interval-only and cannot be flattened. That recommendation currently ends at a dead button.

## The entry is mostly an elimination list, deliberately

Every file on the path was traced and is correct, and `git log --since=2026-09-10` shows **none of
them changed**:

| checked | verdict |
|---|---|
| `selectType` | `startActivity(...)` → close sheet → `router.push('/activity')`, prefetched on open |
| `activity-type-grid` | real `<button>`, `onClick={() => onSelect(type)}` |
| `startActivity` | sets `mode: 'pre'` + type; the rehydrate reconciler only demotes `done`/stale `active`, so it cannot wipe a fresh selection |
| `activity-screen` | `pre` + type → `PreActivityScreen` |
| `page.tsx` / `pre-activity-screen` | auth guard; no mount-time fetch, no throw candidate |
| `getActivityIcon` | `?? DotsThreeCircle` fallback — a bad icon cannot throw |
| `tabKeyForHref('/activity')` | **null**, so it is a real navigation, not a shell flip |
| `/api/activity-types` | returns all 10 types, `treadmill` among them |

Writing that down is the point. Without it the next session repeats the same two hours and reaches
the same place.

## Where it actually points

Runtime, and the entry ranks three candidates by how cheaply they can be told apart on device. The
first is the strongest: `useTransitionRouter` freezes the outgoing screen and polls for route commit
against a **300 ms** cap, and its own comments record that path misbehaving twice before. A
navigation that never commits leaves the old screen up — which is exactly "nothing happens". The
other two are a WebView chunk-load failure and the sheet's close cancelling the push in the same
tick.

`error_events` carries nothing for `/activity` or `/cardio` over three days. That rules out a
reported exception; it does not rule out anything else, because a navigation that silently does not
happen throws nothing.

## Not exercised

Docs only, and the limitation is the finding: this needed the device console and the sandbox has
none. The entry says so rather than guessing a fix.

<a id="2026-09-15-bf165-reproduced-in-harness"></a>

# 2026-09-15 — BF-165 is not device-only, and two of its three candidates are dead

**Branch:** `docs/bf165-reproduced-in-harness` · **Lane B** · docs-only

Owner, on the APK: *"when I try click the treadmill; or any 'Other activity' nothing actually
happens."* Narrowed by him the same day: *"it just scrolls to the top of cardio hub."*

BF-165 was filed as a runtime diagnosis with three candidates, an instruction to **start from the
device console**, and a verification step that is a device procedure. It was sitting at the top of
READY as unstartable.

**It reproduces in a browser.** `/cardio` → *Other activity* → *Treadmill*, and the URL stays
`/cardio`. No device, no WebView, no console.

## What was refuted, by experiment rather than reading

**Candidate 2 — the `/activity` route fails to load — is dead.** A direct `goto('/activity')` returns
**200**, renders *"Log Activity — What are you doing?"*, and logs **zero** page errors.

**Candidate 3 — the close cancels the push — is dead, including the sharper version of it that
looked certain.** `selectType` does three things in one tick:

```ts
startActivity(...)
onOpenChange(false)      // close the sheet
router.push('/activity') // navigate
```

`SheetContent` renders `BackDismiss`, so an **open sheet is holding a pushed history entry**
(`sheet-back-stack.openSurface`), and closing it runs `closeSurface`, which calls **`history.back()`**
to undo that push. A queued pop landing on the entry the push just created would produce the reported
symptom exactly — same screen, scroll reset. It is a clean mechanism and it is wrong.

Reordering to push first and deferring `onOpenChange(false)` by **1200 ms**, so no pop is anywhere
near the navigation, leaves it **still on `/cardio`**. The popstate simply moves to ~1.5 s after the
tap and changes nothing.

## The survivor

`push('/activity')` is not a tab href and not the current URL, so it goes through `animate()` — which
runs the push inside `document.startViewTransition` and polls for the URL against a **300 ms** cap.
Sampled every **10 ms for 4 s**, the URL never becomes `/activity`, not even transiently.

## The trap that produced a wrong conclusion here

**"The URL never showed `/activity`" does not prove the push never started.** Next updates the URL at
**commit**, so an aborted commit and a never-started push are indistinguishable from `location`.

I read the sampler as refuting the history-pop hypothesis and was wrong to — both hypotheses predict
the same trace. Only the deferred-close experiment separates them. A sampler alone cannot, and the
next person reaching for one should know that before they trust it.

This is the same shape as the BF-100 probe earlier today: the measurement was real, the inference
from it was not. The difference is that here the follow-up experiment existed and was run.

## The next experiment, so it is not re-derived

Drive the same `useTransitionRouter.push('/activity')` from a control on `/cardio` that is **not
inside a sheet**.

- If it navigates → the sheet/portal context is the variable.
- If it does not → `animate()` itself is the defect, which is **app-wide navigation** and must not be
  changed on a hypothesis.

**Do not lengthen `NAVIGATION_TIMEOUT_MS`.** The entry's own warning stands: that turns a dead tap
into a slow dead tap.

## Nothing shipped in code

The probe spec is red by construction — it asserts the navigation that does not happen — so committing
it would make CI red, and inverting it would pin a defect as intended behaviour. What it established
is in the entry. The fix touches app-wide navigation and is not something to land at the end of a
session on a surviving-by-elimination hypothesis.

<a id="2026-09-15-bf165-retraction-cold-route"></a>

# 2026-09-15 — Retraction: BF-165 never reproduced, and a cold route looks exactly like a dead tap

**Branch:** `docs/bf165-retract-harness-repro` · **Lane B** · docs-only

Two journal entries earlier today reported that BF-165 reproduces in the Playwright harness, that
*Guided walk* is a second dead button the owner had not reported, and that the failures share the
`/activity` prefix.

**All three are wrong.** The cause was `next dev` compiling the route on demand.

## The control I never ran

Warm the destinations first — `goto('/activity/guided-walk')`, then `goto('/activity')` — then return
to `/cardio` and tap *Guided walk*:

```
WARM after-tap path: /activity/guided-walk
WARM rsc reqs: [".../activity/guided-walk?_rsc=oIyhzzLHhOWICEm7"]
        res:  ["200 .../activity/guided-walk?_rsc=oIyhzzLHhOWICEm7"]
```

It navigates. The RSC request returns 200. Every "dead tap" I measured was a **cold route**.

## Why it was so convincing

`next dev` compiles a route the first time it is requested. A client-side `router.push` issues an RSC
fetch, and that fetch **hangs until compilation finishes**. Measured on the cold run: the
`/activity/guided-walk?_rsc=…` request was still unresolved after 8 s while two sibling `/api/*` calls
on the same page returned 200.

Nothing throws. No 4xx or 5xx. No console error. No failed request. The URL never changes, because
Next only commits on response.

**That is byte-for-byte the signature of the bug I was looking for** — including the "fails silently,
which is why `error_events` has nothing" reasoning, which I offered as corroboration and which was
just as true of a compile stall.

## What each earlier claim actually was

| claim | reality |
|---|---|
| "Reproduced in the harness — not device-only" | It does not reproduce. The entry's device gate was right and I overrode it. |
| "*Guided walk* is a second dead button" | **A fabricated defect.** Guided walk works. |
| "Both failures share the `/activity` prefix" | `/running` simply compiled faster than `ActivityScreen`'s tree inside the same 5 s wait. |
| "The sheet's `history.back()` is not the cause" | Unproven — that experiment also ran cold, so it established nothing. |
| "`/activity` serves 200 on a direct visit" | Still true; a direct `goto` compiles synchronously before returning. |

## The rule this leaves behind

**Warm the destination with a direct `goto` before measuring any client-side push to it.** Without
that, *"the navigation did not happen"* carries no information — and no fixed wait is safe, because
the compile time scales with the tree behind the route.

I had been running controls all day for the *fix* — does the assertion fail without the change — and
that discipline caught three vacuous tests. I did not run the control for the *harness*: does the
happy path work here at all. A dev server that compiles on demand makes "it didn't work" the default
answer for anything not yet visited.

The tell was available and I read past it: the very first probe returned `RSC unresolved: 1` — a
request with no response. An unresolved request is a pending one, not a failed one, and pending means
*waiting on the server*, which is the thing a fresh dev route always does.

## Where BF-165 stands

Back where the entry had it: **device-gated, cause unknown, three candidates open.** The source-path
elimination table at the top of that entry is unaffected — it came from reading, not from the harness.

Three PRs (#1227, #1230 and their journal entries) carry the retracted claims; this entry and the
retraction block on the backlog entry are what correct them. The entries are left in place rather than
rewritten, because the sequence is the lesson.

<a id="2026-09-15-bf165-scroll-to-top-narrows-it"></a>

# 2026-09-15 — BF-165 narrowed: the tap fires, the navigation doesn't (BugFix intake)

Docs-only. BF-165 was filed with three ranked runtime candidates and one question for the owner:
does the sheet close? His answer settles it.

> *"When i tap any activity from other activity it just scrolls to the top of cardio hub."*

So the sheet **closes**, the screen **stays** on `/cardio`, and the hub **scrolls to the top**. A tap
that never fired would not move the scroll. A chunk-load failure would not either.

## The scroll reset is the evidence, not a side effect

`cardio-content.tsx:87` scrolls in a **nested `overflow-y-auto` div**, not the document scroller.
`use-scroll-restoration.ts` opens by saying it works on the *"window/document scroller, so it cannot
see, save or restore a nested element's `scrollTop`"* — and `/cardio` does not call it anyway; only
`pull-to-sync` and `nutrition-content` do.

A view transition snapshots and re-lays-out the page. The root scroller survives that; a nested one
is not covered. So `startViewTransition` **completing without a navigation** leaves exactly what he
described: same screen, scrolled to top. That is candidate 1 from the original entry, and it demotes
the other two.

**Recorded as the mechanism that fits, not as a measurement** — it is not verified on device, and the
entry says so. Proving it costs one console line: log `location.href` inside the commit poll and see
whether it ever changes.

## What it changes about the fix

The question is no longer "does the tap fire" but **why `router.push('/activity')` does not commit
inside the 300 ms cap**. The sheet's `onOpenChange(false)` runs in the same tick immediately before
the push, and Radix unmounts the portal on close — that ordering is the first thing to try moving.

The entry now warns against the obvious wrong fix: **raising `NAVIGATION_TIMEOUT_MS` turns a dead tap
into a slow dead tap.** The cap is a safety net for a navigation that never lands, not the reason
this one doesn't.

## Not exercised

A local `pnpm dev` was started to reproduce this and could not: `/cardio` and `/activity` both sit
behind `auth()`, and the sandbox has no session. That is why the mechanism above is reasoned from the
source rather than observed, and why the entry still asks for one device console line.

<a id="2026-09-15-bf166-back-button-ignores-sheets"></a>

# 2026-09-15 — BF-166: the back button cannot see an open sheet (BugFix intake)

Docs-only. Owner: *"If you have a nutrition meal creator menu open and you press the back button - it
makes the page behind it go back to main."*

## Three guards, none of them an overlay

The global Capacitor `backButton` listener checks an active workout, an active guided walk, and an
active activity — each a full-screen *mode* held in a Zustand store — then falls through to:

```ts
case "home": navigateToTab(routerRef.current, "/"); break
```

`/nutrition` is a tab, so `backActionForPath` returns `"home"` and the app goes to Home with the
builder still open on top. His sentence describes that line exactly.

## Why it never showed up in a browser

**Android's hardware back does not produce an Escape key.** Radix closes a `Sheet`/`Dialog` on Escape
and on an overlay tap, so the web build looks correct. The Capacitor `backButton` event is a separate
channel that the overlay primitives know nothing about — which is also why the three guards that do
exist are all store-backed modes: those were the only closable states anyone had a handle on.

## It is every overlay in the app

**52 files** render a `<Sheet>` or `<Dialog>`, and **no overlay registry exists** — `grep` for
`openOverlay|overlayStack|topOverlay` returns nothing. Over a tab route any of them sends the user
Home; over a sub-route it pops the page. The meal builder is just the one carrying enough typed-in
state for the loss to be obvious.

## The fix is central, not 52 changes

A module-level stack that `SheetContent` and `DialogContent` push to on mount and pop on unmount,
consulted by the listener before `backActionForPath`. Two primitives and one guard; every consumer is
untouched because they already route through those primitives.

**Order is the subtle part, and the entry pins it.** The overlay check goes **after** the three mode
guards, not before — a confirm dialog raised *by* one of those guards is itself an overlay, so
checking overlays first would make the second back press close the confirmation instead of answering
it. Mid-workout back must still reach its own prompt.

Out of scope: what back does with nothing open. `backActionForPath` returning `"home"` on a tab is
deliberate — tabs are peers reached by `replaceState`, so there is nothing to pop.

## Not exercised

Docs only. The listener, the three guards and the absence of a registry were read in the shipped
source; the 52 is a `grep` count.

<a id="2026-09-15-bf166-back-closes-overlay"></a>

# 2026-09-15 — BF-166: the registry already existed, under different names

**Branch:** `fix/bf166-back-closes-overlay` · **Lane B**

Owner: *"If you have a nutrition meal creator menu open and you press the back button - it makes the
page behind it go back to main."*

## The entry asked for something the app already has

BF-166 stated *"no overlay registry exists"* and proposed building one: a module-level stack that
`SheetContent` and `DialogContent` push a close-callback onto, consulted by the back listener.

**That stack exists.** `lib/hooks/sheet-back-stack.ts`, reached through `useSheetBackDismiss` →
`BackDismiss`, which **both** primitives already render — BF-27 put it there, deliberately central,
with a docstring explaining why it is not at the 45 call sites. The entry's grep looked for
`openOverlay|overlayStack|topOverlay`; the real names are `openSurface` and `closeSurface`.

**Building the proposed registry would have left two stacks disagreeing about what is open** —
strictly worse than the bug. This is the twelfth time an entry's stated cause has not survived being
read against the thing it describes, and the first where acting on it would have added a defect
rather than merely wasted a session.

## The real defect, which is one line

`openSurface` pushes with `pushState(state, '')` — **no URL argument** — so
`window.location.pathname` never moves. And `backActionForPath` reads nothing *but* the pathname.

| route | `backActionForPath` | what the listener did | consumed the pushed entry? |
|---|---|---|---|
| `/nutrition` (a tab) | `"home"` | `navigateToTab(router, "/")` | **no** |
| `/` | `"minimize"` | `App.minimizeApp()` | **no** |
| `/more/details` | `"pop"` | `window.history.back()` | yes |

**Only `"pop"` ever worked, and only by coincidence** — `history.back()` happens to be the thing that
consumes the entry. The other two branches navigate or background the app without touching history,
stranding the sheet on top of a page that has moved. That is the owner's report exactly.

**`"minimize"` is a second symptom the entry did not name:** a sheet open on Home, and back sends the
app to the background instead of closing it.

## The fix

Export `hasOpenSurface()` from the existing stack; have the listener call `history.back()` when it is
true. That routes into `handlePop`, which closes the topmost surface through Radix's own
`onOpenChange` — the identical path as the X button, so every guard already attached to a sheet's
close still runs.

**The entry's one correct instruction is kept: the check sits *after* the three mode guards.** Each
of those *raises* a dialog (`LeaveWorkoutDialog` and its siblings), and that dialog is itself on this
stack — checking overlays first would make a mid-workout back press close the confirmation instead of
answering it. A test pins the order.

## Verification, and its honest limit

`components/__tests__/bf166-back-closes-overlay.test.ts`: **4 of 5 assertions fail against `main`**.
The fifth passes on both sides deliberately — it records that the primitives were already wired,
which is the finding that stopped a duplicate registry being built, and a test that only passes after
a change cannot carry that.

**No harness run exercises this at all.** Android's hardware back is a Capacitor channel; Playwright
cannot fire it, and in a browser Radix closes on Escape so the bug never appears. The unit tests
cover the stack's behaviour and the listener's ordering — **not the gesture**. The device is the only
real check and it is owed.

## A note on the assertion that failed first

The ordering test initially measured `indexOf('hasOpenSurface')`, which matched the **import line** at
the top of the file rather than the call site — so it compared against a position before everything
and proved nothing about order. Both assertions now anchor on `hasOpenSurface()` with parentheses.
The code was right; the test was measuring the wrong occurrence.

<a id="2026-09-15-bf74-photo-remove-confirm"></a>

# 2026-09-15 — BF-74: the comment arguing against a confirm was checkable, and wrong

**Branch:** `fix/bf74-photo-remove-confirm` · **Lane B**

Owner, on the S25, 2026-09-13: *"it gives me an undo option; but no warning before removal"*.

Round one of BF-74 had moved the meal photo's remove control out of the dismiss corner and changed
the ✕ to a bin. Both worked. The control was reachable, read as removal — and still destroyed the
photo on a single tap.

## The component had already argued this out, in writing

`meal-photo-tile.tsx` carried its own reasoning for shipping undo instead of a confirm:

> A confirm dialog is the crude answer; undo is the better one, because re-picking is already one
> tap — the tile is a real picker — so the toast just spares the gallery round-trip.

**That is a claim about the camera, and it is checkable.** The tile calls:

```ts
CapCamera.getPhoto({ resultType: Base64, source: CameraSource.Prompt, quality: 80, … })
```

There is no `saveToGallery`, and the plugin defaults it to **false**. So a photo taken through this
tile is never written to the gallery or anywhere else — it exists only as the base64 string the
component is holding. **There is no gallery round-trip to spare, because there is nothing in the
gallery.** The toast is time-limited; when it passes, the photo is gone.

So the entry's "either confirm first, or make the undo durable" resolves on evidence rather than
taste. The argument *does* hold for a gallery-*sourced* photo, which is why the undo stays as well —
it costs nothing and still helps that case.

## What shipped

`components/ui/confirm-dialog.tsx`, which already exists and backs five other surfaces, in front of
the remove. The undo toast is unchanged behind it.

One non-obvious detail: the dialog is wrapped in a `stopPropagation` div. It renders **inside** the
picker's own `role="button"` wrapper, so a tap on Cancel would otherwise bubble out and open the
camera behind the dialog it had just dismissed.

## The spec was strengthened, not loosened

`meal-photo-picker.spec.ts` already owned this control, and its removal test tapped the bin and
expected the photo gone — so the change broke it, correctly. It now drives **both arms**:

1. **Cancel first**, and assert the photo survives a save.
2. Then confirm, and assert it clears.

The order is deliberate. A confirm dialog that removes anyway passes every happy-path assertion; only
the cancel arm can catch it. Against `main` the test fails on the missing dialog.

## Shipped alone, not with its batch

`nutrition-ui-uplift` holds six entries. Four are shipped with only a device check owed — no code to
write. BF-51 ① is device-blocked. The batch exists to aggregate a *device sitting*, and that is
unaffected: there was nothing else buildable to fold in.

## Not exercised

**No device pass**, and the outstanding half is one a browser structurally cannot judge: whether the
undo toast is still reachable by a thumb before it dismisses. That was already the only protection
the owner had, and it remains the second line behind the confirm. Kept as BF-74's `Keep:`.

**The native picker path is untouched and untested here** — `Capacitor.isNativePlatform()` is false
in a browser, so the harness drives the `<input type=file>` branch. The `saveToGallery` finding above
comes from reading the call, not from running it.

<a id="2026-09-15-chore-or-116-lane-dispatch"></a>

# 2026-09-15 — the lane sweep: one entry was being offered to both lanes at once

**Branch:** `chore/or-116-lane-dispatch` · backlog, batons and one check script. No product code.

## The dispatch failures, worst first

**BF-100 had no `Lane:` and was printing in READY for BOTH lanes simultaneously.** Two agents could
have picked up the same entry on the same morning. It is the one failure mode that makes
`next-item.js` actively misleading rather than merely incomplete, and it survived because the other
seventeen lane-less entries were all parked, so nothing else exposed it. Assigned **Lane B** by the
path rule; seventeen more assigned with it.

**Four finished entries were sitting at the head of a lane's work list** — BF-141, BF-135, LB-47,
BF-64. Lane B had already diagnosed three of them and filed **LB-109** asking the Orchestrator to
clear them, which is exactly the right escalation and is now done. LB-47 and BF-64 went out under a
shared note recording that **nothing verified either fix**, per LB-109's own insistence that they not
be swept in with the genuinely verified two.

**Lane A's baton claimed READY was nine entries and all nine were standing exclusions.** It is 14 and
six are startable, **LA-76 among them** — released by the owner yesterday, and half of it needs no
migration because a deload *session* is already dated. A stale "nothing startable" reads exactly like
a true one, which is why that line is corrected in place with the count that falsifies it.

**BF-126 was re-parked.** Yesterday's sweep removed its `Gate: owner` because the decision had been
made — right about the decision, wrong about the entry. The blocker moved to the artwork rather than
clearing, so Lane B would have found an afternoon's wiring and no assets. The gate now names the
asset.

## The check I wrote yesterday had the wrong half of the class

`keepIsSettled` keyed on `VERIFIED ON THE S25`. **A look that comes back FAILED is just as settled —
and the entry it leaves behind is worse**: not shipped-work-advertising-debt, but *live, unbuilt work
filed as finished*. Widened to read all three outcomes, and it immediately found two:

- **TN-13** — and it moved the lane. The owner's check showed the cue does not render; the cause is
  `RING_GEOMETRY.showDot`, true for **one of eighteen** ring styles. So the defect is in
  `components/oura-score-chip-row.tsx`, not the shared helper the entry named, and the entry went
  **A → B**. The number itself is right: Home read 60, `body_metrics` holds 60 for today against a
  54–57 baseline — **so the cue that failed to render would have said about `+4 vs usual`. The
  feature failed on the one day it had something to say.**
- **BF-74** — failed on 2026-09-13 (the photo ✕ destroys on a single tap with only an undo toast) and
  kept both fields saying a check was owed. Its struck `Keep:` is retained as the fix's acceptance
  test, because what it asks — whether the toast is reachable before it dismisses — is the half a
  browser cannot judge.

`backlog-verify-field.test.ts` asserted this state could not exist. It now admits a third outcome,
and its `stillOwed` list is **legitimately empty**: all seventeen of its snapshot are worked through.

## One new entry, one revert

**OR-116** — Home's `60`, Health's bare Resting HR tile and `/health/heart-rate`'s 73/50/89/125 are
one signal rendered with three different amounts of context and no qualifier anywhere. Nothing
computes a wrong number; the owner compared them and reasonably concluded something was broken.

**PS-4's lane assignment was reverted.** The entry argues in its own body for staying unclassified —
each role rewrites its own baton, so it is done by whoever hands over next. Recorded in place, since
the next sweep will be tempted the same way.

## Round five's answers

Q-1b deferred a third time **with a trigger** (v2), and the number it asked for is on the entry so it
is not re-derived. BF-106 and LB-52 both accepted and deferred — re-offer, do not re-argue. The
calorie model confirmed working on the S25, which closes the question under BF-134/142/154 rather
than another copy edit. RV-38 routed to Tuning at the owner's direction.

## Result

Queue **327 → 326**; `Verify: device` **22 → 20**. Lane-less entries **21 → 2**, both correctly so
(`Q-253` is a `Reference:`, `PS-4` deliberate). No entry appears in two lanes.

`check-backlog-pointers` clean on 326 · `pnpm check:rules` **Ran 75 of 75** · 267 script tests green.

**Surfaces not exercised:** none apply — backlog, batons and one Node check script. No product code,
so nothing reaches the APK from this PR.

<a id="2026-09-15-inferred-contributors-and-the-pillar-contract"></a>

# 2026-09-15 — inferred contributors, and what a pillar actually requires

**Tuning.** Docs-only. TN-38 task C changed shape twice in one day against owner pushback, and
landed somewhere better than either starting point.

## Two rejected shapes, both kept in the entry

**A core capped at ~92** — proposed in the morning, retracted by the afternoon. The objection is one
line and unanswerable: a permanent ceiling for not owning hardware is a penalty, not honesty.

**Filling missing contributors with the population-typical pattern** — the owner's own first
formulation, *"nothing good or bad, just the commonly seen one"* — **measured to fail**, and that
measurement is the most useful thing in this entry. A phone-only user has 38 of sleep's 110 points
measured and 72 inferred, so a fixed fill dominates:

| night | today | unconditional fill | conditional fill |
|---|---:|---:|---:|
| textbook — 8 h, consistent | 100 | **80** | 92 |
| poor — 6 h, erratic | 57 | **66** | 52 |

It collapses the scale to 14 points **and inverts the ranking**. "Use the average where you don't
know" sounds obviously safe, which is exactly why it is written down as tested rather than argued.

## Where it landed

**Every contributor always carries a value — measured where possible, conditionally inferred where
not.** That escapes the trilemma (reaches 100 / means the same for everyone / stable across a
hardware change — every other design gets two of three) by removing its cause: a score with holes in
it. Conditioning on observables is what makes it work; eight consistent hours predicts
better-than-average stages, not average, because the population average includes every six-hour
night.

Three rules ship with it: a `measured | inferred` flag **and** an uncertainty on every value; an
inferred value may **never** trigger an action; and inference needs a prior to infer from —
`personal-baseline.ts` already maintains one for six metrics, but a user who never owned the sensor
has none, and a population prior cannot be fitted from one account.

**Gated on TN-39**, because the app already infers — daytime stress guesses HRV from heart rate and
temperature — and nobody has checked whether that guess works. Validate the technique where ground
truth exists before extending it into scoring. The interim is today's behaviour plus a label:
*"82, from 3 of 10 signals."*

## The contract

Six inputs carry the whole app: **bed/wake times, steps, body weight, logged workouts, logged food,
daily check-in** — all from a phone and a person. Sleep and Readiness measure 35% of themselves from
that floor, Activity 63%, and Workouts, Body and Nutrition essentially all of themselves.

**Cardio is the one exception: no manual floor, nothing to infer from, 0%.** It should be hidden for
a user with no heart-rate source rather than scored at zero.

## Not exercised

Docs-only; no code changed, nothing run on device. The score tables are worked examples run through
the real weights in `sleep-score.ts`, not logged nights. The conditional-fill column assumes an
inference model that does not exist yet — its sub-scores are plausible stand-ins chosen to show the
range surviving, and **the actual figures will differ once a real estimator is fitted**. What the
table establishes is the direction of the two fills, not their values.

<a id="2026-09-15-la108-declined-weigh-in-list"></a>

# 2026-09-15 — LA-108: the residue *was* the work

**Branch:** `feat/la108-declined-weigh-in-list` · **Lane B**

LA-108 printed under **KEEP** — *"shipped; only the stated residue is owed. Not new work."* Its
residue read *"the list, and only the list"*, which is a buildable UI task with a lane, a file and
three implementation notes. It had been sitting there since 2026-09-14 while READY held two
device-blocked entries and the lane looked empty.

Found by reading the Keeps whole rather than trusting the section header — which is the thing my own
baton says to do and which I had not been doing.

## Why it mattered

The weight band anchors on the last **confirmed** weight, and only a confirmed reading moves it.

So an accidental *Not me* tap was **irreversible**. A genuine change beyond
`SCALE_WEIGHT_ANOMALY_PCT` — a long gap plus an illness or an injury — put the owner outside his own
band with nothing able to move it, and **every** reading after that was outside too. Silent, and
self-sustaining.

This predates BF-58 rather than being caused by it. BF-58 made the state reachable without a tap,
which is what made it worth finding.

## What shipped

A **Declined weigh-ins** list under the pending section in `scale-pairing.tsx`, each row claimable
through **the same `POST /api/scale-ble/pending/<id>/confirm`** the pending rows use.

That sameness is the design, not a shortcut: the engine half widened `confirmScaleSample` to match
`pending` **or** `dismissed` — never `confirmed`, so claiming twice cannot double-apply — and the
route already files the weight against the reading's own `measuredAt` and re-anchors the band. There
is deliberately no second write path to keep in step. Claiming fires the Q-126 invalidation pair
before the refetch, for the same reason confirming does.

**All three of the entry's notes were followed, and each is pinned by a test:**

- **Server order preserved, no sort.** Newest-first is deliberate: in the lockout this exists for, the
  readings at the top *are* the wrongly-declined ones, because the scale is mostly his.
- **A `weightKg: null` row still lists.** A frame that would not decode is archived too.
- **No dismiss action.** These are already dismissed; the only move is to claim one back.

## One addition beyond the spec

Each row shows its time, via `formatTimeOfDay(r.measuredAt, userTz)`.

A pending reading is "just now"; a declined one can be days old, so without the time you cannot tell
which row you are claiming. The user's timezone, never the device's — `formatTimeOfDay` is the one
place that decides how a clock time renders here.

## The test that passed for the wrong reason

Four of the five assertions failed against `main` immediately. The fifth — *"offers no dismiss
action"* — passed.

It was a `.not.toMatch` over `src.slice(src.indexOf('dismissed.length > 0'))`, and `indexOf` returns
−1 when the section does not exist, so `slice(-1)` handed it the last character of the file. A
negative assertion over almost-nothing passes every time.

It now asserts the section is present first, and that it actually offers the claim. **5 of 5 fail
against `main`.**

## Not exercised

**No device pass**, and the BLE scale is not reachable from the sandbox — the list was driven from the
route's shape rather than from a real declined reading. On the S25: decline a weigh-in, confirm it
appears under **Declined weigh-ins** with its time, claim it back, and confirm the weight files and
the band re-anchors. Kept as LA-108's `Keep:`.

<a id="2026-09-15-la109-tab-flip-stale-tree"></a>

# 2026-09-15 — LA-109: the tab flip's stale route tree, and the BF-49 link it did not survive

**Branch:** `fix/la109-tab-flip-stale-tree` · **Lane B**

The owner: *"Going to more; then going to profile details and pressing back gets me to the home page
again."* Two lines of production code, and the session's actual output is a negative result about a
different entry.

## The fix

`show()` flips tabs with `window.history.replaceState(null, "", href)`. Next patches `replaceState`
and re-injects **its own current tree** — still the previous tab's, because no Next navigation
happened. So the `/more` entry carries the route tree for `/`. Back restores it, Next renders
`(home)/page`, and `TabShell` is handed `initialTab="home"` while the address bar says `/more`.

The entry's own suggested shape was to hand `replaceState` a state object carrying the destination
tab's tree, and it flagged that this reaches into `__PRIVATE_NEXTJS_INTERNALS_TREE` and should be
measured before adopting. It did not need adopting. **The address bar is already correct** — it is
the only half of that history entry the bug does not corrupt — so reading it at mount is sufficient
and touches no internals:

```ts
const [state, setState] = useState<ShellState>(() => {
  const fromUrl = typeof window === 'undefined' ? null : tabKeyForHref(window.location.pathname)
  const start = fromUrl ?? initialTab
  return { active: start, mounted: [start], epochs: { … } }
})
```

`usePathname()` would not work here and the reason is the whole bug: it reads from the very tree that
is wrong, so it would agree with `initialTab` and change nothing.

## The check that made it a fix rather than a green test

**The spec was run against `main`'s unfixed `tab-shell.tsx`, and the sub-route test goes red there.**
This is not ceremony. The first draft of that same spec used `page.goto('/more/details')` — a full
document load, which rebuilds history from scratch, so the stale entry never survived to be popped.
It passed while the bug was completely untouched, and the entry had *warned* about exactly this one
line above where the mistake went in. Tapping the real `router.push` affordance is the whole spec.

## The part worth keeping: BF-49 is not this

LA-109's entry said BF-49 — *"tapping a workout, then back, leads to health training not home"* — was
*"very likely the same defect"*, and instructed that neither be fixed until one had been tried
against the other's repro. The theory was clean and symmetric: a real load of `/health` leaves Next's
tree on Health; flipping to Home rewrites the URL to `/` and leaves that tree behind; a push off Home
and a back should render Health under a `/` URL, which is the report verbatim.

**The trial was run. It refutes the link.** The second test in
`e2e/la109-back-from-subroute.spec.ts` drives that sequence with the precondition supplied
deliberately — real `goto('/health')`, a **flip** to Home, `router.push('/health?tab=training')` off
the streak card, back — and it **passes against the unfixed file**, in the same run where LA-109's
own test fails. The sequence will not break even when handed the stale tree on purpose.

That is a stronger negative than BF-49's existing *"does not reproduce in the web harness"* note,
because that one had an available excuse — its repro began with a `goto`, so no entry ever carried a
stale tree. This one begins with the flip. The excuse is spent, and BF-49 goes back to needing the
device repro it has asked for since 2026-08-30.

The test stays in the file as a regression guard — the reverse direction is what a naive version of
this fix would break — with a docstring saying in as many words that it is **not** a BF-49
reproduction, so a future green run is not read as a confirmation. A vacuous test that nobody has
labelled is worse than no test, because it answers.

## Not exercised

**No device pass.** The Android system back gesture and the WebView's history handling are not
reachable from the sandbox; `page.goBack()` is the same history step, not the same gesture. Kept as
LA-109's `Keep:` and a `projectOverview.md` row.

**BF-100 is unblocked but untested.** It could not be read while this stood — if back renders Home
there is no `/more` scroll position to restore. Its own `touchstart` candidate cause is untouched and
still needs the device.

<a id="2026-09-15-lane-a-baton-refresh"></a>

# The Lane A baton said six items were startable; five of them were not

**Lane A · branch `lane-a/baton-refresh` · docs only.**

## What was wrong

`docs/agents/state/implementation-lane-a.md` carried a `Now` section dated 2026-09-13 reading:

> *"Startable, top first: BF-164, PS-41, PS-42, LA-76, Q-52, Q-28."*

Checked against `main`: **BF-164 and PS-42 have shipped** and are out of the queue entirely (#1201,
#1204); **PS-41 carries `Gate: owner`**; **Q-52 is PARKED on `Needs: LA-110`**, which is itself
unanswered; **Q-28's own entry says not to build on the measured number**. One of the six, LA-76,
is still queued — and it is waiting on an owner decision its own entry says to ask first.

The baton's own warning line is what makes this worth a PR. It says a stale *"nothing startable"*
reads exactly like a true one. The inverse is worse: a successor reading this would have picked
BF-164 off the top, found nothing to do, and had no way to tell whether the entry or the baton was
lying. The container is ephemeral, so this file is what a successor gets.

## What the refresh contains

A full rewrite, never an append — the standing rule, and the reason is visible here: half of this
file was accurate and half was three days wrong, and appending would have left both.

The `Now` section is now a table of all nine READY entries with **why each is not startable**, so the
next session can disagree with a specific reason rather than re-deriving nine of them. Also folded
in: the six open owner decisions; that PR #124 is merged (BF-9's entry claimed otherwise); the
merge-verification rule that a body-only edit has no heading diff (the PS-41 gate loss, recovered in
#1207); and two new gotchas earned today — prove a behaviour-preserving refactor by *running* both
versions rather than reading them, and re-read a plan against its source entry before building from
it.

## The teardown race named the same file again, which the doc said would matter

Gating this hit the vitest teardown race for the **eighth** time, naming
`lib/__tests__/hr-read-routes.test.ts` — the file `docs/local-dev-database.md` explicitly said would
matter if it recurred. It now accounts for **5 of 8** sightings while three other files account for
one each.

That does not restore the single-file theory the 2026-09-11 amendment retracted on one miss, and it
is recorded so as not to overclaim: the honest summary is *mostly one file, but not only*. What it
changes is where a file-based trace would start — the fire-and-forget `upsertWorkoutHrStats` shape is
a lead again rather than a discarded one. Nothing about the operational rule moves: re-run settles
it, and the re-run was clean, eight for eight.

## A small thing worth not repeating

The rewrite first claimed its own line count, which went wrong twice in ten minutes because every
subsequent edit invalidated it. The number is gone rather than corrected a third time — `wc -l` is
the check, and a figure that re-breaks on every edit is a liability in a file whose whole job is
being true.

## Failure surfaces NOT exercised

Docs only; nothing runs. `pnpm ci:local` green — **Ran 75 of 75 Custom Rules steps**, 919 files /
8,717 tests.

<a id="2026-09-15-lane-a-bf164-bodyweight-rep-max"></a>

# 2026-09-15 — the 8 RM that was an 11, on every surface but the one that was fixed (BF-164)

**Branch:** `lane-a/bf164-bodyweight-rep-max-inverse` · **Lane A** · v1.456.13

## What was wrong

The owner, on the Hanging Leg Raise ready screen showing **"Last: 11 reps · 12 Sept"** directly above
**"REP MAX 8 RM"**: *"How is this right?"*

It wasn't. `estimateOneRm` routes every bodyweight set through `calcAmrap1RM`, which applies an
all-out-set discount on top of `calc1RM`. Four helpers in `packages/shared/src/1rm.ts` inverted the
**unscaled** `calc1RM` instead, so a stored estimate read back short by exactly that discount.
Verified against the owner's real number before changing anything:

- `calcAmrap1RM(BW_REF, 11)` = **128** — so his stored 128 did come from an 11-rep set
- `repMaxFromOneRm(128)` = **8** · `repMaxFromAmrapOneRm(128)` = **11**

BF-149 found this and fixed `exercise-summary-screen.tsx`; BF-151 then replaced that fix with
`bodyweightRepMax`. Both changed **that one file**. The four helpers are what the other seven
surfaces import, so the defect stayed on all of them.

**One of the four is not cosmetic.** `rescaleBodyweightReps` sets `reps = floor(pct/100 × repMax)`
for the static progression style, so an understated rep max understates every prescribed rep by the
same proportion — about 8/11 at his numbers, a **27% shortfall in training volume**.

## Two call sites the entry did not know about, and one of them was worse

The entry said *"four call sites inside that one file feed all eight surfaces."* Grepping rather than
trusting it found **two more**, both Lane A, both handing a rep max to the **model** — which the
system prompt tells it to quote verbatim, so a wrong number there is reasoned from and repeated as
fact rather than merely rendered.

`lib/ai-chat/tools.ts:36` was the same defect and took the same fix.

**`lib/ai-chat/context.ts:70` was a different and larger one, and swapping the inverse does not fix
it.** It read `repMaxFromOneRm(orm * 0.8)` — take 80% of the estimate, ask what rep count that is.
That is a weighted-lift idea: 80% of a 1RM is a real working weight. A bodyweight `estimated1rm` is
not a weight at all; it is a `BW_REF`-relative index that starts at **101.75 for a single rep**. So
scaling it by 0.8 lands below the bottom of the scale, and the inverse returns **1**. Measured:

```
orm = 128 (eleven reps) → orm * 0.8 = 102.4
repMaxFromOneRm(102.4)      = 1
repMaxFromAmrapOneRm(102.4) = 1      ← both. swapping the helper changes nothing
```

The coach was being told **"target working set 1 reps"**, and would have been for any bodyweight
exercise at any strength level. The percentage belongs on the **reps**, which is how the app already
answers this question everywhere else — `rescaleBodyweightReps` is `floor(pct/100 × repMax)`. Same
convention, one place: 80% of an 11 RM is 8 reps.

## `repMaxFromOneRm` stays, and must

`exercise-stats-sheet.tsx:113` builds its comparison table with `calc1RM`, so inverting `calc1RM` is
the self-consistent choice **there** and only there. The two functions answer different questions and
a future "unify these" would reintroduce this bug from the other side. Both now carry a comment
saying so.

## Three tests were pinning the defect, and the fixtures are why

`displayOneRmDelta`, `displayOneRmSeries` and `describePersonalRecord` failed on the fix. They were
not protecting anything: their bodyweight fixtures were hand-written `calc1RM` values, a forward map
the bodyweight storage path never uses.

`118` is `calc1RM(BW_REF, 6)`. What `estimateOneRm` stores for six reps is `calcAmrap1RM(BW_REF, 6)`
= **114.50** — the documented 5/6 collision. A stored 118 is **7 reps**, not 6. So the fixture and
the assertion agreed with the inverse under test and with nothing else in the system.

They now **derive** from `calcAmrap1RM`, which states the intent and cannot drift — the same lesson
as the date-fixture rule: derive the fixture from the real forward function rather than hardcoding a
number from the wrong one. Two cases were added for the owner's live report (128 → 11 RM) and for the
prescribed-reps half (100% of 128 → 11 reps, 80% → 8).

## Verification

90 tests in `packages/shared/src/__tests__/1rm.test.ts` and 5 in
`lib/ai-chat/__tests__/bodyweight-rep-max-context.test.ts`, including a sweep asserting the coach's
target never lands on 1 rep across estimates from 3 to 25 reps — the old arithmetic returned 1 at
every one of them.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| `displayOneRm` back to the unscaled inverse | ✅ |
| `displayOneRmSeries` back to the unscaled inverse | ✅ |
| `rescaleBodyweightReps` back to the unscaled inverse | ✅ |
| the 80% target back to scaling the index | ✅ |
| `tools.ts` back to the unscaled inverse | ✅ |
| **control** — `displayOneRm` via `repMaxFromAmrapOneRm` directly (equivalent) | correctly passed |

The `tools.ts` guard reads the source, because `oneRmFields` is a closure inside `chatTools` and is
not reachable without standing up a repository. It strips comments first: the fix's own note names
the helper it replaced, and the first version of the check failed on its own explanation — the same
shape that made `check-e2e-stub-dates.js` flag a date inside its own header prose.

Full gate green: `Ran 75 of 75 Custom Rules steps`, lint, both typechecks, `8680 passed | 87 skipped`.
One run hit the LA-101 vitest teardown race; see below.

**Not exercised: the S25, and the AI chat end to end.** No route handler changed, and driving the
coach needs a real model call, so the two AI sites are covered by unit tests and the source guard
rather than by a live conversation. **Check on device:** one bodyweight exercise's ready screen,
pre-workout row, trend chart, stats sheet and strength card all printing the same rep max as the reps
last logged — 11 for the Hanging Leg Raise, not 8 — and its prescribed reps going **up**.

## A correction to something recorded a few hours ago

The LA-101 teardown race fired a **fifth** time during this work and named
`lib/__tests__/exercise-catalogue-routes.test.ts` — a different file from the four before it. The
2026-09-11 amendment in `docs/local-dev-database.md` argued that *"a file that is merely whichever
one happened to be running would vary"*, and concluded the repeatedly-named `hr-read-routes.test.ts`
was the lead. It has now varied. I endorsed that amendment this morning when recording the fourth
sighting; it is weakened and the doc now says so. What survives: zero failing tests, and a re-run on
identical code is clean — five for five.

<a id="2026-09-15-lane-a-bf5-weekly-digest-metrics"></a>

# BF-5 PR 2a — the weekly digest returns its numbers instead of throwing them away

**Lane A · branch `lane-a/bf5-weekly-digest-metrics` · engine half only.**

## What shipped

`app/api/weekly-digest` computed every number the "week in review" banner describes — week-over-week
volume and session counts, weighted sets per muscle, PRs, HRV, readiness, sleep score and hours,
daytime stress, resilience, OTS, weight change — flattened them into a prose block for the model,
and returned only the model's sentences. A page that wanted to *chart* the week had nothing to read
but those sentences.

Now `packages/shared/src/health/weekly-digest-metrics.ts` owns `WeeklyDigestMetrics` and
`buildWeeklyDigestContext`, the route assembles the metrics and formats the prompt **from** them,
and the response carries `metrics` on the fresh path **and the cached one**.

The cached path matters more than it looks: the banner fetches once per completed week, so the cache
hit is the common case and a page fed only by cache misses would be blank almost every time. The
metrics were already computed above the cache check — the cache only ever covered the prose.

No migration. `ai_health_insights.insight` is a `text` column holding prose; the metrics are
recomputed per request, which is what the route already did on every call including cache hits.

## The one claim worth checking, and how it was checked

The risk in this change is entirely that a template drifted and the model quietly got told something
different. Asserting "the prose is unchanged" from a transcription would share the error mode with
the transcription that produced the code.

So it was measured: one rich fixture — every context line populated, all values distinct — run
through `origin/main`'s route and through the rewritten one, both context blocks written to disk and
diffed. **Identical.** That captured block is now frozen in
`lib/__tests__/weekly-digest-metrics-route.test.ts` as the expected value, so any future wording
drift fails there.

Six mutations were run and all six were caught: rewording a line, swapping week/prior-week in the
readiness line, bucketing days in UTC instead of the user's timezone, letting HRV fall back per day,
returning `0` instead of `null` for a missing prior week, and dropping `metrics` from the cached
return. The deliberately-equivalent control — rewriting `meanOrNull`'s reduce as a loop — passed, as
it should.

## Two design points that are easy to get wrong later

**The daily series was never a scope increase.** The backlog entry left it open as a scoping
decision. Every metric was *already computed per day and then averaged away* — readiness comes out
of `liveReadinessByDay` as a `Map<day, value>`, sleep score out of `computeSleepScoreSeries` per
night, stress and volume off rows that carry their own dates. Returning the series is not extra
work, it is not discarding what is in hand.

**HRV chooses its source for the whole window, never per day.** The aggregate falls back from
overnight HRV to the `body_metrics` column only when no night in the window carries one, and the
series keeps that rule: days with no value in the chosen source stay `null`. A per-day fallback
would draw two instruments on one line with nothing marking where it changed — which is the exact
class of thing the readiness work spent weeks separating.

`volumeChangePct` is `null` rather than `0` when there is no prior week, for the same reason: `0`
draws as "no change", which is a different and false claim. The prose still renders that case as
"first week of data".

## Corrections to the entry's own claims

Three were stale and are fixed in the plan rather than re-derived later:

- The weekly reminder already carries `extra: { route: '/?review=week' }` (`day-review-reminders.ts`
  line 105) — **not** `'/'` at line 99. There is a live deep-link contract and
  `lib/__tests__/reminder-deep-links.test.ts` pins it, so 2b's retarget edits a test too. Its
  `ROUTES` rows are parsed as `route.split('?')`, so a query-less `/health/week` needs the test
  generalised rather than the row edited.
- `day-detail-content.tsx` is 299 lines, not 253.
- The route returned four fields, not two.

## What is NOT done

**PR 2b, the whole surface half, is owed and is Lane B's** — the page at `app/health/week/`, its
permanent Health entry point, the banner's chevron becoming navigation, the notification retarget,
and the stray trailing `*` the digest prose ends with. The backlog entry stays queued for it and its
`Lane:` is reclassified B accordingly.

**Nothing user-visible changed**, so no version bump and no changelog entry: the prompt is
byte-identical, the response only gained a field, and `WeeklyRecapBanner` types its `.then` as
`{ digest, weekStart }` and ignores the rest.

## Failure surfaces NOT exercised

Server/JS only — it reaches the device through a Railway deploy with no APK rebuild, and it touches
no offline-first domain, native plugin, safe-area, gesture or notification path, so no device smoke
run is owed. Not exercised: the real Gemini call (mocked in tests; the local dev run returned a real
200 through Postgres but the model response is the part the prompt feeds), Samsung WebView
rendering, and drifted production data — the local run used the dev seed shifted into the recap
window, and the shift was reverted afterwards.

Exercised on `pnpm dev` against the local Postgres with a real authenticated session: 200 with the
full metrics shape, `volumeChangePct` −25 across two real weeks, days bucketed to the right local
dates, gaps as `null`, and `hrv.source` correctly reporting `body-metrics` where the seed has no
overnight HRV.

<a id="2026-09-15-lane-a-bf7-duration-direction-rule"></a>

# 2026-09-15 — the prescription was reading a label where it meant a direction (BF-7 PR 2a)

**Branch:** `lane-a/bf7-duration-direction-rule` · **Lane A** · no version bump — behaviour-preserving by construction

## What shipped

`durationDirection(sessionBudgetMin, preset)` in `packages/shared/src/workout/duration-model.ts`,
and the two prescription branches now read it instead of the preset label.

`short` and `long` were never really labels. They selected **three different algorithms**
(`generate-prescription.ts`): `short` → `dropToBudget` (removes whole exercises), standard →
`fitToBudget` (removes sets only), `long` → `fitToBudget` + `expandToBudget` (adds sets to MRV). What
the branches actually needed to know was whether today is **shorter, the same, or longer** than the
session the user configured — and the labels were a proxy for that which only works while there are
exactly three of them.

Deriving the direction from minutes is the whole of BF-7's hard part. When `DurationPreset` becomes a
number (PR 2b), `durationDirection` is the only function that changes and every algorithm selection
downstream is already right.

**Nothing changes today, and that is asserted rather than assumed:** the first test pins that the
three labels map to −1 / 0 / +1, which *are* the old `=== 'short'` / neither / `=== 'long'` branches.

## The plan I wrote this morning was wrong about one thing

It said to compare the chosen budget against the anchor. `budgetForPreset` **clamps** at
`MIN_PRESET_BUDGET_MIN` (20), so a session configured at or near the floor has its `short` clamped
back up to its own budget:

```
budgetForPreset(20, 'short') === 20      // nowhere lower to go
budgetForPreset(25, 'short') === 20      // 25 − 30 would be −5
```

A direction read off that says **"same"**, which would silently switch those sessions from dropping
exercises to trimming sets — a behaviour change smuggled inside a refactor advertised as
behaviour-preserving, on exactly the sessions least able to absorb it.

So `requestedBudgetMin` is split out as the unclamped half and the direction reads that. **The
request is the intent; the clamp is what is achievable.** Both are tested at the floor and at
`floor + 5`, where the clamp still bites.

The plan is corrected in place rather than left to mislead the next reader.

## Why this is PR 2a and not the whole thing

The plan's steps 1, 2 and 4 — `DurationPreset` becoming a number, and the route's Zod enum widening —
are PR 2b's, because they are what the *control's* new values need and the control is Lane B's. This
step touches **no Lane B file and no wire contract**: the route still accepts the three strings, the
components still send them, and the engine converts to a direction internally. It is shippable alone
precisely because it changes nothing observable.

## Verification

Nineteen tests in `packages/shared/src/workout/__tests__/duration-presets.test.ts`: the label
equivalence, relativity (a 90-minute session asked to go short is still shorter, even though 60 would
be "standard" for the owner's usual session), the floor edge in both directions, and a sweep over
seven budgets asserting a standard session **never** reports "longer" — that is the only thing that
runs `expandToBudget`, and the under-fill it would spend is the finish-early margin.

Mutation pass, exit codes captured directly:

| Mutation | Caught |
|---|---|
| direction read off the **clamped** budget (the plan's error) | ✅ |
| standard reports "longer" — would spend the finish-early margin | ✅ |
| `requestedBudgetMin` re-applies the floor | ✅ |
| the prescription call site reverted to the label | ✅ |
| **control** — direction spelled with `Math.sign` (equivalent) | correctly passed |

The fourth needed its own guard. Nothing behavioural could catch it: `durationDirection` returns
exactly what the labels selected, so reverting the call site leaves every other test green. It reads
the source, strips comments first (the change's own note names the labels it replaced, and the first
version failed on its own explanation), and it is honestly the weakest test here — it is present
because the alternative is nothing.

Full gate green: `Ran 75 of 75 Custom Rules steps`, lint, both typechecks, `8693 passed | 87 skipped`.

**Not exercised: the S25, and no user-visible change to look at.** The control still offers three
segments and the plans they produce are byte-identical. The device check belongs with PR 2b, when 45
becomes selectable.

<a id="2026-09-15-lane-a-bf9-plan-gate-correction"></a>

# BF-9's plan quietly loosened a gate the owner set — corrected the same day

**Lane A · branch `lane-a/bf9-plan-gate-correction` · docs only.**

## What was wrong

[`2026-09-15-trainer-role.md`](../superpowers/plans/2026-09-15-trainer-role.md) shipped in #1222
with a §7 that read:

> *"Ask the owner before merging PR 2 or PR 3 … PR 1 (the migration) is reversible and additive and
> does not need that gate."*

BF-9's backlog entry says the opposite, in words:

> *"Ask the owner before merging **any of it**. This is an auth/authorization change, which CLAUDE.md
> puts in the confirm-first carve-out, and unlike most entries the carve-out is the whole feature
> rather than one migration inside it."*

The plan read *"rather than one migration inside it"* as carving the migration out. It means the
gate is **wider** than the usual case, where only a migration inside a feature needs asking.

## Why this was worth a PR rather than a mental note

The consequence of acting on the wrong version is small — an empty `trainer_relationships` table on
production, dropped in one statement. The consequence of the *pattern* is not. The plan reached its
conclusion by **quoting the entry's own sentence and inverting it**, which is the most credible-looking
way to be wrong: a later reader sees the gate's own words cited and stops checking. A plan that
loosens an owner's stated gate using that gate's own language is how a decision stops binding without
anyone deciding to stop honouring it.

The underlying reasoning error is worth naming too, because it generalises. `CREATE TABLE` really is
additive and reversible, so it really is outside the **destructive** half of CLAUDE.md's carve-out.
But that carve-out lists three independent triggers — data-dropping or non-reversible migrations,
**auth/session/security changes**, and secret handling — and this feature is caught by the second one.
Arguing hard about the trigger that does not apply, and never reaching the one that does, produces a
confident answer to the wrong question.

## What changed

Nothing about the schema, the task split, or the copy-on-assign decision in §2 — only whether PR 1
may merge unasked. It may not. §4's "Reversible" bullet now says reversibility is not the only
trigger here, §7 states the correction and why it was made, and BF-9's entry carries a line so
anyone holding the pre-correction plan knows which version they have.

## Not done

No code, and no PR 1. The migration stays unbuilt until the owner gives the word on the feature.

## Failure surfaces NOT exercised

Docs only. `pnpm ci:local` green, **Ran 75 of 75 Custom Rules steps**.

<a id="2026-09-15-lane-a-bf9-trainer-role-plan"></a>

# BF-9 — the trainer role gets a plan, and the plan stops it rebuilding RV-42

**Lane A · branch `lane-a/bf9-trainer-role-plan` · docs only, no code.**

## Why this and not something else

Lane A's queue is, at the time of writing, **entirely blocked on the owner or on another lane**. Nine
READY entries: LA-76 needs the stored-deload-span decision its own entry says to put to the owner;
RV-42 is PR #1098, built, green and owner-gated; Q-220's remaining lever is a bulk docs move (see
below); Q-1a is bearer auth, whose merge sits in the same confirm-first carve-out; Q-29's Task 5 is
device-paired and unverifiable in a sandbox; LA-110's own question is unanswered; Q-28 says in its
own text not to build on the measured number; BF-7's remaining half is Lane B's.

That left BF-9, which is a feature request with **no plan document** and a documented next step of
"a planning session". A planning PR is docs-only, merges with zero ceremony, and reduces the owner's
decision load rather than adding a second gated code PR to it.

## What the plan settles

[`docs/superpowers/plans/2026-09-15-trainer-role.md`](../superpowers/plans/2026-09-15-trainer-role.md)
— PR 1 (migration, alone) / PR 2 (engine, Lane A) / PR 3 (trainer UI, Lane B).

**The finding worth the session: the cheap version of this feature rebuilds RV-42.** The entry says,
correctly, that `saveProgram(db, userId, program)` is already parameterised by user id, so a trainer
route is "call the same function with a different id". What it does not say is where that breaks.
`app/api/workout-templates/route.ts:74` validates a program's progression styles with
`progressionStyleIdsOwned(userId, …)`, scoped `eq(progressionStyles.userId, userId)`. Aim it at the
trainee and a trainer cannot use one style from their own library. Aim it at the trainer — the
obvious fix, and the one a hurried implementer takes — and the result is a row in one account
pointing at a row in another, with `session_exercises.style_id` on `ON DELETE SET NULL` and the
foreign key as the only ownership link.

That is RV-42's rule (c), in a second domain, **while RV-42's own fix is still sitting unmerged**.

The plan's answer is **copy-on-assign**: copy the referenced style into the trainee's account and
reference the copy, so the trainee owns every row their program depends on and no cross-account edge
exists to guard. The two alternatives are written up with what each is genuinely better at — using
only the trainee's styles needs no new code but makes the feature useless for a new trainee who has
none; allowing the cross-account reference gives the trainer one-place edits and is the bug.

## A stale claim removed

The entry said PR #124 was **"currently open"** and **"awaiting the owner's word since 2026-08-18"**,
and that landing it first was the cheaper order. **#124 merged on 2026-08-23.** Checked against
`main` rather than read off the PR title: `scripts/check-admin-claim-in-api.js` exists, it is wired
into the Custom Rules job, `lib/__tests__/admin-claim-not-authoritative.test.ts` is present, and the
only `isAdminUser(` left under `app/api/**` is the comment recording the fix.

So BF-9's stated prerequisite is discharged. It is blocked only on the owner's word to merge, which
is the whole feature rather than one migration inside it — the migration itself is additive and
reversible and needs no such gate.

## Q-220 deferred, with the reason recorded

Q-220 sat above BF-9 in the queue and was passed over. Its Lever 3 is not a discrete task by its own
terms (*"incrementally, on touch, never as a big-bang rewrite"*), so what is queued is Lever 2 — a
bulk move of ~207 open entries out of the one file five other concurrent agents append to every
session. The failure mode there is not a merge marker but a **silently dropped entry**, the same
shape that resurrected LB-4, Q-454, Q-455 and Q-465 three times from ordinary two-deletion
conflicts; and Lever 1 already showed the specific hazard, with **19 of 72 ✅-marked entries still
owing something**. It wants a quiet window and the Orchestrator's docs authority. Nothing about the
measurement is disputed and the entry stays queued — the reasoning is now written down so the next
implementer does not re-derive it and defer it again silently.

## What is NOT done

No code. No migration number reserved — the plan says to take the next free one at implementation
time precisely because it may sit in the queue while other Lane A migrations land.

## Failure surfaces NOT exercised

Docs only; nothing runs. Every code claim in the plan was read off `main` at `a8a086d793` —
`friendships`' schema and the `addresseeId`-scoped accept at `social.ts:65`, `saveProgram`'s
signature, `progressionStyleIdsOwned`'s scoping, the two `ON DELETE SET NULL` `style_id` columns, and
#124's three artifacts — rather than recalled.

<a id="2026-09-15-lane-a-ps42-illness-radar-generic-path"></a>

# 2026-09-15 — the illness radar was written to degrade and its only caller never let it (PS-42)

**Branch:** `lane-a/ps42-illness-radar-generic-path` · **Lane A** · no version bump — nothing changes for a ring user

## What shipped

`computeIllnessRadar` takes four optional weighted signals — temperature 0.40, breathing 0.25,
resting HR 0.20, HRV balance 0.15 — and renormalizes over whichever are present. It is built for
partial input. Its only caller ran it as `latestSummary ? compute(…) : null`, so a user without a
ring got **no illness computation at all**: not a degraded one, not a `learning` one, nothing.

It now runs on the generic branch too, with `tempZ` and `breathZ` null (no generic source supplies
either, exactly as the generic readiness composite already leaves its temperature contributor null)
and the resting-HR and HRV z-scores taken from the composite rather than recomputed.

**Nothing changes for a ring user**, and that was checked rather than assumed: the owner has
`oura_daily_summary` for **30 of the last 30 days**, so `latestSummary` is non-null and his branch is
untouched.

## What is genuinely new behaviour

A generic user's readiness can now be **suppressed** by the radar, because line 593 subtracts
`illness.readinessSuppression` from the score and that line was already there — it simply never had
a non-null `illness` to read on this path. That is the point of the entry rather than a side effect,
but it is a score moving for a class of user, so it is stated plainly rather than buried: an elevated
or fever flag will dock a ring-less user's readiness the same way it docks a ring user's.

`learning` suppresses nothing, which the tests pin.

## The mutation pass found something the tests could not

Five mutants. Three were caught, and **two survived — both correctly**, which is the useful result:

| Mutation | Outcome |
|---|---|
| revert to the ring-only gate | ✅ caught |
| approximate the absent signals as `0` instead of omitting them | ✅ caught |
| fire the radar with no composite at all | ✅ caught |
| **claim a mature baseline (`nHistory: 99`)** | survived — **equivalent** |
| **control** — the z-scores recomputed inline rather than hoisted | survived — equivalent, as intended |

The `nHistory` mutant looked like a hole and is not. `trailingBaselineZ` needs
`BASELINE_MIN_NIGHTS` **prior** samples before it returns a number at all, so on this path a non-null
z-score already implies `genericNHistory >= BASELINE_MIN_NIGHTS`. The two gates are coupled:
**whenever there is a signal to judge, the baseline is already mature**, and the radar's own
cold-start gate can never be the one that fires here.

That also means the "stays in learning" test pins `signals.length === 0`, not baseline maturity — it
passes for a different reason than its old name claimed. Renamed, and the coupling is recorded in
both the test and `readiness-payload.ts`, because it is an accident of the current threshold: lower
`trailingBaselineZ`'s minimum and the gate becomes load-bearing the same day. Both gates stay.

## Verification

Four tests in `lib/health/__tests__/illness-radar-generic-path.test.ts`, driven through the real
`buildReadinessPayload` with a mocked repository rather than through the formula — the formula was
never the defect, the wiring was. They cover a radar existing at all for a ring-less user, the two
unsupplied signals being **absent** rather than zero (a zero is a claim about a measurement nobody
took, and temperature carries the heaviest weight), `learning` with no suppression and no advisory,
and nothing at all when there is no recovery signal to judge.

Fixtures derive their dates from the clock: the payload builds its own 28-day window from today, so
a hardcoded date walks out of that window and the fixture silently stops contributing.

Full gate green: `Ran 75 of 75 Custom Rules steps`, lint, both typechecks, full suite.

**Not exercised: a real generic account.** The sandbox has no Health-Connect-only user, and the owner
cannot be one — he has a ring, which is what makes his path safe here and also what makes it
unverifiable from his account. The entry's own verification step wants a test account with
`body_metrics`/`sleep_sessions` populated and no `oura_daily_summary` row; that is still owed.
