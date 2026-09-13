# Session journal — batch folded 2026-09-12

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-07-transition-clock-semantics"></a>

# 2026-09-07 — the transition contradiction was my own double-count (LA-65)

**Branch:** `fix/transition-constant-measurement` · **Lane A**

## What LA-65 was filed on, and why it was wrong

Filed this morning off the BF-128 pass, LA-65 recorded that `TRANSITION_SEC_BARBELL = 240` measured
"contradictorily" — 249 s counting unstamped rows as zero, 316 s where actually recorded, and an
implied **+20.8 min over-prediction** of the working window when the recorded value was fed into the
model. The entry concluded the field's meaning was unsettled and the constant could not be retuned
until it was.

**The contradiction was an error in my own measurement.** I had summed
`inter_exercise_rest_sec + prep_time_sec` as "the transition". They are not additive.

## The measurement, against an independent clock

`set_start_ms` / `set_end_ms` are stamped per set and are not derived from either field, so the gap
between one exercise's last set end and the next's first set start is an independent measure of the
transition. Across **171 transitions**:

| compared against the implied gap | median error |
|---|---|
| `inter_exercise_rest_sec` alone | **−0.05 s** |
| `inter + prep` | **+135.7 s** |

Split by whether prep was recorded at all, `inter` alone matches in both buckets (mean 229.8 vs
implied 229.8; mean 402.0 vs implied 402.0).

**And it holds by construction, not just by correlation.** `components/workout-screen.tsx` computes
`interExerciseRestSec` as `exerciseStartMs − lastExerciseEndMs`, and `exerciseStartMs` is stamped
inside `handleStart` — the same function that computes `prepSecRef` from the ready-screen baseline.
So prep is the *tail* of the same interval that `inter` measures end-to-end.

With the corrected definition the session reconciles:

| | before (inter + prep) | after (inter alone) |
|---|---|---|
| work + rest + transition | 58.1 min | **50.0 min** |
| measured working window | 47.9 min | 47.9 min |
| excess | **+10.2 min** | **+2.1 min** |

## The live defect this found

`/api/workout-sessions/[id]/timing` reported `setupActualSec` from **`prepTimeSec`** and compared it
against **`transitionSecForEquipment`**, which models the whole transition — a part against a whole.
Median prep on a non-first exercise is **2 s** against a 240 s expectation, so the screen reported
setup as four minutes *faster* than expected while the real transition ran ~300 s, i.e. **slower**.
Now reads `interExerciseRestSec ?? prepTimeSec` — the fallback covers the first exercise of a
session, which has no preceding gap and whose prep (mean 286 s, the ramp from the ready screen) is
the right actual there.

`time-audit.ts` was checked for the same defect and is correct: it uses `interExerciseRestSec` alone
at all three sites and never adds prep.

## The finding worth more than the fix

The real transition is **~300 s per gap** (mean 316, median 299) against a 240 s constant — but **the
constant is charged per exercise, and a session has one fewer gap than exercises.** At the owner's
five: 5 × 240 = 1200 s, and 4 gaps × 300 = 1200 s, against a measured 19.8 min (1188 s) of real
transition per session. **The two errors cancel exactly at N = 5, and only there.** At N = 3 the
model over-reserves ~120 s; at N = 8 it under-reserves ~180 s.

**Nothing was retuned, and that is a decision rather than an omission.** Raising the constant to the
measured 300 s takes the powerbuilding 60-min blend from 598 s to 634 s and `floor(3060 / 634)` back
to **4** — undoing the 4→5 that shipped this morning to fix the owner's own report. The
correct fix is to solve for N against `N × work + (N − 1) × transition ≤ budget` rather than dividing
by a per-exercise average, and that changes volume at every budget except the one he trains at.
LA-65 is rewritten with the arithmetic and gated on the owner, whose BF-128 Known-Issues row already
asks whether five exercises fits the hour in practice. If it does, this is a cleanup to schedule; if
it does not, both are one fix and should be made together.

## Verification

- Mutation-tested three ways: revert to `prep`; sum the two; prefer `prep` over `inter`. All three
  fail the suite. The test exercises the real `GET` handler rather than a copy of its logic.
- Full suite **6693 passed | 86 skipped**; `tsc` clean; test-typecheck at baseline; Custom Rules
  **68 of 68**.

**Not exercised:** the timing screen on the S25, and no `pnpm dev` call — the route needs a completed
session with stamped set timestamps, which the seeded dev user does not have. The change is one
expression on a read-only route, covered by handler-level tests against both the present and absent
cases.

<a id="2026-09-08-feat-bf-133-measured-overview"></a>

## 2026-09-08 — What the app has measured, under what it was told (BF-133)

**Branch:** `feat/bf-133-user-overview` · **Lane B** · PR #1009

### What shipped

A read-only section on **More → Profile details**: the latest reading of every body metric the app
holds, grouped by what a number is *for* — body composition, vitals, metabolism, daily movement —
plus a sleep block averaged over the window.

Two properties decide whether a dense read-only card is useful or misleading, and both are enforced
in the logic rather than left to the data:

- **Every reading carries the date it was taken.** A scale session from three weeks ago sits beside
  today's step count, and without an "as of" they read as equally current.
- **A metric with no reading is omitted, never blank.** `body_metrics` has six tape-measure columns
  nothing has ever written; rendering every column would have shipped a screen of permanent dashes
  and taught the reader to skip it. Verified in the e2e by asserting all six are absent.

### The BF-118 decision, which is not the one the entry proposed

BF-133 opens with **⚠ FIRST: decide against BF-118**, because both describe a screen called "user
information", and recommends building this as a section of BF-118's screen.

**That screen does not exist.** BF-118 is a large unbuilt entry. What does exist is `/more/details`
("Profile details", BF-79) — name, biological sex, birth year, height, editable, one PATCH — which is
precisely BF-118's *"what you TELL the app"* half, already built under a different name. So the
recommendation stands and the target moved: told above, measured below, one page about you. When
BF-118 is built it should fold into `/more/details` rather than open a second destination.

### The read is local-first because the server window is too short

`/api/body-metadata` returns **seven days**. This card is about the *latest* reading of each metric,
and a composition figure or a scale session is routinely older than a week — so read from the server
alone, most of these show as absent when they exist. `store.getBodyMetrics(cutoff)` returns the full
local history, and `body_metrics` is a domain the app writes locally, so CLAUDE.md's offline-first
rule already required reading it locally. The seven-day payload stays as the web fallback, where
`getLocalStore` returns null.

### The three traps the entry named, and what each became

1. **Stride length is not measured** — `treadmill-utils.ts` computes `(heightCm / 100) × 0.415`, a
   population constant applied to height. Verified in source. It is **not on the card**: presenting an
   anthropometric assumption as a recorded measurement is the thing the entry warned against.
2. **"low / avg / high HR" is three things from three stores.** Every heart-rate row here names its
   window — *Resting heart rate* (daily) and *Lowest heart rate overnight* (from sleep) — so nothing
   silently merges a sleeping rate with a working one.
3. **Two RMR numbers that disagree by construction.** The scale's is labelled *"estimated by the
   scale"* and points at More → DEXA & RMR results, where the lab-measured one lives.

### Averaging bedtimes needed a circular mean

A plain average of clock times is wrong in the direction that matters: bedtimes straddle midnight, so
23:50 and 00:10 average arithmetically to **12:00** — the middle of the next day, and a number that
looks like a real bedtime. `circularMeanMinutes` averages the unit vectors instead and returns 00:00,
and returns **null** rather than picking a side when the directions cancel (times 12 hours apart have
no mean). The minutes-of-day are computed in the *user's* zone before the circle, not the device's.

### Verification

18 unit tests over the logic — latest-reading selection out of order, absent columns, non-finite
values, group dropping, and the circular mean including its midnight case and its ambiguous case.
`e2e/measured-overview.spec.ts` drives the real screen at 412 dp: the section renders, all six tape
measurements are absent, and **every rendered reading matches `YYYY-MM-DD`**.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green.

The rules gate caught one real defect: the year cutoff was built with `toISOString().slice()`, which
is UTC and wrong before 10am AEST. It derives from `todayInTz(tz)` now.

**Not exercised:** the S25 and Samsung WebView. This is a long dense list on a phone and the entry
asks for a scanning look — group headers, aligned numbers, the fold not landing mid-group — so the
device check is a real one, not a formality.

### What is deliberately not built

The training and performance sections: `personal_records`, `fitness_tests`, `dexa_scans` and
`measured_rmr` in this view. The clinical two are reachable today at More → DEXA & RMR results, and
the scale's resting-rate row now points there — so what is missing is the single dense view, not the
numbers. Recorded on BF-133 as its `Keep:`.

Minor bump — a new feature.

<a id="2026-09-08-feat-or-102b-reta-tracker"></a>

## 2026-09-08 — The vial and the dose calculator (OR-102b ①②)

**Branch:** `feat/or-102b-reta-tracker` · **Lane B** · PR #1007

### What shipped

A syringe control on any milligram-dosed supplement row opens a sheet holding both halves the owner
asked for: **the vial** (peptide mg, bac water mL, marks per mL) and **the dose** (mg in, units out).

Both show their working rather than only the answer — `10 mg ÷ 3 mL = 3.33 mg/mL`, then
`0.5 mg ÷ 3.33 mg/mL = 0.15 mL → 15 units`. A concentration cannot be checked from its result, and
these are the figures OR-102b verified against the owner's own third-party calculator. Also free from
the same numbers: how many doses of that size the vial holds, and a warning when one needs more than
the barrel can draw.

**The mg↔units arithmetic is not new here.** `@trainingai/shared/health/vial-dose` shipped with the
storage in OR-102a; this adds only the two questions it does not answer, and imports the rest.

### Two things the entry got wrong about its own code, found by looking

**"No data, no migration" was true of storage and not of the client.** OR-102a shipped the table, the
repository methods and the API routes, and no read path to the browser — no cache group, no
local-store getter. That nearly made this Lane A's. It resolved because `invalidateCache` deletes on
a **prefix** (`WHERE key LIKE 'prefix%'`) and the existing `invalidateSupplements()` clears the bare
prefix `supplements`, so a key named `supplements-vials:<id>` is already evicted by every supplement
write with no new group. That is written into the file, because renaming the key silently removes it.

**"A toast with Undo is the established pattern" was the same shape of claim in BF-132, and also
wrong.** Worth stating once: an entry's description of the code is a lead, not a fact.

### What is deliberately not built, and why each

**③ the dose on the day timeline** — its *write* already ships: the tick stamps `taken_at`
(`adapter.ts:6557`). What is missing is an event type in `app/api/day-timeline/route.ts`, which is an
`app/api/**` path this lane may not touch.

**④ the weight-response chip — blocked on the formula, not on data.** The series is reachable from
here: `store.getBodyMetrics(cutoff)` returns every local row with `weightKg`, which is the local-first
read this should use anyway. The estimator was written and tested — trailing 7-day means, a standard
error, the verdict withheld unless the whole 95% interval clears the band — and then **removed from
this PR**, because shipping it would have made a third kg/week estimator sitting beside two that
disagree. Its design is on OR-102b so it is not re-derived.

### The finding that came out of that: LB-67

`computeWeightRateKgPerWeek` fits against the **array index** and multiplies by 7 as if readings were
daily. Rows exist only on days with a metric, and the owner weighs in about three days in four:

