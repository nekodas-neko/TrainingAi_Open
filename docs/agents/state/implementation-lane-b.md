# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-19 · **By:** the sixth Lane B run · **Next ID:** `LB-1` (bands are gone — see `docs/agents/README.md` §3; legacy Q-350…386 stay valid where already used)

## Now
Nothing in flight. **The meal-label (food sticker) work is the live thread** — Q-389 built it, Q-393
added the ingredient breakdown, and what remains on it is two owner decisions and a print test.

### This run (2026-08-18 → 19, sixth) — the nutrition cluster, top-down

The queue was re-prioritised mid-run to put the nutrition cluster on top. Three of it are done.

- **Q-399 SHIPPED** (v1.325.0, PR #163) — **the default label printed ZERO ingredient lines**, at
  any name length, for a whole release. Its header ate 96.5 of 137 units and the code box took 66 of
  the remaining 66.5, so the budget was negative before the clamp. **Three gates each stayed quiet**:
  the sheet's "Printing N ingredients" copy was gated on `> 0` so it removed itself, the picker
  promised "the full ingredient list", and the only test on that style asserted the code's *size* —
  which a bigger code scored better on.
  [Journal](../../overview/entries/2026-08-19-label-line-budget.md).
  **Q-399's own conclusion was half wrong and worth knowing why:** it said the centred stack cannot
  carry the list *and* a better code than `band`'s 0.369. True at the shipped type sizes, false at
  the type the mockup was drawn at — 3 units of calories height and 7 of gap buy three lines at
  **0.401**. The margin is one step: codeUnits 52 gives two lines, 50 gives three.
  **The four gaps are spec data now** (`stackGaps`), `centredStackLineBudget` reads the same array
  the painter draws, and a test asserts the *promise* rather than a constant.
  **⚠️ It also surfaced Q-358, which matters to every style:** shrinking the code made the E2E's
  decode flaky — passing, then failing, at identical geometry. A module is a **fractional number of
  device pixels for every style that ships**, so every edge antialiases; the `+0.04` bleed in
  `drawCode` was already papering over it. Fixed by doubling the canvas to **600 dpi**
  (`DEFAULT_RENDER_SCALE`), which is a margin, not a fix. Three clean E2E runs after, one failure
  before. **The canvas IS the printed artwork** — share/save hands the viewer these pixels.

- **Q-402 SHIPPED** (v1.325.1, PR #165) — the owner's *"requires a restart of the app"*. The
  eviction was never broken: six write groups clear `energy-balance:` correctly. **Nothing told the
  component to look again**, and the card lives in the persistent tab shell so its
  `useEffect(…, [])` never re-ran. `subscribeToInvalidation` + **`useCachedValue`** are the missing
  half. [Journal](../../overview/entries/2026-08-19-cache-invalidation-signal.md).
  **Use `useCachedValue` for any new self-fetching card** — this is now a CLAUDE.md rule.
  **Owed:** the end-to-end confirmation. Three E2E probes measured **zero**
  `/api/nutrition/energy-balance` requests and never reached the thing under test, because the
  seeded user has no `height_cm`/`date_of_birth`/`sex` **and** `DEFAULT_CARD_WIDGETS` is empty so
  Home renders no card widgets at all. **That fixture does not exist and every Home-card guard needs
  it** — see Q-359.

- **Q-490 SHIPPED** (v1.324.9, PR #156) — two meal-plan memos that had never held; every call site
  built both prop objects fresh. Scalars now.
  [Journal](../../overview/entries/2026-08-18-memo-scalar-props.md). Its review claimed "no inline
  arrows exist anywhere"; **there are four**, on four other memoised components, now baselined by
  `scripts/check-memo-prop-stability.js` and filed as Q-357.

- **Q-478 SHIPPED** (v1.324.8, PR #154) — the two cache today-guards compared a server-stamped date
  to Brisbane's, so both were false 14 hours a day for a New York user.
  [Journal](../../overview/entries/2026-08-18-tz-aware-cache-guards.md).
  Two corrections to that review, made in place: session-select's loading state **does** clear (a
  second unconditional `setMetaLoading(false)` runs after the await — the cost is a round-trip-long
  skeleton, not a hang), and `unwrapToday`/`cachedFetchToday` were deliberately left alone.
  **Q-477 is still open**, including its ratchet on bare `todayInTz()` across client code.

- **Q-488 RE-TAGGED TO LANE A, not built** (PR #152). The entry said "one call in one Lane B
  handler". There is no such call: `lib/local-store` has **no** `deleteActivityLog`, and
  `upsertActivityLog` omits `deleted_at` from **both** its INSERT list and its
  `ON CONFLICT DO UPDATE SET`. A read-merge upsert stamping `deletedAt` compiles, type-checks, lints
  clean and is a **no-op**. It was written here and reverted. **Nothing in this sandbox could have
  caught it** (`getLocalStore` returns null on web), so it would have merged green as a fix.

- **Journal compaction sweep** — `main` was over the 60-file runaway limit, so Custom Rules was red
  on every open branch. 61 → 41 into `docs/overview/history-2026-08-18.md`.

- **Q-411 SHIPPED** (v1.325.5, PR #184) — every style draws on a square canvas. The renderer had been
  reserving the 130 × 137 box a round crop leaves, against 171 × 171: **64% of the area, spent on a
  constraint the owner does not have** (the round die is handled at the printer). `squareOnly` is
  gone as a concept. Every code grew and the default gained a fourth ingredient line.
  [Journal](../../overview/entries/2026-08-19-square-label-canvas.md).
  **Three things this cost, all worth carrying:**
  1. `codeUnits` is bounded by a style's **vertical clearance**, not by the area freed. The first
     draft used the second and drew `editorial`'s and `ticket`'s codes over their body text — and
     neither is in the E2E's decode list, so nothing failed.
  2. **`square` gained nothing and was raised anyway.** It already drew square. 70 → 90 took its
     ingredient list from three of eight to **one** — the Q-399 shape again, on the style that
     promises the breakdown. Capped at 76, the largest code that leaves three lines.
  3. **The assertion that caught (2) caught it by luck** — it required plural "N ingredients" and
     failed on "1 ingredient". Two would have shipped. It carries an explicit floor now. *Check what
     a passing regex would accept, not just that it passes.*

### Earlier runs

- **Q-478 SHIPPED** (v1.324.8, PR #154) — `isBodyMetadataFresh`/`isWorkoutDataToday` compared a
  **server-stamped** date to a bare `todayInTz()`, i.e. Brisbane, so both returned false for |Δ|
  hours a day — 14 in New York — on current data. Both take a `tz` now; all nine call sites pass one;
  `scripts/check-tz-aware-cache-guards.js` (Custom Rules) fails any call that does not.
  [Journal](../../overview/entries/2026-08-18-tz-aware-cache-guards.md).
  **Two corrections to the review, made in place:** session-select's loading state **does** clear (a
  second unconditional `setMetaLoading(false)` runs after the await, so the cost is a round-trip-long
  skeleton, not a hang — the review said "never clears"); and `unwrapToday`/`cachedFetchToday` were
  deliberately left alone, being client-written and client-read.
  **Q-477 is still open**, including its ratchet on bare `todayInTz()` across client code — this
  check guards two named helpers, not the general case.

- **Q-488 RE-TAGGED TO LANE A, not built** (PR #152) — and the reason is worth carrying. The entry
  said "one call in one Lane B handler". There is no such call: `lib/local-store` has **no**
  `deleteActivityLog` (every hit for that name is the *server* repository), and `upsertActivityLog`
  omits `deleted_at` from **both** its INSERT column list and its `ON CONFLICT DO UPDATE SET`. A
  read-merge upsert stamping `deletedAt: now` compiles, type-checks, lints clean, and is a **no-op** —
  `getActivityLogs` filters on a column the write never touches. It was written here and reverted.
  **Nothing in this sandbox could have caught it** (`getLocalStore` returns null in the web runtime),
  so it would have merged green as a fix. The backlog entry now carries the column evidence.
  The inverse offline-first rule it asked for **did** land, in `CLAUDE.md`'s Offline-First section.

- **Journal compaction sweep, third of the day** — 61 loose entries, 20 unlinked, into a new
  `docs/overview/history-2026-08-18.md`. `main` was already **over** the 60-file runaway limit, so
  Custom Rules was red on every open branch. The linked floor held at 41 rather than rising as the
  README's forecast said; the README now records that.

- **Q-393 SHIPPED** (v1.323.0, PR #94) — the per-serving ingredient breakdown, as a **square-only**
  style. A round 50 mm label has **7 units of slack once the default's content is on it — zero
  lines**, so the list needs the corners. Picker marks it SQUARE; the preview warns a round die crops
  it and reports how many ingredients actually printed.
  [Journal](../../overview/entries/2026-08-18-meal-label-ingredient-breakdown.md).
  **⚠️ Carries a correction every later session needs: all Q-389/Q-393 module-pitch figures were ~24%
  optimistic** — the quiet zone is drawn *inside* the code box, so the printed pitch divides by 33,
  not 25. The default is **0.369 mm**, not 0.487. The app always showed the honest number; the docs
  did not. **Do not quote the ÷25 figures again.**
  **Option 2 (round, trimmed) was deliberately NOT built** — 0.353 mm true pitch, below every shipped
  style, for three of five lines at 6.5 px. Owner decision, recommendation recorded against it.

- **Q-390 SHIPPED** (v1.322.2, PR #81) — the deload flag was a sibling of the day label, so it added
  a row and, in an `items-end` row, pushed that day's bar **12 px** off the shared baseline.
  [Journal](../../overview/entries/2026-08-18-training-load-day-flag-inline.md).
  Its spec took three CI rounds and the reasons are reusable: **future days are discarded** by
  `weekly-stats` (`isFuture ? [] : …`), and **`seed.sql` fills days relative to when it runs**, so a
  fresh CI database always has a session on the current week's Monday while an aged local one does
  not. **Reproduce CI's database locally** (`createdb`, `migrate.js`, `seed.sql`) rather than reading
  the job log — the log tail is filled by the Postgres container dump and never shows Playwright.
 PRs #49, #50, #56, #58, #60 and #68 all merged. Fourteen items closed:

- **Q-389 BUILT** (v1.320.0, PR #68) — printable saved-meal labels with a scannable code, four
  styles, and a scan-back that logs one serving. **Its queue entry is removed**; the two checks it
  still owes are both physical and are a `projectOverview.md` row.
  [Journal](../../overview/entries/2026-08-18-saved-meal-printable-label.md).
  Three things worth carrying: a `<canvas>` has **no implicit ARIA role** (an aria-label on it alone
  is not exposed at all, and a test cannot find it); `SheetContent` mounts into a **portal**, so a
  draw effect keyed on a plain `useRef` fires before the element exists and silently never runs —
  use a state-backed callback ref; and the payload budget is **26 bytes at v2/EC-M**, of which the
  meal id takes 22, so nothing else may ever go in the QR.

- **Q-389 planned** (PR #56, docs-only) —
  [plan](../../superpowers/plans/2026-08-17-saved-meal-printable-label.md). **Three trace findings
  changed the entry:** a 21×21 QR **cannot** hold a meal id (v1 holds 17 bytes; a UUID needs v2
  25×25, so the pitch is ~16% finer than recorded and the payload must be base64url of the 16 raw
  bytes with no prefix); the "log one serving" requirement is **already met** by
  `oneServingItems`/`logMealItems`; and that exposes the real bug — **`SavedMeal.totals` is the whole
  recipe**, so a naive renderer prints double what scanning the label logs. A parallel session then
  picked up the 25×25 correction, redrew the mockups and chose **black band** as the default of four
  cycleable styles; the plan is reconciled to that (PR #58).
  [Journal](../../overview/entries/2026-08-17-saved-meal-label-plan.md).

- **Q-51 corrected** (PR #58, docs-only) — its ✅ Task 3 reads as closing the entry and does not.
  Task 3 measured **home** cold start (FCP 472 ms, 439 of it the document fetch); the entry's callout
  is **first mount of `/workout`** (1086–1348 ms, `rscCount: 0`, entirely client-side), which nothing
  has measured. File sizes re-measured and both have **grown**: `workout-screen.tsx` 1,831,
  `session-select-content.tsx` 1,457.

- **Q-281 audit half** (v1.318.10, PR #50) — every surface rendering a pillar score enumerated:
  [`docs/reviews/2026-08-17-score-presentation-audit.md`](../../reviews/2026-08-17-score-presentation-audit.md).
  **9 of 14 render a score with no contributors and no trend**; exactly one has all three. Shipped the
  colour-only-state carve-out with it (the Home "accentring" band dot now carries its word), guarded
  by `e2e/score-band-not-colour-only.spec.ts`. **The UI half stays held** per the entry's own
  sequencing. [Journal](../../overview/entries/2026-08-17-score-presentation-audit.md).

- **Q-305's measurement gate** (PR #49, docs-only) — the entry blocked its own implementation on a
  4–8 week re-run. Done over 56 days, and it **inverts the finding**: the §3 table compared against
  the *raw* hypertrophy landmarks, but they are goal-scaled and the active program is
  `powerbuilding` (**×0.8**). Three muscles above MRV, calves at 47% of MEV, lats and upper back
  **in range** rather than below MEV.
  [Journal](../../overview/entries/2026-08-17-volume-landmarks-remeasured.md).

- **Q-350 + Q-355** (v1.318.7) — all eight radiogroups now share `lib/hooks/use-roving-radio-group.ts`
  for arrow keys and a roving tabindex (a **hook**, not the component the entry proposed), and the
  three goal groups no longer eject keyboard focus mid-save.
  [Journal](../../overview/entries/2026-08-17-radiogroup-keyboard-nav.md).

- **Q-457** — `lib/github-release.ts` defaulted `APK_RELEASE_REPO` to the archived private repo.
  Now defaults to the public one, guarded by a test on the URL actually requested.
  [Journal](../../overview/entries/2026-08-17-apk-release-repo-default.md).

- **Q-352** — the E2E harness now has a zero-data account (`e2e/zero-data.setup.ts`), and Q-451 and
  Q-452 are guarded by `e2e/first-run-empty-states.spec.ts`. Carries a **correction** to yesterday's
  Q-452 claim about the heart-rate fields.
  [Journal](../../overview/entries/2026-08-17-zero-data-e2e-fixture.md).

- **Q-309 REFUTED** — a real touch tap on Nutrition works; `.click()` sends a mouse sequence with no
  touch events. Spec now uses `touchscreen.tap()`. Residue is **Q-354**.
  [Journal](../../overview/entries/2026-08-17-nutrition-tap-refuted.md).

- **Q-452** (v1.318.6) — `AiInsightCard` now takes a required `hasData`. **Client half only — the
  prompt half is Q-353, Lane A's.**
  [Journal](../../overview/entries/2026-08-17-ai-insight-sufficiency-gate.md).
- **Q-451** (v1.318.3) — a new account's Workout tab was an empty card with a dead Start button.
  [Journal](../../overview/entries/2026-08-17-workout-select-empty-state.md).
- **Q-450** (v1.318.1) — `/activity` with no type recorded an activity and discarded it on Save.
  [Journal](../../overview/entries/2026-08-17-activity-untyped-entry.md).
- **Q-532** (v1.317.6) — `scrollIntoView` on a sentinel dragged the whole page.
  [Journal](../../overview/entries/2026-08-17-scroll-panel-page-jump.md).
- **Q-261** (v1.317.4) — six bare `<Label>`s fronting button groups.
  [Journal](../../overview/entries/2026-08-17-profile-group-labelling.md).

## Next
Work the queue top-down and take the highest Lane-B-owned item, re-verifying its premise against
`main` first. **The queue re-prioritises daily** — re-read it rather than trusting this list.

**As of 2026-08-19 the nutrition cluster is the top of the queue**, ordered by dependency rather than
Q number — *do not re-sort it numerically*. Q-399 and Q-402 are done. **Q-401** is the next Lane B
item and both of its stated prerequisites are now cleared: the label draws its list, and Home's
energy card reacts to invalidation, so swapping in the energy-zone bar no longer makes staleness
worse. **Build the new bar on `useCachedValue`**, not a fresh `useEffect(…, [])`.

After that the cluster turns hard: **Q-395** is a rework across six screens gated behind extracting
`food-row.tsx` (both landing files sit on the 800-line limit), **Q-398** wants that row component
first, and **Q-396 / Q-400 need a new APK** so they cannot complete in one web-deploy cycle.

**The 2026-08-17 walk below is still accurate for everything outside the cluster.**

**Buildable — take this first:**

1. **Q-51's residual** — but **measure `/workout` first mount before refactoring anything.** The
   split is real (1,831 and 1,457 lines, both grown) and Task 1 proved extraction moves **zero**
   bytes, so the honest case is readability, not perf. It is a large refactor of the core workout
   flow with no component-test route and device-only verification: scope it deliberately rather than
   starting it at the end of a session.

**Not startable:**

2. **Q-531** — ⛔ blocked on an owner decision, see below.
3. **Q-281's UI half** — deliberately held by the entry: it is presentation over numbers that
   Q-500/Q-272/Q-275/Q-277 are about to change, so building it now means building it twice. When it
   is unheld, the audit's recommendation is **trend, not contributors** — only 1 of 14 surfaces shows
   a trend, and contributors are genuinely inapplicable to a chip or a timeline row.
4. **Q-305's surface half** — needs the cross-item design decision the entry raises (one shared
   treatment across Q-278 / Q-302 / Q-305, or a third bespoke card) and therefore a planning PR
   first, per the backlog protocol.
5. **Q-278** — cross-lane: its scope item 1 (generalise `ScoreAvailability`) is `lib/health/`, Lane
   A's. Only the surface sweep is Lane B's, and it depends on item 1. **Read Q-281's audit before
   planning it** — two of its premises are refuted there.

**Q-354 is diagnosed and deliberately parked** (not deleted): the date-swipe `useDrag` binding
swallows mouse clicks on Nutrition — proven by removing it and watching every mouse path start
working — while touch is unaffected. `pointer: { mouse: false }` does not fix it. No supported user
produces mouse input, so a gesture rewrite is not justified.

Everything else in the queue is Lane A's (Kotlin/BLE, sleep-window data, DB sizing, migrations,
scoring, prompts) or was routed there by this lane: **Q-351** (activity `durationMin` 0 → 400),
**Q-353** (the health-insight prompt's "no data") and **Q-356** (the daily CI failure below).

## ⚠️ Blocking everyone, not just this lane
- **Q-356 is FIXED** (Lane A) — the backlog now carries `✅ Q-394 — RESOLVED: anchor-source.test.ts
  was red on main, fixed by Q-356's fixture change`. Left below because the *shape* recurs and
  CLAUDE.md's Date Arithmetic section now names it. Original report:
- **Q-356** — `lib/data/postgres/__tests__/periodization-soft-delete.test.ts` fails **14:00–16:00 UTC
  every day, on any branch**: it inserts a session at `now() - 1 hour` (UTC) and queries a
  Brisbane-local day window, so just after Brisbane midnight the fixture lands on the previous local
  day and all five assertions see zero sets. Reproduced against a fresh seed; measured at 14:35 UTC.
  **Lane A's file.** Until it lands, no PR can merge in that window — the required Tests check is
  genuinely red, and merging past it is not an option.

## Blocked
- **Q-531** `[app-shell][devices]` — needs an owner decision, annotated in the backlog. It asks for
  the premise of a shipped IA decision (Q-234) to be re-litigated; do not pick the new structure
  yourself, since the entry's own point is that Q-234 reasoned taxonomically and was wrong in use.

## Owed
- **A test print of the meal label, black band first** (Q-389) — the code is 0.49–0.66 mm per
  module and ink spread is the expected failure; it presents as "the scanner is broken".
- **The meal-label camera scan on device** (Q-389) — the Capacitor plugin is inert in the sandbox, so
  that path has never executed. Same for the Web Share hand-off and the two new fonts.
- **A TalkBack pass on the S25** (Q-261, Q-350) over More → Goals and More → Edit Profile.
- **A look at Home with the "Accent ring" style selected on the S25** (Q-281) — the new band word is
  **7.5 px**, verified only in a browser harness at 412×915.
- **A drain run on the S25** (Q-532) confirming `/admin/oura-ble` holds still while the log streams.
- **Q-450's device path** — the E2E run took the web fallback, not SQLite+outbox.

## Q numbers used from the band
- **Q-357** — FILED, not built. Four memoised call sites still defeated; `SavedMealCard` is inside a
  `.map` so its fix is a callback-contract change, not a `useCallback`. Baselined, so nothing new
  can join them.
- **Q-358** — DONE (v1.325.5), built inside Q-411 rather than taken in its own turn. Q-411 resized
  every code, every module width changed with it, and the decode flake the 600 dpi bump was thought
  to have fixed came straight back — `plaque` at 14.94 device px/module one run, `square` at 17.02
  the next. **That is the lesson worth keeping: the 600 dpi bump was margin, and margin expires the
  moment a size changes.** `drawCode` paints in device space on a whole-pixel cell now, and the
  `+0.04` seam patch is gone with it. The feared shrink was under 0.2% (561 px against 561.6 for
  `square`), so the reported millimetre figures still derive from `codeUnits`.
- **Q-359** — FILED, not built. The other 36 fetch-once effects. **Latent, not broken** — they
  unmount. Some are deliberately fetch-once and must NOT be converted. Suggests a shrink-only
  ratchet over a sweep.
- **Q-350** — DONE (v1.318.7).
- **Q-355** — DONE (v1.318.7), fixed alongside Q-350 rather than left half-shipped.
- **Q-352** — DONE. Zero-data E2E account + first-run guards.
- **Q-351** — **Lane A's to fix.** A sub-3-second activity rounds `durationMin` to 0 and
  `ActivityLogBody.durationMin` is `.positive()`, so the POST 400s and the activity is lost behind a
  generic toast. Measured (2 s → 400, 5 s → 201). The outbox parses the same schema.
- **Q-353** — **Lane A's to fix.** The health-insight prompt substitutes the literal `"no data"` for
  absent fields and the model reads it as a measured zero.
- **Q-354** — a mouse click on Nutrition's action row reaches the element and the handler does not
  run, this screen only. Touch works. Low priority on a touch-only target.
- **Q-356** — filed for **Lane A**: the daily 14:00–16:00 UTC CI failure above.

## Claimed paths
- **`packages/shared/src/nutrition/label-payload.ts`** — **this is Lane A's directory** and was
  touched anyway for Q-389, deliberately: it is a NEW file, it sits beside `oneServingItems` which it
  uses (One Formula One Place), Lane A's baton showed *None held* and Lane A was working Oura/DB
  paths at the time. A new file collides with nothing, which is what the contract is protecting. Said
  plainly here rather than left to be discovered. Release the claim when convenient.
- **`lib/github-release.ts`** + `lib/__tests__/github-release.test.ts` — neither lane lists them;
  taken for Q-457 with Lane A's baton showing no claims. Release the claim when convenient.
- **`scripts/check-doc-index-size.js`** — not a lane path, but every Lane B PR touches its baseline.
  Both lanes raise it on the same days; **recompute from the merged file, never splice the hunk.**
  (Hit again on 2026-08-18: main's numbers moved under an in-flight PR and the conflict was inside
  the baseline block. Recomputing from the merged files is a ten-second fix; splicing is not.)
- **`lib/sqlite/cache.ts`** — **this is Lane A's directory** and was touched for Q-478, as that
  entry explicitly instructed. Additive only: an optional `tz` on two exported guards, no call-site
  contract broken. Lane A's baton read *None held* and its queue was entirely Oura/DB work.
  Release the claim when convenient.
- **`scripts/check-component-size.js`** — not a lane path; its `health-content.tsx` baseline was
  raised by one for Q-478.
- **`.github/workflows/ci.yml`** — not a lane path; three Custom Rules steps added this run
  (`check-tz-aware-cache-guards.js`, `check-memo-prop-stability.js`, and Q-399's assertions ride in
  an existing test file). Release the claim when convenient.

Otherwise the lane list in [`docs/agents/README.md`](../README.md) §3.

## Do not re-litigate
- The lane contract, authority limits and entry-ID prefixes are settled in
  [`docs/agents/README.md`](../README.md).
- **`FactorBar` is NOT a colour-only-state violation to fix.** It matches the rule literally (band
  colour on bar and value, no band word) and was inspected and **declined** in the Q-281 audit: the
  sub-score is already rendered as text beside the bar, so the state is in a non-colour channel, and
  a band word on each of 5–7 rows would crowd the densest surface in the app. If it is ever changed,
  the reason is crowding or clarity — not this rule.
- **Absent scores are already handled correctly everywhere.** Measured across all 14 surfaces:
  `—` on Home/day-detail, `—` with the band label *suppressed* on the detail hero, element hidden
  elsewhere. **No surface renders a null as 0 and none carries a value forward.** Q-278 says
  otherwise; Q-278 is wrong about this and the entry now says so.
- **Q-451's `programLoaded` is never set in a `finally`.** A failed first load with no cache holds
  the skeleton instead of claiming the account has no program.
- **The inert Start button was removed, not disabled.** A disabled primary CTA still asserts "this is
  the thing to do here", which is false when the prerequisite is elsewhere.
- **Home's `recommendation-card.tsx:281` is NOT the Q-451 bug** — same `x && f(x)` shape, but inside
  a `displaySession ?` branch, so it is redundant defence. Swept and cleared; don't re-file it.
- **Q-450's guard belongs at the destination, not the call sites** — a cold open reaches `/activity`
  with no call site at all.
- **`radiogroup` beat `group` + `aria-pressed`** for pick-one option sets (8 sites vs 1).
- **Q-309 is refuted as a *user-facing* bug** — touch taps work, measured many times. But the
  `useDrag` binding **is** what swallows *mouse* clicks (Q-354), proven by removing it.
- **`coach-content.tsx`'s `scrollIntoView` is correct** — no inner scroll container, so the page is
  genuinely its scroller.
- **Q-452 gates in the client, not the route** — a client gate costs no request at all.
- **The heart-rate `hasData` gate uses the trend series** because that mirrors what the *prompt*
  reads (`body_metrics`). **Not** because `data.hrMin`/`recentHrv` are broken — an earlier note here
  claimed they were live-ring-only and null, and that was wrong (`recentHrv` is 65 for the seeded
  user). Corrected 2026-08-17.

## Gotchas worth carrying
- **`scripts/check-doc-index-size.js` is a shrink-only baseline** on `projectOverview.md`,
  `docs/implementation-backlog.md` and `CLAUDE.md`, and it *will* fail your PR. Trim into the journal
  or a review doc first — those it does not govern. Q-281's first draft was 20 over and the ratchet
  was right: everything but the owed device check belonged in the review doc.
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`.
- **A localStorage-preference-dependent screen is testable** — `page.addInitScript(() => localStorage.setItem(...))`
  before `goto`. Q-281's guard does this rather than driving the settings UI, so an unrelated screen
  cannot break it. `ta_score_ring_style` is the key for the Home score-ring style.
- **Every committed spec runs as one seeded user who has a program, logs and metrics**, except those
  that `test.use({ storageState: ZERO_DATA_STORAGE_STATE })` (Q-352's account).
- **Write E2E specs for real flows — they find things reading cannot.** The Q-450 spec failed on its
  first run for an unrelated reason, which is how Q-351 was found.
- **`.click()` does not always activate a button in the mobile context** — see Q-309 and the note in
  `e2e/water-log-write-path.spec.ts`. First suspect when a click silently does nothing.
- **There is no component-test infrastructure** — both vitest projects are `environment: 'node'` and
  `@testing-library/react` is absent. E2E is the only automated route to UI behaviour.
- **Mutation-check every guard you add** — revert the fix, watch the spec go red (Q-259's lesson).
  Q-452's first guard **passed** under mutation and had to be rewritten to assert on the *request*.
  Asserting "the thing is absent" is not a guard when it is absent either way.
- **A long-lived local DB ages out of its seeded window.** `seed.sql` fills 14 days ending at the
  *user's* Brisbane today, and `setup.sh` will not re-seed a non-empty `users` table — so once the
  session crosses Brisbane midnight (14:00 UTC), `e2e/goal-invalidation.spec.ts` fails locally while
  CI (fresh seed every run) stays green. Not a regression. Top up today's `body_metrics` row.
- **A fixed short wait is not a measurement on a cold dev server.** A 6 s probe read a not-yet-loaded
  `/api/readiness-score` as "no data" and produced a wrong, confidently-stated finding. Use `toPass`
  with a real budget; `goal-round-trip` records 39.7 s cold.
- **The remote branch ref goes stale after every squash-merge**, and push is rejected as "behind".
  Force-push is not permitted here — `git fetch origin <branch> && git merge FETCH_HEAD` is a content
  no-op that clears it. Verify with `git diff HEAD origin/main --stat` before pushing.
- **`pnpm check:rules` ran 45 of 45 on 2026-08-19** (38 on 08-17; 43, then 44, then 45 across
  08-18/19). Quote the count, never "pass" — it moved three times in one run.
- **A flaky E2E decode is a resolution finding, not a retry.** Q-399's QR decode passed, then failed,
  then passed at identical geometry. The cause was 4.7 device pixels per module with antialiased
  edges. If an image-decoding assertion goes intermittent, measure pixels-per-feature before
  re-running it.
- **The E2E fixture cannot reach Home's card widgets.** `DEFAULT_CARD_WIDGETS` is `[]` and the
  seeded user has no body measurements, so no Home card renders and no card's endpoint is ever
  requested. Setting `ta_ss_cards` via `addInitScript` was not sufficient on its own. Budget for
  building that fixture before promising a Home-card guard.
- **The 800-line component ratchet will block a two-line addition to a hotspot**, and the sanctioned
  way through is in the script's own header: reclaim what you can, then raise the baseline with the
  reason in the same PR. Merging duplicate imports from the same module is the cheapest honest
  reclaim — `nutrition-content.tsx` funded both its new lines that way and stayed at exactly 800.
- **`get_check_runs` lags.** On 2026-08-18 it read three of six checks `in_progress` for ~10 minutes
  after they had finished; `merge_pull_request` succeeded immediately. Try the merge rather than
  polling — branch protection refuses a genuinely pending check.