| readings in a 14-day window | reported | true | overstated |
|---|---|---|---|
| 14 of 14 | −0.70 kg/wk | −0.70 | 1.00× |
| **10 of 14** (the owner's rate) | **−1.04 kg/wk** | −0.70 | **1.48×** |
| 6 of 14 | −1.76 kg/wk | −0.70 | 2.51× |

It is live, and it changes the sentence rather than the digits: past 1.0 kg/wk,
`evaluateWeightRateVsGoalBand` renders **"Faster than ideal pace"** on Health → Body for an ordinary
−0.70. **The fix already exists one directory away** — `adaptive-tdee.ts` fits against the day index
and its comment describes this exact failure — so the app carries two weekly-rate figures that
disagree by about 1.5×, on two screens. Lane A's, filed as LB-67.

### And LB-68, which cost two sessions before it was written down

`page.click()` and `touchscreen.tap()` do not reach the Nutrition day-tools buttons: no sheet through
**~18 retried taps over 90 s**, button focused, no page or console error. `el.click()` opens it in
50 ms. So the app is fine and Playwright's synthetic event is not arriving.

A session earlier the same day saw this on `End of Day`, found the same `el.click()` asymmetry, and
attributed it to a hand-rolled Playwright context. **It reproduces in the project's own harness**, so
that was wrong and the finding was dropped instead of filed. It is filed now, with the negative
results — `serviceWorkers: 'block'` and `storageState` both ruled out by direct comparison, and
`My Foods` on the same screen opening normally under synthetic input.

### Verification

`e2e/vial-dose-calculator.spec.ts` drives the real screen at 412 dp: create a milligram supplement,
the syringe control appears on its row, the sheet opens, both divisions render, 15 units renders, and
a 4 mg dose says it will not fit a 100-unit barrel. 12 unit tests pin the arithmetic and its refusals
— a vial with no water returns null rather than Infinity, a zero dose has no dose count.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green
· the new e2e green.

**Not exercised:** the S25, Samsung WebView, and — because the spec clicks through the DOM per LB-68
— **whether the syringe control is reachable by a finger**. That hit test is owed on the device, and
it is the one thing this spec deliberately cannot prove.

Minor bump — a new feature.

<a id="2026-09-08-feat-q278-availability-surfaces"></a>

## 2026-09-08 — The em dash gains a reason (Q-278, surface half)

**Branch:** `feat/q278-availability-surfaces` · **Lane B**

### What shipped

A score that could not be computed rendered `—`, which read the same whether nothing was recorded or
the personal baseline is simply too cold to judge what was. The engine half (Lane A, 2026-09-03) made
those distinguishable and put `availability` on `/api/readiness-score`; nothing consumed it. Now:

- **`components/health/score-gap-copy.ts`** — `scoreGapText(availability, metric)`, a pure function
  so the copy decision is testable in `node`. Two sentences, and the difference is the point:
  **"Nothing recorded for today"** (recording something fixes it) versus **"Not enough history to
  score this yet"** (only waiting does).
- **`health-score-detail.tsx`** renders it as a chip under the hero, on all three score screens —
  keyed on `aiSection`, which already carried exactly the three metric names the route reports, so
  no new prop for a value the component was holding. Under the hero rather than inside the ring: a
  128 px circle already holds a number, a band word and a label.
- **`oura-score-chip-row.tsx`** carries it in the **accessible name only**. Those cells are 92–96 px
  circles with no room for a sentence; a sighted user taps through to the screen that now explains,
  and a screen-reader user otherwise heard "Readiness: —" and nothing else. It slots into the
  existing `ariaLabelFor`/`qualifierPhrase` mechanism rather than inventing one.

Deliberately silent about a *degraded* score — one computed from an incomplete picture already has a
treatment via `limited` in `readiness-breakdown.tsx`, and a second sentence saying the same thing in
different words beside the number would be worse than none.

### Q-278 is not finished, and its lane flips back

The `Keep:` it carried is discharged, so it is rewritten to the half that remains: the route emits
`availability` for **readiness, sleep and activity only**, while **daytime stress (55%) and
resilience (33%)** — the two lowest-coverage pillars in the entry's own measured table — still render
dashes nothing can explain. `metricAvailability` is keyed on the metric name precisely so a sixth
costs nothing; what is missing is the route adding them. Lane flips **B → A**, having gone A → B when
the engine shipped — the lane follows the open path.

Sleep and activity will never say `awaiting_baseline` (they have no contributor breakdown, so they
report present/absent only). That is honest, and the entry now says so, because "fix" it by inventing
contributors for them is the obvious wrong move.

### Two guards this broke, both caught before pushing

**`sleep-provisional-surfaces.test.ts` pins `href: "/health/sleep"` and `provisional:
sleepProvisional` inside one 120-character window**, deliberately — asserting the prop and the field
separately would pass against a cell that reads the flag and never uses it. My `gapReason` line went
between them and pushed them apart. Fixed by moving the line **after** `provisional` rather than
widening the window: the guard's tightness is the thing that makes it work, and loosening a check
because your own line got in its way is how a guard stops guarding.

The full suite is what caught it. It was run because the previous PR in this session claimed a green
suite it had not run and CI found a real regression — the same lesson, one PR later, and this time
before the push.

### Verification

- **5 unit tests**, three driven through the real `metricAvailability` rather than hand-built
  literals — including the mixed-gap case, where a metric with one cold input and one absent one must
  resolve to `no_input`, because waiting cannot fix the half that has no data.
- **2 e2e cases** (`e2e/score-gap-reason.spec.ts`) driving the real readiness screen with the
  response intercepted — built from the genuine response via `route.fetch()` so every other field
  stays honest, with only the score and its availability replaced. Whether the seeded user happens to
  have a score today is a fact about fixtures; this is not.
- **Mutation-checked**: collapsing the two sentences into one — the exact regression Q-278 exists to
  prevent — fails 1 e2e case and 3 of the 5 unit tests.
- `pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · `pnpm build` exit 0 ·
  unit suite **802 files, 6,914 tests passed**.

This also discharges the engine half's stated **NOT verified** item: it recorded that an
authenticated `/api/readiness-score` response had never been exercised because the sandbox could not
mint a session. The e2e cases fetch the real route as the signed-in seeded user.

**Not exercised:** the APK. WebView surfaces carried by a Railway deploy with no rebuild. The chip
row's accessible name was not read with TalkBack on the S25 — the guard proves the string is in the
name, not that it reads well aloud.

Patch bump — user-visible copy.

<a id="2026-09-08-fix-bf-132-confirm-session-delete"></a>

## 2026-09-08 — Deleting a session asks first, and can be undone (BF-132)

**Branch:** `fix/bf-132-confirm-session-delete` · **Lane B** · PR #1004

### The report

The owner lost a session: *"it looked like you can delete the day in the builder with no confirmation
needed so if you accidently press the trash jts gone. I will need to remake with my lower session
details"*. `removeSession` was a one-line array filter fired straight from the trash button, and the
file held zero `confirm(` calls. The blast radius is the session and its whole exercise list, and on
Save both are hard-deleted from `program_sessions` and `session_exercises`.

### What shipped

**A confirmation that names the count** — *"Delete Lower and its 5 exercises?"*. The count is the
part that carries the warning; a generic "Are you sure?" trains the reflex to dismiss it, which on a
delete this expensive is worse than no dialog. `ConfirmDialog` already existed, so this is wiring,
not a new component. Singular/plural and the not-yet-named session are covered by unit tests.

**An in-sheet undo bar**, above Add Session, holding the last deleted session until it is restored,
another is deleted, or the sheet closes.

**Exercise delete is deliberately untouched.** Removing and re-adding an exercise is ordinary
editing, and a dialog on every one of those is the friction that gets a confirmation deleted a month
later. The session-level delete is the one that is rare and expensive.

### The undo was a toast, and a browser is the only reason it isn't

The first implementation raised a sonner toast with an Undo action. It typechecked, linted, passed
the unit guard, and **was dead to touch** — which nothing short of a real browser could have said.

Sonner's toaster sits at `z-index: 999999999` against the sheet's `z-50`, so the toast *paints* above
it. But `SheetContent` is a Radix modal: its subtree intercepts pointer events, and everything
portalled outside it stops receiving them. Playwright's log names it exactly — *"subtree intercepts
pointer events"* — after which the toast expired and detached. So the control was visible, correct in
source, and unusable.

Moving it inside the sheet also lands on the pattern this app already uses: `plan-meal-row.tsx` has
an inline undo, not a toast. The entry's claim that *"a toast with Undo is the established pattern
elsewhere in the app"* is not right, and is worth not repeating.

### And the undo button then failed BF-123's own guard

The inline Undo went out as `tap-dense text-sm font-semibold text-brand` — `tap-dense` opts a control
out of the global 48 px floor, and nothing replaced the touch area. `carousel-dot-hit-area.test.ts`
caught it in the full suite. The fix is not a hit-area trick: the button dropped `tap-dense` and took
the floor, which is what an isolated inline control in a row should do anyway. Worth recording
because this is the *third* distinct guard this one change tripped, and each one was a real defect
rather than a checker being fussy.

### Extraction, because the file is a hotspot

`program-editor-sheet.tsx` was 963 lines against an 800-line limit, grandfathered shrink-only, so
+33 lines failed the ratchet. The session header — drag handle, icon picker, name field, delete —
came out to `components/config/session-header-row.tsx`. That is the block this change touches, so
the extraction is the one the diff argues for rather than the one that saves the most lines. **947
lines**, below the 963 it inherited.

### Verification

The e2e (`e2e/session-delete-confirm.spec.ts`) drives the real screen at 412 dp: tap the trash, the
dialog names the session, **Keep** leaves the count unchanged, **Delete** drops it by one, **Undo**
puts it back with its name intact. It adds its own session and never presses Save, so the seeded
program is left as found.

Both source guards were mutation-checked — reverting the trash button to call `removeSession`
directly turns them red, in each of the two files the control now spans.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite **836
files passed, 0 failed** · the new e2e green, re-run after the touch-target fix changed the markup.

**Not exercised:** the S25 itself and Samsung WebView. Nothing here is native, offline-first or
safe-area, and the interaction is proven in a browser at the target viewport, so the residual risk is
rendering only.

### What is deliberately not done

BF-132's third fix — a `deleted_at` on `program_sessions` and `session_exercises` — is **LB-66**,
filed in this PR. It is a migration and therefore Lane A's. Until it lands, a *saved* delete is still
unrecoverable: this change makes the mis-tap unlikely and the wrong confirm recoverable, and stops
there.

Patch bump — user-visible.

<a id="2026-09-08-fix-lb-61-switch-brand-on"></a>

## 2026-09-08 — An on switch is brand-coloured, not near-white (LB-61)

**Branch:** `fix/lb-61-switch-brand-on` · **Lane B**

### What shipped

Two tokens in `components/ui/switch.tsx`. The on state is `--brand`; the thumb is
`--brand-foreground`.

In dark — the only theme this app ships — `--primary` is `oklch(0.922 0 0)`: near-white with **zero
chroma**, the shadcn light-first default. That is the same value that made BF-124's selected role
pill read as switched off, and it made every on switch read as an inert slab rather than a chosen
state. `--brand` is overridden at runtime by the owner's own colour, so the switches follow it
instead of being a greyscale island, and `--brand-foreground` exists precisely to stay legible on a
`--brand` fill.

### The decision, and how it was taken

LB-61 asked for a count before anyone proposed anything. That was done first (#952): **25 switches
across 14 files**, split roughly 15 persisted preferences to 10 in-form choices — a real split that
**does not decide anything**, because nobody classifies a toggle before looking at it. Two on-colours
would be a distinction the user has to learn in order not to be confused by it.

The recommendation and the argument against it both went to the owner, who chose the recommendation.
The argument against is not discarded: five brand-green pills in the `settings-panel.tsx` column may
read as loud, and green in this app already means *good / achieved* rather than *enabled*. That is
what the device check is for, and the fallback (brand for in-form, neutral for settings) is recorded
on the entry rather than left to be re-derived.

### Verification, and what it is not

**Not rendered-verified locally, and the reason is worth carrying.** No switch is reachable on this
seed: the Goals AI sheet needs `GOOGLE_GENERATIVE_AI_API_KEY`, which the sandbox lacks, and the
`more/settings-panel.tsx` collapsible produced no `[data-slot="switch"]` in 24 seconds of polling
after its row was expanded. Four scripted attempts went into it before that was accepted rather than
worked around.

What *was* verified is the thing a token swap can actually get wrong — that the tokens resolve. From
the compiled CSS after `pnpm build`:

- `.bg-brand{background-color:var(--color-brand)}`
- the dark `[data-state=checked]` thumb rule resolving to `--brand-foreground: oklch(100% 0 0)` —
  pure white, which is the standard legible pairing on a mid-dark green track.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · `pnpm build` exit 0 ·
full unit suite green.

**LB-61 stays in the queue as `Verify: device`** rather than being removed — 25 controls changed
appearance at once and nobody has looked at one. That is a look owed, not work owed, which is exactly
what that field is for.

Patch bump — user-visible.

<a id="2026-09-08-fix-or-102b-reta-tracker-misfiled"></a>

# 2026-09-08 — the reta tracker was filed as shipped and never built (OR-105)

**Branch:** `fix/or-102b-reta-tracker-misfiled` · queue fields only · no product code.

## What happened

The owner asked how the reta tracking was going. The engine half (OR-102a) had shipped —
`supplement_vials`, and `taken_at` / `vial_strength_mg` / `vial_water_ml` / `vial_units_per_ml` on
`supplement_logs`. The surface half, **OR-102b**, had not: `grep -rl vial components/ app/
--include=*.tsx` returns nothing at all. Four parts unwritten — vial setup, dose calculator, dose
timeline, weight-response chip.

It was invisible because the entry carried `- **Verify:** device`, written as *how this should be
checked once built*. `next-item.js` reads `Verify:` as **shipped**, so it printed the entry under
*"VERIFY — shipped; a look is owed, nothing is blocked"* and kept it out of READY. Lane B's READY
list held **two** items for two days while the thing the owner had asked for by name sat in the
shipped pile.

**OR-104 carried both mistakes.** The same premature `Verify:`, plus a `Gate: owner` for the owner's
hand-edit of the live `Retatrutide` row — parking the code fix that the entry's own next line said
"should not wait for it".

## Why the field rule needed a new paragraph

`Gate: device` meaning *shipped, not "will need a check when built"* was already documented, with
three prior outbreaks. This is that trap in the newer field, and it is worse rather than equivalent:
a premature gate parks an entry, and PARKED prints a reason that invites the question. A premature
`Verify:` prints **"nothing is blocked"** — so neither the implementer nor the owner has any reason
to look. The rule now says so, with the measured case attached.

## Fixed here

- **OR-102b** — `Verify:` → prose. Now **#1 in Lane B READY**.
- **OR-104** — `Gate:` and `Verify:` both → prose. Now **#1 in Lane A READY**.
- The `Verify:` field rule gains the "means SHIPPED" paragraph.
- **OR-105** filed for the rest of the class.

## Not done — and the number is not 17 defects

A scan for `Verify:` with no `Branch:` and no ship evidence returns **19 entries**; two are the ones
fixed here. **The other 17 are candidates, not findings.** BF-72, BF-95 and BF-98 were checked on the
S25 on 2026-09-06 and are genuinely shipped — they just never recorded a branch. What separated
OR-102b was a full unwritten build spec still in the body, so the long entries are the suspects:
PS-24 (56 lines), LA-57 (57), BF-119 (58), RV-40 (46). Each needs a grep against the code, which is
OR-105's job. Anyone reading the 19 as a defect count will be wrong.

**Still with the owner:** the live `Retatrutide` row is unchanged (`updated_at` 2026-09-06 20:26,
`dose` still `'10mg'`). Production is read-only from a session.

**Surfaces not exercised:** none apply — no runtime code, no device path, no schema.

<a id="2026-09-09-admin-guard-catch-blind-spot"></a>

# 2026-09-09 — the guard that could not see its own class (PS-39, 27 → 24)

**Branch:** `test/admin-feedback-invite-routes` · **Product change**, version 1.441.4.

10 cases over `admin/feedback`, `admin/feedback/[id]` and `admin/invites` — and, reached through
them, a much larger finding.

## The finding: a CI check named the defect and could not see it

`scripts/check-admin-guard-catch.js` exists for Q-548 — "an admin check that cannot run is not a
refusal" — and has been passing **70 of 70** in every run this session. [#1017](https://github.com/nekodas-neko/TrainingAi_Open/pull/1017) fixed two
routes of that class by hand. Writing this batch turned up two more, which prompted a proper sibling
sweep, which found **twelve live sites** the check was reporting clean.

Its detector was a single regex requiring the try's closing brace on the line immediately after the
call. Two ordinary shapes slip through it, and between them they covered every remaining offender:

1. **A trailing semicolon.** `await requireAdmin(a, b);` puts a `;` between `)` and the newline,
   which `\s*` does not cross. Purely stylistic, and it silently disabled the check for nine sites
   across four routes.
2. **A try holding the real work as well.** `admin/errors`, `admin/feedback`, `admin/feedback/[id]`
   and `admin/users` wrapped the repository read too, so the catch flattened a failed **query** into
   403 — the more dangerous shape, and invisible to a pattern insisting the brace comes next.

Measured, not argued: against a probe carrying both shapes the old regex matched **0 of 2**, and the
rewritten detector run over unfixed `origin/main` reports all **12** sites.

The old header claimed "the sweep that introduced this check cleared all 46, so the correct baseline
is zero". That was true only of the 46 the regex could see. **A check that cannot see most of its
class is worse than none, because the green tick is read as evidence** — it is what let me write
"Custom Rules 70 of 70" under a PR that fixed two of twelve.

## What shipped

- The detector now **brace-matches the enclosing `try`** instead of pattern-matching its shape, so
  spacing, semicolons and block contents are irrelevant.
- `scripts/__tests__/admin-guard-catch.test.ts` pins both blind spots plus the bind-but-ignore shape
  and the legitimate non-`requireAdmin` swallow (`db-snapshot`'s audit-log write, which must stay
  allowed or the check trains people to ignore it).
- All **12 sites** fixed across `exercises`, `feedback`, `feedback/[id]`, `generate-exercise-media`,
  `mirror-dataset-gifs`, `reference-figure` and `users`. Where the try also held the work, the work
  moved out of it.
- **`admin/invites` DELETE now normalises the email**, as POST already did. `removeInvite` is an
  exact-match delete on the stored (lowercased, trimmed) value, so revoking `Foo@Bar.COM ` matched
  nothing and still answered `{ ok: true }` — a revoked invite that was never revoked.

## The tests

The invite fixture is deliberately mixed-case with surrounding whitespace: an already-clean address
makes the normalising and non-normalising versions identical, which is how DELETE came to be missing
it in the first place. A malformed feedback id now answers **400 rather than 403**, since the old
catch swallowed the UUID guard too.

## Mutation pass

**11 of 12 caught**; the survivor is an equivalent mutant planted as a control.

## One thing seen and not explained

A full-suite run failed once with `error: deadlock detected` in an unrelated DB test's cleanup
(`user-stats-soft-delete`). The file passes 3 of 3 in isolation and the next full run was green, and
nothing in this diff touches `lib/data/**`. Filed as **LA-86** rather than called a flake: every DB
file uses its own test user, so a deadlock points at lock ORDERING between parallel files, which is
a different class from the statement-timeout contention already fixed and would read as a spurious
red PR in CI.

## Not exercised

The repository is mocked — no database, so the 503 path is proven by making the admin lookup reject
rather than by a real outage. The nine sites in `exercises`, `generate-exercise-media`,
`mirror-dataset-gifs` and `reference-figure` are **not** covered by a route test; what holds them is
the rewritten check plus its own self-test. Web/Node only: no device, no native surface.

<a id="2026-09-09-bf131-baseline-anchor-hop"></a>

# 2026-09-09 — the AMRAP baseline session is consumed, and the phase exits on its own (BF-131)

**Branch:** `fix/bf131-amrap-baseline` · engine half; the card is LA-92 (Lane B).

The owner ran both baseline sessions exactly as the banner instructs — Push 2026-09-07, Pull
2026-09-06, one AMRAP set per exercise, both completed — and Health → Training still read *"baseline
needed"*.

`sessions_in_phase = 1` on both was the tell: **completion was wired and wrote the wrong field.**
The counter moved, `baseline_complete` never did, and the only exit from `baseline` was the "Use
prior data →" button — the one path that discards the baseline session. The alternative exit
deadlocked: prescription generation returns 400 while `phase === 'baseline' && !baselineComplete`,
so no prescription → no recommendation → no transition.

## One hop, not a new calculation

The entry was amended before I picked it up to say the derivation already runs, and that held up:
`estimateOneRm` takes an `isBaseline` flag, the workout screen passes it, and the result is already
persisted to `exercise_logs.estimated_1rm`. The number was in the owner's data the whole time. What
never happened was the copy into `session_periodization.baseline1rm` and the flip of the flag.

So completion now reads that back and writes it, keyed by **session-exercise id** — how the
periodization signals look a baseline up, and the same keying the prior-data path already uses.
Tagged `source: 'amrap'`, a value that already existed in `Baseline1rmEntry` with no producer, so a
measured anchor stays distinguishable from a carried-over PR or a number typed in the builder.

Same posture as the counter beside it: **advisory, fire-and-forget.** A completion must never fail on
a periodization write, which means the flag can lag a completion.

## The decision the entry left open

It asked for a choice on a partial baseline — complete with a PR fallback for the gaps, or stay in
`baseline` and name what is outstanding. **Staying**, and the codebase already argues it: the
skip-baseline route refuses to write an "empty, unusable anchor", and the exercises without one are
exactly those a rebuilt program added, where re-measuring is the point. Auto-filling them would make
the baseline session decorative — the same inversion the entry gives for not firing "Use prior data"
automatically.

So a partial **accumulates**: three of five keeps those three, stays in `baseline`, and a second
session finishes what the first started. That also hands LA-92 its number for free — the card can
count the stored map against the session's exercise list.

## Two survivors, and only one was a real gap

- **The ownership scope was untested.** `exercise_logs` carries no `user_id`, so the read is scoped
  through `workout_sessions` — and my first fixture asked for *my own* session id, where the
  workout-session filter already isolates everything and dropping the scope changes nothing. It has
  to ask for **another user's** id. That is the whole of what the scope defends.
- **The already-complete guard is genuinely redundant, and I proved it rather than assuming.** The
  caller checks `!baselineComplete` and the slice checks it again; each mutant alone is masked by
  the other, and removing **both** is caught. Kept as defence in depth with a comment saying so, so
  neither gets "simplified" away as dead.

And the fixture that produced the second point is the trap I documented in
[`docs/route-test-fixtures.md`](../route-test-fixtures.md) earlier the same day: my case for the
already-complete guard called `setBaselineComplete`, which **also** moves the row to
`accumulation` — so the *phase* check rejected it before the *completed* check was reached. A case
meant to fail on guard X, rejected first by guard Y. Rebuilt by setting the state directly.

**10 of 12 caught**, the two survivors being that measured redundant pair; the thirteenth is a
planted equivalent control.

## Gate

`npx tsc --noEmit` clean · full suite green · `check-backlog-pointers` OK (334 entries).

**Not exercised: no device, and no screen.** The card still reads "Baseline needed" until LA-92
lands — what changed is that the phase now exits by itself, so the banner's promise ("the AI will
calculate your 1RM and start prescribing from the next session") is true for the first time. **Not
seen on the S25**, and the owner's existing rows are untouched: this fixes new completions, not the
two sessions already sitting at `baseline_complete = false`. His workaround — tap "Use prior data →"
— remains valid, and is now a deliberate choice rather than the only way through.

<a id="2026-09-09-feat-details-tests-and-scans"></a>

## 2026-09-09 — Tests and scans on Profile details, and the half that needs a route (BF-133, Lane B)

**What shipped.** BF-133's clinical residue: `fitness_tests`, `dexa_scans` and `measured_rmr` now
render on **More → Profile details** as a "Tests and scans" section, beneath the daily readings
#1009 added. Each row carries the day it was taken, and each group disappears whole when nothing has
been recorded — the same rule the daily half runs on, and the reason the screen does not grow a
`Blood` heading over a table that has never had a row.

**The part that decides whether this is useful or misleading is the labels.** Every number in this
section has a same-named neighbour *on the same page* that is a different measurement: the scan's
body fat against the scale's, a lab-measured resting rate against the scale's estimate, a test
morning's resting heart rate against the ring's daily figure. Each says which it is, and the
Metabolism note that used to point off-screen (*"a lab-measured RMR … is under DEXA & RMR results"*)
now points at the row above it. The VO₂max is labelled estimated, because the column is `vo2max_est`
and the test is a submaximal walk — printing it plain would present a formula's output as a
laboratory measurement.

**Two sections, not more groups in one.** The daily half returns null when it has nothing; sharing
that return would have hidden a DEXA scan behind the absence of a scale. Each half now decides its
own emptiness. The row markup was extracted to `reading-group-card.tsx` first, so this is not a
second place a metric on this screen gets formatted — the trap BF-133 names about the existing body
cards, which applies to itself.

**`personal_records` is not here, and that is filed rather than skipped.** Nothing exposes the user's
own records with a date: `repo.listPersonalRecords` returns a `Map<string, number>` that throws the
date away, and `/api/weights-summary` reports records only for the **active program**. Neither is
usable — the card's rule is that every value carries its date, and an active-program filter would
silently drop a lifetime best on an exercise no longer programmed, which is exactly what such a list
is for. It needs a route, which is Lane A's, so it is **LB-95** with `Needs: BF-133`.

**A latent race in a sibling spec, made live by three more fetches.** `measured-overview.spec.ts`
counted dated rows the moment the heading appeared — but that heading renders as soon as *either*
half has content, and the sleep average arrives from its own fetch. It read as a stable pass only
because `/api/body-metadata` happened to win; adding three fetches to the screen lost it **one run in
two**. Reproduced, confirmed pre-existing (it passes alone on clean `main` and alone with this
change — only the pair fails), and fixed by waiting for the first dated row rather than counting on
sight.

**Also recorded, from elsewhere this session.** BF-84's remaining half is gated through BF-94, which
is `Gate: device` — stated only in prose, so `next-item.js` offered BF-84 as buildable while BF-84's
own body says *"do not build the greyed second button and then have BF-94 delete it"*. Now a `Needs:`
field. And LB-56 has a **third sighting** (#1041) that names its mechanism: a browser `SIGSEGV` with
a stack trace and **no `ERR_ABORTED` at all**, which makes the two error strings previously recorded
downstream of one renderer crash rather than two faults.

**Verification.** New `e2e/details-tests-and-scans.spec.ts` seeds a scan, an RMR test and two
fitness tests of different types, and asserts the converted numbers, the dates and the qualifying
notes — **mutation-checked twice**: dropping the gram-to-kilogram conversion renders `63,400 kg` and
fails; removing the resting-HR qualifier fails the label half. The three Profile-details specs run
together **three times, 6 passed each**. 36 unit tests in `components/more/details`. `pnpm lint` 0
errors, `npx tsc --noEmit` clean, `pnpm check:rules` **Ran 70 of 70**.

**Not exercised.** The device. `fitness_tests` is read local-first and the browser has no native
SQLite, so only the `cachedFetch` fallback ran — the `getFitnessTests` branch is unexercised, and so
is how a now-noticeably longer dense list reads on the S25. Recorded as a Known-Issues row and as
BF-133's remaining `Verify: device`.

**Version.** 1.443.5 — minor user-visible addition, shipped as a patch since it is a new section on
an existing screen rather than a new surface.

<a id="2026-09-09-feat-lb-18-recent-all-buckets"></a>

## 2026-09-09 — `Recent` reads every meal bucket (LB-18)

**Branch:** `feat/lb-18-recent-all-buckets` · **Lane B** · PR #1012

### What shipped

`Recent` on Log Food no longer scopes to a meal bucket. `RecentFoodsPanel` reads
`getRecentFoodItems(12)` from the local store and `/api/nutrition/recent-for-meal` with **no**
`mealTypeId`, which the route reads as every bucket and answers with 12 rows rather than 5.

The owner settled this on the device: *"Recent doesnt need to be scoped to current meal bracket; I
think it should just be all recently entered foods/meals."* The Lane A sources landed 2026-09-02, and
LB-18 predicted the rest exactly — *"the swap is this component's fetch and nothing else."*

It was almost that. The `mealTypeId` prop and the `recentMealTypeId` `useMemo` that fed it are gone
too, which has a consequence worth naming: **nothing on that panel waits for the meal types any
more**, so the list paints as the sheet opens instead of after a bucket resolves.

### The cache key sits inside the old family on purpose

`nutrition-recent-for-meal:all`, not `nutrition-recent-all`. `invalidateCache` deletes
`WHERE key LIKE 'prefix%'` and `invalidateFoodLogWrites()` clears the prefix
`nutrition-recent-for-meal:`, so the new key is already evicted by every food write. A name outside
that prefix would have needed a new group in `lib/cache-groups.ts` — Lane A's file — for no
behavioural gain. That reasoning is in the file, because renaming the key silently removes it.

### What is still owed

**`Recent` is foods only.** The owner's answer was *"all recently entered foods/meals"* and this is
the bucket half. Mixing saved meals in is buildable — `listSavedMeals` already derives `lastUsedAt`
from `max(food_logs.logged_at)` and orders by it (migration 238), so the timestamp LB-18 once
described as missing has existed for weeks — but it needs a source returning both kinds interleaved,
which is a route change and so Lane A's. Recorded as a `Keep:` so the entry does not read as fully
answered.

### Verification

`e2e/recent-all-buckets.spec.ts` intercepts the request and asserts the URL carries **no**
`mealTypeId`. That is the whole regression surface and it is invisible to a type-check: the route
treats the param's absence as every bucket, so a stray param silently restores the old behaviour
while everything still compiles and renders.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView. The entry's own caution is worth carrying to that
check — *"opening Log Food at 7 pm and being shown what you usually eat at dinner beats a global list
topped by breakfast coffee"* — so whether the global list actually reads better is the thing to look
at on the device, now that the owner has asked for it.

Patch bump — a behaviour change to an existing surface.

<a id="2026-09-09-feat-plan-meal-answer-e2e"></a>

## 2026-09-09 — the plan card's per-meal answer, covered — and a decline that could revert (LB-51, Lane B)

**What was owed.** LB-51 shipped `plan-rescale.spec.ts` and left a `Keep:` naming three uncovered
plan-card actions: the log-all action, the per-meal log and decline, and save-to-My-Foods. Two have
since been covered by other work — log-all by `plan-day-fill.spec.ts` and the copy by
`plan-meal-to-saved-meal.spec.ts` — so what was genuinely left was the **per-meal log and decline**.
That is now `e2e/plan-meal-log-decline.spec.ts`, and the LB-51 entry is removed from the queue.

**The coverage found a bug, which is the point of it.** Declining a meal reverted on **two runs in
three**. The decline flips the row optimistically and writes behind it; `loadAnswers` re-runs while
the card is on screen, and a read already in flight when the user taps returns the state from
*before* the tap. `setDeclinedMealIds(new Set(serverIds))` applied it verbatim and the answer was
gone — the optimistic-write rule this repo learned from the mood-checkin re-prompt, in the one place
nothing else can reveal it: a decline writes no food and moves no total, so the only symptom is the
meal asking again. Fixed in `app/nutrition/use-plan-meal-logging.ts` with a small map of answers this
device has made that a read has not yet agreed with; an override is dropped the moment a read
matches it, so it converges rather than pinning the value against the server. **3 of 3 runs green
after, 1 of 3 before.**

**What the spec asserts, and why it is on rows rather than labels.** Both buttons report themselves
instantly, so a control wired to nothing paints the same screen. What only passes if the write
happened is a `food_logs` row for the logged meal — and, for the decline, its *absence* plus a live
`plan_meal_answers` row. The decline is also re-read after a full reload, which is the only evidence
it persisted at all. The fixture is built in Postgres rather than stubbed because
`plan_meal_answers.plan_meal_id` is a foreign key onto `meal_plan_meals`: a stub's invented ids
cannot be declined.

**One guard is reasoned, not exercised.** The override map is keyed by day as well as by meal,
because a plan meal keeps the same id on every day it is planned for. Nothing currently reaches the
hook with a second date — the plan card renders only on today, which an attempt to assert it through
the day switcher established — so this is belt-and-braces against a future change rather than a bug
that was happening, and the comment says so rather than claiming a fix.

**Mutation-checked.** Removing the declined filter from `fillableMeals` fails the offer-count
assertion; making the decline never reach the server fails the persistence half. Both were run.

**Two gotchas worth carrying.** `scrollIntoViewIfNeeded()` scrolls *every* ancestor scroll
container, and on the tab shell one of those is the horizontal carousel holding all five tab trees —
scrolling a control into view slid the shell off Nutrition and the tap landed on the Workout tab.
`scrollIntoView({ block: 'center', inline: 'nearest' })` is the fix. And reading the database
straight after the optimistic flip finds it empty: the write has to be waited for
(`page.waitForResponse`), not assumed.

**Not exercised.** The device path. The browser has no native SQLite, so `getLocalStore` returns null
and both writes take their web fallback — the local-store mirror, the outbox mutation, and the
`store.getPlanMealAnswers` branch of the fix are owed an on-device check. The fix's reconcile logic
is shared by both branches, but only the web one ran here.

**Version.** 1.443.4 — patch; the reverting decline was user-visible.

<a id="2026-09-09-feat-q-519-manual-bedtime-ui"></a>

## 2026-09-09 — The bedtime you remember (Q-519, UI half)

**Branch:** `feat/manual-bedtime-entry` · **Lane B** · PR #1011

### What shipped

A card on Health → Sleep for the latest night: set a remembered bedtime, change it, clear it. Queued
through the `manual_bedtime` outbox domain so it survives offline, with a direct POST as the fallback
where there is no local store.

**The engine had shipped on 2026-08-26 and nothing could write to it.** Migration 233, the repository
method, the route, the outbox domain, the local column and the one read site all existed; the control
did not. That is the shape OR-105 is about — work that reads as done because most of it is.

### What it deliberately does not touch

`manual_sleep_start` and nothing else. Not the measured start, not a duration, not an efficiency, not
a synthesised end. The original design wrote the remembered value into `sleep_start` and leaned on the
per-field merge; the audit that design commissioned found three consumers deriving behaviour from the
*window* rather than the stored columns — one turning a 3-hour night into **9 hours at 34%
efficiency**, another moving five awake hours into a nightly training set with no fragmentation
needed. The card shows the measured start beside the field as the contrast that makes the control make
sense, and changes nothing else on the screen.

### The date rule, which is the trap

A night dated `D` begins the **evening before** when the remembered time is before midnight, and on
`D` itself when it is after. So 23:00 and 00:30 for the same night belong to different days, and
getting it backwards stores a value 24 hours out.

The split is at **noon** — the same anchor `minutesFromNoon` uses, for the same reason: nobody's
bedtime lands at midday. `bedtimeInstant` owns it, tested across the noon boundary, month ends
(`2026-09-01 → 08-31`, `2026-01-01 → 2025-12-31`, `2026-03-01 → 02-28`) and the timezone (23:00
Brisbane is 13:00 UTC — a UTC-built instant is ten hours out).

**It changes nothing the app computes today**, and that is written down because it is why someone
would delete it: the sole reader, `/api/user/bedtime-estimate`, passes the value through
`minutesFromNoon` and sees only the clock time. The date is there for the row being honest and for
the first display that ever shows it.

### The gap this leaves, and it is Lane A's

**`/api/sleep-sessions` does not return `manualSleepStart`** — the repository maps the column
(`adapter.ts:2716`), the route's field list omits it. So the card reads the value from the local
store instead, which means on the **web** build the saved bedtime reads as unset while the write
works; on the APK it reads correctly. Reading through the screen's own rows was not an option either:
they are local-first only until the network answers, and the network payload overwrites them without
the field.

One line, in an `app/api/**` path, so it is filed on Q-519 rather than taken here.

### Verification

9 unit tests over the date logic, including every refusal — `parseClock` returns null for `24:00`,
`23:60`, `2315` and a bare `23:1`, because whatever it returns becomes a stored timestamp.
`e2e/manual-bedtime.spec.ts` drives the real screen at 412 dp and intercepts the route: saving posts
an ISO instant, and **clearing posts an explicit `null`** rather than omitting the key, which the
route's `.strict()` schema requires.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView, and the offline path — the queued mutation draining
after a reconnect is the half a browser cannot show. The engine half was never device-verified either
(its local column arrives through `reconcileSchema` on a real device, and no APK has run), so that
check now covers both halves.

<a id="2026-09-09-feat-rest-vs-prescription"></a>

## 2026-09-09 — What the plan asks for rest, against what you take (Q-300, Lane B)

**The owner was asked and chose to surface it.** Q-300's residue had been gated on *"once the owner
has seen the framing"* — a gate stated only in prose until earlier today, so the queue tool had been
offering it as startable UI work. Put to them directly with the measurement, they took **a plain fact
card** over dropping it.

**The framing is the finding, and the obvious one is wrong.** Across 344 sets in 27 sessions, 39.8%
are "rushed" against their prescription — but *uniformly*: no session is rush-free, none is mostly
rushed, mean 0.411 with sd 0.138. "You rushed today" is meaningless when every day is that day. What
the same data says instead:

| planned | mean actual | |
|---|---|---|
| 60 s | **75 s** | longer than asked |
| 90 s | 65 s | |
| 120 s | 110 s | |
| 187 s | 133 s | |

Prescribed rest spans 60–187 s; actual spans 65–133 s. The plan is **compressed toward a personal
pace** rather than followed, and at the shortest prescription it is exceeded. That is a fact about
the prescriptions being unrealistic or unnoticed, not about the lifter running late.

**So the card carries no score, no verdict and no nudge.** Prescription, rest taken, signed
difference, set count. The difference is not coloured — red for "less rest" would make it a
scorecard, which is exactly the reading the uniformity rules out.

**One sentence, and it is three-state.** *"Your rest sits in a narrower range than the plan asks
for"* appears only when the actual span is ≤ ⅔ of the planned span. On a single prescription there
is no span, and `compressed` returns **null** rather than false — printing "your rest follows the
plan" there would state the opposite of what is known. That distinction has its own test.

**It reads `set_logs.planned_rest_sec`, not the live style, and that is deliberate.** The snapshot is
what was prescribed *at log time*; deriving it from the style would let a later style edit silently
rewrite what "prescribed" meant for a past set. The `rest-adherence` trend it sits under does derive
from the style — right for its question (does adherence track performance?), wrong for this one.

**A second Lane A gap, and the same one as this morning.** The fields are in the local store and no
route publishes them, so the card is **absent in a browser** and the e2e can only assert its absence.
That is the second device-only, CI-unverifiable surface shipped today — the reta weight-response card
was the first — so it is filed once as a class, **LB-98**, rather than per feature.

**Verification.** 13 unit tests on the pure module, including the production shape, the exceeded
shortest prescription, the noisy-mean floor, and the null-vs-false compression state.
`health-tabs-instant-paint.spec.ts` green (5 passed) — the Trends section takes a new prop and still
renders. `pnpm lint` 0 errors, `npx tsc --noEmit` clean, 120 unit tests in `components/health`,
`pnpm check:rules` **Ran 71 of 71**.

**Not exercised.** The device, which is the only place this card renders at all: the numbers, and
whether a four-row table reads well under the trend bars on a 412 dp screen.

**Version.** 1.445.0 — minor; a new thing on an existing screen.

<a id="2026-09-09-feat-reta-weight-response"></a>

## 2026-09-09 — Weight response on the vial sheet, and the colour it refuses to show (OR-102b ④, Lane B)

**What shipped.** The reta tracker's fourth part: over the current vial, the weight-change rate, its
95% interval, and the owner's target band — with a coloured chip **only when the whole interval falls
on one side of the band**. Everything else greys out with *"not enough weigh-ins yet"*, and the
number and interval print either way.

**Two corrections to the request, both of which the entry had already made and measured.** The owner
asked for *"weight delta from last weight on injection day to last recorded day"* with a colour.
Across 87 weigh-ins over 118 days the residual SD about the trend is **1.203 kg**, so a two-point
delta carries **±1.70 kg** — more than twice the width of the entire 0.35 kg-wide band. The colour
would be near-random while looking authoritative. So it is a rate with an interval, not a delta. And
the anchor is **the vial, not the last injection**: seven days resolve a rate to about ±1.3 kg/wk,
while a vial is the span over which the dose is actually constant and typically runs two to four
weeks.

**No third estimator.** The rate is `computeWeightRateFit` — LB-67's, which returns
`stdErrKgPerWeek` precisely because this needed the interval rather than the point estimate. Two
kg/week estimators already existed here and one was wrong; a third is the bug class the One Formula
rule exists for. What this module adds is the *decision*: the floors, the t-quantile and the refusal.

**Three guards that each fix a way of being confidently wrong.**
- **1.96 is the wrong multiplier for three readings.** That is the large-sample limit; at one degree
  of freedom the 95% quantile is **12.7**, so 1.96 would report an interval six times too narrow and
  hand out verdicts on three weigh-ins. A small t-table replaces it.
- **A perfectly straight series measured a residual of 1.2e-13**, which passes a `> 0` guard and then
  makes every difference significant by dividing by nothing. A 0.1 kg scale cannot produce a residual
  under ~0.029 kg, so anything below that is degenerate rather than consistent.
- **A residual SD fitted from four points is itself noisy** and routinely comes out too small,
  narrowing the interval exactly when it should be widest. The measured 1.203 kg is a floor below ten
  readings — a floor, not a replacement, so a genuinely noisier series is not talked down to it.

**The web build can only ever show the empty state, and that is filed rather than papered over.**
The card reads `body_metrics` local-first; `getLocalStore` returns null in a browser, and the only
server read of that table, `/api/body-metadata`, hard-codes `metrics.slice(0, 7)` with no range
parameter. So the e2e has to build its fixture inside seven days, where the interval is about ±4
kg/wk and only an absurd loss rate reaches the coloured branch. The rendering is verified; the
realistic case is reachable only on the device. **LB-96** asks Lane A for a bounded range parameter.

**The band is still a constant.** `DEFAULT_BAND_PCT_PER_WEEK` is 0.5–1 %/wk, threaded as a parameter
so a stored value drops in. No such setting exists anywhere — grepped `users`, the goals tables and
the shared types. **LB-97**, Lane A's, since a preference is storage.

**And no recommendation, by design.** Naming a dose is a medical decision and out of scope per this
entry's parent; a 14-day slope resolves to ±1.30 kg/wk against a 0.35 kg band, so a weekly
increase/hold call would flip on water weight while sounding certain.

**A sibling spec of mine did not clean up, and only a repeat run shows it.**
`vial-dose-calculator.spec.ts` (#1007, mine) creates its supplement through the UI and deleted
nothing, so on any database that survives between runs the second run finds two rows called
`Vial E2E` and the trigger locator dies on a strict-mode violation — three had accumulated locally.
CI never showed it because CI gets a fresh database, so the whole cost lands on whoever runs the
suite twice. It now removes what it made, and the pair was run twice in a row to prove it.

**Verification.** 28 unit tests, including the straddle case, the degenerate-series case and the
band scaling with bodyweight. `e2e/reta-weight-response.spec.ts` drives both branches from one
fixture shape, **mutation-checked twice**: committing on the point estimate instead of the interval
fails the withheld case; never committing fails the coloured one. Run together with
`vial-dose-calculator.spec.ts` twice in a row — **5 passed** each time. `pnpm lint` 0 errors,
`npx tsc --noEmit` clean, `pnpm check:rules` **Ran 70 of 70** — which caught a UTC date slice in my
own test fixture, now `shiftDateStr`.

**Not exercised.** The device: the real multi-week window, the `getLocalStore` branch, and whether
the colour reads at a glance on the S25 — the entry's own device check, alongside the calculator's
arithmetic against the owner's third-party app.

**Version.** 1.444.0 — minor; a new part of the tracker.

<a id="2026-09-09-fix-bf-51-ingredient-source-tabs"></a>

## 2026-09-09 — The ingredient picker's two sources become tabs (BF-51 ③)

**Branch:** `fix/bf-51-ingredient-source-tabs` · **Lane B** · PR #1038

### What shipped

`Your foods` and `Food database` are a tab strip under the search field. The estimate and
recipe-import actions stay below, where they apply whichever list is showing.

The owner's report was that `Recently used` *"sits in the middle of the ingredient list"*, with
*"this should probably be a tab like the other place"*. It read as mid-list because it was: your own
foods, then the estimate/import action, then the food database — two lists with an action wedged
between them.

### Following the instruction literally would have caused a bug

"the other place" is Log Food, whose tabs are `Recent · My Foods · Search`. Copying those names onto
this screen would put **`My Foods`** on the ingredient picker — where it would mean single foods,
while one screen away the same label means **saved meals**.

That is precisely the confusion BF-103 removed, by owner decision, three days ago: *"we only need
one. lets go with MyFoods."* Rebuilding it while carrying out a request to copy that screen would
have been an easy and invisible regression.

So the two headings already on this screen were used instead. What is kept from Log Food is the
distinction its own note says the labels rest on — one side is what you already own, the other
reaches beyond it.

### Smaller calls

**A pasted recipe URL hides the strip.** That branch replaces both lists with an import offer, and a
tab bar choosing between two things that are not being shown is worse than no tab bar.

**The `Food database` tab says what it needs.** Its results only load at two characters, so opening
it on an empty query used to show nothing at all; it now says *"Type at least two letters to search
the food database."* rather than reading as broken.

**The "no results" line belongs to the tab you are on.** It used to require both lists to be empty,
which is not a sentence that means anything once they are not on screen together.

### What is still held on this entry

① (back from Edit exits the tab) and ② (the two photo controls) are unchanged and still deliberately
unshipped. ① was built, measured, and held because the fix destabilises
`e2e/meal-photo-picker.spec.ts` in a way that is not diagnosed — and `sheet-back-stack.ts`'s three
previous bugs were every one of them found on a device. That reproduction is still owed and is not
something this session could do.

### Verification

`e2e/ingredient-source-tabs.spec.ts` drives the real builder at 412 dp: both tabs render, the
database list is behind its own tab with its two-letter hint, and switching back hides it — so the
two lists are no longer stacked.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView. This is a layout change to a screen the owner is
actively iterating on — *"Lets get this into the right section and UI before we deep dive this
more"* — so whether the split reads right is a device judgement, and the reversal cost is one
component.

Patch bump — a layout change to an existing surface.

<a id="2026-09-09-fix-bf-83-provisional-baseline"></a>

## 2026-09-09 — A night still filling is not part of its own baseline (BF-83)

**Branch:** `fix/bf-83-provisional-baseline` · **Lane B** · PR #1014

### What shipped

`health-metric-sheet.tsx` builds its "vs your recent nights" scales from `settledNights(allNights)`
rather than every night, so a night still filling is excluded from the distribution it is being
compared against.

That was the last of BF-83's three halves. The engine landed 2026-08-31 (`provisional: boolean` on
every `/api/sleep-sessions` row); the badge already renders on the sleep detail, the Body tab's sleep
card and Home's score chip row; this is the baseline.

### Why it is the half that was easy to miss

The owner's report came with two screenshots of the same night four minutes apart:

| Opened | Time asleep | Efficiency | HRV | 30-night avg |
|---|---|---|---|---|
| **6:44** | 6 h 15 m | 93 % | 61 ms | **7 h 46 m** |
| **6:48** | 7 h 40 m | 95 % | 65 ms | **7 h 49 m** |

The badge answers the first four columns. **The last column is why the badge alone is not enough**:
the average moved too, so the reading and the context judging it were drifting together. A
provisional night is both the newest in the window and the one night whose numbers are known to be
incomplete, which is the worst possible member of a comparison set.

### The two distinctions that make it correct rather than merely applied

**The night being viewed is never filtered.** It is the reading, not the baseline — a provisional
night still shows its own numbers, under its own badge, compared against settled ones. Filtering it
out of its own detail view would have been a different and worse bug.

**An absent flag counts as settled, not provisional.** Every night recorded before the flag existed
carries no value; reading those as provisional would empty the baseline rather than protect it. The
stricter-looking filter is the broken one, which is why it has its own test.

### Verification

4 unit tests on `settledNights`, covering the absent-flag case, order preservation, and the empty
result a fresh install produces — which the sheet's own `>= 3` gate is what handles.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite **845
files passed, 0 failed**.

No new e2e: the change is which rows feed a distribution, and the state that exercises it — a night
mid-drain — is not something the seeded database has or a browser can create. The unit tests are the
honest coverage here, and the real check is the device, next time a night is opened while it is still
filling.

**Not exercised:** the S25, Samsung WebView, and a genuinely provisional night.

Patch bump — a bug fix.

<a id="2026-09-09-fix-food-row-shared-source-tab"></a>

## 2026-09-09 — `food-row-shared.spec.ts` walked past the source tabs #1038 added (Lane B)

**What broke.** `#1038` (BF-51 ③) put the ingredient picker's two sources behind tabs, opening on
`Your foods`. `e2e/food-row-shared.spec.ts` searches that picker and asserts on the **external**
food-database row — which is now a tab away rather than below the local results — so it failed on
`main` from the moment #1038 landed. Reproduced on clean `main` before changing anything.

**Mine, and a missed sweep.** The standing sibling-surface rule says a pattern change on one surface
is followed through every surface handling the same domain in the same PR. #1038 shipped the tabs
and its own new spec and did not check what else already walked that picker. Three specs do; only
this one asserted on a row the tab change moved.

**The fix.** The spec taps `Food database` before looking for the external row, scoped to the
picker's own `tablist` — the sheet hosting it has a `My Foods` tab of its own, so an unscoped
`getByRole('tab')` would be ambiguous. Test-only: the tabbed behaviour is what BF-51 ③ asked for and
is unchanged.

**Verification.** Failed on clean `main` at `e7f6a576ed`, passes with the change (4 passed). The two
sibling specs that also drive the picker — `recipe-image-to-meal` and `single-foods-database-search`
— plus #1038's own `ingredient-source-tabs` were run together and are green (8 passed), which is the
sweep that should have run in #1038.

**Not exercised.** Test-only, no app code — nothing reaches the device and no APK is involved.

<a id="2026-09-09-fix-injury-header-crowding"></a>

# 2026-09-09 — the injury warning moves to where the decision is made (BF-135)

**PR:** `fix/injury-header-crowding` · **Lane B** · `components/workout/active-workout-screen.tsx`,
`components/workout/injury-notice.tsx` + `injury-muscles.ts` (new).

The owner, mid-set on Legs: *"ui gets a bit quoted for injury ones"* — Barbell Hip Thrust carrying
the injury banner, the AMRAP banner, and set 1 disappearing behind the logging sheet. BF-135 traced
it: the active-exercise header is `flex-none space-y-2 mb-2` above a `min-h-0` set list, nothing in
that branch has `overflow-y-auto`, so every row the header grows squeezes the rows below with no
scroll to recover them.

## What shipped

- **The full banner moved to the ready screen**, above the bar-load card, the warm-up ramp and the
  set targets. That is where swapping a movement or going lighter is chosen — not between set 3 and
  set 4 — and **that screen had no injury warning at all before this**, so the warning used to arrive
  after the weight was already picked. It scrolls, so it costs no other content.
- **During the set it is a chip** on the exercise-name row: `⚠ Injury: Chest  Swap`, 157 × 48 px,
  clearing the repo's 48 dp tap floor without a second row. Swap comes with it — BF-135 rules out
  suppressing this warning, and the swap is its only action.
- **`injury-notice.tsx` renders both**, from `injuredMusclesFor()` computed once, so the two screens
  cannot come to disagree about the same injury.
- **The header gained `max-h-[45%] overflow-y-auto overscroll-contain`.** With the banners gone it
  never engages; it is there so the next conditional thing added to that block scrolls instead of
  pushing set 1 off-screen.

## The AMRAP banner is deleted, not made conditional

BF-135 recommends showing it on the first exercise of a baseline session only. **The ready screen for
every exercise already carries the same instruction in fuller form** — *"Pick a weight you can manage
for 8–15 reps. Do as many reps as possible with good form — this sets your working weights for the
whole program"* — and every exercise passes through that screen before its sets, including one
resumed from a superset buffer, whose `timerStarted: true` only exists because it was started there.
So the active-screen banner was a strict duplicate of copy the lifter had just read, costing a
full-width row on the most contested space on the screen. "First exercise only" is still one row of
duplication.

Worth stating why it never stopped appearing: `isBaseline` is gated on the phase, and **BF-131 is why
the baseline never completes**, so this was permanent rather than a first-session artefact.

## Two smaller things found in the same code

- The old filter concatenated `mainMuscles` and `secondaryMuscles` and never de-duplicated, so an
  exercise listing the injured muscle in both read *"Lower back, Lower back — train with caution"*.
- It hand-rolled the lowercase comparison against `activeInjuries`. It now goes through
  `activeInjuredMuscles()` — the shared definition the swap sheet's own filter already reads — while
  keeping the exercise's spelling for display, since the shared list is lowercased.

The chip says `Injury: Chest` rather than `Chest`: the bare muscle name beside the title reads as the
back arrow two rows above when the muscle *is* `back`, and a safety warning is the wrong place to
make someone work that out. More than one injured muscle shows as `Lower back +1` — the count rather
than a truncated list, with the full list in the ready-screen banner and in the chip's accessible
name.

## Verification

`pnpm dev` against the local non-prod database, driven through the Playwright harness at 412 px with
an injury seeded on the reached exercise's muscle. Rendered and measured on both screens: the ready
banner sits above the bar-load card with Swap reachable; the chip is 157 × 48 px on the name row; the
active header measures 210 px including the set grid, all sets visible, `Log Set 1` at y = 803 of
915. Screenshots taken and read.

Full unit suite green; `pnpm check:rules` **Ran 71 of 71**; production build clean.

**Not exercised, and this is the gap that matters:** the reported case is an injured exercise on a
**baseline** session — the two-banner worst case. The seeded account is mid-`Accumulation`, and
forcing `isBaseline` needs the program's phase set rewritten, which the sandbox seed does not carry.
So the two-banner state was reasoned about and its removal is pinned by a source test, but it was
never rendered. Nor was any of this seen on the **S25**, where the failure actually lives — the log
sheet covering the bottom half of a real device is what BF-135 asks for a device look at.

<a id="2026-09-09-fix-la-92-baseline-progress"></a>

## 2026-09-09 — The baseline card says how far along it is (LA-92)

**Branch:** `fix/la-92-baseline-progress` · **Lane B** · PR #1036

### What shipped

*"3 of 5 exercises logged"* in place of *"Baseline needed"*, on the AI Periodization card.

The old label read identically after zero baseline sessions and after four of five exercises, which
is why BF-131 could not be reported: the owner could only say *"even though the session was done it's
saying baseline needed"*, because the screen had no other words to offer.

### The count is an intersection, not a key count

The entry's own note is the load-bearing part: anchors in `baseline1rm` are keyed by
**session-exercise id**. `Object.keys(baseline1rm).length` therefore counts anchors for exercises
that may no longer be in the session — edit the program and the numerator can exceed the denominator,
so **"6 of 5" is reachable from a plain key count**. `baselineProgress` intersects the anchors
against the session's current exercise ids, which is what keeps the pair consistent. The e2e plants a
stale anchor specifically to prove it is not counted.

### "A rendering job rather than a data one" was nearly true

The entry said the calculation was the whole of it. The denominator was not in the card's payload:
`/api/ai-periodization/program-overview` has `ps.exercises` in scope and does not emit it, and adding
it is an `app/api/**` path this lane does not own.

It resolved without a route change because `workout-data:meta` already carries the full program and
is in the sync provider's warm list at `TTL_LONG` — so the exercise list is a cache read in the
ordinary case rather than a second request for a label. **Third time this session an entry's
"just the surface" claim turned out to be missing a field** (Q-519's `manualSleepStart`, BF-133's
seven-day window, now this). The classification held each time; the estimate of what was left did not.

### The e2e took the Health screen down before it passed

The first draft stubbed **both** endpoints, including `workout-data?tab=meta` with a thin fixture.
That key is shared with several other cards, and the partial payload crashed the whole screen with
`Cannot read properties of undefined (reading 'toLowerCase')` — no tabs, no content, an error
boundary. It looked like the change had broken Health; removing that one stub rendered the screen
perfectly, which is what proved otherwise.

The rewrite reads the **real** program up front and anchors the fixture to real session-exercise ids,
stubbing only the periodization state. That is the shape `score-gap-reason.spec.ts` already uses —
build the fixture from the real response so every other card stays honest.

**Worth stating as a rule:** stubbing a cache key that several components share is not a local act.

### Verification

6 unit tests on `baselineProgress` — the stale-anchor case, zero read as zero rather than as "no
answer", an unknown exercise list returning null rather than inventing a denominator, and the
singular in "1 exercise". `e2e/baseline-progress-label.spec.ts` drives the real Health screen at
412 dp and asserts both the new label and the absence of the old one.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView. A real partial baseline is also not something the
seed has — the count is proven against a fixture anchored to real exercise ids, not against a
genuinely half-finished baseline.

### A flake found on the way, filed as LB-93

The full suite went red once on this branch — `baseline-anchor-hop.test.ts`, BF-131's own engine
test, `expected false to be true`. The first hypothesis is always your own diff, so it was measured
rather than assumed: it passes in isolation on both trees, passes the full suite on clean `main`, and
passes the full suite on this branch — 1 failure in 2 full runs, on a components-only diff that
cannot change what a Postgres adapter writes.

The mechanism is in the file: it waits for asynchronous work with
`await new Promise(r => setTimeout(r, 300))`, twice, against a Postgres ~865 other test files share.
A fixed sleep is a bet on how long the work takes, not a wait for it. Filed for Lane A with the run
table, because the expensive part of this flake is that it fails on branches that did not cause it —
five runs to rule out, and the next author would start from scratch.

Patch bump — one label.

<a id="2026-09-09-fix-macro-budget-anchor-label"></a>

# 2026-09-09 — the macro targets and the calorie budget are two denominators, and the card now says so (BF-134)

**PR:** `fix/macro-budget-anchor-label` · **Lane B** · `components/nutrition/energy-card.tsx`,
`components/nutrition/macro-budget-gap.ts` (new).

The owner, on the Nutrition tab: *"is this the right number? looks like its took 200 off the base
then 200 off again?"* BF-134 had already established that the reported symptom is **not** a defect —
`1,453 base − 200 for your goal` is one subtraction, not two — and that the real defect is one line
higher: macro targets of 150 P / 141 C / 55 F sum to **1,659 kcal** beside a **1,253** budget on the
same card.

## What shipped

Two pieces of copy, both on `EnergyCard`, and a tested helper behind the first.

- **`macroBudgetGap(targets, budget)`** adds up the gram targets *already on the card* and compares
  them with the budget *already on the card*. It is not a fourth number: nothing here composes a
  calorie figure from parts, which is the discipline three separate findings (Q-401, Q-417, Q-323)
  put on this component. Null below a 100 kcal gap, null on an incomplete macro target — a profile
  with protein set and carbs blank would otherwise have its unfinished state reported as a
  disagreement.
- **The card line**, whenever the gap clears that floor: what the grams add up to, how far that sits
  from the budget, and that the grams come from the stored daily goal while the budget is built from
  resting burn + goal adjustment + movement recorded. *"Two different denominators, not a
  miscalculation."*
- **The ⓘ detail** gains the sentence that closes the reported symptom: the resting burn already has
  habitual daily movement taken out of it, which is why it sits below maintenance, and that is what
  lets recorded movement be added once rather than twice — *not* a second deduction for the goal.

## The entry's own arithmetic was wrong, and correcting it is the reason a label is the right fix

BF-134 says the two numbers *"converge only once ~406 kcal is earned"*. **They never converge.**
`scaleMacrosForEarnedKcal` puts the whole earned addend into carbs and fat, so the gram targets grow
by `earned` at exactly the moment `budgetProvenance` grows the budget by `earned`. The addend
cancels. What is left is a constant `storedGoal − (restingBase + goalDelta)` — 406 kcal at every hour
of every day, and earning precisely 406 moves *both* numbers.

`components/nutrition/__tests__/macro-budget-gap.test.ts` pins it at 0 / 100 / 406 / 550 / 1200 kcal
earned. This strengthens the entry's recommendation rather than weakening it: there is nothing to
wait for, so the card has to say it out loud.

## And the surface the entry proposed could not have carried it

BF-134 recommends extending `TdeeAdaptationCard`'s `Why two numbers` block, on the grounds that the
mechanism already exists. It does — but that block is gated on `maintenance.source === 'formula'`
**and** the stored goal drifting from its recommendation, neither of which has anything to do with
the macro/budget gap. It would have explained the macros for a formula-maintenance account with a
drifting goal and stayed silent for every other, the owner's calibrated case included. The copy went
where the two numbers actually sit together.

## Sibling-surface sweep

`DaySummaryCard` (the end-of-day review) shows the same pairing — a calorie target beside macro gram
targets — and needs nothing: it is passed the **raw stored** `targets`, so its 1,660 kcal and its
1,659 kcal of grams are one anchor and agree by construction. `EnergyCard` is the only surface that
mixes the burn-aware budget with the earned-scaled grams, which is exactly why it is the only one
that disagrees. Home's nutrition card shows no macro targets at all.

## What is deliberately not done

**The anchor decision.** Whether the grams and the budget *should* share a denominator reaches
`lib/health/energy-balance-service.ts` (Lane A) and TN-29 protects the stored 1,660 kcal target. The
entry stays in the queue with `Lane: A`, `Gate: owner` and a `Keep:` line naming only that.

**Scaling the grams down to the budget was not attempted**, per the entry: a morning protein target
near 113 g that climbs through the day invites under-eating protein on a rest day, which is the worst
day to.

## Verification

`pnpm dev` on the local non-prod database, rendered at the 412 px viewport through the Playwright
harness: the card line reads correctly in **both** directions — the seeded account carries a `+300`
surplus goal and shows the macros *463 below* the budget, which is what caught an earlier draft whose
wording explained only the deficit direction. The ⓘ panel was opened and its new sentence checked
against the numbers beside it (resting burn 2,063 against maintenance 2,172).

`e2e/one-calorie-budget.spec.ts` and `e2e/macro-calorie-warning.spec.ts` — the two specs covering
this card — pass. Full unit suite 875 files / 8,225 tests green; `pnpm check:rules` **Ran 71 of 71**.

**Not exercised:** the S25 APK. This is a WebView copy change with no native or offline-first path,
so a Railway deploy delivers it, but the wrapped line lengths at real device metrics are unverified —
the paragraph is three lines at 412 px in the harness.

<a id="2026-09-09-fix-or-104-supplement-dose-surface"></a>

## 2026-09-09 — A supplement stops offering two answers to one question (OR-104, surface half)

**Branch:** `fix/or-104-supplement-dose-surface` · **Lane B** · PR #1037

### What shipped

Three changes to `manage-supplements-sheet.tsx`, all of one idea: the structured amount is the dose,
and the free-text line is a note.

- **`Amount`/`Unit` come first.** Reading order was half the defect — a free-text field labelled
  `Dose` sitting above them reads as the answer, which is how a vial strength got typed into it.
- **The free-text field becomes `Note` once an amount exists**, with its placeholder changing to
  *"e.g. with food, morning only"* and a line beneath: *"The amount above is the dose. This line is
  just a note — it is not counted."*
- **The list row leads with the structured dose** and renders the free text as `Note: 10mg` beneath.
  That row was the only place the contradiction surfaced, and it showed the wrong side of it.

### The live case, and why it stayed invisible

`Retatrutide` carries `default_amount 0.5 · unit mg` **and** free-text `dose '10mg'` — the vial
strength, in the field labelled `Dose`. They disagree by **20×**. `supplementSubtitle()` falls back to
the free text *last*, so with a structured amount the nutrition list correctly read `0.5 mg today` and
the contradiction never appeared there. It showed only on the manage sheet's own row — where it
rendered `10mg`, the number the app does **not** use.

### Relabelled rather than hidden, and the reason is the live row

The entry offered both. Hiding the field once an amount is set would strand the text already in it,
and OR-104 says explicitly that existing rows are the owner's to correct by hand — a field you cannot
see is a field you cannot correct. Relabelling keeps `10mg` visible, editable, and clearly marked as
not the dose.

### Two things deliberately not done

**`definitionDose()` is not `supplementSubtitle()`**, though they look similar. The subtitle leads
with `loggedAmount` — "what did today record" — which on a definition-editing sheet would show a
number the form in front of you cannot change. Different question, so a second function rather than a
duplicated formula.

**No parser.** Comparing the free text against the amount to detect a real contradiction sounds
better and is worse: `10mg` beside `0.5 mg` is one, `with food` is not, and a guesser either misses
the real case or cries wolf on a note. *"This is a note, not the dose"* is true either way, so it says
that instead.

### Verification

8 unit tests on `definitionDose`/`hasFreeTextBesideAmount` — the live Retatrutide shape, zero as a
real amount rather than absent, an amount with no unit not rendering a dangling space, and free text
alone still being a valid dose (the pre-BF-112 shape).
`e2e/supplement-dose-note.spec.ts` drives the real sheet at 412 dp: the field is `Dose` with no
amount, becomes `Note` when one is entered, and the saved row shows `0.5 mg` with `Note: 10mg` under
it.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

`check-backlog-pointers.js` caught the first docs draft: it annotated OR-104's heading with what
shipped, and the check failed on *"these queue entries announce their own completion in the
heading"*. With both halves done, nothing was owed — the entry had to leave, not gain a note.

**Not exercised:** the S25 and Samsung WebView. And **the live `Retatrutide` row is untouched** —
this stops the contradiction being created and makes it visible; correcting that one row is still the
owner's, by design (BF-3's freeze is the point).

Patch bump — a labelling and ordering fix.

<a id="2026-09-09-fix-plan-day-fill-hour-dependence"></a>

## 2026-09-09 — `plan-day-fill.spec.ts` was red for one hour every day (Lane B)

**What this was.** `#1037`'s E2E job reported a hard failure in
`e2e/plan-day-fill.spec.ts` — a file that PR did not touch. Rather than assume it was unrelated,
the failure was reproduced locally at `e676d6c547`, the commit *before* `#1037`, where it fails
identically. So it is pre-existing and `#1037` did not cause it. `#1037` was merged on the five
required checks before the advisory E2E job finished, which is why it landed with this red.

**The fault.** The spec stubs a plan with two meals — one behind the clock and one ahead — and
asserts the offer counts exactly one. It placed them at `nowHour` and `nowHour + 1`, read from the
real clock and clamped into `00–23`:

```ts
const past = Math.max(0, Math.min(22, nowHour))
const future = Math.min(23, past + 1)
```

At `nowHour === 23` that clamp collapses the pair onto `22:00` and `23:00`. `fillableMeals` bounds
on `hour <= nowHour`, so **both** are already past, the button reads *"Log the 2 meals so far"*, and
the assertion for *"…1 meal…"* fails. It fires 23:00–23:59 Brisbane (13:00–13:59 UTC) — one hour a
day, on every branch including `main`, which is why it looked like a change had broken it.

This is the repo's documented hour-dependent-test class, in the flavour where the fixture *cannot*
be expressed against the real clock at all: there is no "an hour from now" at 23:00.

**The fix.** Drive the boundary instead of waiting for it. The page clock is pinned with
`page.clock.setFixedTime()` to noon in the user's zone on today's date, and the two meals sit at
fixed `11:00` and `13:00`. `setFixedTime` rather than `install` — the app only needs `Date.now()` to
be a known hour, and faking the timers too would stop the screen's own timeouts. The **date** stays
today's, so the day the tab opens on and the rows the spec writes are unchanged, as is the
`afterAll` cleanup that deletes them by name.

**Verification.** Run at 23:4x Brisbane — inside the exact window that used to fail — and green;
the served day was still `2026-09-09`, confirming only the hour is controlled. Mutation-checked:
dropping the `hour <= nowHour` bound in `components/nutrition/plan-day-fill.ts` fails the spec
again, so the assertion still bites. `pnpm lint` clean (0 errors), `pnpm check:rules` **Ran 70 of
70**.

**Not exercised.** Test-only change — no app code, so nothing reaches the device and no APK is
involved. The three non-Brisbane-hour paths of the old fixture are gone rather than retested,
which is the point.

<a id="2026-09-09-fix-toggle-aria-ratchet"></a>

## 2026-09-09 — A ratchet for toggle ARIA, built on a different signal than the one that failed (Q-491, Lane B)

**The residue was a judgement call, and the honest way to answer it was to measure.** Q-491 left
*"a real ratchet script, **if one is worth building**"* — the entry's own attempt at the obvious
heuristic (a file with a Chevron icon, no `CollapsibleTrigger`, no literal `aria-expanded`) matched
**34 files**, almost all back-button chevrons, and was rightly abandoned as *"a bigger version of the
same problem"*.

**What changed is the signal, not the tuning.** This one does not look at icons at all. It matches a
`set…(v => !v)` **inside an `onClick`** whose state also gates a conditional render — the shape of a
control that shows or switches something. A back-button chevron navigates and never matches; derived
state like `setLoading(!seeded)` is not in a click handler and never matches.

| detector | candidates | real |
|---|---|---|
| Chevron + no `CollapsibleTrigger` + no `aria-expanded` (Q-491's attempt) | 34 | 2 |
| click-toggled state that gates a render | 8 | 4 |
| …with the toggle required inside the `onClick`, and `aria-pressed` excluded | 1 | 1 |

**All five were fixed, so the baseline is empty.** `program-export-card`, `injury-card`,
`trophy-case` and `oura-ble-debug` took `aria-expanded` + `aria-controls` pointing at a `useId` on
the revealed region; `session-select-content`'s reorder button took `aria-pressed`. An empty baseline
is what makes this a regression check rather than a debt list — the same shape LA-19 reached for
`aestMidnight`.

**The finding that made the earlier version dangerous rather than merely noisy.** A static check
cannot tell a **disclosure** from a **mode toggle**, and the correct attribute differs.
`app/coach/coach-content.tsx` swaps the whole panel between history and composer and is already
correctly `aria-pressed`; `session-select-content` put the sections into reorder mode and had
neither. A check that said *"add aria-expanded"* would have pushed the wrong attribute onto both,
and a wrong ARIA state is worse than a missing one. **So the check reports the question** — reveal a
region, or turn a mode on — and its failure text says so instead of prescribing.

**Verified by being made to fail.** A probe component with the bare shape fails it; the same file
with the attribute passes. Reverting `trophy-case`'s fix did *not* fail the branch, which is correct
and worth recording — `verdict()`'s inherited rule spares debt the base branch already carries, so
proving the check bites needs a *new* violation, not a restored old one.

**And an e2e for the half a static check cannot reach.** `toggle-aria-state.spec.ts` asserts the
value **flips**: a toggle hardcoded to `aria-expanded={true}` on both branches passes every grep and
tells a screen reader nothing. Mutation-checked by pinning `aria-pressed={false}` — the spec fails.

**Also recorded:** Q-300's residue was gated on the owner in prose (*"once the owner has seen the
framing"*), so the queue tool offered it as startable UI work. It is now a `Gate: owner` field, with
the framing on it — the coaching line is *"your rest ignores the plan"*, not *"you rushed today"*,
because 40% of every session rushes.

**Not exercised.** TalkBack, which is Q-491's remaining `Keep:`. An attribute being right in the DOM
is not the same as the announcement reading well, and nothing in the sandbox can hear it. No user-
visible change, so no version bump.

<a id="2026-09-09-la95-measure-rest-prescription-divergence"></a>

# 2026-09-09 — measuring the two rest prescriptions, and fielding my own queue head (LA-95)

**PR:** `lane-a/la95-measure-and-gate` · **Lane A** · docs only, nothing implemented.

## I filed LA-95 an hour earlier and it went straight to the top of my own queue

The entry says, in its own words, *"filed rather than fixed: changing it moves numbers the owner
already reads, so it is a decision, not a tidy-up"*. It then printed as **READY (1)** on the next
`next-item.js` run, because I gave it no `Gate:` field.

That is exactly the trap #1047 existed to fix — `next-item.js` classifies on the `Keep:`/`Needs:`/
`Gate:` **fields**, not on prose, so an entry that says "do not start this" in a sentence still heads
the work list. I fixed it for four other entries that morning and then reproduced it myself the same
day, on an entry I wrote *because* I understood the distinction.

**Writing the reason in the body is not filing.** The field is the interface.

## The measurement the entry demanded, taken rather than deferred

LA-95's last line asked for *"how many sessions change before shipping it"*. Rather than only add the
gate, that number is now on the entry — a gated decision with no evidence is a question the owner
cannot answer.

Against production, over the route's own 90-day window, sets carrying both rest columns:

| | |
|---|---|
| Sets where the two prescriptions disagree | **231 of 442 (52%)** |
| Sessions whose adherence percentage moves | **28 of 36 (78%)** |
| Mean shift | **11.2 points** |
| Max shift | **31 points** |
| **Sessions crossing a bucket boundary** | **14 of 36 (39%)** |

Every set had a live style to compare against, so none of the disagreement is missing data.

**The bucket-crossing number is the one that matters.** The view renders `<70 / 70–90 / 90–115 /
115+`, so 14 sessions moving bucket means the chart visibly redraws and the `insight` sentence is
re-derived from different bars.

## What it settles, and what it deliberately does not

It settles that this is not a rounding correction, so "fix it quietly" is off the table.

It does **not** settle which number is right, and the entry now says so. The logged snapshot is the
honest record of what the plan asked at the time; today's style is what the owner is actually
training to. For a trend asking *"does resting to plan go with lifting better?"* both readings are
defensible, and only the owner knows which question they read the chart for. That is why it is
`Gate: owner` rather than a bug I should have fixed while I was in the file.

**Not exercised:** nothing was implemented. The numbers come from `claude_ro` over production, which
is row-scoped to the owner — so they describe the owner's training, which is the only training this
chart draws.

<a id="2026-09-09-lb24-delete-orphaned-load-comparison"></a>

# 2026-09-09 — deleting the orphaned load-comparison chart, route and cache line (LB-24)

**PR:** `lane-a/lb24-delete-orphaned-load-comparison` · **Lane A** · deletion only, no migration.

## What went

- `components/health/workout-load-comparison-chart.tsx` — zero renderers since Q-112a removed
  `day-review-sheet.tsx`, its only one.
- `app/api/workout-load-history/route.ts` — zero client callers since the same change.
- The `workout-load-history:` line in `invalidateWorkoutSummaries()` (`lib/cache-groups.ts`), which
  had been clearing a key nothing wrote or read.

The entry told me to verify the call sites at the head I delete from rather than trust its note, and
that was right to insist on: the grep found a **test file the entry never mentioned**.
`lib/__tests__/strength-trend-routes.test.ts` covered two routes, and only one of them survives, so
it is now `lib/__tests__/exercise-estimates-route.test.ts` with the load-history half removed. That
is deleting a test alongside the source it tested, not quarantining a test to get green — the
distinction matters and the file's header comment now records where the other half went.

## Why delete rather than re-home

LB-24 deliberately parked itself behind Q-112d, because a tidy-up before the trends phase would be
work that phase might undo. Q-112d shipped and re-homed nothing. It did not reuse the route either:
`/api/day-review/week-window` derives session volume itself from `getWorkoutSessionsFrom`, so
Q-112c's plan text about reusing `/api/workout-load-history` described an intention the shipped route
did not follow. Nothing was left that might rescue either file.

## A stale count found on the way, and not replaced with another one

`projectOverview.md`'s Q-489 entry listed `workout-load-history` as one of three rolling-instant
sites among "12 instances" of the ms-offset shape. The route **as deleted** read
`dateStrMidnightInTz(shiftDateStr(todayInTz(tz), -90), tz)` — the *anchored* form, not the banned
offset the 2026-08-18 review recorded. So it had stopped being an instance some time before it was
removed, and at least one of the 12 was already stale for a reason that has nothing to do with this
deletion.

I first wrote "the count is 11 now, not 12" and that was wrong twice: I had not measured the current
count, and the site I removed was not one of them anyway. The line now says the number is stale and
wants re-measuring, and asserts no replacement — an unmeasured count in an orientation doc is how a
false finding gets born.

## Verification

No mutation pass: there is no new behaviour to mutate. The gate is that nothing references what
went. `pnpm check:rules` 71 of 71 (which includes "every API route has a test that imports its
handler" — the deleted route no longer owes one), full suite green, typecheck clean.

**Not exercised:** nothing on-device. Deleting a component with no renderers and a route with no
callers cannot change a rendered surface, which is the same fact that made it safe to delete.

<a id="2026-09-09-lb57-shared-supplement-day-totals"></a>

# 2026-09-09 — one implementation of the day's supplement exposure (LB-57)

**Branch:** `lane-a/lb57-shared-supplement-day-totals` · no migration, no user-visible change.

## Why there were two

`listSupplements` (the Postgres adapter) derived the day's totals on read, and **the device never
reaches that code**: the nutrition page's local-first branch returns early once the local store has
definitions, so BF-112 had to derive the same three rules again from `getSupplementLogs`. The
correct single home is `packages/shared/`, and both `packages/shared/**` and `lib/data/**` are Lane
A's — which is exactly why the lane that created the second copy filed this instead of hoisting it.

`summariseSupplementDay` now lives in `packages/shared/src/nutrition/supplement-day-totals.ts` and is
called by both. Placed in `nutrition/` rather than the entry's suggested `supplements/` because
`supplement-dose-freeze.ts` for the same domain already lives there; a new directory for one file
beside its sibling is worse than the entry's path is right.

## What the hoist had to reconcile

The two copies were not identical, and the difference is the one worth recording:

- The adapter tested `l.source === 'manual'`; the client tested `(l.source ?? 'manual') === 'manual'`.
- **Checked rather than assumed:** `supplement_logs.source` is `NOT NULL DEFAULT 'manual'` in
  Postgres, so the strict form never encountered a null server-side and the two agreed. The
  divergence only exists locally, where the row type marks `source` optional — every writer
  predating BF-69 omits it and `upsertSupplementLog` defaults it.
- The shared version takes the **tolerant** form. It is what lets one function serve both, and it
  changes nothing on the server.

The adapter also derived `loggedDose` — the manual row's own frozen dose — which the client copy did
not need. That moved into the shared function too rather than staying behind, so the manual-only rule
is stated once instead of twice.

## Verification

Ten of ten real mutants caught; one deliberately equivalent control (the `out.set` after mutating an
object already in the map) survived as expected. The adapter mutants are caught by **server-side**
tests and the shared-function mutants by the client's, so the hoist is load-bearing on both sides
rather than merely compiling.

**One mutant survived the first pass, and it is the classic fixture trap:** the unit's first-wins
rule. The existing "sums every live contribution" case used `'g'` on both rows, so first-wins and
last-wins agree there and neither is tested by it. Three cases added — two contributions that
disagree on the unit, a first contribution carrying no unit at all, and a day where a meal
contribution must not become the `loggedDose` the page unticks.

The test file stays at `components/nutrition/__tests__/supplement-day-totals.test.ts`, pointed at the
shared version: its cases were written against the adapter's semantics on purpose, so they are the
right ones to hold the shared function to. `applyManualToggle` stays in `components/` — it is the
page's optimistic update with no server analogue.

**Not exercised:** the APK. No behaviour changed on either path, so there is nothing new for the
device to show, but the device is the only place the local branch actually runs.

<a id="2026-09-09-lb64-weekly-month-window"></a>

# 2026-09-09 — a monthly window for the weekly recap (LB-64)

**PR:** `lane-a/lb64-weekly-month-window` · **Lane A** · no migration, no client change.

## What it is

`GET /api/weekly-review/month-window` — five weekly buckets of the four metrics
`/api/day-review/week-window` already serves daily (resting HR, steps, session volume, weight),
plus `priorAverages` over the four completed weeks before the judged one.

## Why a new route rather than widening `weekly-digest`

LB-64's own recommendation, and it held up on re-verification against `main`. `/api/weekly-digest`
computes all these numbers and throws them away, returning `{ digest, weekStart }` — so returning
them beside the prose is genuinely the cheaper change. It was still the wrong one: that route is a
**POST that runs an LLM**, rate-limited and cached as prose, and Q-293's own source comment says the
digest is deliberately re-derived because a late ring back-fill changes its inputs. A chart wants
freshness on a different clock from a paragraph. So: a cacheable GET with its own TTL, no model in
the path, `Cache-Control: private, no-store` like every sibling.

## The two rules that are easy to get backwards

- **Daily metrics are meaned across the week; session volume is summed.** Several sessions share a
  week, so a `Map.set` per session is last-write-wins — it reports the *last* session's volume as the
  week's. Mutation-verified: last-write-wins reads 500 where the week is 1500.
- **A week with no rows is `null`, never `0`.** Zero steps and no recorded steps are different
  claims, and the render draws them differently.

`weekStart` snaps any day to its Monday, defaults to the **last completed** week (never the
in-progress one, which would average a partial week against four full ones), and goes through
`normalizeDateParamIso` — a malformed param is a 400, never a silent substitution.

## Verification

Eight cases, mutation-tested with eight mutants: seven caught, one control. The control —
a second `inWindow.has(key)` guard on the volume loop — survived because it was genuinely dead:
the explicit `day < from || day > to` check above it already bounds the window, and `from` is a
Monday by construction, so every day in range maps to a known key. It was **deleted, not kept**.

One mutant (M5, the volume-summing rule) first reported `SKIP: anchor count 0` — an indentation
mismatch in the anchor string, not a passing mutant. A skipped mutant is not a caught one; it was
re-run with a corrected anchor and caught. Worth stating because the summary line looks the same
either way at a glance.

The test file pins `TZ = 'Etc/GMT-10'`, a fixed offset, so the week-bucketing case fires on every CI
run rather than only inside some window of the day.

**Not exercised:** nothing on-device — this is a server route with no client reader yet. Q-112e is
the consumer and is Lane B's.

<a id="2026-09-09-lb66-program-session-tombstones"></a>

# 2026-09-09 — a removed training session is now tombstoned, not deleted (LB-66)

**Branch:** `feat/lb66-program-session-tombstones` · migration **271**, shipping alone.

## What was actually wrong, beyond "no `deleted_at`"

There is no delete endpoint for a program session. Removing one is expressed as *saving the program
without it*, and `saveProgram` hard-deleted **every** session and session-exercise of the program
inside a transaction and re-inserted them, round-tripping the client's ids. So the deletion was
never a `DELETE` anyone could point at — it was an absence from the re-insert.

That mattered more than the missing recovery path, because two FKs fired on the way out:

- `workout_sessions.session_id` **and** `program_session_id` are `ON DELETE SET NULL`, so months of
  logged workouts were severed from the session they were trained under.
- `session_periodization.program_session_id` is `ON DELETE CASCADE`, so the removed session's
  phase and cycle state was destroyed outright.

Both now survive, because nothing fires on a tombstone.

## The unique constraints are why this is a constraint swap, not an `ADD COLUMN`

`program_sessions (program_id, position)` and `session_exercises (session_id, position)` were plain
`UNIQUE`. Delete the middle session of three and the client re-saves the survivors compacted to
positions 0 and 1 — while the tombstone still holds position 1. **Every deletion of a non-last
session would have been a `23505`.** Migration 271 drops both constraints and recreates them as
partial unique indexes `WHERE deleted_at IS NULL`, which is the standard soft-delete shape and keeps
the constraint exactly where it still means something. Nothing is dropped, no existing row fails the
new predicate, and a corrective migration can put the constraints back.

## The split, and the one reading that would have shipped the bug

Replacing the two `delete`s with a soft delete tombstones the **whole program on every save** — the
failure the entry was reconciled to name. What is real is only the ids that do *not* come back:

```
removed  = live rows whose id the save did not supply   -> tombstone
replaced = any row (live or tombstoned) the save supplied -> hard delete + re-insert
```

`replaced` spans tombstoned rows so a **resurrection** works: saving a removed session's id back
deletes the tombstone first, then re-inserts on the same primary key. That also forced the RV-34
"belongs to another program" guard to widen from live ids to *all* of this program's ids — otherwise
a resurrection reads as someone else's session and 409s.

## Two things the FK used to do for free

- **Schedule days.** `schedule_days.session_id` is `ON DELETE SET NULL`; the delete cleared the slot
  and the tombstone does not. Two separate guards cover two separate cases, and mutation testing
  confirmed neither is redundant: an explicit clear (for a save that omits `schedule` entirely, where
  the rebuild below never runs) and a filter on the schedule re-insert (for a stale client that names
  the session it is removing in the same save).
- **The workout-link restore.** The capture of orphaned workouts narrowed to `replaced` only. Left at
  the old "all live ids", the pre-id **position fallback** re-attributes a removed session's workouts
  to whichever session compacted into its slot — a mis-attribution, not a preservation.

## No local SQLite change, and the reason is worth keeping

The pull delta re-sends a changed program's whole subtree and the client **deletes every child by
program id before re-inserting**. So filtering the delta to live rows is the entire propagation
mechanism: a tombstoned session is simply absent from the replacement and disappears on the device.
No `deleted_at` in the mirror, no v39.

That works only while every tombstoning write bumps `programs.updated_at`, which is what puts the
program in the delta at all. `saveProgram` already did; the two single-row removal paths
(`removeSessionExercise`, the Coach's `removed` patch) did not, and now do. **Without that bump the
tombstone would be strictly worse than the hard delete** — invisible on the server *and* never
propagated.

## Read sweep

`deleted_at IS NULL` added to the program read (`listPrograms`, both levels), the save's own
`oldSessions`, the ownership lookup behind `removeSessionExercise`, the legacy-workout name map in
`countAllSessionsSinceStart`, `listSessionPeriodizationForProgram`, `clearProgramPrescriptions`, the
`reconcileSessionsInPhase` raw SQL, the Coach's `loadTarget`, the injury and program-phase exercise
reads, and both halves of the sync delta.

Deliberately **not** filtered: the workout-history joins that read a session's *name* for an already
logged workout (a tombstone now supplies it where the old hard delete forced a fallback), the
`programId`-scoped workout-history subqueries (workouts trained under a since-removed session still
belong to that program), and the data export (recovery is the point).

## Verification

14 cases in `lib/data/postgres/__tests__/program-session-tombstone.test.ts`. Mutation pass: **15 of
15 real mutants caught**, one deliberately equivalent control (removing an outer length guard whose
two inner branches are already length-guarded) survived as expected. Three mutants survived the first
pass — the schedule clear, the exercise-level read filter, and the workout capture — each a real gap,
each now separated by its own fixture rather than by an assertion added to a fixture that could not
tell the two guards apart.

## The green local suite was wrong twice, and CI caught the second one

**`claude_ro` views are an explicit column list, so a new column is invisible until they are
rebuilt.** Migration 271 added two; `db-snapshot-integration.test.ts`'s drift check exists to catch
exactly that, and it **skips locally** — it gates on `isTcpUrl(DATABASE_URL)` because it provisions a
real read-only role over a password login, and the value the container provisions is the Unix-socket
form. So the local suite ran 27 fewer tests than CI and the `Tests` job went red on a green local
run. Migration **272** is the regenerated views; diffed against 268, it differs by exactly
`program_sessions.deleted_at` and `session_exercises.deleted_at` and nothing else.

Reproduced before fixing, per the drive-to-green rule: the same file over
`postgresql://postgres:postgres@localhost:5433/trainingai_dev` fails with CI's exact message, and
passes with 272 applied (37 of 37 across all four `claude_ro` files).

## A false green found on the way, worth more than the entry it interrupted

`pnpm ci:local` from a session shell reported **678 passed / 191 skipped files** and exited 0 — while
the same tree run as `DATABASE_URL=… pnpm test` reported **862 passed / 5 skipped** and surfaced
**four real failures**, including in this PR's own new file. The container provisions `DATABASE_URL`
pointing at production, so `session-start.sh` unsets it (correctly — otherwise `pnpm dev` talks to
prod), and nothing in `vitest.config.ts`/`vitest.setup.ts` loads `.env.local` back. Every DB-backed
file then hits `describe.skipIf(!canRun)` and skips silently; the skip count is the only tell.
Recorded in [`docs/local-dev-database.md`](../local-dev-database.md) with both measurements, and
beside it the socket-vs-TCP gap above — **the local command to trust is
`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev pnpm test`**, which is
what closes both.

**Not exercised:** the APK. This is server-side only, so it reaches the device through a Railway
deploy with no rebuild — but the on-device sync that turns a tombstone into a disappeared session in
the config editor has not been run on hardware.

<a id="2026-09-09-lb67-weight-rate-day-index"></a>

# 2026-09-09 — the weekly weight rate was measuring per weigh-in, not per day (LB-67)

**Branch:** `fix/weekly-weight-rate-day-index` · **v1.441.5** · user-visible.

`computeWeightRateKgPerWeek(weights: number[])` fitted `x = the array index` and multiplied the
slope by 7 as though the readings were one day apart. Rows exist only on days carrying a metric and
the owner weighs in about three days in four, so the slope was *per reading* and reported as *per
day*.

On a 14-day window with a true trend of −0.70 kg/wk: 10 readings reported **−1.04** (1.48× over), 6
reported **−1.76** (2.51× over).

**That changed what the screen said, not just the digits.** `evaluateWeightRateVsGoalBand` calls
anything past 1.0 kg/wk `too_fast`, so an ordinary, healthy −0.70 rendered on Health → Body as
**"Faster than ideal pace"** in amber.

## One formula, not two

The correct version already existed one directory away: `adaptive-tdee.ts` fits against the
weigh-in's day index and its comment names this exact failure. So the app held **two** weekly
weight-rate figures, computed differently, disagreeing by about 1.5× on the same data, on two
screens — which is what the One Formula rule is for.

Both now call `computeWeightRateFit`, which takes dated points, sorts them, drops null weights and
fits against days since the first weigh-in. (Only differences in x affect a slope, so a first-weigh-in
origin and a window-start origin agree — and this one needs no window handed in.)

**Verified before converging, not assumed:** `adaptive-tdee`'s day index is only a *day* index if its
caller supplies contiguous days. `energy-balance-service.ts` builds them with
`for (let d = windowStart; d < date; d = shiftDateStr(d, 1))`, so it does. Had it been gappy, the
"correct" sibling would have carried the same bug in a subtler form.

**Sibling sweep**, per the same rule: the only other `linearFit` callers are `projectRm`, which is
already day-spaced and is about 1RM, and `classifyTrend`, which is index-spaced *by design* with a
comment saying so and pointing dated series elsewhere. Two figures became one; there is no third.

## The standard error, added deliberately

OR-102b ④ was blocked on this formula and needs the *interval*, not the point estimate. Adding
`stdErrKgPerWeek` in the same pass is what stops ④ inventing a third estimator — which is the bug
class that produced this one. That entry is rewritten from "blocked on LB-67" to unblocked.

## The mutation pass found six survivors, and every one was a real gap

The worst score of this sweep, and worth recording rather than smoothing over:

- **The sort was untested.** A least-squares slope is order-invariant, so asserting the rate on a
  scrambled fixture proves nothing about sorting. The sort is load-bearing for `spanDays` (and the
  x origin), which is what the case now asserts.
- **The standard error's units were untested.** "Noisier is larger" holds whether or not the per-day
  error was scaled to per-week, so dropping the ×7 survived. Now pinned to a computed 0.241868.
- **The display rounding was untested.** Every fixture had a truth of exactly −0.7, where rounded
  and unrounded agree — the equal-values trap. A −0.49 case now separates them.
- **The unrounded-slope property was untested in `adaptive-tdee`**, which is the thing my own comment
  claimed mattered. A −0.9 kg fortnight now pins 2533 against the 2528 the rounded weekly rate
  would give.
- **One survivor was an equivalent mutant, checked rather than assumed.** A separate `Number.isNaN(day0)`
  guard is unreachable: a bad `day0` makes every x NaN, which the next guard already catches. The
  dead branch is deleted.

**And a correction to my own comment.** It claimed rounding the weekly rate first would move a
maintenance estimate "by up to ~55 kcal/day". The real bound is **~5 kcal/day**
(0.005 kg/wk ÷ 7 × 7,700), and the measured example moves 5. Both comments now state the measured
figure, and say plainly that the reason to keep the slope unrounded is not the size of that error but
that a display decision should not reach the kcal arithmetic.

**16 of 16 caught** after the fixes; the seventeenth is an equivalent mutant planted as a control.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean · **Custom Rules
70 of 70** · `pnpm build` clean · full suite **866 files, 8156 passed, 0 failed** · `adaptive-tdee`'s
own 31 cases unchanged, which is what "converged without moving its numbers" means.

**Not exercised:** no device. The Health → Body band is asserted through
`evaluateWeightRateVsGoalBand` in a unit test, not seen on a screen — **the amber "Faster than ideal
pace" has not been observed turning green on the S25.**

<a id="2026-09-09-lb98-rest-adherence-set-pairs"></a>

# 2026-09-09 — a read path for data that only existed on the device (LB-98)

**PR:** `lane-a/lb98-rest-adherence-set-pairs` · **Lane A** · no migration, no client change.

## What the gap actually was

Not a product bug. `set_logs.planned_rest_sec` is the snapshot of what the plan asked when a set was
logged, it lives in the device's local store, and **no route published it**. The canonical runtime is
the APK, where the store is present and the Rest-vs-plan card works. What was lost is *verification*:
in a browser — and therefore in CI — the card could only ever render its empty state, so its
rendering path shipped unexercised and arrived owing a device check. LB-98 was filed after that
happened twice in one session on unrelated features.

`/api/health-trends?view=rest-adherence` now returns `restSets`: per-set
`{ plannedRestSec, restTimeSec }`, shaped as the card's own `RestSet` so its fallback is a swap into
the same `restByPrescription` rather than a second aggregate that could disagree.

## The distinction that took the most care

**The pairs are the LOGGED columns; the buckets in the same response are not.** The correlation
derives `prescribedRestSec` from `listProgressionStyles(userId)` — the style as it is *now*. The card
deliberately reads the snapshot, because *"a later style edit would silently rewrite what
'prescribed' meant for a past set"* (its own comment).

Emitting the live-style value would have looked consistent with the bars beside it and answered the
wrong question. Mutation-pinned: swapping the logged read for the live style is caught.

That the two halves of one response now come from two sources is a real finding, so it is filed as
**LA-95** rather than fixed here — changing the bars moves numbers the owner already reads, which
makes it a decision rather than a tidy-up.

## Small rules, each with a reason

- A prescription of **0** is dropped: "no rest planned" is not a target, and dividing by it is how a
  ratio becomes Infinity.
- A rest **taken** of 0 is kept: that is a real measurement (the set that ran straight into the
  next), and discarding it biases the mean upward — the opposite of what the card reports.
- Only sets carrying both halves are emitted. `restByPrescription` discards the others anyway, so
  sending them is payload for nothing, and a half-pair reaching that helper looks like a measurement.

## Measured rather than assumed

Production, while building: of 1,189 set logs, **462** carry `planned_rest_sec`, **838** carry
`rest_time_sec`, **442** carry both — all inside the route's 90-day window (841 sets). So the column
started being written recently and covers ~53% of the window. Worth publishing; nowhere near safe to
assume present.

Worth noting that the local seed has **27 set logs and zero of either column**, so the realistic case
could not have been checked locally at all — which is the very gap this entry is about, met while
closing it.

## Verification, and a correction to my own mutation run

Five real mutants, all caught (half-pairs, zero prescription kept, zero rest-taken dropped, live
style substituted for the logged snapshot, field never emitted).

The control — renaming a local accumulator — first reported CAUGHT, which would have meant the tests
were failing on something with no behavioural difference. Reproducing it by hand shows it **survives**
cleanly: the harness had mis-applied the rename. A control that fails to build proves nothing, so it
was worth the minute to tell those two apart rather than recording a number that looked stricter.

## A local-environment trap this session created for itself

The first full run on this branch reported **7 failures across 4 files** — none of them LB-98's. The
local database still carried Q-44's table rename (migrations 273/274, applied to verify that branch),
so it matched no branch's code: `main`'s export map and catalogue reads name tables the database had
renamed underneath them.

**The tell was the shape rather than the count.** This branch's own tests passed 46/46 while
unrelated export and catalogue tests failed — a failure set that carefully avoids the thing you
changed is evidence about the environment. Read the other way, it costs a rework of code that was
fine. Reverting also needed an order (`DROP SCHEMA claude_ro CASCADE` first, because the `claude_ro`
views depend on the compatibility views). Both are now in
[`docs/local-dev-database.md`](../local-dev-database.md), which already catalogues two other ways
a local result can lie.

**Not exercised:** the card itself. Wiring its fallback is `components/**` and therefore Lane B's;
the read exists, nothing consumes it yet, and the verification gap is not closed until that lands.
That is recorded as a `Keep:` on the entry rather than implied.

<a id="2026-09-09-or104-supplement-dose-freeze"></a>

# 2026-09-09 — a supplement froze two contradicting doses; the engine half is fixed (OR-104)

**Branch:** `fix/or104-supplement-dose` · engine half only; the sheet is Lane B's.

`Retatrutide` carried `default_amount 0.5 · unit mg` **and** free-text `dose '10mg'` — the vial
strength, typed into a field the edit sheet labels `Dose`. Every log froze both, 20× apart, and the
2026-09-07 log already has. Invisible, because `supplementSubtitle()` reaches for the free text
last: the list read "0.5 mg today" while the archive kept the wrong number for every later reader,
including the dose tracker OR-102a/b will build on it.

Both write paths now freeze the definition's free text **only when no structured amount was
resolved**. Existing rows are untouched on purpose — the freeze is the point of BF-3, and the live
row is the owner's to correct by hand.

## One rule, because there are two write paths

The server (`adapter.ts`) and the offline store (`sqlite-backend.ts`) both stamp a dose, and a log
written offline must not disagree with one written online. The decision lives in
`freezableDoseText` (`packages/shared/src/nutrition/supplement-dose-freeze.ts`) and both call it.

**That was not tidiness — it was the only way to test the local path.** The local suite asserts
against **source text**: it greps `sqlite-backend.ts` rather than running it, because `getLocalStore`
returns null under node. So my change to that file passed its entire suite untouched, and a mutant
reverting it survived. Moving the rule into shared code put it somewhere a test actually executes;
the local suite then gets a delegation assertion, which is the half that catches the wiring being
undone. Neither alone is enough.

## What the fixtures had to be

The existing BF-3 tests all used a definition whose free text **agreed** with its structured amount
(`dose: '2 mg'` beside `defaultAmount: 2`). That is the equal-values trap: with the two agreeing,
nothing distinguishes "stamped the prose" from "stamped the number", so those cases could never have
caught this. The new case uses the production shape — `0.5` against `'10mg'` — where only one answer
is possible.

Five existing assertions changed from `dose_text: '2 mg'` to `dose_text: null`. **The freeze is not
weakened**: for a supplement with a structured amount it now rests on `amount`+`unit` alone, and the
case that made BF-3 urgent — a supplement carrying *only* free text — still freezes it, untouched.

My own new test then caught a gap in my own helper: `''` came back as `''`. The two paths had
already disagreed there before the shared function existed (the local store used a truthy check, the
server `?? null`), so blank and whitespace-only now count as absent.

## Found, and deliberately not fixed here

**LA-90 — the two paths merge a caller-supplied dose differently.** The server merges per field
(`dose?.amount ?? owns.defaultAmount`); the local store is all-or-nothing, reading the definition
only when amount, unit and doseText are *all* null. A caller supplying only `amount` gets the
definition's unit on the server and null offline. No caller does this today, which is precisely why
it is a trap for the next one. Left out because bundling a second divergence into a dose-text fix
would have made both unreviewable.

**LA-91 — no CI job sets `timeout-minutes`.** Filed with measured durations, and the near-miss is
the useful part: a check-in of mine asserted "25 minutes is beyond plausible" for the E2E suite; the
real run took **24:36**. Acting on that guess would have re-triggered a healthy run two minutes
before it went green. Reading `playwright.config.ts` — 77 specs at `workers: 1` — answered it in a
minute, and the reason nobody knew is that most PRs skip E2E in ~35s via its UI gate.

## Mutation pass

**8 of 8 caught** after the two fixes above; the ninth is an equivalent mutant planted as a control.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · **Custom Rules 70 of 70** · full suite
**867 files, 8166 passed, 0 failed** · `check-backlog-pointers` OK (334 entries).

**Not exercised:** the local SQLite path does not run in this sandbox, so its behaviour is covered
only through the shared function plus a source-level delegation assertion — **not on a device**. No
migration. The manage sheet is unchanged, so a user can still type a contradicting free text into a
definition; only what a log freezes has changed.

<a id="2026-09-09-ps39-final-routes-and-close-out"></a>

# 2026-09-09 — PS-39 closed: 0 of 222 routes uncovered

**Branch:** `test/final-ps39-routes` · **No product change.**

28 cases over the last three — `admin/battery-recovery-calibration`, `oura/hr-sync` and
`workout/backfill-set-hr-stats` — and the entry struck.

**The ratchet's baseline is now 0**, which is the end state it was built for: a new route arrives
uncovered and fails CI rather than joining a debt pile.

## `oura/hr-sync` is not what its path says

Checked before writing anything, because the Oura Cloud integration was removed on 2026-08-13 and a
route under `oura/` called `hr-sync` looks like a leftover.

It is not. The Cloud call is gone — the ring has been on our own BLE key since the 2026-07-07 re-key,
so that request could only ever earn a 401 — and the route is now a thin wrapper over
`syncAndAttributeSessionHr`, which attributes HR the BLE pipeline has **already ingested**. Live code
with a stale name.

**What it has none of is callers.** Every remaining reference across `app/`, `components/`, `lib/`
and `android/` is a comment or a test asserting it is *not* called: `complete-workout` used to POST
to it server-to-self, burning a second request worker and a second pool connection per completion
and failing outright ("fetch failed") nine times in production, until Q-122 replaced that with a
direct call. The route was left behind.

Filed as **LA-89**, tested and pinned rather than deleted. An HTTP endpoint can have callers this
repo cannot see — a curl in a runbook, a Tasker profile, an old APK — so the safe order is to confirm
nothing external uses it and *then* remove the route and its test together. That is the owner's call,
and it costs nothing to leave a tested 50-line route until someone answers.

The behaviour worth knowing, now pinned: **it answers `success: true` even when the pipeline
throws.** Deliberate — it was fire-and-forget from workout completion, and failing there would fail a
completed workout over heart-rate data the ring frequently has not drained yet. `readings: 0` carries
the truth; the flag does not.

## The sibling that deliberately has no lead-in

`battery-recovery-calibration` reads the same shape as `sleep-feel-calibration` and fetches **no**
extra history, where the sleep one fetches 28 days more than it reports on. That is right: battery
`end_value` is read as persisted, never recomputed, so the panel checks what the app actually served
rather than what a fresh run would produce — and a lead-in would be fetching rows it has no use for.
A mutant that adds one is caught, which is the only way that distinction stays true.

## Closing the entry

The count was PS-39's whole claim and it is 0, so no `Keep:` line: leaving a finished entry in the
queue to carry a caveat is what the "a finished entry must not still be in the queue" rule exists to
stop.

**But the entry carried a checklist that outlives it**, so it moved rather than vanished →
[`docs/route-test-fixtures.md`](../route-test-fixtures.md): the fifteen fixture shapes that
passed review and were caught only by mutation, and what the ratchet does and does not measure. It
is linked from `docs/module-map.md` and named in the checker's own failure message, which is where
someone writing a new route test will meet it rather than having to know it exists.

The caveat that belongs there rather than in the queue: **a count is a floor on attention, not a
measure of it.** An import is not a test of behaviour — `admin/exercises` counted as covered on a
single guard assertion. No sufficiency check is proposed, because the threshold would be
indefensible.

## Mutation pass

**30 of 30 caught**, no anchor misses; the thirty-first is an equivalent mutant planted as a control
and survived as designed.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean · **Custom Rules
70 of 70** · `pnpm build` clean · full suite green · route ratchet **3 → 0**, verified by running the
checker · backlog baseline lowered 19,732 → 19,684.

**Not exercised:** the calibration builder, the HR computation and the attribution pipeline are all
stand-ins. No SQL, no ring, no device.

<a id="2026-09-09-q1a-auth-precondition-correction"></a>

# 2026-09-09 — a stale security precondition that inverts when you fix it (Q-1a)

**PR:** `lane-a/q1a-correct-auth-precondition` · **Lane A** · docs only, nothing implemented.

Q-1a (client bearer auth) is startable — no `Gate:`, no `Needs:` — and its "read first" line names the
sharpest of three auth preconditions: that `isActive === false` is enforced **only** in
`middleware.ts:18`, so a client talking to the API directly bypasses the deactivation check.

**That is stale, and the way it is stale is the dangerous kind.**

## What changed, and why "fixed" is the wrong conclusion

LA-58 shipped on 2026-09-04. `middleware.ts`'s matcher excluded `api` as its first term; it now
excludes `api/auth` only, so `/api` requests reach the gate at `middleware.ts:33-38` and a deactivated
session is answered 403.

An implementer who checks the correction against `main`, sees LA-58, and marks the precondition
discharged has read it correctly and concluded wrongly. **The hazard did not go away; it changed
shape, and Q-1a is the exact change that re-opens it.**

The gate is `if (req.auth && req.auth.isActive === false)`. `req.auth` is the **cookie** session — the
comment two lines above says so outright: *"a session-less request falls straight through, so they
still answer their own 401 and signature-authenticated ingest keeps working."* That is deliberate and
correct today, because there is no bearer path at all: grepping `auth.ts` for `Authorization`/`Bearer`
finds nothing. **Nothing bypasses anything right now.**

Q-1a's whole purpose is to build a client that authenticates *without* the cookie. The moment it
lands, a deactivated user holding a valid bearer token reaches every `/api` route with `req.auth`
empty, and the 403 never fires.

## What the entry now says instead

Not "check whether LA-58 fixed it" but: whatever resolves a bearer token must enforce `isActive`
itself, at the point it establishes identity, and a test must pin a deactivated bearer holder getting
403 rather than 200. Enforcement living in middleware and keyed on a cookie cannot cover a client
built not to send one.

## Why this is a docs PR and not the feature

Q-1a is auth, which CLAUDE.md places in the confirm-first carve-out, and it is a substantial build
(bearer client plus an `apiUrl()` indirection across every fetch). Q-44 Phase 3 PR 1 is already parked
awaiting an owner decision; a second large gated branch waiting beside it is not obviously useful.
What *is* useful now is that the entry stops carrying a precondition whose plain reading leads to a
deactivation bypass.

**Third stale factual claim found in a backlog entry today** — after Q-91-followup (which hid a live
bug) and Q-50 (which cited a safety net removed months earlier). All three were found by working the
entry rather than reading it. This one is the first where the staleness was *security*-relevant, and
the first where the correct-looking fix is what makes it dangerous.

**Not exercised:** nothing implemented; no code changed. The claims here are from reading
`middleware.ts` and `auth.ts` on `main` at `a7dd2a00`.

<a id="2026-09-09-q50-bdi-weights-manifest"></a>

# 2026-09-09 — "keep them" is only a decision if something uploads them (Q-50 item 2)

**PR:** `lane-a/q50-bdi-weights-manifest` · **Lane A** · no migration, no client change.

## The gap

The owner decided on 2026-08-03 to keep the two BDI weight files (`sleepnet_bdi_0_3_0_core.onnx`,
`sleepnet_bdi_0_4_0_core.onnx`) rather than delete them — extracted assets that cannot be re-derived
from this repo, and a future BDI revision is exactly what would want them.

**Nothing acted on that decision.** The `.onnx` files are gitignored and live in object storage;
`model-files.json` is the manifest that decides what gets uploaded there, and the BDI weights were in
neither its `required` list nor any other. Their *constants* were listed. The weights were not. So
"keep them" was a sentence in a backlog entry with no mechanism behind it, and the next rebuild of
the bucket from this manifest would have quietly dropped them.

They could not simply go in `required`: that list is what the boot check demands, and
`required-models.test.ts` asserts it equals exactly the set of `.onnx` literals in `inference/`.
Adding an unloaded file there would both fail that test and turn a healthy deployment into a reported
fault.

## What shipped

A second list, `keptNotLoaded` → `KEPT_MODEL_FILES`. `scripts/upload-model-assets.js` sends
`required + kept`; the boot check reads `required` alone and ignores the rest. Two tests hold the
distinction in both directions: kept ∩ required = ∅, and no kept file is named by an `inference/`
loader — so a file that *gains* a loader must be **moved** rather than left in a list nothing
verifies. Four mutants, all caught (folding a kept file into `required`, emptying the list, listing a
loaded file as kept, aliasing the export back to `required`).

## A stale claim in the entry, corrected

Q-50 closed with *"Both are registered in `scripts/check-oura-models-dormancy.js`'s `KEEP` map with
these reasons, so CI passes and the inventory is explicit rather than forgotten."* That has not been
true since Q-49 A4b, which removed every vendored-asset entry from that map on the correct reasoning
that *"an exemption for a file that cannot be listed exempts nothing"* once the files became
gitignored. The map holds one entry now.

Nothing was broken by it — the sweep cannot see these files either way — but the entry was pointing
at a safety net that no longer exists, which is precisely the state in which a decision gets
forgotten. Second stale backlog claim found today; the other one was hiding a live bug.

## What is deliberately not done

**Item 1 (`inference/dhrv`) is untouched and stays deferred to D7**, per the entry's own reasoning:
that ONNX path is unreachable from production on purpose, and its golden test is what pins our D5
regression replacement against Oura's original. Deleting it now would discard the validation while
the replacement is still young. The entry keeps a `Keep:` line saying so, so it no longer prints as
startable work.

**Not exercised:** the upload itself. `scripts/upload-model-assets.js` needs bucket credentials this
sandbox does not hold, so the manifest change is verified by tests and by reading, not by a run
against storage. `--check` against the real bucket is the confirmation, and it is owed.

<a id="2026-09-09-q509-fragmented-night-recovery-index"></a>

# 2026-09-09 — a fragmented night is one night (Q-509's last buildable half)

**Branch:** `lane-a/q509-fragmented-night-recovery-index` · no migration · **latent fix, no stored
number moves.**

## The fix

The Recovery Index is *hours between the overnight HR minimum and waking*. On a night split into
several sleep windows, `run.ts` took `last.recoveryIndexHours` — the final window's own value, which
measures from the lowest point of the **last fragment** rather than of the night. On a 10pm–2am /
3am–7am night bottoming out at 1am, that reports the 3–7am segment's minimum: a number describing a
different sleep episode.

`nightRecoveryIndexHours` (`packages/shared/src/health/recovery-index.ts`, beside the estimator it
completes) takes the minimum across every window and the wake time from the last. The wake time is
unchanged; only the point it is measured **from** is corrected. Extracted rather than left inline
because the merge sits inside a 700-line function where the rule could not be tested at all.

## The entry's own measurement beside it was unsound, and that is the bigger finding

The entry said this was *"not the gap: fragmented nights average 2.719 h against 2.639 h for
single-window nights."* **That cannot be a measurement of this path**, because there are no
fragmented nights to average.

`groupSleepPeriods` applies three rules before a night has more than one window: drop
`duration_hours <= 0` (`recordsSleep`), keep only **night** windows (≥ `ALWAYS_NIGHT_MIN_HOURS`, or a
midpoint inside the 21:00–10:00 band), and merge two windows only across a gap ≤
`MAX_INTRA_NIGHT_GAP_HOURS`. Applying all three to production:

| measure | nights |
|---|---|
| BLE-era nights (from 2026-07-07) | **61** |
| fragmented under `groupSleepPeriods` | **0** |
| naive proxy — more than one `sleep_sessions` row on a date | 13 |

Every one of those 13 second rows is a **daytime nap** (midpoints 10.3–19.8 local), a zero-duration
row, or 4.96 h from the night. So the merge branch has never executed for this user; the quoted
averages are of something else.

**How the error surfaced, which is the reusable part.** I reached for the same naive proxy first,
and it predicted something checkable: if the stored value were the final fragment's own hours, it
would be bounded by that fragment's length. Production said otherwise — 11 of 12 "fragmented" nights
exceeded it, **and 2 of 52 single-window nights did too**, which is impossible if the code does what
I thought. The single-window counterexamples are what forced the re-read rather than a patch to the
proxy. Rows-per-date is not the rollup's fragmentation, and any future measurement of a
fragmented-night behaviour has to apply those three rules or it is measuring naps.

## What this does and does not close

It closes the one buildable item Q-509 had left. It does **not** touch the entry's headline (the
BLE-era refit landing at 3.31 h against a shipped anchor of 5), and both prohibitions stand
unchanged: **do not widen `MEDIAN_WINDOW`, do not move `RECOVERY_INDEX_OPTIMAL_HOURS`.** The entry
already said this fix was not the gap; what changed is the reason — not "too small to matter" but
"has never run".

Also re-measured while there: the BLE series is now **n = 64, mean 2.695 h** (the entry's last
figure was 2.653 at n = 57). Eight more nights, mean unmoved — an independent re-confirmation of the
2026-09-03 finding that the series is flat.

## Verification

10 cases in `packages/shared/src/health/__tests__/recovery-index.test.ts`. **5 of 5 real mutants
caught**, one control that survived as expected — and it survived because the guard genuinely was
redundant (an empty array filters to empty and the next guard already returns null), so it was
deleted rather than kept.

**Not exercised: production data, because there is none to exercise.** No stored
`recovery_index_hours` changes, on any of the 61 nights. The first night that genuinely fragments —
two night-band windows less than three hours apart — is the first time this code runs at all.

<a id="2026-09-09-q91-followup-rollup-signal-design"></a>

# 2026-09-09 — the BLE rollup's invalidation signal, scoped (Q-91-followup)

**PR:** `lane-a/q91-followup-rollup-signal-design` · **Lane A** · **docs only — nothing implemented.**

Q-91-followup is a deferred *decision*, not a bug, and its own text said it needed a scoped design
rather than a quick add-on. This is that design:
[`docs/superpowers/plans/2026-09-09-oura-ble-rollup-invalidation-signal.md`](../superpowers/plans/2026-09-09-oura-ble-rollup-invalidation-signal.md).

## The answer, and why the question was too narrow

**No — the rollup should not emit its own signal, and it does not need to.** The entry framed this
as a latency trade: the rollup is fire-and-forget for I20 reasons, so hanging a signal off its
completion risks the timeout class behind the I19/I20 storm and the 2026-08-13 outage.

That trade only exists if the server is the only place a signal can come from, and it isn't.
`OuraRingService.emitStatus()` already pushes `ouraStatus` — carrying `draining` — through the
plugin bridge on every state change, background drains included, and `lib/oura-ble/plugin.ts`
already declares the listener. **The client can hear drain-end today, with no native change and no
server change.** The I20 coupling never has to be built.

## The trap that keeps it from being a two-line fix

**Drain-end is not rollup-done.** The POST returns once raw rows are stored; the rollup is a 3-second
trailing-edge debounce and then runs off-loop. So an `ouraStatus` listener that invalidates when
`draining` goes false — the obvious implementation — can refetch *before* the rollup has written and
**cache the pre-rollup read**. That is worse than the staleness it replaces: stale data gets
corrected by the next mount, whereas data refilled from a pre-rollup read looks fresh and is held for
the full TTL.

The design instead confirms the watermark advanced. `oura_rollup_state` (migration 184) already
persists `last_rolled_ds`/`epoch` per user after each *successful* run, and is **not exposed over
HTTP** — one small GET is the entire missing piece. `afterDrainSettles` has the same race today and
converges onto the same helper rather than keeping a second mechanism beside it.

## Two filing mistakes I made and corrected, because the field changes what the queue does

I first gave the entry `Gate: device`, which **parks** it — recreating exactly the unstartable-queue-
head problem #1047 existed to fix. Then `Verify: device`, which files it among entries that have
*shipped* and owe only a check; this one is unbuilt. The right answer is **neither field**: the build
is ordinary unit-testable work, only *observing* it is device-bound, and that is the standard
Canonical Runtime case — ship with a Known-Issues row. The note stays in prose, where it informs the
implementer without changing classification.

Worth recording because both wrong answers looked right in isolation, and `check-backlog-pointers`'s
advisory about a *different* entry is what surfaced the first one.

## Status

Entry stays in READY at position 2, now with a plan behind it. Nothing is implemented, and no claim
here should be read as shipped.

<a id="2026-09-09-q91-followup-rollup-watermark-build"></a>

# 2026-09-09 — the drain signal was firing before the rollup ran (Q-91-followup, built)

**PR:** `lane-a/q91-followup-rollup-watermark-signal` · **Lane A** · PR 2 of the two-PR split
(#1050 was the design). **Not device-verified** — Known-Issues row filed.

## I got the premise wrong in #1050, and the truth is worse

The design PR I merged an hour earlier said the ordinary (non-manual) drain flow emits no client
invalidation at all. **It does.** `components/sync-provider.tsx` has watched the native
`ouraStatus` event's `ingestStored` counter for a while, debounced 1500 ms, and fired
`invalidateOuraSync()` + `ta:oura-ble-synced`.

I had the evidence and misread it: that file showed up in my own grep for `ta:oura-ble-synced` as a
dispatch site, and I attributed it to the manual path without opening it. The backlog entry claimed
the same thing and had gone stale. **Agreeing with a stale entry is not verification** — the entry
and I were one source, not two.

**What it changes is that this was never a missing feature. It was a live bug, and a worse one.**
`ingestStored` advances the instant the server has *stored* rows — the same instant it schedules its
rollup on a **3-second** trailing-edge debounce. The listener waited **1500 ms**. Every autonomous
drain therefore invalidated *before the rollup had started*, and the refetch it triggered read
pre-rollup data and cached it for the TTL. The exact trap the design described as a thing to avoid
was already shipping on every background drain.

A stale cache is old data the next mount corrects. A cache refilled from a pre-rollup read looks
fresh, so nothing corrects it. The "fix" was producing the worse of the two failures.

## What shipped

- **`GET /api/oura-ble/rollup-state`** — exposes `oura_rollup_state`'s `last_rolled_ds`/`epoch`,
  which migration 184 has persisted all along and nothing could read over HTTP. Auth-gated,
  `private, no-store`, rate-limited like its polled siblings because it *is* polled. Not
  admin-gated: a rollup cursor is not user data.
- **`lib/oura-ble/rollup-wait.ts`** — `waitForRollup`, bounded backoff (~46 s ceiling), everything
  external injected so it runs in the sandbox where `getOuraBle()` returns null.
- **Both callers converge on it** — the background listener and manual `afterDrainSettles`, which
  had the same race and was masked by its longer poll. One mechanism, not two.

Two details that are easy to get backwards, both mutation-pinned: the baseline is captured when the
burst **starts**, not when the debounce settles (by then the rollup may already have run, and a
baseline read then would make the wait time out waiting for progress that had happened); and an
**epoch change short-circuits** to `re-keyed`, because the ring's deciseconds counter restarts from
zero on a re-key, so a numerically *smaller* watermark under a new epoch is progress.

A `timeout` is the ordinary end, not a failure: a drain carrying nothing the rollup changes never
moves the watermark.

## Verification

Eight mutants, all caught; the control (reordering two independent consts) survived as genuinely
equivalent and, unlike LB-64's, was a reorder rather than dead code, so there was nothing to delete.

**Not exercised — and this is the substantive gap.** The listener path is unreachable off-device, so
nothing here observes the behaviour being fixed. The route and the helper are unit-tested; the fix
is not. The Known-Issues row names the three device checks owed.

<a id="2026-09-10-chore-dependabot-remediation"></a>

# 2026-09-10 — the dependency debt, 36 findings down to 1 (standing item)

**PR:** `chore/dependabot-remediation` · **Lane B** · `package.json`, `pnpm-lock.yaml`.

`CLAUDE.md` makes Dependabot remediation a standing item an implementer takes **before** any numbered
entry once the debt crosses **≥ 5 outstanding high/critical**. Lane B's READY was 0, so the queue was
checked and the standing item's own instruction followed — *"re-check `pnpm audit` before taking
this"*. It read **36 findings: 23 high, 2 critical**, against a stored state of *"2 high, currently
below threshold — skip"* dated **2026-07-27**. Six weeks stale and five times over the line.

**After: 1 moderate.** `adm-zip` GHSA-vwc7-r8mq-g2x9 via `onnxruntime-node`, which has **no published
fix** — `patched_versions: <0.0.0` — so there is nothing to bump and nothing owed.

## What changed

Two direct patch bumps within the same major:

| package | from | to | resolved | why |
|---|---|---|---|---|
| `next` | `^15.5.22` | `^15.5.24` | 15.5.25 | the **critical** |
| `sharp` | `^0.35.3` | `^0.35.4` | 0.35.4 | libheif CVEs |

…and six `pnpm.overrides` for packages reached only transitively: `undici` (via `jsdom`), `nanoid`
(via `@tailwindcss/postcss`), `fast-uri` (via `@sentry/nextjs`), `@xmldom/xmldom` and
`brace-expansion` (via `@capacitor/assets`), `qs` (via `googleapis`), and `sharp` again for the
nested copy below.

**Version-keyed, not bare**, which is the part worth carrying forward. The repo's existing overrides
are mostly of the `"esbuild@<0.28.1": ">=0.28.1"` shape and that is the safe one: a bare
`"nanoid": ">=3.3.18"` resolves **nanoid 5**, which is ESM, under a `postcss` that wants CJS `^3`.
Every override added here carries its `<` bound and an upper bound inside the same major.

## The stored note was wrong in the direction that costs time

The 2026-07-27 state said the `sharp` advisory was reached via `next > sharp` and that fixing it
meant *"a major `next` bump or a force-override under Next's own dependency — either gets its own
PR"*. Both halves were wrong by the time they were read:

- The live path was **`@capacitor/assets > sharp@0.32.6`**. The direct bump and the `next` bump both
  moved their own copies; the nested one stayed at 0.32.6 and kept reporting.
- **`@capacitor/assets` is a devDependency invoked by no script and no CI job** — it generates icons
  when someone runs it by hand. Verified by grepping `package.json`, `.github/workflows/*.yml` and
  `scripts/`. So `"sharp@<0.35.4": ">=0.35.4"` is one line whose only failure mode is a tool nobody
  runs automatically, and whose reversal is deleting that line.

Read as *"this needs a major framework bump"*, it looked like work that had to wait for a dedicated
session. It was a one-line override. **Check which consumer actually pulls the vulnerable copy before
concluding an override is unsafe** — the standing item now says so.

## Cleared opportunistically in the same pass

`vitest` `^4.1.8` → `^4.1.11` (a moderate, and a patch bump within 4.1) — the standing item permits
moderates when already touching related deps, and the test runner is exercised by the gate anyway.

## Verification

A framework bump is the case where a green typecheck proves least, so the whole gate was run:

- `tsc --noEmit` clean.
- **Full unit suite green on vitest 4.1.11 — 877 files, 8,245 tests**, 3 skipped.
- `pnpm lint`: 0 errors (667 warnings, the existing baseline).
- `pnpm check:rules` — **Ran 71 of 71**.
- `pnpm build` on Next 15.5.25: exit 0, 244 static pages generated.
- **E2E smoke against the bumped runtime**, since the build is a compile and not a run:
  `one-calorie-budget`, `toggle-aria-state` and `workout-set-loop` — 7 passed.

**Not exercised:** the S25 APK. The APK is a WebView loading from Railway, so a Next patch reaches it
through the deploy with no rebuild — but nothing here was seen running on the device, and `sharp`'s
override touches an icon-generation tool that has not been run since.

No version or changelog entry: nothing user-visible changed.

<a id="2026-09-10-chore-la-80-citation-rewriting-fold"></a>

# 2026-09-10 — the journal's recent window can shed again: 345 entries → 60 (LA-80)

**Branch:** `chore/la-80-citation-rewriting-fold` · one new script, a fold, and the citations that
made the fold impossible before. No product code.

## The bind it removes

`docs/overview/entries/` was meant to be a readable *recent* window, and two rules made that
impossible together. The entries README said **do not fold an entry another doc links to** — right,
because a broken citation in someone else's handoff is worse than a long list. And **305 of 342
entries were cited**. So the only entries a sweep was permitted to fold were the **newest**, meaning
obeying a total ceiling required deleting the recent window to preserve the archive. It had blocked
two unrelated PRs in two days; earlier today I folded 20 entries from the previous 48 hours purely
because nothing older was eligible.

"Do not fold a linked entry" was never really a rule about folding. It was a workaround for having
no way to move the link.

## `scripts/fold-journal-entries.js`

Folds oldest-first into `history-<date>-folded-N.md`, rolling a new part at ~250 KB, and **repoints
every citation** at `#<entry-name>` anchors named after the entry's old filename — so a rewritten
link still reads recognisably, and the anchor does not depend on anyone's heading-slug rules.
`check-doc-links` resolves the file and ignores the fragment, so a wrong anchor would be invisible to
CI; determinism there is doing real work.

**345 → 60 entries.** `check-doc-links` clean on 810 files, `check-index-doc-paths` clean on 1,098
paths across 12 orientation docs, `pnpm check:rules` **Ran 73 of 73**.

## A sixth trap, which the README's five did not cover

The README documents five link-breaking traps from earlier hand sweeps. All five are handled in the
script. The first full run then failed on a **sixth**:

> A citation names the path **twice** — once as the target, once as the backticked link *text*.
> Rewriting only the target leaves the text naming a file that no longer exists.

**`check-doc-links` cannot see this** — it reads targets. It passes that gate and fails
`check-index-doc-paths` instead, which scans orientation docs for repo paths. Eighteen survived the
first run. The fold now rewrites the text to the bare entry name, and the README's list is six long
with the instruction to run *both* checkers, because either alone calls a broken fold clean.

## What it deliberately will not fold

**An entry an agent baton cites.** Rewriting would work, but it means this sweep writing into another
lane's live state file — which the README calls out, and which races whatever that lane is doing right
now. Batons are rewritten wholesale at handover anyway. Five entries held back; the script says so.

## The ceiling, and my own duplicate

`totalCeiling` went 361 → 600 → **150** in one day. 600 was this morning's stopgap, taken because the
gate was unsatisfiable by any sanctioned action. It is satisfiable now, so 150 is a real gate again —
about ten days of headroom at ~13.5 entries a day — and the rationale in `check-doc-index-size.js` is
rewritten to say why rather than leaving the number bare.

**OR-107, which I filed this morning, was a duplicate of LA-80** — filed two days earlier by Lane A,
with the same diagnosis and the same measurement. I filed it out of a conversation about a gate that
was blocking me, without grepping the queue for the symptom first. Whatever blocks you has usually
blocked someone else already. Both entries are removed: one shipped, one should never have existed.

## Not done

- The 60 remaining entries include 20 that are cited and 39 foldable; nothing needs folding again
  until the window grows.
- The five baton-pinned entries stay until those batons turn over.

**Surfaces not exercised:** none apply — docs and one script; no runtime code, no device path, no
schema.
