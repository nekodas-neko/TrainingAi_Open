# TrainingAI — Project Overview

> **Lean index — orient here, then dive.** This file holds the current status, the live Known
> Issues & Risks, and the What's Left To Do list. Nothing else. The per-session journal lives under
> `docs/overview/`; the Document Map at the bottom routes everything else. **Anything the engine
> cannot unblock itself is collected under 🔑 Waiting on the owner**, so it never has to be
> reassembled from a chat.
>
> It is kept lean on purpose, and it has drifted twice. If you are about to append a dated summary
> of what you just shipped, that belongs in your journal entry, not here.

**The documentation flow at a glance:**

| Kind of work | Where it lives |
|---|---|
| **Who does what** | [`docs/agents/README.md`](docs/agents/README.md) — the six standing agents, their authority, and the two-lane file-ownership contract. Read this before starting a session. |
| **Upcoming — ready to build** | [`docs/implementation-backlog.md`](docs/implementation-backlog.md) — a priority-ordered queue; implementer sessions take the top item per the protocol in that file |
| **Upcoming — ideas/findings** | [`docs/planned_upgrades.md`](docs/planned_upgrades.md) — open uplift ideas; they graduate to the backlog once a session writes their implementation plan |
| **Completed — session journal** | `docs/overview/entries/` (current window, one file per PR) then the batched `docs/overview/history-*.md` |
| **Completed — shipped plans/specs** | `docs/superpowers/plans/archive/` and `docs/superpowers/specs/archive/` |
| **Completed — shipped uplift ideas** | `docs/overview/uplift-archive.md` |
| **Architecture reference** | the top of [`CLAUDE.md`](CLAUDE.md) — stack, data model, key files, Oura integration (authoritative, kept current) |
| **Session handoffs** | `docs/handoff-YYYY-MM-DD-<domain>-<title>.md` — the **only** handoff convention (there is no root `HANDOFF.md`). `ls docs/handoff-*-<pillar>-*.md` finds every handoff for a pillar; the pillar index at `docs/domains/<pillar>/README.md` links the ones that matter. Written via the `handoff` skill — see **Session Wrap-Up** in [`CLAUDE.md`](CLAUDE.md). |

---

## 🔖 Current Status

**Version:** v1.436.3 · **Branch:** `main` · Railway auto-deploys on push to `main`.
**Last updated:** 2026-09-03.

**The HR Recovery Profile now says how much of it is signal (Q-516).** `aggregateHrRecoveryProfile`
has returned `informativeShare` since the re-banding and **nothing rendered it** — the state the
entry warned about in its own words: *four populated buckets look like a working feature whether or
not they are.* The card states the share, emphasised below half, where it stops being a footnote
about the dimmed rows and becomes the headline about the table. A share of 1 stays silent.
**⚠ THE ENTRY WAS UNREACHABLE FROM EITHER QUEUE and that is the durable finding:** two bare lane
mentions disagreed — the `Keep:` said Lane B, a stale line eleven lines below still said *"Lane A
implements"* — so `laneFromLines` returned `?` and `next-item.js` filed it under UNCLASSIFIED, where
neither lane looks. Found by auditing the queue, not by taking the next READY item.
**BF-94's `Needs: BF-84` was also discharged** (that storage shipped 2026-09-01) while its real
blocker, BF-61's device check, sat in prose the parser cannot read; it is a `Gate: device` now.
**Not device-verified** — the seed has no `set_hr_stats`, so the emphasised branch has never been on
a screen ([journal](docs/overview/entries/2026-09-03-q516-hr-recovery-honesty.md)).

**A redecode that finishes late can now say so (LA-56).** The owner ran the `fullHistory` pass and
it was reaped as *abandoned* after exactly 30 minutes having written nothing — the second such
failure in four days, and every full-history redecode that has ever run ended the same way.
`finishRedecodeJob` filtered `isNull(finishedAt)`, which the reaper has already set, so a late
success could not record itself: **the work would land while the record said it failed.** Migrations
**261 + 262** add `reaped_at` and let a reaped row be closed — keeping both facts, when the reaper
gave up and what came back. Immutability is preserved exactly: a job that genuinely finished and
recorded a result is still untouchable. **The heartbeat is still owed** — the reaper remains a pure
`startedAt` age check, so slow and dead look identical
([journal](docs/overview/entries/2026-09-03-la56-late-redecode-result.md)).

**A still-syncing sleep score now says so (Q-529).** The owner saw a night scored **47** at 06:46
while the ring was still uploading; it settled at **62**. **The entry's central claim was already
stale:** it says sleep has no provisional concept, but `lib/sleep/provisional.ts` shipped for BF-83
on 2026-09-01 and `/api/sleep-sessions` has returned a per-night `provisional` flag ever since —
**four local `SleepRow` interface copies dropped it**, so it reached the client in the JSON and no
sleep surface read it. Marked now on all three: the Home chip (via its existing `lowWear`/`limited`
glyph, whose predicate was written out at three sites and is now one tested function), the Body
tab's sleep card, and `/health/sleep`. An absent flag reads as **settled** — the local-store seed has
no watermark, and badging every historical night would be worse than the bug.
**⚠ Found while checking the entry's caveat, and filed as LB-53 (Lane A):** `oura_daily_derived`
holds **four `computed_at` stamps in its entire history**, with a **nine-day gap** where nothing was
written and a pass that rewrote 85 rows minutes after a deploy. That makes this marking *more*
load-bearing — the provisional state may last far longer than the ~9 minutes Q-529 measured.
**Not device-verified**, and the device owns the only real test: a morning where the ring is
genuinely mid-upload ([journal](docs/overview/entries/2026-09-02-q529-provisional-sleep-score.md)).

**The database's growth is partly the archive its baseline predates (BF-55, Q-283).** Total re-read
at **200 MB** — down from 206, because migration 249 took the 21 MB index on 09-01. `oura_raw_packed`
holds 1,072 rows / 18 MB and its **first pack is dated 2026-08-18, the same day as the 171 MB
baseline**, so it has grown ~**1.2 MB/day** since and is never pruned. That is **~62% of the excess,
and the ~0.4 MB/day expectation cannot have included it** — the packing work that set the baseline
created a permanent writer on the same day. **Q-283 is stale by ~14×:** its one real candidate was
already dropped, and excluding primary keys and unique constraints the droppable remainder is
**800 kB**, 0.4% of the database, for a destructive migration
([journal](docs/overview/entries/2026-09-02-db-growth-archive-attribution.md)).

**The chronic-stress refusal now leaves a number behind (TN-1).** `chronic_stress_score` has been
NULL on every row since the model shipped — the third dormant score — and both gates countable from
stored data pass, so the refusal is in the granular layer, which by design recomputes its
intermediates in memory and records no reason. `chronic_stress_granular_nights` counts the nights in
the model's own 31-night window carrying a non-empty hypnogram, rMSSD series **and** skin-temp run
(migrations **258 + 259**, local SQLite **v36**). **`CHRONIC_STRESS_MIN_DAYS` does not move and
nothing consults the count** — relaxing a threshold before knowing its input distribution is the
Q-504 mistake. **NULL means NOT EVALUATED**, and **only a hand-triggered `fullHistory` pass will ever
write a value**, which is the owner's to run
([journal](docs/overview/entries/2026-09-02-tn1-chronic-stress-count.md)).

**A guided walk's phase change now lands on the screen (BF-105).** The owner, mid-walk: *"there isn't
enough of a queue to indicate session phase changed."* The notification was firing correctly and on
time — what did not exist was any in-app response: `walk-active.tsx` called `hapticSuccess()` once, at
the end of the whole walk, so a boundary moved one word and nothing else. Now a haptic per boundary
(`hapticSuccess` for fast, `hapticLight` for slow, so the two are tellable apart through a pocket),
keyed on the segment index so it fires once per change and **never on mount** — the screen mounts with
an active segment when a walk in progress is reopened. Plus a vignette wash of the incoming phase's
colour, which keeps the centre clear because peripheral vision is what has to catch it.
**⚠ Two corrections to the entry's second half, both measured:** `workout-timers` is NOT dead and must
not be deleted (the workout rest timer posts to it), and the plugin's per-channel `vibration` is a
boolean rather than a pattern — so a fast/slow channel split needs a sound file in `res/raw/`, making
that half **APK-gated**, not the JS-only work the entry described. **Not device-verified**, and the
device owns the haptic, which is the half the report is about
([journal](docs/overview/entries/2026-09-02-bf-105-walk-phase-cue.md)).

**A finished walk no longer arms the Start screen (BF-108).** The owner: *"after closing it - it still
opens with the activity naming screen"*, titled from a walk they had just done. **The entry blamed the
completion path and that was wrong** — `done-activity-screen.tsx` calls `resetSession()` on both save
paths and Back calls it too, so a saved or cancelled activity has always left clean state. **What
survives is an ABANDONED session:** `onRehydrateStorage` demotes a `done` session, and a stale
`active` one, to `pre` and neither cleared `activityType` or `title`, so the screen rendered pre-armed
instead of falling to the type picker. That is the persisted-store class CLAUDE.md already names, and
this is its fifth shape. **Q-450 is intact and pinned** — a live in-flight session keeps its type and
returns to its own screen, and the 12-hour boundary is asserted as `>` because an off-by-one there
discards a recording. `Done` now lands on `/health`, where the walk it just saved is visible.
**Not device-verified**, and the device owns the Q-450 case, which needs a real kill and relaunch
([journal](docs/overview/entries/2026-09-02-bf-108-activity-store-stale.md)).

**HR-recovery peak bands re-cut, and the entry's own proposal rejected (Q-516).** The `<110`
boundary cut through the middle of the informative range — mean 60-second drop **−3.5** under 90 and
**5.1** at 90–104 against **12.2** at 105–119 — so **42 episodes peaking 105–109 shed 11.5 bpm** and
were dimmed as noise and dropped from the trend. **⛔ The proposed `120+` top band was not shipped:**
it was measured over `set_hr_stats` (strength, max 132) while **HRP-2 is built** and cardio cool-downs
reach **168**, so collapsing the top would bucket a 168 bpm cool-down with a 120 bpm lifting rest.
Shipped `<90 · 90–104 · 105–119 · 120–149 · 150+`; only the genuinely empty `170+` went. The stale
header comment that misled the entry (*"Phase 1 seeds exclusively from set_hr_stats"*) is corrected.
**The honesty half is Lane B's and is NOT done** — `informativeShare` is computed and unrendered
([journal](docs/overview/entries/2026-09-02-q516-peak-bands.md)).

**The calibrated maintenance can no longer land below your own resting burn (Q-517).**
`adaptive-tdee.ts` warns in its own header that an ungated estimate *"would tell the user their
maintenance is 1200 kcal — actively harmful advice"*, then clamped at **1000**; the owner's worst
window computed **1052** and slipped through the gap. The floor is now the user's BMR — the
**measured** resting rate where one exists, since `energy-balance-service.ts` already resolves that
better number two dozen lines above the call. Below it the window is **rejected, not clamped**, so
the resolver falls back to the formula baseline rather than reporting a number the data never
supported. **The right floor already existed one line below, applied to the wrong quantity:** it
protected what the balance *displays*, not the maintenance that becomes the recommendation and then
`users.calorie_goal`. **SAFE, not CORRECT** — survivors still sit under the formula's 2,397, which is
under-logging showing through ([journal](docs/overview/entries/2026-09-02-q517-tdee-bmr-floor.md)).

**A clamped expectation no longer cuts your load (Q-514).** `expectedRpe` clamps to the 5–10 slider,
and on light accessory work the floor binds — 37 of 570 rated sets, hiding raw expectations as low as
−10. Those sets ran a **+1.89** mean delta against **−0.34** everywhere else, a 2.2-point offset in
the direction the engine reads as "RPE ran high", and they produced **64% of all back-off triggers**
while leaving the push arm untouched. They are now **dropped** from the autoregulation delta rather
than neutralised: the model cannot state what it expected, so the gap to the reported RPE measures
the clamp and not the athlete. `RPE_DEAD_BAND` does not move and the clamp does not widen — both were
measured and both are correctly placed. **`rpeTrendFromSets` deliberately still sees every set**: it
is the emergency-deload safety net, and the same bias makes it fire slightly early, which is the safe
direction ([journal](docs/overview/entries/2026-09-02-q514-expected-rpe-clamp.md)).

**The walk summary shows its calories (BF-107).** The owner: *"the final screen doesnt show calories
burned."* **The number was already reaching the client and the screen threw it away** — `POST
/api/activity-logs` answers `{ activityLog }` carrying it, and the web branch checked `res.ok` and
discarded the body. **The device half is the one that mattered:** `pushMutations` only flips the row to
`synced`, so the derived value lands on a **pull** — the fix forces one inside `pushThenRevalidate`'s
callback and reads the row back, without which the tile is a dash forever on the canonical runtime.
The tile reads `—` until a figure lands, never `0`, because a zero is a claim about a walk that burned
nothing. **The entry's sibling claim was wrong:** `done-activity-screen.tsx` navigates away the instant
it saves, so its grid is a pre-save draft and a tile there would vanish before filling. `StatTile` is
now one primitive rather than two drifted copies. **Not device-verified**, and the device owns both
interesting cases — offline, and the fill itself
([journal](docs/overview/entries/2026-09-02-bf-107-walk-calories.md)).

**LB-38 is root-caused: `@zxing/library` cannot read certain VALID QR symbols upright, and the flake
was never in the app.** Over **3,000** meal tokens, encoded by the same `qrcode` call the label
renderer makes and rendered synthetically at 13 px per module with **no app code in the reproduction**,
**115 (3.83%) fail upright** and **4 (0.13%) still fail after four rotations**. The symbols are valid —
seven of eight sampled failures decode once turned, and rotation changes only the detector's traversal.
It is independent of ECC level, QR version, mask, module size and quiet zone. **It was deterministic
per token all along**, which is why no retry helped: each run seeds one meal, every style draws that
same symbol, and 3.83% is 1 in 26 against the ~1 in 19 measured. `decodeQrRotating` tries four
orientations, guarded by a fixed token that fails upright. **⚠ The app's own scanner is the same
decoder**, so ~4% of labels may be unreadable upright by the app that printed them — untested on a real
camera, so it is flagged for the owner rather than claimed
([journal](docs/overview/entries/2026-09-02-lb-38-root-caused.md)).

**Nutrition's plan button opens the coach, in the nutrition scope (Q-407).** LA-47's plan card
unblocked this, and the Lane B half was exactly what the entry said: `/coach` takes `?scope=`,
`CoachContent` forwards it in the request body, and `Build a meal plan` goes to
`/coach?scope=nutrition`. **The scope is the point, not the navigation** — it decides the coach's tool
subset, and *a tool it never receives is a boundary it cannot cross*, as against a prompt asking the
model not to read workout data. **The stepper sits beside the conversation, not behind it:** the entry
warns that a flow stalling with no fallback is worse than seven screens that finish, and Rebuild —
the only other route to the sheet — does not exist until a plan does, so the no-plan user is the one
who would have been stranded. **Still owed, and it is Lane A's:** the coach does not yet open by
stating what it already knows instead of asking. **No real Gemini turn was made and the device is
untouched** ([journal](docs/overview/entries/2026-09-02-q-407-nutrition-coach-entry.md)).

**AI Coach draws the meal plan, and one button puts every meal in My Foods (LA-47).** The owner's
review is the acceptance test — *"I want it to make the meal plan; then add each item to the saved
meals/my foods"* — and nothing in a Coach thread could put one there until now. **`showMealPlan`
takes a title and nothing else:** the card reads each meal from the plan the app holds, so the model
cannot round a calorie figure or drop a meal, and it spends none of the output tokens that are
essentially all of Coach's latency. Save-all goes through Q-398's write path, keyed on
`meal_plan_meals.saved_meal_id`, so a second press is a no-op. Both buttons resolve as ordinary
`chose` results — a card with two buttons is a choice list with a rich body, not a new result type.
**Shipped as one PR across both lanes on purpose:** a new union member is a type error until
`widget-registry.tsx` handles it, and a branch rendering `null` wedges the thread permanently.
Verified with a real Gemini turn against `pnpm dev` (three saved meals, three stamped plan rows) and
**not device-verified**. **Q-407's `Needs:` is cleared**, so the conversational wizard is startable
for Lane B ([journal](docs/overview/entries/2026-09-02-la-47-coach-plan-card.md)).
**LB-38's dump was captured, it does not decode offline, and the reading I first gave it was wrong.**
The share-code e2e flake has been open on one question: keep the pixels ZXing refuses and decode them
offline, because a buffer that decodes offline would put the fault in *how* the decode is invoked. One
was finally caught, on `Ingredients · centred`, and **no binarizer × `TRY_HARDER` combination decodes
it** — so the fault is in the image, and the last unexamined mechanism is eliminated. **The follow-up
was then wrong and one more measurement caught it:** the dump's ink of 0.0807 looked like half the
recorded 0.172–0.179 band, a mid-repaint signature, and a canvas-settling gate was written for it —
but ink is **per-style**, `Ingredients · centred` reads **0.0800 on a passing run**, and that band
belongs to a different style. 0.0807 is normal. **The gate was reverted unshipped** rather than fix a
cause that is not established. The four measured per-style figures are now in `darkFraction`'s comment,
which previously said "~0.17" and is what made the error easy
([journal](docs/overview/entries/2026-09-02-lb-38-dump-captured.md)).

**The `Full` override told the user it had reverted a deload when it had not (LB-47).** The entry
asked whether BF-64's override does anything on a real session-level deload; **its measurement was
exactly right and its conclusion was not.** Re-measured: 5 prescriptions, 1 session-level deload
carrying 0 exercises with `preDeload`, 2 per-exercise, 0 with both — the entry's figures to the row.
But on that prescription the toggle **is not rendered at all** (`phase: 'deload'` → `isDeloadActive`
→ `pre-workout-screen` gates the whole control on it), so `Full` is not an override that does nothing;
it is not offerable, and the entry's proposed fix was already the behaviour. **What is reachable is
worse:** `deloadRevertNames` and `deloadOverrideBlocked` both return empty in that shape, and the card
read `blocked.length === 0` as *everything reverted* — rendering *"Every exercise is back to its
pre-deload weights and sets, and these sets count toward your 1RM."* Both clauses false, which is
BF-8's complaint arriving from inside the fix filed to prevent it. `deloadOverrideOutcome` gives the
card a `nothing-to-revert` state and honest copy. **BF-64 is not reverted.** Latent rather than live —
it needs a prescription whose `deload` flag and `phase` disagree, 0 of 5 so far — and **not
device-verified** ([journal](docs/overview/entries/2026-09-02-lb-47-deload-override-honesty.md)).

**The Review sheet flags macros that disagree with their own calories (BF-109).** A scan read **173
kcal** beside 45.7 P / 52.1 C / 13.6 F — **514** by Atwater. **The screen was right and the row is
wrong at source:** OFF carries `energy-kcal_serving 173` on the same per-serving basis as every other
field, so the mapper is correct, and `energy-kcal_100g` is that figure ÷ 3.5, so nothing in the row can
be fallen back to. **The guard already existed** — `macroCalorieDisagreement` and the 15% limit have
been in `scan-totals.ts` since they were written, for this failure against this source; the search list
surfaces them and two routes sanitise, and this sheet did neither. It **warns and offers a one-tap
correction, never rewriting silently**: Review exists for the user to decide, and fibre and alcohol put
real foods 10–20% out. Photo-scan and manual share the sheet, so they get it too. **Not device-verified
and no barcode was actually scanned** — the e2e reaches the identical sheet by the manual road, because
a barcode needs a camera ([journal](docs/overview/entries/2026-09-02-fix-bf-109-macro-calorie-warning.md)).

**A meal can be logged at ½×, 1× or 1½× (BF-104).** The owner's ask, and the second half of a split
that paid off: BF-104 was parked behind LB-49 this morning and became startable the moment LB-49's
engine argument merged. **The picker had to change the sheet's own figures**, which the entry did not
anticipate — the detail sheet documents its headline and macros as *"per portion, that is what Log
this meal writes"*, so a figure fixed at one portion would have stopped describing the button. They
follow the picker now and the label says which portion it is showing. Discrete taps rather than a
number field (the entry is explicit), reset to 1× whenever a different meal opens, and the scanned-
label path deliberately keeps no picker because it is scan-and-go. Verified against the database
rather than a toast: logging at 1½× writes `quantity_multiplier` **1.5**. **Not device-verified**, and
**`saved-meals-sheet.tsx` now sits at 798 lines against the 800 limit** — two lines of headroom, and
it is not in the size baseline, so the next addition there fails outright
([journal](docs/overview/entries/2026-09-02-feat-bf-104-meal-scale.md)).

**Lane A session wrapped 2026-09-02 — ten PRs, and the finding is about the QUEUE rather than the
code.** Handoff:
[`docs/handoff-2026-09-02-nutrition-lane-a-session.md`](docs/handoff-2026-09-02-nutrition-lane-a-session.md).
**Six of the eight backlog entries examined were wrong about something load-bearing** — not stale,
wrong at filing time: a function name that does not exist (`logMealFromSaved`), a severity that does
not reproduce (LB-48's "until the app is restarted"), a missing `Gate:` that put owner-gated planning
at the head of a build queue, and a migration LB-18 insisted on that `listSavedMeals` had already
made unnecessary. **Line numbers were accurate every time; names and conclusions were not.** Another
session hit the same class independently in #789. Worth Orchestrator's attention as a filing-quality
pattern rather than six coincidences.

**`Recent` gets an unscoped source, and the migration LB-18 said it needed does not exist.** The
owner settled the behaviour on the device — *"Recent doesnt need to be scoped to current meal
bracket"* — and the entry said ordering foods and meals by recency **needs a Lane A schema change,
not a Lane B sort**, because a saved meal has no last-used timestamp. **`listSavedMeals` already
derives `lastUsedAt` from `max(food_logs.logged_at)`**, orders by it, and reads
`idx_food_logs_saved_meal_recent` from migration 238 — deriving rather than storing, as the Stored
Counters rule asks. The whole planned chain (migration, SQLite version, `RECONCILE_COLUMNS`, sync)
was unnecessary; what was missing was a query without a `WHERE meal_type_id`. That shipped on both
sides, sharing one body each so the de-dup and the 100-row window cannot drift, and `mealTypeId` is
now optional on the route. **Lane B's half is dropping the query param**
([journal](docs/overview/entries/2026-09-02-recent-food-items-unscoped.md)).

**The goal-recommendation prompt claimed an activity-scaled TDEE it never had (LB-50).** It read
*"Baseline (Katch-McArdle, lean mass Xkg, activity level 'moderate'): BMR X, TDEE X"* — which parses
as *computed for that level*. `calculateBaseline` is `bmr × SEDENTARY_MULTIPLIER`, unconditionally,
since Q-401 deleted `ACTIVITY_MULTIPLIERS` precisely so a self-report cannot double-count against
measured movement; the level reaches only `waterMl` and `stepsGoal`. The model was being handed a
number, a false account of how it was made, an activity level and a step count — everything needed
to "correct" for a multiplier that is not there. The prompt now says outright that the TDEE is
BMR × 1.2 and must not be scaled, which beats merely deleting the claim: the level is still on its
own line, so silence would leave the inference to the model. **Still owed: the exposed factor and
its not-enough-data state**, which is what BF-102's picker needs
([journal](docs/overview/entries/2026-09-02-recommend-prompt-tdee.md)).

**The journal directory's total ceiling is 320, up from 250 — `main` had reached it and every agent
was one PR from a hard CI block.** The standing rule puts a journal entry in every PR, so the next
one took the count to 251 and failed. The raise is not a workaround: the check's *other* guard, the
one a compaction sweep can act on, counts UNLINKED entries and read **3 of 60**. The ceiling was
firing because entries are well cited by durable docs — the habit the entries README exists to
establish — and the four foldable ones were all written in the previous two days, so a sweep would
have deleted the newest rather than the oldest. Reversal is one number in
`docs/doc-size-baseline.json`; the signal to do the real compaction instead is the floor rising from
something other than journal citations.

**A scale argument on the meal log, and four things its entry got wrong (LB-49).** `logMealItems`
takes an optional `scale`, applied at write time to each item's multiplier and defaulting to 1 — so
nothing is user-visible until Lane B ships the control. The entry named a function that does not
exist (`logMealFromSaved`), justified the lane by calling it *"the single shared write function both
server paths call"* when it is client-side and neither an API route nor `pushMutations` touches it,
demanded a sync chain its own **scale-at-write-time** decision makes unnecessary, and named three
write sites where there are **five** — the two it missed are the optimistic pushes, the pair that
decides whether the diary agrees with the database
([journal](docs/overview/entries/2026-09-02-meal-log-scale.md)).

**A saved RMR test evicts the goal caches — and the entry's severity claim did not survive being
measured (LB-48).** `measured-rmr` was in no cache group and its route invalidated nothing, so
Profile's Recommended calories painted the previous resting rate before revalidating. The fix is the
key joining `invalidateGoalRecommendations()` and the RMR form calling that group. **What the entry
got wrong is worth more than the fix:** it said the stale value survived *"until the app is
restarted"*, because the goals section fetches in a `useEffect(…, [user?.id])` inside the persistent
tab shell. The shell does keep its five tabs mounted — but the RMR form lives at `/more/clinical`, a
plain page outside it, and driving `/more` → `/more/clinical` → back in Chromium logged the goals
effect **3 times then 3 more**. It remounts, so this was a first-paint flash. A `useCachedValue`
conversion written for the claimed symptom was reverted, and a backlog entry filed on the same
premise was withdrawn before it reached the queue
([journal](docs/overview/entries/2026-09-02-measured-rmr-invalidation.md)).

**The ring and strap batteries reach the Home header (Q-111), and the entry was wrong about both
halves.** It claimed the ring chip was already there — **it was not**; there was no
`oura-battery-chip.tsx` and the header rendered only the weather chip, with the ring battery on
Health and More. And it claimed nothing in JS read the strap battery — **`chest-strap-pairing.tsx`
does**, over browser BLE while pairing. The true gap was that nothing read `PolarBleStatus.battery`
and nothing persisted either number: **two numbers in two screens with no relationship**. Now one
store with two writers, a shared chip, and a stale reading shown **muted rather than hidden** (a chip
that vanishes reads as "no strap", which is a chest strap's state most of the day). The header could
not grow — `session-select-content.tsx` is shrink-only — so the row was extracted at net-zero lines.
**Not device-verified, and the strap's live path has never executed:** `getPolarBle()` returns null
off-device, so every reading in every test came from the store. **Two things are the owner's:** the
scale (new Kotlin BLE, flagged a stretch) and whether the header's manual refresh button should go —
measured, it does **not** bump `refreshTick`, so it is strictly narrower than pull-to-sync
([journal](docs/overview/entries/2026-09-02-feat-home-device-battery-chips.md)).

**A day's dose is a sum of contributions, not a tick (BF-69 stage 1).** `supplement_logs` held one
row per substance per day, enforced by a unique constraint — so a dose carried by a logged meal and
one ticked by hand were **last-writer-wins**, and unticking wiped the day whoever had written it.
That is silent data loss the moment a second writer exists, and the meal attachment is that second
writer. Each act of taking something is now its own row with a `source` and, for a meal, the
`food_logs` row it came from; the day's amount is **derived on read**, never stored. What replaced
the constraint is a *partial* unique over `source = 'manual'` — the tick stays idempotent under a
double-tap or a replayed outbox mutation, while the same meal logged twice counts twice, correctly.
`supplements` also gained `started_on`/`stopped_on`, which is what makes **"forgot to log it"
distinguishable from "did not take it"**: outside the window is a true zero, inside it with no
contribution is *unknown* and must be excluded rather than counted as 0. **Nothing can write a
number yet** — that is stage 2, Lane B's, and until it ships production still holds 2 supplements and
1 log ever. **⚠ Not device-verified**, and the local v34 migration rebuilds a table rather than
adding a column ([journal](docs/overview/entries/2026-09-01-supplement-contributions.md)).

**A CI flake had a cause, and `main` gets a nightly (LB-31).** `anchor-source.test.ts` failed once
on CI and nowhere else; an hour had already gone into it. The entry's diagnosis was half right — the
second test's own sleep row does let the route build and persist a readiness that out-ranks the rung
under test — and the missing half is what made it unreproducible: the build is also gated on
`!todaySnapshot`, and **the route's snapshot write is fire-and-forget**, so the whole file was
passing on a race between an unawaited write and the next test. **Reproduced on demand** by running
the second test alone, where test 1's snapshot never exists. Separately, `ci.yml` now runs `Tests`
against `main` nightly (every other job skipped on that trigger, so a night costs one job) — a PR is
green against the `main` it was cut from, and nothing re-checked the combination after several
landed; a failure now names `main` and the merge window instead of the next contributor's PR. **The
no-`push` decision is untouched**
([journal](docs/overview/entries/2026-09-01-verify-main-nightly.md)).

**Test files are typechecked now, and they never were (LB-37).** `tsconfig.json` excluded
`**/__tests__/**`, so across ~700 specs a test could reference a type that does not exist or assert
against an interface that had since changed shape and `tsc` said nothing — which means the sentence
*"tsc clean"*, the first gate every session runs, **carried no information about any spec**. The
split is exact: the base project reports **0** errors, the same project with the exclusion dropped
reports **320 across 90 files**, and every one is in a test. Shipped as a shrink-only per-file
ratchet (`tsconfig.tests.json` + `scripts/check-test-typecheck.js`), so every NEW spec is checked
immediately and the 320 come down as files are touched. **A real broken reference is already
confirmed** — `lib/__tests__/ai-dynamic.test.ts` imports `../types/program`, which does not exist,
and the spec passes. Two placement calls: a **second tsconfig** rather than editing the one
`next build` reads, and the step in **Build** rather than Custom Rules, which installs nothing and
would have failed CI on the entry's own suggestion
([journal](docs/overview/entries/2026-09-01-typecheck-tests.md)).

**⚠ One decision is waiting on the owner: whether the E2E job becomes a required check (Q-297).**
**Measured rather than read — it is NOT required today:** PR #776 merged while its E2E job was still
`in_progress`. LA-22 has since made the job always-run and always-report specifically so it is safe
to require, so the only remaining question is whether to, and it is **branch protection** — a shared
system, not a lane's to change. E2E takes 15–40 minutes and catches real bugs; requiring it makes
every merge wait for it. Alongside this, `e2e/plan-rescale.spec.ts` closes **LB-51** (the plan card
had no e2e at all, because the seed builds no meal plan and logs no food), and Lane B's READY queue
went from 11 entries to 5 — three of the six removed were split or reclassified rather than finished
([journal](docs/overview/entries/2026-09-02-docs-lane-b-queue-hygiene.md)).

**The meal plan recalculates against what you actually ate (Q-187).** The owner's held-back
sentence — *"if you eat too much during lunch it will cut some portions for other meals or vice
versa"* — with the gate answered the same day: *"if choosing one then spread is fine."* The day's
overshoot or shortfall is spread across every remaining meal **at read time**, each row showing the
adjusted figure with `(planned N)` beside it. **The floor is the half that keeps it usable:** a meal
that would drop under 250 kcal is left as planned and the card says why, because a plan that says
*"eat 180 kcal for dinner"* is ignored once and then always. **The entry pointed at the wrong set** —
`fillableMeals` answers which meals are *due enough to log now*, which is the opposite of what is
left to eat; using it would have handed a skipped lunch's calories to dinner. Nothing is stored and
nothing is logged. **Not device-verified, and there is no e2e** — the seed creates no meal plan and
no food logs, so the whole plan card is unreachable from the harness (**LB-51**); the three states
were driven by hand against the local database instead
([journal](docs/overview/entries/2026-09-01-feat-q-187-plan-rescale.md)).

**The walk pacer reads speed now rather than the whole walk (LA-52).** `appendPoint` set
`currentPaceSecPerKm` from cumulative distance over cumulative elapsed and the screen fed that
straight into `readPacer`, so the speed rung's input was the **average speed of the walk so far**.
Twenty minutes in, a surge or a slow-down moved it by almost nothing; `STOPPED_KMH` could never fire,
because standing still cannot drag a whole-walk average below 1.5 km/h; and warm-up, fast and slow
all banded against one drifting number. `windowedSpeedKmh` now reads the last **20 s** of
`rawPoints`, carried on the store as `recentSpeedKmh`. **The entry missed half of it: the big
on-screen km/h was the average too** — under a comment claiming both figures came off one series —
so a walker reading 4.8 km/h mid-walk was reading their average since starting. That number is live
now and the min/km beside it is labelled `avg`. **`e2e/walk-pacer-speed-rung.spec.ts` asserted the
two were one number in two units and was updated in the same PR**, since that claim is now false by
design. **Not device-verified** — slowing mid-segment and stopping at a crossing are LB-36's device
checks 2 and 3, which could not have passed before this
([journal](docs/overview/entries/2026-09-01-fix-la-52-windowed-walk-speed.md)).

**A Recommended value under every goal field, and no model behind it (BF-101).** The owner asked
for one and assumed AI: *"id assume we use AI here to choose but maybe we could have some logic to
decide so not using the ai if not needed?"* It needs none — `calculateBaseline` already returns a
deterministic figure for every field on that screen except sleep, and the AI route computes that
same baseline before asking a model to *adjust* it. The control now sits under steps, water and
calories, plus protein, carbs and fat in Macro Targets, each naming where its number comes from.
**The matching state is half the feature:** the entry was filed on live drift — the steps goal held
**7,000**, the *sedentary* figure, while the activity level said Moderate, whose target is
**10,000**, and nothing on screen said which fields followed the recommendation. **The measured RMR
is carried through** rather than dropped, so the button cannot quote a predicted resting rate on a
screen whose Health card shows a measured one. **Sleep and fiber get no button** — `BaselineResult`
carries no figure for either, and the guard pins that. **Not device-verified** — six controls land
in an already-dense collapsible at 412 dp
([journal](docs/overview/entries/2026-09-01-feat-bf-101-recommended-values.md)).

**One name for the saved list — `My Foods`, everywhere (BF-103).** The owner overrode the entry's own
proposal and was right to: it suggested `Saved` for the tab with `My Meals` left on the button, which
is a *second* name, and **the historical failure was never the wording — it was two labels for one
list.** *"we only need one. lets go with MyFoods."* It also describes the contents honestly: 5 of his
10 saved meals hold exactly one item. Eight files carry the strings, including an **`aria-label`** a
rename would leave saying a name the screen no longer uses. **The two comments from BF-37 and BF-60
that read as a standing prohibition on the name are rewritten** — left alone, they are what the next
session reverts this on. **The guard found what the entry's file table missed: twelve e2e spec files
asserting `My Meals`**, which would have broken CI on the next run rather than at review. It also
pins the strip at `Recent · My Foods · Search`, because `My Foods` was once a *merged* list and that
revert was about the merge, not the name. **Not device-verified** — `My Foods` is longer than `Meals`
and three tabs share the width ([journal](docs/overview/entries/2026-09-01-fix-bf-103-my-foods.md)).

**The queue tool stops pointing Lane A at another lane's finished work (LA-53).** `next-item.js`
reads an entry's `Lane:` field and nothing re-reads it when the remaining work moves lanes, so
**Q-535 headed Lane A's READY list for two weeks** after its Lane A half shipped. An advisory note in
`check-backlog-pointers` now names any entry that contradicts itself that way — 0 on the current
tree, and it fires on Q-535's real pre-fix state. **The rule reported its own documentation twice**
before the two exclusions were added (undated prose describing the shape; a dated citation of another
entry), which is the concrete reason it prints rather than fails
([journal](docs/overview/entries/2026-09-01-lane-drift-note.md)).

**A fixture that misrepresented production closed one finding and opened a doubt about a shipped fix
(LB-46, LB-47).** LB-46 — the AI Prescription card showing pre-deload numbers — **is not a bug**:
`reevaluateForToday` self-reverts a per-exercise deload once the soreness clears, and the card was
rendering the result faithfully. The tell was on screen and missed: the card suppresses its
intensity-zone chip when an exercise is deloaded, and the chip was showing. **The fixture merged two
mechanisms production keeps apart** — of 5 stored prescriptions, 1 has a session-level deload, 2 have
per-exercise deloads, **0 have both**. A session deload bakes low intensities into the LLM's own
pcts; a per-exercise deload is an overlay with a `preDeload` to undo. **⚠ Which means BF-64's
override, shipped hours earlier, may revert nothing on a real session-level deload** — it reused the
per-exercise mechanism for the session-level case, and on the only real such row there is no
`preDeload` to go back to. Not reverted: nothing regressed and the per-exercise path works. Filed as
**LB-47** with three candidate answers, the cheapest being to disable the toggle on a session deload
and say why. **The lesson is cheap and was available all along:** check a hand-built fixture's shape
against production *before* verification leans on it — the `db-query` call that settled this took two
minutes ([journal](docs/overview/entries/2026-09-01-docs-lb-46-closed-lb-47-filed.md)).

**Back navigation returns to where you were (BF-100).** Owner: *"when I press back I want to go back
to that page at the same scroll level I was at. It usually starts me at the top of the page. This is
on many pages if not all pages."* **"If not all pages" was right, and there was one cause** — the app
scrolls an inner container, Next's restoration watches the window scroller, and nothing bridged them.
One hook in `pull-to-sync.tsx`, so every screen on the shell inherits it. **Six implementation traps
and four spec traps are written into the entry and the code**, because every one produced something
that runs and achieves nothing: two separate StrictMode double-invoke failures (a consumed `popstate`
flag; a cleanup writing 0 over a pending target), `scrollTop` reading 0 on a node React has already
detached, scroll anchoring pushing the restore 144–231 px past the mark, a takeover check that
mistook that settling for a finger, and a page that comes back shorter than it left. **All four spec
failures reported the same line a broken feature would**, which is why the spec now asserts its own
preconditions. `e2e/scroll-restoration.spec.ts` is green on a cold server. **Not device-verified** —
the system back gesture is not `page.goBack()`, and WebView scroll anchoring may differ from
Chromium's, which matters because anchoring was one of the traps
([journal](docs/overview/entries/2026-09-01-feat-bf-100-scroll-restoration.md)).

**The calorie line called a goal deficit part of the base rate (BF-99).** Owner, with a screenshot:
*"why is my base rate under the 1350 RMR value."* `budgetProvenance().base` is
`restingBaseKcal + targetNetKcal` — the resting base with the goal delta already folded in — and the
line printed it beside the word *base*. On a recomp that is ~200 below his measured RMR, so a goal
choice was presented as a metabolic fact. **Every number on the screen reconciled**, which is what
made it worth fixing rather than explaining: correct maths described incorrectly sends someone
hunting a bug that does not exist. Now `1,972 base − 200 for your goal + 1 earned from movement`,
collapsing to `1,972 base + …` on maintain. Split in the component, **not in `budgetProvenance`** —
that is shared, and one combined number is right for a caller that wants one. **The floor and the
goal maths were not touched and should not be.** The second half shipped too: the measured RMR is
re-scaled onto current lean mass rather than used raw, and nothing said so, so a measurement the
owner paid for looked ignored — one line on the RMR form now says what the app does with it.
**Not device-verified**; the line gained a clause and Home's copy is `compact`, so wrapping at 412 dp
is unchecked ([journal](docs/overview/entries/2026-09-01-fix-bf-99-base-label.md)).

**`Full · Override` now overrides something (BF-64).** Owner: *"pressing full or deload doesnt change
the 'prescription' not sure if its over writing it."* It was overwriting **in one direction only** —
`session-data.ts` applies the deload override inside an `else if` that runs only when the exercise is
not already deloaded, so the pipeline could ADD a deload and never remove one, while the toggle
rendered the word **Override**. Worse than the BF-8 bug it descends from: that was the toggle
disagreeing with the card, this was a control that did nothing. Session-level `Full` is now the
per-exercise revert applied to every deloaded exercise — the machinery was already on the device, so
no LLM call, no 429 budget, works offline. **All three of the entry's warnings held:** the override
keys on an *explicit* choice (keyed on `!deload` it would flash full weights on first render); an
exercise with no `preDeload` stays deloaded **and the card names it**; and 1RM accounting follows
without a separate change, because the revert clears `deloaded` and the completion path already reads
the reverted array. Five mutations, five failures, including that last one.
**Verified only against a hand-built fixture — the local seed has no `ai_dynamic` program and zero
prescriptions, so the path is unreachable out of the box — and NOT on device**, which is where
completing a set under each toggle position would show the 1RM actually count or not
([journal](docs/overview/entries/2026-09-01-fix-deload-full-override.md)).

**The e2e README told spec authors the opposite of what was measured (Q-354).** On Nutrition a
`.click()` is swallowed and gives no clue — no toast, no request, no error, just silence — while a
touch works every time; the cause is the date-swipe `useDrag` on the scroll container, and it is
deliberately unfixed because touch is the only input the canonical runtime has. The README said
*"a real touch sequence does not open the water sheet while a synthesised `click` event does"* —
Q-309's pre-measurement suspicion, never updated when `water-log-write-path.spec.ts` measured the
reverse the same week. **A wrong signpost costs more than none, because it is followed:** anyone
hitting a dead tap would have concluded touch was broken and reached for `dispatchEvent('click')`,
the workaround that spec had deliberately abandoned. Corrected, along with that spec's own
*"the gesture code is not implicated"* conclusion, which reasoned about the touch path while
`useDrag` binds mouse too. **Q-354 is now a `Reference:` entry** — its own text says *do not pursue*,
and while it sat in READY it headed Lane B's work list, offering every session a build it argues
against ([journal](docs/overview/entries/2026-09-01-docs-q354-nutrition-tap-gotcha.md)).

**A score-ring arc that could not be drawn is gone (LA-42).** `ScoreDisplay` took a
`trainingBoostFrom` and drew a second brand-coloured arc for the share of an activity score that came
from a same-day training blend. `blendActivityScore` went with Q-284, so `adjustment` is a literal 0
at **both** of that payload's construction sites and the branch was unreachable. **Not a
regression** — the blend last had an Oura score to adjust on 2026-07-07, the re-key day, so it had
been dead in practice for two months; Q-284 made it dead by construction, which is the difference
that licenses a deletion. **No guard and no version bump, both deliberate:** the invariant a test
could pin lives in Lane A's file and would block the revival it is meant to protect, and nothing a
user can see changed. All three score screens re-rendered with their rings intact
([journal](docs/overview/entries/2026-09-01-chore-la-42-drop-dead-training-boost.md)).

**The device consoles have one home, and the BLE page is a runbook (Q-531).** Owner, running the
re-sync: *"it was moved away from the admin section = bad"* and *"everything is spread out
sporadically."* **The first half was already false and checking it changed the work:** all three
consoles were routed under `/admin` and `isAdminUser`-gated the whole time — Q-234 moved the *links*
to Settings → Developer, so the owner went to `/admin`, found nothing listed, and reasonably
concluded they had left. A **reachability** defect, needing the opposite fix from the one the entry
proposed; building it as written would have been a no-op dressed as a security fix. `/admin` now has
a **Devices** tab, `/admin/oura-ble` is six numbered sections in §4-of-the-runbook order instead of
fourteen stacked consoles, and Settings → Developer keeps Diagnostics only.
`device-console-access.test.ts` pins the gating, the reachability, the one-home rule and Q-544's
card ordering — five mutations, five failures. Non-admin redirect verified on all three routes.
**Not device-verified, and here that is most of the value** — every console below step 2 needs the
native plugin, so the structure was checked and the flow was not
([journal](docs/overview/entries/2026-09-01-fix-device-console-ia.md)).

**The screens show the DEXA-corrected body fat now (LA-45).** BF-2 step 4 put
`bodyFatCorrected`/`bodyFatIsCorrected` on every row of `/api/body-metadata` and `/api/day-log`, plus
the offset once per response — and **nothing read any of it**, so Health showed the raw 18.4 while the
calorie goal was already built from the corrected 21.6. Seven surfaces now go through one rule
(`components/health/body-fat-display.ts`), and the card says why its number differs from the scale:
`DEXA-corrected +3.2% · 1 scan compared`, with `3 of 4 corrected` on a window that mixes instruments,
because two thirds of the history is on instruments the offset does not cover. **Two invariants hold
it and both are easy to reverse:** `bodyFat` stays what the log sheet seeds from (it POSTs at `manual`,
which outranks `scale_ble`, so a corrected value round-tripped through the edit sheet would overwrite
the measurement permanently), and "corrected" is never inferred from the values differing, since an
offset can round to zero. Verified on `pnpm dev` against a hand-seeded DEXA pair — the local seed has
none, so the whole path is unreachable without one — including the case that matters: the card read
21.6 while the log sheet seeded 18.4. **Not device-verified**, and the local-store fix inside it is
only reachable on the APK
([journal](docs/overview/entries/2026-09-01-feat-la-45-corrected-body-fat-display.md)).

**The More page is two groups, not nine (BF-82).** Owner: *"a review of all the pages/chevrons in
the More page and reorganize/group things together that can be. It’s very messy and not very
organized."* `MoreRowGroup` is an uppercase heading plus a bordered container, and **nine of them
wrapped exactly one row** — seven on the tab, one on the Settings sub-screen, and one hand-written
copy in `feedback-section.tsx`; `goals-section.tsx` was a tenth copy, which is what made an inline
disclosure look like the navigating rows below it. Now: `Your setup` and `App`, each covering three
or four rows; `label` is optional on the primitive so one row can be a plain card; Report an Issue
moved to the bottom actions where the other sheet-openers are; Goals presents as a card like
`StatsGrid` and `TrophyCase` above it, with its disclosure untouched.
`more-row-group-arity.test.ts` fails a labelled group under two rows and was mutation-verified.
**Destination parity was clicked, not read** — all seven rows still land where they did, admin and
non-admin. **Not device-verified**, and the bottom actions row moved, so the clearance under Sign Out
is unseen; BF-82 stays queued on `Verify: device` and nothing else. **The *"sliders"* half is
answered — the word was loose:** *"yes it wasnt the sliders specifically; more that its messy and
needs re'organisation."* No control changes, and none should be made off the original wording —
More and its six sub-screens carry no slider and no `<select>` at all
([journal](docs/overview/entries/2026-09-01-feat-bf-82-more-page-grouping.md)).

**The Home pill that "moved" had not moved, and a swipe marker nothing read (BF-96, BF-95).** Owner:
*"I dont like how the temperature/uV pill sits. can we go back to the old way when it was side by
side."* It was already side by side — it was **wrapping**, because the header row's other item (the
date) carries `whitespace-nowrap shrink-0` and the chip carried neither, so the chip absorbed every
shortfall and `UV 5` broke at its own space. Measured against a real render, `EEEE d MMMM` runs
**12–22** characters (*"Wednesday 30 September"*), correcting the entry's own 12–20 — so *"the old
way"* is the same code on a shorter date. Separately, `swipe-actions.tsx` declared
`data-swipe-actions` and the tab navigator's exclusion list never read it: latent rather than
impossible, since the navigator arms within 24 px of the edge and meal rows reach it. **Neither is
device-verified, and the chip cannot be — the seeded sandbox has no weather snapshot, so only the
skeleton renders** ([journal](docs/overview/entries/2026-09-01-chip-wrap-and-swipe-marker.md)).

**A meal section holding one combined meal printed its macros twice (BF-98).** Owner: *"the combined
item UI doesnt look great with the double macros at the bottom."* The totals footer was gated on
`logs.length > 1` — the flat list — so a group of three ingredients passed it and the section drew
the group's own macros and then the identical footer, calories included. It counts **rendered
entries** now, which is the rule the collapsed branch twelve lines above already followed.
**⚠ The duplication could not be reproduced in e2e** — `diary-nested-meal.spec.ts` seeds this exact
case and the footer does not render there on either condition, so a test written against it passed
with the fix reverted and was deleted rather than kept as a guard that cannot fail. The change is
right by reading and is held by a mutation-checked source guard; **what differs between the owner's
diary and that fixture is an open question recorded on the entry.** **Not device-verified**
([journal](docs/overview/entries/2026-09-01-double-macros-footer.md)).

**The app notices the day changed on resume, without restarting (BF-86).** Owner: *"when I open the
app in the morning and it just resumes, it doesn't give me the morning check-in."* The cause was
structural — the tab shell never unmounts, so an effect keyed on `[userId, tz]` ran **once per app
launch** and nothing re-asked what day it was. `LocalDayProvider` re-evaluates the local date on
mount and `visibilitychange` and exposes it as a value, so subscribers key an effect on it: the
workout store's `todayLogged` (which is where the listener came from — it moved up rather than being
copied), the check-in prompt, and the today-mood read. **The requested "close / full reset" is
deliberately not built** — BF-80 forbids fixing a resume with a reload, and the signal delivers the
ask without trading instant paint for a spinner. The e2e test drives Playwright's clock across local
midnight so the case fires on every run; **its first version passed with the fix reverted**, because
`isVisible()` is a point-in-time check and not a wait. **Not device-verified**
([journal](docs/overview/entries/2026-09-01-local-day-rollover.md)).

**A peaking week stops reading as a volume deficit (BF-59, the screen's half).** Owner: *"i did the
full sessions for the week; and i was nowhere near hitting the reccomended amount of muscle sets"*,
then the cause in their own words — *"oh yes cause its realization phase its been less sets."* MAV is
an **accumulation** target, so showing it during a peak tells an athlete that doing the right thing is
wrong. **Both halves were measured in production first:** the stored targets are a flat binary (15
rows, all 14 or 10) that ignores both the per-muscle landmark table and the program's `powerbuilding`
×0.8, and the ten sessions span **three phases at once** — which is what makes "this week's phase"
unstorable, since phase lives per program session. The Training card's target is now **derived** —
`volumeLandmarks(goal, muscle)` scaled by the week's phase mix, weighted by sessions actually
trained — and `/api/weekly-muscle-sets` returns the `phase` block behind it. Multipliers are the
owner's (accumulation 1.0 · intensification 0.8 · realisation 0.6 · deload 0.5). **Two things are
owed and both are on the entry:** `signals.ts` still steers the AI's set prescription off the stored
binary, so **engine and screen now disagree** where before they were wrong together; and the card
does not print the phase yet, which is Lane B's half and the half the owner explicitly asked for.
**Not device-verified**
([journal](docs/overview/entries/2026-09-01-phase-aware-volume-targets.md)).

**A scanned meal now carries a group and a name — the engine half (BF-97, migration 252, local
SQLite v33).** Owner, with two screenshots: *"looks like saved meals groups the food well; but when
scanning it doesnt."* BF-39's grouping was right and did not cover this: it names a group from its
`saved_meal_id`, and `groupDiaryEntries` **refuses to head a group it cannot name** — so a scan, which
has no saved meal, cannot group. `food_logs.meal_group_name` is that name, denormalised onto every
row for the same reason `meal_group_id` already is: a group **is** the rows sharing an id, and the
local store must draw the header offline with no join. `logFoodEntries` mints a group **only**
alongside a name and **only** past one entry — both negatives are asserted, because a group of one
renders as a meal for a frame and then does not, and a nameless group rebuilds the bug one layer
down. Five mutations across the write/delta/push chain, five caught. **Nothing looks different yet
and that is deliberate:** the rendering rule is Lane B's half, so this cannot half-break the diary.
**Not device-verified**, and the local-SQLite half is verified by reading rather than running
([journal](docs/overview/entries/2026-09-01-scan-meal-group.md)).

**Blood panels are stored, de-identified (BF-1, engine half — migrations 250/251).** The schema is
written from the owner's real 58-analyte report rather than a description, and four shapes in it broke
every simpler design: `<0.2` is a result that is **not a number** (`value_num` + `value_operator`),
ranges arrive two-sided, one-sided in both directions and absent (both bounds nullable), the date is
a **month** (a precision column, or every panel lands on the 1st and lies), and flags are commentary
— *"Normal (athletic)"* on a creatinine inside its range — so **out-of-range is derived from the
bounds, never read off the flag**, with `unknown` as a real answer where a bounded result cannot
decide. Two guards fired and both were right: the `claude_ro` generator refused to emit an unscoped
view for the child table, and the dead-method check rejected a repo method whose consumer this PR
does not contain. **The extraction route, the consumers and the whole UI are still owed**
([journal](docs/overview/entries/2026-09-01-blood-panel-storage.md)).

**21 MB of index for a code path nothing calls (BF-55, migration 249).**
`oura_heartrate_user_updated` was migration 130's keyset index for `getOuraTimeseriesDelta` — the
restore pull Q-180 kept with no caller because *"it costs nothing at runtime"*. True of the method;
the index was never in that accounting. Measured twice a day apart: **`idx_scan` 0, `idx_tup_read`
0, 21 MB** — a quarter of the database's whole index budget — while the same table's other index
showed **47,922 scans / 22.7 M tuples**. Dropped with the owner's conditional approval; the method
and its tests stay, and its doc comment now carries the `CREATE INDEX` the restore driver must run.
**The entry falsified its own rule and that is the durable part:** `idx_scan` counts reads, not
constraint enforcement, so three of its four zeros were PK/UNIQUE indexes — `rr_intervals_pkey` read
0 one day and 5,034 the next ([journal](docs/overview/entries/2026-09-01-drop-unused-hr-index.md)).
**Steps count from the first one (BF-88, v1.418.0).** The first 3,000 steps of every day used to
earn nothing, because the resting base already assumed a desk day's walking. The owner asked the
version of the question that works — *"cant we remove some calories for the base 3000 and have it
start from 0 steps?"* — and that is what shipped: the credit comes out of the base, the steps are
counted. **A day at 3,000 steps burns exactly what it did before** (verified live: base 2087 +
active 110 = 2197, the old base to the kcal); below it the day drops, which is the point. The
calorie target does not move. `STEP_BASELINE` is renamed `STEP_BASE_CREDIT` because a test pinning
3,000 cannot notice a change of meaning, and the rename is what found the three copy sites BF-87
had shipped hours earlier. Two mutations survived their first tests — the credit applied on the
calibrated path as well, and the credit taken off the maintenance target too, which cuts recommended
intake by ~100 kcal a day and passes every relative assertion. **Not device-verified**
([journal](docs/overview/entries/2026-09-01-step-base-credit.md)).

**The E2E harness already looks; what it cannot do is take a photo (BF-91).** The entry read *"58
specs assert nothing visual"* — **21 of the 58** assert layout, and the four flows it named already
have dedicated specs. What is genuinely absent is pixel baselines, and a session cannot make one:
the sandbox Chromium is **141** while CI installs **151**, so a committed baseline fails on its first
run. Split out as LA-50 with what a CI-side job would cost. The real gap was BF-73, whose measured
numbers sat in its `Keep:` and nowhere else — now pinned as ratios, along with the finding that
`globals.css`'s bare `button { min-height: 48px }` is what lifts those controls off 44. **Deleting
that one CSS line turns the spec red**, which no source-level check on the classes would notice
([journal](docs/overview/entries/2026-09-01-e2e-layout-assertions.md)).

**The prune that was working, and the retraction that matters more than the entry (BF-93).** A
session reported `error_events` never prunes — no `DELETE`, no cron, no trigger — and wrote that
into CLAUDE.md, the file every session reads first. The `DELETE` is in `insertErrorEvent` and has
been there since the initial public snapshot. **The evidence for the finding was the prune working:**
it fires from a write path, not a scheduler, so it runs only when a fault is recorded, and faults are
now rare — measured, last write **2026-08-30**, oldest row **2026-07-31**, span exactly **30 days**,
the cutoff computed from the last write to the day. Reading the age against *today* instead is the
whole mistake. CLAUDE.md is retracted, `export-map.ts` was right and is untouched, and a behavioural
test now pins it because **a grep is what failed the first time**. Owner confirmed: leave the prune,
skip the message truncation — under a working prune those rows age out on their own
([journal](docs/overview/entries/2026-09-01-error-events-prune-refuted.md)).

**A chosen rest day is a fact now, not a `localStorage` key (BF-84, engine half).** The route it
posted to persisted nothing — its own comment said rest is inferred from gaps in workout history —
so the choice never reached the server, the second device never saw it, it died on a reinstall, and
refetching `/api/next-session` reverted it. Owner settled it as a fact: *a day with no logged
workout is also a day you forgot, were ill, or logged late.* `rest_days` (migration 247) holds it,
tombstoned on withdrawal, written through a new `rest_days` outbox domain so an offline choice is
carried, and `getNextSession` prefers it over inference — after already-trained, before the
readiness branch that would otherwise offer a deload on a day you said you were resting. **The
surface half is Lane B's and still owed**; the storage shipping first is what makes the new button
safe. **Not device-verified**
([journal](docs/overview/entries/2026-09-01-rest-day-stored.md)).

**A gate that did not gate, and the count the owner was given (BF-90).** Asked whether his
decisions were the bottleneck on the queue, the answer is **10 of 41** — device verification was the
other 31, and eleven of those sat on entries whose own headings said *"shipped; device check owed"*.
`Gate:` parks an entry, so finished work was filed beside work that cannot start. `Verify: owner` /
`Verify: device` is now the second meaning, with its own section that does **not** park; `Gate:`
means blocked, uniformly. **Seventeen converted, not eleven** — `keepKind` found six more from their
own `Keep:` residue. PARKED 114 → 97, READY and KEEP unchanged. The larger half is measured and
deliberately deferred: **34 entries carry a `⛔` and only 7 mean blocked**, but narrowing that
detector would move 16 untriaged entries into READY, so it is filed as LA-49 with the order to do it
in ([journal](docs/overview/entries/2026-09-01-verify-vs-gate.md)).

**An account with a password could not change it (LB-40).** `EditProfileSheet` initialised
`hasPassword` to `false` and **nothing fetched it**, so the *Current password* field never rendered,
the PATCH went up without it, and the route answered *"Current password is required."* — an error
naming a field that was not on screen. The flow was non-functional for every account with a
password and worked only for one with none. The flag is fetched now, through the key the More tab
already warms; **unknown shows the field**, because `cachedFetch` swallows a failed request and
landing back on `false` would reproduce the bug silently. All four route paths exercised live.
Found by reading during BF-79, not by looking for it. **Not device-verified**
([journal](docs/overview/entries/2026-09-01-current-password-field.md)).

**A display constant stops being a copy, and the leaf module it moved into already existed
(LB-43).** BF-87 took the Nutrition tab to a 500 fetching `STEP_BASELINE` for a line of copy —
`daily-energy` → `workout-energy` → `oura-models/constants` reaches `node:fs/promises`, and
Turbopack refuses the client chunk. **The same chain broke the same tab before** (Q-401, with
`node:path`), and the fix then was `energy-baseline.ts`, a leaf module importing nothing. The entry
proposed creating `energy-constants.ts`; that module already was it, so the three constants moved
there instead of standing up a second leaf module for one purpose. **The drift test that guarded
the mirror is now tautological and was replaced** — a re-export cannot disagree with itself — by
the invariant nothing else checks: `energy-baseline.ts` imports nothing at all, which is the only
property keeping it client-importable and the one that broke twice
([journal](docs/overview/entries/2026-09-01-energy-constants-leaf.md)).

**Two settings that did nothing, both decided by the owner (LB-41, LB-29).** The **Kg / Lbs switch**
was `useState('kg')` — never persisted, never read, reset on every reopen, and nothing in the app
renders pounds; removed rather than left offering what it could not do, with real unit display
filed as the feature it would actually be. And **a setting could be overwritten by the server's
older copy**: `savePreference` PATCHes fire-and-forget, so a reload before it landed was answered
with the previous value — permanently offline, where the PATCH never lands. The owner chose *the
change follows to other devices* over the simpler never-clobber rule, so hydration now skips a key
whose PATCH is unacknowledged and **re-sends** it, which self-heals offline on the first launch with
a network. Verified in a browser with the PATCH held open: the choice survives the reload. **Not
device-verified** ([journal](docs/overview/entries/2026-09-01-settings-that-did-nothing.md)).


**The calorie bar says why zero is zero (BF-87).** Owner: *"is basic steps being counted towards
calorie burn? It says I've done 1000 but not sure if that's counting towards nutrition."* The app was
right and the screen could not say why — only steps above 3,000 earn calories, because the sedentary
base is already BMR × 1.2 and a desk day's stepping sits inside it. The zero line now names the
threshold, the earned line breaks into workouts/activity/steps, and both "calories out" explainers
quote the same number instead of "a baseline". The breakdown was first built with largest-remainder
apportionment; re-reading `daily-energy.ts` showed `computeActiveEnergy` **already rounds all three
parts** and `total` is their sum, so that was guarding a case its producer cannot produce — deleted,
and replaced by a test pinning that guarantee against the real function.
Importing the constant took `/nutrition` to a **500** — `daily-energy` → `workout-energy` →
`oura-models` reads `node:fs/promises`, and no client component had ever imported it — so the value
is mirrored with a test that fails if it drifts, and **LB-43** (Lane A) proposes the leaf-module split
that deletes the mirror. **Not device-verified**
([journal](docs/overview/entries/2026-09-01-steps-threshold-copy.md)).

**The personal details are one screen, and one writer (BF-79).** Owner: *"can we combine all the
personal information fields into 1 section in the more/details."* They were split between the Edit
Profile sheet (display name) and the Goals accordion (height, birth year, biological sex) — and
until BF-78 each editor resent the other's fields from a possibly stale copy. `More → Profile
details` (`app/more/details/`) now holds all four, with **weight and body fat read-only** beside a
link to where they are logged — an input there would open a second write path into `body_metrics`.
Targets and activity level stayed in Goals, so the split closed rather than moved, and Goals gained
an *Open Profile details* button because it still demands fields it can no longer edit. Reading the
same two components filed three findings rather than fixing them — **LB-40** (a user who already has
a password *cannot change it*: the form never renders the field the route requires), **LB-42** (two
columns for one weight goal, with different readers, so the number the user sees and the one the AI
is told can differ — Lane A), **LB-41** (a Weight Units toggle with no consumer). **Not
device-verified** ([journal](docs/overview/entries/2026-09-01-personal-details-consolidation.md)).

**The quantity box on Assign to Meal centres (BF-85).** Chromium draws the spin button inside the
box, so `text-center` sat left of centre; and `text-sm` was inert under `globals.css`'s
`input { font-size: 16px !important }`. The entry's own fix — use the shared `Input` primitive —
was wrong: **1 of 28** `type="number"` inputs uses it, and neither quantity control does. **Not
device-verified** ([journal](docs/overview/entries/2026-09-01-quantity-box-spinner-reset.md)).

**One weight goal, one column (LB-42).** `users` carried **two** columns for one goal:
`weight_goal_kg`, edited on the profile sheet and quoted to the nutrition coach as *"goal weight"*,
and `target_weight_kg`, edited in Goals and the one the Health page actually renders. The number the
user sees and the number the AI is told could differ with nothing reconciling them. Migration 246
fills the survivor **only where it is NULL** — a value the user cannot see never overwrites one they
can — and the API keeps its `weightGoalKg` field name while reading and writing
`target_weight_kg`, which is what let both editors converge with **no client change**. **The retired
column is NOT dropped**: nothing reads it, but dropping is irreversible and the row-scoped audit
view cannot show other accounts' values, so that is the owner's call. Honest about the evidence —
the owner's two columns **agreed**, so this closes a hazard rather than an observed wrong number
([journal](docs/overview/entries/2026-09-01-one-weight-goal.md)).

**The deload banner stops firing off a temperature baseline that is known to be wrong (TN-18).**
The owner's 06:43 screenshot held both halves of the same broken baseline for one night: the
readiness contributor scored temperature **80/100** off `temp_dev_c` = 0.519 °C, while the deload
banner read the same number and said *"Body temp elevated — rest or deload recommended"*. TN-6a
suspended the ladder in readiness and its own entry said the suspension must cover all three
consumers; it covered one, and it was the path the owner does not read. The banner now takes the
same `isTemperatureBaselineCentred` condition — imported, not re-derived, since two answers to "is
temperature trustworthy" is what produced the disagreement — and the threshold is untouched, because
raising it is the Q-504 mistake. **The fix needed the adapter's summary read widened to 28 days,
which turned `summaryRows[0]` from *today* into *the oldest of 28 nights*; the first version of the
new test file passed with a month-stale deviation feeding the banner.** Self-clearing: it lifts on
its own once a re-derivation centres the deviations
([journal](docs/overview/entries/2026-08-31-deload-temp-gate.md)).
**Coach can be scoped to one subject, and the scope is made of what it never receives (LA-47).**
Opening Coach from Nutrition will give it the meal plan, intake and targets — and **not** the
training tools, so a program question produces a hand-off instead of a guess. Enforced three ways
the model cannot argue with: the training tools are absent, and `renderChoiceList`'s `source` and
`proposeChange`'s `domain` enums are **rebuilt narrowed per request**, so an out-of-scope call is a
schema error the SDK retries rather than a request anything downstream has to refuse. Verified
against a real Gemini turn in both directions. `general` withholds nothing, so every existing
caller is unchanged. **A bug the tests caught and review would not have:** `value in COACH_SCOPES`
walks the prototype chain, so `scope: "toString"` resolved to `Object.prototype.toString` and would
have crashed the request. **The plan-widget half did NOT ship** — the entry proposes splitting it
across lanes and that split does not compile, since a new widget-union member is a type error until
the registry handles it, and a branch rendering `null` wedges the thread outright
([journal](docs/overview/entries/2026-08-31-coach-nutrition-scope.md)).

**A dead WebView renderer is handled instead of fatal, and it now leaves evidence (BF-80).** The
owner's *"tab back into the app and the pages often crash and display a blank page"* had **nothing**
in `error_events`, and that silence is the finding: `app/error.tsx` would have painted a fallback
and filed a row for a JS exception. Reading the pinned Capacitor source settled the rest — its
`BridgeWebViewClient` **already** forwards `onRenderProcessGone`, so the app was never missing a
`WebViewClient` (which is why grepping `android/` for `RenderProcess` came back empty while the
behaviour persisted); what was missing was a listener, and the default answer it left in place is
the documented *"kill the app"* one. The handler now returns `true`, records the death with
`didCrash`, and posts `recreate()` — posted, because the callback runs with the dying WebView on
the stack, and `reload()` cannot work on a WebView whose renderer is gone. The recorded death
becomes an `error_events` row on the next boot. **Not verified: this needs an APK on the S25**, and
until that first row appears the diagnosis is still a hypothesis — but the behaviour it replaces is
process termination, so the handler is right either way
([journal](docs/overview/entries/2026-08-31-renderer-recovery.md)).

**A night that is still filling now says so, and the program builder knows you are injured
(BF-83, BF-68).** The owner sent two screenshots of the **same night four minutes apart** — 6 h 15 m
then 7 h 40 m, with the 30-night average it was compared against moving too. The entry offered two
mechanisms; the answer was a third. Production shows the batch covering the missing 82 minutes was
**recorded at 6:42**, two minutes before the earlier screenshot: the raw data was there and the
*row* was stale. So the measure is the **rollup watermark**, which only advances when a run
completes — a test against the newest ingested sample would have called that night settled four
minutes before it grew. `/api/sleep-sessions` returns `provisional` per row; the badge and
excluding a provisional night from its own average are Lane B's. Separately, `injur` appeared
**zero times** in the whole program-builder path. Both builder routes now filter the **candidate
list** — not the prompt — with the predicate the mid-workout swap sheet already substitutes by, so
the builder cannot program an exercise the swap sheet would offer to replace, and a Good Morning
(a hamstring exercise that loads the back in a secondary role) is excluded where an instruction
would have missed it ([journal](docs/overview/entries/2026-08-31-lane-a-sleep-provisional.md)).

**A logged meal stops breaking apart, and two nutrition controls stop meaning the wrong thing (BF-72/73/74/76).** The owner's *"it starts as the meal with the image, then breaks into its ingredients"* was the diary hydrating from the server and **omitting `savedMealId`/`mealGroupId`** — a local upsert overwrites every column it is given, so the screen stripped its own grouping and then rendered the stripped copy. There are exactly two `applyDelta` callers and the sync engine's was already correct, so this was the one site BF-39's audit did not reach. The meal photo's ✕ **sat where the sheet's close button would be** — and the sheet passes `hideCloseButton`, so it was the only ✕ on screen: a reach for dismiss deleted the photo. It is a bin at the bottom-right now, with undo. Capture tiles went **60 px → 79 px** and `New` now outranks a small delete bin. **Two findings came out of it that outlive the batch.** `min-h-[Npx]` **does nothing on a `<button>`** — a bare `button { min-height: 48px }` in `globals.css` beats the utility (measured: 48 px on a button, 84 px on a div), so BF-50's documented "62 px" tile actually measured 60; filed as LB-32. And **BF-76's safe-area sweep found the opposite of what it expected** — nothing in nutrition is under-padded, three sheets are *over*-padded by declaring the inset on both the content and the footer, and the `vh`→`dvh` hypothesis is not the mechanism at all, since a bottom sheet is `fixed bottom-0` and its height moves only its top edge. No padding changed: every available fix costs more than the 12–24 px it saves ([journal](docs/overview/entries/2026-08-31-nutrition-uplift.md)).



**A red check took an hour to prove innocent, and the hour is the finding (LB-31).** `body-battery`'s anchor-precedence test failed on CI in code this branch does not touch. It did **not** reproduce: the failed job re-run on the identical commit passed, and the full suite passes locally against a freshly migrated database — so it is a flaky test, **not** the red `main` the first reading suggested. The mechanism is still worth fixing: those three assertions are cumulative on one user, and the route under test calls `buildReadinessPayload`, **which persists**, so step 2's own sleep insert can land the readiness step 3 is meant to establish. The durable half is that `ci.yml` has no `push: [main]` trigger — correctly, and for reasons written into the workflow — so nothing verifies the *combination* after several independently-green PRs land together, and there is no signal that separates "flaky test" from "main is broken". That is what cost the hour.

**CI caught the defect LB-30 was filed to describe, on the exact line the fix was already written for.** `food-log-swipe-delete`'s *"the first tap on Delete opens the confirmation, **even mid-animation**"* went red: the spec read `boundingBox()` while the row was still sliding to its resting offset, then dispatched a CDP touch at that coordinate — and `Input.dispatchTouchEvent` performs none of the actionability checks `locator.tap()` does. **It passes three times over locally without the fix, which is the race's signature rather than a reason to dismiss it**; the window only opens when the runner is slow enough for the animation to outlast the read. `stableBox` is exported now with `tapCentre` beside it. The audit that came with it corrects the entry's own framing: of 32 coordinate taps, **21 sit inside a `toPass` retry and are safe**, 11 had a single measure, and **6 more feed a geometry *assertion*** — a class the entry did not cover, and worse, because a moving box gives a wrong verdict rather than a missed tap ([journal](docs/overview/entries/2026-08-31-stable-box-coordinate-reads.md)).

**Three sheets said their own name twice (LB-23).** Radix needs a `SheetTitle` for the dialog's accessible name, so each carried an `sr-only` one *beside* the visible `<h2>` — read once as the panel's name, again as a heading. `<SheetTitle asChild><h2>` is one node that is both. `quick-edit-log-sheet` keeps its `sr-only` title and is correct: its visible header is the food's name, a different string, which is why the new guard matches on the **text** rather than the class — banning `sr-only` outright would have failed a working file ([journal](docs/overview/entries/2026-08-31-sheet-title-duplication.md)).

**The exercise clip reaches the ready screen, and the fetch behind it stopped multiplying (BF-65).** The owner wanted the movement shown on the screen where they are about to do it. The work was the *fetch*: the same `/api/exercise-gif` call was hand-rolled in **four** places, so this would have been the fifth — `lib/hooks/use-exercise-media.ts` is now the only one and all four are converted. **The shared `exercise-media:<name>` key is the feature**, not plumbing: the warm-up screen fetches every exercise in the session and then unmounts, so the ready screen paints from its cache instead of showing a spinner for a file downloaded sixty seconds ago. The layout question the entry flagged answered itself — at 64 px beside the name, **`SET TARGETS` is now fully visible**, where the owner's screenshot had it cut off behind the action row. **Nothing animated was rendered at any point:** the dataset host is dropped by the sandbox proxy, so every clip here is blank — including the warm-up screen's own untouched thumbnails, which is how that was established as the environment rather than the change ([journal](docs/overview/entries/2026-08-31-exercise-clip-ready-screen.md)).

**Energy Balance was estimating a resting rate you had measured (BF-42).** You entered your RMR test on the S25 today — 1325 kcal at 51.5 kg fat-free mass — and the goal wizard started using it while the Energy Balance card kept predicting **1481**. Two screens, two resting rates. **The estimate was also the floor** under the calibrated maintenance, so it clamped the calibration up by 156 kcal: it could not report a lower number even when your own data said so. Both now use the measurement, re-scaled onto today's **DEXA-corrected** lean mass — the two sides of that re-scaling have to be on one instrument, and the raw scale reading would credit fat-free mass you don't have. **My first test for that could not have failed**: it asserted a direction on a pure function rather than what the service does, and the mutation survived it; it now asserts the exact number through the service ([journal](docs/overview/entries/2026-08-31-measured-rmr-daily-model.md)).

**Your stress strip and your stress number were two different calculations, and they disagreed about the day (BF-81).** You asked what was happening with the stress indicator. The pipeline runs — 9–14.5 hours of coverage a day, current to today — but the strip came from the rollup and the number came from `/api/body-battery`, each building its own series from a different heart-rate baseline. Re-measured before fixing: **the sign disagreed on 6 of the last 8 days**, and high-stress minutes by 4–8× (the strip saying 2–4.5 hours where the number said none). One producer writes both now. **The filed fix would have been worse than the bug**: deleting the route's write, as the entry recommended, would have left all three columns with *no* writer — the rollup only ever stored the strip — and the weekly digest reads one of them. **Two things stay open for you**: correcting the days already stored needs a full re-read of the ring's history (only 8 of 38 rows can be re-derived without it, which would leave the column more mixed, not less), and `chronic_stress_score` has never been produced on any of 106 rows — that is its documented 21-night gate needing a wide pass, not a fault ([journal](docs/overview/entries/2026-08-31-stress-one-producer.md)).

**Saving one profile field would have erased four others, and it had not fired yet (BF-78).** `/api/user/profile` is a PATCH by name and was a PUT by behaviour: display name, height, date of birth and weight goal were written unconditionally as `?? null`, so any body omitting them nulled them — and accepting an activity-level recommendation sends exactly one field. Height feeds the BMR fallback, so a single tap would have moved your calorie targets, not just cleared a profile line. **Confirmed latent**: production still holds all four. **The entry's fix would have been half of one**: the route mapped every field through `?? undefined`, collapsing "sent as null" into "omitted", so guarding the adapter alone would have traded a wipe-everything bug for a clear-nothing one. Both halves are fixed, `timezone` is explicitly the column a null must not clear (a user without one has no "today"), and **both defensive resends are deleted** — one of which was itself a hazard, resending your name from a possibly stale prop. Verified through the real route: one-field PATCH touches one field, `heightCm: null` clears, empty body is a no-op ([journal](docs/overview/entries/2026-08-31-profile-partial-patch.md)).

**The barcode picture was fetched every time and thrown away five times (BF-70).** Your scan of `LOADED MAC & CHEESE` logged with a placeholder tile — and the thumbnail had been downloaded successfully before that happened. The entry traced four layers that discard it; there was a **fifth** it had not found, the web save path. **Why it survived:** `create-food-item.ts` read the image off the sanitiser's return, which *declares* the field and never sets it — so the line that dropped the picture compiled cleanly and its own comment said it carried one. Deleting that declaration is what makes the mistake a compile error, and a new check keeps it deleted. **A `@ts-expect-error` in a test could not have held it**: `tsconfig.json` excludes every `__tests__` folder from typechecking, so type assertions written there are inert while reading as guards — worth knowing beyond this fix. Barcode scans are also recorded as `barcode` now rather than `ai`, which is why only 3 of 221 rows had ever carried the right label. **Proven against the real Open Food Facts API**: a live lookup stores a 5,359-character thumbnail and `source = barcode` ([journal](docs/overview/entries/2026-08-31-barcode-image-chain.md)).

**The DEXA correction is finished and the chain works end to end — but no screen shows it yet (BF-2, all four steps).** The correction is **+3.2 points**, derived from pairs pulled out of `dexa_scans` × `body_metrics` rather than stored, so **no new table and no migration** — and a second scan re-derives on its own: verified, offset **3.2 → 2.6** and `pairCount` 1 → 2 with no entry step, which is the accumulation you asked for. It is an **offset, not a ratio**: with one pair they agree on the measured point and diverge everywhere else, and only the offset makes no claim about readings never observed. **Entering a scan through BF-71's new form (More › Health › DEXA & RMR) makes it live with no other action** — one POST moved resting burn **1832 → 1773 kcal/day** and the calorie goal **1961 → 1889**, with `body_metrics.body_fat_pct` still reading the raw 25.3. **The safe-looking design was the wrong one:** correcting inside the shared `listBodyMetrics` read would make a missed consumer impossible, but the Health log sheet seeds from that read and POSTs back at source `manual`, which **outranks `scale_ble`** — so saving an untouched field would overwrite your own measurement and collapse the next calibration toward zero. It is applied per consumer instead, with `check-body-fat-correction.js` (Custom Rules, 64) failing CI on one that forgets — **two rules, because the calorie goal never calls a deriver at all**. The payload carries `bodyFat` (raw), `bodyFatCorrected` and `bodyFatIsCorrected` per reading, plus the offset itself. **No screen reads any of it yet — LA-45**, so your Health card shows 25.3 while your calorie goal already uses 28.5, and two numbers disagreeing on screen is worse than neither being corrected ([engine](docs/overview/entries/2026-08-31-dexa-body-fat-calibration.md), [consumers](docs/overview/entries/2026-08-31-dexa-correction-consumers.md), [payload](docs/overview/entries/2026-08-31-dexa-corrected-payload.md), [end to end](docs/overview/entries/2026-08-31-dexa-chain-end-to-end.md)).

**Your DEXA scan and your RMR test have nowhere to go — both tables are empty and neither has a form (LA-44, found while planning BF-2).** `dexa_scans` shipped 2026-08-30 with `GET`/`POST /api/dexa-scans`; `measured_rmr` shipped days earlier with `personalRmr` and its own route. Both engines are correct and **nothing in the app calls either** — no screen, no form, no fetch — so the 2026-08-27 results have sat transcribed in `docs/clinical-baseline-2026-08-27.md` for four days with no way in. **Nothing was going to catch this**: no test breaks when a table stays empty. BF-2's own plan is now written ([`2026-08-31-dexa-filter.md`](docs/superpowers/plans/2026-08-31-dexa-filter.md)) and reverses two of its assumptions — the calibration pairs are **derived** from `dexa_scans` × `body_metrics` rather than stored (a stored pair is a stored counter, and every one here has drifted), which takes the whole entry off the migration budget; and the correction is an **offset**, not a ratio, because one pair supports neither and an offset is the one that makes no claim about readings never observed. The engine can ship first and is inert with zero pairs — but nothing shows until a scan can be entered ([journal](docs/overview/entries/2026-08-31-plan-dexa-filter.md)).

**AI program generation deleted every exercise it phrased differently, and said nothing (LA-43).** The prompt tells the model to match library names exactly; the model writes *"Barbell Deadlifts"*, *"Press Dumbbell Incline"*, *"Pull-Ups"*. An exact-match filter removed each one with no trace — so a session came back short of the exercise count its own time budget was computed from, and nothing in the response, the logs or `error_events` said why. **The entry was filed against a different line and that line turned out to be dead code**: the `?? ex.mainMuscles` fallback three lines under a comment saying the model's muscles are never trusted could not fire, because the filter above it had already guaranteed a hit. Names now resolve through exact → normalised → word-order tiers and are kept under the **library's** spelling, because `personal_records` and `exercise_estimates` are unique on `(user_id, exercise_name)` and a surviving paraphrase starts that lift's history from zero. It stops short of subset matching on purpose — that would reach "Bench Press" from "Incline Bench Press", and a wrong merge is unrecoverable while a miss costs one exercise. Measured against the real 142-row catalogue: **0** names stopped resolving, and plurals went from **49 of 121 unreachable to 0**. A genuine miss is now reported; a session left empty returns 502 instead of an unusable program. **Proven end-to-end against real Gemini** ([journal](docs/overview/entries/2026-08-31-fix-generate-program-name-resolution.md)).


**Voice logging heard the owner correctly and threw it away (BF-66).** *"60 for 6"*, mid-set, transcribed perfectly and printed in red — because that red line is the *parse-failure* branch, not a mis-hear message. `parseVoice` stripped every character outside `[0-9.\s kgreps×x]`, a denylist that keeps the `r` of `for` and the `es` of `times`: **`60 by 6` and `60 at 6` worked and `60 for 6` and `60 times 6` did not**, and nothing in the app stated that rule. A positive tokenizer replaces it — take the numbers and the unit/rep keywords, ignore every word between — so a phrasing works by construction rather than one stripped filler at a time. The seven existing tests all passed and none of them *could* have failed: every case was adjacent numbers or an explicit keyword. The failure message now names an example and the button carries it, since the accepted phrasing was previously learnable only by failing at it. **Proven on strings, not on speech** ([journal](docs/overview/entries/2026-08-31-voice-filler-words.md)).

**Four nutrition reports from one device pass, and the interesting one is a fix that is not what its entry proposed (BF-60/61/62/63).** **BF-61:** Delete needed two presses because hit-testing follows the *animated* transform — for the 220 ms the row spends sliding out it is still over the tray and swallows the tap, which is why the owner's *"if I wait a second it works"* was the diagnosis. The tray now stacks above the row while open. **Its test took three attempts and the failures are the value:** a long drag overshoots and animates back *rightwards*, never covering the tray; a CDP-paced flick falls under `FLICK_VELOCITY` and snaps closed instead; and a tap at the tray's *centre* is uncovered within a frame, because the tray uncovers from its right edge first. The first version passed with the fix removed. **BF-62 was NOT `92vh`** — `SheetContent side="bottom"` bakes `.pb-safe-action`, and this repo's own measurement says the inset reports the nav bar's height under edge-to-edge, so `max(inset, 0.75rem)` pads by exactly the bar; five takeover sheets now take `bottomInset="takeover"`. **BF-63** scans a packet into the builder without logging it to today, and **deliberately does not store the code** — that chain is Lane A's and BF-38's. **BF-60** renames the tab to `Search`. **Nothing is device-verified; three of the four stay queued for exactly that** ([journal](docs/overview/entries/2026-08-31-nutrition-batch-bf60-63.md)).

**A logged meal is one diary row, and the week-long hold was the spec measuring a moving element (BF-39).** The render half was built on 2026-08-30, passed its own three tests, and was held because the meal library's swipe tray then failed deterministically — recorded as *"a subscriber re-rendering a sibling subtree drops an in-flight `useDrag`"*. **It is none of that.** Sampling the row's rect every frame while the gesture ran: `SwipeActions` mounts once and the drag handler is **never invoked at all**. `toBeVisible()` passes while the sheet is still running its `enter` animation, so `boundingBox()` returned y=605 and the row was at y=503 by the time the CDP touch landed — every point hit the scroll container beneath it. BF-39 never touched the gesture; it added enough work behind the sheet that the animation had not settled. `swipeRowLeft` (`e2e/fixtures.ts`) now waits for two reads a frame apart to agree, all three swipe specs share it, and the pair that failed together passes with the grouping shipped. **The same latent race is in 46 other coordinate reads** — filed as LB-30, not swept ([journal](docs/overview/entries/2026-08-31-diary-nested-meal-rows.md)).

**CI refuses `savePreference` inside a `useEffect` (LB-28).** `useEffect(() => localStorage.setItem(K, v), [v])` is a free write; the same line calling `savePreference` is a **PATCH on every mount**, and nothing at the call site says so. One such site left that PATCH and a `GET` behind it pending past sixty seconds in Health's launch burst and failed nine e2e specs, **none of which mentions preferences** — the screen such a failure names is never the screen that caused it. The scanner is a separate module driven by fixtures, and blanks comments and string literals before counting parens, because an unbalanced paren in either extends an effect's span across the rest of the file. Proved by mutation on the real file. **The entry said there were no sites to exempt; there are two** — `usePersistedPreference` itself, and Home's section-order reconciliation, which returns early unless the order changed. The grep behind that claim wanted both tokens on one line, a shape nobody writes ([journal](docs/overview/entries/2026-08-31-no-save-preference-in-effect.md)).

**One photo picker per screen, and the held rebuild's failure was the spec (BF-46 ①a).** Two things said *Add a photo* and only one was a picker — the meal's own screen called `onEdit`. Both are real now, at the top of their own screen, writing through the same `saveMealToLibrary`, so there is still one write path. **The interesting half:** rebuilt, the previous session's failure reproduced — `onChange` firing with a valid data URI and the component never receiving it — and instrumenting the *parent* showed the file landing in the **other** picker, because the screen being left is still in the DOM while it closes and carried the same accessible name the spec waited for. *A precondition satisfied by the state it is meant to replace cannot fail* ([journal](docs/overview/entries/2026-08-30-meal-photo-one-picker.md)).

**The meal photo was blocked by the app's own CSP, on the branch no test runs (BF-46 ①b).** Three owner reports, recorded as a save failure that *"does not reproduce in source"*. `MealPhotoTile`'s **native** branch did `await fetch(photo.dataUrl)` — and **a `fetch()` of a `data:` URL is governed by `connect-src`**, which this CSP does not open to `data:`. It rejected into a `catch {}` written for picker cancellations, so choosing a photo on the phone did nothing and said nothing. The web branch takes a `File` from an `<input>` and never fetches, which is why every browser test passed. Now `Base64` + `dataUrlToBlob`, and non-cancellations toast. **Verifiable only on the S25** ([journal](docs/overview/entries/2026-08-30-meal-photo-data-url-fetch.md)).

**The quantity editor is the owner's Option A, and an ingredient stopped claiming servings (BF-46 ② ③).** The unit toggle moved into a narrow column beside the stepper — which is what frees the width the presets now span — the calorie total stands alone, and the macros are three named tiles rather than `P`/`C`/`F`. **One stated departure from the drawing:** it puts that column at the stepper's height, and the app's 48 dp floor makes a stacked two-option toggle 96 px, so the *stepper* grew instead. And an ingredient row reads `1000 g`, never `8 servings · 1000 g` — a meal is measured in portions, so "serving" meant two different things one line apart. The e2e asserts the toggle's **geometry**, because "beside the stepper" is the whole request and is invisible to a text-only check. **Not device-verified**, and Option A is the tallest of the three drawings ([journal](docs/overview/entries/2026-08-30-quantity-editor-option-a.md)).

**Settings follow the account now (Q-392).** The owner's *"when i do a new install or open on computer - it loses all the saved preferences"* was still true in full: the engine (`users.preferences`, `GET`/`PATCH /api/user/preferences`) had shipped and **no read site called it**. `lib/user/preferences-sync.ts` connects them — `hydrateUserPreferences` seeds every device key from the server bag on launch, `savePreference` writes both. Proved by `e2e/preferences-survive-reinstall.spec.ts`, which is the owner's sentence as a test: PATCH three preferences, `localStorage.clear()`, reload, and all three come back in their right encodings — and it fails with the hydration replaced by a no-op. **The rule that was wrong, and CI found it:** hydration first cleared any key the bag did not carry — right for a settled system, wrong in the window between a tap and its PATCH landing. `meal-label.spec.ts` caught it wiping a label style mid-flight, and **offline it reverts every change on the next launch**. Hydration now deletes nothing; the one thing the app clears, the mutually-exclusive brand preset / hue pair, is resolved by `EXCLUSIVE_GROUPS`. The earlier `backgroundSettings` catch was the same rule failing at its extreme, and treating it as one key needing an exclusion would have left the race in place for every other ([journal](docs/overview/entries/2026-08-30-preferences-read-sites.md)).

**A logged food swipes to Delete, and the day stopped moving with it (BF-45 ⑤).** The diary reuses the meal list's `SwipeActions` tray, routed to the confirmation the edit sheet's bin already raises. What earns the index is the collision: `nutrition-content.tsx`'s scroll container owns a horizontal drag that steps the **day**, so one touch fed both gestures — and it is **invisible on today**, since that handler refuses to step past today. `SwipeActions` marks itself `[data-swipe-actions]` and the day handler defers, as `tab-swipe-navigator.tsx` already does for a carousel. **Not device-verified** ([journal](docs/overview/entries/2026-08-30-food-log-swipe-delete.md)).

**Home's APK-banner link was a 33 px tap target, and the gate that hid the entry was self-inflicted (LB-26).** The link rendered **258×33** against the 48 dp floor — an `<a>`, which `globals.css` excludes on purpose so an inline prose link is not forced to 48 px. It takes the floor locally instead of widening the selector, and the reasoning moved beside the CSS rule rather than sitting in the banner's JSX, which is not where someone tempted to widen it would look. **The spec's allowlist is now empty** — an allowlist that never empties is a backlog wearing a test's clothes. Proved both ways: removing the floor fails the spec with the exact reported measurement. **The process half is the more useful one:** LB-26 carried `Gate: device` on work that had never been built, filed by the session that had read BF-45's warning about that exact mistake hours earlier — a gate parks an entry, so it hid it from `next-item.js`. The rule now sits in the backlog's protocol header where entries are written, not only inside the entry that found it ([journal](docs/overview/entries/2026-08-30-apk-banner-tap-target.md)).

**The sparkline primitive can draw the charts that were bypassing it (Q-154).** Three files hand-rolled a `<polyline>`, and "replace on touch" would have been a bug — the primitive could not draw them. It gained six props, all defaulted so its twenty existing call sites are untouched: `pad`, `valuePadding`, `strokeWidth`, `gridLines`, `emphasizeLast`, `valueLabel`. **`valuePadding` is not cosmetic** — the default 0.5 renders a 0.5 kg body-weight spread at half its true amplitude, so the chart says something different from the data; that is now pinned by a test rather than a comment, after the projection moved to `sparkline-geometry.ts` so it can be driven in node at all. Two callers converted; **`active-workout-screen` stays inline on purpose** and is no longer a to-do (four more props no other caller would use). The owner's 2026-08-25 call — **the halo goes** — is what cleared it, and the reasoning generalises: a primitive that grows a prop per caller's art is a wrapper over a config object. **Neither converted chart has been looked at** — no e2e reaches those sheets, and it is a deliberate visual change at 412 dp ([journal](docs/overview/entries/2026-08-30-sparkline-primitive-props.md)).

**The meal-label spec was decoding the wrong style, every iteration (LB-19).** Filed as a flaky timeout, then as a repaint race; it is the second and worse than intermittent. The gate after picking a style was `inkFraction > 0.01` — and the canvas already carries the **previous** style's ink, so the condition is true before anything repaints. Measured: the ink at the instant the gate released equals the previous style's settled value **4 of 4** (0.080699 → 0.134665 → 0.092238), so the decode loop read the previous label every time and passed anyway, because **every style encodes the same meal**. The layout check it exists for had effectively never run for three of its four styles. Fixed with two signals — the style-derived `mm at N×N modules` figure changing (all six distinct), then the ink **settling** (two equal reads, because a repaint passes through a cleared canvas). Canvas dimensions, the other candidate, are identical at 1179×1179 for every style. **A deterministic reproduction of the original null decode was not achieved** and the entry says so ([journal](docs/overview/entries/2026-08-30-meal-label-style-gate.md)).

**The nutrition surface after two device passes — and two things built, measured and held (BF-45, BF-50, BF-51).** Eight shipped: the macro ring started at **9 o'clock** at all three call sites, Home's included (`from -90deg` is the SVG/canvas idiom; CSS `conic-gradient` already starts at the top); a collapsed meal kept its calories and dropped its macros, because the totals footer sits inside `CollapsibleContent`; bottom-sheet gutters were **4 px against artboards that say 16** — fixed on the nutrition sheets, **not** on `SheetContent`'s bottom variant as the entry proposed, because **26 of 48** bottom sheets set their own `px-*` and most of the rest already pad inner content at 16, so a shared gutter would have doubled theirs; plus the Log Food capture row (62 px tiles from the artboard, a describe pane that fills its sheet, the camera opening directly with the gallery kept, and `Select` renamed `Delete meals` because that is all it does). **Held:** the meal-photo rework and the builder's back surface — both built, both with a reproducible failure recorded on their entries, and neither shipped from a sandbox. **None of the eight is device-verified** ([journal](docs/overview/entries/2026-08-30-nutrition-ui-uplift.md)).

**Log Food could not reach the food database (BF-48).** The owner's *"it only searches saved/history food... So its not useful"* was precise: `Single foods` filtered an in-memory list, its placeholder said `Search your foods`, and its empty state said single foods land there *once you have logged them* — so the screen for adding one food could only find foods already eaten. The database search existed the whole time, reachable **only** from inside the meal builder. The query and its results section are now shared (`useFoodDatabaseSearch`, `FoodDatabaseResults`), so the macro/calorie mismatch warning has one implementation rather than two, and the **700 ms debounce travels with the hook** — OFF rate-limits to ~10 searches a minute. The foods tab's search box is unconditional now: it was hidden while the list was empty, which is the state the report was made from. Guard proved by mutation ([journal](docs/overview/entries/2026-08-30-log-food-database-search.md)).

**The accessibility scanner that would have passed a 12 px button (Q-282).** `@axe-core/playwright` was installed, measured and removed: WCAG 2.5.8 exempts a *spaced* undersized control, so a deliberately-shrunk **12×12** button (confirmed by `boundingBox`) came back a **pass**, and `color-contrast` cannot read this app at all — it fails to parse the `oklch` tokens (*"Could not parse color string oklab(…)"*) and **evaluated no nodes on Home**. `e2e/touch-target-size.spec.ts` ships instead: DOM geometry against **this repo's 48 dp bar**, covering the roles `globals.css`'s `button, [role="button"]` floor cannot (`<a>`, `role="tab"`, `role="radio"`). It fails on the mutation axe passed. One real finding, **LB-26**: Home's APK-banner link is 258×33 ([journal](docs/overview/entries/2026-08-30-touch-target-gate.md)).

**The Heart Rate tile shows last night, as a delta (TN-13).** It read the **7-day mean** and printed it as a bare bpm — in the signal that best predicts how you feel (r = +0.557 against your own check-in, best of nine). Re-measured over 71 production nights: the nightly value changes on **61 of 70** night-pairs, the rounded mean on **29**, so the tile stood still nearly six days in ten and discarded 77 % of the daily movement. And a bare number says nothing: expressing the reading as a deviation from your own baseline roughly **doubles** its correlation with felt state, which is why it now reads `50 · −7 vs usual`. Both halves shipped together because the entry required it — half a fix here is the one that looks like progress. **Still owed: the S25 check** — the cue grew from one word to five across 20 layout styles ([journal](docs/overview/entries/2026-08-30-feat-hr-tile-nightly-resting.md)).

**Changing a supplement's dose no longer rewrites every log you already made (BF-3, gap 1).** The
dose lived on the definition and not on the log, so raising retatrutide from 2 mg to 4 mg made last
month read 4 mg too — for a drug whose whole story is its escalation schedule, the schedule was what
got erased, and nothing recorded it to reconstruct from. The dose is now stamped on the log
(migration 244, local SQLite **v32**), including the free-text form, **so it works with the dose
already typed in and needed no UI change**. The out-of-app note the entry advised keeping is no
longer needed. **Not yet on the S25, and a v32 local migration is the highest-risk kind here** — an
empty Nutrition tab is the signature of a dead local store. Gaps 2 and 3 (twice a day, weekly
cadence) and the dose-entry UI stay queued
([journal](docs/overview/entries/2026-08-30-feat-supplement-dose-on-log.md)).

**A meal label can be handed to someone now (BF-57, both halves).** Scanning someone else's said
*"That saved meal no longer exists"* — the QR held a `saved_meals.id` resolved against the scanner's
own meals. Making ids globally resolvable was rejected (a photo of a label would become read access
to someone's meal, on an app heading for a Play Store health-data declaration); the meal travels in
the code instead, so it scans offline, for a user with no account, as a copy, and **nothing is
dropped to fit** — the tail rolls into one remainder carrying its macros, exact to the gram. The
~30 mm the entry asked for is **not available** on the five print styles: four cannot hold 62 bytes,
below which the encoder trims the meal's **name**, so they keep the private bookmark and a new
**Share code** style spends the label on a 34.4 mm code. A scan saves a copy, never logs it.
**Still owed: the two-phone check, and a printer**
([engine](docs/overview/entries/2026-08-30-feat-self-contained-meal-label.md) ·
[surface](docs/overview/entries/2026-08-31-shared-meal-labels.md)).

**The nutrition sheets carry the tab's palette, and the obvious fix could never have worked (BF-75).**
A translucent sheet reveals `SheetOverlay`'s `bg-black/50`, not the wallpaper — that sits at `z-[-1]`
while the sheet and its overlay are both `z-50` — so the palette is painted *inside* the sheet, behind
an opt-in `surface="page"` five nutrition sheets pass and nothing else does. **⚠ Wallpapers ship
`enabled: false`**, so it is invisible until switched on; the owner has them on. **Still owed: the
≥4.5:1 contrast check on the S25** ([journal](docs/overview/entries/2026-08-31-nutrition-sheet-surface.md)).

**The meal builder's three whole-meal inputs are findable (BF-52).** *"I dont see a URL option"* — it
did not exist until you had pasted the URL: the recipe photo, the URL import and the AI estimate were
mutually exclusive renders of one slot inside a search field. A `Recipe photo · Recipe link ·
Describe it` row sits above the collapsed picker now. The barcode is **not** in it, against the
entry's own instruction: those three build a whole ingredient list, a barcode names one product
([journal](docs/overview/entries/2026-08-31-meal-builder-entry-point.md)).

**Both pending weigh-in buttons were dead in production (BF-53).** `scale_raw_samples.id` is a
`bigserial` and both routes validated it with a UUID regex, so every press of "Not me" or "Yes,
that's me" returned `400 Invalid id` before the numeric check written for it could run — a reading
that was not yours could not be dismissed, and one that was could not be filed. The client's
`if (res.ok)` with no `else` is why it read as *"doesn't do anything"* rather than as an error, and
that half is fixed too. Reproduced and re-verified on `pnpm dev` against the same real row. **Still
owed: the S25 check** ([journal](docs/overview/entries/2026-08-30-fix-pending-weighin-numeric-id.md)).

**Query text reaches the audit role (LA-39, closed the day it was filed).** BF-21's view shipped
returning real timings with every `query` reading `<insufficient privilege>` — `pg_stat_statements`
redacts text outside `pg_read_all_stats`, checked against the session role. The owner ran
`GRANT pg_read_all_stats TO claude_readonly` and it is live; the returned SQL carries `$1`
placeholders, which is the normalisation the safety argument rested on.

**The BLE console counted rows it had been guessing (BF-54).** Its DB footprint printed
`n_live_tup` under a column headed *rows* — a planner estimate, and `last_analyze` is NULL on every
table here, so it read **552** against `oura_raw_samples`' **180,415**, 0 against `rr_intervals`'
87,015 and 1 against `error_events`' 6,102. The display was the smaller half: the reclaim button used
the same counter to call 67 MB against 552 rows *pure bloat*, so pressing it took an ACCESS EXCLUSIVE
lock with the timeouts lifted and reclaimed nothing. Both sites now `count(*)`. **The size columns
were never wrong** and are untouched — only the row columns of `pg_stat_user_tables` are estimates,
and conflating the two is what cost a session on Q-528
([journal](docs/overview/entries/2026-08-30-fix-db-footprint-real-counts.md)).

**Query timings are readable by the audit role (BF-21).** The owner enabled `pg_stat_statements` on
production; `claude_ro` is default-deny, so it needed a view, which migration 242 adds through the
generator rather than by hand — that file rebuilds the whole schema each run, so a hand-written view
would vanish at the next regeneration. **The one view here that is not row-scoped**, safely, because
normalised query text carries shapes rather than values; five columns, and a test refuses the rest.
Guarded on the relation existing, since the extension is production-only and an unguarded view would
fail `ensureSchema` on cold start. **The counters start empty from the restart** — give it a day
before drawing conclusions, and BF-19 already showed the database is not where the reported slowness
is ([journal](docs/overview/entries/2026-08-30-feat-claude-ro-stat-statements.md)).

**A meal plan the model never needed no longer fails when the model is down (LA-38).** The generate
route called the AI unconditionally, before it knew how many meals it had to invent — so a plan with
every slot pinned, or filled from your saved meals, still sent the full prompt asking for *exactly
zero* meals. Tokens were the smaller half: the catch around that call cannot tell it was
unnecessary, so an outage 502'd a plan that required nothing from it. Reproduced on `pnpm dev` with
no API key (pre-fix 502, post-fix 200) and fixed by deriving the two things the call supplied — the
plan's name, from meals that are all already named, and the rest-day line, from the carb shift the
code actually applies
([journal](docs/overview/entries/2026-08-30-perf-generate-skip-empty-model-call.md)).

**A DEXA scan has somewhere to land (BF-41 / BF-2).** `dexa_scans` + `dexa_scan_regions`
(migration 240) and `GET`/`POST /api/dexa-scans` — BF-41's second slice, and what unblocks BF-2's
scale calibration. Written from the owner's real Hologic printout rather than a description, keeping
every field; **no source document is stored** — extract, confirm, save the fields, discard the file.
**There is still no way to enter one from the app**: the upload/crop/confirm surface is Lane B and
unbuilt, and nothing extracts yet
([journal](docs/overview/entries/2026-08-30-feat-clinical-intake-storage.md)).

**My Foods sorts by what you actually eat (BF-39 follow-up).** Q-395c filed it as a constraint —
*"a saved meal has no last-used timestamp at all … True MRU needs a column that does not exist"* —
and BF-39's migration added that column this morning. `listSavedMeals` returns `lastUsedAt` and
orders most-recently-eaten first; a meal never eaten sorts last, keeping the `createdAt` order it
had, so saving one does not drop it out of sight before it is used once. **Derived on read**, never
a stored counter: a `last_used_at` column needs a write on every log and an un-write on every
delete, and is wrong forever the first time either is missed. The first version put the same
subquery in the SELECT and the ORDER BY — the ordering worked and the selected value came back
null, which is a neat argument against one formula in two places even when both are the same SQL
([journal](docs/overview/entries/2026-08-30-saved-meal-last-used.md)).

**The map that stops you re-implementing things was wrong 108 times (LA-35, filed and fixed the same
day).** `CLAUDE.md` sends readers to `docs/module-map.md` *because* the monorepo extraction moved
code out of `lib/` and the docs kept saying `lib/` (Q-153) — and the map was wrong the same way, for
**108 paths across 8 orientation documents**. It survived because
`scripts/check-index-doc-paths.js`, written to catch exactly this, ended its `resolves()` with
`'packages/shared/src/' + p.replace(/^lib\//, '')`: **the one error class the map exists to prevent,
whitelisted inside its own guard.** The sibling `check-claude-md-paths.js` never had the bug and the
difference is one line — it uses that string to build an error *hint* and fails anyway. The
corrections are applied, the fallback is gone, the hint is ported, and a test pins the absence,
because restoring it makes the check pass *more*
([journal](docs/overview/entries/2026-08-30-module-map-shared-paths.md)).

**The deleted food came back, and the filed trace was not why (BF-47).** From device pass N1:
*"when I click delete the item vanishes then re-appears; then when you swap screens - it
dissapears."* The entry said the loader renders the server copy unconditionally — **it does not**;
in the happy path it hydrates through `applyDelta` and re-reads locally, and that path's
`sync_status = 'synced'` gate holds. Two mechanisms do fit: the `catch` fallback rendering the raw
server copy, and — the one that matters — a log created on web or another device, where
`deleteFoodLog` matches **zero rows** so nothing is tombstoned and `applyDelta` inserts the server
row back as `'synced'`. **That distinction decides the fix's position:** a filter applied after the
hydrate would fix the flicker and leave the half that survives a screen swap. It now runs before
both uses, reading the outbox through a store method that deliberately ignores retry backoff — a
delete waiting one out is still a delete. The sibling sweep the entry demanded has a measured
answer: `applyDelta(` has **exactly one** call site outside the sync engine. ⚠️ Reasoned, not
reproduced, and unverified on the S25
([journal](docs/overview/entries/2026-08-30-pending-delete-resurrection.md)).

**A logged meal keeps its identity now (BF-39, engine half).** The owner's report was literal —
*"when I add a meal from ai; it breaks it down into its components and floods the list"* — and one
AI-logged breakfast really did render as **eight** diary rows. Logging a saved meal writes one
`food_logs` row per ingredient and nothing recorded that they came from a meal. `saved_meal_id` and
`meal_group_id` do (migration 238, `claude_ro` views regenerated in 239, local SQLite **v31**), and
**two ids rather than one is the design**: the first is WHAT was eaten, the second WHICH TIME, so
two servings of one meal on a day cannot merge into one row. Built as the entry recommended — one
row per ingredient plus a grouping key, not one row per meal, which would change what a `food_logs`
row *is* for five consumers. The full offline chain landed together, `savedMealId` is
ownership-checked on both write paths, and the FK is `ON DELETE SET NULL` because `deleteSavedMeal`
is a hard delete and the default would make a saved meal undeletable once eaten. ⚠️ **The rendering
is Lane B and not built**, so nothing looks different yet, and nothing back-fills older logs
([journal](docs/overview/entries/2026-08-30-food-log-saved-meal-id.md)).

**The Voice button was not broken on the APK, it was absent (LA-37).** One `error_events` row from
02:06 — `"SpeechRecognition.then()" is not implemented on android` — and behind it a completely dead
feature. `getNativeSpeech()` returned the raw `registerPlugin()` **Proxy**, whose `get` trap answers
every key with a callable, `then` included; resolving an async function's promise with it makes the
runtime call `plugin.then(...)` across the bridge. **It hangs rather than rejecting** — Capacitor
ignores the resolve/reject it was handed — so `available` stayed `null` and the button never
rendered. `lib/oura-ble/plugin.ts` has documented this footgun since it was written and all four
locally-registered plugins wrap because of it; the voice button escaped because its plugin comes
from a **community package**, so no grep for `registerPlugin` ever reached the file.
`scripts/check-plugin-proxy-thenable.js` now keys on the *shape* instead (Custom Rules is 62 steps).
**The precision matters:** `return BleClient` at two other sites looks identical and is correct —
that one is a plain instance, not a proxy — so the check exempts it by name with the reason.
JS-only, so it reaches the phone on deploy with no APK rebuild. ⚠️ Unpressed on the S25
([journal](docs/overview/entries/2026-08-30-voice-plugin-proxy-thenable.md)).

**Nine percent of My Foods was the same food, written again (BF-38, the exact-match half).**
Measured in production: **221 `food_items`, 200 distinct name+brand, 21 redundant**, 20 of them from
the `ai` source — and nothing had ever checked, at any layer, whether a food being created already
existed. `foodItemIdentityKey` decides it once, on exact identity: normalised name and brand (case
and whitespace only) plus **every number a log depends on** — serving size, calories, and the
macros. That is 10 of the 21. **The rest are deliberately left**, because `food_logs` multiplies
against the item's serving size: `mandarin` exists at 42 kcal/80 g and 53 kcal/100 g, so a
density rule would not lose a row, it would change what a new log *means*; and `protein bar` reads
**137 and 342 kcal at the same 40 g**, where merging picks a winner silently. Two of the entry's
premises were falsified before building — **`barcode` is NULL on all 221 rows**, because
`NutritionScanResult` carries no such field, so the "unambiguous" barcode key would have matched
nothing; and the AI's names are usually byte-identical rather than fuzzy. Both write paths check and
**differ on purpose**: the offline push keeps its client-minted id, because a queued `food_logs`
mutation already references it. ⚠️ The device half is unverified on the S25
([journal](docs/overview/entries/2026-08-30-food-item-duplicate-create.md)).

**A map entry stops heading the work list (LB-22).** BF-28 and BF-11 exist to be READ, not built, and
said so only in prose — so `next-item.js` printed BF-28 as READY #1. `Reference:` is a **field** now,
ratcheted by `check-backlog-pointers.js`, and checked **last**, so a `Gate:`/`Needs:`/`Keep:` can never hide behind "not a work item" ([journal](docs/overview/entries/2026-08-30-queue-reference-entries.md)).

**The e2e flake blamed on a slow sandbox was a stale fixture (LB-19).** The entry said two specs
"fit comfortably on CI's runner and do not fit here" and prescribed a longer timeout. **Neither half
held.** `goal-invalidation` fails on a locator that never resolves 60 s into a test with a minute
spare — `seed.sql` ends at the day it *ran*, nothing back-fills, and the steps row cannot render
without one (measured: newest steps row **2026-08-25** against a `current_date` of **2026-08-30**).
It supplies its own row now, in the **user's** timezone. `meal-label` is intermittent for a different
reason again — its ink poll cannot tell the new label style's paint from the previous one's — and
stays open with the mechanism written down ([journal](docs/overview/entries/2026-08-30-e2e-fixture-not-time-budget.md)).

**Two rings that were never compared, reported as two rings that disagree (PS-15, phase + units).**
`/api/admin/device-comparison` returned `overlap: 0` for the rings' daytime stress. Oura's buckets
land at **:15/:45** and the Colmi's at **:00/:30** — fifteen minutes apart, forever — and the route
bucketed at a hardcoded five minutes, so no pair could form at any point in either ring's history.
`lib/health/device-comparison.ts` has said *"bucket to the COARSEST cadence"* in its own header since
the day it was written and **nothing implemented it**. The width is measured now (median
inter-sample gap, coarsest wins) and reported three ways; `verdict` separates `out-of-phase` from
`no-data` and from a real disagreement; and a pair in **mismatched units** (Oura stress is −1..+1,
the Colmi's raw 0..100) suppresses every magnitude and returns rank agreement — **rho = 0.64**, the
figure PS-15 was filed with, now reachable from the endpoint instead of by hand. Adding `spearman`
to `packages/shared/src/health/correlation.ts` *removed* a duplicate: `averageRanks` moved out of
`model-report-calibration.ts`. **Steps stay unbuilt on purpose** — pairing them needs the Colmi's
buckets summed to a day and **PS-16** has not settled whether they are cumulative, so PS-15 keeps
that half with `Needs: PS-16`. Admin JSON, no UI, no version bump
([journal](docs/overview/entries/2026-08-30-device-comparison-phase-and-units.md)).

**The Coach can ask a multi-answer question, and stopped retyping six lists (Q-407, widget half).**
The owner's complaint was literal — *"there should be options for 'select all' as I keep clicking
each grocery store"* — and nothing produced one: `ChoiceListSchema` had no multi flag and the
callback resolved a single option. Both flags are flat and optional, so every existing picker is
unchanged. The six meal-plan catalogues are `CHOICE_SOURCES` now, served from `/api/coach/options` —
a nine-option list the model types out costs **~554 output tokens**, and output is essentially all of
Coach's latency. ⚠️ **The conversational half of Q-407 is untouched**; this is the widget it needs
([journal](docs/overview/entries/2026-08-27-coach-multi-select.md)).

**The wrap-up shows the day it is wrapping up (Q-112b).** The evening review asked how the day felt
without ever showing the day. The read-through — training, activity, energy, sleep, HR, body — is
step 1 now, drawn by **the same component `/health/day` draws**, off the same `day-log:` key; three
steps, and the meals step is skipped once nothing is missing. **Two findings the entry did not
have:** the HR pair is labelled *15-min averages*, not min/max, because the trace is bucketed by
mean and a resting dip to 48 surfaces as ~55; and **body temp had no route at all** — the live
values are in `oura_daily_summary`, returned by nothing, so it is Lane A (**LB-25**). ⚠️ Not device-verified ([journal](docs/overview/entries/2026-08-27-day-review-read-through.md)).

**One evening flow, one door (Q-112a).** Home opened a thinner `DayReviewSheet` only Home had,
Nutrition's End of Day button opened the real one, and **both reminders' `extra.route` was `'/'`** —
tapping either landed you on Home to hunt for a banner. All of it reaches `/nutrition?review=day`.
**The plan hosted the review on Home and that was wrong:** `EndOfDayReview` needs meal types, logs
and targets, all Nutrition's state, so the door moved instead. `day-review-sheet.tsx` is deleted,
its digest carried across **with the `.catch()` and error state it never had**; that orphaned the
load-comparison chart and its route, both kept for Q-112c (**LB-24**). ⚠️ Not device-verified ([journal](docs/overview/entries/2026-08-27-day-review-one-door.md)).

**Nutrition's energy block is artboard 1's card now (BF-24 ②).** Ring left, `kcal left` and
`+burned` beside it, three macro columns; the on-track band and the eaten/burned/net detail kept
below a divider in the same card, because the drawing stops at the fold and the band is what says
whether "left" is on track. **No number changed** — and the reason is the finding: the card takes
`goalCalories`, `earnedKcal` and the *effective* targets from the screen and derives none of them,
because Q-401, Q-417 and Q-323 each came from a surface computing its own. A first draft that called
`budgetProvenance` in the card would have been the fourth. ⚠️ Not device-verified — BF-24's gate
covers it ([journal](docs/overview/entries/2026-08-27-nutrition-energy-card.md)).

**A recipe from a picture, and the prompt that assumed a plate (BF-40).** The route already took
images; its prompt told the model to estimate a **plate** from a picture of a word list. One line
served both acts, so rewording it would have made dinner read as a recipe, silently — the choice is a
tested pure function now, absent means `plate`. The ⚠ four-fold yield error was already handled: an
image returns `recipeYield: null`. ⚠️ Not device-verified; the model's reading is stubbed ([journal](docs/overview/entries/2026-08-27-recipe-screenshot-import.md)).

**A test flake that was the service worker, not the component (PS-14).** The filed hypothesis — a
remount discarding the typed query — was **wrong**, and testing it (a probe asserting the value
survived passed 8 of 8) is what found the real cause: `sw-template.js` re-issues **every** `/api/`
request, Playwright cannot intercept a service-worker fetch, and the worker `claim()`s mid-page-life
— so whether a `page.route` stub applies is a race. **The rule was already in `e2e/README.md`** and
three specs were written against it anyway, two of them mine hours earlier, so
`check-e2e-api-stub-sw.js` now holds it ([journal](docs/overview/entries/2026-08-27-e2e-api-stub-service-worker.md)).

**The meal-plan wizard can finally reach the library, and stops dropping pins silently (BF-11h).**
BF-11g shipped the engine and **nothing on the client sent `useLibrary` or read `matchReason`,
`libraryMatchCount` or `droppedPins`** — the search was off for every real request since it landed.
Four things: the toggle, why-this-meal, a reroll offering **one of yours before something new** (no
route, no model call — it runs the generator's own matcher on cached data), and the meal-count
reduction prompt. **That last fixes a live silent drop** — the picker caps pins at `mealCount - 1`
while you pick and `setMealCount` never re-truncated them, so lowering the count afterwards
discarded pins the server capped and reported to nobody. **It also exposed a badge bug BF-11g
created:** `kept` and `library` both carry a `savedMealId`, so a meal the planner *chose* claimed to
be one the user had *pinned*. Regression driven, not inspected — reverting the wiring fails both
reduction e2e tests. ⚠️ Not device-verified, and no end-to-end generation with `useLibrary` on.
[Journal](docs/overview/entries/2026-08-27-meal-plan-library-surface.md).

**A saved meal can say which meals of the day it suits (BF-11f) — and the save button was eating
its own argument.** BF-11e built the column, the join table, the route field and the outbox replay and
deliberately shipped no way to set any of it; this is the picker. **Untagged means EVERY slot, not
none**, so the hint under the chips changes with the selection — nothing ticked otherwise reads as
"excluded from everything". Writing the round-trip test caught a live defect underneath it:
`onClick={onSave}` handed React's click event to `handleSave(overwrite?)`, so every save from the
footer looked like an overwrite — which meant **BF-11d's duplicate prompt, shipped the day before,
had never fired once**, and the new tags arrived as `undefined`. Neither TypeScript nor the memo check
can see that shape. A sweep found one sibling (`food-list.tsx`'s empty-state button, which reads
`.items` off the event); it is fixed **by inspection, not reproduced** — no spec has an empty meal
library — **closed the same day in v1.388.1, and the reproduction corrected the claim**: React
swallows the throw, so the only symptom is a **dead button**, not a crash. ⚠️ Not device-verified.
[Journal](docs/overview/entries/2026-08-26-feat-saved-meal-tag-ui.md).

**A remembered bedtime, in its own column (Q-519, engine half).** A night the ring only caught from
4 am reads as a 4 am bedtime and moves the 14-day estimate ~23 minutes for a fortnight. The entry
proposed writing it into `sleep_start` at `manual` rank; **the audit that entry commissioned falsified
that** — `aggregateNight` derives time-in-bed and efficiency from the span, so the same night became
10.0 h at 35% instead of 4.62 h at 75%
([audit](docs/reviews/2026-08-26-manual-bedtime-write-audit.md), reproduced in a test). It gets its
own column, read by the bedtime estimate and nothing else. **No UI yet — Lane B's half**, so nothing
can write one; ⚠️ **the local column is not device-verified.**
[Journal](docs/overview/entries/2026-08-26-manual-bedtime-engine.md).

**Every score now stores the breakdown it was made of (Q-501, Q-526).** Readiness contributors record
the number each was scored *from*, so a persisted row no longer needs today's summary — often not the
one it was built on — to explain itself: self-consistent means the **inputs** were rewritten,
inconsistent means the **model** moved, and older rows are named `uncheckable` rather than passing
silently. Activity was the last score keeping the blend *wrapper* where its six components should go
— which on all 30 rows held the score twice and a constant zero, the blend having had no Oura *Cloud*
score to adjust since the re-key. **No score moved, and both are forward-only**: earlier rows cannot
be recovered, so Q-505's before/after window starts here and improves the longer it waits. Details,
and the re-measured populations that corrected both entries, in the journal
([Q-501](docs/overview/entries/2026-08-26-readiness-contributor-inputs.md) ·
[Q-526](docs/overview/entries/2026-08-26-persist-activity-contributors.md)).

**The doc-size ledger stops being a merge conflict (LA-33), and E2E can now be required (LA-22).**
Every PR raising a documentation baseline edited the same two lines of one shared JSON, so two open
PRs conflicted *by construction* — measured this session at four merge races in 35 minutes, every
conflict in that ledger, the backlog or the changelog, never in code. Baselines are now one file
each at `docs/doc-size/<path>.size`; two PRs raising different docs touch no common line. Same fix
the session journal already took. E2E is gated on `app/`/`components/`/`e2e/` but **always runs and
always reports** — a `paths:` filter would leave a required check that never reports, blocking a
non-UI PR forever. ⛔ **One owner action outstanding: add `E2E` to `main`'s required checks**, or
nothing changes. A ci.yml comment claiming E2E was already required was disproved first — three PRs
merged this session with it still in progress.

**The Coach only swaps an exercise when asked, and says what a swap costs (Q-403).** The owner did
not know the Coach's swap edits the **program** rather than today's workout, and did not want it once
told. Offered remove / keep-and-warn / gate-on-injury, they chose a fourth thing: keep it, never
volunteer it. The prompt now forbids an unprompted swap (mirroring the Deloads idiom), and the
confirmation card states that it changes the named session from now on, that progression history on
the outgoing lift stops advancing, and that a one-off change is the in-workout swap. **On the card,
not the prompt** — this entry measured the prompt's existing ordering rule being ignored 3 of 3
times. **The recommendation I gave was wrong and verifying it is what caught it:** the injury case is
already handled by `injurySafeAlternatives` mid-workout, whose handler mutates local React state
only, so gating a *permanent* edit on injury would have been the worst option. Q-403 stays queued for
the sentence-ordering residual.

**The app's load time is measured now (BF-19).** The owner reported it "VERY slowly lately" and asked
for a second opinion; nothing could give one — the two existing timing endpoints measure **workout**
duration, and everything server-side was already ruled out by measurement. `lib/app-load-metrics.ts`
reports navigation timing once per JS context via `sendBeacon`; `GET /api/admin/app-load-report`
gives p50/p95 per route **split cold vs warm**. That split is the report: every merge is a deploy
that rewrites the service-worker cache name, so a pooled percentile measures release cadence rather
than the app. **Never via the outbox** — telemetry queued as a mutation would sit ahead of the user's
food logs on the next push. `buildId` is baked into the client bundle rather than stamped on ingest,
so a device on a stale shell reports the build it is actually running. **The table stays empty until
it runs on the S25**, which is where the numbers mean anything. Unblocks BF-22.

**A food item can hold a picture now, and it survives offline (BF-35, engine half).** A barcode scan
stores the Open Food Facts thumbnail as **bytes, not a URL** — `food_items` is read local-first and
a URL renders nothing in airplane mode — fetched once at scan time, never per render. Migrations 227
+ 228, local SQLite **v30**, and the full offline chain. **Three of the entry's premises were wrong
and are corrected in place:** it still concluded *"never generate one"* after the owner had overruled
that; it sized the feature against **disk** when `food_items` **syncs**, which is the axis
`meal-image.ts` warns about by name; and "the scan photo is already in the request" understates
1024 px against a 128 px thumbnail (~64× the pixels), which makes route 2 a **Lane B** change.
**Nothing renders these yet** — the display, route 2's client downscale and route 3's AI generation
are BF-35's `Keep:` line. Alongside it, **LB-15**: a calorie-free product (sparkling water, a diet
drink, a supplement) scanned as *"not found"*, because `offProductToNutrition` could not tell zero
from absent and `null` is how a caller learns the barcode failed to resolve.

**A full-history rebuild that computed nothing wiped the history and reported success (Q-528).** `replaceOuraDailySummary` deleted every one of the user's summary rows and only *then* returned early on an empty input. Two more of the same class were in the same seven lines and are fixed with
it: the delete and insert were **separate statements**, so a rejected insert left the delete
committed; and the insert had **no `ON CONFLICT` arm**, so one repeated date raised 23505 and
rejected every row — Q-280's shape under a different SQLSTATE. It now matches
`replaceDaytimeStressBuckets`, which already had all three right. **All three were reproduced against
Postgres before being fixed** — the entry admitted its mechanism was read rather than measured, and
its predecessor had already been retracted once for exactly that. Still latent: only the
hand-triggered redecode reaches it.

**One duplicate in a batch discarded the whole batch, at eight write sites (Q-280).** Postgres aborts
an entire command whose VALUES list hits the same `ON CONFLICT` row twice — nothing lands, not just
the repeat. `error_events` recorded **5,771** hits on `POST /api/hr-ingest` (up to 5,000 HR points
each) before Q-214 fixed `upsertOuraHeartrate` alone; a sweep found **eight** sites of that shape,
not the two the entry named. All now use one `collapseOnConflict`. Strategy is per-site and not
cosmetic: last-wins is exact only for a bare `excluded.*` arm, and three of the eight merge, where it
would have turned a loud 21000 into a silent field loss. **Owner decisions the same day:** readiness
history is **recomputed**, not frozen, when a model is recalibrated (reversing 2026-08-24); the
Coach's mid-program exercise swap is to be **restricted** — see Q-403.

**The shared food row's last call site, and a warning that had nowhere to go (Q-406).** Three of four rows converted days ago; the external food-database result stayed a bespoke `<button>` blocked on a design question. The decided treatment moved its explanatory sentence **to the food's detail** — and this surface has none: tapping the row adds the food outright, so building it would have deleted the only visible explanation on a warning meant to be read *before* use. **Owner's answer: keep the sentence in the row** — what already shipped, so no regression, and option B's losing reason (it *replaced* the serving line) does not apply to keeping it alongside. **That knowingly overrides one bullet of the old design and the entry says so**: *"do not add a warning slot"* was written assuming the sentence was leaving the row, so a slot is what keeping it costs — one optional prop three call sites omit, exactly as they omit six others. **The `+` and the per-row spinner went with the conversion and nothing was lost**: `SearchResultRow` beside it has had neither since v1.338.0 — the tap adds the food — and the tapped row still identifies itself through the existing `highlighted`. A hex literal went too (`#f59e0b` → `var(--accent-amber)`; 427 across 85 files). **The row had no e2e cover at all** — its search reaches Open Food Facts — so the spec now stubs the route and asserts the shared shape, the sentence, and the macros still readable beside it ([`journal`](docs/overview/entries/2026-08-26-shared-food-row-last-call-site.md)).

**The journal limit stopped billing the wrong PR (BF-36).** `check-doc-index-size.js` fails the Custom Rules job above 60 foldable journal entries — the right threshold, aimed at the wrong person. It landed on whichever PR happened to be open when the count crossed, and every session writes an entry, so the cost fell at random: it blocked **#527**, a docs-only intake whose diff the failure named none of, and **merging `main` fixed it** because another session had swept concurrently. That PR paid a CI cycle for a condition it neither caused nor fixed. It now applies the same attribution the line-count ratchet beside it already used — over the limit **and this branch adds an entry** fails, adds none gets a note, and an unreadable base still fails rather than silencing the limit. The decision moved to `scripts/lib/entries-verdict.js` and is tested against **fixture counts, not the live directory**, because a test that reads the real count changes verdict as the repo does. **The 250 total ceiling is deliberately left unattributed** — the same argument applies but it is 89 files away, and widening the change would be my call rather than the entry's ([`journal`](docs/overview/entries/2026-08-26-entries-limit-targets-the-grower.md)).

**The delete button that opened a confirmation and closed it in the same instant (BF-34).** The owner: *"the delete feature doesnt work"*, then the detail that decided it — *"it opens up the confirm dialog; but then instantly minimizes so we cant click it."* The diary's bin closes its sheet and opens the dialog in ONE TICK, so the sheet's `history.back()` was still in flight when the dialog mounted; the flag marking *"this pop is ours"* was **per-instance**, invisible to the dialog that received it, and a state that is not mine is indistinguishable from a real back gesture. **Since BF-27 put `BackDismiss` in every sheet and dialog, that was every close-one-open-another transition in the app** — this delete was just the first one pressed. Module-level counter now, consumed by whichever surface gets the pop; one listener owns the stack. **Two corrections to the entry's own analysis:** its "share the flag" fix has an ordering trap — `absorb` is registered by the *closing* sheet, so it runs first and would clear a shared boolean too early — and **LB-17 did not fix this** despite changing the same line hours earlier (that was the *nested* case; this is the *sibling* case). The logic now lives in `lib/hooks/sheet-back-stack.ts` with the hook reduced to wiring, because all three failures it has carried were in *when to close* and none was reachable from a test inside an effect. **The sibling sequence cannot be staged through the web UI at all** — the bin is not even actionable in Chromium — so an attempted repro produced a mis-aimed tap that closed the sheet without opening the dialog, which reads exactly like the bug. Seven tests drive it directly; reverting to the per-instance flag fails both sibling tests and the StrictMode one ([`journal`](docs/overview/entries/2026-08-26-sibling-sheet-back-dismiss.md)).

**Two food lists became one, and the back gesture turned out to be wrong at three layers (Q-395c).** The owner asked what the difference between *My Meals* and *My foods* was; there wasn't one a user could hold — one listed `saved_meals`, the other `food_items`, and which list a thing was in came down to how it had been added. They are **one list called My Foods** now, newest-first across both sources, with two row shapes because a food's tap opens the assign step and a meal's opens its own screen. `food-library-sheet.tsx` is deleted. **MRU was asked for and is unavailable:** `food_logs` carries no `saved_meal_id`, so a saved meal has **no last-used timestamp at all** — `createdAt DESC` is the only recency signal the two share, and true MRU needs a Lane A column. **Routing the list through the logger made the app's first three-deep sheet nest, and one back press closed two layers.** `useSheetBackDismiss` decided "my entry is gone" by comparing the arriving `sheetId` against its own, so every sheet that was not the one landed on closed itself — right by accident at two layers, wrong at three, where back lands on the *middle* sheet's entry and the *bottom* one reads a foreign id. "Gone" is a **depth** now. The symptom in Playwright was `element was detached from the DOM` on a button just asserted visible, which reads as animation timing and is not; instrumenting `pushState`/`back`/`popstate` is what settled it ([`journal`](docs/overview/entries/2026-08-26-one-food-list.md)). **⚠ The merge did not survive the day: the owner reported it the same morning** — *"my foods combined saved meals + history thats not right they are 2 seperate things"* — and BF-37 un-merged it into two tabs. The re-read worth keeping is that *"whats the difference"* was a complaint about two names nobody could tell apart, not about there being two lists. **The three-deep nest went with it**, since LB-16 collapsed the screen that created it ([`journal`](docs/overview/entries/2026-08-26-log-food-one-screen.md)).

**A window that made an ACWR impossible, and what it was really breaking (Q-512).** `health-insight`
handed `computeVolumeAcwr` a **7-day** session list against a **21-day** span gate measured from the
earliest session in that list — so ACWR was null on **110 of 110** replayed days, structurally rather
than for want of history. **The entry's mechanism was right and its consequence was wrong:** the route
never reads `.acwr`. It reads `typicalSessionVolumeKg`, the activity score's *volume-lane denominator*
— which is **not** gated, so it always returned a number, a median over one week where every sibling
uses four. Two heavy sessions in a quiet week set the bar. That also makes one of the entry's two
proposed fixes unsafe: dropping the call would have removed the denominator. **And it was not the
one-line fix it looked like** — widening the fetch silently turns `sessions7d`/`volume7dKg`, which the
model reads as "this week", into 28-day figures, trading a visibly-absent null for a wrong number.
They filter back explicitly. `minSpanDays` was not lowered.

**A measured RMR has somewhere to go, and a rule for how it ages (BF-33, engine half).** The owner has
a DEXA + RMR test booked and every resting rate the app used was *predicted*. Migrations **225** (a
`measured_rmr` table) + **226** (claude_ro regen) store it; `personalRmr` decides what happens as the
body changes. **The entry left that open — validity window or re-scale by lean mass — and re-scaling
wins for a reason, not a preference:** a window gives full trust the day before expiry and total
discard the day after, while what actually invalidates a measurement is a change in body composition,
which has no fixed relationship to elapsed time. Cunningham is linear in fat-free mass, so a
measurement carries exactly one thing the prediction does not — **this person's residual from it** —
and re-applying that at today's FFM ages it by body change instead of by the calendar. **Its own table,
not a `body_metrics` column,** because a second test must sit *beside* the first: two measurements at
different compositions are how you learn whether the first still describes this person. **⚠ NOT usable
yet** — there is no way to enter a number; the typed field and the AI results-sheet path are scope
item 3, the 2×2 panel is item 4 and Lane B's.

**A shared test-user UUID, and a check that would have been deleted (LA-32).** Three times in two
days, adding an unrelated test file turned the suite red in a file the PR never touched: two files
hardcoded the same user id and one deleted it, and vitest's parallel workers share one local
Postgres. **The entry's own survey said six remained; re-measuring found one.** `…d011` is a
*program* id, `fe481797` is the canonical `claude_ro` owner two files are meant to share, and the
rest are pure-logic files that never touch `users` — 83% noise, because "shares a UUID literal" is
not the claim "shares a *user id* someone deletes". That ratio is why the fix is a script with
tested detection rather than a grep: **a check that cries wolf gets baselined into uselessness by
the first person it stops.** `check-test-user-uuid-collisions.js` is in Custom Rules (**59 of 59**,
up from 58) with an **empty baseline**. Its first two implementations were wrong in ways the tests
now pin — a fixed tail swallowed the next statement, and breaking on a line-ending `)` stopped
inside the SQL, which ends lines that way constantly.

**A model stamp that another pillar could erase (Q-273).** `oura_daily_derived.model_versions` is a
map of pillar → model version, and the shared upsert `COALESCE`-replaced it — so a writer stamping
its own key wiped every other pillar's. Live: `backfillBodyComp` wrote `{bodyComp: …}` flat and
erased the readiness stamp on every day it touched; readiness survived only through a racy JS
read-merge, now deleted. The upsert merges with `||` inside the statement, so stamping is additive by
construction. **Five DB tests, and reverting the fix fails 3 of them** — including the live sequence
— while the two that should pass either way still pass. **Q-273 is NOT complete:** sleep, activity
and training load still carry no stamp, because only two model-version constants exist and defining
three more is a judgement about each pillar's model, not an implementer's aside. `CLAUDE.md` gains
the rule the entry asked for, with the worked example where pooling four model versions turned
r = +0.67 into r = −0.06 and stood in the docs for eleven days.

**The day's AI surfaces can see each other now (Q-291).** The morning readiness insight once advised keeping intensity low on a raised temperature; that evening the digest cheered the two sessions that followed and said to keep the same energy tomorrow. The digest read nine sources and **readiness was not among them** — so this was data plumbing, not a prompt tweak, which is the question the entry itself asked to settle first. It now reads the day's insights before writing, inside its context hash rather than appended after it. **The read graph is one-directional and must stay acyclic:** two surfaces hashing each other's text would invalidate each other forever, and model output is not deterministic, so it would never settle — the digest is excluded from what the digest can read, in code and in two tests. The instruction permits disagreement and forbids only *silent* disagreement, which is also pinned, so a later tightening to "never contradict" fails rather than passing quietly.

**The journal sweep, and the cadence it revealed (LA-25).** `check-doc-index-size.js` failed a *migration* PR at 61 unlinked entries against a limit of 60. **25 folded into a new `history-2026-08-25.md`, unlinked 59 → 34.** The finding is worth more than the sweep: the README's "~20 loose files" trigger was written for a load that no longer exists — **seventeen entries landed on 2026-08-25 alone** across the concurrent sessions, and the count went from a post-sweep 32 on the 24th to 61 the next day, so a sweep clearing 25 buys **about a day and a half**. This is a near-daily chore now, and the practical trigger is the guard failing someone's PR. **The cheaper half is the citation habit** — cite the review or handoff doc, not the loose journal entry — and this run broke it knowingly: BF-11e cited two journal entries from the nutrition index for want of a handoff doc, which costs the linked floor **two, permanently**. A sweep can undo a fold; it cannot undo a citation.

**The repo root is guarded now, after one scratch file failed every open PR (BF-20).** `m.mjs` — a Playwright screenshot scratch script referenced by nothing — was committed at the root and merged; its `console.log` calls fail `no-console`, so **`main` itself went red and every open PR inherited it**. A Custom Rules step now refuses a stray root module by name (**Ran 57 of 57**, up from 56) and `.gitignore` stops the common shapes being staged. **The entry's proposed allowlist would have failed on nine correct files** — `auth.ts`, `middleware.ts`, `drizzle.config.ts`, the three `instrumentation*.ts` and more — and named a `tailwind.config` this repo does not have; it is derived from `git ls-files` instead, because a guard that fails on correct files gets deleted by the first person to hit it. **And the `.gitignore` half deliberately does NOT cover `.ts`**: fourteen legitimate root `.ts` files exist and a new one would be *silently untracked*, which is a worse failure than the one being fixed — the check covers `.ts` loudly instead. Sibling sweep: the root is otherwise clean.

**Five more catalogue rows get what their family already recorded (LA-24 Kind 1, migration 219).** `Dumbbell Overhead Press`, `Machine Shoulder Press` and `Arnold Press` gained **traps** from `Barbell Overhead Press`; `Lat Pulldown` gained **upper back**; `Decline Bench Press` gained **shoulders**. All five sat at 2 muscles, so BF-15's ≥ 3 anchor rule barred them. **Every before-value and every precedent was read from PRODUCTION**, which also confirmed migration 216 had landed there — so BF-16a's "not run against production" caveat is struck. **LA-24 is now only the question that needs you:** BF-16a's additions to `Barbell Shrug` and `Barbell Hip Thrust` had no in-catalogue precedent, so extending them to the shrug and glute-bridge families is the same judgement made five more times unasked — a machine shrug's handles may be supported where a barbell shrug's grip is not. `Gate: owner`, phrased for an answer rather than an implementer.

**The planner can look in your library before asking the AI (BF-11g).** *"It prefers meals already in the planner and adds other meals around it."* Per unpinned slot: filter by the slot's meal type (plus untagged), rank by `fitDistance`, take the best if `mealFit` passes, else fall through to the model. **Engine half only — nothing sets `useLibrary` yet, so this is off for every real request until BF-11h.** **The plan's ranking was subtly wrong and reading the scaler is what showed it:** `scaleIngredientsToTargets` moves each macro *group* independently and clamps each, so a meal's **size** is the one thing portioning always fixes — judging saved totals would reject a perfectly-shaped half portion. Every candidate is now run through the real scaler before it is ranked or gated, so it is judged on what it will become. Verified live against a real model: the same meal went to the **lunch** slot when tagged Lunch and to **slot 0** when untagged — an A/B on one variable — and it landed **F 20.4** against a 20.3 target while the two AI meals in the same plan came in at 37.9 and 27.8. Also fixed: more pins than slots used to truncate **silently**, and now reports `droppedPins`.

**Saved meals can say which meals they are (BF-11e).** *"We don't want pancakes recommended for dinner"* — a join table on the user's own meal types (migration **217**, local SQLite **v29**), reusing `MealType` rather than inventing a parallel category. **Storage and transport only; no picker yet (BF-11f), so nothing is user-visible.** Three decisions each fail silently if taken the other way: `undefined` leaves stored tags alone while `[]` clears them (a `.default([])` would make tags impossible to keep, since every save today omits them); soft-deleted meal types are filtered on **read** rather than by deleting join rows, so restoring a type restores its tags; and client-supplied type ids are ownership-verified even though the join table has no `user_id`. **A defect was caught in verification, not review:** an unknown meal type answered **500**, and offline that is worse than wrong — the outbox retries 5xx forever and quarantines 4xx, so a mutation that can never succeed would have wedged. Both write handlers now answer 400 with a message. **One link is deliberately unwired** — the sheet's outbox payload carries no tags, because absent means *leave them alone* while sending the loaded ones would revert another device's change; BF-11f's entry and a call-site comment both carry that obligation.

**A scan of several meals stops merging them into one (BF-11b).** `ScanSchema` returned exactly one meal for every input, so a week of meal-prep containers or *"lunch was X, dinner was Y"* became a single estimate. The route now returns a candidate per meal, with the top level unchanged as the first — **five call sites read it and two gate on `ingredients`/`calories` being populated there**, so it must never become an array. *(The entry said four and named `saved-meals-sheet.tsx`, which does not call this route; the plan is corrected in the same PR, since BF-11c reads it next.)* **The measurement is the story.** The first version of the split rule ended *"when in doubt, return one"*, which fought its own repeated-portion clause: five identical tubs came back **5, 5, 1, 1, 5, 1** — a coin flip on the headline case that one passing run would have shipped. Splitting the rule in two took it to **30 of 30 across six cases**, including three chosen because sharpening the split is exactly what could start cutting one crowded plate into six. *(Its test file then went flaky on `main`: the route takes **4.3 s to import** — it reaches the Drizzle adapter — and that was being paid inside the first test's 5 s budget. Hoisted to `beforeAll`: 3834 ms → 11 ms. Third timing-dependent test defect today, and the common root is narrower than "async" — **something timed in the test that is not the behaviour being asserted**.)* **Worth knowing generally: the model IS reachable from an agent sandbox**, so an AI behaviour change can be measured here rather than reasoned about — no baton had recorded that, and nothing else would have found this defect.

**The Body Battery guard stopped swallowing the signal a separate investigation was waiting on (TN-7).** TN-4's fix is right and stays — a stress-model failure costs the stress strip, not the whole card. But its catch only called `console.error`, which reaches no table, so from that deploy a recurrence of the fault that fired **31 times on 2026-08-23** wrote nothing anywhere. LA-20's Known-Issues row asks for a zero `error_events` count over a window where this route was called, and with the guard and without the report that count is zero **whether or not the cause is fixed** — a condition that can no longer fail. The catch now reports as well as logs, tagged `/api/body-battery#stress` so the row is attributable to the strip rather than the outer catch. **The window that counts starts at this deploy**; every zero before it is silence from the guard, and the row says so now. **The general shape, worth naming: a hardening change that turns a loud failure into a quiet degradation also removes the evidence a separate open investigation was relying on.** *(Its first test then asserted `toHaveLength(1)` on a fire-and-forget write that two tests in the file both trigger — green locally and on its own PR, red on the next one. Fixed to assert content rather than count: **an assertion about how many times something happened is an assertion about scheduling** unless one write is the only possible writer.)*

**A required check was failing at random on PRs that could not have caused it (BF-18).** `Tests` went red on a **docs-only** PR with `expected 8 to be +0`, and the same file passed locally 3/3. The autopack test waited for the packer's second phase and asserted its third with **no wait at all** — the three phases commit separately and deliberately, so it allowed the final delete exactly zero milliseconds, which holds on an idle machine and does not on a runner sharing one Postgres with ~380 files. It now polls for the finished state. **Reproduced rather than inferred:** injecting an 800 ms lag between phases 2 and 3 reproduces CI's message *and its line number*, and the fixed assertion passes against the same lag. The sweep found no sibling with this shape — it is the only file in the repository using an `until()` poll, and the three fixed-sleep assertions nearby are all negative ones a short sleep can only make falsely *pass*.

**Five exercises now record the muscles their sibling movement already had (BF-16a).** A cable chest dip left out the shoulders, a dumbbell shoulder press the traps, a cable pulldown the upper back, a barbell shrug the upper back and forearms, and a barbell hip thrust the quads, lower back and adductors. That is the real defect behind *"hip thrusts and dumbbell shoulder press should be able to be a secondary"* — the role rule reads muscle counts and BF-15's anchor rule wants ≥ 3, so a row seeded with two was barred whatever the thresholds said. **The entry's premise was wrong in one way that mattered:** it called this production drift, and it is a defective *seed* — all 140 seeded rows fingerprint identically in the dev DB and production, so it reproduces locally and was proved through the live `/api/weekly-muscle-sets` route rather than reasoned about. Migration **216**, idempotent and case-insensitive. **The scan found eight more rows with the same shape; they are LA-24**, split into the five that a family member already answers and the three families where BF-16a's own additions have no precedent to propagate.

**Lane B's 2026-08-25 run — 19 PRs — is written up in [`docs/handoff-2026-08-25-platform-lane-b-nineteen-prs.md`](docs/handoff-2026-08-25-platform-lane-b-nineteen-prs.md).** Read it with the baton at `docs/agents/state/implementation-lane-b.md` before taking a Lane B item: the entire Lane B surface was traversed and every remaining candidate is gated, declined, parked, needs hardware, or wants a plan first. **Nothing that run shipped is device-verified.**

**There were two quantity sheets and the busier one was wrong (BF-26).** The owner's *"everything looks the same"* was literally true of the diary's: its `−`, value and `+` were the same square at the same fill. Both sheets render one `quantity-editor.tsx` now — `srv`/`g`, absolute presets, `MACRO_COLORS`. **And a font-size class on an `<input>` does nothing on a phone:** `globals.css` sets `16px !important` under 640 px for the iOS-zoom guard, so the value needed `!text-2xl` to outgrow its steppers at all. Only two other inputs carry a size class and both want ≤16 px, so it is narrow — but silent ([`journal`](docs/overview/entries/2026-08-25-quantity-sheet-convergence.md)).

**The Nutrition day screen's meal grouping was inverted (BF-24, artboard 1).** The owner's *"thats not what the mockup looks like"* had a precise cause: artboard 1 groups the food ROWS within a meal — name as a label above its own card — where Q-395b grouped the MEALS within one container. Both are "grouped", which is why a coverage checklist passed while the screen still looked wrong. Header is one band now (26 px title, date as subtitle) and the meal line is a name and one number. **②③⑥⑦ deliberately not done**, each with a reason on the entry: ② touches `/health` too, ③ is Q-395c's, ⑥ is Q-406's, ⑦ is BF-28's fold rule ([`journal`](docs/overview/entries/2026-08-25-nutrition-day-artboard-parity.md)).

**The back gesture stops navigating the page away (BF-27).** `useSheetBackDismiss` was imported by 5 of 45 sheet files and 0 of 6 dialog files; everywhere else Android back reached the WebView, which took the page underneath with it. Shipped **not** as the 40-site sweep the entry scoped but as one component rendered by `SheetContent`/`DialogContent` — so it covers every sheet, every dialog and every future one, closes through Radix's own `onOpenChange` (keeping each surface's existing guards and cancel arms), and reaches the uncontrolled sheet a per-site sweep could not. Dialogs were included deliberately: back can only take a cancel arm, asserted on the database. Three mutation-checked e2e cases, including the nest ([`journal`](docs/overview/entries/2026-08-25-back-dismiss-sweep.md)).

**The timeline's workout card had somewhere to land for seventeen days (Q-93-followup).** It was left unwired in August because no screen showed a past session; `/health/day` shipped 2026-08-08 and nothing tracked the dependency clearing. Workout and walk now open it; `bedtime` and `tag` stay inert, having no detail view to reach. Two more of the entry's premises were stale — the second renderer it names is deleted, and the `ev.date` it needs is stamped centrally, so no `app/api/**` change was involved. Guarded by a mutation-checked e2e spec, because a row wired to nothing renders identically to a wired one ([`journal`](docs/overview/entries/2026-08-25-timeline-workout-day-detail.md)).

**The queue tool stopped calling shipped work "ready" (LB-11), and then read the two entries it was still missing (LA-23).** `next-item.js` had never learned to read a `- **Keep:**`, so an entry that shipped kept its pre-shipping priority — **17 of Lane B's top 21 were finished**, and the first startable item sat below the tool's ten-row window. A KEEP bucket prints them with what they owe; READY went 86 → 65. **LB-11 closed by recording that Lane A was unaffected; it was not.** The parser required a literal colon, and TN-3a and TN-4 write `- **Keep — what is NOT done:**`, so both read as unstarted and sat at **#1 and #2 of Lane A's READY** — each owing something no sandbox can do. `Keep` now takes a colon **or** a dash, checked against all 196 entries: ten lines begin with the word, two are those Keeps and eight are prose, so the rule covers the whole population rather than a guessed one. Lane A's READY 90 → 88, and its top row is startable.

**Three more cards say so when their fetch fails, and the sweep was three, not ~18 (Q-499).** The
Oura section is the one that mattered: its `return null` means *no ring connected*, so a 429 made a connected user's whole ring section vanish. `.catch()` was never the guard — `cachedFetch` resolves on a non-ok response, so only `onError` fires there. Ten other candidates were judged legitimate.

**The offline tab tap is not silent, and Q-555 closes unfixed.** Driven with the worker blocked so
`controller` is `false` throughout: offline the tap **navigates** and `app/error.tsx` says *"You're offline"*. The one failing window is *before hydration*, where `handleNavClick` cannot run, the anchor navigates natively and Chrome's error page appears — visible, not silent, and inherent: neither our JS nor the worker exists yet. The parked fix would be inert there and a false alarm everywhere else, so nothing merged.

**The diary row is the shared row now, and its sheet can delete (Q-406).** The pencil and bin came
off every food row. **It turned up LB-10, now fixed:** `use-sheet-back-dismiss` was not double-invoke
safe, so the quick-edit sheet could not be opened in `pnpm dev` at all — production was never affected, the pre-merge surface was. **The entry said five sheets; one.** The other four mount with `open` false, so their double-invoked run bails before pushing. `e2e/sheet-back-dismiss.spec.ts` guards it, and fails on the unfixed hook.

**The Nutrition day screen is grouped sections now, and the ring is split by macro (Q-395b).** Gaps
**420 px → 280 px (16% → 11%)**, 111 px shorter — not the *"most of the vertical space"* the entry claimed. Both themes, 11 of 11 sections. `Gate: device`.

**A food draws one way everywhere now, and its amount is edited on its own screen (Q-395a).** The
builder's rows became the shared `FoodRow`; `ingredient-row.tsx` is deleted and the quantity control lives in a new sheet. Segmented tabs went 44 → 48 px in the shared primitive, lifting 8 call sites.

**Build a Meal's ingredient picker is its own component (BF-11a).** `saved-meals-sheet.tsx` 774 → 590 lines; `openBuild`'s reset setters became a keyed remount.

**Q-319's water bug was unreachable, and the half its entry called fine was the broken one.** The generic sheet wrote an ABSOLUTE water total — reintroducing SYNC-P7 — and queues `waterMlDelta` now.

**The workout write path can be driven past set 1 (Q-461).** The Start Set bounce never gave Playwright a stable frame — 85 ms vs 8,009 ms with and without the reduced-motion rule.

**Disk maintenance works from a desktop again (Q-544).** The DB-footprint and device-metrics cards touch no plugin but sat after `OuraBleDebug`'s native early-return; both moved above it.

**The frame packer has a button (Q-316).** In the DB-footprint card, with the packable count beside it. Its confirm copy does not read like the lossless VACUUM one — this is the only control that DELETEs archival frames — and a refusal is listed with its reason. `Gate: device`.

**Declaring a ring re-key has a button (Q-317).** On `/admin/oura-ble`, outside `OuraBleDebug`, which renders nothing without the plugin — the laptop doing the re-key. `Gate: device`.

**The two BLE consoles poll the redecode job instead of guessing (Q-318).** A completed run reported `failed: 502` and the backfill said "Done" at the gateway timeout; both wait for the real status now.

**The Devices card stops calling the ring healthy with no key (LB-5).** Checks `hasKey()` and links to `/admin/oura-ble` when false. `Gate: device`.

**A ratchet row kept an already-fixed file exempt (Q-138).** `health-content.tsx` sat in `check-component-size.js` at a **915** baseline while being **651** lines — 115 lines of room it no longer merited. The script's header has said *"shrinking one below the limit? delete its row"* since it was written and nothing enforced it; **missed three times**. Enforced now, and two of Q-138's six rows turned out already done, with line numbers pointing at nothing.

**The accessibility rules ran and could not fail (Q-282, headline corrected).** *"No automated accessibility check exists in CI"* was false — `jsx-a11y` rides in via `next/core-web-vitals` and has run all along, at **warning**, so `pnpm lint` exited 0 with violations present. The app measured at **zero**, so seven decidable rules are `error` now. **It does not close the entry** — a linter cannot measure touch targets or contrast, and that half is unbuilt.

**A Coach swap leaves every program-structure cache key stale (LB-13, filed not fixed).** `app/api/coach/apply/route.ts:71` calls `invalidateProgramStructure()` **on the server**, where `lib/cache-groups` reaches localStorage and on-device SQLite — nothing. No client caller covers it, so `workout-data`/`next-session`/`workout-card:` keep pre-swap values, and `workout-card:` is `freshWithinTtl`: the Q-262 condition where stale **survives** rather than flashes. **Read from source, not reproduced.** Lane A's.

**The queue says which rows it has not classified (LB-12).** Measured: **77 of 193 entries state no lane**, and **53 of Lane B's 55 READY rows** — so two are rows the queue knows are Lane B's. Showing them to both lanes is right; being silent about it was not. They print `⟨lane unstated⟩` now. **The sweep is the Orchestrator's** and is filed, not done.

**The colour-only score subset was ONE site, not a sweep (Q-281).** Nine `scoreBand()` call sites read rather than counted: only `readiness-breakdown`'s "Final readiness" row coloured without the word. `contributor-chart` has no `.label` at all and is correct — it renders the legend. **A zero-label grep is not a violator list**, the Q-491 lesson again.

**The volume card stops guessing, and the surface was WRONG rather than absent (Q-305, half).** It
already drew a band — a hardcoded generic **10–20** — while `packages/shared` computed real per-muscle MEV/MAV/MRV beside it. The goal multiplier is what makes that material: Q-305's own first pass read the unscaled row and called lats *below MEV*; against the app's own table it is **in range** and three muscles are over MRV. The band's **word** ships with its colour — two of the four are red and mean opposite things. Push:pull stays open: it needs a taxonomy belonging in `packages/shared`, which is Lane A's. `Gate: device`.

**The raw-store console says what its numbers mean (Q-538, half).** It printed **209,326 rows, 0 rolled up, 31.2 MB**, and it took a source trace to know `0 rolled up` was the fault — the prune's predicate matches nothing, so the 14-day window can delete no row at all. It says unbounded, unbacked (past the 25 MB Auto Backup quota) and shedding now, in words. **The bound stays blocked** on an unbuilt rollup consumer that is Lane A's. `Gate: device`.

**The queue tooling learns `OR-` (PS-6).** The Orchestrator prefix was never in the ID alternation, and the failure was **silent deletion**: `next-item.js` counted **194 entries with and without** a scratch `OR-99` and printed it nowhere. One shared `scripts/lib/entry-id.js` now, not four regexes. PS-6 named three sites; there were four.

**The vacuum button can reach the table that needs it (Q-315).** The generalised `/api/admin/vacuum` had **no caller** — the one control still posted to the `oura_raw_samples`-only route. A table picker fed by that route's own `GET` fixed it. **The owner pressed it on 2026-08-25 and it correctly reclaimed 0 B**, because `error_events` was never bloated; see the Known-Issues row above.

**The Coach's undo has a button (Q-467).** A whole undo subsystem — route, five domain handlers, a `captureBefore()` in each, the `undone_at` column, even the struck-through styling — had no caller. Its route's `invalidateProgramStructure()` runs server-side and clears nothing, so the client clears the superset instead (that trail led to **LB-13**). `Gate: device`.

**E2E is green again, and the cause was a modal, not a missing button (OR-1).** Home's first-open
Morning Check-in `aria-hidden`s `<main>` while it is open, so every `getByRole` on Home reported the
affordance **absent** rather than covered — `getByLabel` found it and `getByRole` did not, on correct markup. `suppressMorningCheckin()` is the fixture. Two wrong turns are on the journal entry, one of them mine: a tile refactor built on the wrong theory, reverted in full after measuring.

**Q-477 is COMPLETE — the ratchet baseline is empty** (78 bare calls across 38 files → **0 across
539 scanned**). The last slice did not thread `tz` into the Zustand store; it stopped the store guessing. `onRehydrateStorage` compared against Brisbane while the workout screen compared against the user's zone, so a non-Brisbane user could have the day rolled over twice — and a rollover clears the day's completed-set ticks. One shell component in the root layout answers it now. `Gate: device`.

**"Nine collapsibles missing `aria-expanded`" was actually two (Q-491)** — one retired, four already Radix, two a back chevron. `weights-summary.tsx`/`added-weight-toggle.tsx` were real, now fixed.

**The end-of-workout "How hard was that session?" prompt is gone (Q-420).** 25.6% fill rate; `sessionEffort()` already derives it from set RPEs at read time, so nothing downstream changed.

**Two Health cards stop vanishing on a failed fetch, and the fix needed a second one (Q-499).** They show "Couldn't load…" on a 429/500 now. `onError` alone didn't work: `cachedFetchCore`'s dedup relayed a failure only to the torn-down owner, never a joined caller — fixed in `lib/sqlite/cache.ts`.

**The database reclaim is DONE, and the last piece turned out to be a false premise.** The owner's
`oura_raw_samples` vacuum reclaimed **36 MB** (93 → **57 MB**) and the automatic packer is observed in
production — four runs, **318,883 → 205,278 rows**, 0 faults. **Q-315's `error_events` reclaim was
pressed on 2026-08-25 and correctly returned 0 B**: that table was never bloated, and the "4 live
rows in 49 MB" figure driving the entry was a stale `n_live_tup` estimate. Closed — see the
Known-Issues row for what it really holds.

**Four engine fixes, each of whose entry described something other than the defect.** A deload's
stored `0` was being served as the previous 1RM (**Q-298** — `listPrevious1rm` gated on `IS NOT NULL`
while its two siblings already filtered `> 0`); **11 of 81 production sessions (13.6%) ran 534–845
min** and are real workouts left running, so **LA-21** culls the *duration* and keeps the session,
with `isPlausibleSessionDuration()` consolidated from three copies onto both the MET and HR branches;
the fixture MET constants sat below `estWorkoutKcal`'s 1.5 floor, so **every** MET strength estimate
was **0** in CI and those tests passed vacuously (**Q-312**); and `sessionEffort()` now returns
`{ rpe, source: 'self' | 'derived' }` so a mean of set RPEs is never read as a self-report
(**Q-420**). ⚠️ **None device-verified.** Detail, and the four wrong turns that produced them, in
[the Lane A handoff](docs/handoff-2026-08-24-platform-implementation-lane-a-engine-run.md).

**The raw-frame packer runs itself, and it deletes only what it verified (Q-541 complete).** A button does not hold a growth curve — `oura_raw_samples` regrew to 92 MB within five days of the 2026-08-18 hand-run. Fires from the ingest path now, throttled per user, `OURA_AUTOPACK=off` kill switch. Automating it made the delete's race reachable, so phase 3 deletes by row id, not ds range ([`journal`](docs/overview/entries/2026-08-23-feat-oura-autopack.md)).

**Logging food evicted the caches before the server had the write (LB-4).** The invalidation fired
correctly and too early: subscribers refetched a server that lacked the log and re-cached the pre-log
figures, which then stood for the key's full TTL — Home read 42 kcal high, exactly one entry. The
engine write paths now invalidate on **both** sides of the push (`pushThenRevalidate`); the immediate
call stays because offline it is the only one that fires. Six `components/**` sites carry the same shape — filed as **LB-6**, audit done.

**Three route-hardening guards, none of them a fix for an observed symptom (Q-454, Q-455, Q-465).**
Three GET routes answered a parameter or configuration question before establishing the caller was anyone — no data leaked, but `GET /api/push/subscribe` disclosed whether the deployment has push configured to anybody who asked. `GET /api/oura-ble/decoder-constants` answered a failed constants read with an **empty** 500, so a client doing `res.json()` got a parse exception on top of the real fault. And `POST /api/day-checkin` accepted a body of `{}` with a 201, writing a row indistinguishable from a check-in in which the user answered nothing — guarded now on **both** write paths ([`journal`](docs/overview/entries/2026-08-23-route-hardening-batch.md)).

**Three ring-service fixes, none verified on the ring (Q-537, Q-533, Q-388 item 2).** Key backup
(`/admin/oura-ble` → **Show key for backup**), a re-sync completion notification, and a connect sequence that resets the live-HR levers a killed session left on. **All native — inert until a new APK is installed, and until then the ring key has one copy.** `Gate: device`. **Item (3) needed no work:** 6,346 battery polls measure the drain the entry called unmeasurable (−22/−24/−22/−38/−15 overnight), confirming the owner's report; the SpO₂ A/B is wear, not code.

**Preferences have a server home; nothing reads it yet (Q-392, engine half).** `users.preferences`
JSONB (mig 206) behind `GET`/`PATCH /api/user/preferences`, merging under a row lock — the unlocked version demonstrably drops the other device's key mid-merge. **Nothing the owner can see changed:** the read sites are `components/**`, so Q-392 was re-scoped to Lane B, not closed.

**The UTC-offset fixture sweep came back clean, and found something else (Q-394, LA-19 — both
closed).** One *correctly written* test failed because the code under it re-derived midnight in
Brisbane: `aestMidnight` takes a timezone and only **9 of 22** call sites passed one. All 22 do now.

**`DELETE /api/activity-logs` stopped reporting success for a delete that deleted nothing (Q-556).**
Q-328's outbox delete reconciled the race that made this unsafe; it now 404s for a nonexistent or not-yours id while a double-tap still matches. The web fallback treats a 404 as success.

**Admin Device Metrics sparklines stopped stretching a partial day to full width (BF-10).**
`Sparkline` takes optional `times`/`timeDomain` and projects `x` by position in the day, so a
night-only SpO₂/HRV signal renders with dead space either side, not apparent 24-hour coverage.
Verified by mounting the component off the native-gated page. `Gate: device`.

**Coach undo wrote over whatever was there (Q-468).** With two stacked changes on one exercise,
undoing the first returned the row to its original value while the history showed the second in
effect. `driftAgainst` takes a side now. Latent: nothing calls the undo route yet (Q-467).

**The worse sync failure had the softer handling (Q-476).** A mutation rejected by the push route's
schema was deleted forever — no badge, no toast, no retry. It returns a per-item error now, so the
row is kept and dead-letters. **The entry's fix shape was wrong:** `retryable: true` backs off the
whole queue under Q-475's split; `retryable: false` quarantines. Write-time companion still open.

**`workout_sessions`'s dead column owned the name the live one was used under (Q-474).** Of its two
FKs to `program_sessions`, `session_id` is live and `program_session_id` never written — yet the
Drizzle property `programSessionId` pointed at the dead one, which already cost a session. Property
names only; the column stays (dropping it is data-losing, owner-gated).

**A rate limit is not an idempotency mechanism (Q-470).** The background prescription regeneration
fired twice for one session-day — two call sites, and `cachedFetch` revalidates on every screen open.
It now takes an in-flight marker keyed like its fingerprint, released when the work settles
(**including on rejection** — a leak would wedge that session-day) and checked before the limit.

**The AI-usage screen's top row was an artefact of its own fingerprint (Q-471).** Three meal-plan
sections fingerprinted on a rounded calorie target alone, so every reroll read as a double trip.
**44 of the 89 redundant calls were this artefact; the other 45 are real** (Q-470, Q-469) —
[journal](docs/overview/entries/2026-08-23-ai-fingerprint-granularity.md).

**The Oura rollup now takes an I/O port (Q-545, D2 Task 2).** `aggregateOuraRawSamples` is now
`runOuraRollup(io, timezone, opts)` behind a 22-method `RollupIO`; `adapter.ts` drops 6,906 → 5,818
lines, no behaviour change. Models followed — `sleepnet`/`step-counter`/`dhrv` take a `ModelRuntime`
instead of importing `onnxruntime-node` — and constants followed by injection, so `run.ts` reaches
**zero** server-only modules. Device half is Task 3, unblocked
([journal](docs/overview/entries/2026-08-23-constants-injection.md)).

**The public repository is now the working repo.** `nekodas-neko/TrainingAi_Open` carries the
history that was ported out of the archived private repo (PRs #1, #3, #7). The archived repo is
reference only — nothing lands there.

**Work runs through six standing agents.** Two Implementation lanes split the backlog by file
ownership, plus an Orchestrator owning the queue and docs, and a BugFix, a Tuning and a Review
agent. Their roles, authority limits, lane contract and cold-start prompts are in
[`docs/agents/README.md`](docs/agents/README.md). Start there, not straight off the queue.

**Entry IDs come from your agent's own prefix now, not a reserved band** (2026-08-19). `LA-` Lane A ·
`LB-` Lane B · `BF-` BugFix · `RV-` Review · `TN-` Tuning · `PS-` one-off sessions, counting up with
no shared pointer to collide on. Bands exhausted and their ledger drifted twice; the prefix says who
*found* an item and never changes, so an entry filed by Review and built by Lane A keeps its `RV-`.
Legacy `Q-` numbers stay valid and are not renumbered. **An implementer's first command is now
`node scripts/next-item.js --lane <A|B>`**, which prints READY / PARKED / UNCLASSIFIED from the new
`Needs:` and `Gate: owner|device` fields — the queue file cannot show you which of its top entries
are actually startable.

**Session handoff:** [`docs/handoff-2026-08-24-devices-daily-summary-wipe-retraction.md`](docs/handoff-2026-08-24-devices-daily-summary-wipe-retraction.md)
— Tuning retracted its own Q-528: `oura_daily_summary` was never wiped, and **43 of its 45 rows were
created 2026-08-17 07:50**, straddling the reading that reported one. The count came from
`pg_stat_user_tables.n_live_tup`, a **planner estimate** that reads **0** against `oura_raw_packed`'s
**764** real rows — **to ask whether a table is empty, run `count(*)`**, a rule now in `CLAUDE.md`.
With Q-525 un-suspended, both of chronic stress's countable gates were measured and **both pass**, so
its refusal is inside the granular layer, which records no reason for a null (**TN-1**).

**Session handoff:** [`docs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md`](docs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md)
— CI's **Migration Check** couldn't fail on a broken migration; fixing that caught `142_claude_ro_views.sql`
creating a view over a table `143` creates, aborting on every fresh CI database. Also the CSP's
missing `'wasm-unsafe-eval'` and the done screen's first-ever-weight calorie estimate. **PS-3 closed
on top:** the four migrations retried on every cold start are idempotent now, 206 of 206
([journal](docs/overview/entries/2026-08-20-non-idempotent-migrations.md)).

**Older session handoffs:** [2026-08-20 workouts energy/RPE intake](docs/handoff-2026-08-20-workouts-energy-accuracy-and-rpe-intake.md)
(reasoning, not status) and [2026-08-17 agent model/device findings](docs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md)
(**Q-536 CLOSED, confirmed on device**; its cause **Q-314** is still live and reopens on every re-pair).

**Open PRs:** run `list_pull_requests` — any snapshot written here goes stale within the hour, and
one already did. The two oldest, #6 and #10, are public-repo-migration handoffs open since 08-17.

**What shipped recently is in the journal, not here.** Read `docs/overview/entries/` for the current
window, then the newest `history-*.md`. The 157 dated status notes this section used to carry are in
[`docs/overview/status-archive.md`](docs/overview/status-archive.md), which records why.

---

## 🔑 Waiting on the owner

**One place to look for everything the engine cannot unblock itself.** Each row is verified against
the code or against production data, not inferred, and each has a `Gate:` or `Verify:` field on its
backlog entry so `next-item.js` parks it instead of handing it to the next implementer as ready work.
Last swept **2026-09-03**.

| What | Why it needs you | Where it is recorded |
|---|---|---|
| **Run a `fullHistory` rollup pass** | ⛔ **DO NOT ATTEMPT — the workaround is measured not to work, 2026-09-03.** Three attempts have now produced nothing: the async jobs of 08-30 and 09-03 03:00 (reaped at 30 min), and the **synchronous** run at ~08:00 on 09-03, which had written nothing 35 minutes later. The full-history write path deletes and reinserts every row, so a completed pass leaves one shared `created_at` — there are **17 distinct stamps** and the oldest is **2026-08-17**, which dates the last success. The previous advice here ("run the sync path once only, it completes behind the 502") was true on 2026-08-17 and is not true now. **Nothing is owed by you.** ✅ **Diagnosed the same session:** the rollup worker loses its database connection mid-pass (`Connection terminated unexpectedly`, `at Worker.<anonymous>`, recorded in `error_events` at 08:04:43Z and once before, on 2026-08-17). Not the Postgres server — `max_connections` 500, 11 in use. Engine fix, no owner action. |  TN-1, Q-525, LA-56 |
| **Decide the rest/active HR anchor** | **Freeze at a dated constant (recommended) or move to a 90-day trailing mean.** The 90-day option moves the at-rest share **14.9% → 25.9% on 56 of 57 days** — a Body Battery re-levelling, not a stability fix. Structural: a longer window always sits above a shorter one while fitness improves. | Q-515, [review](docs/reviews/2026-09-02-hr-rest-anchor-level-shift.md) |
| **An S25 smoke run** | Local SQLite **v34 + v35 + v36** have never been opened on a device. v35 and v36 are plain ADD COLUMNs, but they sit behind v34's table rebuild, so a device upgrading from v33 runs all three in one pass. | Known Issues, three rows |
| **The PS-17 back-fill** | `POST /api/oura-ble/samples/redecode` is admin-session gated. Also recovers two of PS-19's seven nights. | PS-17, PS-19 |
| **PS-20's counted-walk test** | The `0x73` cm-per-step hypothesis cannot be settled from stored data — it needs a walk with a known step count. | PS-20 |
| **`worn_hours_ble` and `recovery_index_hours`** | Both **0 of 107 rows** on `oura_daily_derived` with no producer. Populate or drop — and dropping is destructive. | Q-510 `Keep:` |
| **Zone minutes / active minutes re-band** | Tuning has proposed and measured it; it re-scores a contributor reading ~6/100 on 53 of 59 days. Your quoted instruction covers the **anchor** half only, not the WHO band shift. | Q-523 |
| **The movement-per-hour boundary** | Same boundary as the anchor decision above, so it waits on it. Saturated at **856 of 857 waking hours** — it measures ring wear. | Q-522 |
| **Body Battery's drain model** | The replacement is **already owner-confirmed and fitted** (goal-normalised `c`, BMR-proportional baseline). It is sequenced behind the anchor decision above, so that one release unblocks it. Today `0` means *"you wore the ring a long time"*, close to the opposite of what you asked for. | Q-521 |
| **Whether to close Q-283** | Its "~11 MB of unused indexes" is now **800 kB** once primary keys and unique constraints are excluded, and its one real candidate was already dropped. Implementing it means a destructive migration for 0.4% of the database. | Q-283 |
| ~~Approve the Sentry tunnel's widening~~ | ✅ **DECIDED 2026-09-03 — delegated, and reverted.** The tunnel ships behind the auth gate: a signed-in request falls through, so BF-92's reported defect (13 days of browser silence while signed in) is fixed without it. Exclusion would only have added sign-in-screen errors, at the cost of an unauthenticated relay to any Sentry project via this domain. **Still owed: the device check** — a deliberate throw from the APK appearing in the dashboard. | BF-92 |
| **Where "Exercise detected" gets its data** | Its only writer was the Oura Cloud sync. Either the BLE classifier feeds the existing review UI, or the card and its route retire. Either branch is a different feature. | Q-231 |

## ⚠️ Known Issues & Risks With Recently Shipped Features

> **This section is the OPEN issues. Resolved ones live in
> [`docs/overview/known-issues-resolved.md`](docs/overview/known-issues-resolved.md)** — 53 entries,
> 1,092 lines, moved out 2026-08-13. **Grep the archive before concluding something has never been
> looked at**; "we already fixed that, and here is what it turned out to be" is why they are kept.
>
> **Striking an issue means MOVING it there, not marking it ✅ in place** (`CLAUDE.md`, Session
> Wrap-Up step 2). Without that rule this regrows — 72 ✅ entries had accumulated before the first
> sweep, and 53 of them had nothing outstanding at all.
>
> An entry only leaves when **nothing is still owed**: no open work, no pending owner or device
> check, no un-run follow-up. Nineteen ✅-marked entries stayed for exactly that reason and are still
> below.

### [nutrition][platform] 🟡 A meal plan can point at another account's saved meal and meal type (RV-42, 2026-09-03)

The plan is ownership-checked (`ownedPlan`); its child ids are not. `meal_plan_meals` rows take
`savedMealId` and `mealTypeId` straight from the request — `z.string().uuid()` proves the shape and
nothing about the owner — and the table has no `user_id`, so the FK is the only ownership link and it
only proves the row exists. Driven as a second account through **both** doors:
`POST /api/nutrition/meal-plans` (201) and `PATCH /api/nutrition/meal-plans/meals/[mealId]` (200),
read back from Postgres pointing at the seeded user's rows.

**No data leaks** — the meal-plan read joins neither table, so `savedMealName`/`mealTypeName` come back
`null`; that is the half RV-32 had and this does not. **What it costs is a cross-account write:** both
columns are `ON DELETE SET NULL`, so when the referenced row's owner deleted their own saved meal
through their own API, the other account's plan row silently read `<NULLED>`. The fix is the pre-check
`writeSavedMeal` already implements for its equivalents.
[`Review sweep 45`](docs/reviews/2026-09-03-fk-edges-meal-plan-cross-user-refs.md). **Web build, local
database.** The workout and device FK edges are **untouched, not clean**.

### [nutrition][workouts] 🟡 The Coach can write goal numbers the user's own screens refuse (RV-41, 2026-09-03)

The patch schema bounds every goal number at `max(100_000)`, under a comment saying *"'set my calories
to 26000' should be refused by the schema rather than survive to a confirmation card that looks
legitimate."* It is not: 26,000 applies, 100,000 applies, only 100,001 is refused — and the card renders
*"Calories 0 kcal → 26,000 kcal"*.

One column, two validators, and the looser one is the path an LLM writes through. Measured by sending
the same value to both surfaces: `calories` 20,000 vs 100,000, `proteinG`/`carbsG`/`fatG` 2,000 vs
100,000 (**50×**), `waterGoalMl` 20,000 vs 100,000, `calorieGoal` 30,000 vs 100,000; `stepsGoal` is the
one that is tighter. `stepsGoal` also loses its `.int()`, so a fractional value is a clean 400 on the
user route and `500 "Apply failed"` on the Coach's. **The fix is to import the user routes' bounds, not
to pick new constants.** The apply path itself is clean — all four previously-undriven handlers write,
undo, refuse another account (404) and refuse a stale proposal (409 with a drift array).
[`Review sweep 44`](docs/reviews/2026-09-03-coach-write-bounds-vs-user-routes.md). **Web build, local
database; the model was never in the loop.**

### [workouts][platform] 🟡 The malformed-id guard was only pointed at path params; two body-id routes 500 (RV-40, 2026-09-03)

`invalidUuidResponse` exists because Q-482 measured 21 route/method pairs answering 5xx on
`not-a-uuid`. Its own comment calls it *"the guard every dynamic `[id]` route runs"* — and that is the
population it got: **27 route files use it, 27 of 27 are dynamic `[id]` routes, zero take the id from
a body.** All eight unguarded body-id candidates were probed: `POST /api/progression-styles` answers
**500 with `Content-Length: 0`**, `POST /api/workout-templates` answers **500 `{"error":"Save
failed"}`**, four are clean, and two are **unverified** (the probe was rejected on other fields).
Three sibling routes answer the same mistake with `400 {"error":"Invalid id"}`.

The empty body is on a route RV-33 already fixed — RV-33 wrapped the *ownership refusal* in
`withRouteErrors`, and the malformed-id path throws from the driver before reaching it. Both routes
also write an `error_events` row carrying the raw SQL for what is a client input error, filling the
fault channel every session is told to read first.
[`Review sweep 43 §4`](docs/reviews/2026-09-03-ownership-rule-a-and-body-supplied-ids.md).
**Web build, local database.**

### [readiness][app-shell] 🟡 Body Battery prints 50 and calls it "Good" for an account with no data (RV-38, 2026-09-03)

The route is honest and the card ignores it. For the zero-data account `GET /api/body-battery`
answers `hasData: false`, `sampleCount: 0`, `samplesPerHour: 0`, `sufficient: false`,
`anchorSource: "default"` — and the card renders **Good / Steady / 50** with a colour-coded label, a
bar filled to 50%, and no "Limited data" badge. The badge is gated on `hasData`
(`body-battery-card.tsx:95`), so the qualification gets *weaker* as the data gets worse: too few
samples shows the warning, none at all shows nothing.

Everything else on that screen degrades correctly for the same account — streak `—days`, the week grid
`—` on all seven days, the score chip row absent, and `/health/readiness` reading `—`. Readiness is the
number Body Battery opens at, by the card's own explainer. **This does not reopen Q-43** (degrade
rather than blank): the app already computes "I cannot support this number" and already has the
component to say so. [`Review sweep 42 §2`](docs/reviews/2026-09-03-first-run-honesty-and-instant-paint.md).
**Web build only.**

### [devices][app-shell] ⚠️ The `/more/devices` ring card flashes a skeleton on a warm repeat visit (RV-39, 2026-09-03)

Measured on a second visit to an already-compiled route: `[1,1,0,0]` skeletons at 250/600/1200/2500 ms,
against `[0,0,0,0]` on all 13 other sub-routes. Under a second, and filed because the rule has no
threshold. The existing `expectNoSkeleton` helper polls to 20 s, so it catches *never seeds* and is
blind to this class. **Needs the device** — the ring card's real state is BLE, unreachable on web.
[`§3`](docs/reviews/2026-09-03-first-run-honesty-and-instant-paint.md).

### [nutrition][app-shell] 🔴 Nutrition never asks what day it is on resume, so a log after midnight lands on yesterday (RV-35, 2026-09-03)

The tab shell is persistent, and Nutrition's midnight branch keys on `tabEpoch` — which the shell
increments only when a tab is **re-shown**, never on a resume-in-place. Measured across all five tabs
at 23:50 Brisbane under a fixed clock, then +30 min and a `visibilitychange`: dated requests
before → after were Home 4 → **2**, Health 3 → **3**, **Nutrition 5 → 0**; Workout and More issue none
either side. Nutrition is the only tab that is day-scoped *and* fails to roll over.

The header still reads `Today`, because `formatDateLabel` prints that only when `selectedDate` and
`todayStr` agree — and both are frozen at the launch day, so there is no visible tell. `selectedDate`
is what a new log is written with, so breakfast is filed against the finished day and feeds its
calorie budget and adherence. Switching tabs away and back fixes it, which is why this would read as
intermittent. The fix is the hook that already exists — `useLocalDay()` (BF-86), which
`session-select-content.tsx` uses and which measured correct above.
[`Review sweep 41 §2`](docs/reviews/2026-09-03-nutrition-day-rollover-and-scroll-coverage.md).
**Web build only** — no device run.

### [app-shell][nutrition] 🟡 Scroll restoration reaches 3 of the 5 tabs, and BF-100's entry says it reaches all (RV-36, 2026-09-03)

BF-100 shipped `use-scroll-restoration.ts` and calls it from `pull-to-sync.tsx`, recorded as *"every
screen using the shell inherits it"*. Every screen using **`PullToSync`** inherits it, and three use
it. The Nutrition tab owns its own scroller and inherits nothing: `/nutrition` → `/coach` → back saves
no `ta_scroll:` key and returns **0**, against `/more`'s **840**. The live gap is that one path — every
other routable screen that scrolls (`/health/sleep`, `/health/heart-rate`, `/cardio`, `/config`,
`/program`) is a leaf with no deeper push, counted rather than assumed. BF-100's entry is corrected in
the backlog. [`§3`](docs/reviews/2026-09-03-nutrition-day-rollover-and-scroll-coverage.md).

### [app-shell][platform] ⚠️ `/health/day` scrolls with no bottom padding — structural, NOT observed (RV-37, 2026-09-03)

`day-detail-content.tsx:226` carries no `pb-*`, and the screen is a sub-route with nothing anchored
below the scroller, so its last card ends flush with the gesture bar. **Not reproduced:** the seeded
fixture renders *"Nothing logged on this day"*, so the container never scrolled; the `/more` control
measured `padding-bottom: 68px`. The four safe-area CI rules all fire on a *wrong* utility, never on an
**absent** one. Needs the device. [`§4`](docs/reviews/2026-09-03-nutrition-day-rollover-and-scroll-coverage.md).

### [sleep][platform] 🔴 A phantom afternoon "sleep" is scoring as a real night (PS-17, 2026-08-30)

`aggregateOuraRawSamples` emits daytime sessions into `sleep_sessions`, and where a day has more
than one, the wrong one reaches `oura_daily_summary`. On 2026-08-27 the summary took an 11:35–16:52
"nap" (4.75 h) over the real 23:02–06:37 night (7.42 h), so that day's HRV reads **26.5** against a
surrounding 53–72 and resting HR **64** against 50–53 — awake daytime values scoring as sleep.
Three such sessions exist across 27/29/30 Aug, one of them 0 hours at efficiency 0. Needs a
wake gate on the detector, a night-picking rule in the summary, **and** a corrective recompute: the
27th is already wrong on disk. Found while validating the Colmi ring, which is unrelated and
isolated.

### [devices] ⚠️ Colmi auto-sync is not device-verified (2026-08-30)

v1.395.1 syncs the ring on app open, on resume and every 30 minutes, because four of its metrics are
offered for the current day only and two days of daytime stress were already lost to a missed
evening sync. BLE does not exist in the sandbox, so the timer, the visibility listener and the
4-second resume delay are exercised by **unit tests and nothing else**. The check is one evening
where Sync is not pressed and that day's stress still reaches the database past 18:00 — the previous
days stop dead at 06:30 and 17:30.

### [devices] ⚠️ The Colmi ring's decode moved to the server and has not run on the device (PS-21 Stage A, 2026-09-03)

v1.436.4 posts the ring's raw frames and decodes them server-side. Proved equivalent to the old
client decode over a real 31-frame sync — 209 received, 167 accepted, **166 stored rows identical
field for field** between the two paths — but against the local dev database, over frames replayed
from the archive rather than a ring.
- **What has not run:** an actual sync from the phone. The pairing card's counts now come from
  response fields (`received`, `decodedBy`) that did not exist before, so a WebView holding an older
  bundle than the deploy would show zeros while the rows still land. `decodedBy` says which side read
  the bytes, which is how to tell those apart rather than guessing from counts.
- **The check:** one Sync on the S25. Readings stored > 0, and `decodedBy` reads `server`.

### [nutrition][devices] ⚠️ The Coach plan card's save took the web fallback, not the offline-first path (LA-47, 2026-09-02)

**Shipped and exercised end-to-end; one half of the write is unseen.** A real Gemini turn called
`getMealPlan` then `showMealPlan`, the card rendered three meals with their calories and ingredient
counts, and Save-all wrote three `saved_meals` rows with their items and stamped all three
`meal_plan_meals.saved_meal_id` values — confirmed in the database, not from a toast.
- **`getLocalStore` returns null in the web sandbox**, so `savePlanMealsToLibrary` fell through to
  `POST /api/nutrition/saved-meals`. The local SQLite write and the outbox mutation it queues on the
  device were **never executed from this surface**. That path is shared with the Nutrition tab's own
  Save button (Q-398, on `main` since 2026-08-24), so it is exercised code — but not from here, and
  the widget is the only caller that runs inside the Coach thread.
- **What to check on the S25:** open Coach, ask for the plan, tap **Save all to My Foods**, find
  those meals under My Foods, then tap it again — the button must be disabled with no duplicate. The
  card has only been seen at 412×891 in Chromium, never in Samsung's WebView; safe-area is not at
  risk (it sits inside the thread's scroll region and the composer owns the bottom inset).

### [sleep] 🟡 A good night scored 63: the display curve, the duration curve, and one autonomic dip counted twice (TN-23, 2026-09-03)

**Measured, nothing fixed. Owner:** *"why would sleep score be so low for this? I'd imagine 80s if not 90s."* 8 h 15 m, 97% efficiency, REM 92, restfulness 95. [`review`](docs/reviews/2026-09-03-why-a-good-night-scored-63.md).
- **The blend is 76.04 and the app shows 63** — reproduced exactly from the stored contributors and `SLEEP_WEIGHTS`. **The owner's intuition matches the blend**, which is what the ten contributors produced.
- **Cause 1 — the display curve costs 11.9 points.** That is **TN-5**, signed off 2026-08-24 and **still unshipped**. Largest single factor, and not a judgement about the night.
- **Cause 2 — 8.25 h scores 81** where `TOTAL_SLEEP`'s own comment three lines above says *"8h is excellent (~92)"*. That is **TN-10**, signed off 2026-08-30. The heaviest contributor (weight 24) disagrees with its own documentation.
- **Cause 3 — NEW (TN-23): `hrv` and `hr` are the same autonomic event, scored twice.** `r = +0.869`, **75% shared variance** over 38 nights, **28 of 110 = 25%** of the sleep score. Both are computed correctly — HRV 50 ms/0.85× → 42 and HR 63 bpm/1.035× → 58 are exactly what their curves specify — but together they drag this night's blend **12.7 points** for one physiological event.
- **⛔ Do not fix TN-23 by deleting a contributor.** Both curves are sound and the combined signal is the score's strongest recovery evidence (resting HR is the best predictor of the owner's felt state). **Collapse them into one autonomic contributor, or down-weight the pair to a joint ~14–18.**
- **What the night should have scored: ~76 today, low-to-mid 80s after TN-5 and TN-10**, with a few points still owed to a genuine HRV dip (50 ms against a 59 ms norm, near the bottom of the owner's 43–71 range). **63 is wrong; 90 would have been too.**

### [readiness] 🟡 Q-507 explained and REVERSED — the stress model is sound; the stored daily scalar is what points backwards (TN-22, 2026-09-01)

**Measured, not fixed.** Open since 2026-08-18, now with a mechanism. [`review`](docs/reviews/2026-09-01-stress-sign-explained.md).
- `stress_high_minutes` is bucket-minutes below −0.5, so TN-3a's persisted buckets allow it to be **recomputed and compared with what was stored**. Correct direction is negative.

  | | vs sleep | vs readiness |
  |---|---|---|
  | **stored** | +0.137 | **+0.338** |
  | recomputed, all hours | −0.181 | **−0.438** |
  | recomputed, waking only | −0.289 | **−0.477** |

  Dropping 2026-08-31 (a **TN-20** casualty) strengthens it to **−0.383 / −0.699** (n=8) — the finding is *masked* by the corrupt day, not caused by it.
- **8 of 9 days disagree**, four storing **zero** against 210–270 bucket-minutes; **the only day that agrees is the newest.** Same shape as **TN-20**, and plausibly the same defect — stated as *plausibly*, since neither mechanism is identified.
- **Q-507's conclusion is reversed:** *"the signal points the wrong way"* is true of the stored scalar and **false of the model**. **Both previously-proposed mechanisms are superseded** — the refuted data-density one and TN-21's bucket-count one — because both explained an artefact. **TN-21's window finding survives** (55% night; restricting it is worth −0.452 → −0.699).
- **⚠ n = 8–9, the waking window is this review's choice not the app's, and the buckets are written by the same pipeline as the scalar.** **Re-test at n ≥ 30 before anything is built on the metric.** TN-16 stays parked, but its blocker is now a persistence bug with a route rather than an open research question.

### [readiness][body][devices] 🔴 A recompute overwrites a completed day with an empty result — the inputs to rebuild it still exist (TN-20, 2026-09-01)

**Found, not fixed. Data integrity, not calibration.** [`review`](docs/reviews/2026-09-01-recompute-wipes-completed-days.md).
- **Observed in BOTH states within 24 hours**, which is what makes it provable. 2026-08-31's `body_battery_daily` read **end 0 · drained 113 · 3,643 samples**; the owner's 21:45 screenshot showed *"−113 drained"*; an hour later (`updated_at` 12:43 UTC) it stores **end 55 · drained 0 · 0 samples**. **`oura_heartrate` holds 3,815 samples for that date** — the input was never missing.
- **The derived row went further:** readiness **55 → 25**, sleep **56 → 15**, against a stored summary of **7.83 h, HRV 54.5, RHR 63.9**. Neighbours calibrate it — 08-30 (7.92 h, HRV 72) → **69**, 09-01 (7.50 h, HRV 65) → **54**. **A normal night is stored as the worst on record.**
- **3 of the last 11 days** carry the signature (raw samples present, stored count **0**, drained **0**, end **=** anchor): **08-22 (265 raw), 08-26 (1,954), 08-31 (3,815)**. On healthy days the stored count sits slightly *below* raw — waking-hours windowing — so **zero against thousands is a different failure**.
- **First action: find the writer.** Same delete-before-guard shape as **Q-528** is the first candidate, plus any `fullHistory` path. **⛔ Do not re-run the recompute to "fix" a day** — the recompute is what destroys it.
- **⚑ This retracts an illustration this agent published on 2026-08-31 in TN-19**: 2026-08-26 was cited as *"zero HR samples → zero drain"*; it has **1,954 raw samples**. **Q-521's wear-time conclusion stands on its own correlations**; the illustration does not. **A stored counter is a claim about the data, not the data.**

### [readiness] 🟡 "Daytime stress" is 55% night buckets, and night and day carry opposite signs (TN-21, 2026-09-01)

**Measured for the first time** — TN-3a's persistence half shipped, so the per-bucket series exists: **230 buckets over 9 days**. [`review`](docs/reviews/2026-09-01-recompute-wipes-completed-days.md).
- **The series covers all 24 hours** (every hour except 07:00) and **126 of 230 — 55% — fall between 22:00 and 06:00**. Night mean **+0.266** (recovered) against day **−0.413** (stressed): **opposite signs, night in the majority**, so any daily aggregate is governed by the night/day mix as much as by stress.
- **A Q-507 mechanism candidate, and it is the REVERSE of the one already refuted**: `corr(total buckets, stress_high_minutes)` = **−0.784** (n=9) — *fewer* buckets produce *more* high-stress minutes, because each bucket is scored against the day's own median. **n = 9; treat as a lead, not a result.** The refuted hypothesis used *HR sample count* (r = −0.128); bucket count is the quantity the model actually divides by.

### [readiness][devices] ⚠️ Local SQLite v36 needs a `fullHistory` pass to mean anything (TN-1, 2026-09-02)

**Shipped, exercised in the sandbox, and it cannot produce its number without the owner.** TN-1
persists `chronic_stress_granular_nights` so the reason chronic stress has never scored is visible
from data (Postgres migrations **258 + 259**, local SQLite **v36**).
- **Only a hand-triggered `fullHistory` rollup pass reaches the chronic-stress model at all**, so
  until one is run the column is NULL on every row. That is the expected state, not a defect.
- **What the number will say when it exists:** **≥ 21** with the score still null puts the fault
  inside the vendored `cumulative_stress_1_2_2` model, and TN-1 has done its job by proving it;
  **< 21** names the granular stash as the constraint — and what to do about it is Tuning's question
  and then the owner's, never a unilateral threshold nudge (the Q-504 mistake).
- **v36 is a plain ADD COLUMN**, but it now sits behind v35 *and* v34's table rebuild: a device
  upgrading from v33 runs three migrations in one pass, which is the combination nobody has opened.

### [readiness][devices] ⚠️ Local SQLite v35 has not been opened on the S25 (Q-510, 2026-09-02)

**Shipped and fully exercised in the sandbox; the device has not seen it.** Q-510 persists the
daytime-stress coverage minutes so "why did resilience produce nothing today" is answerable from data
(Postgres migrations 256 + 257). The offline-sync tripwire required the column to ride the whole
chain, so local SQLite went to **v35**.
- **v35 is the mildest kind of local migration** — a plain `ALTER TABLE oura_daily_derived ADD COLUMN
  daytime_stress_coverage_min REAL`, with the column also in the `CREATE` body for fresh installs and
  a `RECONCILE_COLUMNS` row if the ALTER half-applies. Nothing is dropped or rebuilt.
- **But it lands on top of v34, which is also unopened** (the row directly below). A device upgrading
  from v33 now runs both in one pass, and that combination is what nobody has seen.
- **What to check on the S25:** the app opens, the Home readiness card renders, and no
  `oura_daily_derived` read throws. Nothing displays the new column, so there is no visual check —
  the risk is the migration step, not the value.

### [nutrition][devices] ⚠️ Local SQLite v34 rebuilds a table, and no device has opened it (BF-69, 2026-09-01)

**Shipped, and the riskiest statement in it is one a sandbox cannot run.** BF-69 stage 1 removed
`supplement_logs`' whole-day `UNIQUE(supplement_id, log_date)`, and **SQLite cannot drop an inline
table constraint** — the only way off it is a rebuild. So local v34 does what no local migration in
this repo has done before: it creates a second table, copies every row across, drops the original
and renames. Every other version in that file only adds columns.
- **Why the risk is specific rather than general:** the two local migrations that have killed this
  app both did so by *throwing on retry* and leaving `open()` throwing forever (#27's PRAGMA, #85's
  non-idempotent `ADD COLUMN`), and a rebuild has more ways to half-apply than an `ADD COLUMN` does.
  v34 is written so any prefix of it can be re-run to completion — a resurrection stub before the
  copy, `INSERT OR IGNORE` on the primary key, and a `SELECT` naming only columns present in both
  shapes — and `RECONCILE_COLUMNS` carries all five new columns plus the replacement partial index.
  **That reasoning is not a device run.**
- **What to check on the S25:** install, open Nutrition, confirm the supplements list renders and a
  tick round-trips. A dead local store shows the `LocalStoreDeadBanner`; an empty supplements list
  with no banner is the other tell.
- **The JS half needs no APK** — this PR touches no Kotlin, so the server and client changes reach
  the device through Railway. Only the SQLite upgrade runs on-device, and it runs on the existing
  APK at next open.

### [workouts][platform] ⚠️ The stored rest day is not device-verified, and the button for it is still Lane B's (BF-84, 2026-09-01)

**Shipped, and the half that matters most on this app is the half a sandbox cannot run.** `rest_days`
(migration 247) plus a `rest_days` outbox domain; the client writes through `chooseRestDay`, which
queues the outbox row when the local store is there and POSTs when it is not. **The outbox path
exists only on the APK** — `getLocalStore` returns null in the web/dev sandbox — so the branch that
carries an offline rest choice to the server has been exercised by unit tests and by
`pushMutations` against a real Postgres, and never by a device.

**What to check on the S25:** choose rest with the phone in aeroplane mode, restore the network,
and confirm the choice is on the server (`GET /api/log-rest-day?from=&to=`) without a second tap.
Then confirm the recommendation still says rest after a pull-to-refresh, which is the exact failure
the entry was opened for.

**Also still owed:** the surface. The owner asked for the rest button on Home's card *when the app
has not suggested rest*; today it renders only inside the `deloadOrRestRecommended` branch. That is
Lane B's, tracked on BF-84, and the storage shipping first is what makes it safe.

### [readiness][body][app-shell] 🔴 The Body Battery card explains a model the app doesn't implement — and nothing in the chain has shipped (TN-19, 2026-08-31)

**Found, not fixed. Owner's second report on this pillar in six days** — *"any work being done for this? still not very usable"*, screenshot showing **Drained 0 · started at 55 · +0 charged · −113 drained**. [`review`](docs/reviews/2026-08-31-battery-explainer-promises-inert-mechanisms.md).
- **Nothing has shipped.** Verified on `main` 2026-08-31: **TN-15, TN-18, TN-6a, TN-6 and TN-2 are all still queued**, no commit in the last 40 touches them, and they sit at **queue positions 75–83 of 235**. **Nothing is blocked** — TN-6a, TN-18 and TN-15 all carry owner sign-off. Priority is queue position, so **this is a prioritisation decision and only the owner can make it.**
- **The new HOW IT MOVES card lists five mechanisms; four are inert or backwards.** `Deep sleep` is **structurally impossible** (`walkBodyBattery` filters to `tsMs >= wakeTime`); `Calm rest` produced **6 points across 8 days**; `Training` moves the end value **0.6 points** (Q-521); `Daytime stress` **rises on good days** (Q-507). Only `High heart rate` works, and it tracks **wear time**.
- **⛔ Do not reword the card.** It is TN-15's specification rendered — softening it documents the defect instead of repairing it. **Ship TN-15 and the card becomes true.**
- **Why it now reads worse than before the card existed:** the app states five **testable** claims beside the number, so a day with a workout and 3,643 HR samples still reading **+0 charged** is a *demonstrated* failure rather than a vague doubt. **A wrong number the app explains is worse than one it does not.**
- **2026-08-26 is the cleanest Q-521 evidence in the data** — **0 HR samples → 0 drained, 0 charged, ending exactly at its anchor.** No wear, no change.
- **Order that would change the screenshot:** TN-6a (lifts the mean anchor **64.8 → 76.8**) → TN-18 → TN-2 (the `+0 charged` line itself) → TN-15. **The first three are small and specified.**

### [readiness][devices] 🔴 TN-6a's temperature suspension covers the readiness ladder but not the deload banner (TN-18, 2026-08-31)

**Found, not fixed.** Owner screenshot 06:43 Brisbane: *"Body temp elevated — rest or deload recommended"* while readiness scores temperature **80/100** — same night, same baseline object. [`review`](docs/reviews/2026-08-31-four-tiles-at-55.md).
- **TN-6a shipped and works.** `readiness-payload.ts:386` gates the ladder on `isTemperatureBaselineCentred(...)`, so 2026-08-31's stored **0.519 °C** deviation carries **no** readiness penalty.
- **The banner was never gated.** `packages/shared/src/ai-periodization/ai-dynamic.ts:184` is a bare `temperatureDeviation > TEMP_ALERT_THRESHOLD_C` (0.5), and `isTemperatureBaselineCentred` appears in **exactly one file** — though TN-6a's entry required **all three** consumers.
- **Both halves of the broken baseline are visible in one frame.** The contributor reads `tempZ` = **0.303** (fine); the banner reads **0.519 °C** (deload). The z is small **because `temp_baseline_dev_x8` = 1.714 °C** against a true nightly sd of ~0.14 — `0.519/1.714 = 0.303`, matching the stored input to three decimals. **Q-506's inflated sd and TN-6's low mean failing in opposite directions.**
- **⛔ Do not raise `TEMP_ALERT_THRESHOLD_C`** — Q-504's mistake. Pass the same `tempLadderTrusted` condition into the deload evaluation.
- **This is the surface the owner actually reads** — the one behind *"its often triggering deload days"*. The protection landed on the path they never see.

### [readiness][sleep][activity][heart-rate] 🟢 "Everything is 55" — the clustering is coincidence; today's score is correct (2026-08-31)

**Measured, nothing to fix in the scores themselves.** [`review`](docs/reviews/2026-08-31-four-tiles-at-55.md).
- **The three scores normally sit 20 points apart** (median 19, max 65); only **2 of 35 days** land within 3, and 2026-08-31 is one. 08-30 read 73/69/64, 08-26 read 52/15/80. **Not a collapse.** Heart Rate's "55" is **bpm**, a coincidence of units — an argument for TN-13 on its own.
- **Today's 55 reproduces exactly** (55.3) from stored contributors, and **HRV 53 ms (vs 71–72) plus resting HR 63.7 (vs 59.0) account for 15.8 of the 18-point drop** from yesterday. Sleep duration was fine at 7.75 h. **The app is right today.**
- **⚠ Two contributors qualify it, both queued:** `recoveryIndex` scored **100** flagged provisional after 22 and 44 on the two prior days, *lifting* readiness by 5 (**Q-509**); and `checkin` sits at the placeholder 50 until logged, so the score still moves after first open (**TN-9**).
- **Permanent, and worth knowing: two of the five numbers are not independent.** `previousNight.input` **is** the Sleep tile and `activityBalance.input` **is** the Activity tile — **22% of readiness is the two tiles beside it** (`corr` **+0.656**, against sleep~activity **+0.139**) — and Body Battery's morning anchor **is** the readiness score (**+0.838**, n=47). The screen reads as more corroboration than it is; the fix is presentational and belongs with **TN-15**.

### [nutrition][devices] ⚠️ The queued-delete fix is reasoned, not reproduced (BF-47, v1.395.5)

The owner reported it from the device and the fix has never been seen to work there — nor has the
bug been seen to fail in a sandbox, because there is no sandbox in which it can. `getLocalStore`
returns null in `pnpm dev` and in Playwright, so neither mechanism has an analogue, and the hook
itself cannot be rendered (both vitest projects are `environment: 'node'` with no
`@testing-library/react`).

What IS proven: the rule is unit-tested, its **placement** is pinned by a source-order test (before
`applyDelta`, not after — the difference between fixing the flicker and fixing the half that
survives a screen swap), and 8 of 8 mutations were caught.

**Smoke step:** on the S25, delete a logged food — online and offline. It should go and stay gone
across a screen swap and a force-close. Then delete a food logged on the web on a different day,
which is the case the filed trace did not cover.

### [nutrition][devices] ⚠️ Local SQLite v31 has not been opened on the S25 (BF-39, 2026-08-30)

BF-39's engine half adds two columns to the local `food_logs` table, which is a **local SQLite
version bump** — and this project has had the local DB silently dead **twice** from migration bugs
(a PRAGMA inside the upgrade transaction, and a non-idempotent `ADD COLUMN` rolling back the whole
version). Both times every local read returned empty, which is the root of the recurring "my data
disappeared" reports.

The migration is written to the rules that came out of those two: the columns are in the
`CREATE TABLE` body **and** in a v31 `ALTER` (the body alone reaches fresh installs only), and both
carry `RECONCILE_COLUMNS` rows so a half-applied upgrade self-heals. `check-reconcile.js` and
`check-local-column-upgrade-path.js` both pass. None of that is the device.

**Smoke step:** open the app on the S25 after this deploys and confirm the Nutrition tab still shows
today's food. An empty Nutrition tab is the signature of a dead local store, not of a lost day.

Nothing renders differently by design — the diary grouping is Lane B — so this row is about the
upgrade path, not the feature.

### [workouts][devices] ⚠️ Voice logging should render again on the APK; the button has not been pressed (LA-37, v1.395.4)

Found in `error_events`, not reported — the symptom was an **absent** button, not a broken one, so
there was nothing to report. `getNativeSpeech()` resolved to a raw `registerPlugin()` proxy, the
promise never settled, `available` stayed `null`, and the control was never drawn.

**Why no check could have caught it before:** `Capacitor.isNativePlatform()` is false in `pnpm dev`
and in Playwright, so the native branch never runs outside a real WebView. The fix is proven by unit
tests that reproduce Capacitor's proxy trap and by `scripts/check-plugin-proxy-thenable.js`, and
neither of those is the device.

**Smoke step:** on the S25, open a workout, confirm the **Voice** button is drawn, press it, say a
weight and reps, and check the set fills in. A denied microphone permission should now say so rather
than flipping silently back to "Voice".

JS-only — it reaches the phone on the next Railway deploy, no APK rebuild.

**Confirmed fixed in production 2026-09-01 (BF-106's fault beat), which narrows what the device still
owes.** The fault fired on **6 of the 8 workout days** before the fix — 7 rows across 5 sessions,
2026-08-23 → 2026-08-30T02:06, that last one being the row LA-37 was opened on. Since the fix there
has been **one workout, 2026-09-01, and zero rows**. So the promise settles now; the hang is gone.
**That is n=1 and it only proves the negative** — no unhandled rejection — which is exactly the half
that was observable remotely. Whether the button is *drawn* and whether pressing it logs a set are
still unobserved, so the smoke step above stands unchanged.

### [workouts][devices] ⚠️ The exercise clip is on the ready screen; nobody has seen it move (BF-65, v1.405.0)

The clip renders at 64 px beside the exercise name, tapping it opens a full-width strip, and an
exercise the route cannot match shows the warm-up screen's dumbbell rather than a gap. `unoptimized`
is what decides whether a GIF animates or renders as a still — and forgetting it fails **silently**,
because the picture appears and looks correct. A guard test holds the prop on every exercise-media
`<Image>`, which is not the same as having seen one move.

**Nothing animated was rendered anywhere in this work.** The dataset's clips live on
`raw.githubusercontent.com`, which the sandbox's egress proxy drops, so every clip is a blank white
box there — **including the warm-up screen's own thumbnails, which this change does not touch**.
That is how the blankness was established as the environment rather than the code; CSP was ruled out
separately. Verification used same-origin substitutes, asserting `naturalWidth > 0` rather than a
`src` attribute.

**Smoke step:** on the S25, open a session and reach each exercise's ready screen. The clip must be
**moving**, not a frozen frame; **exercise 2 must show its own clip, not exercise 1's**; a bodyweight
or unmatched movement shows the dumbbell. Then airplane mode — it should still play, because the
warm-up screen prefetched it into the service worker. That last one is the only part of this the app
cannot self-check.

JS-only — it reaches the phone on the next Railway deploy, no APK rebuild.

### [workouts][devices] ⚠️ Voice logging understands filler words now; nothing has been said into it (BF-66, v1.404.2)

The owner said *"60 for 6"* mid-set, the transcript came back exactly right, and the app printed it
in red. That red line is the **parse-failure** branch, so a correct transcript was being shown back
as if it were the problem. `parseVoice` stripped every character outside `[0-9.\s kgreps×x]`, which
keeps the `r` of `for` and the `es` of `times` — `60 by 6` and `60 at 6` worked because their letters
all vanished, `60 for 6` and `60 times 6` did not. A positive tokenizer replaces the denylist, the
failure message now names an example, and the same example sits under the button, which previously
stated its accepted phrasing nowhere at all.

**Proven on strings, not on speech.** The tokenizer has 17 unit tests and the hint was driven in a
browser at 412 dp, but no transcript has ever come out of Android's recogniser in this sandbox —
`Capacitor.isNativePlatform()` is false in `pnpm dev` and in Playwright alike.

**Smoke step:** on the S25, mid-set, say each of `60 for 6`, `60 kg for 6`, `60 times 6`, `60 by 6`
and `60 x 6` — every one must set the dial to 60 kg × 6. Then say something unparseable and read the
message: it should offer an example, not repeat your words. **Do this in the same sitting as LA-37's
row above** — it is the same button and the same press.

JS-only — it reaches the phone on the next Railway deploy, no APK rebuild.

### [nutrition][devices] ⚠️ Duplicate foods stop being created; the device half has not been seen on the S25 (BF-38, v1.395.2)

The web route is verified end to end — four POSTs to `/api/nutrition/food-items` on a running
`pnpm dev` (identical, identical again, a case-and-whitespace variant, a genuinely different
serving) produced **two** rows.

**The device path is not the same code and was not exercised.** It runs in
`packages/shared/src/nutrition/create-food-item.ts` against the local SQLite store, and
`getLocalStore` returns null in `pnpm dev` *and* in Playwright — so unit tests with a mocked store
are the only evidence that logging your usual lunch twice now makes one row on the phone. That path
also carries the load-bearing half of the design: it must catch the duplicate **before** an id is
minted, because the offline push deliberately does not de-duplicate (its id is already referenced by
a queued `food_logs` mutation, and `food_logs.food_item_id` is `ON DELETE RESTRICT`).

**Smoke step:** on the S25, log the same food by AI description twice and check My Foods holds one
row; then log a deliberately different serving of it and check there are two.

Nothing in the existing 21 duplicates was touched — collapsing those means re-pointing every log
first, which is a separate decision. BF-38 stays queued for that, for the conflicting-estimate pairs
that need an owner, and for the barcode chain.


### [workouts][devices] ⚠️ The corrected exercise catalogue has not been seen on the device (BF-16a, 2026-08-25)

**Shipped and verified on the web surface; the device path is reasoned from source, not observed.** Migration 216 corrects five `exercise_library.muscles` rows. **No APK is needed** — the device's local mirror is hydrated from `/api/workout-data` in `workout-screen.tsx:421` and upserted with `muscles=excluded.muscles`, so a corrected catalogue should reach it on the next workout-screen load through the normal path. *Should*: that chain was read, not run, and `getLocalStore` returns null in the sandbox so it cannot be run here. **What to check on the S25:** open the workout screen once, then confirm the muscle heatmap and Muscle Volume This Week attribute a logged `Barbell Hip Thrust` to quads, lower back and adductors at half weight. **✅ Migration 216 HAS now run against production** (verified 2026-08-25 while shipping LA-24: `Barbell Hip Thrust` reads 5 muscles there, `Barbell Shrug` and `Cable Chest Dips` 3). **Migration 219 has not** — LA-24's five sibling rows land on the next deploy. Low risk (idempotent append, no schema change, trivially reversible by another UPDATE), and the correction is retroactive by design: `weekly-muscle-sets` reads the catalogue in a live subquery, so past weeks re-derive rather than staying on the old numbers. [`journal`](docs/overview/entries/2026-08-25-exercise-catalogue-missing-muscles.md)

### [workouts] 🟡 277 historical 1RM estimates stay inflated — an owner decision, not an unfixed gap (Q-304b, 2026-08-25)

**Deliberate, and recorded here because "leave it" has a live cost that nothing else states.** Before 2026-08-24, an unprescribed high-rep set was stored without the AMRAP discount, so its `exercise_logs.estimated_1rm` reads high; `amrapScaleFactor` discounts from **6 reps up**, which puts the real blast radius at **277 logs**, not the 30 cached `personal_records` the original ask assumed. The owner authorised a recompute, then withdrew it once measured: the specified method (re-derive from `set_logs`) **moves zero rows by construction** — `personal_records` derives from the stored `exercise_logs` value — and **76 of the 277** belong to a progression style edited *after* the log, so re-deriving substitutes today's prescription for the one actually trained under, with nothing in the output showing which (LA-27). That is worse than the inflation. **The accepted cost:** an inflated PR shows on the badge and in the AI chat's `getPersonalRecords`, and drives a too-heavy prescription **only** where an exercise carries a PR with no recent log — `resolveWorkingBasis` takes `lastNonDeload1rm` first, so a currently-trained lift is unaffected. **Q-304's forward fix is unaffected and correct**; this is about history alone. **Reversible:** `set_logs` is untouched and remains the source of truth, so the recompute stays available the moment LA-27's 76 rows have an answer. Q-298's 10 zero-1RM rows are the same shape and are **not** covered by this decision. [`journal`](docs/overview/entries/2026-08-25-catalogue-family-anatomy.md)

### [platform] 🟢 `error_events` was never bloated — the 49 MB figure was a stale planner estimate (Q-315, 2026-08-25)

**Closed by measurement after the owner pressed the button, and the correction matters more than the result.** The reclaim ran and reported `reclaimed 0 B (49 MB → 52 MB, 24 live rows) in 1.5s` — which is **correct**, not a failure. `VACUUM FULL` found nothing dead because nothing is dead: against production, `error_events` holds **6,168 rows of the owner's alone** (11 MB of messages, **45 MB of stack traces**), matching the 12 MB heap + **39 MB TOAST** the table actually occupies.

**Where "4 live rows in 49 MB" came from.** `n_live_tup`, which `CLAUDE.md` warns in as many words is a planner estimate that is arbitrarily stale here — `last_analyze` and `last_autovacuum` are NULL on every table. It read 24 against 6,168 real rows. That figure was repeated through Q-315's heading, two other backlog entries, three `projectOverview` paragraphs and a Lane A baton without anyone running `count(*)`. **The rule already existed and was quoted in the same document that got it wrong.**

**What the rows are: one already-fixed burst.** Three days carry 5,928 of the 6,168 and 42 of the 45 MB — 2026-08-09 (2,615), 08-12 (2,556) and 08-13 (757), almost all `[pg 21000] Failed query: insert into "oura_heartrate"`. Postgres `21000` is `cardinality_violation`: an `ON CONFLICT DO UPDATE` hitting the same conflict row twice in one command, which rejects the **whole batch** — so those were up to 5,000 HR points discarded per failure, permanently. **That is Q-214, fixed on 2026-08-13**, and the burst stops on 2026-08-13: `upsertOuraHeartrate` now collapses repeats into a `Map` keyed by timestamp before the insert. Fixed, not merely stopped — the code and the dates agree.

**No action, and it resolves itself.** The 30-day prune is working (oldest row is exactly 30 days back), so those burst days age out between now and ~2026-09-12 and the table returns to a few MB. Last 7 days hold **39 rows total**. Nothing is owed.

### [platform] 🟢 The database's above-trend growth is an un-pressed `VACUUM FULL`, not a growth problem (BF-106, 2026-09-01)

**The third reading this row asked for, taken 2026-09-01, and it resolves the question rather than
extending it.** `sum(pg_total_relation_size)` reads **198 MB** — so the series is **171 MB
(08-18) → 182 MB (08-25) → 198 MB (09-01)**, i.e. 1.6 then **2.3 MB/day**. The rate is not settling,
it is rising, which rules out the "compacted heap regrowing slack" reading this row was resting on.

**Nearly all of it is `oura_raw_samples`: 50 → 58 → 73 MB.** Two hypotheses were tested against
production and both are wrong:

- **Not more data.** Ingest is flat at ~24k frames/day (19,323–25,598 across the last 8 days), and the
  table holds exactly its intended window — `HOT_WINDOW_DS` is **7 days**, and a count of rows older
  than 8 days returns **0**. The packer's backlog is fully absorbed.
- **Not bloat.** `oura_raw_samples` reports `n_dead_tup = 0` with `last_autovacuum` at
  2026-09-01T17:57 — autovacuum is running on it and there is nothing dead to reclaim.

**What is left is the one thing the packer's own docstring already names.** Pack-and-delete frees
space *inside* the file; Postgres does not hand it back to the OS without a `VACUUM FULL`, which
`lib/data/postgres/slices/oura-raw-pack.ts` describes as "a single press" once the backlog is gone.
The backlog has been gone since roughly 2026-08-25 — the docstring predicted "a day and a bit" from
2026-08-24 — and the press has not happened. So the file is sitting at its high-water mark while the
live rows have fallen 318,183 → 191,454.

**⚠ How much comes back is not known and should not be guessed.** Rows fell ~40% while the file fell
~21%, which is consistent with slack but is not a measurement of it. `GET /api/admin/vacuum` lists
each allowlisted table's current size precisely so the reclaim can be read before and after — that
GET is the number, not this row's arithmetic. Q-315 is the cautionary precedent: the same reasoning
about `error_events` predicted a large reclaim and the button returned **0 B**, because the figure
had been a stale planner estimate all along.

**Owed:** the owner presses `POST /api/admin/vacuum` for `oura_raw_samples` and reads the GET either
side. Tracked as **BF-106**. Not urgent — the volume is 5 GB, storage bills at $0.15/GB/month, and
even the whole 198 MB is about three cents.

**⚠ And a `CLAUDE.md` fact this reading falsifies.** That file states `last_analyze` and
`last_autovacuum` are "**NULL on every table**", measured 2026-08-20, and uses it to argue
`n_live_tup` can be arbitrarily stale. Autovacuum and autoanalyze now run: `oura_raw_samples`
autoanalyzed at 20:17 and its `n_live_tup` of **191,454** matches `count(*)` exactly. **The rule
survives, its reason does not** — `oura_raw_packed`, which autoanalyze has *not* reached, still reads
`n_live_tup = 55` against **1,051** real rows. So: keep using `count(*)`, because coverage is partial
and you cannot tell which side a table is on without checking. Corrected in `CLAUDE.md` in this PR.

<details><summary>The 2026-08-25 reading this supersedes</summary>

**Measured, filed because the rule says to, explicitly not an alarm.** `CLAUDE.md` states a **171 MB** baseline (2026-08-18) and ~0.4 MB/day expected. Like-for-like on 2026-08-25 — `sum(pg_total_relation_size)` over 87 user tables, which is what that baseline measured, **not** `pg_database_size`'s 197 MB — reads **182 MB**: **11 MB in 7 days ≈ 1.6 MB/day, ~4x the stated trend**. Almost all of it is `oura_raw_samples` (50 → **58 MB**, ≈1.1 MB/day), the BLE ingest accumulating normally. **⚠️ Two readings are not a trend and the baseline is the weak one** — 171 MB was taken immediately after both the repack and the `disk_full` incident, so a compacted heap regrowing slack inflates any rate off it. **Action: a third reading next session**; if ~1.6 holds, correct `CLAUDE.md`'s 0.4, not the database. Not urgent — ~8 years of volume headroom, ~3 cents/month. **`error_events` is NOT bloat and never was** — see the row above; it is 52 MB of live rows and shrinks on its own as one already-fixed burst ages past the 30-day prune. [`readings`](docs/reviews/2026-08-25-railway-and-db-readings.md) §5.

</details>

### [platform][devices] ⚠️ `/api/body-battery` was 500ing in production; the fix is unverified there (LA-20, 2026-08-23)

**✅ CONFIRMED FIXED ON PRODUCTION, 2026-09-01.** Every one of the **31** stored occurrences falls on
**2026-08-23**, the day of the fix, and there have been **zero in the nine days since** — measured as
a per-day count over the whole retained window, not a spot check. The `Keep:` below is discharged: the
check it asked for has now been run. (Found while answering an unrelated Sentry question — the same
`error_events` read this entry was itself found by.)

**Originally recorded as: fixed in this session's deploy, not yet confirmed on production.** `error_events` held 19 live faults — `daytime-stress: constants not set`, first 10:37, latest 12:27, still firing while it was read — from the Q-545 constants port. Boot injects the model constants and sets `OURA_CONSTANTS_DIR`, and **both effects are per-process**; the process that runs boot need not be the one that serves a request. A probe route read `hasDaytimeStressConstants()` as **false** in a handler while boot had logged a successful delivery. Two independent halves: the module instance the route reads is not the one boot wrote to, and where the env var is also not inherited, `constantsDir()` falls through to a tree directory that has held no `.constants.json` since Q-49. `constantsDir()` now prefers the delivered `<cwd>/.oura-constants`, and `getRepository()` injects — the one hook every path that can reach a constants read already goes through, using a non-throwing variant so an unreadable directory cannot take down every DB route ([`journal`](docs/overview/entries/2026-08-23-oura-constants-per-process.md)).
- **Keep: production not verified.** The reproduction is a dev-server worker split, which is not proof Railway's split is identical. **The check is `error_events` after this deploys** — and *something stopping is not something fixed*: the count must be zero across a window where `/api/body-battery` was actually called, since the route is only reachable for a user with a daytime-HRV model.
- **This was not in any backlog entry.** It was found by the session-start `error_events` read that `CLAUDE.md` mandates and I had skipped. No local gate could have caught it: `pnpm dev` never reaches the model path, because the seeded user has no daytime-HRV model and the call is guarded.
- **⚠️ Superseded figures, and the verification is now UNFALSIFIABLE (Tuning, 2026-08-24).** The
  fault ran to **20:59 UTC on 2026-08-23**, **31 occurrences**, not the 19/12:27 above — those were
  read while it was still firing. It then stopped **on its own**, before any fix existed. What the
  observable window shows: at **2026-08-24 11:20:38 UTC** `/api/body-battery` completed a full run
  and wrote a `body_battery_daily` snapshot with no fault — one confirmed clean call ~14 h after the
  last error. **But TN-4's guard (#415, deployed ~13:00 UTC 2026-08-24) catches this failure and only
  `console.error`s it**, so from that point a recurrence writes nothing to `error_events` and the
  `Keep:` above is satisfied by silence whether or not the cause is fixed. **Do not strike this row
  on a zero count** — filed as **TN-7** (report from the catch, one line), and this row becomes
  checkable again once that lands.
- **✅ TN-7 LANDED 2026-08-25 — the `Keep:` above is falsifiable again, but only from that deploy.**
  The catch now calls `reportServerError(err, { userId, url: '/api/body-battery#stress' })` beside
  the log, so a recurrence writes a row attributable to the stress strip rather than to the outer
  catch. **The window that counts starts at that deploy, not earlier** — every zero between
  2026-08-24 ~13:00 UTC and it is silence from the guard, not evidence, and must not be counted
  toward the clean window this row is waiting on.

### [heart-rate][activity] 🟡 The HR tile's problem is the absolute bpm, not the metric; a paced Activity score works but the goals do not (TN-17, 2026-08-26)

**Measured, nothing fixed.** Owner follow-ups to the pillar review. [`review`](docs/reviews/2026-08-26-hr-tile-and-activity-pacing.md).
- **HR tile — both of the owner's alternatives were tested and neither choice is the lever.** Against `perceived_recovery` (**1 = fully recovered … 5 = wrecked**, so positive r is correct): waking-rest HR **+0.176 raw / +0.291 baseline-relative**, nightly resting HR **+0.129 / +0.278**. **Baseline-relative roughly doubles either; picking between them barely moves anything.** TN-13's recommendation stands with a measured reason.
- **The +0.557 headline is reconciled**, not retracted: that was the baseline-relative *contributor score*, which measures **−0.553 (n = 35)** — same magnitude, sign carried by two scales running opposite ways. **Dropping the 4 `provisional: true` days (score pinned at 50) takes it from −0.395 to −0.553** — check that before any future correlation against `readiness_contributors`.
- **A waking-rest HR is a real second-tile candidate** (10th pct of BLE samples 08–21; 70 days, 984 samples/day, moving **6.24 bpm/night** against the tile's 0.44) and the better **stress** proxy — but **nothing in the app computes it**, so it is not folded into TN-13.
- **TN-17 — Activity as a pace-to-goal score.** Mechanically sound: `body_metrics.steps` is a running daily total. **⛔ `step_live_windows` is effectively empty (8 rows / 6 days)** and would read a flat zero. **The obstacle is goal calibration** — median day **4,649 steps**, 7,000 reached on **32%** of days and 10,000 on **15%**, so a paced score goes red from mid-morning where today's average reads 63–82. **Pacing does not create that; it stops the averaging from hiding it.** `Needs: Q-524`, `Gate: owner`.
- **TN-3a's persistence half has SHIPPED** — `oura_daytime_stress_buckets` live via migrations 212/213, **69 rows / 3 days / ~26 buckets a day**. The **back-fill has not**, so the entry stays queued with a `Keep:`. **This does not unblock TN-3b** — it and TN-16 are parked on Q-507's sign, unchanged.

### [readiness][sleep][activity][heart-rate][body] 🔴 The five Home pillars, answered one at a time — four new findings (TN-13…TN-16, 2026-08-26)

**Measured, nothing fixed.** Owner: *"Overall the pillars are not working great and not very useful. Requires tuning."* Six questions, six measurements. [`review`](docs/reviews/2026-08-26-pillar-review.md).
- **Heart Rate — TN-13.** The tile's "52" is the **7-day average** resting HR. Over 50 nights the nightly value moves **2.11 bpm** night to night, the average **0.33** — the tile **discards 84% of the movement** in the signal that best predicts the owner's own check-in (r = **+0.557**, best of nine). Show last night's value with its baseline delta. **Do not swap in HRV** (+0.427, and absent from Home).
- **Sleep — TN-14.** "60 is way off" is mostly **TN-5's display curve** (a 73.15 blend maps to exactly 57; TN-5's curve gives ≈63), plus TN-10 and a real autonomic dip. Separately: **2026-08-19 still holds 3.50 h** in `oura_daily_summary` and still feeds every trailing baseline. Nothing removed or flagged it, Q-520's flag is unbuilt, and the owner has asked twice. **Do not hand-delete the row** — decode the night's raw frames first; a genuinely short night and a mis-decoded one look identical in the summary.
- **Activity — no entry, a fact.** The tile is **today's** partial score; readiness carries `prevDayActivity` for the completed day, so both windows exist in different places. Over 30 days: mean **75.1**, range **51–91**, **never 100** — and 100 is **not reachable by behaviour** while `zoneMinutes` is floored on 53/59 days (Q-523), `activeEnergy` is present on 8/51, and `moveHours` qualifies 99.8% of hours (TN-11).
- **Body Battery — TN-15, owner-signed-off.** Both halves the owner describes are missing: `walkBodyBattery` filters to `tsMs >= wakeTime`, so **there is no overnight recharge at all**, and drain is Q-521's wear-time proxy. **This supersedes the standing "do not propose overnight charging or an anchor redesign" guidance** — that was written against chasing a symptom, not against a stated requirement. **Sequence: TN-6, then TN-2, then this.**
- **Stress — TN-16, parked deliberately.** Q-507 **replicates and strengthens** at n = 33: high-stress minutes correlate **+0.386 with readiness** and **+0.477 with the sleep score**. The data-density explanation was **tested and refuted** (−0.128 vs HR sample count) and **not replaced**. So the prolonged-stress warning, calm-down prompt and HR-chart overlay the owner asked for would all surface a number that rises on good days — the Q-504 failure mode — and stay behind the sign question.
- **Readiness is the pillar in the best shape**: resting HR (+0.557) and previous night (+0.520) genuinely track felt state, so its ingredients are sound and its problems are contaminated inputs already queued (TN-6, TN-9, Q-509).

### [readiness][heart-rate] 🔴 Body Battery floors by early afternoon: the charge window is below the owner's 5th-percentile waking HR (TN-2, 2026-08-24)

**Found, not fixed.** Charging requires `HR ≤ restingHr + 0.05 × reserve` = **57.8 bpm** today, against a 5th-percentile waking HR of **62** and a median of **86** — so a **time-weighted 0.5%** of the waking day can charge and 98.4% drains. Owner report: *"its 9:19pm here and its already at looks like its been 0 for awhile"*. Measured: 2026-08-24 anchor 57, charged **1**, drained **79**, floored ~12:30pm; **7 of 56 days end at 0, 5 of the last 8**. Both causes are the data being *correct* — resting HR fell 67 → 52 (real fitness gain) and `hrMax` fell 187 → 168 on 2026-08-05 when observed-peak resolution replaced the age estimate — so the ceiling shrinks from both ends. This is **Q-515's mechanism with a visible consequence**. Owner signed off on the direction (anchor to *waking* rest, an explicit bpm offset); the offset itself is unfitted, bracket **+8 … +12**. [`review`](docs/reviews/2026-08-24-body-battery-charge-window-collapse.md).
- **Keep — the fit cannot run from a session container** (Lane A measured this, `426cbfbb`): the stress term needs vendored constants Q-49 removed, `oura_raw_samples` retains ~7 of the 56 days needed, and `decoded` is NULL on those. **Fitting without the stress term and shipping anyway is the failure mode** — that is what the +18 overshoot note exists to prevent, on a change that re-scores the owner's history.

### [readiness][devices] 🔴 The temperature baseline is 0.36 °C low, so readiness carries a −16 pt penalty on 89% of days (TN-6, 2026-08-24)

**Found, not fixed.** Owner report with a Home screenshot — *"Body temp elevated · +0.5°C above your baseline"*, readiness 52, Recovery recommended — *"its often triggering deload days. its not trustable yet."* `computeBlendedScore` (`lib/health/readiness-payload.ts:169`) subtracts on an **absolute °C** ladder: −10 past 0.3, −20 past 0.5, capped at 40 past 1.0. Over 34 nights the **−10 arm fires on 91.2%**, the −20 on 67.6%, the cap on 17.6%; only 3 nights escape, and the stored deviation is **positive on all 34**. Cause: measured nightly temp is **35.827 °C (sd 0.140)** against a stored baseline of **35.464** — **0.363 °C low, clearing the 0.3 threshold on its own**. A trailing-mean baseline takes the mean penalty from **−16.3 to −0.4 pts/day**. [`review`](docs/reviews/2026-08-24-readiness-temperature-penalty.md).
- **One baseline, two consumers, opposite failures.** The same object's **sd is ~13× too wide** (1.82 °C vs a true 0.140) — Q-506 reproduced from another table. Wide sd → the illness radar can never fire; low mean → readiness penalised daily. **Fix both or neither**; batched as `temperature-baseline`.
- **⛔ Do not touch the 0.3/0.5/1.0 ladder** — against a true sd of 0.140 °C it sits at 2.1/3.6/7.1 sd. Fourth "the threshold is right, the input is wrong" in this pillar after Q-506, Q-512, Q-514.
- **⚑ BugFix found the mechanism independently (BF-13); it supersedes the account above.** `updateBaseline` seeds the mean at **literal zero** (`personal-baseline.ts:30`). The 34.696 °C figure is read from n=14, the first night `temp_dev_c` is non-null; the true start is **17.905 °C at n=2** (`35.81 / 2` — a first update from zero at gain 1/2). A zero seed argues for a correct seed, not a longer warm-up. BF-13 also finds a **third** consumer — the deload card's `TEMP_ALERT_THRESHOLD_C`, firing on 23/34 nights — so this is a three-consumer fix, and that card is the surface the owner actually reported. The measured consequences stand.
- **Owner signed off 2026-08-24**, and asked for the penalty **suspended in the meantime** — **TN-6a**, which ships alone, outside the batch, and must cover all three consumers. **History policy: leave stored days alone, stamp the new model.**

### [sleep] 🟡 The sleep score's swing is real signal; its calibration gain varies 8-fold (TN-5, 2026-08-24)

**Measured, nothing to fix in the volatility.** Owner: *"the scores have been very varied lately"*. Stored day-to-day |Δ| went **9.2 → 21.2** at the recalibration — but the **pre-calibration blend moved 9.15 → 9.27, unchanged**, so the sleep is genuinely that variable and the model reads it correctly. Two things landed together on 2026-08-19: the calibration began applying at all (before it the stored score *is* the raw blend), and the blend mean fell 87.1 → 71.1 into the curve's steep zone. **The real defect is `SCORE_CALIBRATION`'s gain spread** — 4.00× display points per blend point at blend 79 against 0.50× at 92, so the same improvement is worth eight times as much in one place as another. [`review`](docs/reviews/2026-08-24-sleep-score-volatility.md).
- **⛔ Flattening the curve does NOT reduce volatility — tested.** Night-to-night |Δ| goes **13.53 → 13.75**; a calibration curve's total rise is conserved, so flattening one segment steepens another. The baton's old advice to do exactly that has been replaced. TN-5 is filed as an **interpretability** fix and must not be sold as a jitter fix.
- **Owner signed off 2026-08-24**, told plainly that it does not reduce the jumpiness. Proposed curve holds the displayed mean (87.0 → 85.5, not a lift) and the `LOW_SLEEP_SCORE` firing rate (2/41 either way) — **re-verify both against the shipped TypeScript**, not the Python replay. **History policy: leave stored days alone, stamp the new model.**

### [nutrition][devices] ⚠️ A re-scanned meal label stops duplicating; no camera has scanned one (LB-34, v1.413.1)

**Fixed.** A shared label is a physical object and gets scanned by whoever picks it up — the same one scanned twice used to mint a second identical meal with nothing marking either as the copy. The scan now asks `findDuplicateMeal` first (normalised name **and** macros within `DUPLICATE_MAX_FIT_DISTANCE`, both required, so two different recipes sharing a name still both save) and offers **Save a copy** rather than writing ([`journal`](docs/overview/entries/2026-08-31-shared-label-rescan-duplicate.md)). The library read is local-first and makes no network call — a shared label's whole point is working with no signal.
- **Keep: nothing has scanned a real label.** The branch needs a camera (Capacitor on device, `getUserMedia` on web), so it is guarded at the source and by unit tests only — mutation-checked eight ways between them, but never executed from a scan. `getLocalStore` is null off-device too, so the local-store read took its cache-seed fallback on every run.

### [nutrition] ⚠️ The meal plan can fill the day in one tap; the device write path has not run (Q-187, v1.412.0)

**Shipped — and this closes all four steps of Q-187.** The plan card offers **"Log the N meals so far"**, which writes every planned meal you have not already logged or declined, through the same path the per-meal button uses ([`journal`](docs/overview/entries/2026-08-31-meal-plan-day-fill.md)).
- **It stops at the current hour, and that is the design rather than a nicety.** What the earlier phases protect is that the day's totals never count food nobody ate — which is why unconfirmed prefills stay out of `food_logs` entirely instead of being filtered out of its 24 readers. A button that logged the *whole* day would hand that back: press it at 9am and the macro bars report a dinner that has not happened. A past day offers everything, which is the retrospective case; a future day offers nothing; a meal whose time cannot be resolved is not offered on today, because guessing costs food nobody ate.
- **Keep: the device write path has not run.** `getLocalStore` returns null on web, so every exercised path — including the `plan_meal_answers` decline that suppresses a meal from the offer — took the `/api/nutrition/food-logs` fallback rather than the SQLite write plus outbox a real tap takes. `e2e/plan-day-fill.spec.ts` covers the selection and the write end to end, and all ten guards in the selector are mutation-checked, but on the web path only. The button has not been seen on the S25.
- **Q-354 is a live trap for spec authors, not just a curiosity.** The new spec's `locator.click()` did nothing at all — no toast, no request, no error — because the Nutrition scroll container's date-swipe `useDrag` swallows mouse input, which is what Playwright sends. `tap()` works and is the faithful input anyway. Every future e2e assertion that presses something on this screen has to know this first, and the failure gives no clue.
- **Q-187 is re-scoped, not struck.** What remains is the owner's second sentence — the day re-calculating remaining meals against what was actually eaten — which has no design and three open questions (what gets re-scaled, whether a floor exists, what to say when the remaining macros are unreachable).

### [cardio][devices] ⚠️ The guided walk paces you by cadence now; no strap has ever driven it (Q-410, v1.411.0)

**Shipped.** The interval walk leads with **km/h** (the unit the owner asked for by name, with min/km beside it off the same pace series) and its verdict line became a **banded pacer**: a bar, a mark and a sentence against a **cadence pair** you set in the walk config — a floor for the fast blocks, a ceiling for the slow ones, because a slow block walked too hard is what stops the fast one being fast. The band is chosen by **signed** distance, so on a fast block faster than the floor stays green however far above; ±10% out is amber, beyond that red ([`journal`](docs/overview/entries/2026-08-31-walk-cadence-pacer.md)).
- **The signal is a ladder — cadence → speed → heart rate — and the screen says which rung it is on.** Cadence responds the instant the legs do; heart rate takes 30–60 s, so a prompt driven by it arrives after the moment it is about. But cadence needs a strap, so when there is none the pacer falls to speed against a pair **derived from your own past fast/slow blocks** (`/api/guided-walk/segment-stats`, ~3 years) rather than asking for a third target to configure, and to heart rate indoors. A user paced by heart rate while believing it is cadence cannot understand why the prompt is late, so the note naming the rung is not optional.
- **Standing still no longer scores a perfect slow block.** "Under the ceiling" would make 0 spm the best possible slow segment; below `STOPPED_SPM` the pacer reads **Stopped** in neutral — it does not scold a pause at a crossing and it does not congratulate one.
- **Keep: only the speed rung has ever executed.** `e2e/walk-pacer-speed-rung.spec.ts` drives a real geolocation series and is mutation-checked, and every guard in `lib/walk/walk-pacer.ts` is too — but **the cadence and heart-rate rungs both need a Polar H10 over BLE**, which does not exist in the sandbox or in `pnpm dev`. So the bands moving with the legs, the Stopped state, the strap-drop fallback and the band colours' contrast at arm's length are all verified by reading. **LB-36** holds the device pass; `BAND_TOLERANCE = 0.10` is a proposal, not a measurement, and is one named constant so a real walk can move it.
- **The ring cannot pace this and must not be made to.** `RING_CADENCE_VALIDATED = false` still holds (`packages/shared/src/health/cadence.ts`) — the ring signal is octave-ambiguous, not broken, and shipping it uncorrected gives a number wrong by 2×, which is worse than showing none. That correction is Lane A's.
- **The number the pacer creates is not stored yet.** Per-segment adherence, steps and which signal paced the segment are additions to `activity_logs.segments`, which is a schema edit — filed as **LA-48**.

### [cardio][devices] ⚠️ The free walk shows heart rate at last, but no device has seen it (Q-418, 2026-08-23)

**Fixed in v1.339.0** — the free-activity screen now carries **HR** in its primary row beside distance and pace (with the guided walk's staleness guard), plus a secondary line with the **running step total** and **elevation gained**; the guided walk got the same step readout so the two agree ([`journal`](docs/overview/entries/2026-08-23-free-activity-metrics.md)). The strap was already streaming beats — the same one feeding that screen's cadence — and the number was already being saved afterwards; it was invisible only while walking, the one time it can be acted on. **Keep: every number here comes from a Polar H10 over BLE and the sandbox has no strap** — `HrReadout` renders its `--` placeholder and `stepsEstimate` is null on every path exercised, so the thing the entry is about (a connected strap putting a live bpm on that screen) and the staleness guard are both unverified. **🟠 The Android pill is still static** and stays Lane A: the plugin exposes only `addWatcher`/`removeWatcher`/`openSettings`, `backgroundMessage` is fixed at watcher creation, and re-adding the watcher would restart location tracking mid-walk.

### [workouts] ⚠️ A deload session says so on both surfaces; neither was checked on the device (BF-8, v1.343.0)

**Fixed.** Both the pre-workout Intensity control and the in-workout header asked `isDeloadActive` — *"is the current PHASE a deload week"* — rather than whether today's session is a deload, which is what `prescription.deload` holds. So an auto-applied, readiness-driven deload read as a full session from the pre-workout screen to the last set, and the owner trained one that way. `sessionContextLabel` resolves the header's line in one place; `useDeloadChoice` adopts the prescription until the user chooses otherwise; "As prescribed" now sits under whichever half the engine picked, with the other labelled **Override** ([`journal`](docs/overview/entries/2026-08-24-deload-visible-on-both-surfaces.md)).
- **Keep: not device-verified, and the active header has no end-to-end guard.** `e2e/deload-visible.spec.ts` covers the toggle against a real auto-applied prescription and is mutation-checked; the header's label is pinned by unit tests only — no spec starts a workout and reads it.

### [nutrition] ⚠️ The meal builder pins its batch figures; the footer is unchecked against the gesture bar (BF-31, v1.381.0)

Artboard 5's footer shipped: `Batch · kcal · P/C/F · per portion` above `Save meal`, outside the
scroll, so the numbers stay put while the ingredients that change them are edited. The name is edited
in place from the header. **On the S25:** the footer is a new bottom-anchored region inside a 90vh
sheet — `SheetContent side="bottom"` owns the bottom inset, so it carries no `pb-safe*` of its own,
but that it clears the gesture bar is unverified. Check also that the header's inline name input is
not covered by the software keyboard.

### [nutrition] ⚠️ The meal photo can be picked; the camera branch has not run (Q-327, v1.341.0)

**Shipped.** `MealPhotoTile` beside the meal-name field in Edit Meal — picker and preview in one tile, so the image rides the save that was already there. `downscaleToDataUrl` gained a `mimeType`, and **requests** WebP rather than assuming it: `toDataURL` answers an unsupported type with a PNG and no error, several times the bytes the 16 KB cap was sized against, so it checks what came back. Guarded by `e2e/meal-photo-picker.spec.ts`, which asserts the **stored** row is a WebP under the cap after feeding it a photo four times past it ([`journal`](docs/overview/entries/2026-08-24-saved-meal-photo-picker.md)).
- **Keep: not device-verified.** `Capacitor.isNativePlatform()` is false in a browser, so every run took the `<input type=file>` branch — the camera/gallery prompt, the tile's tap target on the S25, and the local-store mirror of the image column are all verified by reading only.

### [nutrition] ⚠️ Plan meals become saved meals; the copy has not run on the device (Q-398, v1.340.0)

**Shipped.** `savePlanMealToLibrary`/`savePlanMealsToLibrary` (`packages/shared/src/nutrition/save-plan-meal.ts`) are the one plan→meal copy path — the plan card and the setup sheet's ticks both call it. The setup sheet's own copy created food items with a bare POST and stamped nothing, so a meal ticked there and saved again from the card produced **two copies of one recipe**. Provenance (`From plan`) is derived from `meal_plan_meals.saved_meal_id`, never stored. Guarded by `e2e/plan-meal-to-saved-meal.spec.ts`, asserting on the copied rows rather than a toast ([`journal`](docs/overview/entries/2026-08-24-meal-plan-to-saved-meals.md)).
- **Keep: not device-verified.** Every e2e run took the web fallback (`getLocalStore` is null in a browser), so the local-store mirror and the two outbox mutations per copy are verified by reading only, as are the new controls' 48dp targets.
- **Keep: step 3 of the entry is not done and needs the owner.** It proposes deleting `meal-plan-section` and the staleness nag once meals live in My Meals; the entry gates that on confirmation and this PR did not take it.

### [app-shell][platform] ⚠️ The app is pinned to dark; the device has not been switched to light to check (BF-25, v1.377.0)

`forcedTheme="dark" defaultTheme="dark" enableSystem={false}` on the `ThemeProvider`. The
one-line version BF-25 prescribed was measured and **would have shipped the bug it was meant to
close**: `forcedTheme` alone governs only the class on `<html>`, so `/health/heart-rate` painted
pale-pink hero art under a **white** scrim over a dark page. `e2e/forced-dark-theme.spec.ts` guards
all of it under `colorScheme: 'light'` and was proven to fail without the fix.

**On device:** put the S25 in light mode and confirm the app stays dark end to end, including the
surfaces the provider cannot reach — the icon routes (no CSS) and any canvas paint. The sandbox
emulates `prefers-color-scheme`; it does not run Samsung's WebView or its scheduled night mode.

### [nutrition] ⚠️ Meal photos render at last, and a data-URI image now sits in every scrolling row (BF-32, v1.380.0)

The photo feature was **write-only** since the picker landed — stored, synced, rendered nowhere. Every
meal row now carries a 40 px tile: the photo if there is one, a gradient-and-glyph placeholder if not.
**On the S25:** a data-URI `<img>` in a scrolling list is the shape Samsung's WebView compositor has
mishandled before — check a long day for artefacts and jank. The day screen's tile is always the
placeholder today; `food_items` has no image column, so only saved meals can carry a photo.

### [nutrition][app-shell] ⚠️ One back-dismiss primitive, three failures, and a device pass none has had (BF-30 v1.378.0 · LB-17 v1.382.0 · BF-34 v1.383.1)

Artboard 4 shipped as a **nested sheet**, and this row said its unwind "rests on BF-27's
one-press-per-layer guarantee". **That guarantee has now failed twice.** LB-17: an id comparison read
every entry that was not a sheet's own as "mine is gone" — right at two layers by accident, wrong
from three, which is what Q-395c built by reaching the list through Log Food. BF-34: the flag marking
one of our own `history.back()` calls was per-instance, so a sheet closing and a dialog opening in
the same tick could not see each other's and **the confirm dialog closed on the frame it opened** —
the owner's *"the delete feature doesnt work"*. Both fixed, both pinned by tests that fail on the old
logic. **Neither has been felt on a real gesture bar, which is the only place either lived.**
On the S25: tap a diary row, tap the bin — the confirm dialog must **stay** open and be tappable, and
Cancel must cancel. Press back from an open meal: it unwinds one layer per press, meal → Log Food →
the page. **Two presses now, not three** — LB-16 collapsed that screen, so the middle layer is gone and
`sheet-back-stack.test.ts` carries the three-deep case. Scrolling must never reveal a tray; a left-drag
opens one, a right-drag closes it, a second row closes the first; a 92vh action row must clear the bar.

### [nutrition][app-shell] ⚠️ The calorie surface: one budget, a progress bar, and one open cache-ordering bug (Q-415/Q-417/Q-323 fixed, LB-4 open, 2026-08-23)

**Fixed in v1.335.0.** Home's nutrition card and the Nutrition ring both read `budgetProvenance(...).total` — the expression the provenance line under the bar already prints — instead of composing `nutrition_targets.calories` (the **rest-day floor**) plus a separately-sourced burn. Three budgets used to be on screen at once from the same data (2,180 / 2,451 / 2,001), which is how one card said "Goal reached" while the card two rows above said "166 kcal left". Macro bars now use `macroTargets.scaled`; the label says "from movement" ([`journal`](docs/overview/entries/2026-08-23-one-calorie-budget.md)).
- **🟠 LB-4 — logging food invalidates BEFORE its push,** so subscribers refetch a payload the server has not got and cache it. Cause of Q-417's 42 kcal gap between Home's and Nutrition's identical cards. Lane A: local-store/outbox path. **v1.336.0 finished Q-323's display half** — the bar fills toward a goal notch (x-axis is intake, 0 → `budget + OUTER_KCAL`), Home's donut became a progress ring, and **`barPosition`/`barBands` are deleted** for `barProgress`. The entry said "the macro ring" but described Home's donut; the Nutrition ring already did the asked-for thing ([`journal`](docs/overview/entries/2026-08-23-calorie-progress-bar.md)). **Keep: not device-verified** — the sandbox serves the MET table as synthetic fixtures, so the **activity** contribution to the budget is 0 here and only the heart-rate contribution ran; the bar and ring are purely visual, judged at 412 px in Chromium, never on the Samsung WebView compositor that is the known hazard for masked conic-gradients, and never in the light/dark pair. **v1.337.0 shipped Q-387's Lane B half and closed Q-359.** The Nutrition day now ends with an "I've finished logging" button, its Undo and the "N of 10 days" counter — the flag `estimateMaintenance` filters on, which until now nothing could set, so the calibration was stuck on `'formula'` ([`journal`](docs/overview/entries/2026-08-23-food-logging-complete.md)). **That write has no outbox domain**: marking a day complete offline fails visibly rather than queueing — deliberate for a once-a-day action, not an oversight. Q-359's can-bite group has been zero since v1.325.9 and its remaining twelve sites are latent by definition, frozen shrink-only.

### [workouts][activity][app-shell] ⚠️ Editing and deleting logged training is back, but has not been checked on the device (LB-1, 2026-08-23)

**Fixed in v1.334.0** — `/health/day` carries edit + delete on every exercise row, delete on every session card and every activity, reusing `day-overlay-dialogs.tsx` unchanged. The four handlers moved into `lib/hooks/use-day-entry-mutations.ts`, called by the day screen *and* `health-content.tsx`, so there is one write path per domain. Guarded by `e2e/day-entry-edit-delete.spec.ts` — four cases asserting on the **database**, not on the row disappearing: every handler toasts and closes *before* its request resolves, so a control wired to nothing looks identical on screen ([`journal`](docs/overview/entries/2026-08-23-day-screen-edit-delete.md)). **How it happened:** Q-110 (2026-08-08, v1.270.0) repointed the calendar day-tap from `DayOverlaySheet` to `/health/day` and the controls stayed on the sheet, which nothing else opened — so the app's only Edit/Delete controls, and the only client callers of the three DELETE routes, sat unreachable.
- **🟠 LB-4 — logging food invalidates BEFORE its push,** so subscribers refetch a payload the server has not got and cache it. Cause of Q-417's 42 kcal gap between Home's and Nutrition's identical cards. Lane A: local-store/outbox path. **v1.336.0 finished Q-323's display half** — the bar fills toward a goal notch (x-axis is intake, 0 → `budget + OUTER_KCAL`), Home's donut became a progress ring, and **`barPosition`/`barBands` are deleted** for `barProgress`. The entry said "the macro ring" but described Home's donut; the Nutrition ring already did the asked-for thing ([`journal`](docs/overview/entries/2026-08-23-calorie-progress-bar.md)). **Keep: not device-verified** — the sandbox serves the MET table as synthetic fixtures, so the **activity** contribution to the budget is 0 here and only the heart-rate contribution ran; the bar and ring are purely visual, judged at 412 px in Chromium, never on the Samsung WebView compositor that is the known hazard for masked conic-gradients, and never in the light/dark pair.

### [platform][devices] 🟡 The CSP now permits WASM, and dropped two dead hosts — neither checked on the device (Q-546, 2026-08-20)

- **What shipped.** `script-src` gained **`'wasm-unsafe-eval'`**, which permits WebAssembly
  compilation and nothing else. Without it no WASM session can start in the browser, so every
  on-device model was blocked behind a one-line change — `onnxruntime-web` is already a dependency
  with a passing parity test, and that test runs under Node, which enforces no CSP at all. It proved
  the model matched its golden while nothing could have loaded it.
- **And `connect-src` lost `cloud.ouraring.com` and `api.ouraring.com`**, seven days after the Oura
  Cloud integration was deleted. `lib/oura/__tests__/no-cloud-calls.test.ts` already proved no source
  file calls them — but it swept `app/`, `components/`, `lib/` and `packages/shared/src`, and the CSP
  lived in `next.config.ts` at the repo root, where nothing looked. The guard now sweeps five root
  files too, and fails if one is renamed out of the sweep.
- **⚠ NOT verified on device.** The APK is a WebView loading the Railway URL, so it receives this
  header. `pnpm dev` serves the new directive and the app renders under it, and the deployed header
  can be read with `curl -sI`, but **neither shows the S25's WebView accepting it**. Two things are
  outstanding: that the app still loads normally on the device after the deploy, and — separately,
  and not possible yet — that a real WASM session instantiates, which cannot be asserted until the
  first client-side model actually lands. That assertion belongs in that PR, not this one.
- **`'wasm-unsafe-eval'` is narrower than `'unsafe-eval'`**, does not imply it, and production still
  does not carry `'unsafe-eval'` — a test asserts both halves of that.
- **One thing measured but deliberately not acted on:** `onnxruntime-web` 1.27 can create workers
  from a blob URL when threading/proxying is enabled, which `script-src` would also have to permit.
  Whether that configuration is used is a decision for the PR that adds the first client model, and
  widening a security header on speculation is the wrong order.

### [nutrition] Food logs changed shape three times in one day and none of it is device-verified (Q-413, Q-325, Q-412 · v1.327.0–1.328.0) — NOT verified on device · needs: hardware

- **What shipped**, all on `food_logs`, which is **offline-first** — so the local mirror is where a
  sync half fails silently, and `pnpm dev` proves the server half only (`getLocalStore` returns null
  in the web sandbox).
  - **Q-413** — `logged_at` now means when you *ate*, not when you tapped: inside the meal's window on
    the log's own date keeps the real instant, otherwise it takes the window midpoint in the user's
    timezone. Migration **203** corrected stored rows whose timestamp fell on a different local date
    than their `date`. [`journal`](docs/overview/entries/2026-08-19-resolve-eaten-at.md).
  - **Q-325** — `applyDelta`'s `food_logs` conflict arm updated only 4 of 8 columns, so a device that
    already held a row could never learn a changed `date`, `meal_type_id`, `food_item_id` or
    `logged_at`. **Without this, Q-413's corrections would have stopped at the server.**
  - **Q-412** — a meal type with entries can be deleted by moving them, in one transaction, with each
    moved row re-timed against the new window.
    [`journal`](docs/overview/entries/2026-08-19-meal-type-reassign.md).
- **The checks owed**, all on the APK:
  1. Back-fill yesterday's dinner **while offline** and confirm the row shows the window midpoint
     rather than the current time — before *and* after it syncs. That is the pair that proves the
     local resolver and Q-325's pull together.
  2. Reassign a meal type that has logs, then confirm the entries appear under the new type with the
     same calories, the day total is unchanged, and it survives an app restart.
- **Why it is one row rather than three:** the same offline path carries all three, and one session
  on the device settles them together.

- **A deliberate, stated cost in Q-413's migration:** it corrected only rows whose timestamp fell on
  a *different local date* than their own `date`. A pre-existing row logged on the right day but
  outside its meal's window keeps its original time, while an identical new row is moved to the
  midpoint. So a handful of historical points sit outside their meal's window. That was the
  conservative choice — where the user logged as they ate, the stored instant is the better datum —
  and Q-414's chart entry carries the caveat so it is not met as a surprise.

### [nutrition][platform] Meal label saves to the gallery and declares 600 dpi (Q-400, v1.326.0) — NOT verified on device · needs: hardware + a printer

- **What shipped**: the dead "Share or save" button became **Save to gallery** (native, over a new
  `MediaSave` bridge → MediaStore) and **Share** (system sheet, `canShare` guard kept), every branch
  ending in a toast; and the PNG both hand out now carries a `pHYs` chunk declaring its density.
  [`journal`](docs/overview/entries/2026-08-19-label-save-to-gallery.md).
- **Why it is here**: **needs a new APK**, and both fixes are unobservable from the sandbox — the
  gallery write goes through a bridge that does not exist in a browser, and whether a printer honours
  `pHYs` is a physical measurement. What *was* verified: the chunk read back out of a real PNG by an
  independent decoder (**600.0 dpi** → 1,179 px measures **49.9 mm**, against **311.9 mm** unstamped),
  and two E2E tests driving the real button.
- **The check owed**: install the APK, tap Save, find the file in the Samsung Gallery. Then print
  once and measure against `metrics.codeMm`. **That single print also answers Q-411** — whether the
  circle template crops (module holds at 0.56 mm) or scales (falls to 0.397).
- **Known limitation**: below Android 10 the save reports unavailable rather than falling back, and
  the native paths never fall through to the browser download — in the WebView that is a no-op, so a
  fall-through would toast success and produce nothing.

### [platform] ✅ FIXED 2026-08-23: a revoked admin kept catalogue write access for ≤24h (Q-479, 2026-08-18)

- **Shipped — the owner merged #124 on 2026-08-23**, reversing their own 2026-08-18 decision to
  carry it as an accepted risk (*"only admin will be me for a long time"*). `app/api/exercises` now
  reads the row instead of trusting the session claim: a revoked admin gets **403** where it
  previously got **201** and created a row in `exercise_library`.
  `scripts/check-admin-claim-in-api.js` stops it returning — zero baseline, verified to fail on a
  reintroduction — and `admin-claim-not-authoritative.test.ts` pins the deliberate disagreement
  between `requireAdmin` and `isAdminUser` so neither drifts into the other.
- **Kept here rather than archived:** the PR states production and the 24-hour window were **not
  exercised end to end** — the measurement was a local reproduction with cookie rotation persisted.
  Archive it once that is confirmed against production. The **duplicate row further down this file**
  (Review's original finding, same Q number) is resolved by the same merge.
- The description below is the state *before* that merge, kept because it is the measurement.
- **Do not re-implement it.** Branch `fix/exercises-route-admin-db-check`, PR #124, merged.
- **What it is.** `app/api/exercises` authorises from the session's `isAdmin` JWT claim rather than
  reading the row, because it calls `isAdminUser(userId, isAdmin)` — which *returns the passed flag*
  when given one. Its 61 sibling API routes call `requireAdmin`, which reads the row every call and
  refuses to trust the claim. The claim refreshes at most once a day (`ISACTIVE_RECHECK_MS`).
- **Measured**, admin granted → fresh login → token warmed → admin revoked in the DB, no re-login,
  cookie rotation persisted: `POST /api/exercises` **201** (row created in `exercise_library`)
  against `GET /api/admin/errors` **403**, same cookie, same instant, database already saying no.
- **Why accepting it is reasonable, stated so it can be re-checked rather than re-argued.** The
  window opens only on **revocation**. With a single permanent admin, admin is never revoked, so the
  window never opens. The blast radius is also rows in a shared catalogue, not user data.
- **What makes it live again** — any of these, and #124 should merge:
  - a second admin is granted and later revoked;
  - the Play Store / multi-user path in Canonical Runtime advances, since that is where non-owner
    accounts and a real admin/non-admin boundary arrive;
  - `isAdminUser` gains another API-route caller. `scripts/check-admin-claim-in-api.js` on that
    branch would catch it — but that check is **not on `main`**, because it ships with #124.
- **Also unmerged with it:** the correction to `lib/auth/is-active-refresh.ts`, whose docstring
  currently claims *"This governs the UI only: `requireAdmin` reads the row from the database on
  every call and never trusts this claim."* **That sentence is false for this one route**, and it is
  why the gap went unseen — a reviewer who reads it stops looking. Until #124 lands, treat that
  comment as wrong.

### [activity][platform] 🟢 Cross-user isolation holds; one route reports a success it did not perform (Q-556, 2026-08-18)

- **The last reachable "structurally untested" item — a second account — driven for real.** The local
  harness already had a zero-data account with a saved session, so it needed no new infrastructure.
  **Third time this run an "unreachable" surface was not.**
  [`docs/reviews/2026-08-18-cross-user-isolation.md`](docs/reviews/2026-08-18-cross-user-isolation.md).
- **✅ 10 of 11 probes rejected by the route's own ownership check** — reading A's recap/energy/timing,
  deleting A's workout, **logging a set into A's session**, completing A's workout. **And the
  enumeration control passed:** a nonexistent id and A's id return byte-identical responses, so no
  route confirms which ids exist.
- **🟢 Q-556 — `DELETE /api/activity-logs` returns `200 {"success":true}` for another user's row.**
  **Not a leak, and that was checked:** the DB immediately after shows the row intact, `deleted_at`
  NULL, still A's. The repo method returns `void`, so the handler cannot know and answers success
  unconditionally. Filed because it is **inconsistent with every sibling** (house posture is 404 for
  both cases) and because **offline-first makes a false success expensive** — a 2xx confirms and drops
  an outbox mutation. That second path was **not demonstrated**.
- **⚠️ The first run of this sweep reported eleven clean results and proved almost nothing** — six hit
  routes that do not exist (HTML 404s, which read exactly like an access-control pass) and one failed
  schema validation first. **A 404 from an unmatched route is not evidence of access control**, and the
  tell was in the body, not the status.
- **Not exercised:** one probe (`PATCH …/metrics`) still failed validation, so that check is unverified.
  Local DB + web build; not production, not device; two accounts only.


### [app-shell][platform] 🟢 Offline read surfaces work; a tab tap is a silent no-op only before the SW claims (Q-555, 2026-08-18)

- **The offline paths were driven for real for the first time** — this role's baton had listed them as
  structurally untested since sweep 1, and `context.setOffline(true)` turned out to be the whole
  barrier. [`docs/reviews/2026-08-18-offline-read-surfaces.md`](docs/reviews/2026-08-18-offline-read-surfaces.md).
- **✅ Both paths deliver once the worker controls the page.** A full reload offline serves the
  precached `/offline` page verbatim (and the precache works under `next dev`). An offline tab tap
  navigates and paints **2515 chars against 2486 online — ~101%** — no offline page, no skeleton, no
  blank. **This is the strongest positive result of the run; the offline story is not aspirational.**
- **🟢 Q-555 — the narrow gap.** In the **uncontrolled** state the same tap is a **silent no-op**: URL
  unchanged, no navigation, no offline page, no feedback. That state **is the first-ever page load** —
  the worker registers during it and claims only afterwards. Filed because the symptom is
  indistinguishable from a frozen app, and on the APK the worker **is** the offline cold-start
  mechanism, so install day is when a new user is most likely to be changing networks.
- **⚠️ Three of five probe iterations produced plausible, specific, wrong answers** — all retracted
  before filing. The keeper: a "38% retained" figure and a marker match **agreed with each other and
  both failed for the same reason** (the home page renders widgets labelled Readiness/Sleep/Activity).
  Only the URL settled it. **Corroboration between two weak signals is not evidence when they can fail
  the same way.**
- **Not exercised — load-bearing:** web only. On web `cachedFetch` falls back to `localStorage`, so the
  **seed** path was verified, **not** the native SQLite store that is the APK's real source of truth.


### [platform] 🟢 The module map's `path → symbol` claims all hold — 110 of 110, now ratcheted (2026-08-18)

- **A clean sweep, recorded because a null result is easy to under-report.**
  [`docs/reviews/2026-08-18-module-map-symbol-claims.md`](docs/reviews/2026-08-18-module-map-symbol-claims.md).
- **Took Q-554's stated limit as the lens.** That check proves a path *resolves*, never that the prose
  beside it is true. The mechanically checkable part of the prose is the `→ symbolName` claim — the
  part a reader acts on. **All 110 name a symbol that exists in the file they attribute it to.**
- **This bounds the Q-554 worry rather than leaving it open.** Row 232 (a map row for a module never
  built) was **not** the tip of a pattern of sloppy attribution — it was one row, and its path was
  wrong too, which is why the cheaper check caught it. The map's attribution is in good shape.
- **⚠️ A correction inside the measurement.** The first probe reported 72 of 110 rows resolvable —
  implying 38 broken paths, flatly contradicting the check shipped an hour earlier. The **probe** was
  wrong: it omitted the `lib/…` → `packages/shared/src/…` remap (Q-153). **A new measurement that
  contradicts an existing green check is a bug in the measurement until proven otherwise.**
- **Ratcheted:** `scripts/check-module-map-symbols.js`, step **43 of 43**. A presence check, not a
  resolver — the failure worth catching (a symbol that moved, leaving the map pointing at its old
  home) shows up as absence. It earns its place at zero violations because *"One Formula, One Place"*
  names this map as how you find the existing implementation, so a row pointing at the wrong file is
  how the second copy gets written — **by someone who checked first, as instructed.**
- **Not exercised:** a row naming a real file and a real function while describing behaviour neither
  has still passes. That half remains unmeasured.


### [app-shell][health] 🟢 Three lenses — two clean, and cards that cannot tell "no data" from "the fetch failed" (Q-499, 2026-08-18)

- **Two lenses came up clean and are recorded so nobody re-runs them.**
  [`docs/reviews/2026-08-18-silent-card-failures.md`](docs/reviews/2026-08-18-silent-card-failures.md).
  **(1) Internal error text in responses** — 7 route files return `err.message`, every one admin- or
  session-gated, two apparent hits are logs not responses, and `admin/db-query` returning the raw SQL
  error is **correct by design**. **(2) AI rate-limit coverage** — 7 routes looked unlimited; all seven
  make **zero LLM calls** and matched on the `ai` path segment alone. **Every route that actually
  calls an LLM has a rate limit.** Sixth consecutive sweep where the mechanical check over-reported.
- **🟢 Q-499 — and a correction to the rule that names it.** `CLAUDE.md` says `cachedFetch` *"swallows
  `!res.ok`"*; it does **not** unconditionally — `cachedFetchCore` takes an `onError` callback and
  swallows only when the caller declines it. So this is **coverage with an existing mechanism**, not a
  missing capability, and the rule's wording should say so.
- **78 components call `cachedFetch`; 18 reference `onError`** (an upper bound — some are unrelated
  matches). **Two verified by hand**, both conflating failure with emptiness:
  `health/hr-recovery-profile-card.tsx` (`return null` while `profile` stays null on failure) and
  `health/strength-progress-card.tsx` (`.catch(() => {})` then `return null`).
- **Scoped honestly:** 12 candidates from a crude filter, **2 confirmed** — the other ten are a
  worklist, not a defect count.
- **Why it matters more than it looks:** `cachedFetch` treats any `!res.ok` alike, **including a 429
  from the app's own limiter** — a rate-limited user watches health cards vanish rather than seeing
  "try again in a minute", and the same silence covers a 500.
- **✅ REPRODUCED 2026-08-18 (sweep 34)** —
  [`docs/reviews/2026-08-18-card-429-reproduction.md`](docs/reviews/2026-08-18-card-429-reproduction.md).
  `/api/weights-summary` forced to 429 by route interception at the S25 viewport: **`Estimated 1RM`
  went 1 node → 0, with no error wording anywhere on the page.** **Control holds** — blocking a
  different endpoint left it at 1. (`Ring Status` inconclusive: absent at baseline too.)
- **⚠️ Invisible on a warm cache, visible on a cold one.** A repeat visit paints the seed and the
  failed refresh is silent. So the user most likely to hit it is opening fresh, and least likely to
  reproduce it a minute later — *"the card is gone"* reads as **intermittent**, inviting the
  "can't reproduce" dismissal the report-invalidation rule exists to prevent.
- **Still not exercised:** on device and offline (where `cachedFetch` cannot revalidate at all). **One**
  card proven; the other eleven remain a worklist.


### [platform][app-shell][readiness] 🟢 This run's own findings checked against production — one refuted, two re-scoped, one new (Q-472, 2026-08-18)

- **The lens was to measure my own claims.** Seven sweeps filed 22 findings (Q-450…Q-471), almost all
  from code-reading and a local seeded database; `claude_ro` had never been queried directly in any of
  them. More of this write-up is corrections than discoveries, which is the point of running it:
  [`docs/reviews/2026-08-18-production-verification.md`](docs/reviews/2026-08-18-production-verification.md).
- **🆕 Q-472 — the Coach's write capability has never once been used.** `coach_changes` is **empty**:
  no applied change, ever. The Coach is *not* unused (5 threads, 16 messages, 17 calls in 30 days) and
  the widgets render — 8 of 8 assistant messages carry a tool, 5 a `choice_list`, **1 a
  `change_preview`** — but **0 changes were applied**. Apply is **not** broken (the previous sweep
  applied a patch through the real route). Whether the model rarely proposes or the one proposal was
  declined is **not determinable from this data**. Filed as an owner decision, not a defect.
- **🔎 Q-467 and Q-468 re-scoped, not closed.** Both are real code defects; both have **zero
  production exposure**. Nothing has ever been applied, so nothing has ever needed undoing, and no
  `target_id` carries more than one change. Their top-of-queue placement was priced on exposure that
  does not exist yet.
- **🔎 Q-465 refuted in practice — and my first query was wrong.** It reported "45 of 50 check-ins
  entirely empty"; that query tested only the seven evening columns and ignored six morning ones. Re-run
  across **every** answer column: **zero truly-empty rows** (45 morning, 5 evening, all with answers).
  The route will write a hollow row if handed `{}`; nothing in real use has. The false 45/50 is recorded
  in the entry so it cannot be picked up from anywhere it leaked.
- **🔎 Q-460 cannot be adjudicated from production.** 57 of 77 completed sessions (74%) carry no
  `session_rpe` — which looks supportive and **is not evidence**, because a dropped write leaves the
  value in the local store this endpoint cannot see, making it identical to a skipped optional prompt.
  **Do not cite the 74% in either direction.**
- **✅ `error_events` holds nothing new** (the session-start read, done properly). The 30-day table is
  dominated by **5,771** `[pg 21000]` cardinality violations on `POST /api/hr-ingest` — **already
  recorded and already fixed**, with the last occurrence (2026-08-13) being the fix landing rather than
  a fault that stopped unexplained. Everything else is connection-timeout/`aborted` noise mapping to the
  recorded pool and disk-full incidents. Nothing unrecorded in 7 or 30 days.
- **The constraint governing every number above:** `claude_ro` is **row-scoped to one user** and
  `error_events` prunes at 30 days. Every count is *the owner's data, recently* — never "the system's".
  A zero means the owner has never done the thing; other accounts are structurally invisible here.

### [app-shell] 🟡 Nine collapsibles still ship no `aria-expanded` — and it is the third hand-maintained count in `CLAUDE.md` found stale this run (Q-491, 2026-08-18)

- **A named list with a date is checkable, which is the reason to write one.** `CLAUDE.md` names nine
  chevron toggles lacking `aria-expanded`, re-counted 2026-08-09. Re-checked:
  [`docs/reviews/2026-08-18-aria-expanded-collapsibles.md`](docs/reviews/2026-08-18-aria-expanded-collapsibles.md).
- **Still 9, but not the same 9.** `more/profile-tab.tsx` is **fixed** (0 chevrons remain);
  `components/weights-summary.tsx` has the defect and **was never on the list**; `deload-explanation`
  and `signal-sections` have **moved**, so the paths in the rule are stale. The other six are unchanged.
- **One partially compensates:** `weights-summary.tsx` carries `aria-label={collapsed ? "Expand" :
  "Collapse"}`, so state does reach a screen reader — just not through the attribute that also
  expresses the control→region relationship.
- **Severity low and the reason is honest:** no known screen-reader user. Filed because the stated
  direction is a **Play Store listing**, where accessibility is a review surface, and because the
  recommended fix removes a maintenance burden rather than adding one.
- **Prefer the ratchet over the sweep.** Nine attributes are easy to add and will drift again.
  `CLAUDE.md`'s own rule says to prefer Radix `Collapsible`, **which supplies both attributes for
  free**; then a shrink-only Custom Rules count so the list stops needing a human.
- **⚠️ The pattern is worth more than the finding — third stale hand-maintained count this run:**
  Q-480 (repo helpers described as hardcoding a timezone they take as a parameter), Q-490 (*"both
  long-standing memos"* — there are **66**), and this one. **Every ratcheted count is current** — hex
  literals, TTL divergence, component size, doc-index size, backlog pointers. This file already drew
  that lesson for hex literals (*"recorded here as improving and it was not … because this line was
  prose and nothing measured it"*); it applies to its own prose. **A count in prose is a claim with a
  decay date; a count in a script is a fact.**
- **Not verified: no screen-reader testing** — the claim is that the attribute is absent, not that an
  announcement is wrong. Not on the APK, where TalkBack is the relevant reader. `coach-content.tsx`
  was examined and **excluded** (its chevron is a back button).

### [nutrition][app-shell] 🟡 64 of 66 memos hold; the two that do not re-render every meal row on every keystroke (Q-490, 2026-08-18)

- **`CLAUDE.md` warns that an inline object or arrow "defeats the memo silently" — a defeated memo
  looks optimised and does nothing.** Nobody had checked whether the current ones hold.
  [`docs/reviews/2026-08-18-memo-stability-audit.md`](docs/reviews/2026-08-18-memo-stability-audit.md).
- **The headline is the clean part: 64 of 66 hold, and there are no inline arrows anywhere** in a
  memoised component's props. The discipline the rule asks for is being kept almost everywhere.
- **The two exceptions are one module and one prop.** `MealMacroBars` and `DayMacroTotals`
  (`meal-macro-bars.tsx:58,83`) are called with `target={{ … }}` — a fresh object identity per render —
  from `meal-plan-review-step.tsx` and `meal-plan-edit-sheet.tsx`, in both cases **inside
  `variant.meals.map(...)`**.
- **Why it bites:** the edit sheet holds **9 `useState` hooks** including per-keystroke handlers
  (`setInstruction`, `setRenameText`), so **every keystroke re-renders every meal row's macro bars** —
  exactly what the memo was added to prevent. **Performance, not correctness**, and bounded by the
  handful of meals in a day.
- **Fix:** `useMemo` the object, or better, pass four scalars — for the per-meal site a `useMemo` would
  need one memo per row, so scalars are the cleaner choice.
- **A stale clause worth correcting alongside:** the rule says *"both long-standing memos in the
  codebase were defeated exactly this way"*. There are now **66** memoised components, not two. The
  rule is right; the count is from an earlier era and reads as though memoisation is rare here. Same
  class as Q-480.
- **Not verified: no render counts were measured** — the claim follows from object identity and
  React's shallow compare, not a profiler run. The call-site scan can miss a memoised component
  invoked with deeply nested children in its props; the 66 declarations are exhaustive.

### [platform][readiness] 🟡 Five sites turn an ms offset into a calendar day; in a DST zone three compute "today" for "yesterday" (Q-489, 2026-08-18)

- **`CLAUDE.md` bans this shape and records six copies shipping in one file.** `lib/ai-chat/tools.ts`
  is clean now, but 12 instances remain elsewhere and nobody had sorted the ones that matter from the
  ones that do not. [`docs/reviews/2026-08-18-ms-offset-to-calendar-day.md`](docs/reviews/2026-08-18-ms-offset-to-calendar-day.md).
- **⚠️ Most of the 12 are CORRECT and filing them would be wrong.** The rule's harm is *"ms-offset
  windows straddle two AEST days and merge them"* — that is about **day-bucketed** aggregation.
  `muscle-recovery`, `workout-load-history` and `friends/feed` use a **rolling instant** filter feeding
  consumers that work in hours (`computeMuscleRecovery` reads `ws.startedAt.getTime()`), which for a
  physiological window is *more* correct than a calendar day.
- **Five sites do produce a calendar day, and the failure is measured** in `America/New_York`:
  ```
  ** MISMATCH **  local 2026-11-01 23:30   now-24h → 2026-11-01   true yesterday 2026-10-31
  ```
  On the **25-hour fall-back day**, in its last hour, `now − 24h` lands on **today**. Three of the five
  are computing "yesterday" that way — the `getOuraDailyDerived` range start (an AI-dynamic
  prescription input), the achievements streak comparison, and the periodization signal chain.
- **Severity stated plainly: unreachable today** — every user is `Australia/Brisbane`, no DST — and
  **one hour per year per DST-zone user** when reachable. Filed because it is measured, it is exactly
  the hand-rolled date arithmetic this file bans, and **`shiftDateStr` already exists and is already
  used in this shape** at `slices/oura.ts:1182`. One-line swaps.
- **Q-477 is what makes it reachable at all** — the Profile timezone setting and its auto-detect
  button. Same family; neither urgent.
- **Two clean results:** `lib/ai-chat/tools.ts` carries none of the banned pattern (the 2026-07-06 fix
  held), and the rolling-window uses must not be "fixed".
- **Not verified:** measured with `date-fns-tz` directly, not by driving the app with a DST-zone user
  at that hour — the app cannot be time-travelled here.

### [platform] ✅ Q-488 is the only one — every other write to a local-first domain updates the store (2026-08-18)

- **Answers the question an implementer taking Q-488 has to ask:** is this a handler or a class?
  [`docs/reviews/2026-08-18-local-first-write-coverage.md`](docs/reviews/2026-08-18-local-first-write-coverage.md).
  **It is one handler.** Every mutating write to a local-first domain was audited for a local-store
  call **inside the handler** — `injury-sheet` (PATCH+DELETE), `nutrition-content` (DELETE),
  `quick-edit-log-sheet` (PATCH), `saved-meals-sheet` (DELETE), `manage-supplements-sheet`
  (DELETE+PATCH), `done-activity-screen` (PATCH). **All eight write locally.** Only Q-488's does not.
- **⚠️ The obvious check is unsound, and its own output proves it.** Asking whether the *file* touches
  the local store reports `health-content.tsx` — the Q-488 file — as fine, because it uses the store
  elsewhere and just not in the delete handler. **File-level coverage says nothing about a handler.**
- **Two server-only writers, both clean.** The Health Connect metrics PATCH arrives via the pull, and
  `meal-plan-setup-sheet.tsx:387` creates saved meals server-only — fine, because `saved_meals` is
  **push-only** in the outbox and kept current by **hydrate-on-read**. **So "no pull mapping" is not
  evidence of a gap**; an audit testing pull coverage alone would file that one wrongly.
- **Not verified:** static audit and source reading, not the APK. The handler-window heuristic reads a
  fixed span around each call site, so a local write further away would be missed.

### [activity][app-shell] 🟠 Deleting an activity leaves it in the local store, so three other screens keep showing it (Q-488, 2026-08-18)

> **⚠️ THE SUBSTANCE IS FIXED — only the device check keeps this row here (2026-08-24).** What this
> row describes, a delete that updates the server and never touches the local store, is no longer
> what the code does: Q-328 routed it through the outbox, so the client writes a local tombstone
> **first** and queues the mutation
> ([`journal`](docs/overview/entries/2026-08-24-activity-log-delete-outbox.md)). The call site also
> moved twice — it is `handleDeleteActivity` in `lib/hooks/use-day-entry-mutations.ts` now, not
> `health-content.tsx`, so the line numbers below are dead.
>
> **Kept, not archived, per the archive rule:** `getLocalStore` returns null in the sandbox, so every
> test of that path took the web fallback. The local write is verified by reading and unit test, never
> on the S25. **Strike this row once it is exercised on device with the network off.**

- **The successor sweep 22 named for itself:** a stale value arising *outside* Q-262's test — a write
  that updates the server without touching the local store.
  [`docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md`](docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md).
- **What.** `health-content.tsx:684-700` deletes via `fetch("/api/activity-logs", {method:"DELETE"})`,
  toasts *"Deleted"*, invalidates caches — **and never touches the local store**.
- **The originating screen is correct, which is why this survived.** `refreshDayOverlay` reads
  `cachedFetch('day-log:<date>')`, a **server-read** cross-domain aggregate (the sanctioned
  exception), so the activity vanishes there at once. Nothing on that screen could reveal the problem.
- **The local row is untouched**, and three surfaces read it local-first — session-select's week
  activity, nutrition's calories-burned total, and the activity-history card. `pullDelta` is throttled
  to **5 minutes** un-forced and nothing in the delete path forces one, so the floor is that window
  and the real duration is "until the next natural sync".
- **It self-heals and is not data loss.** The server delete is a **soft** delete with a
  `user_id`-scoped tombstone, and `applyDelta` applies it under the correct `sync_status='synced'`
  guard. Something wrong is shown for a while; nothing is lost.
- **Fix is one call** — delete the local row alongside the API call, as `done-activity-screen.tsx`,
  `exercise-review-sheet.tsx` and `walk-summary.tsx` all already do. Making the delete work *offline*
  is a separate, larger question and should not be folded in silently.
- **The rule it breaks is not written down.** `CLAUDE.md` states the forward direction (*"if a domain
  WRITES to the local store, its UI MUST READ from the local store"*). The inverse is what bites:
  **a domain the UI reads local-first must have every write update the local store — including
  deletes, and including writes made from a screen that itself reads server-side.** Worth adding
  alongside the fix.
- **Three clean results:** the Health Connect metrics PATCH is server-only but its full chain checks
  out (all four fields in the pull mapping *and* `RECONCILE_COLUMNS`); that route is one of the only
  two dynamic routes that validate their UUID (consistent with Q-482); and the delete/tombstone
  mechanism itself is present and correct.
- **NOT reproduced on-device** — `getLocalStore` returns null in the web sandbox, so the local-first
  readers fall through to their API fallbacks and the inconsistency cannot appear there. On-device is
  the only real verification.

### [platform] ✅ Every load-bearing cache invalidation audited — no gap, closing an audit `CLAUDE.md` names as never done (2026-08-18)

- **The most repeated bug class in this project (12+ incidents), audited against Q-262's own test.**
  [`docs/reviews/2026-08-18-load-bearing-cache-audit.md`](docs/reviews/2026-08-18-load-bearing-cache-audit.md).
  Q-262 established that a stale entry only survives as a *settled* value when a call site passes
  **`freshWithinTtl: true`** or a read path is **seed-only** — and this file recorded that only
  `invalidateGoalRecommendations` had ever been checked, *"the other groups are not audited."*
- **Case (a) is now audited and clean.** Sixteen `freshWithinTtl: true` sites resolve to **seven keys**,
  all `TTL_LONG` (6 h) — `exercise-library`, `activity-types`, `progression-styles`,
  `workout-templates`, `progress-summary`, `workout-data:all`/`workout-card:<id>`. Every one is in an
  invalidation group and every client writer behind it calls that group. No gap.
- **Reads as a live defect and is not:** `session-select-content.tsx:896` says the `workout-data`
  caches are *"never invalidated … for up to 6 hours"* — that is the comment **on** the Q-117 fix, and
  `invalidatePrescriptionChanged()` is the line below it.
- **A design property, deliberately not filed:** invalidation is **device-local**, so a change to the
  shared `exercise_library`/`activity_types` leaves other clients on the old list for up to 6 h. Fine
  while there is no second writer; **when multi-user lands the answer is a version/etag or a shorter
  TTL for shared config**, not more call sites, which cannot reach across devices.
- **Case (b) is still unaudited** — seed-only read paths (the Q-260 shape: a screen that
  `readCacheSync`s a key and never fetches it). That half has no revalidation at all and is the
  likelier source of a stale-value report. The obvious next sweep.
- **Not verified:** static audit plus local dev, not the APK; cross-device staleness was reasoned
  about rather than reproduced, since this harness has one client.

### [platform] 🟠 Q-475 shipped mid-sweep; the production evidence is about the half its fix did not cover (Q-487, 2026-08-18)

- **This run's fourteen findings checked against production**, the same exercise that corrected four
  findings in sweep 8.
  [`docs/reviews/2026-08-18-production-verification-round-2.md`](docs/reviews/2026-08-18-production-verification-round-2.md).
  Nothing new filed; **six entries amended**.
- **⚠️ Q-475 was implemented while this sweep ran** — `#115` classifies the cause server-side
  (`isRetryableWriteError`), stops the client counting a retryable failure against
  `MAX_MUTATION_ATTEMPTS`, and engages the whole-queue backoff. **The dead-lettering and missing
  backoff are genuinely fixed.** What the evidence below is about is **not**: `reportServerError` is
  called only in the route's *outer* catch, which `pushMutations` never reaches, so a push failure
  still never reaches `error_events`. **Filed as Q-487**, scoped to the observability half.
- **The production shape, and it is an absence:**

  | Route | Faults in `error_events` | Span |
  |---|---|---|
  | `/api/sync/pull` | **69** | 2026-07-19 → 2026-08-13 |
  | `/api/sync/push` | **0** | none, ever |

  Over the same window the database refused connections **125 times across six days** (39 on
  2026-08-12), with one pull row reading `[cause: timeout exceeded when trying to connect]`.
- **The zero is evidence, not absent traffic.** `components/sync-provider.tsx` runs
  `await pushMutations(userId)` at :139 and `pullDelta` at :145 — **push first, same cycle**. Push is
  not less exposed than pull; it runs before it. So the zero means **"push cannot report"**, which is
  precisely what Q-475 describes: `pushMutations` catches per-mutation, returns 200 with the failure
  in the body, and never calls `reportServerError`. **The one table designed to catch faults that
  never reach a human has a blind spot exactly where that finding lives.**
- **Q-482 and Q-483 confirmed never triggered** — zero `22P02` rows ever, so a malformed route id has
  not reached production and the SQL-leaking 500 has never been served. Both were filed low; **do not
  re-price them upward from the local 500s alone.**
- **Q-484 latent confirmed** — `claude_ro.injuries` is **empty**; the route that accepts a 10 MB note
  has stored nothing at all.
- **Q-481 and Q-485 cannot be adjudicated from production, and one of them has a trap.** Water: 4 days
  logged, max 1000 ml — too thin for a double-count to show, so read it as the feature being unused,
  not as the replay not happening. Weight: 35 of 114 rows have steps and a NULL weight, which is **the
  expected shape** (steps daily from the ring, weight only on scale use) and **must not be cited** as
  coerced-away weights — the same trap as Q-460's "74% lack an RPE".
- **The standing constraint:** `claude_ro` is row-scoped to one user and `error_events` prunes at 30
  days. Every count is *the owner's, recently* — a zero means the owner never hit it, never that no
  user did. Push *traffic volume* could not be measured directly; the argument that push runs is from
  the call site, not a counter.

### [workouts][devices] 🟠 The outbox enqueue for a workout is the only write in the app that fails silently — and it is the last line of defence (Q-486, 2026-08-18)

> **⚠️ THE CODE HALF SHIPPED 2026-08-24 (v1.346.0) — the device check is what is left.** All four
> sites route their rejection through `reportEnqueueFailure` (`lib/local-store/dead-letter-signal.ts`):
> a `console.warn` matching the one already above them, plus a Tier-A toast naming what was lost.
> Control flow unchanged. **The entry's "light the dead-letter badge" was wrong and was not followed**
> — the badge counts outbox ROWS the Data & Sync card can retry or discard, and a throw leaves no
> row, so it would show a count that card could neither explain nor clear. **The row stays because
> the failure still cannot be induced here** (last bullet): the fix is read, not observed.
> [`journal`](docs/overview/entries/2026-08-24-tier-a-enqueue-visibility.md).

- Sweep 18's pattern (*this app validates well and tells you badly*) at its most consequential
  surface: a **write** that fails and reports success.
  [`review`](docs/reviews/2026-08-18-tier-a-enqueue-silence.md).
- **Say the good part first, because it sets the size.** The log path is well layered:
  `logWorkoutLocally` writes locally first **and logs its own failure**, and the **primary** send is
  a direct `POST /api/log-exercise` deliberately *"independent of the on-device outbox / sync-push
  path (which can fail silently)"*. The enqueue is only the **fallback** — not a write with no
  outbox, a good write whose last layer was silent.
- **Four sites swallowed, the only four in the app that did** — `workout-screen.tsx` ×2
  `workout_log`, ×2 `complete_workout`, all **Tier-A**. **It can throw:** `queueMutation` is a bare
  `runSQL` INSERT, so it fails whenever the local DB is unavailable — which this file records as
  having happened **twice** on Android, plus partial-migration and `disk_full`.
- **The sequence that loses a set:** the POST fails (offline — the case the fallback exists for) *and*
  the local store is broken. Then the set is not sent, not queued, not recoverable, **nothing is
  logged**, and `hapticLight()` + `setLoggedCount(c => c + 1)` have already told the user it worked.
- **NOT reproduced and cannot be here:** inducing it needs a broken local SQLite on a device; in the
  web sandbox `getLocalStore` returns null so the enqueue never runs at all. **On-device is the only
  real verification.**

### [body][platform][devices] 🟡 An implausible weight is refused on web and discarded without trace on the device path (Q-485, 2026-08-18)

- **`CLAUDE.md` says "sync-push must mirror the web route" and the push branch's comment claims it
  does. Nobody had sent the same out-of-range value down both paths.**
  [`docs/reviews/2026-08-18-implausible-value-silent-drop.md`](docs/reviews/2026-08-18-implausible-value-silent-drop.md).
- **Measured** (`weightKg: 10000`, bound 500): web → **400** `{"error":"Too big: expected number to be
  <=500"}`; sync push → **200** `{"processed":1,"errors":[]}` with the row written, `steps` kept and
  `weight_kg` NULL.
- **The drop is invisible in all three places it could be recorded:** `errors: []` so the client
  confirms and deletes the mutation, **no** `console.*` in the coercion block, and **no**
  `error_events` row (verified by query).
- **The bounds are not the problem and must not be "fixed".** Both paths import the same
  `packages/shared/src/validation/body-metrics.ts` — `One Formula, One Place` holding. The comment
  claiming the mirror is accurate about *bounds*; it does not describe *behaviour*.
- **The same function already has the visible behaviour, on 2 of 14 checks.** 12 sites coerce
  silently (weight, bodyFat, calories, macros, steps, distance, RHR, HRV, water, measurements); 2
  throw (`waterMlDelta`, `sleep_session`), which become `errors[]` entries and reach the More-tab
  dead-letter badge. Both throws are defensible; the open question is why **weight** — the headline
  body metric — is in the silent group.
- **⚠️ The fix is NOT "throw everywhere".** A throw quarantines the mutation, which the poison-pill
  rule forbids for a validation failure; twelve new dead-letter paths would trade an invisible failure
  for red badges the user cannot act on. Recommended order: (1) log the coercion server-side — one
  line, no client change, worth doing regardless; (2) a `warnings[]` channel separate from `errors[]`
  that the client can surface without dead-lettering; (3) a per-field product decision on
  incomplete-vs-meaningless, which an implementer should not make in passing.
- **Reachability is low and stated as such:** bounds are generous, so ordinary UI input never trips
  them. The path that reaches it is the one the code comment already names — *"a corrupted local
  payload"* — plus a misreading BLE scale.
- **Not verified on:** the APK; the client half was read from `sync-engine.ts` rather than induced.

### [platform][body][nutrition] 🟡 The create routes nobody gave a schema — a 10 MB note is accepted where the edit path caps it at 1,000 (Q-484, 2026-08-18)

- **`CLAUDE.md` says oversized input is "a rejection, not a skip". Nothing had tested it.**
  [`docs/reviews/2026-08-18-unvalidated-create-bodies.md`](docs/reviews/2026-08-18-unvalidated-create-bodies.md).
- **Measured:** `POST /api/injuries` with a 200 kB `muscleName` + 500 kB `notes` → **201**, both stored
  in full; `POST /api/supplements` with a 300 kB `name` → **201**; and a **10 MB** `notes` → **201**,
  10,000,000 characters stored. No ceiling found below 10 MB.
- **⚠️ Do not quote 10 MB as a storage figure.** `pg_column_size` read ~120 kB because the payload was
  one repeated character and TOAST compressed it; real text would not. What is defensible: the
  transfer and parse cost is unbounded, and stored size is bounded only by what the content compresses
  to.
- **The asymmetry is the finding.** For the same table and fields, `PATCH /api/injuries/[id]` runs
  `InjuryPatchSchema` (`muscleName max(100)`, `notes max(1000)`, `startedDate` regex) while
  `POST /api/injuries` does `const body = await req.json()` and destructures. **`CLAUDE.md` names
  `updateInjury` as the reference for whitelisting a PATCH body** — it is a good reference, and the
  create path beside it has no schema at all, which is probably why nobody looked.
- **The unvalidated `startedDate` also 500s** — `{"startedDate":"not-a-date"}` → 500,
  `{"startedDate":"0001-01-01"}` → 201 accepted. Same class as Q-482, same root cause, fixed by the
  same change.
- **Scope, read carefully: 33 body-bearing routes call `req.json()` with no schema parse — a
  *candidate* count, not a defect count.** Several do hand-rolled checks, several are admin-gated.
  **Two** were confirmed by probe; the other 31 are unaudited and should be treated as neither broken
  nor fine.
- **Severity low today and the reason to fix is not attack** — this app's users are its own account
  holders. It is filed because the session-start **database-size ritual** and the 2026-08-17
  `disk_full` outage exist precisely for unbounded growth, because the stated direction is multi-user
  and a Play Store listing, and because `InjuryPatchSchema` already encodes the intended bounds so the
  fix is a few lines.
- **Two clean results:** the PATCH/PUT edit paths are properly bounded wherever checked; and the
  163-vs-31 `z.string()`-with-`.max()` ratio is **not** a finding and must not be quoted — most
  unbounded `z.string()` under `app/api` are **AI output schemas**, not request bodies.

### [platform] 🟠 A route id that is not a UUID reaches Postgres — and three routes reply with the SQL (Q-482, Q-483, 2026-08-18)

- **The third case, after "another user's id" (protection holds) and "valid but missing" (Q-463):**
  an id that is not a UUID at all. All 30 dynamic route files, every method, called twice — once with
  a well-formed-but-nonexistent UUID as the **control**, once with `not-a-uuid`. 39 pairs.
  [`docs/reviews/2026-08-18-malformed-route-ids.md`](docs/reviews/2026-08-18-malformed-route-ids.md).
- **Q-483 is the sharp one.** `GET /api/workout-sessions/not-a-uuid/recap` answers **500** with the
  stringified driver error — the complete `SELECT` and every column name of `workout_sessions`. It is
  the route's **own** catch (`NextResponse.json({ error: errMsg })` where `errMsg = errorLog(error, …)`),
  and `errorLog` has **no environment check and no redaction**, so it ships in production exactly as
  here. Three routes leak (`workout-sessions/[id]/{recap,energy,timing}`); a fourth
  (`session-explain/insight`) carries the pattern but is guarded upstream today. Disclosure is to an
  **authenticated** user, so not an anonymous hole — but it publishes table structure nothing else
  exposes, and `reportServerError` is already called on the line above, so redacting the response
  costs no diagnostics.
- **Q-482 is the breadth.** 22 of 39 pairs returned 5xx; one is already Q-463, leaving **21 new pairs
  across 14 routes** (coach undo, friends, injuries, food-logs, meal-plans ×3 + review + structure +
  meals, meal-types, saved-meals, supplements ×2 + log ×2, workout-review, and the three
  workout-sessions GETs). Postgres rejects the cast with `22P02`. **Only 2 of the 30 dynamic route
  files validate the id as a UUID at all.**
- **The control is what makes it a finding:** every one of those routes answers a well-formed missing
  id correctly (404, or an idempotent 200/204). Only the malformed id breaks them — a missing input
  guard, not a broken route.
- **Not a security hole.** A malformed id cannot read anyone's data: Postgres refuses the cast before
  any row is touched and every route is `auth()`-scoped. It becomes a disclosure problem only where it
  meets Q-483, which is why that is queued above it.
- **⚠️ Reading the evidence:** a **500 is conclusive**; a **400 is not** — the probe sent `{}`, so a
  body-bearing method may have failed its body schema before the id was used. Routes absent from the
  table are only verified-correct if they are GET or DELETE.
- **Fix shape:** a shared `parseUuidParam(id)` returning 400, the same precedent as
  `normalizeDateParam` for date params, plus a Custom Rules step requiring it in new `[id]` routes.
- **Observability needs no work:** every fault reached `error_events` tagged `[pg 22P02]`, via
  `reportServerError` or `onRequestError`.

### [platform] ✅ FIXED 2026-08-23 — A revoked admin keeps one write for up to 24 hours, and the module docstring says it cannot (Q-479, 2026-08-18)

- **Resolved by #124, merged by the owner 2026-08-23.** This is Review's original finding; the
  Lane A row higher up this file carries what shipped and what is still owed (production was not
  exercised). Everything below is the finding as measured, kept for the measurement.
- **The first sweep to test privilege *revocation* rather than cross-user data isolation.**
  [`docs/reviews/2026-08-18-auth-session-boundaries.md`](docs/reviews/2026-08-18-auth-session-boundaries.md).
- **`lib/admin.ts` holds two admin checks that disagree.** `requireAdmin` takes an `_isAdmin`
  argument and deliberately **ignores** it, reading the row every call — **61 API routes** use it, and
  revocation is immediate on all of them. `isAdminUser` **returns the passed flag** when given one.
  Seven of its ten call sites pass the JWT claim; six are page guards (UI, correct), and the seventh
  is **`app/api/exercises/route.ts:38`**, an API write into `exercise_library` — the catalogue every
  user reads.
- **The claim refreshes once a day.** `ISACTIVE_RECHECK_MS = 24h` in `lib/auth/is-active-refresh.ts`,
  a sound throttle. What is not sound is its docstring: *"This governs the **UI** only: `requireAdmin`
  … never trusts this claim."* That is false, and it is why this was easy to miss — a reviewer who
  reads it stops looking. **The wrong comment is more dangerous than the wrong call, because it
  scales to the next admin route someone adds.**
- **Measured with a control**, admin revoked in the DB with no re-login and cookie rotation persisted
  as a browser does: `POST /api/exercises` → **201** (row created) while `GET /api/admin/errors` →
  **403**, same cookie, same instant. Session claim still read `isAdmin: True`.
- **Severity moderate-low and stated as such:** what a revoked admin gains is rows in a catalogue —
  no health data, no other user's rows, no credentials. It is filed because it is privilege
  persistence with a working proof of concept and the fix is deleting one argument.
- **Five clean results recorded:** all 61 `requireAdmin` routes DB-check; the six page guards are
  genuinely UI and should NOT be "fixed"; `/api/health-connect/ingest` fails closed with its secret
  unset *and* on an empty secret, with an IP limiter before a constant-time compare and an identical
  401 body — the reference implementation for the fail-closed rule; both bearer paths
  (`day-review`, `db-query`) fail closed on partial config; and the claim-refresh module itself is
  careful (a missing row is not deactivation, a failed lookup does not advance the timestamp, a DB
  blip cannot sign everyone out).
- **⚠️ Method note worth more than the finding.** The first run of this test reported revocation
  **working** and was wrong: `curl -b` without `-c` discards the rotated cookie, so every request
  re-sent a token with no `isActiveCheckedAt`, the throttle never engaged, and the DB was re-read
  every time. **A session-staleness test is meaningless unless the client persists cookie rotation.**
- **Not verified on:** the APK or production; `ISACTIVE_RECHECK_MS` is read from source, not observed
  over a real 24-hour window.

### [platform] ✅ The empty account and the n=1 account are clean — and the probe that said so was invalid until it was fixed (2026-08-18)

- **All 126 static GET routes driven twice** — as an account with zero rows in every domain, then with
  exactly one `body_metrics` and one `sleep_sessions` row.
  [`docs/reviews/2026-08-18-empty-and-single-datapoint-accounts.md`](docs/reviews/2026-08-18-empty-and-single-datapoint-accounts.md).
- **The method correction is the point of the entry.** The probe grepped response bodies for `NaN`
  and `Infinity`, came back clean twice, and **could not have detected either** — both serialise to
  `null`, indistinguishable from a legitimate no-data null. **Never run a numeric-corruption check
  against a serialised JSON body**: audit the divisions, or use a differential (numeric at n=many,
  `null` at n=1 while its input exists).
- **By the correct method — auditing every mean-style division across `app/api`,
  `packages/shared/src` and `lib/health` — there is no unguarded division.** The four that look
  unguarded from a grep each carry an early return immediately above (`health-trends:111`,
  `cardio-week:24`, `oura/hr-window:61`, `admin/program-export:51`); the rest are ternary-guarded.
- **No route changed behaviour between zero data and one data point** — the useful half of the sweep.
  Identical status distribution across both runs: 76–77 × 200, 33 × 403, 11 × 400, 2 × 404, 3 × 5xx.
  All three 5xx are environmental and unchanged: `/api/download-apk` 502 (GitHub unreachable from the
  sandbox), `/api/push/subscribe` 503 (VAPID unset), `/api/oura-ble/decoder-constants` 500 with an
  empty body (the vendored constants are deliberately absent from the public repo). The last was
  **deliberately not filed** — `isUsable()` exists precisely to reject an error-shaped payload.
- **`onRequestError` verified working** — it caught the bodiless 500 and wrote the `error_events` row
  with the exact message, so it does what its comment claims for the ~80 catch-less routes.
- **Not verified:** the APK, production, or the dynamic-segment (`[id]`) routes, excluded by design.

### [nutrition][platform] 🟠 A water quick-add replayed by the outbox triple-counts — the one non-idempotent mutation of nineteen (Q-481, 2026-08-18)

- **The gap between sweeps 9 and 10**: concurrent writes were measured, and the outbox under failure
  was measured, but not the same mutation arriving **twice in sequence** — which is what at-least-once
  delivery guarantees will eventually happen.
  [`docs/reviews/2026-08-18-outbox-replay-idempotency.md`](docs/reviews/2026-08-18-outbox-replay-idempotency.md).
- **Measured:** one mutation id pushed three times → `water_ml = 750` for 250 ml logged, every push
  answering `{"processed":1,"errors":[]}`. The server keeps **no record of processed mutation ids**.
- **Reachable by ordinary means on the canonical runtime.** The client wraps its push in
  `try { await fetch(…) } catch { break }`, so a request that **reaches the server and commits** but
  whose response is lost — signal drop, OS killing a backgrounded app, timeout — leaves the mutation
  `pending` with nothing marking it in-flight. The next sync re-pushes it. On a phone on mobile data
  that is routine.
- **The write is correct and must not be "fixed".** `incrementWaterLog` adds inside the upsert and the
  push branch routes to it deliberately (SYNC-P7: *"an increment, not an absolute set … so concurrent
  adds sum instead of last-writer-wins clobbering"*). Atomic-and-additive is right for concurrency and
  is exactly what makes a replay wrong; an absolute total reintroduces the clobber it was written to
  prevent. The fix is **mutation-id dedupe for this one branch**, not a change of semantics.
- **Bounded:** all 19 push branches enumerated, and this is the only non-idempotent one — every other
  domain upserts on `(user_id, date)` or a client-supplied row id.
- **Three clean results, one of them load-bearing:** `complete_workout` replayed 3× → counter = 1,
  which is the **second independent confirmation of the Q-473 fix** and covers the vector its original
  comment named (an outbox mutation re-pushed after its response was lost); absolute `body_metrics`
  is idempotent; and `activity_logs` replayed 3× gives **one** row — which looks like it contradicts
  sweep 9's "5 concurrent → 5 rows" and does not: **different writers**, the web route minting a
  server-side id and the outbox carrying a client-generated one.
- **Not verified on:** the APK. The replay was simulated by re-posting the same envelope (what the
  client does); the client-side trigger was read from source, not induced.

### [app-shell][platform] 🟠 The app run as a user who is not in Brisbane: the server follows their timezone, 100 of 125 client call sites do not (Q-477, Q-478, 2026-08-18)

- **The blind spot `CLAUDE.md` names, entered for the first time.** All 30 user rows in the local DB
  are `Australia/Brisbane`, and ten review sweeps had never moved a user out of the default zone —
  *"invisible while the device sits in the zone the data was recorded in"*, exactly as written. This
  sweep set a user to `Pacific/Kiritimati` (UTC+14), re-logged in so the JWT carried it, and drove the
  app at a moment when three calendar dates were simultaneously live (Midway 08-17, UTC/Brisbane
  08-18, Kiritimati 08-19). [`docs/reviews/2026-08-18-timezone-non-default-user.md`](docs/reviews/2026-08-18-timezone-non-default-user.md).
- **The server is clean and that is worth stating.** `app/api/**` contains **zero** argument-less
  `todayInTz()` calls — 53 `todayInTz(tz)`, 4 from the session, 4 `formatInTimeZone(..., tz, ...)`.
  Live: `POST /api/day-checkin` → `logDate: 2026-08-19`; `GET /api/workout-data` →
  `dataDate: 2026-08-19`. Both correct. Every finding here is client-side.
- **The inversion that sets the severity.** While a user is on Brisbane, client and server agree and
  nothing is wrong — which is why this has never surfaced. **Setting the timezone is what breaks it:**
  the server moves, the client's 91 argument-less `todayInTz()` calls do not.
  `edit-profile-sheet.tsx:190` ships an **"Auto-detect timezone"** button, so the intended one-tap
  action for any user outside Brisbane is precisely the action that desynchronises them.
- **Observed on screen** (Health → Training): the Training Calendar highlights **18** and Training Load
  highlights **Tue**, on a day that was Wednesday the 19th for that user. Source is
  `calendar-widget.tsx:110`, `localDateString()` — the **device's** zone, a *third* answer following
  neither the setting nor the server. `CLAUDE.md` warns of two client "today" sources; there are three.
- **✅ Q-478 SHIPPED 2026-08-18 (v1.324.8) — the sharp, cheap half is done.** `isWorkoutDataToday` and
  `isBodyMetadataFresh` compared a **server-stamped** date to a **client `DEFAULT_TZ`** date, so they
  returned false for |Δoffset| hours a day — **14 hours a day for a New York user** — leaving Health's
  today values unset, the workout screen stripping `loggedTodayInSession` from every exercise, and the
  "Trained today" badge absent. Both now take a `tz`, all nine call sites pass one, and
  `scripts/check-tz-aware-cache-guards.js` fails Custom Rules on a call that does not.
  [`Journal`](docs/overview/entries/2026-08-18-tz-aware-cache-guards.md). Two corrections to the
  original finding, both made in place: session-select's skeleton **does** clear — a second
  unconditional `setMetaLoading(false)` runs after the await, so the cost is a round-trip-long skeleton,
  not a stuck one; and `unwrapToday`/`cachedFetchToday` were deliberately left alone (client-written,
  client-read, self-consistent). **The rest of this row — Q-477 — is still open**, including its
  ratchet on bare `todayInTz()` across client code, which this narrower check does not provide.
- **Nothing is missing except the argument.** `useUserTimezone()` is a context available tree-wide and
  `goals-section.tsx:114` already uses it correctly. In `workout-select-content.tsx`, lines 31 and 32
  sit inside a function that *takes* `tz`: line 32 uses it, line 31 cannot, because the helper has no
  parameter for it.
- **Severity, honestly: latent for the current user base, structural for the stated direction.** No
  user has a non-Brisbane zone today, so nothing is broken in production. It is filed above "someday"
  because the app ships the button that triggers it, this file's 2026-08-02 amendment says explicitly
  not to assume the owner's own device, and a Play Store listing is the stated intent. Recommended
  first step is a **CI ratchet** on bare `todayInTz()`/`localDateString()` in client code, shrink-only,
  the same shape as the hex-literal and TTL-divergence checks — freeze the count at 100 before
  sweeping.
- **Two clean results recorded:** every API route threads the user's timezone, and
  `cachedFetchToday`/`unwrapToday` are self-consistent (client-written and client-read) — mislabelled
  rather than broken, and deliberately not filed as the same defect.
- **Not verified on:** the APK — the 9 `localDateString()` sites read the *phone's* zone there, a third
  value this harness cannot reproduce. Not against production, where all users are Brisbane and the
  symptom does not arise.

### [platform][devices] 🟠 A database outage reaches the sync client as HTTP 200, so it dead-letters the whole outbox instead of backing off (Q-475, Q-476, 2026-08-18)

- **The first sweep to push a real batch at `/api/sync/push`, including one with the database
  stopped.** [`docs/reviews/2026-08-18-outbox-under-failure.md`](docs/reviews/2026-08-18-outbox-under-failure.md).
- **Say the good news first: the poison-pill rule holds.** Five mutations, poison placed third so four
  siblings sit behind it → `processed: 4`, one error keyed by outbox **id**, all four sibling rows
  written. The rule `CLAUDE.md` says cost three production incidents (#47, #74, #82) is genuinely
  enforced at both the route and the adapter. Both findings below are about what happens *around*
  that hardened core.
- **Q-475 — measured with Postgres actually stopped.** The push returns **HTTP 200** with a per-item
  error for every mutation, because `pushMutations` catches per-mutation — the same property that
  makes the poison-pill rule work. So `res.ok` is true, `consecutive5xx` is **reset rather than
  engaged**, the client keeps pushing at full cadence into a server that cannot write, and every
  mutation burns an attempt. Backoff is 30 s → 2 m → 8 m → 32 m before dead-lettering, so **≈ 42.5
  minutes of outage dead-letters every queued mutation** — an ordinary outage length, and this repo
  has recorded two.
- **Not data loss — the design holds there.** Rows are kept (`status='failed'`), the More-tab badge
  reflects them and Tier-A domains toast. The cost is that a user emerges from a transient outage with
  every pending write dead-lettered and a **per-item-only** retry UI (no "retry all"), asked to
  hand-repair a queue that was never broken. The client's own comment already states the principle
  being violated: *"Transport failures … say nothing about the mutation itself."*
- **Q-476 — the worse failure gets the softer handling.** A mutation rejected by the route's
  `MutationSchema` (unknown domain, malformed date) returns `errors: []`, which is how the client is
  told everything succeeded — so the row is **deleted**, with no badge, no toast and no way back. A
  mutation that fails one layer later, inside `pushMutations`, is kept, badged and retryable. Measured
  both ways. **Latent, not live:** all 36 `queueMutation` call sites produce a schema-valid date today,
  and the unknown-domain case needs a domain to be *removed* while devices hold queued rows.
- **The opposite policy is written in the same request path and cannot run.** `pushMutations`'
  `Unsupported domain` branch argues at length against exactly this silent drop — and is unreachable
  behind the route's `z.enum`. The layer that got it right is the one that never executes.
- **Same class as Q-548, filed the same day:** a DB outage surfacing as `{"error":"Forbidden"}` on
  `/api/admin/db-query`. Two independent routes now known to misreport a database outage as something
  else.
- **Four clean results recorded** so they are not re-run: the poison pill isolates correctly; a
  per-item failure never deletes data; an envelope-level 4xx quarantines its chunk and keeps draining;
  and the `id`-keyed confirmation is real, with the `domain:date` fallback reachable only for pre-v13
  clients.
- **Not verified on:** Railway (inducing a production DB outage is not on) or the APK. The client half
  is plain TypeScript with no native dependency.

### [workouts][platform] 🟠 Completing one workout twice at once counted it twice — Q-473 FIXED and re-verified, Q-474 still open (Q-473, Q-474, 2026-08-18)

- **✅ Q-473 shipped in #112 and was re-verified by Review against the original reproduction.**
  `completeWorkoutSession` now returns its affected-row count and `completeWorkoutFromPayload`
  derives `alreadyCompleted` from that write instead of from a read taken before it — the exact
  shape the finding recommended. **Re-measured on the merged code, same harness, four fresh trials
  of four concurrent completes: `sessions_in_phase` = 1, 1, 1, 1** (was 3, 3, 2, 1), workout
  completed exactly once each time. **Q-474 is still open**, so this row stays here rather than
  moving to the resolved archive.

- **The first sweep to actually fire concurrent writes and read the result.** `CLAUDE.md` records a
  real incident in this class (*"5 rapid taps once fired 4 `complete-workout` POSTs"*) and a standing
  **Stored Counters** rule opening *"Every stored counter in this project has drifted"* — naming
  `sessions_in_phase` as fixed three separate times. Three earlier reviews discuss races; none had
  ever measured one. [`docs/reviews/2026-08-18-write-concurrency.md`](docs/reviews/2026-08-18-write-concurrency.md).
- **Q-473 — reproduced in 4 of 5 bursts.** Four concurrent `POST /api/complete-workout` for **one**
  workout session: all four return `200`, `completed_at` is stamped on exactly one row (that UPDATE
  *is* guarded), and `sessions_in_phase` lands on **3, 3, 2, 1** across four trials. The idempotency
  decision is taken from a read that happens *before* the guarded write, so every request that read
  first believes it is first. The function's own comment promises the opposite: *"Idempotent: a
  retried/replayed completion … must not … double-increment the sessions_in_phase stored counter."*
- **Why it is 🔴 and not 🟠:** `sessions_in_phase` advances the periodization phase, so an over-count
  moves the lifter into the next phase — and into a deload — **early, off a session never trained**.
  Nothing reconciles it against `workout_sessions`, and the workout row itself looks perfect, so the
  only symptom is "my programme advanced too soon". The outbox replay path calls the same shared
  function, which is precisely the case that comment names.
- **The fix already exists in the same file's neighbourhood.** `upsertPersonalRecordIfBetter` does the
  same read-then-conditionally-write correctly (`db.transaction` + `SELECT … FOR UPDATE`). Cheaper
  still, and it is `CLAUDE.md`'s own write-path rule (a): return the guarded UPDATE's affected-row
  count and decide from that. The count is currently computed and thrown away.
- **Q-474 — the trap that nearly buried it.** `workout_sessions` carries **two** FKs to
  `program_sessions`: the live `session_id` and a dead `program_session_id` (migration 079, **zero**
  code references, 0 of the owner's 91 prod rows populated). The dead column owns the name the live
  one is used under — `getWorkoutSessionProgramSessionId()` reads `session_id`, and
  `ensureWorkoutSession`'s `programSessionId` argument is written to `session_id`. The first Q-473
  repro populated the dead column, the periodization block silently skipped, and the honest reading
  of that run was *"the race does not exist"*. It does.
- **Four clean results recorded** so they are not re-run: `day-checkin` is idempotent under
  concurrency (5 → 1 row), `completeWorkoutSession`'s own UPDATE is correctly guarded,
  `upsertPersonalRecordIfBetter` is correctly locked, and the phase-`transition` route is idempotent
  by construction. `activity-logs` duplicates freely but every caller holds an in-flight guard, so it
  was deliberately **not** filed.
- **Not verified on:** production (correct — this writes), the APK, or a multi-replica deployment.
  Measured on local `pnpm dev`, a single node; more replicas widen the window rather than narrow it.

### [platform][workouts][cardio][nutrition] 🟠 The AI-usage screen's double-trips traced to cause — the top row is an artefact, two rows are real (Q-469…Q-471, 2026-08-18)

- **First production-data finding of this review run.** The owner supplied three screenshots of
  **More → Developer → AI usage**: 30 days, 268 calls, 651,639 tokens, **$0.09**, 2 failures, and
  **89 redundant calls (33%)** across five sections. Traced through
  [`docs/reviews/2026-08-18-ai-double-trips.md`](docs/reviews/2026-08-18-ai-double-trips.md).
- **Cost is irrelevant here and should stay that way.** $0.09 per 30 days — eliminating every
  redundant call saves a fraction of a cent, and `CLAUDE.md` already records the decision not to
  optimise AI spend. These are filed for **latency and content consistency**, and three of the five
  sections are *generative*, so a repeat returns different content rather than the same answer twice.
- **🟠 Q-471 — the screen's most alarming row is a measurement artefact.** Redundancy is
  `(user_id, section, fingerprint)` repeating within 120 s, and three sections fingerprint on a
  **calorie target alone**. Rerolling a meal is the feature working, and every reroll carries the same
  rounded target — so `meal-plan-generate-meal`'s "32 redundant · 4 distinct" most plausibly reads as
  four slots rerolled ~8 times each. **The reroll path is already correctly guarded**
  (`disabled={rerolling != null}` on every control), so an implementer sent there by the screen would
  find nothing to fix. **44 of the 89 are artefact; 45 are real.**
- **🟠 Q-470 — the prescription regeneration double-fires for real.** It fingerprints on
  `{ programSessionId, today }`, so 14 redundant / 8 distinct is the same logical prescription
  generated twice. `regeneratePrescriptionInBackground` is fire-and-forget from two sites in
  `GET /api/workout-data`, with a rate limit but **no in-flight guard** — and `cachedFetch` always
  revalidates over the network, so every screen open issues a real GET while the triggering condition
  is still true. The rate limit is not the bug and should stay.
- **🟡 Q-469 — `running-plan-explain` re-asks on every card mount.** 31 redundant / 9 distinct, from a
  bare `useEffect` with no cache. The author had already fixed the re-render case (the `gateKey` join);
  mount is the remaining trigger. Not load-bearing — the deterministic rationale renders immediately —
  but the **wording changes between mounts**, so the same run reads differently each visit.
- **✅ Two prior findings corroborated by production, and one reaffirmed.** **Q-295 holds exactly** —
  Coach is 17 of 268 calls (6.3%) and 330,221 of 651,639 tokens (50.7%), ~19,400 tokens/call.
  **Q-170's latency fix is holding** — the 30-day Coach average of 5,840 ms looks like a regression but
  the 7-day window reads **2,307 ms**, better than the 3.5 s the fix claimed; **do not reopen Q-170 on
  the 30-day number**. And the error rate is 2/268 (0.7%), unremarkable on this evidence.
- **Limits:** one user's account over the window shown, and the call sites were read rather than driven
  — nothing here was reproduced locally.
- **Nothing was fixed.** All three are queued.

### [app-shell][workouts][platform] 🟠 The AI Coach's write path reviewed for the first time — apply is exemplary, undo is unreachable and wrong (Q-467, Q-468, 2026-08-18)

- **Never reviewed before.** The Coach appears in eight prior review docs and five backlog entries —
  all about cost, latency, model ID and navigation. **No review document mentions `coach_changes`,
  `applyCoachChange` or the undo mechanism**, verified by grep across `docs/reviews/`. It is also the
  only place an LLM-initiated flow writes to the data deciding what the user is told to lift: five
  domains — `session-exercise`, `goals`, `injury`, `program-phase`, `early-deload`. Full write-up:
  [`docs/reviews/2026-08-18-coach-apply-path.md`](docs/reviews/2026-08-18-coach-apply-path.md).
- **✅ The apply path is a model of how to do this, and is recorded at length so it stays that way.**
  The model is never in the write path (documented, with the reason the SDK's binary tool-approval was
  rejected); `fieldsMatchDomain` stops a model aiming a calorie field at an exercise row; ownership is
  by join where the table has no `user_id`; the boundary is Zod-whitelisted with `CLAUDE.md` rule (b)
  quoted back at itself; creating a shared-catalogue exercise is admin-gated with the policy reason
  written down; a merged-away catalogue row cannot be resurrected; a bad swap fails the whole apply
  rather than half-applying. **Double-apply is refused** — a repeated patch returned `409` with a
  per-field drift report — and **cross-user undo returned 404**.
- **🟠 Q-467 — the Coach can change your programme and nothing in the app can undo it.** The entire
  undo subsystem is built: the route with a well-reasoned "until the next workout started after the
  change" window, `undoCoachChange()`, an `undo()` handler in all five domains, `captureBefore()`
  existing solely for it, the `undone_at` column, and `coach-history.tsx` **already styling undone
  changes** with strikethrough and a "· undone" suffix. **Nothing calls it** — every client fetch to a
  Coach endpoint was enumerated and the undo path appears in none. ⚠️ **Not** the known "no
  user-facing entry point" note: that is about phase 1's *apply* path, which phases 2–3 wired and
  which works. Undo was never wired with it.
- **🟠 Q-468 — and when it is wired, it will restore stale state.** `apply` refuses to write over a
  moved target (`driftAgainst` → 409); `undo` has no equivalent and writes `beforeState` back blindly.
  Measured entirely within the Coach's own flow: apply A (Barbell→Dumbbell), apply B
  (Dumbbell→Incline), **undo A** → the row becomes **Barbell** while `coach_changes` still shows B as
  `NOT UNDONE`, so the history contradicts the data. Then **undo B** → the row becomes **Dumbbell**.
  Undoing *every* Coach change leaves the programme holding a value the user never chose, not the
  original. All five domains share the gap. **Do Q-468 with or before Q-467** — wiring the button onto
  today's undo would ship the defect.
- **NOT device-verified**, web build only. **The model was never in the loop** — every patch was
  hand-written, which is the right way to test a path designed to keep the model out of it, but means
  nothing here says whether the model *proposes* good patches. Only `session_exercise` was driven end
  to end; the other four handlers were read. `/api/coach/preview` was not probed. The local DB was
  restored afterwards.
- **Nothing was fixed.** Both are queued at the top.

### [nutrition][app-shell] 🟢 Printable saved-meal labels shipped (Q-389) — TWO owed checks, both physical (2026-08-18, v1.320.0)

- **⚠️ Owed 1 — the print test, and it is a real gate not a formality.** The code is **25×25
  modules**. **Re-measured 2026-08-18 and finer than first recorded**: the quiet zone is drawn
  *inside* the code box, so the printed pitch divides by 33, not 25 — `band` is **0.369 mm**, not
  0.487. **The default is now `inlineCentred` at 0.401 mm** (Q-399, v1.325.0 — retuned down from a
  briefly-shipped 0.529 that left no room for the ingredient list it promised). **Print the default
  and `band` and scan both**: `band` is the tightest, and the default is what every label uses. Ink
  spread on a home printer merging fine modules is the expected failure, and it will present as "the
  scanner doesn't work" rather than as a print problem. The preview sheet prints the measured
  mm-per-module under the label so the number is visible rather than assumed.
- **⚠️ Owed 2 — the scan-back on device.** QR decoding runs through the Capacitor plugin, which is
  inert in the sandbox, so **the scan branch has never executed against a real camera.** The decode,
  the meal lookup and the logging are unit-tested and the label half is E2E-guarded; the camera path
  is not.
- **Delivery is Web Share, not a Capacitor plugin** — deliberate, because `@capacitor/share` would
  have meant a new APK. `navigator.share({files})` reaches the system sheet (where a print app
  lives); `<a download>` is the browser fallback. **The share path is also device-unverified.**
- The label prints **per-serving** figures and scanning logs **one serving** — asserted against each
  other in one unit test, because that is the pair that would otherwise drift.
- **⚠️ The default drew ZERO ingredient lines for a release** (v1.324.0–v1.324.6) and nothing failed:
  the sheet's "Printing N ingredients" copy was gated on `> 0`, so the one reading worth having
  removed itself, and the only test on that style asserted the code's *size*. Fixed in Q-399
  (v1.325.0) — three wrapped lines, the budget derived from the gaps the painter draws, the line
  count asserted in CI, and a zero now reported loudly instead of silently.
  [`Journal`](docs/overview/entries/2026-08-19-label-line-budget.md).

### [readiness][sleep][heart-rate][body][devices] 🟢 The ingest surface reviewed — auth model and value validation both sound; two schema gaps (Q-464, Q-465, 2026-08-18)

- **Why a different lens.** These five pillars barely expose `[id]` write routes — they are
  read-and-derive, and their writes arrive through **ingest** and **sync**, so the write-surface lens
  used for workouts and nutrition does not reach them. Full method and limits:
  [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](docs/reviews/2026-08-18-ingest-and-input-validation.md).
- **✅ No ingest route accepts a `userId` from the request body.** All ten checked derive identity from
  the session, or — for `health-connect/ingest` — from a shared secret plus `WEBHOOK_USER_ID`; two
  additionally sit behind `requireAdmin`. **There is no route where a caller can name whose data they
  are writing.**
- **✅ Value validation rejects physiologically impossible input and nothing landed in Postgres.**
  Heart rate `-50` and `99999`, mood `999` and `-5`, body weight `99999` and `-40`, and a malformed
  scale frame were all `400`. The weight messages name the bound violated (`"Too big: expected number
  to be <=500"`) rather than saying "invalid". `CLAUDE.md`'s ingest-schema rule is being followed on
  every route reachable here.
- **🟡 Q-464 — request schemas are almost never `.strict()`.** Of **70** files defining a `z.object`
  request schema, only **6** call `.strict()`, so Zod silently drops unknown keys. Demonstrated on
  `POST /api/body-metadata`: `{"date":"2026-08-10","weightKg":81}` wrote weight 81 to **today** and
  returned `{"success":true}` — the route correctly reads `localDate` and defaults to today, and the
  non-strict schema is what turns a wrong key into a silent wrong-day write. **Not reachable from the
  app's own clients**; filed because the repo already lost a full release to this class (the `ai-chat`
  `localDate` regex). Eleven date-bearing write schemas are non-strict — but **`sync/push` needs care**,
  since older-APK outbox payloads may carry fields the current schema does not name.
- **🟡 Q-465 — `POST /api/day-checkin` creates a row from a completely empty body** (201, every metric
  null). **The consequence is unproven and the entry says so**: both consumers were checked and neither
  shows a user-visible bug. Worth closing anyway because the row is indistinguishable from a check-in
  where the user answered nothing, and readiness is the pillar where "told us nothing" and "told us
  neutral" must not collapse.
- **NOT device-verified,** and `health-connect/ingest` was **read but not called** — it is
  secret-gated and its validation is unverified by this sweep. The Oura BLE sample routes were not
  exercised with real frames. Screens for these pillars are not re-reported: all five rendered clean in
  the 2026-08-17 failure-cells sweep.
- **Section coverage is now complete for this run** — every pillar reviewed at least once:
  workouts (Q-460…Q-462) · nutrition/cardio/activity (Q-463) · sleep/readiness/heart-rate/body/devices
  (Q-464, Q-465) · app-shell/platform (Q-450…Q-459). Still open by design: the **device runtime**
  (nothing left the web build), **production data** (`claude_ro` never queried), and the
  **offline/error paths**.
- **🟡 Q-466, found while landing these PRs rather than by the probe:** CI re-downloads the Playwright
  browser on every E2E run with no cache, and a slow CDN turns that into an indefinite stall — observed
  **three times on 2026-08-18**, each costing a cancel-and-re-run cycle on a **required** check. `actions/cache`
  on `~/.cache/ms-playwright` is the standard fix.
- **Nothing was fixed.** All three are queued.

### [platform][nutrition][cardio][activity] 🟠 Nutrition/cardio/activity writes probed cross-user, and the whole write surface measured for one question (Q-463, 2026-08-18)

- **Two halves.** The nutrition/cardio/activity mutations probed cross-user exactly as workouts were;
  then — because the workout sweep's Q-462 looked like it might not be a one-off — **every dynamic
  write route in the app** called with a fabricated UUID to ask one question uniformly: what happens
  when the row you named does not exist? 33 endpoints answered. Full tables and limits:
  [`docs/reviews/2026-08-18-write-surface-not-found.md`](docs/reviews/2026-08-18-write-surface-not-found.md).
- **✅ Cross-user protection holds here too.** Nine mutations by a second live account against the
  owner's real rows, with the owner's rows re-read from Postgres afterwards: the supplement is still
  `Creatine`, the food log still `1.5`, the meal type still `Breakfast`, the activity log still alive.
  **Combined with the workout sweep, every workout, nutrition, cardio and activity mutation reachable
  in this harness has now been probed cross-user, and none leaked or destroyed another user's row.**
  A control ran for every probe — four of them returned bodiless 500s that looked like faults, and the
  controls returning 200 are what established those were genuine rejections rather than my bad payloads.
- **🟠 Q-463 — the not-found answer is inconsistent, and five routes give it as a 500.** `PATCH
  /api/injuries/[id]`, `PUT /api/nutrition/meal-types/[id]`, `PATCH /api/supplements/[id]`, `POST
  /api/supplements/[id]/log` (all four with an **empty body**) and `DELETE /api/phase-sets/[id]` —
  plus `/api/log-exercise`, already filed as Q-462, which this generalises. One cause: **16 bare
  `throw new Error('… not found')`** in the repository layer with nothing mapping them at the route.
  `PUT`/`DELETE` on `phase-sets/[id]` return **400 and 500** for the same condition with the same
  message; neither is 404.
- **Why it is not cosmetic.** A 5xx tells the sync client to **back off and retry** a mutation that can
  never succeed (`CLAUDE.md`'s poison-pill rule classifies by status); an empty-body 500 makes the
  client's `res.json()` throw on top of the original failure; and every correctly-refused request
  writes a stack trace into **`error_events`**, the one fault view nobody watches, which prunes at 30
  days and is read at every session start. `/api/nutrition/meal-plans/*` is the in-repo reference —
  all five of its write endpoints already return a clean 404.
- **✅ Recorded as clean rather than filed:** the seven `DELETE`s returning 200/204 for an absent row
  are **defensible** — `DELETE` is idempotent by convention, the desired end state holds, and the
  outbox is right to treat it as done. That is what distinguishes them from Q-460, where the desired
  end state was a stored RPE and it did **not** hold. Written down so the benign half of the pattern
  is not filed later.
- **✅ The nutrition screen renders and reads correctly** — day totals, the water figure reflecting a
  write made through the API minutes earlier, meal sections and per-meal macros, with zero page
  errors, zero console errors and zero failing `/api/` responses.
- **NOT device-verified.** Web build only. The 12 endpoints that returned 400 did so from body
  validation *before* the id lookup and are **excluded as evidence** rather than counted as correct.
  The meal-plan generation, running-plan write and barcode/scan paths were not exercised.
- **Nothing was fixed.** Q-463 is queued directly above Q-462, the instance it generalises.

### [workouts][platform] 🟠 The workout write path probed cross-user for the first time — protection holds; a silent dropped write and an un-automatable core flow (Q-460…Q-462, 2026-08-18)

- **The lens.** Every prior sweep of this pillar read the model (1RM, RPE, autoregulation, deload) or
  swept `GET`. Nothing had probed the **mutations** — and `exercise_logs` and `set_logs` have **no
  `user_id` column**, so every write that touches them depends on someone remembering to join up to
  `workout_sessions`. Method, limits and the full tables:
  [`docs/reviews/2026-08-18-workout-write-path.md`](docs/reviews/2026-08-18-workout-write-path.md).
- **✅ The headline is the clean one: cross-user write protection holds.** A second live account
  called every workout mutation against the owner's real row ids, and the owner's rows were re-read
  from Postgres afterwards: `PATCH`/`DELETE /api/workout-entry` → **404**, `DELETE
  /api/workout-sessions` → **404**, `/api/log-exercise` → **refused**, `ai-periodization/prescribe` →
  **404**. Nothing crossed accounts. `workout-entry`'s `assertOwnership` is the documented
  join-to-`workout_sessions` pattern done right. **A control was run for every probe** — the same call
  by the owner on their own row returned 200 and actually changed the weights — because a 4xx proves
  nothing if the body was malformed. That control caught one of my own probes being wrong mid-sweep.
- **🟠 Q-460 — the session-RPE route reports success for a write that matched nothing.** A fabricated
  session UUID returns `{"success":true}`. The security half is correct (the UPDATE is user-scoped and
  matched zero rows); the missing piece is the affected-row check. **On device this is worse than a
  wrong status code:** `pushMutations` does `setSessionRpe(...)` then `processed++` unconditionally, so
  an RPE whose session row is absent server-side is **counted as processed and removed from the
  outbox** — local keeps it, the server never gets it, nothing retries.
- **🟠 Q-461 — the workout flow cannot be automated past set 1.** `Start Set 2` carries an infinite
  `animate-bounce`, so Playwright's stability check never passes and the click hangs to the test
  timeout (`animationIterationCount: infinite`; normal click blocked at 8 s; `force: true` clicks and
  advances). **Not a user-facing defect** — a human taps a bouncing button fine. It matters because the
  harness built to catch regressions (Q-249/Q-352) therefore cannot cover the app's core write path,
  and the week's two worst findings (Q-450, Q-451) were exactly the shape an E2E spec catches.
- **🟡 Q-462 — an ownership violation on `/api/log-exercise` surfaces as a 500.** `ensureWorkoutSession`
  correctly refuses the write; the defect is reporting a permanent refusal as a transient fault, with a
  stack trace. Kept low because it is unreachable through the UI **and** the outbox catches per
  mutation rather than retrying forever — both checked, not assumed.
- **Also clean:** the outbox cannot be wedged by one bad workout mutation (per-mutation `try/catch`,
  the `CLAUDE.md` poison-pill rule implemented); and the flow itself runs end to end on the web build —
  select → pre-workout → warm-up → active → set logging, correct rest countdown, RPE capture, live 1RM
  and plate maths, with **zero uncaught page errors and zero failing `/api/` responses**.
- **Two near-misses checked and cleared,** recorded so a later sweep does not re-raise them: the live
  1RM's "▲ +2.00 kg" against a header reading 97.5 is **exact** (the stored PR is 98; the 97.5 is the
  previous session's estimate), and the warm-up ramp labelling 70 kg as "92%" is a fixed target
  percentage with the weight rounded to the loadable plate step, by design.
- **NOT device-verified.** Web build only — `getLocalStore()` returns null, so the device's
  local-write-plus-outbox path was never exercised and the Q-460 outbox half is read from source, not
  run. Fresh local seed, so nothing here speaks to prod drift. Workout mutations only; the
  program/phase-set/template routes were listed and **not** called, and rule (b) (raw bodies into
  `.set()`) was **not** systematically audited.
- **Nothing was fixed.** All three are queued.

### [app-shell][readiness] 🟢 Score presentation audited (Q-281) — the colour-only-state fix is NOT device-verified (2026-08-17)

- **⚠️ Owed: open Home with the "Accent ring" style selected on the S25 and confirm the band word
  reads.** v1.318.10 adds it beside that style's band dot at **7.5 px** — legible in the Playwright
  harness at 412×915, but small type on the real panel is a different question. Contrast unmeasured
  on both themes (Q-282's gap); the word inherits the dot's colour, so it is as contrasty as the dot.
- **Audit:** [`docs/reviews/2026-08-17-score-presentation-audit.md`](docs/reviews/2026-08-17-score-presentation-audit.md)
  — 14 surfaces, **9 render a score with no contributors and no trend**. **Read it before Q-278**: it
  refutes two of that entry's premises with measurement.

### [platform] 🟠 The repo migration reviewed as an architecture change — no credentials leaked, CI posture correct, four leftovers filed (Q-456…Q-459, 2026-08-17)

- **The lens.** Going public was not a hosting change. It altered three architectural properties at
  once: vendor material had to leave the tree (turning build-time imports into a **runtime dependency
  on private object storage**), every configuration and documentation surface silently changed
  audience from one owner to the public, and **CI became triggerable from outside the project**. This
  sweep checked all three plus the leftovers still pointing at the archived repo. Full write-up with
  the method and its limits:
  [`docs/reviews/2026-08-17-repo-migration-architecture.md`](docs/reviews/2026-08-17-repo-migration-architecture.md).
- **✅ The two answers that mattered most are both good.** **No credentials were published** — no
  GitHub/Google/OpenAI-shaped keys, no PEM private keys, no `.env` (only `.env.example`, values all
  empty), no keystores, no tracked build output, and no third-party personal data (the only real
  emails in the tree belong to bundled library authors). And **the CI posture is correct for a public
  repo**: all three workflows trigger on `pull_request`, **not `pull_request_target`**, so fork PRs
  get no secrets; `ci.yml` uses no secrets at all; and the APK publish is gated on
  `github.event_name == 'push'`, which a fork cannot reach.
- **🟠 Q-456 — the owner's production user ID is in 18 committed migrations, and the documented
  process re-publishes it on every schema change.** `fe481797-…` is baked in by
  `scripts/generate-claude-ro-views.js` as the row-scoping predicate. **Not a credential** and not
  exploitable alone (`/api/admin/db-query` needs the secret *and* `requireAdmin`) — but it is one half
  of the `WEBHOOK_USER_ID`/`ADMIN_EXPORT_USER_ID` pairs, cannot be rotated cheaply, and `CLAUDE.md`'s
  "re-run the generator into a **new** migration" rule means every future schema change adds another
  public copy. Fix the generator, not the 18 files.
- **✅ Q-457 FIXED (Lane B, 2026-08-17)** — `lib/github-release.ts` defaulted `APK_RELEASE_REPO` to the
  archived private repo; it now defaults to `nekodas-neko/TrainingAi_Open`, so an unset variable
  degrades to correct rather than to a frozen release failing as "Could not fetch release info".
  **Guarded** by a test on the URL actually requested, which fails when the default is flipped back —
  the fixtures the entry flagged proved nothing about which repo is *asked*. Never a live outage.
- **🟠 Q-459 — the rolling APK release used to delete-then-recreate; fixed 2026-08-24, not yet
  observed running.** `.github/workflows/android.yml`'s publish step now swaps only the release
  **asset** (`gh release delete-asset` + `upload` + `edit`) when the release already exists, falling
  back to `gh release create` only on the first-ever publish — the release id and tag survive a swap,
  so `/releases/tags/apk-latest` (what `/api/download-apk` resolves against) no longer 404s during the
  window. **Keep: unverified against a live `gh` run** — the `if: github.event_name == 'push'` publish
  step only executes on a merge to `main` that touches a native path, which this session could not
  trigger from a PR; confirm on the next such merge that the swap actually completes (`gh release
  view apk-latest` before/after, or watch the workflow log).
- **Also came back clean:** a fresh clone's test suite genuinely works (synthetic constants are
  committed and `vitest.config.ts` falls back to them when the real `MANIFEST.json` is absent — the
  path CI takes every run, so `NOTICE`'s claim holds); the `AWS_*`/`STORAGE_*` split is a deliberate
  alias chain rather than two competing schemes (**checked and cleared — a near-miss worth recording
  so it is not re-raised**); and `private-paths.json` is well built, down to descriptions deliberately
  written non-specifically so the inventory is not itself a map to what it protects.
- **The one structural gap, noted rather than filed:** `private-paths.json` protects a third party's
  IP and nothing plays that role for **this project's own users' identifiers**. Q-456 is the single
  instance found, and it reached a public repo because no gate was looking. Whether that wants a
  second list or a widening of the first is a design decision, not a review finding.
- **Method limits.** Static inspection of the tracked tree at `8a1bf82`, not a clean clone built from
  scratch; **nothing checked against the deployment**; secret detection was pattern-based, so it is
  strong evidence of absence for conventional formats and not proof for a bespoke one. Git history was
  not swept and does not need to be — the public repo begins at a single snapshot commit with no
  pre-migration history — but that reasoning does not transfer to the archived private repo.
- **Nothing was fixed.** All four are queued.

### [app-shell][devices] ⚠️ Q-532 FIXED — a streaming panel no longer scrolls the page; NOT device-verified (v1.317.6, 2026-08-17)

- **Cause:** `scrollIntoView` on a sentinel inside the log panel's `overflow-y-auto` box. It scrolls
  **every** scrollable ancestor up to the document, so each log line during a drain moved the whole
  `/admin/oura-ble` page — on the one screen where a mistimed tap can hit Clear key. Both call sites
  now use `lib/hooks/use-scroll-to-bottom.ts` (`scrollTop` on the container, which cannot escape it).
  The sibling sweep found a second, unreported instance: the workout-builder AI chat.
- **NOT device-verified and not reproducible here** — the sandbox cannot run a BLE scan, so the
  mechanism is identified but the symptom was never seen to disappear. **Owner check: run a drain,
  confirm the page holds still.**
- **No regression guard exists** — a capability gap: both vitest projects are `environment: 'node'`
  with no `@testing-library/react`, and the route needs admin plus a live radio, so neither a
  component test nor an E2E spec can reach it. Reintroducing the bug would fail nothing.
- Detail: [`entries/2026-08-17-scroll-panel-page-jump.md`](docs/overview/entries/2026-08-17-scroll-panel-page-jump.md).

### [devices][platform] 🔴 An app uninstall destroys the Oura ring key, and nothing warned about it (2026-08-17)

**Progress, 2026-08-23 — the key can now be backed up, and has not been.** `/admin/oura-ble` → Ring
key gains **Show key for backup** with copy, over a warning saying what an uninstall costs
(`OuraBlePlugin.revealKey()`, PR #325). **Native — inert until a new APK is installed, and until that
happens the key still has exactly one copy**, so this row stays open on Q-537's `Keep:` line. No
confirm-guard was added for `clearKey` because nothing calls it: the destructive path is uninstall,
which no in-app dialog intercepts.

The 32-hex ring key lives **only** in Android SharedPreferences. `OuraBlePlugin.kt` says so in its
own comment — *"the key never leaves SharedPreferences; never logged"* — so it is not on the server,
not in this repository, and not in any log. Correct for a credential, and it means **an uninstall
makes the ring unreachable**: the BLE service logs `no key stored` and refuses to start, while the
Devices screen still shows the ring as healthy because that card reads server data.

Hit live on 2026-08-17. The uninstall was necessary (moving to a stably-signed APK, #19), and the
"what you lose" list given beforehand covered only the JS local store — the native side was never
checked. Recovered from the `key.hex` the original `open_oura` re-key produced; **there is no
other copy**, and if it had been lost the only apparent fix — re-onboarding the official Oura app —
is the one that can force a firmware update and break the reverse-engineered protocol outright.

Documented in `CLAUDE.md`'s APK section and as §0 of
[`docs/oura-ble-operations.md`](docs/oura-ble-operations.md). **Still open** because the mitigation
is prose, not a mechanism: nothing in the app backs the key up, warns before an uninstall, or lets
the owner export it. Worth a backlog entry for an explicit "export/ring key" affordance before
the next device change.

### [workouts][readiness] ✅ An engine-chosen deload prescribed full weights — fixed, device check owed (Q-310, 2026-08-17)

- **Fixed in v1.317.5.** `/api/workout-data`'s ai_dynamic catch-all — two verbatim copies —
  hardcoded `isDeloadActive: false` while title-casing the *same* `aiPeriodizationState.phase` into
  the header label, so an engine-chosen deload (nobody confirms it, so it reaches no earlier branch)
  read "Deload" and prescribed full intensity. Both copies now call `aiDynamicFallbackPhaseStatus()`.
  Detail and evidence: [`entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md`](docs/overview/entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md).
- **`personal_records` was never corrupted and no migration is needed** — `logExerciseFromPayload`
  gates independently; both production deload sessions carry `max(estimated_1rm) = 0` and no PR row.
  The badge the owner saw was the client's optimistic display. (Owner-scoped `claude_ro` read.)
- **Owed: the device check.** Server/JS only, so it reaches the APK via the Railway deploy with no
  rebuild, but the client half was verified from the route's response, not on hardware. Confirm on
  the S25 at the next engine-chosen deload: header "Deload", reduced weights, no PR badge. Local
  SQLite rows written during the bug window self-heal on the next pull; not observed on device.

### [activity][workouts][app-shell] 🔴 The first sweep to RUN the app since the six-round review — two dead primary actions, one of which loses data (Q-450…Q-455, 2026-08-17)

- **Why this found things six rounds of review did not.** The comprehensive review that closed the
  same morning states its own limit: *"Nothing in six rounds was rendered — no device, emulator,
  browser, or `pnpm dev` run."* This sweep took the **failure-cells** lens — the error path, the
  empty state, the first-run path, the entry point reached out of order — against `pnpm dev` on the
  seeded local Postgres, driven through the repo's Playwright harness at 412×915 and with `curl`
  against a live session cookie. Full write-up, with every query and the reproduction:
  [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](docs/reviews/2026-08-17-failure-cells-running-the-app.md).
- **✅ Q-450 FIXED (v1.318.2) — `/activity` without a type recorded an activity and discarded it on
  Save**, with no toast, error or network request, because `done-activity-screen.tsx` bailed on
  `!activityType` before the local write, the outbox and the web fallback alike. Reached from the
  Coach handoff, the guided-walk Done button, a cold open or a refresh — and `resetSession()` leaves
  the store untyped after **every** save. It now shows a type picker instead of a recordable blank
  screen, and the bail-out toasts. Guarded by `e2e/activity-untyped-entry.spec.ts`, mutation-checked.
  **Not device-verified** — the web fallback ran, not SQLite+outbox. The spec exposed a second defect
  the bail-out was masking, filed as **Q-351** (Lane A): a sub-3-second activity rounds `durationMin`
  to 0, which `.positive()` rejects as a bare 400. [Journal](docs/overview/entries/2026-08-17-activity-untyped-entry.md).
- **✅ Q-451 FIXED (v1.318.3) — a new account's Workout tab was a ~1,400 px empty card with a dead
  button** whose onClick short-circuited on the missing `currentSession`. Now "No program yet" + a
  **Create a program** CTA; the inert button is gone rather than disabled, and a `programLoaded` flag
  separates "no program" from "still loading" so it cannot flash. **Now guarded** by
  `e2e/first-run-empty-states.spec.ts` against the zero-data account Q-352 added (mutation-checked).
  Home's syntactic sibling is guarded upstream and is not a bug.
  [Journal](docs/overview/entries/2026-08-17-workout-select-empty-state.md).
- **✅ Q-452 HALF-FIXED (v1.318.6)** — the AI insight card ran an LLM over literal `"no data"` strings,
  telling a day-one account *"…shows zero movement… this inactivity creates a significant gap"*.
  `AiInsightCard` now takes a required `hasData` and neither fetches nor renders without it. **Now
  guarded** by `e2e/first-run-empty-states.spec.ts`, which asserts on the *request* (asserting on the
  rendered card passes with the gate deleted). **Prompt half is Lane A's — Q-353.**
- **🟡 Q-453/454/455 — three low-severity ones,** filed mid-low: `/api/training-stress` silently
  answers for *today* on a malformed `date` where its ten siblings all 400; `/api/day-log` and
  `/api/exercise-history` validate params before checking auth (**no data leaks** — verified 401 once
  the param is supplied); and an unhandled throw returns a **bodiless 500** rather than a JSON error.
- **Four areas came back CLEAN and are recorded so the next sweep skips them.** (1) The `[-/]`
  date-separator class — all 11 date-taking routes accept **both** separators live. (2) The
  unauthenticated surface — 122 GET routes, **114 exact 401**, 3 admin 403, 2 deliberately public;
  **no route served user data unauthenticated**. (3) A zero-data account against all 122 GET routes —
  **exactly one route differs**, a clean `404 {"error":"No active program"}`. (4) 51 screen renders
  (30 seeded + 21 zero-data) — **zero uncaught page errors, zero console errors, zero failing `/api/`
  responses**, and the empty states are genuinely well built apart from Q-451.
- **NOT device-verified, and structurally cannot be here.** This is the **web** build:
  `getLocalStore()` returns null, so every offline-first domain took its web fallback and the device
  branch — the canonical runtime — was never exercised. No safe-area, Samsung-WebView, native-plugin
  or native-SQLite claim is made, and a fresh correct local seed cannot speak to prod data drift.
- **Q-450 and Q-451 have since shipped (Lane B, v1.318.1/v1.318.3) and are struck above; the other
  four stay queued** (Q-452's client half shipped too; its prompt half is Q-353, Lane A).
### [devices][heart-rate] 🔴 The ring records SpO₂ and daytime HR permanently — ~3.5× stock battery drain (Q-388, 2026-08-17)

- Owner: stock ring lasts 7 days; on our build it loses ~20% overnight and needs charging every 2
  days. That is ~50%/day against a ~14%/day stock baseline.
- `OuraProtocol.kt:123-127` — `enableMeasurementSequence()` sets **DAYTIME_HR + SPO2 + REAL_STEPS →
  AUTOMATIC** on *every* connect, unconditionally, with **no user toggle**, re-asserted on each
  reconnect. On stock, blood-oxygen sensing is opt-in and the vendor warns it costs battery.
- **Production (owner's rows, 7 days):** `spo2_r_pi_event` is the largest source at **53,412** rows,
  and **~75% of it lands between 22:00 and 09:00** — precisely the window the owner is losing 20% in.
  Green-PPG adds a steady daytime load. Daily totals stepped 5,378 → ~24,000 on **2026-08-04** and
  held; **unexplained, and confounded** — this counts *ingested* events, so better draining looks
  identical to more sensing. Resolving that comes first.
- **Separate latent trap (not today's cause):** `reqBleFastHrMode(false)` and `EXERCISE_HR →
  AUTOMATIC` exist only in `liveHrStopSequence()`; the connect-time sequence resets neither. A
  live-HR session that never reaches `stopLiveHr()` — app killed mid-workout, or the tester's
  **Live HR** button without **Stop HR** — leaves continuous fast-HR sampling on permanently, healed
  by no reconnect or restart. Production shows it is *not* firing now (`ehr_trace` is zero 21:00–08:00).
- **Nothing has measured ring power draw, because nothing records it** — the keepalive polls battery
  every 5 min and `parseBattery` decodes it, but it is never persisted. Everything above is
  code-traced or inferred from event counts. Persisting that poll is the prerequisite for a real fix.
- **Q-388** holds the trace, the hourly table and the fix directions. **Device-gated** — needs an APK
  and a wear cycle. **Not fixed; not started.**

### [nutrition] 🟠 A half-logged day feeds the calibrated maintenance as if it were complete (Q-387, 2026-08-17)

- Owner asked what stops the tuner treating "breakfast + lunch, skipped dinner" as a whole day.
  Nothing does. `adaptive-tdee.ts:96` counts any day with `intakeKcal > 0` as logged, so one apple
  qualifies — it clears the coverage gate *and* enters the mean intake the estimate is built on.
- Measured with the module: 14-day window, weight-stable user whose true maintenance is 2600, six
  partial days → **2086 kcal**, with `daysLogged: 14`, `excludedReason: null`, `confidence:
  'medium'`. 86 kcal of error per partial day, every gate passing, and the 1000 kcal plausibility
  floor never fires. It reaches the **prescription**: `energy-balance-service.ts:180` feeds it to
  `targetFromMaintenance`, so the recommended target carries the error and a cut's delta stacks on it.
- **Two partial-day guards exist and neither covers this** — an unlogged day is a gap, and *today*
  is excluded. The comment at `energy-balance-service.ts:146-150` names this exact trap and solves
  only the in-progress case; an abandoned **past** day never self-corrects. The 2026-08-11 entry
  below presents those two as the whole story, which this corrects.
- **Latent and armed.** Per Q-302 no recent window clears the gate, so nothing wrong shows today; it
  fires when logging gets consistent enough to switch tuning on — on success, not failure.
- **Q-387** holds the trace and an assessment of the owner's two proposed controls (the "% below
  expected" one is circular — do not ship as specified). No device or prod data needed. **Not started.**

### [workouts][readiness] 🔴 An ai_dynamic deload phase reached via the generic fallback branch runs at full weight and can mint a wrong PR (Q-310, 2026-08-17)

- **Owner-reported, live, unfixed.** A session labeled "Pull · Deload" in the header showed weight
  climbing set-to-set, and the exercise summary right after fired a "New Personal Record!" badge —
  during what the app itself called a deload.
- **Root cause, confirmed by reading the code, in two identical copies:**
  `app/api/workout-data/route.ts`'s ai_dynamic generic fallback branch title-cases
  `aiPeriodizationState.phase` into the correct display name ("Deload") but hardcodes
  `isDeloadActive: false` / `phaseType: 'normal'` — so weight prescription and the
  `shouldCountTowardPr` PR gate (`packages/shared/src/workout/log-exercise.ts`) both treat the
  session as normal. This is not the separate `earlyDeloadWeek` mechanism, which already sets the
  flag correctly; it's the AI's own accumulated-fatigue-triggered `phase: 'deload'` falling through
  to a branch that doesn't check for it.
- **Consequence: a genuine `personal_records` row can already have been written from submaximal
  work**, and whatever signal made the AI want a deload never gets addressed since none actually
  happened — plausibly why the owner saw another deload recommended right after this one.
- **Not yet fixed** — queued as Q-310, near the top of `docs/implementation-backlog.md` given its
  severity. Needs a production data check (any already-wrong `personal_records` rows from this
  path) before or alongside the code fix. Full trace:
  [`docs/handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md`](docs/handoff-2026-08-17-workouts-owner-bug-batch-deload-fallback.md).

### [platform] ✅ The repo can now run its own app — E2E harness shipped (Q-249, 2026-08-15)

- **466 test files, none of which opened a browser** — until now. `playwright.config.ts`, `e2e/`,
  `pnpm e2e` and a separate `E2E` CI job. One spec: the five tabs must paint real content on a
  repeat visit, which makes the instant-paint rule executable instead of reviewed by eye.
- **Read [`e2e/README.md`](e2e/README.md) before trusting a green run** — it records, all measured,
  what the harness proves and what it cannot: it drives the **web** build, so every offline-first
  domain takes its web fallback and the device branch never runs; it uses `pnpm dev` because the pg
  pool forces SSL under `NODE_ENV=production`; and its skeleton check covers **only the panel in the
  viewport**. That last limitation was found by the harness failing to discriminate — forcing the
  off-screen Body tiles' skeleton did not turn Health red — rather than shipped as a false guarantee.
- **The per-tab gap is closed for Health only** (Q-297): `health-tabs-instant-paint.spec.ts` drives
  `?tab=` and asserts the tab is *selected* first, so each panel is really in the viewport, and
  pinning the Body skeleton now fails only the Body case. **Every other tabbed screen still has it.**
- **The `E2E` job is not a required status check** and should stay that way until it has a track
  record. Remaining write-path specs and the promotion are **Q-297**.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).

### [app-shell][health] ⚠️ Two user-visible goal fixes shipped — NOT device-verified (Q-260, Q-258, 2026-08-16)

- **v1.317.2 (Q-260)** — changing a goal on More now reaches Health. `user-goals` was fetched by
  `fetchProgressHealthData` while the water goal renders in `waterIntake`, a `BODY_GROUPS` card, so a
  value shown on Body was fetched only by a tab the user may never open — and since every tab stays
  mounted for the app's life, nothing re-read it. Measured at the stale moment: server,
  `ta_cache:user-goals` **and** the `ta_water_goal_ml` device copy all held the new value while the
  screen showed the old one for 120 s. Fetch moved to the shared group; the localStorage seed moved
  to `useGoalSeeds`, which re-reads on `tabEpoch`.
- **v1.317.3 (Q-258)** — six goal/body inputs on More now announce their names to screen readers.
- **Neither is device-verified.** For Q-258 the gap is precise: Playwright resolving `getByLabel`
  proves the accessible name is wired, which is the mechanism that was broken — it is **not** the
  same as hearing TalkBack announce the field on the S25.
- **The class behind Q-260 is not swept.** Target weight and target body fat ride the same
  seed/`userGoals` pair and are fixed by the same change, but **any other screen that reads a value
  it does not re-subscribe to has this exact shape** — mount-scoped state on a screen that never
  unmounts. No sweep was done.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md) ·
  [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).

### [app-shell][platform] ⚠️ Q-261 FIXED — six button groups on More now have accessible names; TalkBack check still owed (v1.317.4, 2026-08-17)

- **Shipped in v1.317.4.** Fitness Goal, Biological Sex, Activity Level, Weight Units and Food
  Region now carry `role="radiogroup"` + `aria-labelledby` on the visible text, with
  `role="radio"`/`aria-checked` per option — the shape three sites already used. Timezone was not a
  group at all, so `<Label>` went there and its "Auto-detect" button now names what it detects.
- **NOT device-verified, precisely:** `e2e/profile-group-labelling.spec.ts` asserts via Chromium's
  accessibility tree (both assertions proven lethal by mutation), so names and checked state are
  known to be exposed — not the same as hearing TalkBack on the S25, the only thing still owed.
  Layout is unchanged. Arrow-key nav is deliberately absent, matching the three pre-existing
  radiogroups; filed as **Q-350**. [`Detail`](docs/overview/entries/2026-08-17-profile-group-labelling.md).

### [readiness][app-shell] ⚠️ The readiness card now flips on the tap — cause is code-evidenced, NOT device-reproduced (Q-248, 2026-08-15)

- **Shipped in v1.317.1.** Logging Exercise Readiness on Home showed a "Readiness saved" toast over
  an unchanged "How are you feeling?" prompt. The callback that flips the card sat behind
  `await localWrite`, a write already documented as able to queue for ~2 minutes behind a sync
  pull's `applyDelta` on the single Capacitor SQLite connection. It now fires on the same beat as
  the toast; `onSaved` stays behind the invalidation so the prescription refetch keeps its
  session-164 ordering.
- **The entry's step 1 was "reproduce on device with a sync pull in flight before changing
  anything", and that did not happen** — no device in session. What shipped fixes the cause the code
  evidences, not a cause confirmed against the observed failure.
- **The second possible cause is still open.** The screenshot cannot separate "still mid-stall" from
  "`onSaved` never fired at all". If it was the latter, the card will flip now regardless, but the
  local write would still be failing silently. **If the card flips and a day's readiness later turns
  out to be missing from the server, that is the other cause and this reopens.**
- **The device check that would close this:** trigger a sync pull, log readiness mid-pull, and
  confirm both that the card flips immediately and that the log reaches the server afterwards.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).


### [devices][platform] 🟠 `oura_raw.db` grows without bound on the phone — now measured: 209,326 rows, **0 rolled up**, 31.2 MB (Q-538, 2026-08-17 · measured 2026-08-18)

The documented "14-day rolling buffer" for on-device raw frames (owner retention decision,
2026-08-02) **has not shipped**. `OuraRawDb.kt` implements `pruneRaw`/`markRolledUp`/`getUnrolledRaw`/
`rawStats` and all four are exposed on the plugin bridge, but **a repo-wide grep finds no caller for
any of them**. Two independent causes, and fixing the first does not fix the second: nothing invokes
`pruneRaw`, and its predicate needs `rolled_up = 1`, which is set only by the WebView rollup consumer
(**D2 Task 5, not built**) — so wiring the prune tomorrow would delete zero rows.

The store has therefore accumulated everything drained since 2026-07-27 at roughly 2–3 MB/day. This
can wedge the drain: ops-doc **I21** holds the cursor on `SQLITE_FULL`.

- ✅ **Measured on device 2026-08-18** — the panel exists and the owner read it: **209,326 total rows,
  `rolled up` = 0, 31.2 MB on disk, `low disk` no.** Zero rolled-up rows means `pruneRaw`'s predicate
  matches nothing, so both causes above are confirmed from the device rather than inferred.
- **31.2 MB is a floor.** The store was wiped by the 2026-08-17 reinstall and rebuilt in ~1.5 days by
  the Full re-sync re-draining the ring's buffer at cursor 0. Forward growth ≈ **3.4 MB/day**
  (~149 bytes/row), matching the ~3.2 MB/day this repo already recorded and the ~1.2 GB/year the
  2026-08-02 retention decision predicted for an unpruned tier.
- **Related, and load-bearing for the D4 decision:** `AndroidManifest.xml:14` sets
  `allowBackup="true"` with no `dataExtractionRules`. Android Auto Backup's cloud quota is 25 MB/app
  and the file now measures **31.2 MB**, so **the device raw store has no working backup** — that was a
  projection when this row was filed and is now a measurement.
- Detail and the five costed options:
  [`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md).

### [platform][devices] 🟢 Q-308 RESOLVED — serialise the sync fan-out; owner-measured RTT settled it (2026-08-16)

The owner measured Railway per-query RTT from the app service — **p50 0.86 ms · p95 1.22 ms · min
0.62 ms** — which was the one thing Q-308 said had to be known before touching anything. Evidence in
[`docs/reviews/2026-08-16-sync-fanout-rtt-verdict.md`](docs/reviews/2026-08-16-sync-fanout-rtt-verdict.md).

With a 1 ms per-query hop simulated against the production pool of 10:

| concurrent syncs | PARALLEL (today) | **SERIAL** | CHUNKED ×4 |
|---|---|---|---|
| 10 | 155 / 161 ms · 210 conn | **95 / 137 ms · 10 conn** | 138 / 145 ms · 40 conn |
| 50 | 588 / 625 ms · 1,050 conn | **356 / 607 ms · 50 conn** | 700 / 744 ms · 200 conn |
| 100 | 1,153 / 1,218 ms · 2,100 conn | **588 / 1,026 ms · 100 conn** | 1,010 / 1,083 ms · 400 conn |

**Serial is faster at p50 AND p95 at every concurrency, with 21× fewer connections** — roughly half
the p50 at 100 concurrent. There is no trade-off to weigh, and chunking beats neither.

**The previous round's "serial and parallel are identical at p95" reading was measured at 0 ms RTT**,
where the two shapes converge because pool queueing dominates. A realistic hop separates them **in
serial's favour** — the opposite of the risk the entry was written to guard against. A parallel
fan-out demands 21 connections from a pool of 10, so each sync's own queries queue against each other
and pay RTT again on every acquisition.

**This re-frames Q-107 and Q-213 without striking them.** Both blame "DB-pool contention"; the pool is
not the constraint, **the fan-out shape is what creates the contention they observed**. A bigger pool
treats the symptom.

**Not exercised:** still local Postgres with a *simulated* hop (`setTimeout`, not a real network),
sync-vs-sync only — production sync also competes with every other route, which makes the
connection-demand argument stronger rather than weaker.

### [workouts][platform] 🟠 The deferred measurements, taken — one escape hatch tested and closed off, one confound ruled out (2026-08-16)

No new Q numbers. This round **answered questions four existing entries told an implementer to answer
first**, and the answers change what two of the fixes are. Evidence in
[`docs/reviews/2026-08-16-deferred-measurements.md`](docs/reviews/2026-08-16-deferred-measurements.md).

**Q-304's escape hatch was tested and did not fire.** The entry allowed that `prescriptionFactor`
might already absorb the high-rep inflation, and said closing it as measured-and-rejected was
acceptable. **28 of the 29 sets at 13+ reps that feed the 1RM carry no `planned_pct`**, so the factor
returns 1 and the raw curve stands. The proxy is exact: `log-exercise.ts:233` writes the same value
the factor consumes. **Q-304 stands — go straight to the fix.**

**Q-300's question is answered: rest is NOT the confound, so Q-289 should not wait on it.** Delta by
rest band at expected-10: on-target **−1.75**, rushed **−2.80**, overlong **−2.33**, unknown
**−2.21** — the shape error survives in every band and clears the 1.5 dead band in all four. Rest is
*a* contributor (on-target is mildest) but not the explanation. **Q-300 is re-scoped to its secondary
half — rest adherence as an unsurfaced coaching signal.**

**⚠️ And a synthesis I retracted before merging, which narrows two entries.** A first draft claimed
the prescribed-vs-unprescribed split showed `prescriptionFactor` working (r 0.30 → 0.50). It is
**confounded**: `planned_pct` only exists from **2026-07-18** (migration
`126_set_log_planned_snapshot.sql` — 0 before, ~100% after), so "unprescribed" means "older data",
and only ~15 unprescribed sets exist post-cutover. **The comparison cannot be made.**
Splitting by **era** instead: post-cutover (n=278) reads **+1.09** at expected-5 — *inside* the dead
band — and **−2.29** at expected-10, which still clears. So **Q-289 is re-scoped to the top of the
range** (heavy prescriptions reading as easy, plus the non-monotonic top that survives both eras),
and **Q-306's headline is weakened**: the emergency-deload trigger is **not** sitting inside the
error band on current data. Q-306 keeps its ACWR-at-three-thresholds half.

**Q-298 is now a one-line fix.** `log-exercise.ts:196` zeroes the 1RM when **either** the AI flag or
**the phase** says deload; **line 264 stores only the AI flag**. Line 264 should store the same
predicate. The file's own comment at 190–191 says both cases must not feed the estimate — they don't;
only one is recorded.

**Q-292 sized: all 117 insights audited.** **7 imperial-unit errors** (all Fahrenheit, all in
`sleep`) and **12 absolute superlatives** — roughly **16% carry at least one**. A second fabricated
superlative is double-confirmed: *"a perfect recovery index"*, for a contributor that scored **21 of
100** that day. (This cited Q-271's "never exceeded 50 on any of 31 scored days"; **Q-500 re-measured
it over 41 days and it is false** — see below. The superlative finding stands on that day's value.) One quasi-medical inference (hedged, benign advice, but
it infers infection from a temperature reading **and states it is advising without a readiness
score**). One regex hit was read and is a **false positive** — recorded so it is not re-raised.

**⛔ Still blocked on the owner:** **Railway per-query RTT**, which Q-308 needs before anyone touches
the sync fan-out, and which cannot be measured from the sandbox.

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev`. One user's data. The AI audit
is pattern-match plus read-back, not an independent judgement of every insight. Cell counts at the
extremes are small (expected-10 prescribed is n = 4).

### [platform][workouts][cardio] 🟠 The last four reviews, and the load test finally run — nothing breaks at 100 users (Q-306…Q-308, 2026-08-16)

Fifth and final review. Closes the four items previous rounds listed as *not started*, and answers
the question deferred four times. Evidence in
[`docs/reviews/2026-08-16-multi-user-load-test.md`](docs/reviews/2026-08-16-multi-user-load-test.md).

**✅ Q-298 is RESOLVED.** The five unexplained 2026-08-09 zero-1RM rows all belong to **one `Pull`
session**, and `session_periodization` shows **Pull entered the `deload` phase on exactly
2026-08-09**. `estimateOneRm` was called with `deloaded: true` from the phase and correctly returned
0. **The zeros were never the bug — the defect is that the phase-level deload never stamped
`exercise_deloaded` on the row**, which is precisely why Q-228's filter misses them and why they leak
into prescription. Two small fixes now: stamp the column from the phase, and store `null` not `0`.

**🎯 The load test, finally run.** Two committed harnesses (`scripts/load-test/`), both refusing to
run against a non-local database. Seeded 10 users at the owner's real profile — 10,527 set logs,
20,000 HR rows — and replayed `getSyncDelta`'s 21-query fan-out at production's `poolMax = 10`:

| concurrent syncs | p95 | failures |
|---|---|---|
| 10 | 210 ms | 0 |
| 50 | 778 ms | 0 |
| 100 | **1,562 ms** | 0 |
| 200 | 2,868 ms | 0 |

**Nothing breaks at 10 users. Nothing breaks at 100.** Linear degradation, zero failures; first
failures extrapolate to ~**300 concurrent syncs**, arriving as timeouts. And 10 *users* ≠ 10
concurrent *syncs* — real concurrency is near zero unless devices sync on a shared schedule.

**🟠 Two results that change the diagnosis (Q-308).** **A bigger pool does not help — it is slightly
worse**: at 50 concurrent, poolMax 10 → 778 ms, 20 → 803 ms, 40 → 952 ms. **Q-107 and Q-213 both
attribute production sync failures to "DB-pool contention", and the pool measures as not the binding
constraint.** And **the entire fan-out is 22.6 ms of query work** — so it demands 21 connections to
save ~8 ms. Serialising gives **identical p95 for a 21× cut in connection demand** (10 concurrent:
174 → 180 ms; 100: 1,450 → 1,519 ms). **⚠️ Do not act on that yet**: the harness runs over a Unix
socket where RTT is ~0, and on Railway serial adds 21 × RTT. Q-308's first task is measuring that RTT.

**🟠 The emergency-deload RPE trigger sits 0.07 inside a known error (Q-306).** It fires at
`rpeTrend.delta > 2.0`; **Q-289 measured a systematic +1.93 at expected-5 sets.** Blocked on Q-289 —
the threshold must be re-derived after that calibration, not tuned now. Separately, **ACWR now drives
three behaviours at three thresholds** (1.5 here, 1.2 early-deload, 1.5 activity taper) on a metric
Q-279 already questions. Deload has fired **once in 3.5 months**, so this is not over-firing today.

**Clean results, recorded so they are not re-swept.** **The phase engine is working** — the active
program progresses coherently; five rows that looked like stuck `sessions_in_phase` counters belong
to an **inactive** program (`AI-Phase1`), which is correct dormant state. **Fifth finding to die on
verification across these five reviews.** Muscle balance is push:pull **1.30** — mildly push-dominant,
not alarming, and folded into Q-305 rather than filed separately.

**⚠️ Still open:** the systematic AI-output audit (8 of 117 read), the degradation matrix against a
running app (Q-294, desk-only), and **Railway per-query RTT** — the measurement Q-308 needs, which
cannot be taken from the sandbox.

**Surfaces NOT exercised:** the load test is **local Postgres, raw SQL, one instance** — no Railway
network, no Next request path, no drizzle overhead, no replicas. It answers a contention question,
not a capacity-planning one. Synthetic users are uniform; a single heavy user is not modelled. No
device, emulator, browser or `pnpm dev` in any of the five reviews.

### [workouts][platform] 🟠 Round 3 — the 1RM high-rep gap, volume landmarks nobody sees, and a correction to Q-298 (Q-304/Q-305, 2026-08-15)

Fourth review of the day, taking the items the third listed as *not started*. Two are done;
**four are still not started and are named below.** Evidence in
[`docs/reviews/2026-08-15-workout-model-round-3.md`](docs/reviews/2026-08-15-workout-model-round-3.md).

**🔧 First, a self-inflicted one, fixed in the same PR.** A merge resolution staged with `git add -A`
put **21 conflict markers across four files onto `main`** in #1380. They passed **Lint, Tests, Build,
Migration Check, Custom Rules and E2E** — six green checks — because nothing looks at markdown for
this and `<<<<<<< HEAD` is ordinary prose to every other tool. Resolved, and
`scripts/check-conflict-markers.js` is now a Custom Rules step (**36 of 36**), verified to fail on a
planted marker. No backlog entry — it is fixed.

**⚠️ Q-298 was HALF WRONG as filed, and is amended in place.** It called all ten zero-`estimated_1rm`
rows a defect. The write path calls `estimateOneRm`, and `1rm.ts:158` is
`if (deloaded) return { estimated1rm: 0, … }` — **the five 2026-08-06 rows carry
`exercise_deloaded = true` and are zero on purpose.** Two things survive: **`0` is the wrong sentinel
and should be `null`** (a zero propagates as an estimate *of* zero — that is what read as −100% on a
trend), and **the five 2026-08-09 rows are still unexplained**. Those narrow to a bodyweight-resolution
path (Pull-Up, `weight_kg = 0`), a `useFor1rm`-subset with no qualifying set (Preacher Curl), and
**three rows with real weights, real reps and `use_for_1rm = true` that should compute and do not** —
that is where the work starts. `runningEstimate1RM` already has the empty-result fallback that
`calculate1RM` lacks, and the write path uses `calculate1RM`.

**🟠 29 sets at 13+ reps feed the 1RM estimate on the path that skips the AMRAP correction (Q-304).**
`amrapScaleFactor` exists (0.88 at 13–20 reps, 0.82 at 21+) and is applied by `calcAmrap1RM`;
`estimateOneRm`'s ordinary path calls `calculate1RM`, which does not. **The entry carries an explicit
qualifier that may close it**: `prescriptionFactor` may already absorb the inflation where a style is
present, and how often that holds for those 29 sets was **not measured**. Measure first.

**🟠 The volume landmarks are computed and shown to nobody (Q-305).** `MUSCLE_LANDMARKS` carries
MEV/MAV/MRV per muscle and `program_volume_targets` exists. Last 7 days: **calves 2 sets against an
MEV of 8**, lats 9 vs 10, upper back 7 vs 8, while triceps sit at 17 (above MAV). Nothing surfaces
any of it. Same "computed and discarded" class as Q-278 and Q-302 — worth one shared treatment.
**One week is a small sample**; the durable finding is the missing surface, not this week's numbers.

**A check that came back clean:** `core` is tagged on exercises and absent from `MUSCLE_LANDMARKS`,
which looked like a silent fall-through — but `muscles.ts:17` maps `core: 'abs'` and
`volume-targets.ts:58` normalises before the lookup. **Fourth finding to die on verification across
these four reviews**, which is the process working.

**⚠️ STILL NOT STARTED after four reviews** — deload *policy* (as opposed to its twice-fixed
mechanism), the phase engine, muscle balance / exercise selection, and the cardio pace/HR model
across 47 activity logs. The AI-output audit is 8 of 117. The degradation matrix is desk-only (Q-294).
And **"what breaks at 10 users, at 100" is unanswered for the fourth time — it needs load testing
against a seeded multi-user database, not reading, and will not close by inspection.**

### [workouts][cardio][nutrition] 🔴 Every remaining pillar reviewed for model soundness — 6 findings, and 2 pillars clean (Q-298…Q-303, 2026-08-15)

Third and final review of the day. The owner asked for every pillar to get the treatment the health
scores got: not *is the code correct* but **is the model sound, and does it do anything in
production?** Evidence in
[`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](docs/reviews/2026-08-15-pillar-model-soundness-review.md).
**Heart-rate and body were reviewed and came back clean — no entries filed for either.**

**🔴 Ten exercise logs store an estimated 1RM of exactly zero (Q-298).** Not null — zero — beside real
volume and reps (Sumo Deadlift: 2,062 kg at 6.3 avg reps → e1RM 0). Two clusters: 2026-08-06 ×5, all
`exercise_deloaded = true` (the Q-115/Q-228 date), and **2026-08-09 ×5, all `deload = false`,
consecutive over 37 minutes — one entire session**. **Q-228's fix filters on `exercise_deloaded`, so
the 08-09 cluster passes straight through into prescription.** A zero is a value, not an absence: it
flows into trends, PR detection and the next prescription, and reads as −100% on a trend chart.
**2026-08-09 also logged 1,000 `error_events`** and carries the 0.00 h sleep row from Q-274 — three
domains, one heavy-fault day, pointing at the connection-starvation class (Q-213/Q-107).

**🟠 37% of sets are rushed, and `expectedRpe` has no rest term (Q-300).** Where both are recorded
(n = 276): mean 99 s taken vs 111 s planned; **103 rushed (< 75%)**, 44 overlong. A set at 80% with
60 s rest is not the stimulus the model assumes. **Re-run Q-289's bucket table split by rest
adherence before recalibrating anything** — the confound may be most of the finding.

**🟡 The dead `running_baselines` write/read code was removed 2026-08-24 — the physical table is
the one thing left (Q-301b, `Gate: owner`).** Investigation confirmed the 12 real `prescribed_runs`
already derive from a better, live source (`resolveSnapshot()` reads `fitness_tests`/`body_metrics`
fresh on every request); the table's write and its never-called reader were pure dead weight.
`saveRunningBaseline`/`getRunningBaseline`, the `RunningBaseline` interface, and the Drizzle table
definition are gone — nothing in the app can reach the table any more. What's owed is the actual
`DROP TABLE`, deferred as a data-dropping migration needing the owner's yes. Third instance of this
class after Q-270 and Q-231.

**🟠 Adaptive TDEE has not fired once in 30 days (Q-302).** Its gate needs 10 logged days per
fortnight; production runs **1–4 per 14**, and **0 of the last 30 rolling windows pass**. The gate is
probably right and should not be lowered — the defect is that `TdeeAdaptationCard` never says it is
dormant or what would wake it. Same class as Q-278, different pillar. And the AI coaches on that
sparse data unqualified — *"bump that protein closer to your 150 g goal"* on a window with 4 logged
days (Q-303).

**What came back clean, recorded so it is not re-swept.** **Progressive overload is working** — 10 of
12 tracked lifts improving over 3.5 months (Bench 84 → 100 kg, Hip Thrust 98 → 157 kg); the two
"regressions" are the Q-298 artefacts. Rep adherence where recorded: **135 of 176 exact**. Nutrition
targets internally consistent (150×4 + 190×4 + 60×9 = 1,900) and the energy model uses Schofield BMR
+ Mifflin factors + Compendium METs. **Heart rate**: 57,494 samples, observed max **168** — independent
corroboration of the figure Q-57 adopted over `220 − age`; `daily_zone_minutes` stores `max_hr`/`resting_hr`
per row, which is the provenance discipline Q-273 asks for elsewhere. **Body**: the 17-vs-68 composition
gap resolved as **benign** (those columns first appear 2026-07-29); the six tape-measure columns at 0 of
108 are **correctly empty**, not broken.

**⚠️ Still open after three reviews** — stated so completeness is not assumed: the 1RM formula question
at high reps (I4) **not started**; deload *policy* (as opposed to its twice-fixed mechanism) **not
started**; volume-landmark adherence, muscle balance and the phase engine **not started**; the cardio
pace/HR model across 47 activity logs **not started**; the AI-output audit partial (8 of 117 read); the
degradation matrix desk-only (Q-294); and **"what breaks at 10 users, at 100" is still unanswered — left
open three times now.**

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev` across any of the three reviews.
Every number is one user's via row-scoped `claude_ro` views; the *mechanisms* are user-independent, the
*magnitudes* are not.

### [workouts][platform] 🔴 The RPE model misses by more than the threshold that consumes it, and five other unswept lenses — 12 findings (Q-285…Q-296, 2026-08-15)

The owner asked what twelve review sweeps had never looked at. Six lenses survived a grounding
check: feature usage, account lifecycle, **training science**, AI output, cost, and failure
degradation. Full evidence in
[`docs/reviews/2026-08-15-uncovered-lenses-review.md`](docs/reviews/2026-08-15-uncovered-lenses-review.md);
entries **Q-285 … Q-296**.

**🔴 The headline (Q-289) — `expectedRpe` measured against 569 real production sets.** It drives RPE
autoregulation and the emergency-deload safety net. It predicts logged RPE at **r = 0.348**,
MAE 0.99:

| expected | actual mean | **delta** | n |
|---|---|---|---|
| 5 | 6.93 | **+1.93** | 68 |
| 8 | 7.57 | −0.43 | 288 |
| 9 | 7.90 | −1.10 | 60 |
| 10 | 7.81 | **−2.19** | 52 |

`autoregulation.ts:19` sets `RPE_DEAD_BAND = 1.5` on `actual − expected`; `<= −2` adds **two** target
reps; `emergency-deload.ts:35` fires at `> 2.0`. **At expected 5 the systematic error alone is
+1.93, and at expected 10 it is −2.19** — both clear the trigger before the lifter has done
anything. **120 of 569 sets (21%)** sit in those buckets, so the heaviest prescriptions systematically
read as *"that felt easy, earning the next jump"*. The model is also **non-monotonic at the top**
(expected 9 → 7.90, expected 10 → 7.81), which points at `maxRepsAtPct` rather than a simple offset.
The construction is sound and should not be rewritten — this is calibration. Its ceiling is set by
**Q-290**: logged RPE has **sd 0.87 over range 6–10**, effectively two values, so autoregulation
differences a 1-point signal against a 5-point prediction.

**🟠 A shipped toggle that can never do anything (Q-285/Q-286).** `push_subscriptions` has **0 rows**,
and `sendPushToUser` has exactly one caller in the codebase — `/api/push/test`. So web push has
neither senders nor subscribers. **This is not the native notification work recorded elsewhere in
this file** (`OuraRingService.kt` etc.), which works. It strands a real feature:
`supplements.reminder_enabled` is a live `<Switch>` in `manage-supplements-sheet.tsx:253` that
persists and syncs, and there is no cron layer (`module-map.md` §0) and no push sender — so the
reminder cannot arrive, while looking like it saved.

**🟠 The AI contradicts itself, and stated a false number (Q-291/Q-292).** On 2026-08-06 the readiness
insight said *"Keep your planned exercise intensity low"*; the user did **two** sessions; the same
day's digest said *"Crushing three PRs… Keep that same energy tomorrow!"* Readiness then fell
79 → 76 → 76 → **65**. Separately, the 2026-08-05 activity insight claimed *"a perfect activity
score"* when the stored value was **80**, and a sleep insight prescribed *"65 degrees Fahrenheit"* to
a metric user. `CLAUDE.md` forbids an LLM number *gating an action*; it does not yet cover a number
*displayed as fact*, and it should.

**🟠 Two Play Store gates are unmet (Q-287/Q-288).** No self-service account deletion exists (admin
route only) — required in-app and on web since 2024. And `/api/export` covers **26 of 82 tables**
(re-measured 2026-08-17; the old "27 of 80" counted `goals`, a repository call rather than a table),
silently omitting the user's own profile row, their heart rate, derived scores, AI conversations and
nutrition plans. Deletion is **⛔ owner-sign-off-first**; it is destructive and irreversible.
⚠️ **The route also cannot stream a large table while its comment claims it can** — `exportUserData`
buffers each table via `pool.query`, so closing the coverage gap without fixing that first is an OOM
the moment `oura_raw_samples` (1,098,183 rows / 360 MB) joins the list. Both halves ship together.

**The rest:** `ai_health_insights.context_hash` is NULL on **109 of 117** rows, so the
regeneration-avoidance key is written by one section of fourteen (Q-293). Coach is **8% of AI calls
and 52% of tokens** at 19,400 input tokens and **5.8 s** per call (Q-295) — *latency*, not cost.
`module-map.md` says Coach runs `gemini-3.6-flash`; **production logs all 17 coach calls on
`gemini-3.1-flash-lite`** (Q-296). Four failure cells have undefined intended behaviour, filed as a
note against Q-249 rather than standalone work (Q-294).

**Cost was measured and is a NEGATIVE result — do not optimise it.** 255 calls / 632,639 tokens over
24 days ≈ 26,360 tokens/day, cents per month, ~$6/month at 100× the users. The database remains the
real cost curve and is already tracked.

**Surfaces NOT exercised:** no device, emulator, browser or `pnpm dev`. **Lens L (degradation) was
not executed at all** — no failure was induced, and its table is reasoning from source. The RPE
finding is **one lifter's 569 sets**. Only 8 of 117 AI insights were read closely. The Play Store
requirements in Q-287/Q-288 are asserted from knowledge and should be re-checked against Google's
current policy before building.

### [sleep] 🔴 The sleep row's time range is time-in-bed but reads as time-asleep — the wake moment is stored and never shown (owner report, 2026-08-20)

- **Owner report.** *"That wake up time is way off, I woke up around 6am"* — the row read
  `9:52 pm – 6:44 am`. Then, once sync settled: *"it changed again… and it's still wrong."*
- **The ring is right and the app already knows it.** Decoding the stored `sleep_phase_5_min`
  (`'1'=deep '2'=light '3'=REM '4'=awake`, `packages/shared/src/health/hypnogram.ts`), the night's
  last 8 epochs are `4` — **40 minutes awake at the end**. Session end **06:47** − 40 min puts the
  **last sleep epoch at ≈ 06:07**, which is the owner's *"around 6am"* almost exactly.
- **The defect is the label.** The row renders the **in-bed span** (8.92 h) in a position that reads
  as the sleeping window, while the adjacent figure is time **asleep** (7.75 h) and 1.25 h is awake
  (0.5 h onset latency, ~40 min lying awake at the end). **The wake moment the owner recognises is in
  the stored hypnogram and surfaced nowhere.**
- **Same root as Q-529, which was re-scoped to match (2026-08-20).** Q-529 originally read as a
  missing recompute path; the score **does** recompute (47 → 55 at 06:54:41, after the session settled
  at 06:51:03), so what remains there is a **~9-minute window where a provisional score renders as
  final**. Both are the same defect wearing two hats: **a still-syncing night is displayed identically
  to a settled one.** Both are Lane B.
- **Suggested shape, not a spec:** label the range as time in bed, or show both (*"asleep until 6:07,
  up at 6:47"*). Both numbers are already stored.
- **Why a Known Issue and not a queue entry:** the Tuning Q band (500–529) is **exhausted** at Q-529,
  and a number from another agent's band must not be taken. Give this one a number when the band
  question is settled.
- **Evidence:** [`docs/reviews/2026-08-20-sleep-score-computed-mid-sync.md`](docs/reviews/2026-08-20-sleep-score-computed-mid-sync.md) §5.
- **Also observed, and benign:** the session grew across three reads that morning
  (**4:52 → 6:44 → 6:47 am**, awake 1.17 → 1.25 h) — sync converging, not malfunctioning. It reads as
  instability only because nothing marks a still-syncing night as provisional (see Q-529, Q-520).

### [sleep] ⚠️ Sleep Score recalibrated to use its range — the trend chart has an unmarked step (Q-503, v1.319.0, 2026-08-18)

Sleep averaged **87.4 with 27 of 35 days ≥ 85** and no night between 40 and 69. Recalibrated
(nine curves re-anchored + a `SCORE_CALIBRATION` on the blend): over the same 65 nights it now reads
**mean 69.5, sd 16.6, range 32–99**, every band populated. Two real defects fixed — scoring your own
HRV/HR baseline returned 90/86, and the REM ceiling sat below the owner's median. `LOW_SLEEP_SCORE`
re-anchored 60 → 42 so the rest-day hint fires at its old rate (6%) rather than 26%. Evidence:
[`docs/reviews/2026-08-18-sleep-score-range-recalibration.md`](docs/reviews/2026-08-18-sleep-score-range-recalibration.md).

**Still owed, which is why this is ⚠️ and not ✅:** historical `oura_daily_derived.sleep_score` rows
keep their old values until each day is re-read, so the trend chart shows a **step at the changeover
with older days ~15 points higher for model reasons, not physiological ones** — and sleep stamps **no
`model_version`** (Q-273), so nothing in the data marks where it is. Also **not device-verified**, and
the calibration is fitted to one sleeper's distribution (a per-user rolling calibration is the real
fix). **Readiness has the identical problem and is NOT yet fixed — Q-504.**

### [readiness][sleep][activity][body] 🔴 The five scoring pillars, measured together against production for the first time — 14 findings (Q-271…Q-284, 2026-08-15)

Prior sweeps measured **one** pillar each, in isolation and months apart. The 2026-08-15
comprehensive review measured all five on the same days against the same production rows, and asked
whether they agree with each other. Full evidence and every query in
[`docs/reviews/2026-08-15-comprehensive-app-review.md`](docs/reviews/2026-08-15-comprehensive-app-review.md);
one backlog entry per finding, **Q-271 … Q-284**.

**The five that change what the user sees:**

- **🔴 Readiness is structurally blind to training load (Q-275).** `readiness-payload.ts:329` reads
  the Activity Score's `preTaperScore` *specifically* to avoid double-counting ACWR — but load
  enters the composite nowhere else. Both activity terms (15% combined) are **goal-completion**
  scores, so a 12,000-step rest day and a heavy squat session contribute identically. Garmin's
  Training Readiness takes two load inputs of six. For a resistance-training app this is the largest
  modelling gap in the score.
- **🔴 Fragment "nights" reach the sleep score, and on two dates the fragment is the only record
  (Q-274).** Post-re-key, 10 of 46 `sleep_sessions` rows are under 1.5 h and **three are exactly
  0.00 h**. On 2026-08-11 and 2026-08-13 the fragment is the *entire* record for the date. These feed
  `previousNight` (16% of readiness) and `sleepBalance` (10%). **This is the sweep Q-225 asked for,
  and it found at least one more night sharing 08-13's signature.**
- **✅ The Recovery Index anchor is fixed — Q-500 SHIPPED v1.320.0 (2026-08-18).** Q-271's headline
  ("never above 50, ever", "~2.2 pts/day") was measured over **eight** days and did not survive: over
  41 the contributor exceeds 50 on **13** and costs **0.55** pts/day. The real defect was a systematic
  **−10.2-point** bias, fitted against Oura's own contributor over the 15 nights where both exist —
  zero-bias anchor **4.63 h**, shipped as **5**. The estimator is sound (r = +0.712, beating every
  alternative) and unchanged. Thresholds deliberately not re-anchored: this is a bias correction, not
  a scale change. `READINESS_MODEL_VERSION` → `v3:ri5:2026-08-18`.
  [`review`](docs/reviews/2026-08-17-readiness-calibration.md)
- **🟠 A stored readiness score cannot be re-derived from the inputs stored beside it (Q-501, 2026-08-17).**
  `oura_daily_summary` rows get recomputed; the derived readiness rows built from them do not follow, so
  **5 of 33** persisted `recoveryIndex` sub-scores disagree with their stored hours (worst: 2026-07-20,
  2.32 h should give 39, persisted 4). `model_versions->>'readiness'` is **NULL on all 33 rows**, so a
  past readiness shift cannot be attributed to inputs or model. Same class as Q-273.
- **🟠 Body Battery v5 drains 5× faster than it charges (Q-272).** v5 halved `CHARGE_RATE` to fix
  ceiling-pinning and overshot: charge 10.5/day vs drain 52.4/day, **ends at its daily minimum on 10
  of 12 days**, hits 0 on 3. Across all 40 days it never rises above its waking value on a third of
  them. Garmin's equivalent recovers during waking rest — that is the feature's headline behaviour.
- **✅ Readiness and Body Battery share no variance (Q-276) — resolved 2026-08-31 (v1.413.0).**
  Anchor r = +0.93 (it **is** readiness), end-of-day r = +0.12. Owner settled them as two different
  questions, so it was presentation: each now names its own where it is read — the battery card's
  explainer rendered only in the *no-data* state, so nobody saw it on an ordinary day. No model change ([`journal`](docs/overview/entries/2026-08-31-recovery-scores-name-their-question.md)).

**And one correction to a claim already in this file.** The Body Battery v5 row below records
end-of-day battery vs next-day readiness at **r = −0.06** as evidence the model has no outcome
signal. That number was computed **across four different model versions** (v1/v2/v4/v5 all ran
inside 40 days, with no backfill). Split by version, **v5 alone gives r = +0.67 (n = 11)**. The
deferred re-check that row asked for is done and it answers **in v5's favour** — tune, don't
abandon. That the pooled figure stood for eleven days is itself the finding: **Body Battery is the
only pillar that stamps a `model_version` at all**, so this class of error is undetectable for the
other four (Q-273 — do this one **before** the calibration items, or each creates another
incomparable segment).

**The rest, in brief:** Activity Score still occupies a quarter of its range (sd 5.9 over 19 days)
even though v2 fixed the mechanism Q-137 blamed. **Answered 2026-08-19 and folded into Q-505**
(Q-277 removed from the queue): all six contributors were measured, and **49% of the score's
effective weight cannot vary** — `moveHours` saturated, `zoneMinutes` floored, `activeEnergy` absent,
`strengthFreq` 78% at ceiling by design. The goal fixes did work (stored sd **5.0 → 7.4** across
2026-08-11) but stored history is not back-filled, so most days still show the old model. Scores are absent on 20–52% of days with nothing distinguishing "no data" from a real value
(Q-278). Q-214's duplicate-collapse fix — which stopped a **5,771-hit** `[pg 21000]` fault that was
discarding 5,000-point HR chunks — reached **one of three** same-shaped batch upserts; `upsertOuraBucket`
and `upsertSetHrStats` are still exposed (Q-280). ACWR drives the early-deload card and the activity
taper on evidence the literature has substantially retracted (Q-279). No automated accessibility
check exists anywhere in CI, which is why the 2026-08-08 sweep's contrast finding "could NOT be
measured" (Q-282). Plus score presentation vs the incumbents (Q-281), ~11 MB of never-scanned
indexes (Q-283), and the Oura activity blend now firing on 1 day in 40 (Q-284).

**Surfaces NOT exercised:** no device, no emulator, no browser, no `pnpm dev` run — this was a
docs-only review. Every number is **one user's** data via the row-scoped `claude_ro` views, and
`error_events` prunes at 30 days. Correlations at n = 11 to n = 31 are directional, not conclusive.
The review's own architecture lens (Lens F) is shallower than the rest, and **"what breaks first at
10 users, at 100" is not answered.**

### [nutrition][workouts] ⚠️ Three owner-reported day-screen fixes shipped — NOT device-verified (Q-245, Q-246, Q-247, 2026-08-15) · needs: browser

- **Shipped in v1.317.0.** Nutrition's food-log guard is now scoped to the date the rendered logs
  belong to, so swiping to a past day and back to a fresh today no longer keeps the previous day's
  meals. The weekly Training Load bar draws a deload day at a real height with a striped fill
  instead of the grey "no data" sliver a rest day gets, and a testing-only day now shows "T" rather
  than the "D" it was mislabelled with. The day screen gained an Energy section (eaten / burned /
  net, broken down into workouts, activity, steps and resting), reading the same
  `/api/nutrition/energy-balance` route Nutrition's card uses; activity rows now render the
  distance, calories, pace, HR, steps and elevation the payload already carried.
- **All three were verified on the local dev server and by mutation-verified tests, and none has
  been seen on the S25.** Three specific gaps: the Q-245 repro is a *swipe gesture driving React
  state*, and Playwright's npm package is not a dependency here (only the browsers are installed),
  so the interaction was never driven in a browser — the decision it turns on is unit-tested, the
  wiring around it is not. The deload stripe is a CSS mask (`-webkit-mask-image`), whose rendering
  on Samsung's WebView compositor is assumed rather than observed. And no day-screen section appears
  in server-rendered HTML, so the Energy section and enriched activity rows were verified through
  the route's numbers and their display logic, never *visually*.
- **The device check that would close this:** on the APK, swipe Nutrition back a day and forward to
  today on a day with no food logged yet, and confirm today reads empty; open Health → Training in a
  week containing a deload and confirm the bar is striped and full-height, not grey; open a day with
  a workout and a walk on it and confirm the Energy section reads sensibly and the activity row
  shows its distance/calories/HR.
- **Deliberately not done:** a per-workout kcal estimate in the day screen's Training section. It
  needs `estWorkoutKcal` per session, which is the Q-230 bundle hazard from a client component —
  doing it properly means computing it server-side in `/api/day-log`.
- Detail: [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md).

### [platform][app-shell] 🟠 Editing a goal never busts the goal cache — Health shows the old goal for 30 minutes (Q-240, 2026-08-14)

- Found by the owner-requested UI/flow/caching review,
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md) §4.2.
- `components/profile/goals-section.tsx:177-186` fires `PATCH /api/user/goals` and invalidates
  nothing. Its sibling `patchProfile` in the same file (`:123-140`) calls
  `invalidateGoalRecommendations()` after its PATCH — and **that group already contains
  `invalidateCache('user-goals')`** (`lib/cache-groups.ts:176`). The group is right; the call site
  was never wired to it.
- **User-visible:** change your steps / sleep / calorie / water / target-weight / target-body-fat
  goal in More → Profile → Goals, switch to the Health tab, and its goal-driven cards keep rendering
  the **previous** goal for up to 30 minutes (`user-goals` at `TTL_MEDIUM`,
  `app/health/health-content.tsx:454`), and the stale value paints first on the next cold start
  (same key seeded synchronously at `:242`).
- **Not reproduced at runtime** — found by reading source and the invalidation groups. The fix is
  one `await invalidateGoalRecommendations()`. Queued as **Q-240**.

### [platform][body] 🟠 Goals live in two places — `localStorage` and the server — and Health reads three of them from the device copy only (Q-241, 2026-08-14)

- Same review, §4.3. `components/profile/goals-section.tsx:192-235` writes nine `ta_*` goal keys to
  `localStorage` **and** PATCHes the same values to `/api/user/goals`;
  `components/profile/goal-recommendation-sheet.tsx:125-126` writes the device copy too;
  `lib/coach/domains/goals.ts:137-138` is a third reader/writer of the same keys.
- `app/health/health-content.tsx:202-214` reads the **water goal** (defaulting to 2500 ml),
  **target weight** and **target body fat** from `localStorage` only.
- **User-visible:** the device copy never syncs. On a second device, after a re-install, after
  clearing browser data, or between the web surface and the APK, the server holds the real goals
  while the Health tab shows defaults — and the two copies can then disagree indefinitely with
  nothing to reconcile them. Against the *Canonical Runtime* amendment (no surface may assume the
  owner's own device) and against the offline-first rule that the **local store**, not
  `localStorage`, is the local source of truth.
- **Not reproduced on a second device** — the sandbox has one. Queued as **Q-241**.

### [platform] 🟠 83 device-verification rows, now tagged by which capability each actually waits on (re-measured 2026-08-15, Q-249…Q-254)

- **Every row now carries a `· needs:` tag** (Q-254's re-tagging half, 2026-08-15 — see
  [`docs/overview/history-2026-08-15.md`](docs/overview/history-2026-08-15.md)). Re-measured on
  the day Q-249 landed, the 83 rows split **browser 32 · android 26 · data 11 · hardware 13** —
  `grep -cE '^### .*needs: browser' projectOverview.md` and friends are the live count (anchor it to
  the heading, or this paragraph counts itself). The 2026-08-14
  projection below ("~25 need nothing but running the app", "17 Android", "25 hardware") was made by
  reading and is **superseded by this**: the browser bucket is larger than projected and the hardware
  bucket smaller, but the shape of the finding held — roughly 40% of the wall never needed a phone.
- **The tags were assigned from each row's own heading text, not from opening the feature.** A row
  tagged `browser` is a claim about *which gate it is waiting on*, not that it has been verified —
  striking a row still requires an E2E spec that covers it, per "never mark an issue fixed from
  intent". `data` means real accumulated/owner/ring data that no emulator conjures; those rows are
  not unblocked by Q-249 or Q-250.
- Owner asked what access would let agents test more end-to-end, citing the Railway key as the model.
  Measuring the gate first changed the answer. Full working:
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md) §7.
- **The 81 rows are five gates, not one:** ~25 need nothing but somebody running the app; **17** need
  an Android runtime (local SQLite, offline, notifications, back button, deep links, PiP); ~10 need
  real data; **25** need real hardware; ~4 are perceived performance.
- **The largest bucket needs no new access.** There are **466 test files and none runs the app** —
  Chromium and Playwright's browsers ship in every session (`/opt/pw-browsers`) but Playwright is not
  a dependency, so there is no harness. Rows like "Bodyweight sets no longer count as zero volume"
  and "Injury workout warning" have sat since v1.45–v1.50 not because they need a phone, but because
  the device-verification rule had **no cheaper tier beneath it** — "cannot verify here" was the only
  truthful thing a session could write. Queued as **Q-249** (build, don't plan).
- **The Android bucket's most valuable line is local SQLite migrations** — the failure that has
  silently killed the local DB twice (#27, #85) and is the root of the recurring "my data
  disappeared" reports. A migration's first real execution is currently on the owner's phone.
  **Q-250** puts it on an emulator in CI first. Verified it cannot run in a session: no `/dev/kvm`,
  no `vmx`/`svm` — Firecracker microVM, no nested virtualisation. GitHub's `ubuntu-latest` has KVM.
- **Owner directed the cluster be implemented before Q-49** (the public-repo migration), and that
  deadline is load-bearing: Q-49's decisions commit to "CI stays offline and holds no credential",
  while Q-252 (error tracking) and Q-253 (device farm) both want one. Easier to settle on a private
  repo than after the cut.
- **~15–18 of the 25 hardware rows are BLE and stay owner-only permanently** — no emulator or device
  farm produces a Ring 5 on our own re-keyed protocol. This cluster shrinks what falls under the
  device gate; it does not remove it. Projected outcome: the owner-gated queue drops from 81 to
  roughly 30. **That is a projection from heading-level bucketing, not a promise** — Q-254 re-tags
  each row properly.

### [app-shell] 🟠 The app's containers are organised by build order, not by convention — 13 findings from the 2026-08-14 UI/flow/IA review

- Owner-requested review of UI and "flow/location":
  [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](docs/reviews/2026-08-14-app-ui-flow-ia-review.md).
  The screens are mostly well built; the **container layer** is the problem. Nothing is missing, a
  lot of it is unfindable.
- **The five structural ones:** More → Profile is thirteen kinds of thing in one 845-line scroll
  (**Q-232**, the umbrella — needs a written plan before any of these are built); admin/user
  administration is mixed with developer diagnostics and both hide at the bottom of that scroll
  (**Q-234**); the Program Builder lives in More under a sub-tab *also* called "Workout"
  (**Q-235** — already caused Q-223; ✅ resolved 2026-08-15, and it had caused a second one,
  **Q-256**); four device-pairing cards sit inline with no Devices screen
  (**Q-233**, the other half of Q-111); Nutrition's actions are placed by scroll depth, with
  "End of Day" and "Saved Meals" below every meal card (**Q-237**, feeding Q-112). ✅ **All five
  structural items are resolved (2026-08-15)** — Q-232's own restructure, Q-233, Q-234, Q-235 and
  Q-237; see the status entries above.
- **Two dead surfaces found by reachability grep:** `/overview` is a 543-line screen with **zero**
  in-app entry points, duplicating Home (**Q-236**); Health's card ordering/hiding has live readers
  and **no callers for either writer** (**Q-238** — same shape as Q-180). ✅ **Q-238 is resolved
  (2026-08-14, v1.307.2)** — deleted rather than rebuilt, because git shows the UI was removed
  deliberately in June 2026 and the machinery simply outlived it; see the status entry above. ✅ **Q-236 is resolved (2026-08-15)** — screen, its orphaned readiness card and its
  background palette deleted; the `/sheet/[id]/*` shims kept and their expired rationale filed as
  **Q-255** for the owner. ✅ **Q-255 is resolved (2026-08-16)** — the owner confirmed no external
  link uses a `/sheet/...` URL, so all three shims were deleted.
- **Plus:** six screens reachable from exactly one card each (**Q-239**), water logged from Home
  over-invalidates five instant-paint caches it does not feed (**Q-243**), `day-log:` fetched with
  two different TTL expressions (**Q-242**), and hex literals up 430 → **471** in five days with
  nothing mechanising the theme-token rule (**Q-244**). ✅ **Q-244 is resolved (2026-08-15)** — a per-file
  shrink-only baseline now ratchets it; the 471 are recorded, not swept. ✅ **Q-242 is resolved (2026-08-15,
  v1.307.3)** — and it was three divergent keys, not one; the scan is now a Custom Rules check. See
  the status entry above.
- **What the review confirmed healthy, measured not assumed:** all 33 Custom Rules steps pass; zero
  `invalidateCache()` call sites outside `lib/cache-groups.ts`; 73 cache keys all reachable from an
  invalidation group; one fetch variant per key; every `body-metadata` read guarded by
  `isBodyMetadataFresh`; 204 API routes none caching; every admin route `requireAdmin`-gated; the
  service worker's two-generation retention makes deploy-time cache busting sound.
- **Not checked** (cannot be, in the sandbox): native SQLite/Capacitor paths, safe-area on device,
  Samsung WebView rendering, real device pairing, drifted production data. Every finding is from
  source reading and static analysis; **none was exercised on the S25**.

### [workouts] 🔴 AI prescriptions never expire — `prescriptionExpiresAt` is stored and never checked (Q-229, 2026-08-14)

- **Found investigating Q-228, same live session.** The owner's "Upper" session's AI prescription
  (`session_periodization` row `a4fec65d-95e6-44d2-8091-95c7e35e6003`) was generated **2026-08-06
  22:11:55 UTC**, with `prescription_expires_at` set to exactly 7 days later
  (**2026-08-13T22:11:55Z**, confirmed by direct calculation). Today, 2026-08-14, well past that
  expiry, the app served the owner **the exact same prescription object, unchanged digit for
  digit** — same `pct`/`reps`/`sets` for every one of the 5 exercises — for a live, real workout.
  `updated_at` on that row is **2026-08-13T22:28:18Z, 16 minutes AFTER its own expiry**, meaning the
  row was touched (re-consumed) past expiry without a fresh generation.
- **Root cause, confirmed by reading the only two places `prescriptionExpiresAt` is referenced in
  the whole codebase**: it is written correctly at generation time
  (`generate-prescription.ts:654`, "the last real session wins" pattern), but the ONLY place it is
  ever *read* is `shouldTriggerEmergencyDeload` (`emergency-deload.ts:19`) — and there it gates a
  narrow, unrelated case (suppressing re-offering a *pending* emergency-deload while its own offer
  window is open). **Nothing anywhere compares `prescriptionExpiresAt` against `now` to force
  regeneration of an `auto_applied` prescription once it goes stale.** The only two conditions that
  ever trigger `needsRegenerate` in `reevaluatePrescriptionForToday`
  (`packages/shared/src/ai-periodization/reevaluate.ts`) are an emergency-deload signal
  (overtraining/illness/injury/ACWR) or a whole-session soreness deload — plain calendar expiry is
  not one of them. `reevaluate.ts`'s own doc comment (lines 84-86) states the intended design
  outright: *"A prescription generated after the previous session is consumed up to 7 days
  later... without re-running Gemini"* — the 7-day boundary is real intent, just never enforced.
- **Effect**: any session type not actually re-run within its own 7-day window keeps replaying its
  last AI-generated numbers indefinitely — no new LLM-computed load, set, or rep progression happens
  for that session until an emergency or soreness signal happens to fire for an unrelated reason.
  This is a plain calendar-time gap, not a per-user data issue — it reproduces for any account
  whenever a session type in their split goes unused for more than a week, which ordinary program
  variety (e.g. an Upper/Lower/Push/Pull/Legs split, a missed week, travel) makes routine, not rare.
- **Compounds with Q-228 on today's Incline Bench Press number specifically**: the replayed 83%
  target was computed against Q-228's separately-poisoned 1RM, so that exercise stacked two
  independent bugs into one dramatic-looking jump. Barbell Overhead Press (this entry) shows the
  bug in isolation — its 1RM basis is correct (57.5 kg, matches the Q-115-corrected true max) but
  the replayed 52% (an original deload-era percentage from 2026-08-06) is simply the wrong intensity
  for a live Intensification-phase set 8 days later.
- **Not yet done**: the fix (an explicit `now > prescriptionExpiresAt` check forcing
  `needsRegenerate: true`) and a sweep for how many other users/sessions are currently serving an
  expired prescription. See Q-229.

### [workouts] 🔴 A stray pre-Q-115 deload log is still poisoning one exercise's prescribed weight (Q-228, 2026-08-14)

- **Live, currently affecting the owner's in-progress workout.** Today's Incline Bench Press
  prescription (Intensification phase) showed **72.5 kg** (83% of an 86.25 kg "1RM"), against a
  genuine recent working weight of 62.5 kg × 6-7 reps at 80% (2026-07-30) — an unearned ~11 kg
  overload the owner caught before loading the bar and reported live.
- **Root cause: Q-115's own corrective migration (`168_q115_whole_session_deload_pr_correction.sql`,
  2026-08-07) fixed 4 of the 5 exercises corrupted by the 2026-08-06 whole-session-deload bug, and
  missed the 5th.** All 5 exercises logged in that one corrupted session still show
  `exercise_deloaded = true`; the migration zeroed `estimated_1rm` on 4 of them (Overhead Press,
  Skull Crusher, Preacher Curl, Pulldown) but Incline Bench Press — exercise 1 of that same session,
  logged 21:41 UTC, just before the migration's audited 21:47-22:09 window — was never touched, and
  still carries the original inflated `estimated_1rm: 85.75`. Confirmed directly against production
  via the read-only admin endpoint, not inferred.
- **Deeper structural gap this exposed: `getLastRealOneRmBatch` (`lib/data/postgres/adapter.ts`)
  never filters on `exercise_deloaded`.** It picks the most recent log with `estimated_1rm > 0`,
  relying entirely on the write-time invariant that a deloaded set always stores `estimated_1rm = 0`
  — an invariant this exact row already disproves. The sibling query `reconcilePersonalRecord` in
  the same file explicitly filters `eq(exerciseLogs.exerciseDeloaded, false)` "mirrors
  shouldCountTowardPr's per-exercise deload gate" — `getLastRealOneRmBatch` is the one query in this
  family missing that same defensive filter, so any future write-time regression (or any other
  straggler like this one) silently poisons the very next prescription for that exercise, for every
  user, with no read-time backstop.
- **Scope, confirmed for the owner's account**: exactly one row (`exercise_logs` id
  `c4e3d87d-b357-4f08-8910-dfe3462611ca`) currently has `exercise_deloaded = true AND
  estimated_1rm > 0` — this is not an ongoing leak, just one missed straggler plus a real gap in the
  defense that let it leak into today's prescription. See Q-228 for the fix (read-time filter + a
  Q-115-style corrective migration for this one row).
- **Not yet done**: the code fix and the corrective migration — this is the live-investigation
  finding, queued for an implementer session.

### [devices][platform] ⚠️ The step-decoder table now loads over the network — NOT device-verified (Q-221, 2026-08-13) · needs: browser

`steps_motion_decoder_2_0_0`'s dequantisation table used to be bundled, so it was always present.
It now comes from session-gated `GET /api/oura-ble/decoder-constants` and is cached client-side
(`cachedFetch`, seeded synchronously). **Verified in the bundle** — none of the table's column names
appear in any of the 154 client chunks of a fresh build. **Not verified on the device**, and the
untested path is the one the caching exists for:

1. one online session (fetch + cache), 2. kill the app, 3. relaunch with no network, 4. walk.

`getLocalStore` returns null in the sandbox and the BLE plugin does not run there, so this sequence
is device-only. Until it is run, treat offline ring-cadence as unproven.

**Known and intended:** before the first successful fetch, ring-cadence confirmation and the cadence
tracker do nothing. `runStepsMotionDecoder` throws on an absent table rather than guessing, because
decoding without it produces plausible wrong physical values. On a genuinely first-ever launch with
no network there is therefore no ring cadence until the app has been online once.

### [nutrition][platform] ⚠️ Barcode scanning failed for the owner ~22:20 Brisbane 2026-08-13, recovered on its own, cause UNRECORDED

**Reported live** ("im still unable to scan barcodes"), then **"its working now — about 1 hour ago
it didnt work"**. It is working; that is the whole of what is established. *Something that stopped is
not something that was fixed.*

**What was checked while it was still fresh:**

- **Open Food Facts is up** — a real product lookup returned `status: 1, product found`, HTTP 200 in
  **0.86 s**. So this is not a repeat of the 2026-08-13 OFF outage.
- **Nothing barcode-shaped reached production.** The live deployment (12:01 UTC) had **9 HTTP
  requests total** and **zero** to `/api/nutrition/*`. Either the attempt predates that deploy, or the
  app never got as far as calling the lookup.
- **`error_events` has nothing, and structurally cannot** — see below.

**Why there is no evidence, which is the actual finding:** `/api/nutrition/barcode` caught its OFF
failure, did `console.error`, and returned 503. It never called `reportServerError`, so the failure
left no row in `error_events` and Railway stdout for that window is gone. **Q-218 gave exactly this
treatment to the sibling `/api/nutrition/scan` route and stopped there.** Fixed now — the barcode
route reports — so a recurrence will be diagnosable. The other **12** `app/api/nutrition/*` routes
still do not report; barcode was fixed because it is the one that just failed, not because it is the
only gap.

**The plausible-but-unproven story:** the same event-loop starvation that measured the owner's photo
scan at *200 in 129,073 ms* (Q-213). Q-213 Stage 2 deployed at 12:01 UTC, and `/api/oura-ble/samples`
— the route that was returning 500s after 27.6 s — now measures **76–458 ms** in production. That is
consistent, and it is not proof: a barcode request was never recorded either way.

**Do not close this from the recovery.** If it recurs, `error_events` will now hold the reason.

### [platform][devices] ⚠️ Production stalls — all three Q-213 stages shipped 2026-08-13; production has now confirmed them, the device has not · needs: android

**Stage 1 shipped.** `aggregateOuraRawSamples` re-read, hex-decoded and re-derived a 35-day window of
`oura_raw_samples` on every BLE sync — **984,862 rows against ~37 days of history**, i.e. the whole
table, to absorb the few minutes a sync carried. Runs outlasted the gap between syncs, went
back-to-back, and pegged the single Node main thread for 15–30 minutes, starving everything else on
the process. Measured symptoms: `/api/version` (no DB, bounded to 5 s) at **122,044 ms**; the owner's
food photo scan at **200 in 129,073 ms** — it worked, the phone gave up first.

It now re-derives only the span an ingest touched. **Measured 10,560 ms → 930 ms (11.4×)** on a
seeded 35-day table; production has ~40× the rows and the narrowed cost does not scale with history,
so the real gain is larger. The `hrSeriesCutoffDs` clamp is load-bearing — without it a narrowed run
would delete up to 13 days of HR series it could no longer rebuild — and is mutation-tested.

**Why this stays ⚠️ rather than ✅:**

- **Not device-verified.** The BLE plugin does not run in the sandbox; the ingest path was exercised
  through the route and repository only, against a seeded table 40× smaller than production.
- ~~**The first rollup after each deploy is still a full-window pass**~~ — **fixed 2026-08-13
  (v1.303.2)**, and it was worse than "expected": measured at **six minutes of a pegged main thread**
  (CPU 1.8, memory 2.19 GB, `/api/version` 10–28 s), paid on every one of the day's five deploys. The
  watermark is now persisted in `oura_rollup_state` (migration 184), so a cold start narrows from
  where the last run reached. **The proof is the next deploy** — that plateau should not recur at
  container start.
- ~~**Stage 2 — move the run off the request event loop**~~ — **shipped 2026-08-13.** The ingest route
  dispatches through `runRollupOffLoop` into a `worker_threads` realm with its own `pg` pool
  (`PG_POOL_MAX=2`; a replica running a rollup holds 12 connections, not 20). Measured main-thread lag
  during a rollup: **185 ms of a 262 ms in-process run → 4 ms of a 439 ms worker run**. A missing or
  unstartable worker bundle **falls back to in-process**, i.e. to the prior behaviour — proven by
  deleting the bundle and watching the correctness test still pass. Journal:
  [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md).
- ~~**Stage 3 — the coalescing predicate**~~ — **shipped 2026-08-13.** `frames.length < 255` meant
  "any batch", not "the drain's last batch", so it bypassed its own 8 s window nearly every time. Now
  a trailing-edge debounce with a max-wait (`lib/oura-ble/rollup-debounce.ts`, 3 s / 20 s). Dev:
  three batches in quick succession → three 200s and **one** rollup.
- ~~**The admin redecode route**~~ — **shipped 2026-08-13.** Both phases go through the worker,
  keeping the route's per-phase errors. Journal:
  [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md).
- **Why this stays ⚠️ with everything shipped:** none of it is confirmed by production yet. The one
  number so far is `POST /api/oura-ble/samples` at **76–458 ms** on the live deployment, against 500s
  after 27.6 s during the outage — pointing the right way, over one quiet hour. Both of the outage
  session's confident cost predictions were wrong and only production caught them. Keep watching
  Railway CPU for the sustained 1.0–1.6 plateaus and `/api/version` latency.

**First production evidence, 2026-08-13** — the ring synced at 15:47 after the watermark deployed:

| | duration | CPU | memory |
|---|---|---|---|
| before Stage 1 | 15–30 min | 1.0–1.8 | 0.9–2.2 GB |
| cold start, Stage 1 only (14:45) | 6 min | 1.8 | 2.19 GB |
| seeding pass, with watermark (15:47) | **2 min** | **0.815** | **0.553 GB** |

**But a concurrent ingest still 500'd** at 15:47:33 after 27.6 s, starved by that 2-minute pass. A
non-2xx on `/api/oura-ble/samples` holds the ring cursor and triggers a re-drain. **Narrowing cannot
remove that — only Stage 2 (the worker thread) can**, and that was the hard evidence it was necessary
rather than tidy. Stage 2 has since shipped; **whether it actually holds is a claim about production
and nothing else settles it** — both of the outage session's confident cost predictions were wrong,
and only production caught them.

Keep watching Railway CPU: the sustained 1.0–1.6 plateaus should stop recurring. `/api/version`
latency is the cheapest ongoing probe — it should stay in milliseconds.


**✅ RESOLVED — production has now confirmed it, 2026-08-20.** The whole retained `error_events`
window (2026-07-20 → 2026-08-19; the table prunes at 30 days and is row-scoped to the owner) grouped
by day, counting the two connect fingerprints, this route, and the two fan-out routes:

| day | connect-timeout | `/api/sync/pull` | body-battery + readiness-score | all events |
|---|---:|---:|---:|---:|
| 08-19 | 0 | 0 | 0 | 1 |
| 08-18 | 0 | 0 | 0 | 1 |
| 08-17 | **1** | 0 | 0 | 8 |
| 08-16 | 0 | 0 | 0 | 1 |
| 08-15 | 0 | 0 | 0 | 1 |
| 08-13 | 16 | 1 | 2 | 757 |
| 08-12 | 39 | 0 | 2 | 2,556 |
| 08-11 | 20 | 1 | 0 | 38 |
| 08-10 | 16 | 1 | 0 | 31 |
| 08-09 | 33 | 1 | 3 | 2,615 |

**Every one of the three families stops dead on 2026-08-13**, the day Q-213's stages shipped. The
single connect-timeout since then landed on 2026-08-17, inside the unrelated `disk_full` outage that
day (the same date carries two `[pg 53100]` rows). Six days, one event.

**Two limits on this, stated rather than left implicit.** `claude_ro.error_events` is scoped to the
owner's rows, so this is a claim about the owner's account and not about anyone else's; and it is a
claim that the fault stopped, which the "stopped is not fixed" rule says to hold loosely — except
that here the stop coincides exactly with a shipped fix whose mechanism predicts it, which is the
one case where a silence is evidence. The app was in use throughout: `set_hr_stats` rows were
computed on 08-15, 08-16, 08-17 and 08-19.

**This row stays ⚠️ rather than moving to the archive** for the one gate that is left: none of the
three stages has been exercised on the S25. The BLE plugin does not run in the sandbox, so the
ingest path was only ever driven through the route and the repository, against a seeded table 40×
smaller than production.

### [platform][readiness] A check-in tapped during the local-store init window was silently lost (fixed v1.302.1, 2026-08-13) — NOT verified on device · needs: hardware

- **What happened**: `getLocalStore()` screens out the *dead* store (K4) but not the
  *not-open-yet* one. `_db` is null for the whole of `initSQLite` — versioned upgrade, WAL pragma,
  then a full `reconcileSchema()` pass — which is seconds on the first launch after a release that
  adds a local migration (v25, #1282). A Save landing there hit `if (!_db) return`: nothing
  written, nothing queued to the outbox, `savedLocally = true`, success toast.
- **Confirmed, not inferred**: production has **no `day_checkins` row for 2026-08-13** and no
  client error anywhere to explain it.
- **Fixed in #1292**: `runSQL` waits for an in-flight open and throws on the canonical runtime if
  the DB never opened, so write sites take their API fallback; the morning check-in gained the
  fallback it never had. Reads and cache writes stay soft deliberately.
- **Separately**, both check-in sheets stopped blocking their close on the local write — the
  ~2 minutes of "Saving…" the owner saw was a tap queued behind the sync pull's `applyDelta`
  transaction on the plugin's single SQLite connection. That underlying hold is **not** fixed;
  it is queued as **Q-214a** — renumbered 2026-08-30, because the `Q-214` cited elsewhere in this file is the already-shipped `upsertOuraHeartrate` fix, a different piece of work.
- **Not exercised**: the S25. Native SQLite does not run in the sandbox, so the init window this
  fixes cannot be reproduced here. The on-device check is a force-stop, reopen, and tap Save on
  the readiness sheet within a second or two of the app appearing.

### [workouts] Deload now reduces every exercise, not just prescribed ones (v1.301.0, 2026-08-12) — NOT verified on device · needs: browser

- **What changed**: a branch after the AI prescription block applies `deloadOverrideForGoal` to any
  ai_dynamic exercise the prescription does not cover, when a deload is active. Q-185, owner decision.
- **Expected behaviour change, not a bug**: deload weeks will feel noticeably easier. The owner was
  told this is the largest-change option of the three offered and chose it.
- **Verified end-to-end**: ai_dynamic program, `early_deload_week_start = CURRENT_DATE`, no stored
  prescription. `origin/main` returned all nine exercises at 75% / 3 sets with `deloaded: false`;
  this build returns 50% / 2 sets, `deloaded: true`.
- **Not exercised**: the S25, and the partially-covered case against a *real* model-generated
  prescription (covered by fixture-based unit tests instead).
- **Related, now fixed**: **Q-211** — a deload week also reduced a *baseline* lift, which the 1RM
  and PR paths both treat as a genuine max effort, so the app prescribed half weight and recorded
  the result as a real max. Fixed 2026-08-30 (v1.402.1), and **it took two guards, not the one the
  entry named**: exempting only the prescribed branch left the behaviour unchanged, because the
  un-prescribed branch re-applied it. Its comment saying such a clause was unreachable was true
  against the code that proved it and false the moment the first exemption landed.
### [workouts] Prescription basis changed to the last non-deload session (v1.300.0, 2026-08-12) — NOT verified on device · needs: browser

- **What changed**: `resolveWorkingBasis` returns the last non-deload 1RM outright instead of
  `max(lastLog, seed, allTimePr)`; new `getLastRealOneRmBatch` supplies it and also carries
  `target80`. Q-202, on an explicit owner decision.
- **Expected behaviour change, not a bug**: one light or interrupted session now lowers the next
  prescription. The owner was offered a smoothed "best of the last ~3" variant and declined it. If
  this proves annoying in practice, that variant is a small change from here.
- **Verified end-to-end on the dev server** against a seeded fixture (last real session 72, PR 98):
  `origin/main` returned `estimated1rm: 98`, this build returns 72 with the PR untouched. Adding a
  deload log after it kept the basis at 72 and restored `target80` from 0 to 57.5.
- **Not exercised**: the S25. Nothing here touches safe-area or a native plugin, but the weight
  dial's pre-filled value is a real on-device behaviour and the `target80` half changes it — worth
  confirming the dial opens at a sensible weight on the first session after a deload.
- **Not exercised**: drifted production data. An exercise whose entire history predates the deload
  suppression may carry `estimated_1rm` NULL rather than 0; those are excluded the same way (which
  is correct), but such an exercise falls back to seed/PR rather than to a real session.

### [devices][app-shell] More/Profile ring battery now reads the live BLE poll (v1.290.2, 2026-08-12) — NOT verified on device · needs: hardware

- **What changed**: `components/more/oura-section.tsx` prefers `/api/oura-ble/battery-latest` over
  the frozen Cloud value; `oura-ble-battery-latest` added to `invalidateOuraSync()`; the card's
  tab-show refresh now re-fetches the battery. Q-205.
- **The "Not live" state could not be reproduced locally, in either direction.** It needs the Oura
  Cloud call to *succeed* and return an old timestamp. With no real token the call rejects,
  `batteryLevel` stays null, and the local before-state is **no badge at all** rather than "Not
  live". The fix was verified against that local before-state (no indicator → `68%`); the
  owner-device before-state is established from the code path, not observed.
- **Verified**: seeded `oura_tokens` + one `oura_ble_battery_poll` at 412×915. Fresh poll (12 min,
  68%) → coloured `68%`; aged poll (5 h, 41%) → muted `41%` with
  `title="Ring battery 41%, last seen 5h ago"`. `origin/main` showed no battery indicator in both.
  Seeds deleted afterwards.
- **Not exercised**: the `useRefreshOnTabShow` path (fires on native tab visibility changes), the
  Samsung WebView compositor, and safe-area insets.

### [devices][app-shell] Ring-battery chip removed from Home (v1.290.1, 2026-08-12) — NOT verified on device · needs: hardware

- **What changed**: `OuraBatteryChip` removed from the Home header's right-hand icon cluster;
  `components/oura-battery-chip.tsx` deleted (Home was its only call site). Q-203.
- **Verified in the web sandbox only.** Proven falsifiable first — the local fixture returns
  `{"latest":null}` from `/api/oura-ble/battery-latest`, so the chip renders nothing either way and
  a plain before/after smoke run proves nothing. Seeded one real `oura_ble_battery_poll` row (72%,
  10 min old) and confirmed at 412×915 that `origin/main` renders
  `aria-label="Ring battery 72 percent"` in that cluster and this build does not, with the rest of
  the header byte-identical and no console or page errors. Seed row deleted afterwards.
- **Not exercised**: the Samsung WebView compositor, and safe-area insets (which render as 0 in the
  web sandbox). This is a header layout change, so the header's `pt-safe` clearance is the thing to
  eyeball on the S25 — nothing in the diff touches it, but the row width changed.
- **Also not exercised**: the Health tab's Ring Status card, which is the surface that keeps the
  live battery reading. `OuraSection` early-returns on `if (!data?.connected)` and the local
  fixture has no Oura token, so it could not be made to render here. That it reads the live BLE
  endpoint is established from source, not observed.

### [nutrition] Saved-meal batch servings + local SQLite v25 (v1.292.0, 2026-08-12) — NOT verified on device · needs: android

Journal: [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md) ·
plan: [`plans/2026-08-12-meal-plan-portions-and-editing.md`](docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md)

**The local migration is the risk, not the feature.** Local SQLite v25 adds
`saved_meals.servings` as an `ALTER` that has only ever run against the dev harness — native SQLite
does not exist in the sandbox, and this project has had the local DB die on Android twice from
migration bugs. Needs an app launch on a device already holding a **v24** database as the first
device check. All three parts are in place (ALTER + `CREATE TABLE` body + `RECONCILE_COLUMNS`) and
pinned by tests, but that is the shape being correct, not the upgrade being observed.

Also unexercised on device: offline create/edit of a batch meal, and the cross-device pull of
`servings`.

**Behaviour change worth knowing:** raising a meal's serving count changes what its "Log this meal"
button writes — one portion, not the batch. Existing meals default to 1, so nothing moves until a
count is set.

### [nutrition][app-shell] Ingredient search, gram-level meal editing, sheet close-button clearance (v1.290.0, 2026-08-12) — NOT verified on device · needs: browser

Journal: [`docs/overview/history-2026-08-12.md`](docs/overview/history-2026-08-12.md)

Verified only in headless Chromium at 412×915. Safe-area insets read 0 in the sandbox and Samsung's
WebView renderer is absent, so three things need `docs/device-smoke-checklist.md` on the S25:

- **The `SheetHeader` clearance change is app-wide** (`components/ui/sheet.tsx`), so it touches all
  45 sheet call sites, not just the nutrition ones. Measured correct at 412px; check a few headers
  with right-aligned controls on-device.
- **The grams input** in the meal builder uses a numeric keyboard (`inputmode="decimal"`) that the
  sandbox does not render.
- **Open Food Facts availability is outside our control.** It answered 3/3 probes at ~1.3 s during
  this session but has returned 503 before, which is why the route reports `unavailable: true` and
  the UI says the database is not responding rather than showing an empty list. That failure path
  *was* exercised for real during verification; the success path on a phone was not.

No migration, no schema change and no sync-path change in this release.

### [nutrition] Meal Plan Phase 1 (v1.282.0, 2026-08-11) — NOT verified on device · needs: browser

Journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md) ·
plan: [`superpowers/plans/2026-08-11-meal-plan.md`](docs/superpowers/plans/2026-08-11-meal-plan.md)

Shipped: build/edit/activate a plan with optional training-rest variants, a six-step setup sheet, a
searchable per-user dietary-restriction picker, the ~4-week review card, the saved-meals uplift, the
`getMealPlan` coach tool, and local SQLite v23 for offline rendering.

**Not verified on device, and the untested surface is larger than usual.** The sandbox reports
safe-area insets as 0 and has no native SQLite, so *none* of the local-store path has run: the v23
upgrade, `getActiveMealPlan`, and the `applyDelta` arms are all unexercised, as is the setup sheet's
real bottom clearance. Needs `docs/device-smoke-checklist.md` on the S25 — specifically an app
launch on a device already holding a v22 database, to prove the upgrade lands.

**The AI does not verify allergens, and no screen claims it does.** Structured capture makes the
restriction reliable; the model's filtering is best-effort. The review step shows ingredients beside
a must-not-contain list and says the plan was written by AI. Do not add a shield, badge or tick to
that screen, and do not let any automatic action depend on the filtering having worked — that is
also why Q-187's prefill must prompt per meal.

**Three gaps in the first cut, fixed in v1.283.0:** the "Save to my meals" switch was decorative,
nothing could deactivate or delete a plan, and "Manage plan" opened the new-plan wizard. Found by
re-reading the shipped code rather than by testing it — worth noting because all three would have
looked fine in a click-through.

**One stale CLAUDE.md entry found, not fixed:** `nutrition/saved-meals-sheet` is listed among the
nine hand-rolled chevron toggles missing `aria-expanded`. It has no chevron toggle at all. Only that
one entry was checked, so the count in CLAUDE.md is left alone rather than decremented on a guess.

**Portions, per-meal reroll, macro bars and a real manage sheet followed in v1.287.0** —
journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
Ingredient weights are now sized in code per variant (`scaleIngredientsToTargets`), so a split plan
no longer shows a permanent shortfall on whichever variant it was not sized for; a single meal can
be rerolled without touching the others; each meal shows a bar per macro against its target; and
meals-per-day / training-time / retarget are editable as instant re-splits.

**The riskiest untested change in that batch is offline, not visual.** A re-split deletes the
server's variants and writes new ones with new ids, and `applyDelta` previously only upserted by id
— a device pulling a 5→3 re-split would have rendered **8** meals. The delete-then-insert-by-parent
fix is in, but it can only be exercised on a device that already holds a plan and then pulls a
re-split. Add that case to the smoke run.

**A saved plan is now editable meal-by-meal (Q-192/Q-193, v1.288.0)** —
journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
Per-meal reroll previously worked only during review, and that was not a UI gap: `meal_plan_meals`
stored a name and four targets and **discarded the ingredients on save**, so there was nothing to
re-scale or replace. Migration 180 persists an ingredient snapshot; Manage plan → **Edit meals**
swaps, rerolls or renames one meal without touching the rest. Setup gained a **Meals you already
eat** step that keeps chosen library meals verbatim (portions resized) and takes free-text steers.

**The v24 local migration is the thing to watch on device.** Unlike v23 (table creation only) it is
ALTER-based, so a device already holding a v23 database is the case that matters, and no local-store
path has ever executed in the sandbox.

**Two near-misses worth remembering when regenerating `claude_ro` views:** capturing the generator
with `2>&1` puts its summary line inside the SQL (migration failed to parse on every boot), and
passing a local `CLAUDE_RO_OWNER_USER_ID` scopes every production view to a user that does not exist
there. Diff a regenerated views migration against its predecessor — the only difference should be
the new columns.

**Typed meals now get looked-up macros, and Saved Meals has a real UI (Q-194/Q-195, v1.289.0)** —
journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
Typing a meal into a plan calls the existing `/api/nutrition/scan` text mode (no new AI route), so it
becomes a keepable meal rather than only a steer. Saved Meals gained a per-ingredient breakdown, a
macro split bar, a delete confirmation, and multi-select delete.

**Prompt lesson worth keeping:** "do not repeat these" did NOT stop the model regenerating a kept
meal into the very next slot. The wording that works — already proven in the per-meal reroll route —
is "the plan ALREADY contains these; everything you return must be genuinely different food". Found
by reading a real generation, not by review.

**Known limitation, not a bug in the plan:** the nutrition-targets screen still lets you save macros
that do not sum to your calorie goal (the seeded account holds 150P/180C/60F beside 1,750 kcal =
1,860). The plan reconciles at read time — calories win, protein and fat kept, carbs refitted — and
says so on the review step, without writing to the saved targets. Enforcing it at source is a
backlog item on the targets editor.

### [nutrition] Energy Balance + calibrated maintenance (v1.280.0, 2026-08-11) — NOT verified on device · needs: browser

Journal: [`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md)

Shipped: the five-band Energy Balance card on Nutrition, Health and (optional) Home; calibrated
maintenance from logged intake vs weight trend; one calorie target across the app; the
`getEnergyBalance` AI tool.

**Root cause of "it was never visible":** the `energyBudget` card's `case` lived in
`renderTrainingSection` while the key is listed only in `BODY_GROUPS`, and no training order
contains it — so it fell through to `default: return null` on both tabs and had **never rendered
anywhere**. Fixed by moving the case to `renderBodySection`.

**Not verified on device.** Rendering was confirmed at the 412×915 S25 viewport in the sandbox
(Nutrition, Health and Home), but the sandbox reports safe-area insets as 0 and has no native
SQLite, so the card's real bottom clearance and any local-store read path are unexercised. Needs
`docs/device-smoke-checklist.md` on the S25.

**Calibration will not engage for ~2 weeks.** Food logging stopped 2026-07-26 (1 logged day in
August, 11 in July), and the estimator needs ≥10 logged days at ≥70% window coverage. Until then
the card shows the Mifflin-St Jeor baseline with a countdown, which is the intended state, not a
fault. Expect it to switch to "measured" around 2026-08-24 if daily logging holds.

**Production still has two different saved targets** (`users.calorie_goal` 1950 vs
`nutrition_targets.calories` 1750) until the first write after this deploy. Both write paths now
mirror, so any target edit — including accepting the Calorie Nudge — converges them. No migration
was written to reconcile the existing rows.

**Latent (not live): `listBodyMetrics` does not filter `deleted_at`.** The column exists on
`body_metrics`, the repo read ignores it, and the calibrated maintenance consumes those rows for its
weight slope — so a deleted weigh-in (e.g. a bad scale reading) would still skew the estimate.
**Currently harmless: no code path soft-deletes a body metric, and production has 0 such rows of the
owner's** (checked 2026-08-11). Not fixed here because the change touches ~10 consumers and
overlaps open PR #1244's soft-delete work. **If a body-metrics delete path is ever added, this must
be filtered in the same PR.**

**Weekly calorie goals convert on the mirror.** `users.calorie_goal` may be a weekly total while
`nutrition_targets.calories` is always daily. Caught pre-merge: mirroring a 13,650 kcal/week goal
straight across wrote 13,650 into the daily macro target. Both directions now convert via
`goalToDailyKcal`/`dailyKcalToGoal` and the user's daily/weekly preference is preserved.

### [platform][nutrition][readiness] ✅ Deleted rows coming back was 96% untested — COVERAGE COMPLETE 2026-08-11; mood logs' missing server filter is still open (2026-08-09)


Review:
[`docs/reviews/2026-08-09-soft-delete-mutation-coverage.md`](docs/reviews/2026-08-09-soft-delete-mutation-coverage.md)
· journal:
[`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md)

The ownership mutation harness, pointed at soft-delete filtering. **113 filters neutralised, 371 of
372 tests still passed** — one test notices, as a side clause. Every slice was at zero except
`programs.ts`. **109 of 113 (96%) provably unguarded**, worse than ownership's 38%, on a class whose
symptom is directly user-visible: *"my deleted workout is back"* is the mirror of the
"my data disappeared" reports already tracked here.

**Shipped:** `repository-soft-delete-filtering.test.ts` — 7 tests over injuries, supplements,
activity logs, fitness tests, food logs and workout sessions, each asserting present-before /
absent-after so a failed seed cannot pass. 7/7 fail under mutation. `adapter.ts` 0 → 6,
`nutrition.ts` 0 → 1.

**~~Deliberately incomplete~~ — finished 2026-08-11.** The remaining 35 (`user-stats.ts` 7 in #1244,
`periodization.ts` 17 in #1251, `oura.ts` 11 after that) all have attributable tests now, each of the
35 verified by individual mutation. **All 113 filters in the original sweep are covered or
accounted for.** Two things the burn-down taught, both worth more than the tests:
`getWeeklySetsByMuscleGroup` is two queries with three filters each and a case deleting only one
side leaves the other three untested — *counting* tests would have called it done; and `oura.ts` was
deferred for a whole entry as "needs a seeded rollup window" when its eleven filters are ordinary
work-list queries over sessions and sets. The estimate came from the slice's name.

**One real gap, filed as Q-178:** `mood_logs` carries `deleted_at` on the server *and* the device,
the local store filters it, and **all three server reads have no filter at all** — the device would
hide a deleted mood log while the server returned it. Latent (nothing server-side writes the column),
so filed rather than fixed: adding the predicate and dropping the column are both defensible, and
that is a product question.

**The static sweep followed, and found a live bug — Q-179.** 129 reads of the 13 soft-deletable
tables, 44 without a filter; most correct (13 are in `getSyncDelta`, which *must* return deleted rows
for tombstones, and only 6 of 13 tables are ever soft-deleted server-side). Two are live in-use
probes, and one reproduces: **delete your only food log for a meal type and the meal type is
undeletable forever**, refused with `MEAL_TYPE_HAS_LOGS` citing a log you cannot see.

**The obvious fix is wrong, and only a two-directional test showed it.** Adding the `deleted_at`
filter makes the probe pass, then the hard `DELETE` fails on `food_logs.meal_type_id -> meal_types`
(**ON DELETE RESTRICT**) — trading a clean domain error for a 500. Reverted. Q-179 lays out four
options; the cheapest destroys the sync tombstone. A decision, not a patch.

**Method note worth carrying:** the first mutator matched only Drizzle's `isNull()` and reported 86
filters, silently missing **27 raw-SQL** `deleted_at IS NULL` predicates. A scanner reporting a
*smaller* number is as suspect as one reporting zero. The mutation also cannot see a **missing**
filter — Q-178 surfaced only because a test written for it failed on clean code, and a systematic
static sweep for that has **not** been done.

### [platform][app-shell] ⚠️ The service worker's `/api/` passthrough changed — NOT device-verified (2026-08-09, v1.276.3) · needs: android

`public/sw-template.js`'s `/api/` branch now sends `cache: "no-store"`, and `cachedFetch` does the
same. This closes a measured bug — the browser HTTP cache sat under the app's own cache with no
invalidation path, so `DELETE /api/supplements/<id>` followed by `GET /api/supplements` kept
returning the deleted row for up to a minute (verified on a route that already ships the header on
`main`, so this was live, not hypothetical).

**The risk is where it was fixed, not what it fixed.** The service worker is the APK's network path
*and* its offline cold-start mechanism, and it deploys automatically (`app/sw.js/route.ts` stamps
the commit SHA into the template). Verified in Chromium — every main screen renders with the SW in
control, no `/api/` 4xx/5xx, and `POST /api/mood` (a write with a body, the case `no-store` could
plausibly break in a SW) returns 200 — but **not on the S25**. Also unexercised: the real offline
path with a populated seed. A service-worker fault on device is not subtle, so this belongs on the
next device smoke run.

### [app-shell][platform] ✅ One of the two sign-out buttons left the previous account's data on the device — fixed 2026-08-10 (Q-172, v1.277.3)

More → Profile signs out through `clearLocalStoreData()` → `clearAllCache()` → `signOut()`;
`components/chat.tsx`'s two buttons posted a bare `<form action={signOut}>` and did neither, so
`ta_cache:*` and the native store kept the previous account's data — and most keys carry no user id
(`weekly-stats`, `readiness-score`, `home-day-timeline`), so the next account painted from them via
`readCacheSync`. Invisible with one account per device, and in the way of the multi-user direction.

**Fixed 2026-08-10 (#1235, v1.277.3)**, and larger than the finding: the sign-out that *did* work
used a hand-written table list drifted to 27 of the schema's 37.
[`history`](docs/overview/history-2026-08-08.md).
⚠️ **Still not device-verified:** `clearLocalStoreData()` is a no-op on web, so the local-store half
has never run.

### [platform][nutrition] 🟠 90% of the DB suite is blind to a total loss of user scoping (measured 2026-08-09)

Full method:
[`docs/reviews/2026-08-09-ownership-mutation-coverage.md`](docs/reviews/2026-08-09-ownership-mutation-coverage.md)
· journal:
[`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md)

**The scoping is correct today — this is not a live leak.** Q-155 said one cross-user leak passes all
tests; mutation testing turns that into a number. All **246** `user_id` predicates in
`adapter.ts` + slices were neutralised at once and **286 of 317 DB tests still passed**.

- **`nutrition.ts` (22 predicates), `body-battery.ts` (1) and `social.ts` (1) fail ZERO tests** with
  every ownership check removed. Two quartiles of `adapter.ts` (69 predicates) behave the same.
- **Lower bound: 93 of 246 predicates (38%) unguarded.**
- The uncovered set includes ten destructive writes (`deleteInjury`, `deleteSupplement`,
  `deleteActivityLog`, `updateFoodLog`, `deleteSavedMeal`, …) and the bulk mutations
  `applyLbsToKgFix` / `reconcilePersonalRecord`. **`updateInjury` is among them** — the method
  CLAUDE.md calls *"the reference"* for the write-path ownership rule.
- The 31 tests that did fail are weaker evidence than they look: the failing set **varied between
  runs** (14–17 files), because with scoping gone the tests contaminate each other by execution
  order. Only 7 of 71 DB test files set up two users at all.

**Burn-down done across three passes, same day.** `repository-ownership-scoping.test.ts` is now
**36 tests**, each verified to fail under mutation. Re-measured: all-246 detection **31 → 75**,
detecting files **14 → 21**, `adapter.ts` **23 → 44**, slices nutrition **0 → 12**, body-battery
**0 → 1**, social **0 → 2**, and the two dead `adapter.ts` quartiles **0 → 13** and **0 → 7**.
**No quartile and no slice sits at zero.** The bulk mutations that worried me most —
`applyLbsToKgFix`, `previewLbsToKgFix`, `reconcilePersonalRecord` — are covered, two-sided (empty
result *and* the other user's stored rows unchanged).

**Fourth pass — the blind spot, audited statically (Q-174 filed).** Mutation cannot see ownership
enforced by a join or pre-check, so all **50** writes to `user_id`-less tables were classified by
hand. **13 of the 14 parent-id-keyed writes are correct** — `saveProgram`, `saveProgressionStyle` and
`updatePhaseSet` all carry affected-row-count guards citing Q-129, and `activity_types` is a global
catalogue behind `requireAdmin`. The one gap is the **volume-target family**: four methods taking a
`programId` with no `userId`, over a table with no `user_id` column, of which two have zero callers.
Safe today; filed as **Q-174** — and **fixed the same session**:
`listVolumeTargets(userId, programId)` now scopes via an `innerJoin` to `programs`,
`replaceVolumeTargets(userId, programId, targets)` carries an ownership pre-check with a row-count
guard inside the transaction before the DELETE, and the two dead methods were deleted rather than
fixed. Three new tests, mutation-checked, including a **positive** case proving the owner is still
permitted — without it, a guard that rejected everyone would have passed. Read-side over-filtering
was checked on a running dev server: a seeded target returns `{"targets":{"chest":16}}` for its
owner, and a forged `programId` returns 404, not 500.

**Q-155 stays open, and the reason matters.** "No range at zero" is far weaker than "all 246
covered": the quartile bisect bounds rather than attributes, so a range producing 7 failures is not
34 covered predicates. Exact attribution needs ~246 individual runs. Untouched entirely: ownership
enforced by a join or pre-check instead of a `user_id` predicate, and the full ~3,270-test suite —
only the 363 DB tests were measured.

**Carry this into any addition:** **four** assertions in that file could not fail as first written —
`getBodyBatteryHistory` returns a row shape with no `userId`, making `not.toContain(USER_B)`
unfalsifiable; `deleteFitnessTest` is a soft delete, so asserting on an untouched column could never
fail; `deleteMealType` throws `MEAL_TYPE_HAS_LOGS` before reaching the ownership check; and
`listSeasonsWithResults` reads a global table, so a leak attaches B's rank to a season A may
legitimately see rather than adding a row. Every one was caught only by running the new test under
mutation as well as clean. **Do that for each addition before counting it as coverage.**

**Limits:** DB suite only (317 tests), not the full ~3,270 — route/component tests were not measured.
Ownership enforced by a join or a pre-check (`ensureWorkoutSession`) is untouched by this method.
Local Postgres only; no device, no production data.

### [platform][app-shell][workouts] AI Coach — MOSTLY device-verified now; three items still owed (2026-08-09 → 2026-08-18)

**⚠ Partially cleared 2026-08-18 from owner screenshots of a real swap on the S25 — screenshots, not
a full smoke run, so it is evidence rather than a completed checklist.** What those images show
working on the device: the **composer clearing the gesture bar** (the item this row called "the one
that matters"), **header clearance** under the status bar and punch-hole, **Samsung WebView rendering**
of the widget cards including the green result card, and **real touch on the option rows** — the owner
tapped two of them and the swap applied end to end.

**Still owed, and the row stays open for these:** the composer **with the keyboard open**; **offline
behaviour in real airplane mode** (only `navigator.onLine` has ever been exercised); and the
**tier-3 `/coach/confirm/[toolCallId]` screen**, which an exercise swap does not reach — `program_phase`
is the only tier-3 domain, so confirming a swap proves nothing about it.

**This was the device gate for Q-157 phases 1 and 2, recorded because no S25 was available in the
session that built it.** Everything below was verified in Chromium at 412×891 in both themes and
against the local dev database; the phone has now covered the four items named above.

- **A second full-screen surface since this row was written:** `/coach/confirm/[toolCallId]`, the
  tier-3 hold-to-confirm screen, has the same navless bottom-anchored shape as the composer and
  the same unverified inset.
- **The one that matters: composer clearance.** `/coach` is a **navless full-screen route with a
  bottom-anchored composer** — the exact shape that has put a control under the gesture bar 11+
  times. It uses the floored `pb-safe-action-lg` and measures 64px of clearance in the sandbox, but
  the sandbox renders `env(safe-area-inset-bottom)` as **0**, so that 64px is the floor doing all
  the work and the real inset has never been added to it. Also unchecked with the keyboard open.
- **Header clearance** under the status bar / punch-hole (`pt-safe-or-4`).
- **Samsung WebView rendering** of the widget cards (`color-mix` tints, no blur/filter used).
- **Real touch** on the 56dp FAB, the 48dp back/history buttons and the 56dp option rows.
- **Offline behaviour behind the service worker** — airplane mode was not exercised; only
  `navigator.onLine` was.

Run the **AI Coach** section of [`docs/device-smoke-checklist.md`](docs/device-smoke-checklist.md)
and strike this row. Nothing here blocks use of the app — the three entry points and every other
screen are unchanged — but a composer under the gesture bar would make Coach awkward to type into.

**Also in this release, and worth a look on-device:** every `<Switch>` in the app rendered as a
black circle (the global 48px tap-target floor beats Radix's `h-5 w-9`); fixed in the shared
primitive, so the **goal-recommendation sheet** in Profile is the other surface to eyeball.

### [platform][app-shell] Three rules mechanised, one CI blind spot closed, two cache findings queued (2026-08-09)

Journal:
[`docs/overview/history-2026-08-08.md`](docs/overview/history-2026-08-08.md).
**No app behaviour changed** — CI scripts, workflow config and docs only.

**The pattern behind all of it:** every rule checked this session was either *in CI and holding* or
*written down and drifting*, with nothing in between. `check-timezone-rendering` has kept
device-local rendering at zero since it landed; the sparkline count went 5 → 6 days after it was last
re-verified by hand.

**Shipped (#1192, #1193, #1194):**
- `check-numeric-bounds.js` — an unbounded `z.number()` in a validation schema (Q-164). The
  `activity-log.ts` grandfather row was **deleted 2026-08-09** when that file was bounded in full, so
  the check now holds every schema in `validation/`+`validators/` with no exceptions.
- `check-sparkline-primitive.js` — a `<polyline>` instead of `components/ui/sparkline.tsx` (Q-154),
  six existing copies grandfathered. **Q-154 stays open** — the check stops a seventh, it does not do
  the replacement work.
- `check-local-column-upgrade-path.js` — closes a **real blind spot found by mutation-testing the
  existing checks**: `check-reconcile.js` scans `ALTER TABLE … ADD COLUMN`, so it cannot see a column
  added to a `CREATE TABLE IF NOT EXISTS` body. That column reaches fresh installs and is **missing
  forever** on upgraded devices, throwing on every `INSERT` that names it while tests, the web
  sandbox and fresh installs all stay green — the #85 class. **Zero live instances** across all 41
  commits touching `migrations.ts`, so it ships with no grandfather list.
- Three inline Custom Rules greps widened past `app/ lib/ components/` to include **`packages/`** —
  229 files, 21% of the TypeScript surface, and where `date-utils`, the validation schemas and the
  health formulas live. Verified clean at the new scope.

**Queued, not fixed:** **Q-165** — 171 client GETs use `cachedFetch`, **62 use bare `fetch`** (29
admin/debug consoles that should *not* be swept, 33 user-facing, ~24 genuine render-path reads after
excluding nine with a real reason to stay uncached). ~~**Q-166** — 44 of 124 GET routes carry no
`Cache-Control`, 24 after excluding admin/OAuth/webhook routes.~~ **Q-166 is done (2026-08-10), and
it inverted:** the headers came *off* rather than being added, and the ~13 headerless data routes got
an explicit `private, no-store`. Work Q-165 next; the client side is what the user sees.

**A deliberate non-decision worth keeping:** Q-165 is explicitly filed as *not* a CI-check candidate
yet. With nine legitimate exceptions in 33 cases, the exemption list would be as long as the violation
list — a rule that documents drift rather than preventing it. That is the opposite call from the two
checks above, and the difference is the size of the exception set.

**Not verified on device.** Nothing here touches runtime, but the local-column hazard is device-only
by nature and was confirmed by reading `reconcileSchema()` and by history sweep, never by running an
upgrade on hardware.

### [activity][platform] 🟠 A 69-day walk was accepted — and my own Q-151 was wrong (2026-08-09)

[`docs/reviews/2026-08-08-adversarial-input-review.md`](docs/reviews/2026-08-08-adversarial-input-review.md).

**✅ Q-164 — FIXED 2026-08-09 (v1.275.2).** `POST /api/activity-logs` with `durationMin: 100000`
returned 201 and persisted a single walk lasting 69.4 days. All 28 unbounded numerics in
`activity-log.ts` now carry named upper bounds, and the check's grandfather row is gone.

**Why the existing cross-field refine could not catch it.** Every rate check in
`activityImplausibleReason` divides by `durationMin` and is skipped when it is absent or zero — so a
single field on its own met nothing at all. The two layers are complementary, and the new
single-field ceilings close exactly the hole the rate checks leave. Bounds are **derived** from the
existing rate constants (`MAX_ACTIVITY_DISTANCE_KM = MAX_AVG_SPEED_KMH × 24 h`, and so on) so a
ceiling can never contradict the per-minute check beside it.

**Two of the entry's claims were wrong and are corrected here.** (1) The HR fields were *already*
bounded — the plausibility refine rejects `avgHr: 9999` today, so they were never part of the gap.
(2) The entry said an over-long duration "produces an end timestamp days later and can push an
activity into the wrong day bucket". It does not: `addMinutes` wraps at `% 1440`, so
`addMinutes('08:00', 100000)` returns **18:40 the same day**. That wrap is instead what *justifies*
the 1440-minute ceiling — beyond a day the value is unrepresentable anyway.

⚠️ **The entry's "plausible typo" case is NOT caught, deliberately.** 1000 minutes for 100 is
16.7 hours, which a real ultra reaches; a physiological bound that rejected it would reject a good
day. Pinned as a passing test so the limitation is visible rather than assumed fixed — catching
typos needs a confirmation prompt, not a tighter ceiling.

Closed the way it was opened: **POSTed against the running route.** The four reproductions now
return 400 and a real 90-minute walk still returns 201 (probe row deleted).

**Correctly rejected in the same sweep:** negative durations, a 500-char emoji/RTL title, out-of-range
body fat, and every bad weight. The gap is specifically the *upper* end of otherwise-validated
numerics — a narrower and more fixable statement than "validation is weak".

**❌ My Q-151 was a false positive — refuted by #1184, correctly.** I claimed `/sign-in` carried a live
React #418 and tied it to production's 153-hit series. Zero of 272 production #418s are on `/sign-in`;
the series stopped 19 minutes after Q-73's deploy; it does not reproduce in eight runs across dev and
a production build. **What I actually saw was a dev-mode React hydration warning**, which the
production build does not emit — and I attributed a production count to a route **without checking the
`url` column, while already querying that table**. One `GROUP BY url` would have killed it before
filing. Recorded because the reasoning error generalises: *"I saw an error on page X" and "the counter
for that class is high" are two claims, and joining them needs evidence, not adjacency.*

**✅ Boundary dates clean — zero 500s across four date routes, twelve inputs.** The class CLAUDE.md has
been burned by repeatedly. `2026-02-29` rejected and `2024-02-29` accepted is the strongest signal:
real calendar validation, not a regex that looks right. Slashes accepted, malformed rejected. Q-130's
hardening holds.

**✅ Concurrent duplicate submits — checked, mitigated, NOT filed.** Five identical concurrent POSTs
create five rows (no server idempotency), but the real save paths carry the client guard CLAUDE.md
prescribes: `done-activity-screen.tsx:65,423` (`saving` + `disabled`) and `walk-summary.tsx:55,112`
(a `savedRef`, the stronger ref form). My probe bypassed the UI. Filing it would have been a false
positive — noted rather than queued.

**⚠️ Contrast: third attempt, definitive stop.** This time starting with a self-test — black on white,
expect ~21:1. **It returned 1.96:1**, so the method is broken in a case whose answer is known and no
measurement from it should be believed. The self-test did immediately catch a `clip` key-name bug
(`w`/`h` vs `width`/`height`) that likely caused attempt 2's uniform 1:1 results. Contrast stays
**unmeasured**; the self-test harness is what the next attempt inherits.

### [app-shell] 🔴 The home header shows the WRONG DAY for a non-Brisbane user — OBSERVED live (2026-08-08)

Lens 12 + empty states —
[`docs/reviews/2026-08-08-multi-user-and-empty-state-review.md`](docs/reviews/2026-08-08-multi-user-and-empty-state-review.md).
A second account was **seeded and driven**, not reasoned about.

**✅ Q-163 — FIXED 2026-08-09 (v1.275.1).** Logged in as an `America/New_York` user at **18:52
Saturday their time** (08:52 Sunday in Brisbane), the app showed them header date **"Sunday 9
August"** — a full day ahead — and **"Good morning"** at 6:52 PM. Fourth appearance of the class
after Q-73, Q-144 and Q-148, and the one that finally removed the cause rather than the instances.

**It was six sites, not the four listed.** The two extra were load-bearing: the calendar-day key
built from local-store history (`session-select-content.tsx:376`) has to match the keys the week
strip uses, so fixing one without the other would have shipped a *new* day-off-by-one inside the fix;
and `workout-select-content.tsx:22` held a second independent copy of the same hardcoded helper.
`overview-screen.tsx` also had a bare `todayInTz()` keying a **body-metric write** — the same defect
on a write path.

**The comment was half the bug.** `session-select-content.tsx:99-100` defended the hardcode —
*"the server buckets workout/rest days in AEST regardless of device timezone"* — which **was true
when written and Q-144 (#1161) made false**. It is deleted. `dayKeyInTz(tz, daysAgo, at?)` now lives
once in `packages/shared/src/date-utils.ts` and the `aestDateString` prop was renamed `dayKey`,
because a name asserting AEST is the same trap as the comment.

**Verified with three zones, because two cannot prove it** (the Q-148 lesson: device-local and the
`DEFAULT_TZ` fallback are indistinguishable unless all three differ). User `America/New_York`, device
`Europe/London`, fallback `Australia/Brisbane` — hours 08/13/22 at run time. Rendered: **"Good
morning"**, i.e. the user's own zone. Planting the hardcode back reproduced **"Good night"** for a
user at 08:40 their own time. ⚠️ **Not verified on the S25** — these are all Home-screen surfaces on
the APK.

**✅ Cross-user isolation verified by attack, not by reading.** As user B: four read probes at A's
session (404/401/404/404) and five write probes at A's injury and program (401/401/404/404/404).
**Nothing leaked; A's rows verified unchanged afterwards.** Corroborates the 2026-08-07 read-based
verdict empirically. Minor inconsistency noted, not filed: the same condition returns 401 on injuries
routes and 404 on programs routes.

**✅ Empty states clean — and it kills a standing hypothesis.** Every page driven as a user with no
program, no logs, no ring: all render, zero `pageerror`. Production's unexplained client bursts
(`Cannot read properties of null`, `.reduce is not a function`) were suspected to come from
sparse-data screens. **They do not** — that does not explain them, but it removes the obvious
candidate.

**Onboarding fact worth having:** `users.is_active` defaults to **false** and `middleware.ts:23-26`
sends inactive users to `/pending`. The app is invite-gated by default — a new account authenticates
but reaches nothing until someone flips the flag. Correct today; it is the gate a Play Store
self-service signup would have to change.

**NOT done:** adversarial values, boundary dates, offline, rapid double-tap — all need write flows and
were not reached. No device.

### [app-shell] 🟠 Lens 10 — mobile UI vs Material/WCAG: 7×7 px tap targets, and contrast that could NOT be measured (2026-08-08)

[`docs/reviews/2026-08-08-mobile-ui-standards-review.md`](docs/reviews/2026-08-08-mobile-ui-standards-review.md).
Judged against **Material 3 and WCAG 2.2 AA**, not the repo's own rules — measured in a real browser
at 390×844 with a logged-in session, both themes.

**🟠 Q-160 — the session carousel dots are 7×7 px.** Material wants 48dp; WCAG 2.5.8 AA wants 24×24.
And it is deliberate: the app *has* a 48px floor (`globals.css:538-543`) and the dots opt out via
`.tap-dense` (`:540-544`), whose documented purpose is *"inline text buttons"*. **A carousel dot is
not an inline text button.** Stated fairly, WCAG's *equivalent alternative* exception may apply since
the carousel swipes — but 7×7 on a 6.9" screen fails the intent regardless. The fix is conventional:
keep the dot 7px visually, pad the hit area to 48px. Then audit the other `.tap-dense` users, because
the opt-out is doing more than its comment claims.

**Q-161** — three inputs use a placeholder as their only label (both `/sign-in` fields and the `/chat`
textarea), so the field's identity vanishes exactly while the user types. **Q-161** — six controls
expose no accessible name, including a **Radix Switch** that announces "switch, on" with no indication
of what it toggles. Not a duplicate of Q-133, which covered `aria-expanded` on disclosures.

**⚠️ Contrast was NOT measured, and that is the biggest gap.** Two methods, both invalid. (1)
Computed-style with an ancestor background walk produced ten tidy sub-4.5:1 results that were
**identical in light and dark** — the tell. The theme did switch, but `body` computes to
`rgba(0,0,0,0)` in both, because this app paints via the dynamic-background layer, so the walk fell
back to assumed white **in both themes**. Those numbers are discarded, not reported. (2) Pixel
sampling from a screenshot returned exactly **1:1 for every element**, impossible for visible text.
§4 of the review records what a working method needs. **The `DetailHero` hardcoded-dark case remains
unverified.**

**Also not covered by Lens 10:** `prefers-reduced-motion`, Android text scaling, keyboard/focus order,
per-screen error/empty/loading states, destructive-action confirmation, numeric `inputMode`. No
device, so no Samsung WebView compositing, no real safe-area insets, no actual touch.

### [platform] 🟠 The rulebook is wrong and the test suite is blind to a cross-user leak (2026-08-08)

Lenses 9 and 11 of the deep review —
[`docs/reviews/2026-08-08-claude-md-and-test-suite-review.md`](docs/reviews/2026-08-08-claude-md-and-test-suite-review.md).
Two questions nobody had asked: **is CLAUDE.md true**, and **does the suite actually test anything**.

**🟠 Q-155 — a cross-user data leak passes all 3,270 tests.** Measured by mutation: removing the
`user_id` scope from `adapter.ts:1852` (`getBodyMetricsBaseline`, live on two routes) leaves the
suite fully green — **414 files, 3,270 tests, 0 failures**. Read it correctly: the 2026-08-07 review
certified ownership clean *by reading* and was right, the scope **is** correct today. The gap is that
**nothing would tell you if it stopped being right**, in the highest-severity class this project has.
Supporting signal with its limits stated: 180 of 286 repository methods appear in no test by name —
a crude proxy for *where to look*, not a count. Separately, breaking a `scoreBand()` threshold fails
exactly **1** test, for a formula 18 call sites consume.

**✅ Q-153 — FIXED 2026-08-09.** CLAUDE.md instructed an import that does not compile: nine modules
moved to `packages/shared/src/` and the rulebook still named them under `lib/`. The Timezone
section — which the document itself calls *"a strict rule"* — showed
`import { todayInTz } from '@/lib/date-utils'`, a path **0 files use** against 197 using
`@trainingai/shared/date-utils`. All thirteen occurrences corrected (four of them
`lib/changelog.ts`, which two sessions had already had to grep past), plus the header sentence of
the One-Formula rule, which claimed domain math *"lives exactly once in `lib/`"* and would have sent
a reader to the wrong directory.

**The durable half is the point.** `scripts/check-claude-md-paths.js` now fails CI (Custom Rules) on
any backticked path or `@/…` import specifier in CLAUDE.md that does not exist, with a
`-> moved to packages/shared/src/…` hint when it can work one out. Template filenames
(`<pillar>`, `YYYY-MM-DD`) are skipped, and genuine exceptions — the deliberate *"there is no
`lib/health/score-band.ts`"*, the unbuilt APK artifact — sit in a `DELIBERATE` map that requires a
written reason per entry. It found exactly the nine the review did, independently, and was verified
to fail on the original `@/lib/date-utils` line. **A wrong path in a rulebook is worse than one in
code: nothing compiles it, so it rots silently and gets copied confidently.**

**Q-154 — a sixth inline sparkline shipped days after the rule was re-verified.**
`components/health/day-detail/day-sections.tsx:57` hand-rolls an HR chart instead of using
`components/ui/sparkline.tsx`, arriving in #1136. CLAUDE.md records the count as eight; it is nine.
The finding is as much about the rule as the file — *"replace on touch"* is enforced by reviewer
memory alone, which is to say by nothing.

**Also drifted (improving):** hex literals 455 → **430**; score-band call sites 17 → 18.

**NOT done:** Lens 10 (mobile UI vs external standards) and Lens 12 (multi-user scale) not run; the
rest of the CLAUDE.md audit — rules contradicted by their own code, rules that could become CI
checks, rules now obsolete — not started. No device.

### [workouts][app-shell] 🔴 A same-day mood check-in with zero sore muscles doesn't clear an already-on-screen whole-session Deload recommendation (found 2026-08-09, NOT fixed)

Owner asked why the Lower pre-workout screen recommended a whole-session Deload — "Most of this
session's muscles are still sore (Glutes, Quads, Back, Hamstrings)" — when "there was no training of
those muscles within 48 hours." Traced to source rather than dismissed as an odd recommendation.

**Confirmed real against production data, not a soreness-detection accuracy question.** The
whole-session deload trigger (`computePerExerciseDeload`,
`packages/shared/src/ai-periodization/per-exercise-deload.ts:60`) escalates whenever more than half
a session's exercises match a mood-log self-reported sore-muscle label — it never independently
checks whether a muscle was actually trained within any time window at prescription time, despite
the banner's phrasing reading like automatic detection. Queried `claude_ro.mood_logs` directly:
today's check-in (`log_date` 2026-08-09, `created_at` 22:31:07 UTC = 08:31 AEST — essentially the
same minute as the owner's screenshots) recorded zero sore muscles (`body_state: []`); **yesterday's**
check-in (`log_date` 2026-08-08) listed all four muscles named in the stale banner among its nine.
The server's fallback logic (`todayMoodLog ?? yesterdayMoodLog`, `app/api/workout-data/route.ts:496`)
correctly prefers today's log via nullish coalescing when one exists — so this match is only
possible if the rendered screen held a prescription computed *before* today's check-in was saved.

**Root cause: the mood check-in's save handler never triggers a refetch of the screen showing the
prescription it affects.** `MoodCheckInSheet` has exactly one call site
(`app/session-select/session-select-content.tsx:1438-1443`), wired as
`onSaved={(log) => setMoodLog(log)}` — a purely local state update that only feeds the check-in
card's own display, confirmed unconnected to the `workout-data` fetch by grep. The save handler
does correctly call `invalidateCheckinAffectsPrescription()`
(`components/mood-checkin-sheet.tsx:242`), which clears the right cache groups — the invalidation
half of this pattern is fine. What's missing is the refetch trigger: nothing calls
`fetchWorkoutData()` or bumps `refreshTick` afterward, so the already-rendered screen keeps its
stale in-memory prescription until an unrelated remount or the header refresh button, which already
calls the correct function (`fetchWorkoutData()`, same file, line 1086) — proof the fix is wiring an
existing function to a new call site, not writing new logic.

**Real downstream harm, not cosmetic**: a materially wrong training prescription (a full-session
deload cutting working weight ~50%) directly contradicting the lifter's own same-day self-report,
silently persisting until an unrelated screen action happens to force a refetch.

**✅ Fixed 2026-08-09 (Q-158, v1.275.0).** `onSaved` now refetches and bumps `refreshTick`. One
thing the plan did not anticipate: the sheet fired `onSaved` *before* invalidating, which is
harmless for a callback that only sets state and wrong for one that refetches — the refetch would
have read the stale `workout-data` cache straight back — so the invalidation is awaited first.
Proven both ways in a browser at 412×891: pre-fix a save fires only `POST /api/mood`; post-fix it
also fires `workout-data?tab=meta`, `next-session`, `workout-data?tab=all` and `readiness-score`.
(Filed here as Q-159 while #1187 was open; it landed on `main` as **Q-158**.)

### [app-shell][platform] 🟠 The first review to RUN the app — unauthenticated calls on the login screen (fixed), and a second live hydration bug (2026-08-08)

[`docs/reviews/2026-08-08-running-app-review.md`](docs/reviews/2026-08-08-running-app-review.md).
Step 0 + part of Step 1 of the deep-review prompt — **not** the full twelve lenses. What makes it
worth reading: it was **observed in a running browser**, and two of these had survived 25 read-only
reviews.

**✅ Q-150 — the signed-out login screen no longer calls the API at all. FIXED 2026-08-08 (v1.270.31).**
`components/sync-provider.tsx` guarded `pushMutations`/`pullDelta` on `userId` but not the cache-warm
phase or `maybeSyncOura`, which fired **`POST /api/oura/sync`** — an expensive external sync — before
login. `SyncProvider` sits in the root layout, so it happened on **every** signed-out route.
**Measured, not estimated: the real count is 22, not 12** — phase 3 sleeps 2.5 s then warms all 20
`CACHE_TASKS` in chunks of five, so the review's network-panel read caught roughly the first two
chunks. A scripted browser watching for 12 s after load records 22 before, **0** after; signed in,
the warm cycle and Oura sync still fire with 0 401s. The **four native-only reminder reconcilers**
were swept in the same PR — on the APK they fetched meal types, next session, supplements, readiness
and body battery before login too, which the browser reproduction structurally could not show.
⚠️ **That native half is unverified on device** — the sandbox cannot reach it, so what is proven is
that they cannot fire signed out, not that reminders still schedule correctly signed in on the S25.
Phase 1 (sessionStorage mirroring, no network) and the two BLE radio effects stay ungated on purpose;
a failed step post re-queues in its own retry buffer against a server that dedups, so nothing is
lost. Held by `components/__tests__/sync-provider-auth-gate.test.ts`, a source-text check because the
repo has no jsdom environment — verified to fail on a planted regression.

**⏳ Q-151 — REFUTED 2026-08-08, and it looks like Q-73 did close the class.** Filed as "React #418
is NOT closed — `/sign-in` has a second, independent instance". Three measurements say otherwise
([journal](docs/overview/history-2026-08-07.md)). **(1)** Production has
**never** recorded a #418 on the sign-in page — `0` of `272` rows; all of them are on `/` (234),
`/more` (15), `/health` (13) and four `/workout` URLs. **(2)** The whole series **stopped at Q-73's
deploy**: last occurrence anywhere 2026-08-07 20:53 UTC, #1130 merged 21:12 UTC, nothing since,
against a 1–13/day baseline for the fortnight before. **(3)** It **does not reproduce** — `/sign-in`
signed out in a scripted browser at 412×915, in a dev server *and* a production `next build`, under
four localStorage theme states (the ones that make the inline theme script mutate `<html>` pre-
hydration), gave **zero console messages in all eight runs**; `Meteors`, `Typewriter` and
`GoogleSignIn` were each read and cleared. ⚠️ **One clean day is one day** — *stopped ≠ fixed* — so
the entry survives as a dated re-check, not a deletion. ⚠️ The **signed-in home** path could not be
reproduced locally at all: `NODE_ENV === 'production'` hard-forces SSL in
`lib/data/postgres/client.ts:16` and the local Postgres refuses it, so login fails under
`next start`; home-after-Q-73 rests on telemetry alone. **Re-run the standing `error_events` query
around 2026-08-15**: if #418 is back, the row's `url` names the real route.

**✅ Q-152 — FIXED 2026-08-08.** `ensureSchema` printed a genuine migration failure
(`cardio_sessions_user_id_fkey cannot be implemented`) in the same format as four benign
`already exists` notices, then continued. Now classified by **SQLSTATE**, not message text: six
idempotency codes (`42P07`, `42710`, `42701`, `42P06`, `42723`, `23505`) collapse into one aggregated
info line; anything else — **including a codeless error** — is a `console.error` carrying its code,
plus a `N failed` summary. **Deliberately not fatal**: a migration that cannot apply is usually
permanent, so failing closed would crash-loop every boot rather than surface anything new.

### [app-shell] ✅ Device-local rendering list triaged — 7 benign, 1 real bug fixed, 2 blocked (2026-08-08, v1.270.22)

The `check-timezone-rendering` CI rule shipped earlier the same day with twelve undifferentiated
files. That was honest but not useful — **"calls `toLocale*` without a `timeZone`" is not by itself a
bug** — so every file was read and classified
([journal](docs/overview/history-2026-08-08.md)).

**7 benign, no work needed:** each builds its Date from calendar components or a **local**-anchored
string, so device-local rendering returns the same calendar date in any zone.

**1 real bug, fixed:** `components/health/strength-trend-card.tsx:42` used
`new Date(h.date + "T00:00:00Z")` — **UTC** midnight — then rendered device-local. Correct on the
owner's Brisbane device (10:00 same day); **a day early anywhere behind UTC**. Now uses
`formatDayShort`, the single-source helper whose docstring already warns against that construction.
Visible consequence, stated plainly: labels change from `6 Jul` to `Jul 6`, because that is what the
shared helper emits — keeping the old order meant a second inline copy.

**2 real but blocked (3 at triage time), and this is the finding worth carrying: 🟠 no client component can read the
user's timezone at all.** `users.timezone` is on the JWT and reaches every API route, but every
*client-side* formatter falls back to `DEFAULT_TZ`. Q-144 was fixable precisely because it was
server-side; `exercise-review-sheet`, `chat` and `stats-grid` render absolute instants and are not.
Filed as **Q-148** — **✅ since shipped (v1.270.29): `UserTimezoneProvider` closed the gap and all
three sites are converted.** The entry's note not to "fix" them by passing `DEFAULT_TZ` — that is
what they already did — is what made the plumbing the item rather than the symptoms. **A third file left the list mid-review and showed a limit of the check:** Q-123
(#1167) switched `exercise-review-sheet` to `formatDayShort`/`formatTimeOfDay`, which default to
`DEFAULT_TZ` when no tz is passed — so it escaped a check that matches `toLocale*String` only, while
still not rendering in the user's zone. Improvement, not correctness; both the script and Q-148 now
say the sweep must cover shared formatters called without a tz, not just `toLocale*`.

The script now composes its list from named `REVIEWED_BENIGN` and `BLOCKED_ON_CLIENT_TZ` sets with a
per-file reason, both still shrink-only. **Process correction:** this change also adds the
2026-08-08 DB review link to `docs/domains/platform/README.md`, which CLAUDE.md required in the PR
that added the review and which was missed there.

### [app-shell][platform] Bundle sizes measured for the first time — and they are NOT the navigation lever (2026-08-08)

Never measured in 25 review documents. Numbers now exist
([journal](docs/overview/history-2026-08-07.md)): **105 kB First Load JS
shared by every route**; `/workout` heaviest at **361 kB**; `/` · `/health` · `/nutrition` · `/more`
all at **316 kB while carrying 235 B of their own code** — so the weight is shared-layer, and
screen-level splitting would move almost none of it.

**Recorded as a negative result, on purpose.** The 2026-08-05 S25 capture already settled where
navigation cost lives: **22 navigations, warm 22 · cold 0, not one fetched an RSC payload**, and the
worst sample (1348.7 ms, ~9× median) was entirely client-side render/mount. Transfer size cannot
explain a cost that involves no transfer, so the evidence still points at **rendering** — Q-51's
file-splitting item — not at bundle weight. The point of writing it down is to stop a future session
re-opening and re-measuring a plausible-sounding thread. Same discipline the Q-127 entry earned the
hard way the same day: a real static import chain whose claimed consequence did not reproduce.

**Still genuinely unmeasured: cold app start.** In-app navigation was captured; the boot cost —
when the shared baseline and a screen's First Load are actually paid — never has been. Needs the
device, filed as **Q-147** with an explicit "do not optimise off the baseline" note.

**Correction to an earlier claim this session:** the `@capacitor-community/speech-recognition`
typecheck/build error was called "pre-existing" — it was a **stale sandbox `node_modules`**, not a
repo defect. `pnpm install --frozen-lockfile` clears it and touches neither `package.json` nor the
lockfile.

### [platform][devices] DB/scalability + dev-tooling review, 2026-08-08 — 4 findings QUEUED, 4 CI rules SHIPPED, no app behaviour changed

Full write-up:
[`docs/reviews/2026-08-08-db-scalability-and-tooling-review.md`](docs/reviews/2026-08-08-db-scalability-and-tooling-review.md).
The database layer had never been reviewed — 24 review docs, none covering indexes, query plans,
table growth or connection behaviour — and it is also the only layer currently producing unexplained
production faults. Nothing was fixed inline; everything is queued.

**Q-142 was overtaken mid-session and is now half the size it was filed at.** The review found that
`lib/observability.ts` recorded `message`/`stack` only, dropping the Postgres error on `err.cause` —
why **98 `Failed query` events over 30 days carried no diagnosis**. **PR #1150 (Q-107 first half)
shipped exactly that fix the same day**, independently. What remains is the half it did not touch:
`lib/observability/request-error.ts:55-59` still drops the cause, and per `docs/module-map.md` §14
that `onRequestError` path covers **the 80 route files with no `catch` of their own** — more routes
than the one just fixed. Q-142 was rewritten to that narrower scope rather than closed.

**And the leading hypothesis for the fault itself is probably wrong.** Grouping those 98 by the
second they landed in: **77 are a lone query failing while every other query in flight succeeded**,
12 in pairs, 4+5 in two bursts. Pool exhaustion fails everything competing for a connection at once
— that shape covers 21 of 98. An isolated failure fits a per-connection drop or
`statement_timeout: 15_000` better, which means Q-107's queued `getSyncDelta` batching fix may
address the smaller half. Now that the `code` capture has landed this is settleable by one
production `error_events` read rather than by argument: **read the codes before writing the batching
PR.** Recorded on Q-107; this also amends the `/api/sync/pull` row further down.

**🔴 The DB volume problem is re-accumulating faster than documented.** 205 MB post-REINDEX on
2026-07-21 → **421 MB on 2026-08-08** ≈ **12 MB/day**; `oura_raw_samples` is 73% of the database and
its row count **doubled in 18 days** (432,919 → 881,603). Q-46's guard stopped index *bloat*; the
console actions still queued under Q-30 reclaim bloat too. **At this rate the database alone returns
to the ~924 MB alarm level in roughly six weeks whether or not they run** — only D4
(drop-after-pull) or a retention policy changes the direction. Related doc correction: CLAUDE.md's
~3.2 MB/day for this table describes the **device-local** window and has been read as the server
rate, which is ~3× higher. Q-30 updated in place.

**Multi-user debt, now tracked (Q-144).** Three `TODO(tz)` markers (`adapter.ts:1051`, `:1109`,
`slices/oura.ts:1074`) acknowledge `DEFAULT_TZ` is assumed on read paths — with zero references in
the backlog or here, i.e. an orphaned finding. A user outside Brisbane silently gets Brisbane day
boundaries on windows feeding health aggregation. The "app is AEST-only in practice" premise in
those comments no longer holds. **Q-143 is now ✅ FIXED (2026-08-08)** — the clock-anchor full-table
read (17,045 seq scans / 45.3M tuples, latent but linear in a number that only grows) ran inside
`insertOuraRawSamples`, i.e. on **every ingest batch**, not just the rollup as the entry's title
said. It needed exactly three numbers, and now takes them from two single-row reads
(`getOuraClockEpochHead`, `getNewestOuraClockAnchorByUtc`) issued in parallel; cost is now flat in
anchor count. Equivalence with the reduce it replaced is pinned by
`lib/data/postgres/__tests__/oura-clock-anchor-scoping.test.ts`, verified to fail on a planted
regression that drops the epoch scoping. **Server-side only — not verified on device**; it is the
ring pipeline, so the ingest path deserves an on-device drain before it is called done.
**Q-145 is now ✅ FIXED (2026-08-08)** — errors from the 80 catch-less routes are attributed to a
user again, and the dedup key is user-scoped, so one user's fault no longer hides another's.
**The entry's blocking premise was wrong**: it recorded the fix as "not implementable" because
`onRequestError` is handed only `{ path, method }` — that was the repo's own narrowed local type
being read as if it were Next's. Next's `InstrumentationOnRequestError` passes
`{ path, method, headers }`, and the session cookie is in there. `userIdFromSessionCookie` decrypts
it with `AUTH_SECRET` via `next-auth/jwt`; every failure mode yields null and records exactly as
before, the id is UUID-shape checked, and the INSERT retries with `NULL` if it fails — `user_id`
carries an FK and a token can outlive the row it names, so attribution must never cost the error
report. Proven end-to-end against `pnpm dev`: anonymous → `(null)`, signed in → the seeded user's id,
both recorded 27 s apart with identical url+message (the dedup fix, demonstrated at the same time).
⚠️ **Not verified in production or on the APK**, and the FK-retry branch is reasoned rather than
exercised. Gotcha for the next person: **`instrumentation.ts` registers once at boot and does not
hot-reload** — a dev server started before the edit shows no attribution and looks like a bug.

**Shipped: four `Custom Rules` CI checks**, each verified to pass on the current tree and fail on a
planted violation — `check-migration-numbers.js` (duplicate migration numbers; also prints the next
free number), `check-timezone-rendering.js`, `check-date-param-regex.js`, `check-component-size.js`.
The last three carry **shrink-only** grandfather lists: each fails if a listed file is fixed but left
in the list, so the inventories cannot rot. They corrected two counts Q-130 held by hand — 12 files
call `toLocale*String` with no `timeZone` (not 3), and 11 carried a dash-only date regex (not 7).
**That design proved itself within the session:** Q-130 then shipped (#1148) and widened 7 of the
11, and the check failed the merge with *"these files no longer carry a dash-only date regex —
remove them from GRANDFATHERED"*, naming all seven. A hand-written list would have gone on claiming
eleven. Four remain, all of them ones Q-130 never knew about.

**Checked and clean, so it is not re-derived:** index coverage on every hot table is good; `users`
showing 895k sequential scans and 0 index scans is correct at a handful of rows, not a defect; the
BLE ingest path is properly bounded/coalesced/backgrounded with unbounded reads confined to two
admin diagnostics; rate-limit keys are all user-scoped; module-level server state is user-keyed.

**NOT done:** no `EXPLAIN ANALYZE` — the read-only `claude_ro` role reaches curated views, so query
plans are inferred from scan counters, not observed. No real second account was driven through the
app; the multi-user findings are static analysis. No device/emulator/browser, though nothing here
touches a device path.

### [nutrition][platform] Supplements pull-clobber guard + local schema v22 (Q-124, 2026-08-08, v1.270.7) — NOT verified on device · needs: android

`supplements` was the one offline write domain whose `applyDelta` arm could not gate on
`sync_status`, because the local table had no such column. Local migration **v22** adds
`sync_status` and `deleted_at` (with the matching `RECONCILE_COLUMNS` rows, which are the real
authority after a partial upgrade), `applyDelta` gained the `WHERE supplements.sync_status='synced'`
guard and a tombstone arm, local writes now mark rows `pending`, and the sync engine's confirm loop
flips them back via `markSupplementSynced`.

**Everything that actually matters here happens on device and none of it ran on one.** Native
SQLite does not run in this sandbox (`getLocalStore` returns null), so the v22 upgrade path, the
reconcile fallback if it partially applies, and the offline rename → pull → "did it survive?"
sequence are covered by unit tests and code review only. Local migrations have twice killed the
store outright (WAL pragma inside the upgrade transaction, non-idempotent `ADD COLUMN`), so this is
the exact change class that deserves the device check: install the APK, open the app, confirm
supplements still list, rename one offline, let it sync, confirm the rename survives the next pull.

Two things reduce (not remove) the risk: both statements are plain `ADD COLUMN` with no PRAGMA, and
`reconcileSchema()` carries both columns, so a partial v22 heals on the next open rather than
wedging.

Session journal: `docs/overview/entries/2026-08-08-supplements-sync-and-route-hygiene.md`.

### [app-shell] Day-detail screen behind the training calendar (Q-110, 2026-08-08, v1.270.0) — swipe NOT verified on device · needs: android

Tapping a calendar day now opens `/health/day?date=` — a dedicated screen with the day's sleep and
hypnogram, full body composition, derived scores and a whole-day HR trace, swipeable between days.
Verified against the dev server at 412×891 (renders, calendar tap routes correctly, empty day states,
all tap targets ≥48dp, no page errors).

**The device unknown is the swipe, and it is the one worth checking first.** `useDrag` sits on a
vertically-scrolling page; `touchAction: pan-y` should hand the vertical axis to the browser, but this
app has twice lost a session to gesture conflicts (pull-to-sync) and a mouse drag in Chromium is not a
thumb. Nothing else here is device-sensitive — no blur, filter or backdrop-filter, nothing anchored.

**Two known gaps, deliberate:** days never scored show "—" for readiness/activity (the screen reads
`oura_daily_derived` in one query rather than recomputing via `buildDayAudit`, whose ~13-query fan-out
is the shape Q-107 blames for pool exhaustion — if the gap is common, run the existing backfill rather
than making this screen expensive). ~~The old `day-overlay-sheet.tsx` still exists~~ — **deleted, LB-3.**

Session journal: `docs/overview/entries/2026-08-08-day-detail-screen.md`.

### [app-shell][cardio][activity] Navless safe-area utility sweep (Q-118, 2026-08-07, v1.269.1) — NOT verified on device · needs: android

Found by the 2026-08-07 full-app review (§2.4): `activity-screen.tsx` renders `<RunActiveScreen/>`
or `<ActiveActivityScreen/>` from the same parent, same navless `/activity` page, same bottom
Pause/Finish action row — but `run-active-screen.tsx` already used the floored `pb-safe-action-lg`
while `active-activity-screen.tsx` used plain `pb-safe-action`, a divergence within the same
feature. `pb-safe-action` is `max(env, 0.75rem)`; under Capacitor edge-to-edge the inset *replaces*
the gap instead of adding to it — the documented on-device failure class `pb-safe-action-lg`
(`max(env + 2rem, 4rem)`) exists specifically to fix.

Swept all 6 flagged sites onto `pb-safe-action-lg`: `active-activity-screen.tsx`,
`fitness-tests/test-active.tsx` (×2), `guided-walk/walk-active.tsx`, `guided-walk/walk-config.tsx`,
`guided-walk/walk-summary.tsx`, `activity/done-activity-screen.tsx`. Pure Tailwind class swap, no
logic changes; both classes were confirmed to already exist as the correct floored variants in
`globals.css`.

**The web sandbox renders `env()` as 0, which is exactly the value this bug depends on** — the
class change is visible in a screenshot (extra bottom padding, no layout breakage confirmed on
`walk-config`'s "Start walk" button) but real Capacitor edge-to-edge inset behavior cannot be
exercised here at all. Needs the on-device smoke run
(`docs/device-smoke-checklist.md`) — specifically: Pause/Finish during a tracked activity, "End
test early" during a fitness test, and "End walk" during a guided walk, checked against the
gesture bar on the S25. Full detail:
[`docs/overview/history-2026-08-07.md`](docs/overview/history-2026-08-07.md).

### [app-shell] Cardio Hub entry card on the workout screen (2026-08-07, v1.269.0) — NOT verified on device · needs: browser

The workout screen's "Other Activity" row is now a card matching the session card's inset and
radius, tinted via `--accent-cyan`, naming its three destinations; the `/cardio` heading follows the
rename. Verified against the local dev server at 412×891 — renders, aligns, and navigates.

Low device risk by construction: no blur, filter or backdrop-filter, and the row is not
bottom-anchored, so neither the Samsung compositor bug nor the safe-area floor applies. The one
unexercised surface is Samsung WebView rendering of the `color-mix(in oklch, …)` gradient.

Session journal: `docs/overview/entries/2026-08-07-cardio-hub-entry-card.md`.
Design docs: `docs/design/2026-08-07-other-activity-mockups.html`, `…-cardio-hub-fullscreen.html`.

### [app-shell] Fourteen new home score-card styles (2026-08-07, v1.268.0) — NOT verified on device · needs: browser

The four home score buttons (Readiness / HR / Sleep / Activity) gained fourteen selectable looks on
top of the original five — More → Home widgets → Score Card Style. All nineteen render correctly in
Chromium at 412dp with no errors, and every tap target clears the 48dp floor (tightest: Pill at
89×52dp).

**Two carry real Samsung WebView risk and have not been checked on the S25:** `frosted` uses
`backdrop-filter: blur()`, and `duorail` stacks a low-opacity 58px glyph behind live content. Both
are the shape of CSS behind the known compositor bug that wipes sibling gradients in card grids —
Chrome renders them fine, which is exactly why this needs the APK. The other twelve use no blur,
filter, backdrop-filter or gradient at all and are low-risk by construction. Nothing here touches
safe-area (the row is not anchored), gestures, native plugins or an offline-first domain.

Session journal: `docs/overview/entries/2026-08-07-health-metrics-button-designs.md`.
Design galleries: `docs/design/2026-08-07-score-row-mockups*.html`.

Secondary, non-blocking: the picker is now a flat list of nineteen radio options, which wants
grouping or thumbnails rather than a longer list. Not scoped.

### [activity][devices][platform] ⚠️ Q-139 — ring-clock compression FIXED (v1.270.25), **not verified on device**

**Fixed 2026-08-08 in v1.270.25.** Owner decision: **fix forward, no backfill.** Kept here rather
than archived because the device check is still owed, which is what this section is for. Full
investigation, including the measurement traps that make it expensive to re-derive:
[`docs/handoff-2026-08-07-activity-ring-clock-compression.md`](docs/handoff-2026-08-07-activity-ring-clock-compression.md);
session journal `docs/overview/entries/2026-08-08-ring-clock-compression.md`.

**The slope was never the unknown** — the ring's counter ticks at exactly 100 ms/ds by construction,
only the offset is unobserved. `resolveDsToMs` now applies that fixed slope with one offset per
epoch, estimated as the **p10 of anchor lag**: an event cannot be received before it happened, so the
floor of the lag distribution is the honest offset and the tail is receive latency (p0→p10 spans
1.4 min against a 56.2 min full spread). That also makes the mapping monotonic in `ds`, which
interpolation could not promise.

- **Both halves shipped.** `resolveDsToMs` now applies the fixed 100 ms/ds slope with one offset per
  epoch (p10 of anchor lag), which is also monotonic in `ds`. And the sibling gap is closed —
  `mergeStepCounterWithLive` gates **model** windows through `isPlausibleStepWindow`, not just live
  ones (verified in `packages/shared/src/health/step-estimate.ts:176`, whose comment names Q-139).
- **⚠️ What is still owed: the on-device check only.** The consequence shows after the next real
  history drain. Nothing else is outstanding — no code work, no owner decision.
- **Stored history was deliberately not rewritten**, so ~35 days before the deploy read
  inconsistently with everything after. Blast radius is steps + the admin console; sleep and HR use a
  different converter (`measuredAtMs`) and are untouched.

*Rewritten 2026-08-18 (Q-553): this row previously read `🔴 … (found 2026-08-07, OPEN)` and carried
69 lines describing the bug as unfixed, while an `✅ fixed` entry for the same issue already sat in
the resolved archive. Every session's orientation read had shown a red open issue for a bug fixed ten
days earlier.*
### [platform][app-shell] Full-app deep review, 2026-08-07 — 53 findings, ALL QUEUED (nothing fixed)

A whole-app review of saving, caching, performance and domain logic across all **201 API routes** and
**40 pages** — the first comparable sweep since 2026-07-20, roughly 400 commits earlier. Eight code
lenses run in parallel, plus two production passes (`error_events`, and **91 days** of
`/api/admin/day-review`). Full writeup, including the coverage ledger and every clean result:
[`docs/reviews/2026-08-07-full-app-review.md`](docs/reviews/2026-08-07-full-app-review.md).

**Nothing was fixed in that PR — it is docs-only.** Findings landed as **Q-117 … Q-138** plus updates
to three existing entries. The four highest-value outcomes:

1. **Q-73's root cause was found and reproduced** — the home-screen React #418 hydration error (138
   hits, still firing) is `session-select-content.tsx:1063`: `toLocaleDateString` with no `timeZone`.
   Railway runs UTC, the S25 runs Brisbane, so for the 42% of each day between 00:00 and 10:00 AEST
   the server renders yesterday's date. **That entry was marked ⛔ "needs a device capture" — it does
   not.** See the correction below.
2. **The `Failed query` faults are one fault, and it is app-wide.** `getSyncDelta` fires **22**
   parallel queries at a `max: 10` pool. It is not sync-specific — `/api/readiness-score` and
   `/api/body-battery` share the signature, which means the "⚠️ cause NOT diagnosed" row for those two
   routes and Q-107 are **the same issue**. It stayed undiagnosed because `lib/observability.ts:9-10`
   discards `err.cause`, where Drizzle puts the real Postgres error.
3. **Two of the four headline scores carry much less information than they appear to.** Measured over
   91 days: the Activity Score is effectively a step counter (r=0.775; `strengthFreq`, its largest
   weight, has been exactly 100 on **91/91 days**), and the Sleep Score's compression traces to four
   saturated contributors. Both are ⛔ owner decisions — Q-137 and the Q-72 update.
4. **A cross-user data leak** (Q-129) and **an activity date filed in the device's timezone rather
   than the user's** (Q-123c) — the latter is persisted data, so it cannot be corrected after the fact.

**Two corrections to previously-recorded claims, both of which had cost real time:**
- **Q-73 and its Known-Issues row state that `/` mounts all five tabs**, so a mismatch in any tab
  surfaces there. **That is false.** `components/shell/tab-shell.tsx:57-61` initialises
  `mounted: [initialTab]`; the rest mount on first activation, which is client-only and cannot
  hydrate. The search space was always the home tab alone — and that wrong premise is what produced
  two dead-end investigations.
- **SEC-H2 is fixed.** A sweep re-reported that `app/api/oura/webhooks` echoes the HMAC signing key
  (from the 2026-07-06 review). It does not — the route returns `{success: true}` and carries an
  explicit comment forbidding it. The claim was dropped rather than passed on. Do not re-raise it.

**Also worth knowing (clean results, so they are not re-audited):** zero persisted-vs-recomputed score
divergence across 88 pillar-days · auth solid (only 6 of 201 routes unauthenticated, all deliberate;
all 25 admin routes re-read the DB) · zero `JSON.parse` of model text · poison-pill handling correct ·
`RECONCILE_TABLES` machine-checked with zero mismatches · instant-paint genuinely done · **the
2026-07-20 Zustand hot-path finding is fixed** · every safe-area utility exists and is the correct
variant · referential integrity clean · `onset_latency_sec` genuinely fixed (100% → 23% null).

**⚠️ Not verified:** no device, emulator or browser was used. Q-118's on-device magnitude, Q-119's
contrast ratios (reasoned from OKLCH, not measured), Samsung WebView rendering and native SQLite paths
were all unexercised. The dead-route ledger is static analysis.

**Open question for the owner, recorded rather than guessed:** `supplement_logs` (1 row ever, none
since 2026-06-21), `food_logs` (none since 2026-07-26), `step_live_windows` (2026-07-28) and
`oura_accel_chunks` (2026-07-15) have all gone quiet in production. Q-124 gives a plausible mechanism
for the supplements case; the rest need the owner to separate "stopped logging" from "broken".

### [platform][devices] 🟠 Voice logging is broken on the device right now — the APK carrying it was never installed (found 2026-08-07)

`"SpeechRecognition" plugin is not implemented on android` fired three times in production,
2026-08-05 and 2026-08-06, from `/workout`. That is direct evidence that the APK carrying v1.258.0's
native-STT rebuild has **not** been installed on the S25 — the JS half shipped via Railway and is
calling a native plugin that isn't there.

**Still live — re-read 2026-08-25 and it has not stopped:** five more from `/workout`, latest
**2026-08-24 21:41 UTC**. Three weeks on, the owner is still reaching for voice logging and still
getting nothing. (The 2026-08-19 read found 12, against the 4 this row first claimed.)

**The message changed spelling on 2026-08-17**, which strengthens rather than weakens the diagnosis:
10 reads `"SpeechRecognition" plugin is not implemented` (08-05 → 08-16), the last 2 read
`"SpeechRecognition.then()"` (08-17 → 08-18). The JS half moved again — the call is now awaited —
into a device that still cannot run it. Only installing the `apk-latest` release fixes this, and that
is the owner's action; until then further JS work here is invisible on the device.

**Both counts above are floors** — `error_events` prunes at 30 days and the `claude_ro` view is
row-scoped to one user. That lesson is now a standing rule in `CLAUDE.md`'s session-start ritual
rather than a paragraph inside one device issue, which is where it belongs.

Within that scope, the only other events in 24 hours were one `/api/body-battery` + one
`/api/readiness-score` `Failed query` in **the same second** (2026-08-08 03:26:19) — one transient DB
blip hitting two concurrent queries, not two faults.

**DB health checked in the same pass and is sound.** `oura_raw_samples` is 311 MB growing steadily at
~24k rows / ~570 kB of `body_hex` per day with no acceleration; autovacuum is current and dead tuples
are zero on the two largest tables. One observation short of a finding: `oura_raw_samples` has
autoanalyzed **once**, with ~36k modifications since — the default threshold
(`50 + 0.1 × n_live_tup` ≈ 90k rows) means statistics refresh only about every 3.7 days at the current
ingest rate, so planner stats on its time columns lag by days. **Whether that actually produces a bad
plan was not measured** — no `EXPLAIN` was run, so this is a lead, not a diagnosis.

This makes three ⚠️ rows concrete rather than merely unverified: the voice-logging rebuild
(v1.258.0), the ring + strap notification quieting (v1.259.0), and the scale notification quieting
(v1.257.3) all say "needs the new APK". **This is owner action, not a code fix** — the APK is already
built and published by CI at
`https://github.com/nekodas-neko/TrainingAI/releases/download/apk-latest/app-debug.apk`.

Related and worth doing in the same pass: **90 rows in this file carry a NOT-verified-on-device
marker**. They have accumulated to the point where no one can act on them individually. Installing the
current APK and running `docs/device-smoke-checklist.md` once would clear a large batch of them at
one go.


### [cardio] Running-plan override local-write fix (Q-98 bug-fix half, 2026-08-06, v1.267.7) — NOT verified on device · needs: browser

Fixes a real APK-only bug: `applyOverride` (swipe-to-pick-a-different-run-type after skipping
today's run) only did a bare `fetch`, unlike `markRun` which writes through the local SQLite store
+ outbox. On a device with a real local store, this let the screen's local-first status effect
re-read the stale `'skipped'` row `markRun` left behind and clobber the optimistic `'pending'`
reset back to skipped — permanently defeating the swipe-to-reset-status path, which read to the
owner as "I picked a different run, nothing happened." Invisible on web
(`getLocalStore()` returns `null` there), which is why the bug survived past `pnpm dev` testing.

Fixed by writing the override's server response through `store.upsertPrescribedRun(...)` as
`synced`. **The failing path is structurally unreachable in this sandbox** (no native SQLite here)
— only the unaffected web path was verified (regression-free, since this change's new code never
runs on web). Needs a real on-device swipe-to-pick-a-different-run-type check, after a skip, before
this can be marked confirmed. Full detail:
[`docs/overview/history-2026-08-04.md`](docs/overview/history-2026-08-04.md).

### [sleep] ✅ Sleep analysis counts nights, not rows (Q-76, 2026-08-05, v1.261.0) — two nights still unrecoverable

Eleven read sites called `listSleepSessions` and treated each row as a night. Production stores
**66 rows for 54 nights**: twelve are daytime/evening bouts, and one real night (2026-05-29) arrived
as two rows either side of a wake-up. Measured against the production table, **7 of the 54 dates fed
the wrong sleep duration into the sleep-vs-performance correlation**, six of them by roughly eight
hours — 2026-07-04 was read as **0.11 h instead of 8.22 h** because a `Map` keyed on date let the
nap overwrite the night. The 29 May night read as 4.02 h instead of 6.55 h.

`nightSessions()` (`packages/shared/src/health/sleep-night.ts`) already did both halves of this —
circadian nap/night classification, then gap-merge — so **the `isAnalysableNight()` predicate the
backlog entry proposed was deliberately not built**; a second rule beside the existing one is the
"One Formula, One Place" failure this codebase keeps paying for. The eleven sites now route through
it: sleep-performance-correlation, health-trends `meal-timing`, progress-summary, bedtime-estimate,
ai/health-insight, nutrition-goals/recommend, ai-chat, both ai-chat recovery tools,
`sleepDurationTrend`, and the running plan's short-sleep gate. Four read sites were left on raw rows
**on purpose** and say so in comments — the day timeline, the sleep list, `oura/hr-day`, and the two
daytime-HRV sleep-exclusion windows all want naps included.

`sleepDurationTrend` also stopped counting a duration-less row as **0 hours** — legacy parity that
manufactured exactly the sleep deficit the ratio exists to detect, and the input to the AI-dynamic
0.85 low-sleep gate.

**Still broken, and no read-time rule can fix it:** 2026-06-01 (1.45 h) and 2026-06-04 (3.83 h) are
the only rows on their dates — the rest of each night was never stored. **2026-06-02 and 2026-06-03
have no sleep row at all.** Both need a redecode/backfill from `oura_raw_samples` or the gap stands.

**Not exercised:** the local seed's sleep rows have `sleep_start == sleep_end` and no naps, so the
dev-server pass proved the routes still return 200 with byte-identical payloads (a genuine
no-regression result) and **not** that the nap filtering fires — that was measured separately by
running the real production rows through the helper. Nothing here is device-dependent (no native,
safe-area, gesture or notification surface), so the APK inherits it on the next Railway deploy.

### [heart-rate][devices] 🟠 Health tab's "Live HR" card shows a live reading without the owner tapping "Measure now" — likely tied to reported ~15%/night ring drain (found 2026-08-06, root cause NOT pinned down)

Owner noticed the Health screen's "Live HR" card reading a fresh bpm value despite never tapping
"Measure now," and suspects this is why their ring loses ~15% battery overnight. Traced the
mechanism, but this needs on-device evidence before a fix can be scoped — recorded as an open
investigation, not a confirmed root cause.

**Structurally confirmed**: `MeasureHrNow` (`components/health/measure-hr-now.tsx`) renders
`useLiveHr()`'s `bpm` unconditionally — it does not gate display on whether *this component*
started the stream. `useLiveHr()` (`lib/live-hr/use-live-hr.ts`) is explicitly documented as
"read-only... does NOT start/stop the manager" — it just subscribes to the app-wide `LiveHrManager`
singleton (`lib/live-hr/manager.ts`). So the card showing a live, non-stale reading (opacity-normal,
meaning the sample is under 8s old — a genuinely active stream, not a stale leftover) means
*something else in the app* currently has the manager's workout-grade live path engaged. This is
the correct symptom to chase for a real leak, but on its own doesn't say what's causing it.

**Design intent confirms this shouldn't happen from ring drain alone**: the ring is deliberately
**workout-only**, never ambient (`manager.ts:14-18,89-92`) — explicit comment: "keeps the ring's
battery-costly burst loop from running 24/7." Only the chest strap (if paired) runs in ambient
(all-day) mode by design. So a live ring reading outside an actual workout is a real deviation from
intended behavior, not a documented ambient feature — worth chasing, not dismissing.

**Leak vectors worth checking, most-likely first, none confirmed yet**:
1. A stale/abandoned workout sitting in `store.mode === 'active'` in the persisted Zustand store
   (workout state deliberately survives a refresh, per this file's own Known Issues) — `workout-screen.tsx`'s
   `useEffect` calls `mgr.start()` whenever `liveHrRun` (`mode === 'active' || 'exercise-summary'`)
   is true, with `mgr.stop()` only in the effect's cleanup. A workout left active without ever being
   properly finished/left would keep this engaged indefinitely.
2. The native BLE foreground service surviving an app crash/force-kill without ever receiving the
   JS-side stop call — Android foreground services are independent of the JS/React lifecycle, so a
   killed app mid-workout could leave the ring's native burst loop running all night with nothing on
   the JS side left to tell it to stop.
3. Lower likelihood, worth ruling out: a debug console (`components/oura-ble/live-hr-test-console.tsx`)
   left running — admin-only surface, so unlikely for normal use, but has its own start/stop pairing
   worth double-checking against this same class of leak.

**Not yet fixed — needs on-device diagnostics before a fix is scoped.** Check
`getLiveHrManager().getDiagnostics()`/the ring source's connection state during a period of reported
drain, and check whether the workout store's persisted `mode` was stuck at `'active'` overnight,
before committing to one of the leak vectors above. Backlog entry: **Q-116**
(`docs/implementation-backlog.md`).

### [workouts] 🟢 Manual "Deload" choice on Home had NO effect on prescribed weights/reps for any AI-dynamic session with an active prescription (found 2026-08-06, fixed 2026-08-07)

Owner picked "Deload" from Home's three-way Full/Deload/Rest card before a Legs session; the
resulting pre-workout screen showed the same "AI Prescription · Intensification" numbers as a
normal Full session, with no visible deload treatment.

**Root cause, confirmed real, not a display-only gap:** `handleDeload`
(`session-select-content.tsx:929-932`) routes to `/workout?session=<id>&aiDeload=1`. Server-side,
`aiDeload=1` reached `app/api/workout-data/route.ts:359-378`, which set
`sessionPhaseStatus.isDeloadActive = true` — but that flag only reached the actual prescribed load
through `deloadAwareStylePhase()` (`packages/shared/src/phase-engine.ts:125-134`), a mechanism that
swaps in a lighter phase style and **only applied to the static-progression-style path**. The moment
`aiDrivesLoad` was true — i.e. an AI-dynamic prescription actively driving load, the normal state for
this program — `buildWorkoutExercises` (`packages/shared/src/workout/session-data.ts`) unconditionally
applied `prescriptionStyleForExercise(p)` from the already-generated prescription, with no reference
to `aiDeload` at all. The only per-exercise reduction that could appear was `p.deloaded`, a flag baked
into the prescription **at generation time** by the AI-dynamic engine's own independent, automatic
emergency/per-exercise deload detection — a completely different mechanism from the user manually
asking for a lighter session today.

**Fixed:** `buildWorkoutExercises` now applies `deloadOverrideForGoal(trainingGoal)` — the same
tuned `DELOAD_LOWER_PCT`/`DELOAD_REPS`/`DELOAD_SETS`/`DELOAD_REST` constants the automatic engine
already uses — in a new `else if (aiDeload)` branch, skipped when the exercise was already deloaded
by the automatic engine so the two reductions don't compound. `preDeloadStyle`/`preDeloadSets` are
populated from the pre-deload numbers so the existing revert-to-full-weights UI
(`DeloadInfoSheet`) works for a manual deload too. Setting `deloaded = true` on the returned
`WorkoutExercise` automatically extends the existing `exerciseDeloaded` payload flag and this
session's earlier 1RM-inflation fix (below) to also exclude manually-deloaded sets from PR/1RM
credit, with no additional server-side wiring. Verified via a direct unit test against the pure
`buildWorkoutExercises` function (the local seed program is `phase_mode='manual'`, not `ai_dynamic`,
so a live API/UI verification of this specific path wasn't possible this session — **not
device/live-API verified**, unit-test-verified only).

**Separately, owner-requested UX change — ✅ SHIPPED 2026-08-08 (Q-109-followup, v1.270.28):** the
Full/Deload/Rest choice moved off Home (now Rest/Full only) onto the pre-workout screen, beside the
Quick/Normal/Long duration picker, so choosing Deload happens at the point that actually determines
the session.

### [heart-rate][workouts] ✅ Per-set HR now records which device measured it (2026-08-05, v1.260.0)

From the null-rate sweep — **847 columns across 69 tables**, one `count(col)` each: **49 are 100%
null in a table that has rows.** Most classified out against their writers. Two survived:
`oura_daily_derived`'s ten always-null columns (the queued **Q-7b**, count corrected from eight),
and **`set_hr_stats.source`** — declared in migration 139, never written, never read, 582 rows.

`source` now records `chest_strap` / `oura_ble` / `mixed` per set. The data was always there;
it never reached the per-set rows. Reads the **working-set window only**, not the rest after it
(where the ring takes over if a strap comes off), and stays **null rather than `'unknown'`**. What
the still-open half of **Q-11** needs. Existing rows fill in via **Admin → Tools → "Backfill per-set
HR stats"**. Seven tests, two of them DB round-trips — `workout_hr_stats` failed at exactly that
seam, computed correctly and rejected by the column, while its unit tests passed.

### [platform] ✅ The rollup tests weren't flaky, they were slower than the limit (2026-08-05, v1.260.1)

CLAUDE.md carried a standing instruction to re-run DB tests alone before believing a red CI, blamed
on connection-pool oversubscription. **That explanation was plausible and never measured.**

Timed alone with zero contention, every file running a full `aggregateOuraRawSamples` pass takes
**3.4 s to 14.6 s** against vitest's **5000 ms** default — `oura-ble-sleep-bedtime-fragment` at
14.55 s, `sleep-fallback` 9.42 s, `staging-rollup` 6.51 s. Three sat within 20% of the limit before
any parallel load. The suite was flaky by construction and the documented workaround was to
disbelieve it — which cost **four false alarms in one session**.

**The v1.259.1 daytime-HRV refit was the obvious suspect and was measured out** — stubbed, the same
files take 5.50 s and 6.11 s vs 6.04 s and 5.86 s. Indistinguishable.

Fixed with a separate `rollup` vitest project at a 60 s timeout; the other ~380 files stay at 5 s so
a genuine hang still fails fast. **Not** a raised global timeout — that would hide real hangs
everywhere, which is the opposite of the point. Full suite now 397 files / 3,136 tests, exit 0, same
file count as before the split.

The CLAUDE.md rule is narrowed rather than deleted: genuine pool exhaustion is still possible and
has a **different signature** (a connection-acquisition failure, not a 5 s timeout), and the
operative line is inverted — a rollup test that times out now is worth believing. **Keep the glob in
step with `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/`**; a new rollup test
outside it inherits the 5 s default and becomes the next false alarm.
### [platform] ✅ The audit view was lying — `program_phases` scoped on a column nothing sets (2026-08-05, v1.259.2, migration 167)

The gap sweep reported *"eight phase sets contain no phases"*. **That was the tool, not the data.**
`claude_ro.program_phases` scoped through `program_id`, which is nullable (migration 024 is named
for making it so) and which the modern write path never sets — `createPhaseSet`, `updatePhaseSet`
and the 042 seed all insert with only `phase_set_id`. Measured locally: **573 phases, 0 with
`program_id`, 573 with `phase_set_id`** — the old predicate could return zero rows for any user,
ever.

Fixed by scoping through `phase_sets`, keeping the `program_id` arm for legacy rows, regenerated
into migration **167** (never edit an applied migration — `ensureSchema` tracks by filename). A
DB-backed test pins the scoping and asserts the OR arm doesn't leak across users.

**The lesson is about the tool.** An audit view filtering on the wrong column doesn't fail, it lies
consistently, and every conclusion drawn through it inherits the lie. Treat a zero that no code path
explains as a claim about the *view* until proven otherwise.

Regenerating also picked up **`prescribed_runs.segments` and `exercise_library.merged_into`** —
columns added by migrations 163–166 without re-running the generator, and therefore unreadable under
the default-deny schema. Four migrations had missed that step.

### [readiness][devices] ✅ Q-81 — a query filtered on a column nothing has ever written (2026-08-05, v1.259.1)

The sweep guessed the daytime-HRV model was failing downstream, in the extractor or the fit.
**Wrong — execution never got there.** `getOuraRawSamplesForTags` filtered on `decoded IS NOT NULL`,
and that column is NULL on **all 812,816 rows across all 30 tags**. `body_hex` is the archival
source of truth and every other consumer decodes on the fly; this function was the odd one out, so
it returned an empty array to every caller, always.

**Two victims, one already on the record:** `oura_daytime_hrv_model` empty since the feature shipped
(Body Battery's D5 input permanently absent), and `/api/oura-ble/device-metrics` returning
`{"days": []}` — which the 2026-08-05 navigation entry had recorded as unexplained. Same cause.

Fixed by decoding from `body_hex`, matching the three existing sites in the same file. **Two further
finds while fixing it:** the caller asked for a 60-day window and was being silently clamped to 31
(now an exported constant, so the lie is gone), and the refit's throttle only applied *once a model
existed* — so with an empty table it ran on every rollup, which was free at zero rows and would have
become a ~43k-row / 503 KB read on **every ingest drain** after this fix. Now throttled on attempt.
That was a regression this fix would have introduced, caught by asking what the change costs on the
path it runs on. Both silent bails now report into `stepErrors`.

**Verified:** a DB-backed test drives real production hex through the real repository function to a
model that actually fits (60 rows → 150 samples → finite coefficients); reverting the one-line
filter reproduces the production numbers exactly (0 rows, 0 samples).

**⚠️ Not verified — whether it fits on the owner's real data.** The test proves the chain, not that
31 days of the owner's nights clear `MIN_TRAINING_SAMPLES = 50` with enough variance for a
non-singular system. The refit runs inside the ingest rollup, so this resolves on the next drain.
**Worth re-checking after a day:** `oura_daytime_hrv_model` should have a row, and device-metrics
should stop returning `{"days": []}`. If it still refuses, the new `stepErrors` message names which
reason — which it never did before.

### [platform][devices] ⚠️ Ring + strap notifications quieted with a low-battery exception — needs the new APK (2026-08-05, v1.259.0)

Answers Q-67's open sibling question. The owner's answer improved on it: quiet the ring and strap
ongoing notifications like the scale's, **but surface the battery once it drops below ~35%**.

Two channels, because a `NotificationChannel`'s importance is fixed at creation and cannot be raised
for one notification: the ongoing status channel drops to `IMPORTANCE_MIN` (ids bumped to
`oura-ble-v2` / `polar-ble-v2`, legacy deleted — Android will not retroactively lower an existing
channel), and a separate one-shot `IMPORTANCE_DEFAULT` alert fires on the downward crossing.

**Hysteresis is the feature.** The ring polls every 5 minutes, so a naive threshold check would post
**288 notifications a day**. `DeviceBatteryNotifier.decide` fires once on the way down and re-arms
only above **40%**, not 35 — a single threshold would let a boundary reading alternate and notify
every other poll. Charging both suppresses and clears. Eight JUnit cases including a simulated
day of polls asserting exactly one alert.

**Not verified — native, no APK in-session.** CI compiles the Kotlin and runs the JUnit tests, and
the hysteresis was re-derived independently, but none of that shows how One UI renders
`IMPORTANCE_MIN` (it has differed from stock AOSP before). **On device:** confirm both ongoing
notifications lose their status-bar icons; confirm the low-battery alert fires once when a device is
genuinely under 35% and **does not repeat five minutes later** — that one needs a full day's
watching. Thresholds are named constants, one-line changes if 35/40 turn out wrong.

### [workouts][platform] ⚠️ Voice logging rebuilt on native STT — needs the new APK, unverified until then (2026-08-05, v1.258.0)

Q-64. Two stacked causes, both hit before any speech could be recognised: `RECORD_AUDIO` was never
declared in the manifest (Android silently fails a runtime request for an undeclared permission, so
the WebView's `AUDIO_CAPTURE` request was denied and `onerror` fired in the same tick — the
"turns off instantly" symptom), and an embedded WebView has no speech recognition service anyway, so
declaring it alone would not have produced transcripts.

Now: manifest `RECORD_AUDIO` + an Android 11+ `<queries>` intent for `RecognitionService` (without
it, package-visibility hides the recogniser and `SpeechRecognizer` reports unavailable), and
`@capacitor-community/speech-recognition@7.0.1` wrapping Android's own recogniser. Its peer range is
`>=7.0.0` against our `@capacitor/core ^8.3.4`, so the plan's "Capacitor 8 compatibility TBD" is
resolved. Failure states are now visible instead of silent. The web path is unchanged and stays
logic-free.

**Verified:** the web path in a browser against `pnpm dev` (button renders, no crash, no regression)
and six new `parseVoice` tests. **NOT verified — and it is the actual fix:** whether the recogniser
produces a usable transcript on the S25. No microphone, no Android runtime, plugin resolves to null
off-device.

**On-device:** tap Voice mid-set, grant the prompt, say "eighty kilos five reps", confirm the dial
and reps update; tap again without re-granting; then deny once and confirm it says "Microphone
permission denied" rather than going quiet. **Needs the new APK** (CI builds it; `apk-latest`).

### [platform][devices] ⚠️ Scale notification quieted — needs the new APK, and the sibling services are still loud (2026-08-05, v1.257.3)

Q-67: the scale's ongoing "Connected — listening for weigh-ins" channel dropped
`IMPORTANCE_LOW` → `IMPORTANCE_MIN` (no status-bar icon, collapsed to the bottom of the shade). The
channel id had to change to `scale-ble-v2` — `NotificationChannel` is immutable once created and
Android will not retroactively lower an existing channel, so an upgraded install would otherwise
keep the old one and see no change. The legacy id is deleted on first run. The four one-shot event
channels are untouched.

**Native — a new APK is required** (CI builds it; `apk-latest` after merge). Compile-gated only in
the sandbox, so nothing here is observed working. On-device: check the ongoing notification loses
its status-bar icon (One UI's `IMPORTANCE_MIN` treatment can differ from stock AOSP), that
"Weigh-in logged" still shows normally, and that the scale still connects and logs.

**⚑ Owner question, unanswered on purpose:** the Oura ring and chest-strap services show the same
persistent "Connected" notification, and the plan said not to change them without asking. This
matters more since v1.257.0 — the strap auto-retry restarts the strap's foreground service roughly
every 4 minutes while the app is foregrounded and the strap is off, so "Connecting to strap…" now
cycles rather than sitting still. Quieting that channel the same way is the obvious follow-up if
wanted; the ring's "Connected · 37% battery" line may be genuinely useful.

### [workouts] ⚠️ PiP rest countdown (Q-65) is not device-verified — and structurally cannot be here (2026-08-05, v1.257.1) · needs: android

The exercise-summary PiP branch was a static "Done / tap Next" card that never read
`lastSetRestStartMs`, so backgrounding into PiP during the last set's rest lost the countdown. It
now routes through the same `PipView` the active branch uses, with the identical inputs
`LastSetRestTimer` subscribes to.

**Unverifiable in the sandbox by construction:** `usePipMode()` flips on a `pipModeChanged` window
event, and `grep -rn pipModeChanged` finds exactly one dispatcher —
`android/app/src/main/java/com/trainingai/app/MainActivity.java:578`. No web path sets it, so no
amount of browser driving reaches this branch. Verified by reading, not running.

**On-device check:** log the last set of an exercise to land on the summary screen with the rest
ring counting, then background into PiP. Expect the countdown ring (filling → red `+overtime`),
not "Done / tap Next". **JS-only — ships with the Railway deploy, no APK.**

**Related sandbox limitation, unexplained:** a set cannot currently be logged through `pnpm dev` in
a headless browser — the Log Set button is enabled and clicks without error, but the label never
advances and no `/api/log-exercise` request fires. Not chased to root cause and most likely a
sandbox artefact (the owner logs sets on device daily), but it means the workout-logging path is
not drivable end-to-end in the browser harness.

### [app-shell][devices] ⚠️ Strap auto-reconnect is NOT device-verified (2026-08-05, v1.257.0) · needs: hardware

Two owner-reported faults were fixed in one PR. The first is verified; the second is not.

**Verified — the More tab never refreshed.** All five tabs stay permanently mounted
(`components/shell/tab-shell.tsx`), so a `useEffect(…, [])` fetch runs once per app launch. The
persistent-tab-shell plan wired `epoch` through Home, Health, Workout and Nutrition — and never
covered More, so an app restart was the only way to update profile, stats, season badges, the
friends feed and leaderboard, ring battery/last-sync, outbox health, the update card, and the
scale/strap pairing rows. Fixed with a shared `useRefreshOnTabShow()` hook in
`components/shell/tab-visibility.tsx`. **Confirmed in a real browser** (headless Chromium against
`pnpm dev`, 412×915): first show fetched nothing (module cache warm, correct), and both re-shows
re-fetched `/api/user/profile`, `/api/seasons`, `/api/friends`, `/api/friends/feed` and
`/api/oura/token`. No page errors.

**NOT verified — the strap gave up and never retried.** Both strap paths stop trying by design:
the native foreground service after its ~4 min backoff ladder (`PolarStrapService.kt`,
`MAX_CONSECUTIVE_FAILURES = 6`, then `stopSelf()`), and the WebView fallback after
`RECONNECT_DELAYS_MS` (~17 s). The service's own comment says *"JS restarts it on the next app
open"* — nothing did, because `startAmbient()` is guarded by `if (ambientWanted) return` and
`LiveHrAmbientProvider` mounts once. So a strap put on after launch stayed disconnected until an
app restart, which is exactly what the owner hit. Fixed by adding `retry()` to the source contract
and `retryAmbient()` to the manager, driven by a 60 s foreground tick +
`visibilitychange` + the More tab re-show + a workout starting.

**Why it is unverified:** every path is BLE and native. The sandbox has no Bluetooth, no Polar H10,
and `getPolarBle()` returns null off-device, so the fallback path is the only one that could even
execute here and it has no radio either. Unit tests cover the manager's decision logic (7 cases in
`lib/live-hr/__tests__/manager.test.ts`) — they prove `retryAmbient` calls `retry()` on ambient
sources only, never wakes the ring, is inert unpaired, survives a throwing source, and does not
re-reconcile once started. They prove nothing about whether the H10 actually reconnects.

**What would confirm it, on the S25:** open the app with the strap off and the More → Workout tab
showing the strap card; leave it 5+ minutes so the native service exhausts its ladder and stops;
then put the strap on and watch the card **without restarting the app**. It should flip to
connected within ~60 s. Also worth checking the battery cost of the foreground tick over a day with
the strap deliberately off — the tick is a no-op while connected, but while disconnected it
restarts the service's ladder roughly continuously.

**Note this is a JS-only change** — no APK rebuild needed, it ships with the Railway deploy.

### [app-shell] ⚠️ Navigation speed has never been measured — and that is why Q-1b got closed on the wrong evidence (2026-08-04)

The owner reported navigation feeling not-quite-swift, and clarified it was **not** cold start.
Cold start *was* measured (472 ms, Q-51 Task 3) and is fine. **Navigation has not been measured at
all**, and Q-1b (bundle the shell) was closed against the cold-start number — which does not cover
the question actually being asked. The drop still looks right on cost, but it rests on evidence
about a different thing; say so rather than treating it as settled.

Two behaviours are being conflated and only one is fast:
- **The five bottom tabs** stay mounted; switching flips visibility, no network. Confirmed instant.
- **Everything else** is a real route navigation fetching an RSC payload from Railway. `<Link>`
  prefetches automatically; a **`router.push` from a button does not** (#919) — and most of this app
  navigates by button.

**Shipped:** the four targets that had no prefetch — `done-screen` → `/session-select`,
`done-activity-screen` → `/workout-select`, `workout-select` → `/cardio`, `running-plan` →
`/cardio`. **Effect unverified**: prefetch is client-side and cannot be observed from `pnpm dev` or
a test, only on the phone.

**Left deliberately undone (Q-70):** `session-select` prefetches only the *recommended* session, so
tapping any other one is cold — the app's most-used navigation. The code carries a documented reason
(*"N payload fetches to serve one tap"*), and overturning it needs a measurement. The approach that
avoids the trade is prefetch-on-`onPointerDown`, which covers every session at zero waste.

**A correction worth carrying:** I first reported "42 push sites, ~5 prefetched, ~35 cold
navigations". Counting per file rather than in aggregate, the sweep had **largely already been
done** — the real gap was four. Second time in one session a quoted number did not survive checking.

**Update (v1.255.0) — the instrument now exists; the measurement is still owed.** Rather than carry
this argument into another session, navigation is now measured on the device: every tap that changes
the URL records `urlMs` / `paintMs` / `settleMs` and, critically, **`rscCount` — 0 means the route
was already warm**, which turns "did the prefetch work?" into a per-navigation boolean. Read it in
**More → Admin → Device data capture** (`Reset nav timings` → use the app → `Run all` → Copy).
Verified working end-to-end in a real Chromium against `pnpm dev` — including the query-only
`/workout` → `/workout?session=…` transition, which recorded a cold 243 ms payload fetch and which a
`usePathname` hook would have missed entirely. **What is still not measured is the phone**; until
the owner runs a capture, both the prefetch sweep's effect and the Q-1b bundling drop remain
supported by no navigation evidence. One field, `settleMs`, has never been observed diverging from
`urlMs` (nothing local was slow enough to have a settling phase) — see the journal entry.


### [app-shell] ⚠️ The update banner cannot see a native change that ships without a version bump (2026-08-04, v1.256.0)

**Fixed and verified in the diff (Q-59):** `UpdateCheckCard` now compares the installed APK against
`nativeVersion` — the version of the newest published `apk-latest` release — instead of the server's
`package.json`, and `package.json` is out of the Android workflow's path gate so a version-only bump
no longer republishes an identical APK. Three states now, including a positive **"Up to date"** the
card never had (it rendered `null` when there was no update).

**The residual hole, accepted deliberately:** a native change merged *without* a version bump
republishes the APK at the **same** version, so the card sees no difference and stays quiet — the
owner would never be told a genuine new build exists. Closing it properly means stamping the build's
commit SHA into the APK and comparing that, which needs a Gradle change **and** one bootstrap install
before it can work at all. Judged more machinery than the reported bug warranted. The mitigating
convention is the standing rule that user-visible changes bump the version, which every native change
in this repo's history has followed — but it is a convention, not a gate.

**Not verified:** the card is `Capacitor.isNativePlatform()`-gated, so none of its three states ever
rendered — the decision logic is unit-tested, the markup is not.

**🔴 LIVE DEFECT, found immediately after the merge:** production `/api/version` returns
`"nativeVersion": null`, so the card is currently showing **"Could not check for a newer build"** —
not the up-to-date/update state it was built for. Re-checked after the 300 s fetch-cache window (the
publish step *deletes and recreates* the release, so a lookup in that gap legitimately 404s):
still null, so it is persistent, not the gap. v1.256.1 adds `nativeVersionStatus`
(`ok` / `unconfigured` / `unavailable`) to tell a missing `GITHUB_RELEASES_TOKEN` apart from a
GitHub-side failure, readable from the admin data-capture console. **If it reports `unconfigured`,
the token is unset in Railway — and More → Download APK has been 502ing all along, since it uses the
same token.**


### [app-shell] ✅ React hydration error on the home screen — 283 times (found 2026-08-04) — **FIXED 2026-08-07 (Q-73)**

> **⚑ Read this first — the section below is preserved for its evidence trail, but two of its
> conclusions are wrong.** The cause was found on 2026-08-07 and reproduced without a device:
> `app/session-select/session-select-content.tsx:1063` called `toLocaleDateString("en-AU", …)` with
> **no `timeZone`**. Railway sets no `TZ`, so Node rendered **UTC** while the S25 rendered
> **Australia/Brisbane** — for the 42% of each day between 00:00 and 10:00 AEST the server sent
> yesterday's weekday+date and the client rendered today's (`"Thursday 6 August"` vs
> `"Friday 7 August"`). It was the banned `toLocale*`-without-`timeZone` pattern from CLAUDE.md's
> Timezone section, on the home header.
>
> **Correction 1 — the "all five tabs mount at once" claim below was FALSE**, and it is what produced
> both dead ends. `components/shell/tab-shell.tsx:57-61` initialises `mounted: [initialTab]`; the
> other four mount on first activation, which is client-only and cannot hydrate. **The search space
> was always the home tab alone.**
>
> **Correction 2 — "needs the un-minified error captured on the device" was not true either.** The
> reason it never reproduced in the sandbox is that `pnpm dev` runs the server and headless Chromium
> in the **same timezone**, so both sides format identically. No device was needed; a timezone
> difference was.
>
> **Fixed (Q-73, v1.267.18):** the header date now renders via `formatInTimeZone(new Date(),
> DEFAULT_TZ, "EEEE d MMMM")` — a fixed timezone, not either side's ambient system tz — so server and
> client always compute the identical string. Swept the same banned pattern at three sibling sites
> found by grep: `getGreeting()`'s `new Date().getHours()` four lines above the header fix (same
> file, gated behind a currently-null `displayName` so not yet a live mismatch, but the same class),
> plus the identical bare `toLocaleDateString` on `overview-screen.tsx` and
> `pre-workout-screen.tsx`. Detail:
> [`docs/overview/history-2026-08-04.md`](docs/overview/history-2026-08-04.md),
> [`docs/reviews/2026-08-07-full-app-review.md`](docs/reviews/2026-08-07-full-app-review.md) §2.1.

**Minified React error #418** (`args[]=text` — *"Text content does not match server-rendered HTML"*),
reported by the client error reporter from real browsing. `/` has **283** occurrences with the most
recent on **2026-08-03**, running 1–13 a day with no downward trend. `/health` (17) and `/more` (15)
both stopped 2026-07-14; home did not.

**Established:** it is a *text* mismatch, so the pre-hydration theme script (classes and
`data-brand`) is not the cause. The session-165 lazy-initializer rule is **not** being violated —
`useState(() => readCacheSync…)` returns nothing across `app/` and `components/`. `/` renders
`TabPage`, and the shell mounts **all five tabs at once**, so a mismatch in any tab's content
surfaces on `/` — which explains the ~17× count and widens rather than narrows the search.

**Did not reproduce** on `pnpm dev` (which emits the un-minified error naming the component and both
texts) driven with Playwright at the S25 viewport as the seeded user. So it needs production data,
the WebView, or a specific time — not the sandbox.

**Two leads chased and killed — do not re-chase.** (1) `toLocaleString()` on the steps number: this
Node is full-icu and returns `1,234`, identical to Chromium. (2) DOM nesting (the error's args
`['text','']` read like *"text cannot be a child of <x>"*): there is no table markup anywhere on the
home path. **Next step is the un-minified error captured on the device** — it names the component
and prints both strings, and two rounds of static reasoning have now produced two dead ends. Full
evidence in
[`docs/reviews/2026-08-04-error-events-first-read.md`](docs/reviews/2026-08-04-error-events-first-read.md).

**Worth noting how this was found:** `error_events` had been collecting for a month and nobody had
read it. Two *other* faults in the same table had already stopped on their own before anyone looked,
and the table prunes at 30 days — so a fault that self-resolves disappears unrecorded.


### [sleep] 🔴 The Sleep Score cannot tell a good night from a bad one — measured against 32 rated nights (2026-08-04)

**Measured, not suspected.** Production `sleep_sessions` run through the real `computeSleepScoreSeries`
and paired against the owner's own morning ratings (`day_checkins.sleep_quality_feel`, 1 = best),
longest session per date:

| | value |
|---|---|
| paired nights | 32 (2026-07-03 → 08-04) |
| **Sleep Score** | mean **91.3**, sd **4.4**, range **80–98** |
| owner's feel | mean 2.59, sd 0.78, range **1–5** |
| correlation | r = −0.354 (correct sign, weak) |

**The score never left the 80s/90s across an entire month** while the owner's experience used the
whole scale. A night rated **5 (worst)** scored **80**; a night rated **4** scored **93**; nights
rated **1 (best)** scored 93 and 92. Worst-of-month and best-of-month land within a point of each
other.

**Two things this changes.** Q-3b was marked *"⛔ owner/data-gated — no code without that data"*;
**the data has existed all along** — the morning check-in has been collecting the rating since
2026-07-03 and `/api/admin/sleep-feel-calibration` already reads it. And the owner's suggestion to
"move the calibration to the morning check-in" is **already built**, so no UI work is needed.

**⛔ Not fixed — needs an owner decision.** Re-tuning the Sleep Score changes a number they read
every morning, and "what should a bad night score" is a product judgement. Tracked as **Q-72**.

**🆕 2026-08-06 — a THIRD direction shipped (v1.267.0), not a resolution of this finding.** The
owner explicitly declined both of this entry's original options (rescale the whole model, or make
`sleep_quality_feel` a live input) and asked for an objective awake-time/fragmentation criterion
instead. An awake-time fragmentation cap now ships in `sleep-score.ts` — see the Current Status
entry above and [`docs/overview/history-2026-08-04.md`](docs/overview/history-2026-08-04.md).
This measured 32-night finding (the score's compressed dynamic range) is **still true and still
open** — the cap only fires on awake-time outliers specifically, it does not widen the range for
nights that are bad on other axes (autonomic, short duration). Q-72 itself is not closed.


### [devices][body] ⚠️ Q-56 fixed the step path only — the rest of the ring rollup keeps the unbounded clock (2026-08-04, v1.255.1)

**Fixed and verified in the diff:** `bucketStepInputsByDay` now converts a ring `ds` with
`resolveDsToMs` (nearest/interpolated anchor) and drops any frame resolving past
`now + INGEST_FUTURE_TOLERANCE_MS`. 10 new tests, one of which pins the original defect so the fix
cannot be mistaken for a test that never failed.

**Still open, and it is the larger surface:** `toDate` in `aggregateOuraRawSamples`
(`adapter.ts:4696`) is unchanged — bare `measuredAtMs` from the newest anchor — and it converts ring
time for **sleep session start/end, HR bins, temperature and its own `dayForDs`**. Those paths carry
the same unbounded skew the step path just lost. Not folded in because it would move sleep-session
boundaries across the whole rollup on the same day the owner's wake times were corrected by an
unrelated fix. Queued as **Q-71** with a required before/after measurement against production sleep
rows.

**Never reproduced end to end.** The mechanism is evidenced (production anchor rows, exact
arithmetic) and the code path demonstrably produces the observed dates, but replaying the 2026-07-30
incident needs a drain in flight and the sandbox has no ring. What is proven is that those dates can
no longer be persisted.

**Per-frame epochs are still not threaded** — `oura_raw_samples.epoch` exists but the step queries
don't select it, so every frame resolves against the current epoch. Unchanged from before, not a
regression.


### [platform] ⚠️ 44 MB of dormant Oura weights nobody was watching — and the "87 MB" figure was wrong (2026-08-04)

Measured while scoping Q-49 Phase B. The repository is ~101 MB of git history. Where it actually
goes:

| | size | loaded at runtime? |
|---|---|---|
| `lib/oura-models/weights/` (15 `.weights.npz`) | **44 MB** | **no — all 14 tracked files dormant** |
| `lib/oura-models/onnx/` | 27 MB | partly — 10.7 MB across the 8 required files |
| `lib/oura-models/constants/` | 12 MB | yes (provenance + real constants) |

**Two corrections to what the backlog said.** Q-49 A1's deletion step targets the 8 required `.onnx`
files — that is **10.7 MB, not the 87 MB** repeatedly quoted. And the largest thing in the repo by
far is the weights directory, which **A1 does not touch at all**.

**`scripts/check-oura-models-dormancy.js` was not looking at `.weights.npz`** — its asset filter
covered only `.onnx` and `.constants.json`, so the tool built to find dormant model assets had never
examined the biggest group of them. Fixed; the sweep now reports all 14 as dormant. Nothing loads
them: the runtime path is `.onnx` via `inference/`, and the only references to these filenames are
`"weights_npz"` provenance fields inside constants JSON.

**They are KEPT, not deleted** — re-extracting weights is impossible from this repo, so removal is
irreversible here and is the owner's decision, the same class as Q-50's finding 2. Explicit KEEP
entries now carry that reason, so they are visible and awaiting a decision rather than invisible.

**This is the real question for Q-49 Phase B**, not A1: 44 MB of extracted vendored Oura weights
would become public the moment history is pushed. **Decide before the push — once public, it is
public.**

### [platform] ⚠️ Q-49 A4b has shipped — Oura's material is out of the tree; Phase B (the cut) is what remains

The owner ran `GET /api/admin/model-assets` and it returned **`complete`**, which the backlog, the
admin card and `bucket-report.ts`'s own summary string all described as the gate for deleting the
87 MB of `.onnx` files from git and making the boot check fatal. **All three were wrong**, and
acting on them would have turned CI red.

`complete` proves the *production* half: the bucket really can serve every model. But **the
repo-tree copies are load-bearing for CI, not just a production fallback** — fourteen test files
read `lib/oura-models/onnx`, most via `fs.readFileSync` directly (bypassing `getSession` and its
bucket path entirely), and `inference/__tests__/sleepnet.test.ts` asserts `not.toBeNull()` with a
comment reading *"incl. CI"*. `.github/workflows/ci.yml` has **no bucket credentials at all**.

**Second, independent problem:** `instrumentation-node.ts`'s check verifies files **on disk**, so
flipping it to fatal while deleting the files would fail the boot immediately. It has to be
repointed at the bucket in the same change. And while the local fallback still exists a fatal check
has nothing real to catch — production cannot silently degrade with a working copy sitting there.

**The real gate is a CI model-delivery story nobody has scoped.** The owner has already approved the
availability trade, so the decision is not what is blocking this. Options and the recommended
fatal-on-`incomplete` / log-on-`unreachable` split are recorded on the Q-49 backlog entry.

**Update 2026-08-16 — Phase A is COMPLETE.** The CI story is solved on both halves: the model tests
replay from recorded fixtures, and the constants now fall back to synthetic fixtures (#1384), so the
suite passes with no vendor material and no credential in CI. Both bucket verdicts read `complete`.
The public repo `nekodas-neko/TrainingAi_Open` exists and is empty.

**Update 2026-08-16 — A4b SHIPPED.** All ten private paths are deleted, `.gitignore`d and covered by
`check-private-paths` (which now reports `total tracked: 0.0 MB`); both boot checks ask the bucket
and throw in production; `NOTICE` states that no third-party model weights are included. Guards on
17 test files, not the 16 the handoff measured — see the two rows below for what that count missed
and for what has still never executed.

**Update 2026-08-16 — the snapshot is PUSHED (step 8).** `nekodas-neko/TrainingAi_Open` holds one
commit, `6c072f9`, verified by cloning it fresh and running `check-private-paths.js` there:
`total tracked: 0.0 MB`. The pre-push audit found three real things, all fixed first — the owner's
email in two docs (#1393), a private-path manifest that catalogued what it was protecting (#1396),
and `main` red on E2E for ten hours of every day from a UTC-vs-Brisbane seed bug (#1397). Journal:
[`entries/2026-08-16-public-repo-snapshot-pushed.md`](docs/overview/history-2026-08-15.md).

**What remains is Phase B steps 9–14**, and all but one are the owner's:
[`docs/public-repo-cut-runbook.md`](docs/public-repo-cut-runbook.md). Branch protection on the new
repo cannot be set from a session (no MCP tool for it). Rollback stays available throughout — the old
repo remains a working Railway target until the final step, and that step archives rather than
deletes it.

**Update 2026-08-17 — `main` kept moving after the snapshot, and that is expected, not a problem.**
The pushed snapshot is `main` at `c9df8db`, frozen at that instant. Work on this (old) repo has
continued normally since — including the owner bug-batch session that produced Q-310 (a real
prescription/data-correctness bug, see the Known Issues entry above) and four other queued items.
This repo stays the canonical working copy until the final archive step, so that is correct: new
work belongs here, not in the empty snapshot. **Whoever runs the remaining Phase B steps should
either take a fresh snapshot at archive time (capturing everything landed since `c9df8db`) or
explicitly decide the gap is acceptable** — don't assume the two repos are in sync just because the
first push happened.

**Update 2026-08-15 (#1353):** the CI story is solved — the model tests replay from recorded
fixtures, so the suite passes with all ten `.onnx` files absent, and the constants resolve from the
repo copy in CI without any credential. The `constants` half now has the same bucket delivery the
models have had since A1, plus its own report. **What remains owed is the deletion itself** (A4b):
delete the tree copies, `.gitignore` them, and repoint both boot checks at the bucket in that one
change. Until then a fatal check still has nothing real to catch.

### [platform] ⚠️ The bucket download path for the model constants has never actually run (2026-08-15)

`ensureConstantsAvailable()` (#1353) prefers the repo copy, which still exists — so every execution
so far has taken the tree branch and returned before touching object storage. Session sandboxes hold
placeholder storage credentials that reject with `SignatureDoesNotMatch`, so the download cannot be
exercised here at all; only the pure report-building logic is covered by tests.

Its first real run is on Railway, in the deploy that deletes the tree copies. That is the correct
ordering — a mechanism added *after* a deletion is a mechanism nobody tested — and A4b flipped the
boot check to fatal in the same change, so a failed download fails the deploy instead of silently
serving a half-populated directory.

**Status 2026-08-16: A4b has merged, so that deploy is the one to watch.** A healthy boot logs
`[instrumentation] model constants: bucket — downloaded 34 file(s)` followed by
`[instrumentation] model assets: 8 file(s) in object storage`. Anything else and the process will
not come up; `GET /api/admin/model-assets` answers why, and reverting the deploy restores a tree
that still has the files. **Until those two lines are seen in a Railway deploy log, the download
path remains unexecuted** — merging is not the same as running it.

**Related, and already caught once:** the owner's console upload of the 34 constants landed 33,
dropping `stress_daytime_sensing_1_1_0.tables.json`. `GET /api/admin/model-assets` names the missing
file; re-check it reads `complete` before A4b deletes anything.


### [platform] ⚠️ A failed `REINDEX TABLE CONCURRENTLY` left 42 MB of invalid indexes in production (2026-08-04)

### [platform] ✅ DB index bloat cleared — 176 MB reclaimed, WAL restart still owed (2026-08-04)

Owner ran the corrected procedure. Measured after:

| | before | after |
|---|---|---|
| `oura_raw_samples` indexes | 316 MB | **140 MB** |
| `oura_raw_samples` total | 462 MB | **286 MB** |
| whole database | — | **363 MB** |
| invalid `_ccnew` indexes | 4 (42 MB) | **0** |

**Restart done** (`pg_postmaster_start_time` 02:03:58 UTC). Volume **~890 MB → ~680 MB of 1.00 GB**
— 68%, against the 92% that started this. `max_wal_size` deliberately left at 256 MB: at 68% there
is no case for trading checkpoint I/O for disk on a database already timing out on BLE ingest
batches.

**⚠️ The runway is ~5 weeks, and the trend is unchanged.** `oura_raw_samples` takes **~24,700
rows/day** at ~363 bytes/row with indexes ≈ **9 MB/day**, against ~320 MB headroom → **~35 days**
before this recurs. The reindex bought time; it did not fix anything. The structural fix is
**Q-30** (raw-sample retention / raw-drop-vs-bytea). Re-check in ~3 weeks.

### [devices][platform] ⚠️ Oura BLE ingest fails often — noisy, but verified NOT lossy (2026-08-04)

The device BLE service log carries repeated `ingest POST failed` across 48 hours: `timeout`,
`HTTP 500`, `HTTP 502`, `HTTP 403`, and one `Unable to resolve host`. Counters read
`ingestPosted 72,126` against `ingestStored 49,787`.

**Checked, and no data is being lost.** Server `oura_raw_samples` sits at `ring_timestamp_ds`
25,680,106 against the device cursor 25,680,154 — a **4.8-second** gap, i.e. current. The
posted/stored gap is dedup (`(user_id, ring_timestamp_ds, tag, body_hex)`), not loss: re-sends are
free by design and the cursor only advances past durably-ingested events, so a failed POST is
retried on the next drain. The log says so itself — *"data is safe locally, retries next drain"*.

**What is unexplained is the failure *rate*.** The 502s and the DNS failure are not the app, and the
500/timeout bursts line up with Railway deploy windows (several releases landed on 2026-08-04), so
container restarts explain much of it. That is a hypothesis, not a measurement. `/api/oura-ble/samples`
does call `reportServerError`, yet none of these reached `error_events` — which points at the failures
happening before the handler runs (edge/platform) rather than inside it. Worth a proper look if the
rate does not fall now that deploys have stopped.


### [readiness] ⚠️ Body Battery v5 — inputs corrected, but the model still has no validated target (2026-08-04, v1.253.0)

Q-57 shipped: HRmax for the reserve now comes from the highest corroborated daily peak over 90 days
(**168**) rather than `220 − age` (**190**); `CHARGE_RATE` halved 0.40 → 0.20; sparse days are
flagged rather than rendered as confident flat lines. Backtested over the real 41-day production HR
series: days pinned at the 100 ceiling **14 → 0**, end-of-day mean **71.9 → 49.9**.

**The open risk, stated plainly: these constants are not fitted to anything.** End-of-day battery
vs next-day readiness sits at **r = −0.06** over 18 pairs, so there is no outcome signal to tune
against. They were chosen for distributional plausibility — nothing pinned at either rail, centred
near 50. That is a defensible position for inputs that were wrong on their own terms, and it is
**not** evidence the number now means something. Re-check after ~2 weeks of v5 days
(`docs/body-battery-tuning.md`); if the correlation is still absent, the question is whether
end-of-day battery is the right predictor at all.

> **⚠️ AMENDED 2026-08-15 — that re-check is done, and the r = −0.06 above is not a v5 number.**
> Twelve v5 days have accrued. Split by `model_version`, **v5 alone gives r = +0.67 (n = 11)**
> against −0.12 pooled across v1/v2/v4/v5 — all four of which ran inside the same 40 days with no
> backfill, so any correlation over the full series mixes four models. **The deferred question is
> answered in v5's favour: tune, don't abandon** (**Q-272**), and the versioning gap that made the
> pooled number look authoritative is **Q-273**. Underpowered at n = 11 — re-run at ~30 v5 days.
> Separately, and not visible in the correlation: v5 **drains 5× faster than it charges** (10.5 vs
> 52.4/day) and **ends at its daily minimum on 10 of 12 days**. Evidence in
> [`docs/reviews/2026-08-15-comprehensive-app-review.md`](docs/reviews/2026-08-15-comprehensive-app-review.md) §1.4–1.6.

**Two secondary risks:**
- **The reserve now varies per user and per window.** A user with fewer than 14 recorded peak days
  falls back to the age estimate, so two v5 days are not comparable unless both resolved
  `hrMax.source === 'observed'`. The response carries `hrMax.source`/`peakDays` for exactly this.
- **Not verified on device.** The "Limited data" chip and its explanation were never rendered — the
  seeded local DB has no HR data, so that state is unreachable in the sandbox. Card rendering at
  the S25 viewport is unchecked.

The anchor ("start number") is untouched and still swings with readiness (29–87). Q-42 was the
structural half — **✅ shipped 2026-08-09**, see the Body Battery anchor row below.


### [workouts][cardio][devices][platform][body] Owner bug/feature batch, 2026-08-02/03 (Q-63…Q-69) — triaged and planned, NOT fixed

Seven items reported/requested by the owner across a single session, each traced to source and
queued with an implementation plan, none implemented. **Renumbered twice** (an original Q-52…Q-58,
briefly Q-57…Q-62, now Q-63…Q-69) — Q-52 collided with an unrelated "per-exercise phase hold" plan,
and Q-53…Q-56 collided with the separate cross-domain bug review below; both landed on `main` first:

- ~~**Q-63 `[workouts]`**~~ ✅ **SHIPPED v1.253.3, 2026-08-04.** Both skip buttons now route through
  the existing confirm; the guard moved to `components/workout/leave-guard.ts` so it is testable at
  all (this repo has no component-test setup). Deliberately still conditional on there being work to
  lose — a prompt dismissed by reflex guards nothing. Originally: the workout skip button advances to the next exercise with zero
  confirmation in a normal (non-solo) workout, discarding in-progress set/rest state on one tap.
- **Q-64 `[workouts][devices]`** — voice logging turns itself off instantly on the APK:
  `RECORD_AUDIO` isn't declared in the Android manifest at all, and even fixed, embedded Android
  WebView doesn't reliably implement real speech-to-text the way Chrome does.
- **Q-65 `[workouts]`** — Picture-in-Picture shows a static "DONE / tap Next" placeholder instead of
  the live rest-countdown ring on the exercise-summary screen (the active-mode PiP case already
  solves this correctly via `PipView`; the summary-mode branch never got the same treatment).
- ~~**Q-66 `[cardio]`**~~ ✅ **SHIPPED 2026-08-04.** Treadmill toggle on the walk config; GPS is
  never started in that mode, and the walk saves as `treadmill` with distance/route/pace null.
  Beyond the plan: treadmill walks are now **included** in the fast/slow segment-stats card, which
  filtered to `'walk'` and would have silently dropped them — the aggregate filters nulls per field,
  so they contribute real heart rate and nothing to pace. Originally: guided walk has no
  treadmill/no-GPS mode, so doing the interval walk indoors
  risks polluting pace/distance stats with GPS drift; the manual "Other activity" flow already
  solved this exact problem and guided walk never got it.
- **Q-67 `[platform]`** — the Renpho scale's persistent "Connected — listening for weigh-ins"
  notification runs continuously (foreground service is `START_STICKY` since 2026-08-01) and is
  unwanted noise distinct from the actual "Weigh-in logged" event.
- ~~**Q-68 `[cardio][devices]`**~~ ✅ **SHIPPED 2026-08-04.** The ring-confirm path now runs behind
  the same notify gate AD-1 already used, as a **GPS veto rather than a requirement** — no GPS fix
  still trusts the ring, which is the indoor case AD-2 exists for. Does not touch the AD-2 Hz-band
  calibration issue, which is separate and still owner-blocked. Originally: auto walk/run detection
  still false-positives on ordinary movement.
  Distinct from the already-tracked "AD-2 Hz bands provisional/uncalibrated" issue: the ring-confirm
  path (the one actually active whenever a ring is connected) skips the GPS distance/elapsed notify
  gate the sensor-fallback path already has.
- ~~**Q-69 `[body]`**~~ ✅ **SHIPPED v1.253.2, 2026-08-04** — see the Known-Issues entry above. The
  scale weight trend only ever took the day's *first* confirmed reading; a
  clothed first weigh-in permanently locks in a high trend value with no correction path. Decided
  (after rejecting both a same-day average and a manual override UI) to have the trend use the day's
  *lowest* confirmed reading instead.

Full root causes, decisions, and rejected alternatives (with rationale) in
[`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md).
Plans and branch names in `docs/implementation-backlog.md`. **Do not strike any of these seven
until each is actually implemented and verified** — this entry only records that they were scoped.

### [platform][body] 🔴 `body_metrics` could neither save locally nor pull — BOTH statements were short of columns (fixed v1.252.8, 2026-08-04)

Found in the owner's device console, not by any test. `applyDeltaBody` threw
`Run: 30 values for 32 columns` on every pull. Checking its sibling found the **local write broken
too**: 32 columns against 31 placeholders.

So on device, **every body-metric write failed in both directions** — weight, steps, calories,
macros, water, resting HR, HRV, SpO₂ and the whole scale body-composition set. The ten
body-composition columns added with the scale-BLE work were added to the column lists and the param
arrays but not to the `VALUES` lists.

**The blast radius was wider than "body metrics" — traced 2026-08-04, after the fix shipped.**
`applyDeltaBody` applies `delta.bodyMetrics` in its **first** loop, and `applyDelta` wraps the whole
thing in one transaction (`sqlite-backend.ts:1173`). So a delta page carrying even one body-metric
row threw on its opening statement and rolled back **all 26 domains in that page** — workouts, food,
sleep, programs, everything. With Oura BLE writing body metrics more or less continuously, that is
close to every page. **Incremental sync was dead on the device, not degraded.**

**Nothing was lost, though.** `setLastSyncAt(raw.syncedAt)` sits *inside* the same `try` as
`applyDelta` (`sync-engine.ts:539-545`), so a failed page never advanced the cursor — the server
still holds everything and it re-pulls from the same point. The device needs a restart to pick up
the fixed JS; no repair step, no full resync.

**This also closes out the `BeginTransactionAlready in transaction` error** from the same console
dump, which the fix PR could only call "probably a cascade". It is one: the `catch` at
`sqlite-backend.ts:1181` swallows a failing `rollbackTransaction()`, so the connection stays inside
the aborted transaction and the *next* `beginTransaction()` throws exactly that. Downstream of the
arity bug, not independent — but note the swallow is still there and would re-surface the same
confusing second error behind any future `applyDelta` failure.

TypeScript cannot see the original fault (template-string SQL, plain array params), lint cannot, and
**no test in this repo could have** — `getLocalStore` returns null off device, so nothing that goes
through the store executes these statements at all. It only ever appears as a runtime SQLite error
on the phone.

Guarded now by `lib/local-store/__tests__/insert-arity.test.ts`, which parses the backend source and
asserts column count equals value count for **all 33** INSERTs — confirmed to fail on the original
bug, naming the exact line. It also pins a floor on how many statements it finds, so a reformat that
breaks the parse fails loudly instead of passing vacuously.

**Still open, same console dump — two things this does NOT fix:**
- `/api/body-battery` and `/api/readiness-score` both returned **500** in production — see the
  Known Issue directly below; both now report, but the cause is still unproven.
- A `BeginTransactionAlready in transaction` error also appeared. Most likely a cascade from the
  above (a failed statement leaves the transaction open and the next `applyDelta` cannot begin), but
  that is reasoning, not evidence — re-check on device once the arity fix ships.

### [app-shell][platform] ⚠️ The APK's version was frozen at 1.30.0, so "Update available" was always on (fixed v1.252.7, 2026-08-03) — needs the next APK

`android/app/build.gradle` hardcoded `versionName "1.30.0"` while the app shipped 1.252.x. CI reads
`package.json` for the GitHub release *title*, but never stamped it into the build. `UpdateCheckCard`
(More) compares the installed APK's `versionName` against `/api/version`, so the comparison was
`1.30.0` vs `1.252.6` — permanently "behind". The card claimed an update was available forever,
**including immediately after installing the newest build**, and could never say "up to date".

Fixed by deriving both `versionName` and `versionCode` from `package.json` at Gradle configure time
(so a local build gets the same number as CI, not a CI-only patch). `versionCode` goes 3 →
1,252,006 via `major·1,000,000 + minor·1,000 + patch`; it only ever increases, so installs over the
old APK still work.

**Which surface was NOT exercised:** the Gradle build itself. The sandbox has no Android SDK and the
Gradle download is proxy-blocked, so the file is compile-checked only by CI's Android job — which is
**not a required check**, so it was watched explicitly rather than trusted to the merge gate. And
**the fix cannot take effect until the next APK is installed**, because it lives in the file that
builds the APK: the currently-installed build still reports 1.30.0. Expect the card to keep claiming
an update until then — that is the bug, not a new one.

### [sleep] ⚠️ Last night's own record is still wrong — the sensing-span fix only covers future rollups (2026-08-03, v1.252.8)

The `denseSensingSpan` fix (see Current Status above) stops this class of bug going forward, but it's
a pure function of already-decoded input — it doesn't retroactively rewrite the `sleep_sessions` row
for the 08-03/04 night itself, which still shows `sleep_start` = 00:59 instead of the real ~22:32.
`body_hex` for that night is untouched (archival, per the Oura BLE rules), so the row is recoverable
by re-running the rollup over it (Redecode / a targeted backfill) — that re-run just hasn't happened
yet. Any other historical night with a similar asymmetric mid-night interruption has the same stale
`sleep_start` until the same backfill runs. No backlog entry filed — flag here so it isn't
re-discovered as a fresh bug; do the backfill next time this file is touched for a sleep-domain
session, or on request.

### [cross] Cross-domain bug review 2026-08-03 — 5 findings, ALL QUEUED (fixes not yet shipped)

Review-only session (no code changes): 4 parallel review agents + a direct production DB audit via
the admin read-only endpoint. Full evidence in
[`docs/reviews/2026-08-03-cross-domain-bug-review.md`](docs/reviews/2026-08-03-cross-domain-bug-review.md);
each item queued in `docs/implementation-backlog.md` with its own plan doc. This row is struck
per-item as the fix PRs land.

- **[devices][body][sleep] Q-56 — real sensor data landed on dates up to 5 days in the future.**
  Five `body_metrics` rows + one `oura_daily` row, written in one batch on 2026-07-30, dated 1-5
  days ahead of that write. **Re-checked 2026-08-04: all five have self-healed and there are now
  zero future-dated rows** across `body_metrics`, `sleep_sessions`, `oura_daily`,
  `oura_daily_summary` and `activity_logs`, keyed on the user's local day. **That is the symptom
  expiring, not a fix — do not close it on that basis.** Root cause not proven, but a strong lead is
  now recorded on the backlog entry: the ring-time → wall-clock conversion (`measuredAtMs`) has **no
  future clamp at all** while the scale path does (`INGEST_FUTURE_TOLERANCE_MS`), and the step/day
  path resolves against the single newest clock anchor rather than the nearest-frame resolution
  migration 161 built for exactly this — with production anchors observed re-stamping ~39 minutes of
  ring time in 11 real seconds mid-drain. Plan:
  `docs/superpowers/plans/2026-08-03-future-dated-ble-ingest-rows.md`.
- ~~**[workouts] Q-53 — prescription cache staleness after a mutation.**~~ ✅ **SHIPPED 2026-08-03
  (v1.252.6).** Finding (a) turned out to be worse than filed and the fix is a **deletion**: the
  bare `fetch` in `onPhaseChanged` duplicated the `refreshExercises()` call on the next line, minus
  the `no-store`, the cache write-back, the 404 recovery *and* the request-id guard — so it could
  resolve last and overwrite fresh state with a 60s-stale response. Finding (b) added the missing
  `invalidatePrescriptionChanged` to the `aiPrescriptionPending` trigger. Finding (c) was
  investigated and is **unreachable** — after (a), every remaining reader of that endpoint either
  passes `no-store` or goes through the invalidated cache key — so no code was written for it. See
  [`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).
  **Not reproduced end to end:** the staleness needs a real transition plus a second read inside a
  60-second window, which is not drivable from the sandbox.
- **[workouts] Q-54 — prescription-generation write race under concurrent triggers.** Two
  generation calls for the same session (duration-preset picker vs. standard auto-fire) use
  different dedup keys and can interleave three sequential writes to `session_periodization`,
  leaving `prescriptionStatus` mismatched against the stored content. Source-read finding, not yet
  reproduced — reproduction is Task 1 of the plan:
  `docs/superpowers/plans/2026-08-03-prescription-generation-race.md`.
- ~~**[workouts] Q-55 — bodyweight `target80` rendered as "X kg" in the workout-preview sheet.**~~
  ✅ **SHIPPED 2026-08-03 (v1.252.5)** — `overview-screen.tsx:484` now carries the same
  `exerciseType` guard as the block 70 lines above it. The sibling sweep was re-run and found
  nothing else: every other `target80` render is already guarded, two of them by an earlier
  short-circuit in the same ternary chain rather than an explicit check. See
  [`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md)
  — which also records a **new, smaller finding** the fix surfaced: `target80` for a bodyweight
  exercise is 0.8 × a BW_REF(100)-relative index, so it falls *below* BW_REF and inverts to
  "1 reps". Both blocks now agree and neither fabricates a weight, but "1 reps" is a weak reading
  and the right bodyweight target is a product question nobody has answered.
- Also verified clean (no findings): sync-push mirroring (`pushMutations` vs API routes) across
  every write-capable route touched in the last 40 commits; ownership checks on the two most
  recently added mutating routes; nutrition production data integrity (zero orphans, no bad values);
  sleep production data integrity beyond one n=1 edge case noted for awareness only (a 45-minute nap
  stored with all sleep-stage fields zeroed — not filed as a bug).

### [platform] ⚠️ Model-asset bucket report (Q-49 A1 gate, v1.252.3, 2026-08-03) — two of its three verdicts have never run against a real bucket

`GET /api/admin/model-assets` + the **Model asset delivery** card (Admin → Tools → Additional tools)
replace the old "read the deploy logs for eight `[oura-models]` lines" gate, which could not work:
the model loaders are lazy, so those lines only appear once a sleep rollup runs, and their absence is
indistinguishable between "bucket empty" and "nothing asked yet".

**Which surfaces were NOT exercised:** (a) the `complete` and `incomplete` verdicts — the sandbox's
bucket credentials are rejected, so only `unreachable` can be reached here (it *was* reached, live:
`SignatureDoesNotMatch (403)` with an empty missing-list, which is the behaviour the design exists
for). Their logic is unit-tested; the S3 round trip is not. (b) **The card's rendering** — it sits
behind two client-side toggles so it is absent from the server-rendered HTML, and this repo has no
React render-test setup (`vitest` runs in `node`, no `@testing-library`). Both on the owner
checklist. Ships through Railway — no APK needed.

### [activity] ⚠️ Home streak now merges unsynced workouts (Q-41, v1.252.2, 2026-08-03) — the sandbox cannot produce a single overlay row

Home's week strip and streak now merge outbox-pending workouts on top of the server payload at read
time (`mergeCalendarOverlay` + a separate `pendingDays` state), so a **second** workout on a day that
already holds a synced one is no longer masked. A workout on a fresh day already showed — the
backlog entry's stated cause was wrong and is corrected in
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).

**Which surface was NOT exercised:** the overlay itself, on any path. `getLocalStore` returns null in
the web sandbox, so `pendingDays` is provably always `{}` there and the merge is a no-op — the dev
server can only demonstrate that the server-only rendering is unchanged (it is, and a test asserts
the merged result is `toEqual` the server payload for an empty overlay). Logging offline and seeing
the streak move before sync needs the APK. On the owner device checklist. Ships through Railway —
no new APK needed to *get* the change, only to verify it.

### [workouts] ⚠️ Auto-applied phase transition (v1.252.0, 2026-08-03) — device-unverified, and one branch not exercised

Auto-apply now calls `advancePhase` for a model-earned transition (fix for four session types stuck
in accumulation since June). Verified end-to-end on the local dev server: `accumulation →
intensification`, status `auto_applied`, phase moved in the DB. **Not verified:** the new rationale
banner and the amended card header on the S25 (Samsung WebView, safe-area). This is a JS/server
change, so it reaches the device through the Railway deploy — **no APK needed**, just a look at the
pre-workout screen.
**Not exercised end-to-end:** the ceiling-forced branch, because the model cannot be made to answer
"stay" on demand while a session cap is tripped; it is covered by `canAutoApplyTransition`'s unit
tests and by reasoning (a forced transition carries the previous phase's clamped loads, so applying
it would advance into a zone too light).

### [workouts] "Lower" has no primary exercise — the load anchor is a secondary (found 2026-08-03)

The active program's Lower session holds 3 secondaries and 2 accessories, no primary.
`capLoadToAnchor` (`role-plausibility.ts:53`) resolves the anchor from roles and caps every
non-anchor exercise at the anchor's pct, so with no primary the absolute role-ordering rule is
degraded on that day — a secondary is acting as the anchor. Every other session (Legs, Pull, Push,
Upper) has exactly 1 primary. Likely a program-config slip rather than an engine bug, but it should
either be corrected in the program or `capLoadToAnchor` should state what it does with no primary.

### [workouts] ✅ Estimated 1RM growth is implausible on several lifts (found 2026-08-03) — MEASURED 2026-08-03, not an estimator fault

Over seven weeks: bent-over row +45.8%, incline bench +38.7%, barbell shrug +37.6%, calf raise
+38.5%. These are not physiological gains — most likely loads ramping from a start well below true
capacity (consistent with the open "starting weights never reach the bar" issue) and/or estimator
drift. It matters because `rm1Trend` gates phase-transition eligibility and autoregulation, so every
prescription rides on these numbers.

**Resolved by measurement — it is the first hypothesis, and there is no estimator drift.** Every one
of the four was traced through production set-by-set. Each starts with a light, very-high-rep
session and progresses to a heavier, lower-rep one; the weight actually on the bar grew *more* than
the 1RM estimate did, in all four cases:

| Lift | first session | last session | bar weight | 1RM estimate |
|---|---|---|---|---|
| Bent-Over Barbell Row | 25 kg × 15 | 60 kg × 9 | **+140%** | +121% (37.5 → 82.8) |
| Incline Bench Press | 30 kg × 20 | 62.5 kg × 7 | **+108%** | +39% (56.8 → 78.8) |
| Barbell Shrug | 50 kg × 15 | 77.5 kg × 10 | **+55%** | +38% (78.5 → 108.0) |
| Barbell Calf Raise | 50 kg × 20 | 92.5 kg × 10 | **+85%** | +39% (94.8 → 131.3) |

So the estimator is **damping** the raw load increase, not inflating it — the opposite of drift. It
is also well-guarded: `repFactor` averages Epley and Brzycki, freezes the Brzycki term past 20 reps
(it blows up toward rep 36), and `REP_CEILING = 30` rejects anything beyond.

Two things follow. **(a) `rm1Trend` is reporting correctly** — those lifts genuinely went up, so the
phase-transition gate and autoregulation are reading real progression, and nothing needs changing
there. **(b) The audit's percentages are inflated by their own baseline.** Each is measured from a
15–20-rep opening set, which is where a rep-max formula is least trustworthy *and* where the lifter
was furthest below capacity. That makes the number a measurement artifact of the starting point, not
a property of the estimator.

**What stays open is the separate, already-known issue** the finding pointed at: *starting weights
never reach the bar*. This measurement corroborates it with four independent cases — a first session
at 25 kg × 15 for a lift that reaches 60 kg × 9 seven weeks later is a start far below capacity. No
new entry filed; it belongs to that issue.

~~Separately, bodyweight movements carry meaningless absolute values (Hanging Leg Raise "128 kg",
Pull-Up "118 kg") which makes their trend unreadable — worth excluding bodyweight lifts from any
stall/trend judgement.~~ **Investigated and partly wrong — corrected 2026-08-03 (v1.252.4).** A
bodyweight `estimated_1rm` is a `BW_REF`(100)-relative index, so its *trend* is readable (monotone in
reps) and must stay in stall/trend judgement; only the absolute number is meaningless, and only where
a surface prints "kg" after it. A sweep of every 1RM render found two that did: the Year in Review
(which also *selected* the wrong PR — a plain `max` over two incomparable units ranked a pull-up
above a 96 kg bench press) and the deload sheet's kg target. Both fixed; `live-1rm-readout.tsx` looks
like the same bug but is unreachable for bodyweight, and the digests were already correct. See
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).
**The weighted-lift half above is untouched and still open.**

### [activity] ⚠️ Activity HR for GPS runs/walks (Q-41 finding 2, v1.250.4, 2026-08-02) — not run against a real GPS activity

Runs and walks now save `avgHr`/`maxHr` on the activity row instead of leaving them null; the values
come from the `/api/oura/hr-window` response the screen already fetches for its route-map colouring
and was discarding.

**Which surface was NOT exercised:** a real GPS activity end to end. That needs the whole
activity-tracking flow — location permission and a moving device — which does not exist in the
sandbox. Proven: the endpoint returns `avgHr`/`maxHr`, the effect that fetches them runs for every
activity type, and the save reads them synchronously (so the save stays instant). Unproven: that a
real run or walk finishes with non-null HR on the row. On the owner device checklist.

**Related, measured not fixed:** `cadence_spm` is null on **all 42** production activity rows while
3 carry a `cadence_series` — so Q-41's finding 4 (does the 60 spm floor reject slow walks?) was
unanswerable, and the real question is why the scalar is never written. Re-filed as **Q-47**.

### [devices][heart-rate] ⚠️ Chest-strap link status (Q-40, v1.250.3, 2026-08-02) — Kotlin half needs an APK, labels unproven on a real strap

Q-40 shipped: the pairing card's label now comes from the native service's own state rather than two
booleans (`lib/live-hr/strap-link-label.ts`, 7 tests), a **Connect** button recovers a link the
service gave up on without restarting the app, and `PolarStrapService` emits a final `stopped`
status in both teardown paths instead of dying silently.

**Which surfaces were NOT exercised:**

- **The Kotlin change did not compile locally** — the sandbox has no Android SDK (`npx cap sync
  android` succeeds; `./gradlew compileDebugKotlin` fails with "SDK location not found"). CI's
  Android job is the compile gate and it passed, but that is a build, not a run.
- **It needs a new APK to reach the device.** The JS half (label + Connect button) ships through
  Railway; the give-up-announces-itself behaviour does not.
- **No connected / retrying / stopped label has run against a real strap.** Those states are
  device-only by construction; only the unpaired web state was rendered.

Both device checks are on the checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).
Do not strike this row on intent.

### [devices][platform] `oura_raw_samples` is 452 MB and ~130 MB of that is index bloat (measured 2026-08-02)

Not a regression — a measurement, taken while re-verifying Q-35 before implementing it. Production:
740,966 rows, 146 MB heap, **306 MB of indexes**. `n_tup_upd` is 1,324,792 with `n_tup_hot_upd` of
**19**, so almost every update rewrites an entry in all four indexes.

The cause was `redecodeOuraRawSamples` re-stamping the **indexed** `measured_at` column over every
row in a page with no `IS DISTINCT FROM` guard — an update that writes back the value already there
still cannot be HOT. ✅ **Fixed in #1003 (v1.250.6)**, with a DB-backed test asserting a second pass
writes zero rows (checked against the un-fixed code, where it writes 40). **The existing ~130 MB is
still there** — that needs the one-time `REINDEX TABLE CONCURRENTLY` on the owner's console
checklist. Doing the REINDEX without this guard would simply have refilled it.

**Q-35 was retired rather than built** as a result: its Finding 1 was already done by Lever 1 (0 of
740,966 rows carry `decoded`) and its Finding 4 — a sha256 generated column for the dedup index —
would have made the table *bigger* (sha256 is 32 bytes; `body_hex` averages 24 characters). Full
numbers in
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).

### [platform][devices][readiness] ⚠️ Health Connect tier (Q-43, v1.250.0, 2026-08-02) — never run against a real provider

Q-43 shipped: readiness degrades to the generic tables when there is no ring rollup, the derived
score is persisted so the trend surfaces fill in, `saveSleepSession` writes through the per-field
rank merge with a required `source`, and a Health Connect hypnogram is carried through to
`sleep_phase_5_min`.

**Which surface was NOT exercised:** the Health Connect ingest path itself. The owner has Health
Connect switched off and there is no second device in the sandbox, so nothing here ran against a
real provider. Specifically unproven:

- the Capacitor plugin read path (`lib/health-connect-sync.ts` — browser-only code, `pnpm dev`
  early-returns before it),
- the actual stage strings a real provider emits. The five we map were read out of the pinned
  plugin source (`RecordConverter.kt:390-400`), not from memory, but nothing has confirmed which
  ones Samsung Health / Google Fit actually populate,
- whether any real provider stages a whole night cleanly enough to clear the hypnogram's
  full-coverage requirement. If none do, the fallback is the four stage totals we already had —
  a no-op, not a regression.

Everything else is proven: the DB rank-merge orderings, the route degradation boundaries, the
rasteriser, and a `/api/sync-health` POST landing a row with `source_map` stamped `health_connect`.
Do not strike this row on intent — the device check is on the owner checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).

**Adjacent finding (Q-45) — ✅ FIXED 2026-08-02 in #1007, v1.250.9.** On the Readiness breakdown a
*provisional* contributor rendered a weight-derived bar value that read exactly like a score —
"Resting heart rate 88" when there was no resting-HR data at all. Provisional factors now show their
weight as `15%` in muted text, fill the bar to that same weight, and sort last instead of
interleaving at their neutral `50` placeholder. See
[`docs/overview/history-2026-07-30.md`](docs/overview/history-2026-07-30.md).

### [activity][platform][workouts][readiness][devices] Owner bug batch reported 2026-08-02 — all 5 shipped, device checks outstanding

Five live production bugs reported by the owner on 2026-08-02. All five were traced to source in
the investigation session and **all five have now shipped** (#987, #988, #995, #996, #997) —
the plan is
[`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
with follow-ups Q-41/Q-42 still queued. What remains is **device verification** — see the checklist
in [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md).

1. ✅ **[activity] A guided walk can never sync, and so never reaches the training calendar (Q-36).**
   Fixed in **#987** (v1.249.5). ⚠️ The owner's stranded walk needs a manual **Retry** tap on the
   sync-health card — a dead-lettered row is never re-attempted on its own.
   `computeWalkSegmentStats` rounds segment mean HR to 1dp (`lib/walk/segment-stats.ts:23`) but
   `WalkSegmentStatSchema.avgHr` is `z.number().int()`
   (`packages/shared/src/validation/activity-log.ts:17`), so one fractional mean rejects the
   **entire** `activity_logs` payload on both write paths → dead-letter after 5 attempts.
   **Reproduced** with a Vitest run against the real schema. The walk still renders in the
   local-first Health list while being absent from Postgres — and `getCalendarData` reads
   `activity_logs` from Postgres, which is why the calendar showed nothing. The owner's device is
   holding one such stranded mutation (Activity — 2026-08-01); the fix has shipped, so the Retry tap
   noted above is all that remains.
2. ✅ **[platform] The local SQLite store fails its version upgrade on every launch (Q-37).**
   Fixed in **#988** (v1.249.6). ⚠️ NOT yet verified on device — see the dedicated Known-Issues row
   below. Three
   faults, each independently able to produce the "Sync failed — will retry automatically" toast:
   the v13 `ALTER TABLE mutations_outbox ADD COLUMN attempts` fails with "duplicate column name"
   every launch because the fallback reopen never stamps the version forward; `PRAGMA
   journal_mode=WAL` is sent through `execute()`, which cannot return rows, so **WAL has never
   actually been enabled** on this device; and a leaked connection registration is misdiagnosed as
   an upgrade fault. Separately, `applyDelta` sits outside `pullPage`'s try block, so a device-side
   schema fault surfaces as the same generic toast as a network failure.
3. ✅ **[workouts] Accepting a phase transition empties the prescription card permanently (Q-38).**
   Fixed in **#995** (v1.250.1). The transition now leaves the slot in the `'consumed'` state
   `isAiPrescriptionPending` keys on, which lights up the "Preparing your AI workout…" placeholder,
   the bounded poll and the regeneration triggers; the unreliable server self-fetch is replaced by
   a client-fired one. Verified end to end at the S25 viewport on the dev server.
4. ✅ **[readiness] The Body Battery anchor flips between readiness and sleep mid-day (Q-39).**
   Fixed in **#996** (v1.250.2). The decision moved into `app/api/body-battery/anchor.ts` and a
   readiness-derived anchor is now frozen for the rest of the day; a sleep anchor is labelled
   provisional and upgrades exactly once. Reproduced on the dev DB (82 → 54 → held at 54) and the
   provisional copy checked at 360px in both themes.
5. ✅ **[devices] The chest-strap card reads "Connecting…" forever (Q-40).** Fixed in **#997**
   (v1.250.3) — the label now comes from the service's own state (`lib/live-hr/strap-link-label.ts`,
   7 tests), a **Connect** button recovers a given-up link without an app restart, and the native
   service announces `stopped` before it dies. ⚠️ **The Kotlin half needs a new APK and none of the
   connected/retrying/stopped labels have run against a real strap** — see the Known-Issues row
   below. Previously: the label was derived
   from two booleans and `active` is true from app start (ambient mode runs all day), so every
   non-`ready` native state collapses into "Connecting…". The native service also calls `stopSelf()`
   after exhausting its backoff ladder **without emitting a final status**, so the WebView holds its
   last-seen state indefinitely.

### [cardio] Run-type carousel + zone-gap recommendation (v1.246.0, 2026-07-30)

Follow-up to the v1.245.0 entry below, same session: the flat pill-row run-type picker became a
real swipeable carousel, mirroring `app/workout-select/workout-select-content.tsx`'s session
carousel shape (one card at a time via the existing `SwipeCarousel` primitive, dot indicators, a
"Recommended" badge whose dot stays visually distinct even off-screen). The recommendation itself
is new: `lib/running/recommend-run-type.ts` deterministically scores each run type by how much of
the week's biggest **open** HR-zone gap it would close (using the same `ZoneQuota` the
Cardiovascular hub shows — no LLM number gates this), so picking Interval when Z4/5 minutes are
still owed is a computed suggestion, not a guess. Z1 never drives it (spec D-10 — passive fill).
Returns no recommendation once every training zone is already complete/not-required.

⚠️ **A second real bug found by testing this, on top of the v1.245.0 GET-recompute fix:** even
with that fix in place, reloading shortly after an override could *still* show the stale
pre-override prescription — this time because `GET /api/running-plan`'s `Cache-Control:
private, max-age=60, stale-while-revalidate=120` let the **browser's own HTTP cache** (not the
app's `cachedFetchToday`/`invalidateRunningPlan()` layer, which was already invalidating
correctly) serve a stale response for up to 60s, invisible to and uninvalidated by the app's own
cache-group system. `lib/sqlite/cache.ts`'s `cachedFetchCore` calls plain `fetch(url)` with no
`cache` override, so it fully honours that header. Fixed: `GET /api/running-plan` now sends
`Cache-Control: private, no-store` — the app's own TTL+invalidation layer already provides real,
correctly-invalidated caching, so the HTTP-cache layer was redundant and actively wrong once
multiple state changes within seconds became routine (the carousel). **Worth a sweep**: any other
route with a `max-age` Cache-Control whose data can change multiple times within that window via
rapid user action (not just occasional writes) is a candidate for the same bug — not audited
this session, flagged for a future pass.

Verified with a `page.waitForResponse`-driven Playwright script (deterministic, not
timeout-based) — pick a type → confirm the override response and rendered card agree → adjust
duration → confirm again → reload and wait specifically for that GET → confirm it still shows the
override instead of reverting. Not device-verified (same caveat as the rest of this domain;
nothing here touches native code).

### [cardio] Skip → choose your run; default session time in plan setup (v1.245.0, 2026-07-30)

Follow-up to the v1.244.0 entry below, same session. The owner wanted skip to offer a real
alternative rather than just leaving, and the session-time picker moved into plan setup:

- **`RunTypePicker`** (new, above the prescribed-run card on `/running`): a ±10 min duration
  stepper + a Recovery/Easy/Long/Tempo/Interval chip row. Selecting either POSTs to the new
  `/api/running-plan/override`, which re-prescribes today's run via `prescribeOverride()`
  (`lib/running/prescription.ts`) — the **same recovery-gate pipeline** as the framework's own
  pick, so a manual choice still can't bypass the interference/readiness/monotony/sleep safety
  checks. "Skip" is unchanged and still available as the no-thanks fallback.
- **`PlanSetupSheet`'s default session length** is no longer gated behind choosing "Fixed time" —
  every new plan now saves `timePerSessionMinutes`, seeding the stepper above.
- **The hub's "How much time do you have?" button is hidden once a running plan exists**
  (`ModalityPicker`, gated on `!hasRunningPlan`) — with a plan, the default time + the new
  per-session adjuster on `/running` cover the same job.

⚠️ **Two real bugs found by testing this feature, both fixed in the same PR:**
1. `GET /api/running-plan` always recomputed the prescription fresh from the framework, so
   reloading right after an override silently reverted the display to the AI's original pick.
   Fixed: GET now checks whether today's persisted row carries the override marker
   (`OVERRIDE_RATIONALE_PREFIX`) and, if so, builds the response from the persisted row instead
   of recomputing. **Caveat:** `gateReasons` (never persisted) come back empty on an overridden
   day — `gateAction` still reflects the gate's outcome, but the explanatory sentences are lost
   until the row resets (next day, or the run completes).
2. A slow initial-load GET could resolve *after* a faster override POST and clobber it back to
   stale data — fixed with a monotonic request-sequence ref (`requestSeqRef` in
   `running-plan-content.tsx`) so only the most-recently-fired request's response is ever applied.

Verified via curl (override → repeated GET, confirms the choice sticks) and a full Playwright
pass against the local dev DB (create plan → pick a type → adjust duration → reload → still
shows the override → skip → "Back to Cardio" still works → hub button confirmed hidden). Not
device-verified — same caveat as everything else in this domain; nothing here touches
native/Capacitor code, so risk is low, but the on-device APK path is unexercised.

### [cardio] Running-screen polish: bests card, daily zone view, skip fix, run leave-guard (v1.244.0, 2026-07-30)

Four small, independently-verified gaps found against the already-shipped cardio redesign (the full
system was designed and phased in `docs/superpowers/specs/2026-07-26-cardio-system-spec.md`, closed
with no open decisions, and Phases 1–6 mostly landed 2026-07-26→30 — this was a gap sweep against
that work, not a new design pass):

- **`/running` now shows an all-time bests card** (best 1K, best 5K, best avg pace, longest run) —
  `GET /api/running-bests`, `computeRunningBests()` in `lib/health/cardio-trends.ts`. Reuses
  `activity_logs.bestEfforts`/`avgPaceSecPerKm`, already computed per-run and previously unrendered
  anywhere. Dev-DB-verified with a seeded run row + Playwright screenshot.
- **The Cardiovascular hub's zone quota now has a Today/This week toggle** — `ZoneQuotaCard` took a
  `dayQuota`/`weekQuota` pair instead of one `quota`; `/api/cardio-week` divides the weekly framework
  target by 7 for the daily row. Steps already had this split; zone minutes didn't (Finding 2 in the
  2026-07-26 redesign brief). Dev-verified both toggle states render correct numbers.
- **Skipping today's run was a dead end** — `RunningPlanContent`'s skipped/completed state had no
  navigation; added a "Back to Cardio" button. Verified end-to-end (skip → button → lands on
  `/cardio`) via Playwright.
- **The run/activity screen had no leave-confirmation guard** — guided walk and workouts already
  confirm before a hardware-back or bottom-nav tab-away mid-session; `/activity` (run, treadmill, any
  GPS/manual activity) had none, so navigating away silently discarded an in-progress recording.
  Added `isActivityActive()` (`lib/stores/activity-store.ts`) + `LeaveActivityDialog`, wired into
  `mobile-auth-handler.tsx`'s backButton listener and `bottom-nav.tsx`'s tab-click guard, mirroring
  the existing `isGuidedWalkActive`/`LeaveWalkDialog` pattern exactly.

⚠️ **The leave-guard is NOT verified on device** — same caveat as every other hardware-back-button
guard in this codebase (`docs/domains/cardio/README.md`); the sandbox cannot generate Samsung's real
back gesture. `TabSwipeNavigator` (edge-swipe) still does not guard walk OR the new activity case —
pre-existing gap, not newly introduced, left as-is to avoid scope creep on an unrelated file.

**Deliberately not built this pass:** D-14's optional "beat-your-last" walk distance goal (closed
decision, but never actually wired into `walk-config.tsx`/`walk-active.tsx` — grepped, no match) —
flagged, not implemented, since it wasn't explicitly requested. The "How much time do you have?"
button's placement on the hub (vs. woven into the Run/Walk/Activity cards) is unresolved — it's
already where the closed spec (D-9) puts it, but the owner's original complaint about its position
was never fully disambiguated.

### [cardio] Guided walk Android status-bar pill (v1.243.1, 2026-07-29) — NOT verified on device · needs: android
`walk-active.tsx` now calls the existing `AndroidRunChip` native bridge (`lib/native/run-status-chip.ts`)
on every guided-walk phase change. No Kotlin was touched — this reuses the bridge already shipped for
the running screen's duration chip. Verified via dev-server Playwright: started a walk with mocked
geolocation, the active-walk screen rendered correctly with no new console/page errors — the bridge is
undefined in the web sandbox so the calls silently no-op, exactly as designed. **Not verified:** the
actual native chip on-device — real promoted-notification rendering in the Android 16 One UI Now Bar,
the phase-to-phase re-anchor, tap-to-reopen, and the countdown→overtime flip. Compile-gated only in
this sandbox (no Android SDK, no APK rebuild available this session).

### [readiness] Nightly temperature now uses 0x75 alone — a defensible measurement, not the ring's behaviour (v1.243.0, 2026-07-30)

Q-2 shipped: the rollup no longer flattens a frame's simultaneous probes into consecutive "samples"
(631 frames had become 2,398 samples on 631 timestamps), and no longer mixes `0x46`/`0x69`, whose
middle value sits on a 0.5 °C grid in 98.3% of 30k rows — the reason 19 of 21 nights read as exact
whole degrees and `tempZ` / readiness's `bodyTemperature` had no discriminative power.

⚠️ **Which decoded stream the ring itself consumes is still unknown.** `nightly_temperature_calculate
@ 0x203520` is an address in the Oura app binary and is not covered by `open_oura`, so the choice of
`0x75` rests on the empirical comparison in the plan (the only variant tested that yields a
non-quantised result), not on protocol. Treat the nightly value as our measurement, not as a
reproduction of Oura's.

⚠️ **The prod comparison could not be re-run in-sandbox** — no reachable prod data, and the local seed
has no `oura_raw_samples`. The first real re-aggregation is the check: nightly values should stop
landing on exact whole degrees. If they don't, the median convention is the first thing to look at.

Note the plan's "needs a redecode pass" is **retracted** — `0x75` already decodes to `temps_c` and is
already in `ROLLUP_TAGS`, so past nights recompute on the next `aggregateOuraRawSamples` run with no
owner-run step.

> **Every heading below is tagged with its domain(s)**, primary first, using the eleven pillar slugs
> from [`docs/domains/README.md`](docs/domains/README.md). To pull just one pillar's issues:
> `grep -n '^### .*\[sleep\]' projectOverview.md`. Counts today — devices 45 · workouts 39 ·
> cardio 36 · platform 30 · app-shell 18 · sleep 14 · activity 14 · heart-rate 12 · readiness 9 ·
> nutrition 6 · body 2 · cross 3. **A new entry must carry its tag(s)** — an untagged heading is
> invisible to every per-pillar sweep. Each pillar's index
> (`docs/domains/<pillar>/README.md`) links back here with that grep.

### [app-shell] Edge-swipe tab navigation stays live on the four health detail screens (2026-07-29)

`activeTabIndex()` (`components/shell/tabs.ts:29`) maps **any** `/health/*` path to the Health tab,
so on `/health/{readiness,heart-rate,sleep,activity}` the bottom nav highlights Health and
`TabSwipeNavigator` treats an edge swipe as a tab flip: a left-edge swipe fires
`navigate(-1)` → Home, a right-edge swipe fires `navigate(1)` → `/workout`. On Samsung gesture
navigation the back gesture *is* an edge swipe, so on these screens the back gesture can be consumed
as a tab change rather than a history pop — two different handlers racing on one gesture.

Found while fixing the dead back button (v1.241.2); **not fixed there** because it is a shell-layer
behaviour, separate from the tap-target bug that was reported, and the correct treatment (should a
non-tab detail screen under a tab prefix disable tab-swipe? does `activeTabIndex` need a
"detail screen" concept?) needs a decision rather than a patch.

**Not reproduced on device** — the sandbox cannot generate Samsung's system back gesture; this is
read off the code path, not observed. It is the leading candidate for the owner's report that back
from a home circle "takes you to home sometimes or health", which the v1.241.2 fixes may or may not
have fully resolved.

### [platform] `/mobile-signin` is behind the auth gate, which likely breaks first-run APK sign-in (2026-07-29)

`components/google-sign-in.tsx:29` opens `https://…/mobile-signin?challenge=<sha256>` in a system
browser to start the Capacitor OAuth flow. But `/mobile-signin` is **not** in `middleware.ts`'s
`PUBLIC_PATHS` — `"/mobile-signin".startsWith("/sign-in")` is `false` — so it is guarded like any
other route.

**Measured** against `pnpm dev`: unauthenticated `GET /mobile-signin?challenge=abc` → `307
/sign-in`, and the `challenge` param is dropped. That is the exact state of a fresh install, where
the system browser holds no Railway session. Without the challenge there is no PKCE binding, so
`/auth-mobile-bridge` is never reached and the `trainingai://` deep link that hands the APK its
session never fires. The flow would only work when the system browser *already* has a valid session
for the Railway origin.

**Not confirmed on device** — the sandbox can't run the APK, and it is possible something about the
real flow (a browser that already carries a session from a previous sign-in) has masked this. That is
also why it may have gone unnoticed: it breaks *first* sign-in, not subsequent ones.

**✅ FIXED 2026-07-30 (v1.242.3)** — `/mobile-signin` added to `PUBLIC_PATHS`. It grants no authority
`/sign-in` doesn't already grant: the page's only action is `signIn("google")` (re-read to confirm
before applying). A/B measured against `pnpm dev`: unauthenticated
`GET /mobile-signin?challenge=abc123` returned `307 → /sign-in` with the param dropped before the
change and `200` after, while a control route (`/health`) still `307`s — so the gate itself is intact.

⚠️ **Still not confirmed on a real first-run install**, which is the only way to prove the whole PKCE
chain end-to-end: a fresh APK install whose system browser carries no Railway session, through Google,
to the `trainingai://` deep link handing the app its session. The middleware half is verified; the
chain beyond it is not.

### [platform] ⚠️ Local SQLite open-path recovery (Q-37) is NOT verified on device (2026-08-02) · needs: android

**Was:** three faults compounding on every launch of the owner's S25, visible in the device console.
(a) `PRAGMA journal_mode=WAL` went through `execute()`, which cannot return rows — the pragma
*returns* one, so the call always threw and **WAL has never been enabled on this device**.
(b) The v13 `ALTER TABLE mutations_outbox ADD COLUMN attempts` failed with "duplicate column name"
on every launch; the fallback reopened at version 1 but never stamped the version forward, so the
poisoned upgrade was retried forever. (c) A leaked connection registration
("Connection trainingai already exists") was misdiagnosed as an upgrade fault and pushed down the
version-1 fallback path. Separately, `applyDelta` sat outside `pullPage`'s try, so a device-side
schema fault surfaced as the same generic "Sync failed" toast as a network failure — and so did a
plain backoff window, which is not a failure at all.

**Now:** WAL is set through `query()` and the resulting mode is checked; a stale registration is
closed before opening; `reconcileSchema()` reports whether it fully succeeded and the schema version
is stamped forward **only** after a clean reconcile (stamping a partial one would retire the repair
path with work outstanding); `applyDelta` failures are caught, logged, and reported as a failed page
so the caller's existing backoff applies; and a backoff window gets its own toast copy.

⚠️ **NOT VERIFIED ON DEVICE — this is the gate this row exists to record.** `getLocalStore` returns
`null` in the web sandbox and `initSQLite` early-returns when the Capacitor plugin is absent, so
**none of this code executes under `pnpm dev`** — the dev-server run only confirmed the app still
compiles and `/session-select` renders. This is the file that has silently killed the local DB twice
(WAL-in-transaction #27, non-idempotent ADD COLUMN #85). What still needs an on-device pass:
WAL actually reporting `wal`; the v13 upgrade no longer failing on launch; `user_version` stamped to
21; and no "Connection trainingai already exists" on a cold start.

The version stamp's safety rests on the `RECONCILE_COLUMNS` mirror test in
`lib/sqlite/__tests__/migrations.test.ts` being exhaustive — it was made case-insensitive in the
same PR, since a lowercase `alter table … add column` would otherwise escape the guard and be
retired unrepaired.

### [platform] Deactivating a user takes effect within ~24h, not instantly (v1.246.2, 2026-07-30)

**Was:** `auth.config.ts` set `token.isActive` only when a `user` object was present — i.e. at
sign-in — so a user deactivated afterwards kept `isActive: true` in their JWT and `middleware.ts:18`
(the only enforcement point) let them through until the token was re-minted, up to 7 days.

**Now:** `auth.ts`'s jwt callback re-reads `isActive` from the DB via `refreshIsActiveClaim`
(`lib/auth/is-active-refresh.ts`), throttled to once per 24h per user. The check cannot live in
middleware — that runs on the Edge runtime and imports the deliberately Node-free `auth.config.ts`
("no bcrypt, no pg") — so it lives in the Node config and middleware reads the claim it refreshes.
It is a claim refresh, not a re-authentication: a continuously-active user is never signed out or
re-prompted (covered by a test that walks a week of hourly use and asserts 7 lookups, claim always
true).

⚠️ **Residual, accepted by the owner:** the window is bounded, not closed — deactivation can take up
to a day to bite. Closing it fully would mean a Node-side re-check at a server choke point (root
layout / a shared `requireActiveUser()`), costing a DB query per server render; judged
disproportionate for a small invited-user app.

⚠️ **The 24h flip was not observed end-to-end.** The refresh logic has 8 unit tests, and sign-in,
guarded routes and the session payload were verified unaffected against `pnpm dev` — but watching a
real token cross the 24h boundary needs either a day or a faked clock, and neither was run. A DB blip
during the re-read leaves the claim untouched and does not advance the timestamp, so it retries.

### [app-shell] Screen transition timing + prefetch (v1.241.1, 2026-07-29) — NOT verified on device · needs: android
The view transition's early-resolve was dead code — `pendingRef` lived on the component that called
`push()`, which unmounts on navigation, so every push fell through to the timeout cap regardless of
how fast the route was (measured: route ready at 51 ms, screen frozen until 184 ms). Commit is now
detected by polling `location.href`, which has no React lifecycle coupling. Plus `router.prefetch`
on the four health score circles and their sibling surfaces, and a sequenced (rather than
simultaneous) cross-fade so two dense screens no longer superimpose mid-animation.

Measured in Chromium at 412×915 under a 150 ms RTT / 4 Mbps CDP throttle standing in for the mobile
link to Railway: time-to-motion 190/213/211 ms → 118/129/118 ms across warm runs, and it now tracks
the route commit rather than a fixed floor. **Chromium is not Samsung's WebView** and the throttle is
a stand-in, not a measurement of the real link — so the felt result on the S25 is unconfirmed. The
25%/40% fade split, the 200 ms duration and the 30 px displacement are all judgement calls made
against a slowed desktop capture and are one-line changes in `globals.css`.

### [cardio] Guided walk per-segment stats (v1.240.0, 2026-07-29) — NOT verified on device · needs: browser
The new `activity_logs.segments` column and the walk-complete screen's HR-zone-colored map/
fast-slow average cards were verified via Playwright against the dev server: a real 10-segment
array with correct per-segment pace/distance saved (`POST /api/activity-logs` → 201), the map and
average cards rendered correctly. Two things weren't exercised: **real HR-zone-colored route
segments** — this sandbox has no live HR samples, so `zoneSegments` correctly fell back to the flat
single-color line rather than actually painting per-run zone colors; and **the native offline-first
path** — `getLocalStore` returns null in the web sandbox, so only the web-fallback save (not
`upsertActivityLog`/local SQLite/`applyDelta` pull-sync) was exercised for the new column.

### [sleep] ⚠️ Two staging changes shipped but NEVER observed on a real night (2026-08-02, v1.251.0 / v1.251.1)

Q-34 item 3 added `spo2Var` — within-epoch SpO₂ spread — as a fourth REM/wake signal in the
heuristic stager (`W_SPO2 = 0.2`). **Two things about it are unknown and only the device can answer
them**, because `aggregateOuraRawSamples` needs real `oura_raw_samples` rows and the local database
has none:

1. **Whether the column is populated at all.** The spread is gated at ≥ 5 valid SpO₂ readings inside
   one 5-minute epoch, and the ring's oximeter cadence over BLE has never been measured against that
   bar. Mostly-blank is a real possible outcome.
2. **Whether it discriminates.** If populated values are weakly bimodal, that is the same negative
   result `brVar` gave in session 246.

**Risk is bounded, not zero.** The term is self-neutralising by construction — a null z-scores to 0,
and a uniform column has no spread for the per-night z-score to read — so a quiet oximeter leaves
staging exactly as it was, and a unit test pins that. What is genuinely unverified is the *populated*
case: if the column is dense but noisy it will perturb REM/light boundaries on real nights before
anyone has looked at it.

What WAS verified in-sandbox: the pure spread function (sample floor, artefact rejection, ranking),
the self-neutralising path, and that the term is genuinely read (a night differing only in its
`spo2Var` column stages differently; the test fails with `W_SPO2 = 0`).

**A second change rides on the same device check: the ultradian cycle prior (v1.251.1, Q-34 item 2).**
Sleep staging now expects REM to recur on a ~95-minute grid rather than ramping linearly across the
night (`W_CYCLE = 0.15`, modulating the existing `W_TIME` term rather than replacing it). Its pure
prior function is unit-tested, but **no stager-level behavioural test ships with it** — three were
attempted and every one passed with the weight zeroed, so none proved anything. Its effect on a real
night is therefore entirely unobserved, and the plan names a concrete failure mode: a fixed period
can fight the Viterbi bout decoder on a fragmented night. The revert is deleting two addends.

Clear this row from the device check on the owner checklist in
[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md)
— Redecode a night, read the `spo2V` column in the admin debug dump. Do not tune `W_SPO2` before
that answer exists; the verdict belongs in
[`docs/oura-ble-sleep-staging-findings.md`](docs/oura-ble-sleep-staging-findings.md).

### [workouts] Exercise Readiness rework (v1.235.0, 2026-07-29) — NOT verified on device · needs: browser

Driven end-to-end in a real browser at an S25-shaped 412×915 viewport (all four sections render, the
body map tracks the pills, Sick/Unwell warns, Quick rebuilds the plan and the stored estimate fell
38 → 24 min). **But the browser is not the device.** Unverified: Samsung WebView rendering of the
body-map SVG inside a bottom sheet, real safe-area insets, and haptics. The sheet deliberately adds
no `pb-safe` of its own — `SheetContent side="bottom"` owns the bottom inset — but that is reasoning,
not an observation.

Auto-marking WAS exercised against a seeded recent session (chest at 57 % recovered opened pre-marked,
with the in-session warning), but **not against the real multi-week history**. The safety argument —
8 of the last 10 production sessions share zero muscles with the session before, so this usually marks
muscles that aren't trained today and changes nothing — is a measurement of the data, not an
observation of the UI running on it. On the first real check-in, confirm the auto-marked muscles match
what you actually trained, since a marked muscle in today's session lightens those exercises.

Note the `LAGGING_RATIO` and realisation-phase caveats in the role-ordering row below still apply, and
now matter more: the short/long presets are the surfaces where weekly-volume rebalancing is most
visible.

### [devices][body] Scale passive-scan background sync (v1.246.9 → v1.249.1, 2026-07-30/31, 2026-08-01) — persistent connection + dedup fixes, PARTIALLY verified on device
Reworked `ScaleBleService` from a continuous 45s-poll foreground service (always-visible
notification) to a `BluetoothLeScanner`-PendingIntent scan (`ScaleBleScanManager`) that only wakes
`ScaleScanReceiver`/the service when the paired scale actually starts advertising — see the Latest
Feature entry above for the full mechanism.

The retry-storm cooldown (v1.242.0) initially looked confirmed via a `chrome://inspect` capture
(real weigh-in succeeded, a repeat scan match was correctly suppressed, cooldown correctly
suppressed the next wake) — **but the wake episodes kept recurring indefinitely on a steady ~3
minute cycle even hours later**, which an independent BLE scanner (nRF Connect) proved was NOT the
scale: it only appears in a neutral scan while someone is actually stepping on it. The earlier
"scale re-advertises on its own / motion-sensor wake" theory in this entry was **wrong** — root
cause is that Android's `PendingIntent`-based scan can redeliver a stale `ScanResult` well after
the real advertisement stopped, and `ScaleScanReceiver` trusted "the broadcast fired" alone as
proof of a live weigh-in, with no check on when the match was actually seen. Fixed by reading each
`ScanResult.timestampNanos` out of the intent extras and discarding the broadcast unless at least
one result is within `MAX_RESULT_AGE_MS` (5s) of now — **confirmed on-device 2026-07-30**: the
owner rebuilt and the endless-loop bug is gone, every wake now resolves within a bounded couple of
attempts.

That same test surfaced a smaller, real side effect of the v1.242.0 cooldown: the scale genuinely
(not stale-filtered) keeps re-advertising for a short post-use settling period after a real
weigh-in, which triggers one bounded retry cycle that gives up and starts the cooldown — and the
owner's deliberate second weigh-in ~2 minutes later landed inside that 2-minute window and was
silently missed. `GIVE_UP_COOLDOWN_MS` cut to 20s (see Latest Feature) since a real weigh-in always
succeeds on its first attempt regardless of cooldown length. Also added `notifyWeighInLogged()` —
a plain successful weigh-in previously produced no lasting confirmation once the transient
"syncing…" notification disappeared. **Not yet verified on-device** — needs the owner to rebuild
and re-run the back-to-back-weigh-in test.

That rebuild+test surfaced a third bug: the very first connection of a fresh app session could
reach `state=waiting` and then receive zero `FFE1` notifications at all (not even unstable) for the
full 30s timeout, despite the owner standing on the scale the whole time (confirmed via the scale's
own countdown) — the very next connection in the same session worked immediately. Theory (see
Latest Feature): the `FFE1` notify-subscribe write can silently fail to take on a fresh GATT
session without `onDescriptorWrite` noticing, matching this codebase's documented Samsung-BLE-stack
flakiness elsewhere (the Oura ring). **Not a regression from #929/#937** — `ScaleGattClient.kt`
hasn't changed since the original integration (#848); what changed is connection frequency, since
pre-#929 stale-scan replays triggered a real reconnect every ~3 minutes and incidentally kept the
BLE stack warm, masking this cold-first-connection case that #929's fix now exposes as the normal
case. Added an 8s early-data watchdog in `ScaleGattClient` that gives
up and lets the service reconnect with a fresh GATT session if zero notifications arrive that
quickly, instead of waiting the full 30s.

**Owner rebuilt and re-tested (2026-07-30): the watchdog did NOT fix it** — a fresh weigh-in still
timed out at the full 30s with no visible notifications, twice in a row, and the new watchdog's own
log line never appeared. Source confirmed correct (owner's local `main` checkout had the merged
fix). Root cause of the miss, found on review: `onCharacteristicChanged` calls
`cancelEarlyDataTimeout()` unconditionally for *any* `FFE1` notification, including one that then
fails `ScaleProtocol.parseWeightPacket` and hits its own `return` with **no log line at all** (the
"malformed or the auto handshake frame" case the original code comment already knew about). If the
scale sends exactly one such frame right after subscribe — proving the subscribe worked — the
watchdog retires silently, and if no genuine weight packet ever follows, the connection then sits
out the full `WEIGH_IN_TIMEOUT_MS` with a console trace indistinguishable from the original
zero-notification bug. Added a log line for that swallowed case (`fix/scale-ble-handshake-frame-watchdog-log`,
diagnostic only — no behavior change) so the next on-device run can confirm or rule this out.

**Confirmed by owner's next test (2026-07-30, 4 weigh-ins within ~1 minute):** the scale reliably
sends an always-11-byte unparseable frame as the first `FFE1` notification on every connection,
before any real reading. 2 of 4 attempts got real data right after it and succeeded; 1 of 4 got only
that frame and then genuine silence for the rest of the 30s — the exact bug, now proven rather than
theorized. (The 4th attempt failed a different way — `connectionStateChange status=19`, the scale
itself terminating the connection mid-measurement — logged as a separate, not-yet-investigated
failure mode; the existing 2-attempt-then-cooldown retry policy already absorbed it correctly.)
Real fix: `onCharacteristicChanged` now re-arms the early-data watchdog when it sees an unparseable
frame instead of retiring it for good, so a connection that stalls right after the handshake frame
still bails within `EARLY_DATA_TIMEOUT_MS` of *that* frame rather than sitting out the remaining
~22s. The outer `WEIGH_IN_TIMEOUT_MS` runs as an independent, never-reset timer, so this can't push
a stalled connection past the original 30s ceiling regardless of how many junk frames arrive.
**Device-verified 2026-07-30.** Owner rebuilt and retested: a real weigh-in registered normally
(handshake frame, then immediate unstable → stable data). Separately, the scale's own post-weigh-in
settling re-advertisement triggered a fresh connection that got only the handshake frame and then
genuine silence — and this time it printed `"no data within 8s of request — notify subscribe likely
failed, retrying"` and bailed after 8s, instead of the old 30s `weigh-in timeout`. That's the fix
firing exactly as designed, live on-device, not just in theory.

**Reframed root cause (2026-07-30), from the owner's actual test procedure:** step on the scale →
wait for its own display to say "complete" → check the phone → nothing yet → step back on → that's
when a reading landed. Combined with the handshake frame appearing in **100% of captures so far**
(success and failure alike), this points away from "notify-subscribe sometimes silently fails" and
toward a race: the scale's local measurement cycle finishes faster than the phone's full BLE
pipeline (scan-detect → connect → discover services → subscribe → write the request), so the
request often goes out after the person has already stepped off, with nothing new to report. Two
follow-up changes in `ScaleBleService.kt`: `notifyWeighInFailed()` (new low-priority notification —
"Weigh-in not captured — step on the scale again" — fires when a wake exhausts all attempts; this
path previously notified nothing at all, so a failed weigh-in and a successful one looked identical
from the notification shade), and `MAX_ATTEMPTS` bumped 2→3 with the retry notification text changed
to "Retrying — stay on the scale…" (one more bounded ~8-30s cycle to catch a delayed
re-engagement, explicit user tradeoff — accepted a longer worst-case wake for better odds of
catching it). **Not yet verified on-device.** Still open: the `connectionStateChange status=19`
mid-measurement disconnect (separate failure mode, no grounded theory yet), the `ScaleBootReceiver`
reboot re-arm, the two-phone household scenario, and whether the race theory should also drive a UI
change (explicit "stay on the scale a few seconds" guidance) rather than just service-level tuning.
Separately raised by the owner: whether the scale buffers recent readings for later pull (like the
official Renpho app appears to show). A real, independent third-party open-source client for this
exact scale family (`ronnnnnnnnnnnnn/renpho-escs20m`) confirms such a mechanism genuinely exists on
this scale family (`_OP_STORED_MEASUREMENT`, query commands documented) and, as a bonus, resolves
what our own always-11-byte unparseable frame actually is — their `_OP_UNIT_REQUEST = 0x12` opcode
matches our own Phase 0 note about a "handshake-identification packet... marker `0x12`" exactly, so
it's a display-unit request, not a stored-measurement record. Their command opcode family
(`0x20`/`0x22`-prefixed) doesn't match our own scale's confirmed, 4-times-verified live-measurement
opcode (`0x13`-prefixed) — different firmware/scale variant — so it isn't verified against our
hardware. **Update (v1.246.9): implemented anyway, as an explicit owner-authorized bet** (see the
Latest Feature entry above and `docs/superpowers/plans/2026-07-30-scale-stored-measurement-drain-
and-scan-latency.md` for the full reasoning) — written to fail silently if the guess is wrong, with
no server-side changes needed (reuses the existing `/api/scale-ble/samples` `measuredAt` field).
Backlog Q-36 removed since the "concrete next step" it described has now been taken; whether it
actually works is an open question for the owner's next on-device test, not a backlog item.

**Continued (2026-07-31 – 2026-08-01), owner-directed on-device iteration, no separate planning
PR — same arc, ten more rounds (#965–#974):**

- **False positive matches (#965, device-confirmed).** `ScaleBleService`'s FFE0 service-UUID scan
  filter matches any nearby BLE peripheral built on the same generic Bluetooth-serial module
  (fitness bands, LED controllers, OBD adapters, etc. all share the FFE0/1/2/3 pattern), not just
  the paired scale — confirmed on-device connecting to something that wasn't the scale at all,
  producing a misleading "step on the scale again" failure with nobody near it. Both the live
  (`ScaleForegroundScanner`) and background (`ScaleScanReceiver`) scan paths now additionally
  check the matched result's own MAC against the paired scale's stored `device_id` before acting.
- **Stale toast bleed-through (#966, device-confirmed).** Sonner's toast-update-by-id merges the
  old toast object into the new one; `toast.success/warning/error`'s `data` type omits `jsx`, so
  it could never clear the progress-bar `jsx` set by the in-progress toast — a frozen "Weighing
  you…" bar was rendering underneath the real result text. Fixed by rendering every weigh-in toast
  state (progress **and** result) via `toast.custom()`, so each call always sets a fresh `jsx`.
- **Scan latency tuning (#967)** — `MATCH_MODE_AGGRESSIVE`/`MATCH_NUM_ONE_ADVERTISEMENT` on the
  live Home-screen scan (safe now that scan is scoped to Home-screen dwell, not all-day), plus a
  diagnostic-only `scan_source` tag (live vs. background) to settle which scan path actually wins
  the race, next time it's needed.
- **FFE3 request-write back-and-forth (#968–#971), same-day reversal.** Raw hex logging (#968) of
  the previously "harmless" unparseable handshake frame surfaced a real disagreement with an
  earlier note, prompting closer investigation. #969 re-enabled the previously-disabled speculative
  stored-measurement drain write as a genuine second attempt. #970 made the live-measurement
  request (`FFE3`) write a *fallback* — subscribe-and-wait first, only write if nothing arrives
  within `EARLY_DATA_TIMEOUT_MS` — on the theory the write itself was resetting the scale's
  in-progress reading. **#971 reverted that the same day**: on-device testing showed deferring the
  write made the common case *worse* (stopped producing the sometimes-instant weigh-ins earlier
  iterations had), stronger evidence than the correlation that motivated the defer. Net effect:
  request-write timing is back to "write immediately after subscribing," same as the original
  integration, with `EARLY_DATA_TIMEOUT_MS` simplified back to a single-tier watchdog armed once
  per connection instead of twice.
- **Persistent connection, modeled on the Polar strap (#972, architecture change).** Previously
  each wake ran a bounded connect-attempt-then-disconnect cycle (`CYCLE_BUDGET_MS`, 12–16s). On-device
  testing kept finding "instant" weigh-ins only when a connection was *already* open (via nRF
  Connect, the official app, or a prior run of this app) and never torn down — i.e. this app was
  discarding a working link every time and paying the full reconnect cost on the next wake, not
  missing a handshake. `ScaleBleService` now holds the GATT connection open indefinitely once
  linked (`START_STICKY`, no auto-disconnect after one reading) and reports every weigh-in that
  happens on it, the same pattern `PolarStrapService` already uses for the chest strap.
  `MAX_ATTEMPTS` bumped 3→5 since a successful first link now pays off for the whole session
  instead of being thrown away after one reading.
- **Scoped to the Home screen (#973)**, since the connection is no longer self-bounding: the
  persistent link (and the aggressive live scan from #967) now stops outright when the owner
  leaves Home (`setHomeScreenActive(false)` calls `stopService`), and a background scan hit is
  ignored unless `ScaleForegroundScanner.isHomeScreenActive()` — keeping the new architecture's
  battery cost bounded to actual dwell time rather than "the app is open anywhere."
- **Two bugs that were direct consequences of going persistent (#974, NOT yet device-confirmed).**
  The scale itself retransmits an identical stable-weight packet up to 3× before going idle; with
  the connection no longer closed after one reading, each repeat was being treated as a brand new
  weigh-in and re-posted to ingest — `ScaleGattClient` now drops a stable reading matching the last
  one it reported within a short window. Separately, the scale disconnects on its own after a
  reading and `ScaleBleService`'s background reconnect was forwarding its
  CONNECTING/PREPARING/WAITING transitions to JS exactly like a fresh weigh-in, reopening the
  "weighing you…" toast with nothing left to weigh (and firing a spurious failure notification if
  that reconnect then timed out) — state forwarding and failure notifications are now suppressed
  for background reconnects following a capture, and only a genuine `onUnstableReading` reopens the
  cycle.

**Net effect of this round:** weigh-in reliability should be meaningfully better (persistent
connection catches readings the old bounded-cycle model was structurally likely to miss, false
device matches are gated out, duplicate postings and stuck toasts from the new architecture are
fixed) — but **the persistent-connection redesign itself (#972–#974) has no on-device confirmation
recorded**, unlike every earlier step in this arc which was explicitly rebuilt-and-retested before
the next theory was tried. This entire round is native Kotlin (`android/app/.../scale/*.kt`) —
compile-gated only in the sandbox, requires `npx cap sync android && ./gradlew assembleDebug` to
reach a real device. Per the Canonical Runtime device-verification gate, treat as **NOT verified**
until the owner rebuilds and runs a normal weigh-in, a back-to-back double weigh-in (the #974 dedup
case), and a Home→Settings→Home screen transition (the #973 scoping case).

**First real on-device rebuild (2026-08-01), via `chrome://inspect`:** a normal weigh-in captured
correctly (71.75 kg + impedance), and the #974 duplicate-reading dedup **is confirmed working** —
two repeat stable frames from the same weigh-in were correctly logged as "ignored — scale repeated
the same frame it already reported." But the stuck-toast fix was only half-effective: the scale's
post-reading disconnect (`status=19`) triggered a background reconnect through `onFailure()`'s
retry branch, which broadcasts `scaleStatus=retrying` **unconditionally** — that path was never
covered by the `hasCapturedThisWake` guard #974 added to `onState()` (guards a different call
site), so the JS toast reopened as "Still trying — stay on the scale…" right after a successful
capture, the same user-visible bug in different wording. Fixed by extending the same guard to the
`retrying` broadcast (and to the paired "Retrying — stay on the scale…" foreground-notification
update) in `onFailure()`. **Not yet re-verified on device** — needs another rebuild + the same
back-to-back weigh-in test to confirm the toast now stays on the success state through a
post-capture reconnect.

**Second rebuild (2026-08-01): the retrying-suppression fix is confirmed.** Same test — capture,
dedup-ignored repeats, `status=19` disconnect, `RETRY_GAP_MS`-timed reconnect — but this time with
no `state=retrying` line and no toast reopening. Separately, the owner raised a different concern
from the same test: connect/detect speed feels noticeably worse than the very first integration
(#848), describing a "prime the connection by stepping on once, then it's instant ~30s later"
workaround. Two responses, both native-only, not yet device-tested:
- **Restored the stored-measurement-drain request** (`ScaleProtocol.REQUEST_STORED_MEASUREMENTS_CMD`,
  `0x22 0x04 0x15`), which turned out to have been silently dropped: #969 (2026-08-01 08:19) added
  the write, #970 (2026-08-01 11:36, "defer FFE3 to a fallback path") rewrote `onServicesDiscovered`
  and dropped it as a side effect while doing something unrelated, and #971's revert of #970 never
  noticed it was gone. The receive side (`parseStoredRecord`/`onStoredReading`/`postStoredReading`)
  was never removed, so this was dead code with nothing left to trigger it. Restoring the write is
  the most direct fix for the owner's actual complaint — a missed live connection window currently
  just loses that reading instead of it being recoverable on the next connect.
- **Added stage-timing diagnostics** to `ScaleGattClient`, logging elapsed ms (from `connectGatt()`)
  at gatt-connected, services-discovered, notify-subscribed, measurement-requested, and
  first-FFE1-notification. Purpose is purely diagnostic — comparing a "cold" first connect's log
  against a "primed" one should show which specific stage the latency is actually in, rather than
  guessing between Home-screen-scoping races, GATT service-discovery caching, or something else.
- **On-device timing captured (2026-08-01), analysed, findings written up:** see
  [`docs/scale-ble-connect-latency.md`](docs/scale-ble-connect-latency.md). Headline: the entire
  ~950ms gap between a cold connect (2206ms to link-alive) and a warm one (1270ms) lives in raw
  GATT connection establishment, not in anything our own discover/subscribe/request code does. The
  "priming" the owner described is already what #972's persistent-connection design provides
  (holding the link open indefinitely once linked); the remaining constraint — the scale doesn't
  advertise at all while idle — is a hardware limit no app can pre-connect around. **Still open:**
  the captured "warm" sample was an automatic same-session reconnect after a peer-drop, not the
  originally-reported "walked away, came back 30s later" scenario, so that comparison is still
  needed; a parked idea to decompile the Renpho app's APK for connection-parameter differences
  (bonding, PHY/interval) is blocked pending the owner supplying the file.
- **Found from the same on-device session: the persistent connection produced a false "Weighing
  you…" toast on every Home-tab visit.** Confirmed from the captured log — a connection linked at
  `08.887` sat idle for 22s before the first real reading at `30.946`, with the toast showing the
  whole time. Root cause: `setHomeScreenActive` stops/restarts `ScaleBleService` on Home-tab
  focus/blur to bound its now-persistent battery cost to Home-screen dwell time, and a return to
  Home can re-link while the scale is still finishing its own post-use re-advertising — with
  nobody actually on it. `onState()`/`onFailure()` broadcast CONNECTING/PREPARING/WAITING/RETRYING
  to JS unconditionally on any such reconnect, with no way to tell "just re-linking" apart from "a
  real weigh-in in progress". **Fixed:** added `hasSeenActivityThisWake`, set only by
  `onUnstableReading` (real proof someone is on the plates) — gates the progress toast, the
  "Retrying…" state, and the `notifyWeighInFailed()` give-up notification, all previously keyed off
  bare connection state. Trade-off, accepted: a genuine step-on whose connect fails before ever
  receiving a real weight packet now also fails silently (no "Didn't catch that") — there's no BLE
  evidence to distinguish that case from a spurious reconnect, and the spurious case is far more
  common in practice. Kotlin-only (`ScaleBleService.kt`), no JS changes needed. **Not yet
  on-device tested** — needs a rebuild, then repeated Home-tab navigation with nobody on the scale
  (should show nothing) and a real weigh-in (should still show the toast, with a real-world
  imperceptible ~1s-or-less delay vs before, since it now waits for the first unstable reading
  rather than bare connection state).

### [cardio] Guided walk GPS/pace (v1.233.0, 2026-07-29) — NOT verified on device · needs: hardware
Live GPS tracking, the route map, and pace-primary UI in the guided interval walk were only
exercised via Playwright against the dev server with `navigator.geolocation` mocked — that drives
`lib/activity/gps-tracking.ts`'s **web** fallback (`navigator.geolocation.watchPosition`), never
the native `@capacitor-community/background-geolocation` path real devices use. End-to-end save
was confirmed real (a `POST /api/activity-logs` with real computed route/pace fields returned
201), and the no-GPS-fix degradation (indoor/treadmill walk, today's HR-primary layout) was also
confirmed to render without a crash. What's unverified: the native background-location permission
flow, whether GPS keeps reporting fixes with the screen off during a real walk, and real ring/strap
cadence running concurrently with real GPS movement.

### [workouts] Role ordering (v1.232.0 + v1.233.1, 2026-07-28/29) — clamp now observed firing; two knobs untuned

**Update (v1.233.1):** the earlier note here said the clamp had never been seen to fire. It has now.
The live Upper shape (accessory `5×7 @77.5 %` vs primary `4×7 @76 %`) was seeded into the local DB and
read back through the periodization route as **`4×7 @76 %`**, with the stored row unchanged — so both
the load cap and the set ceiling bind, read-side, without a write.

Also fixed in v1.233.1: the generation-time rule could not reach prescriptions **already stored**, and
production's Upper plan (generated 6 days before the rule shipped) was still serving the bad numbers.
Role caps now apply on read via `normalizeStoredPrescription`. Note the read path applies only the two
*absolute* rules (per-role set ceiling, anchor load cap) — **not** the anchor set cap, whose
lagging-muscle exception needs weekly-volume data the read path lacks.

Still worth watching rather than assuming:
- **`LAGGING_RATIO = -0.25` is an untuned guess.** It decides how eagerly role order breaks on volume.
  If accessories start routinely out-setting compounds, it is too close to zero.
- **The realisation-phase case is tested but not observed.** A realisation primary is deliberately
  low-set (3×2) beside legitimately high-volume isolation work; the lagging exception is what stops the
  rule stripping that volume. Covered by a unit test, not yet by a real realisation block.
- **`workout-data`'s weight-bearing output was not watched end-to-end** — the local seed has an empty
  `baseline_1rm`, so no weights are computed there. Same helper, same role map as the verified path.

Server-side only — no native surface, so no device verification is required for these changes.

### [workouts] Q-5 personal records vs starting weights (v1.231.0, 2026-07-28) — two known gaps
`personal_records` is now log-derived only; the starting 1RM typed in the builder lives in the new
`exercise_estimates` and finally reaches the bar via one shared `resolveWorkingBasis`. Verified
end-to-end on `pnpm dev`: a typed 100 kg produced `estimated1rm: 100` where it was previously null,
with `personal_records` confirmed untouched.

**Gap 1 — historical rows are still wrong.** 5 `personal_records` rows disagree with the best
surviving log (Barbell Bench Press 90.8 vs a real 96.0, Barbell Front Squat 67.5 vs 73.8, plus three
whose values appear in no log), and 5 near-duplicate spellings still split one exercise's best
across two rows. Correcting them **rewrites real user data**, so it is queued as **Q-5b** for
owner confirmation rather than merged here. New drift is prevented from today either way.

**Gap 2 — no offline mirror yet.** `exercise_estimates` has no local-store table, so offline an
exercise with only a typed estimate (no log) still resolves to null. Online-first flow, so the
common path is unaffected, but it is a real offline-first gap.

Also deferred: `computeInitialWeights` still has its `return 60` fallback. The resolver makes it
unreachable for any exercise with a log, PR or estimate — what is left is the genuinely-nothing
case, and changing what the weight input renders with no value wants an on-device look.

### [workouts][platform] Local exercise-library mirror (v1.234.2, 2026-07-29) — NOT verified on device · needs: browser
The on-device store now mirrors the exercise catalogue, so an offline read can tell a bodyweight
movement from a weighted one instead of assuming `weighted` (Q-20). Hydrated from the
`/api/workout-data` response; falls back to `weighted` for an exercise the mirror has not seen.

**Not device-verified, and that is the entire surface this change lives on.** `getLocalStore`
returns null in the web sandbox, so the v20 migration, the accessors, the hydration write and the
offline read all went unrun natively — only the pure logic and the server half were exercised.
Requires an APK rebuild.

Owner check: open the app once online so the mirror populates, then go offline and open a session
containing a bodyweight exercise (e.g. Pull-Up) — it should render a rep target, not a kg weight.
Also confirm no dead-store banner on first open after the v20 upgrade.

### [workouts] AI prescription silent auto-dismiss + generation moved to pre-workout (v1.247.0, 2026-07-30)

Owner noticed a phase-transition recommendation on a real "Upper" session showed
`AI Prescription · Accumulation · Dismissed` despite never having tapped Move or Skip. Traced via
`POST /api/admin/db-query` against production: the prescription was generated 2026-07-22, its 7-day
`prescription_expires_at` lapsed 2026-07-29 with nobody having acted on it (the owner hadn't reopened
that specific session in the interim), and the very next open — `GET
/api/ai-periodization/session/[id]` — silently flipped `pending` → `dismissed` with no prompt. Root
cause: two auto-dismiss-on-expiry code paths (that GET route, and `workout-data`'s equivalent) existed
specifically so a stale phase decision couldn't linger — but "linger" was resolved by silently
deciding *no* on the owner's behalf, which is worse than lingering.

**Fix (three parts, one PR):**
1. **No auto-expiry, anywhere.** Removed both auto-dismiss-on-expiry blocks
   (`app/api/ai-periodization/session/[sessionId]/route.ts`, `app/api/workout-data/route.ts`) and the
   matching `expired` gates in `app/api/next-session/route.ts` and
   `app/api/next-session/prescription/route.ts` that mirrored them. A `pending` prescription — phase
   transition, deload, or otherwise — now only ever changes status on an explicit Move/Skip/Accept/
   Dismiss. `prescriptionExpiresAt` is still stored (harmless) but nothing reads it for gating anymore.
2. **Generation moved from session-end to pre-workout-open**, closing the staleness problem at the
   source rather than papering over it with an expiry: `regenerateNextPrescription` and its two callers
   (`app/api/complete-workout/route.ts`, the offline-outbox `complete_workout` branch in
   `lib/data/postgres/adapter.ts`) are deleted. `completeWorkoutFromPayload` just marks the slot
   `consumed`; the existing `isAiPrescriptionPending` on-open trigger (previously the Gemini-outage
   retry path) is now the only generation trigger, so a prescription is never more than minutes old by
   the time it's acted on. This reverses the 2026-07-20 "generate at session end" decision — see that
   entry's history for why it existed (a blank "Auto" chip on the Health card) — because the owner
   confirmed that chip distinction is redundant (auto-apply is a single program-wide toggle) and asked
   for a more useful stat instead.
3. **`AiPeriodizationStatusCard`** (Health → Training) replaced the Auto/Ready/New status dot with
   "Nd ago" / "Yesterday" / "Trained today" / "Never trained" per session
   (`app/api/ai-periodization/program-overview/route.ts` now returns `lastTrainedDaysAgo` via the
   existing `getRecentSessionsOfType`, no new repo method).

**Verified:** full test suite green (2 new/updated test files, one pre-existing DB-test env quirk
unrelated to this change — see the DB-test note above), `tsc` clean, lint clean (pre-existing warnings
only), both Custom Rules checks pass. Exercised against `pnpm dev` on local Postgres with the exact
production shape reproduced (pending + `transition_recommended`, expired 2 days, `auto_apply_
prescriptions = true`): confirmed the GET session route and `workout-data` both leave it `pending` and
still drive load off it; confirmed completing a workout leaves the slot `consumed` with no eager
regeneration; confirmed reopening a `consumed` session sets `aiPrescriptionPending: true`; screenshotted
the Health → Training card showing "9d ago" / "7d ago" / "No data" in place of the old chip.

**NOT exercised:** the S25 APK — this is a server/web-route + React-card change with no
Capacitor/native/safe-area/gesture surface, so there is nothing native-specific to verify, but the
real on-device render has not been looked at.

### [workouts] AI prescription review (v1.230.0, 2026-07-28) — NOT device-verified; HR list never rendered with real data · needs: data

Everything shipped was exercised against `pnpm dev` on the local Postgres with the program flipped to
`ai_dynamic` and the production bad state seeded verbatim — real Gemini generation at all three
duration presets, a stored no-op transition normalising on read, a post-first-read soreness check-in
deloading and reverting, and the picker swapping live in a real browser at 412 px in both themes.
None of it has run on the S25 APK.

- **Per-exercise HR recovery is unit-tested only.** The local dev DB has no heart-rate readings, so
  `aggregateHrRecoveryByExercise`'s rendering (done screen + day-overlay sheet) has never been seen
  with real data. Eight unit tests cover the aggregation, including the negative-recovery case that
  motivated it (a set whose HR *rose* rendered as "↓-9 bpm/min ✓").
- **The done-screen cache-seeding is an APK surface** — `workout-recap:` / `workout-timing:` /
  `workout-energy:` / `workout-hr:` seeds and their invalidation need the on-device smoke run.
- **A `long` session fills only to the per-role set ceilings** (primary 6, secondary 5, accessory 4),
  so a small session tops out well under 90 min. Deliberate — deepening the AI's shape, not
  redesigning it. Adding exercises would be a separate feature.
- **Set-count plausibility across roles is not checked.** Production had Upper prescribing Skull
  Crusher 5×7 @77.5 % against Incline Bench 4×7 — an accessory outranking the primary on volume.
  Real, but it needs a role-ordering rule that doesn't exist yet; the effort-floor layer only
  partially governs it.
- **A short session doesn't re-balance the rest of the week.** Volume skipped today isn't
  redistributed to the remaining sessions; the weekly-MAV trim priority recovers most of it
  implicitly (what's skipped is under-target next session), but nothing does it explicitly.
- **RETRACTED — the "possible soft-delete" was a mid-sync read, not data loss.** The original note
  claimed the 2026-07-28 Push session showed 5/5 exercises and 14 sets on device while a
  `deleted_at IS NULL` query returned 4 and 12. Re-checked against production: **5 exercise rows and
  14 set rows, none deleted**. The discrepancy was entirely timing — the last exercise (Tricep Cable
  Combo, 2 sets) has `updated_at 08:54:14` and the query ran ~08:52, while the owner was still on
  the done screen. 5 − 1 unsynced = 4; 14 − 2 = 12, exactly. Offline-first behaved correctly: the
  device held the truth and Postgres caught up ~90 s later.
  **Method lesson for the data-quality review session** (`docs/data-quality-review-charter.md`): a
  query issued while the owner is actively training reads a moving target. Any device-vs-DB row-count
  gap must be re-checked after sync settles, and compared against `updated_at`, before it is written
  down as a finding.
- **`GET /api/ai-periodization/session/[id]` runs the full `aggregateSignals`** (~12 sequential DB
  waves) on every prescription-card load *and* every ~3s poll tick, though the card only consumes
  `signals.exercises`. A significant share of the "few seconds before the AI numbers appear" the
  owner reported. Not addressed here — trimming the payload is its own change.


### [devices][heart-rate] Ring de-escalation when the strap covers (v1.229.3, 2026-07-28) — NOT device-verified · needs: hardware
`lib/live-hr/manager.ts` now skips starting the Oura ring's aggressive live-HR loop during a
workout whenever the chest strap is already connected, with a 10s periodic re-check so a strap
that connects/disconnects mid-workout escalates/de-escalates the ring automatically. Pure JS —
`tsc`/`eslint`/the full unit suite are green, including rewritten and new manager tests exercising
the gating and the periodic re-check with fake timers. **What can't be verified in the sandbox:**
whether the ring's actual on-device battery drain changes, since that requires a real strap + ring
pair and a real workout. Owner should confirm on the S25: start a workout with the strap connected
and worn, and check (via the admin BLE console or just observed battery drain over a session) that
the ring's live-HR burst loop doesn't fire while the strap is covering.

### [cardio] Run status-bar chip (v1.227.2, 2026-07-27) — native chip NOT verified on device · needs: android
`RunChipBridge` (`MainActivity.java`) and the JS wiring were verified as far as this sandbox
allows: braces balance, every `@JavascriptInterface` signature matches what
`lib/native/run-status-chip.ts` calls, `RunActiveScreen` renders correctly with the chip effects
active (Playwright, injected active-run state, no new console errors), and the new "Run in Status
Bar" preference toggle persists across a reload. **The actual chip appearing in the Android status
bar / One UI Now Bar during a real run has never been exercised** — no Android SDK/Gradle in this
sandbox (proxy-blocked), so `./gradlew compileDebugJavaWithJavac` couldn't even compile-check it.
Needs an owner APK rebuild + on-device smoke test: start a distance-goal run and confirm the pill
shows live "X.XX / Y.YY km" text ticking on GPS fixes; start a duration-goal or freeform run and
confirm the pill counts down/up like the existing rest-timer chip; pause/resume and confirm the
chip clears then reappears with a correctly-shifted target; tap the chip and confirm it reopens the
app to `/activity`.

### [heart-rate] Max-HR resolver consolidation (v1.226.3, 2026-07-28) — target screens NOT verified on device · needs: browser
Max HR was resolved three different ways (`hrMaxFromAge`, `resolveMaxHr`, `estimateHrMax`); they
agreed only because the observed max sat below the age prediction, and the first reading above it
would have split them silently. `resolveHrProfile` is now the only resolver, and every observed
value is corroborated through `computeObservedHr` — previously two producers took a bare
`Math.max` over raw readings and one **persisted** it, so a single motion artefact became a
permanent ceiling that raised every Karvonen target with no way back down.

It returns two named numbers on purpose: `maxHr` (effort ceiling, never falls below the age
prediction) and `targetAnchorMax` (reachable targets, does use a lower observed max — anchoring
walk blocks on 220−age put the fast block out of reach without jogging). Collapsing them to one
would have regressed that.

**Not device-verified.** The two screens whose targets change — guided interval walk and the
fitness-test protocols — were not run on the S25; there is no live HR source in the sandbox. The
change is JS/server-only (ships via Railway, no APK rebuild) and the target math is unit-tested
plus proven end-to-end against seeded `oura_heartrate` rows on `pnpm dev`, but the on-device read
of the new anchors is unverified. Owner check: start a guided walk and confirm the fast/slow
targets are still reachable and haven't jumped.

**Known-by-design:** `body_battery_daily.hr_max_observed` rows written before this change are
still raw maxima. Nothing reads them as a max-HR override any more, so no value depends on them,
but they are not retroactively corrected — a future consumer must not treat historical rows as
corroborated.

### [devices] Chest-strap notification cap + battery readout (v1.226.2, 2026-07-28) — NOT device-verified · needs: hardware
`PolarStrapService` now gives up (stops itself, clearing the ongoing notification) after 6
consecutive connect failures instead of retrying at the 120s ceiling forever — the strap isn't
worn all day, so an unreachable strap almost always just means it isn't on, and the ring already
covers HR. It also reads the standard Battery Service once connected and shows `Connected · X%
battery` in the notification (mirrors the Oura ring service's pattern), exposed in `getStatus()`
too. **Native — requires an APK rebuild to take effect; nothing here ran against a real H10 or
Android's BLE stack.** Owner should confirm on the S25: the notification stops nagging after ~4
min when the strap is out of range/not worn, and shows the battery % once actually connected.

### [cardio] Elevation profile chart (v1.225.0, 2026-07-27) — local-SQLite sync path and real GPS elevation data NOT verified
Verified via a manually-seeded `activity_logs` row (`psql`) that the chart renders correctly on the
activity detail sheet. The local-SQLite write→outbox→sync→pull round-trip (Task 5 of the plan) was
only exercised via `tsc`/the offline-sync unit suite, never a real native SQLite write on-device —
and no real GPS route with elevation data has been recorded, since the sandbox has no device GPS.

### [cardio] Dedicated run execution screen (v1.222.0, 2026-07-27) — live HR NOT verified on-device
The new `RunActiveScreen`'s live HR + zone hero was verified end-to-end in the web sandbox (renders
correctly in its "waiting" state, no console errors), but live HR requires a real Polar strap or
Oura ring — not reachable in the sandbox. Also inherits `ActivityRouteMap`'s pre-existing,
out-of-scope limitation that the map viewport doesn't auto-recenter as new GPS points stream in
(react-leaflet's `bounds` prop is effectively mount-time-only).

### [devices][platform] D2 Task 1 — local-store Oura accessors (2026-07-27) — now has a caller path ahead of it
Added `LocalStore` read/write accessors for the on-device Oura tiers (`oura_daily_summary`,
`oura_daily_derived`, `oura_bucket`, `oura_heartrate`). Still inert — Tasks 2+3 above build the
raw store and the bridge that feed them, but the on-device rollup writer that will actually call
them is Task 6. No user-visible behaviour changed, so no version/changelog bump.

### [heart-rate] D5 own daytime-HRV (v1.220.1, 2026-07-27) — cold-start gate + NOT device-verified · needs: browser
Two distinct, real gates, not formalities:
1. **Cold start.** The model only exists after its first successful refit, which needs
   `MIN_TRAINING_SAMPLES` (50) night-time `0x5d` HRV buckets — realistically a few days of real
   overnight ring wear post-merge. Until then `getDaytimeHrvModel` returns null and daytime-stress
   contributes nothing to Body Battery, identical to today's behaviour — not a regression, but also
   not yet doing anything.
2. **Not device-verified.** The actual validation gate — a real H10 spot-check (wear both ring +
   strap, run **Admin → Oura BLE → own daytime-HRV vs Polar H10**) — hasn't happened, and can't
   until gate 1 clears (no model → nothing to compare). The design decision to gate the regression
   on MET rather than fit it as a feature, and the ±10ms tolerance band, are both first-principles
   choices pending this real-data check, not validated ones.
Owner action once gate 1 clears (a few days out): run the spot-check console and confirm the two
sources roughly agree.

### [cardio] Baseline anchors + push sessions (v1.218.0, 2026-07-27) — real push cadence and on-device NOT verified
The every-5th-session push detection and the 2%-beat-your-best distance bump were verified by
seeding 4 completed `prescribed_runs` rows (with GPS-bearing `activity_logs`) via `psql` and
backdating the plan's `created_at` so they fall within its lifetime — confirmed the 5th
`GET /api/running-plan` call correctly returns `isPushSession: true` with the bumped distance and
rationale, and that the "PUSH" badge renders on `/running`. Never exercised against a real 5-session
history built up over genuine calendar time. No native/offline-sync code paths touched (no new field
goes through the `prescribed_run` mutation domain), but the on-device (S25) smoke run per
`docs/device-smoke-checklist.md` hasn't been done.

### [cardio] Density-progression running framework (v1.217.0, 2026-07-27) — multi-week growth and on-device NOT verified
The framework's distance target grows `1.03 ** weekIndex` — confirmed correct via unit tests and a
manually backdated `running_plans.created_at` row, but never exercised against a real multi-week
user history (the local dev seed can't fast-forward calendar time). The completion round-trip (Start
→ active → Finish → Save → `prescribed_runs.status = 'completed'`) was verified end-to-end via
Playwright + `psql`, but this PR touches no native/offline-sync code paths, so the on-device (S25)
smoke run per `docs/device-smoke-checklist.md` hasn't been done.

### [devices] 🔴 Ring calibration captures were scoped wrong — fixed v1.216.1, prior ring data suspect
The console scoped a capture's ring windows as `ds >= newestDs − captureDs`, which assumes the
**newest window sits at the capture's END**. That holds only if a drain lands as the capture
finishes. In the owner's 150 bpm capture the drain arrived **16 s into a 147 s capture**, so the
filter reached 147 s *backwards* from a window near the start — roughly **87% of the "in-capture"
windows predated the walk entirely**, and the scatter they showed (81 / 115 / 139 / 159 spm) was
pre-capture history, not a ring failure at running cadence.

**This is the third time drain timing has corrupted a ring conclusion**, and the second time a
fix for it was itself wrong. Fixed by (a) requesting a drain **on capture stop** and waiting for
the burst, and (b) scoping by reconstructed **occurrence time** — anchoring `(newest ds ↔ its
arrival time)`, since a drain replays history *up to the present* — rather than by a ds offset.
Exports now carry `ringCoveredToSec` / `ringCoversCapture` so a partly-seen capture can never
read as a complete one.

**Consequence:** every ring number from a capture before v1.216.1 is only trustworthy if its
drain happened to land near the end. The 120 bpm capture qualifies (drain at 80% through) and its
ring/strap agreement stands; the 150 bpm capture does **not**, and says nothing about the ring.

### [cardio][devices] 🟡 Ring cadence is octave-ambiguous, not flat — still gated off (2026-07-27)
**Supersedes an earlier, wrong entry** that read "the ring DOES NOT track cadence". A
metronome-referenced capture overturned it: at a set **120 bpm** the ring's capture-scoped
windows were tight at **1.952 Hz → ×60 = 117.1 spm**, against a strap reading of **117.5** —
agreement to **0.4 spm** between two sensors that share no hardware and no code.

The signal is therefore not flat. Fitting all three counted captures against step-rate and
stride-rate (half) shows it locks onto **either**:

| counted | ring Hz | vs step rate | vs stride rate |
|---|---|---|---|
| 64 spm | 0.98 | −8% ✅ | +84% |
| 114 spm | 1.02 | −46% | **+7% ✅** |
| 120 spm | 1.952 | **−2% ✅** | +95% |

The 64 and 114 captures landed on **opposite sides of an octave split**, which is what made the
signal look flat when the two were compared directly. Same failure mode the strap DSP has, and
`bandAutocorrPeak` already corrects for it there.

**Still gated** (`RING_CADENCE_VALIDATED = false`) — one clean capture is not enough, and an
uncorrected octave error ships a number that is wrong by 2×, which is worse than none. The path
is now concrete: octave-correct the ring the way the strap already is, then re-validate across
counted cadences. `unpack27` column order remains a *possible* contributor but is **no longer
the leading suspect** — a wrong column would not track cadence at all, and here it does.

### [cardio] Cardio trends surface (v1.216.0, 2026-07-27) — only single-week/single-run data exercised; two trend views deferred
`/api/cardio-trends` (5 unit tests for the pure aggregation functions) and the Trends card's three
chart.js views are dev-server + Playwright verified against real local data (the same synthetic
GPS activity inserted for the session-visuals item's verification pass): the zone-stack, efficiency,
and cadence charts all render with correct colours in both light and dark theme, no console
errors. **What is NOT verified:** the seed only produced one week of zone data and one run, so the
zone-stack chart's cross-week rendering (multiple stacked bars side by side) was only confirmed via
chart.js config, not visually with >1 week of non-zero data; on-device Samsung WebView paint, same
caveat as every prior cardio-hub surface. **By design, not a gap:** "distance/pace vs anchor" and
"PR history" trend views are deferred until the baseline-anchor system (backlog item "Density-
progression engine") exists. Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [cardio][devices] 🟡 Ring cadence is octave-ambiguous, not flat — still gated off (2026-07-27)
**Supersedes an earlier, wrong entry** that read "the ring DOES NOT track cadence". A
metronome-referenced capture overturned it: at a set **120 bpm** the ring's capture-scoped
windows were tight at **1.952 Hz → ×60 = 117.1 spm**, against a strap reading of **117.5** —
agreement to **0.4 spm** between two sensors that share no hardware and no code.

The signal is therefore not flat. Fitting all three counted captures against step-rate and
stride-rate (half) shows it locks onto **either**:

| counted | ring Hz | vs step rate | vs stride rate |
|---|---|---|---|
| 64 spm | 0.98 | −8% ✅ | +84% |
| 114 spm | 1.02 | −46% | **+7% ✅** |
| 120 spm | 1.952 | **−2% ✅** | +95% |

The 64 and 114 captures landed on **opposite sides of an octave split**, which is what made the
signal look flat when the two were compared directly. Same failure mode the strap DSP has, and
`bandAutocorrPeak` already corrects for it there.

**Still gated** (`RING_CADENCE_VALIDATED = false`) — one clean capture is not enough, and an
uncorrected octave error ships a number that is wrong by 2×, which is worse than none. The path
is now concrete: octave-correct the ring the way the strap already is, then re-validate across
counted cadences. `unpack27` column order remains a *possible* contributor but is **no longer
the leading suspect** — a wrong column would not track cadence at all, and here it does.

### [cardio] Cardio session visuals (v1.214.0, 2026-07-27) — touch-drag scrub unverified on-device; elevation profile deferred
The hero HR/pace scrub chart, pace-per-km bars + best-efforts callout, zone donut, and dense
splits table are dev-server + Playwright verified against synthetic seed data (a GPS-tracked
activity log + matching HR readings inserted directly into the local Postgres instance for this
pass, since the base seed has zero `activity_logs` rows): the hero chart renders both HR and pace
lines, dragging the pointer across it moves a marker on the route map (confirmed by a Leaflet
marker-count change, 3→4→3, not just the unit tests), the non-GPS fallback (plain HR-only chart)
renders without crashing, and both light and dark theme show visible gridlines/text (the exact
canvas-colour hazard this item's Task 3 fixed elsewhere). **What is NOT verified:** (1) a real
Samsung WebView touch-drag gesture over the hero chart — the `touch-none` class is meant to stop
the drag from scrolling the sheet instead of scrubbing, untested outside desktop Chromium pointer
events; (2) populated real-world data — all verification used synthetic single-session seed rows,
not a real multi-week GPS history. **By design, not a gap:** a full elevation-vs-distance profile
chart is not included — `encodeRoute` drops the per-point `ele` field, so only the aggregate
gain/loss numbers persist; a real profile needs a new stored series + migration + sync-mirroring,
tracked separately as `feat/cardio-elevation-profile`. Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [cardio][devices] Cadence: slow-walk capture found 3 bugs; D-2 now supported at TWO cadences (v1.213.2, 2026-07-27)
Owner capture at 1.5 km/h, counted **64 spm** — the first below the old band floor. Three distinct
defects, all fixed:

1. **AD-2's walk/run bands were gating cadence.** `classifyGait`'s walk band starts at 1.4 Hz
   (~84 spm), so a real 64 spm walk classified **`idle`** and every window of it was discarded.
   Correct for "is this a walk worth detecting", wrong for "what is this cadence". Cadence now gates
   on **motion** (`hasGaitMotion`, new export) plus its own plausibility bounds; the band verdict is
   kept for reporting only. AD-2's bands are untouched.
2. **One octave mis-lock skewed the saved average.** A single window doubled to 140.8 among readings
   clustered at ~64; the **mean** reported 73.6 (+9.6), the **median** 63.8 (−0.2). `summarizeCadence`
   now uses the median — a mean has no defence against a single bad window.
3. **The console judged the capture against 19 minutes of unrelated history.** A drain replays the
   ring's whole backlog, so a 3.4-minute capture arrived with 19 min attached (mostly earlier, faster
   walking). The "locomotor median" reported **140.8 spm for a 64 spm walk** — the wrong walk
   entirely. Now filtered to the capture's own span using the ring's monotonic `ds` clock.

**D-2 (×60) is now supported at two very different cadences**, with errors bracketing zero rather
than sharing a sign — which is what noise around a correct factor looks like:

| truth | capture-period median | ×60 | ×120 |
|---|---|---|---|
| 96 spm | 1.7233 Hz | **103.4 (+7.7%)** | 206.8 |
| 64 spm | 0.9834 Hz | **59.0 (−7.8%)** | 118.0 |

Still short of confirmation (two points, both walking, ±8%). The remaining gap is a **high-cadence
(150+ spm)** capture — untested, and the regime where octave error is most likely.

### [cardio][devices] ⚠️ D-2 NOT closed — ×60 indicated by ONE window; an earlier entry over-claimed it
A 2026-07-27 entry declared the `stride_frequency` units resolved (steps/second, ×60) on the
strength of a single treadmill capture. **That was premature and is retracted.** The next capture
appeared to contradict it, and the reason is instructive:

| capture | truth | reported strideHz | window verdict | ×60 | ×120 |
|---|---|---|---|---|---|
| 2.7 km/h | 96 spm | 1.7233 Hz | **walk** (locomotor) | 103.4 | 206.8 |
| 4.0 km/h | 114 spm | 1.0739 Hz | **idle** — not the walk | 64.4 | 128.9 |

Read naively the second inverts the relationship (higher cadence, lower stride frequency). It does
not: 1.0739 Hz is below `WALK_HZ_MIN` (1.4), so that window is **idle** and describes whatever the
ring was doing then, not the walk. The console only ever showed the *newest* window, and the newest
is frequently a non-walking one — so the 30 locomotor windows that capture actually contained were
invisible.

**So exactly one locomotor window supports ×60.** Suggestive, not conclusive. Closing this needs
several captures at DIFFERENT counted cadences whose *locomotor* windows track the change.
**Fixed:** the calibration console now exports every ring window with its gait verdict
(`ringWindows`) plus the median stride-Hz across locomotor windows only
(`ringLocomotorMedianHz`, with both candidate conversions). AD-2's Hz bands and step_counter trust
remain gated on this.

**Ring accuracy** cannot be characterised until the above is settled — the earlier "~+7% high" figure
also rested on that single window.

### [cardio][devices] Cadence: strap band-pinning bug found on-device (v1.213.1, 2026-07-27)
**Second owner capture exposed a confidently-wrong strap reading.** A real 102 spm walk came back
as **71.4 spm, identical in every bin** — and an unvarying number is the tell, since real gait varies.
Root cause: `CADENCE_MIN_HZ` was 1.2 Hz = **72 spm**, sitting *above* the 60 spm `MIN_PLAUSIBLE_SPM`
floor, so any cadence below 72 was unreachable by the search and the autocorrelation argmax pinned to
the band edge — which was then reported as a measurement. Fixed two ways: the band now lies strictly
outside the plausibility bounds at both ends (0.9–3.9 Hz), so a reading is rejected for being
implausible *for a person* rather than for falling outside where we happened to look; and
`bandAutocorrPeak` now **rejects an argmax sitting on a band edge outright**. Regression-tested.

**The first capture passing (99.4 vs 102) did not catch this** — that walk was fast enough to sit
inside the band.

**Third capture (same session, fixed 2.7 km/h treadmill, 96 spm truth) is the good one:** strap mean
**99.6 (+3.6)**, final 96.6 (+0.6), 160 readings over 172 s, and the series now *varies* (96.2–103.1)
instead of pinning — measurement behaviour, not an artifact. Ring and strap differed by 6.8 spm,
inside the 8 spm agreement threshold, so the two independent derivations cross-validate. Both read
slightly high, which may be a shared bias or a slightly-low manual step count; more captures needed.
**Still unproven: running pace** (where octave error is most likely) and battery cost over a full
session.

**Ring: still no usable window, and my instrumentation hid why.** `ringWindowCount: 0` alongside a
non-null `ringStrideHz` was contradictory: the counter was incremented *after* the idle branch, so it
counted locomotor windows rather than windows delivered — collapsing "the ring sent nothing" and
"sent windows, none locomotor" into an identical 0, which is exactly the distinction it exists to
make. Now counted before the branch, with a separate locomotor count and the classifier's verdict
surfaced. The observed 1.127 Hz matched neither ×60 (67.6) nor ×120 (135.3) against a 102 spm truth —
but every window was `idle`, so it was not from the walk. **D-2 (the `stride_frequency` units
question) remains OPEN.**

**Diagnostic gap closed:** captures now export the **raw accelerometer magnitudes** plus per-reading
rhythm confidence, so a wrong reading can be replayed against the DSP offline. The 71.4 pinning was
only diagnosable because the number happened to equal the band floor exactly — that is luck, not a
strategy.

### [devices][body] Direct-BLE Renpho scale integration (v1.228.0, 2026-07-27) — ✅ device-verified 2026-07-28
Plan: `docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md`. Server-side (migration 157
— 145, 153 and 155 were already taken by other PRs on `main` by the time this merged; `/api/scale-ble/*`
routes, the BIA composition formula, local-SQLite/sync mirroring) is fully sandbox-verified —
smoke-tested end-to-end against the local dev DB with `curl` using the real byte values captured
from the owner's actual scale: confirmed writes land correctly in `body_metrics` with per-field
`source_map='scale_ble'`, the >15% weight-anomaly gate correctly stages a reading as `pending`
without touching `body_metrics`, and both `dismiss` (archives, never writes) and `confirm`
(retroactively computes composition + writes) work. **Device-verified 2026-07-28:** the owner
rebuilt the APK, paired the scale, and confirmed a real weigh-in with background sync on landed
correctly end-to-end — `ScaleGattClient`'s GATT connect/handshake/decode, `ScaleBleService`'s
foreground-service reconnect loop, and the ongoing "Watching for scale…" notification all worked
on-device as designed. **Bug found in that same session (v1.231.5 fix):** weighing in with socks
on broke foot-plate contact, and the scale reported impedance as 0 rather than omitting the
packet — dividing by that zero floored the body-fat estimate at its 3% clamp along with every
other composition field, while the weight itself (a load-cell reading, contact-independent) was
correct. Fixed: `hasValidImpedance()`/`MIN_VALID_IMPEDANCE_OHMS` (`lib/scale-ble/composition.ts`)
now rejects a no-contact reading before the formula runs — weight still saves, composition is
skipped rather than clobbered with a wrong number, and the native service fires a one-shot
low-priority notification explaining why. **Still open:** the household's two-phone scenario
(both partners running background sync against the same physical scale) hasn't been exercised —
expected an occasional missed reading on whichever phone loses the BLE connection race, not a
data-integrity issue, per the plan's Risks section. **Also open (design question, not yet
decided):** the background-sync foreground service polls every 45s and keeps its ongoing
notification visible the entire time it's on, for a scale that's actually used ~10s/day — a
PendingIntent-based passive BLE scan (no persistent notification, lower battery, wakes only when
the scale actually advertises) would fit the usage pattern better but is a real rework of the
connection strategy, raised 2026-07-28, not yet scheduled.

### [cardio] Cardio session picker (v1.213.0, 2026-07-27) — recommendation heuristic unvalidated against real usage; no cross-modality gate by design
`recommendSession()` (7 unit tests) and the time-picker sheet are dev-server + Playwright
verified: the sheet opens, all three options render and stay tappable regardless of the
recommendation, and the walk recommendation correctly identifies the biggest-remaining
**training** zone (Z1 excluded, matching D-10). **What is NOT verified:** (1) the seed has no
active running plan, so the `run` branch of the recommendation (a pending prescription fitting
the time budget, plus the softened-gate note) has never been exercised against a real plan —
only the walk/activity branches were observed live; (2) the heuristic itself ("recommend the
zone with the most remaining minutes") is a first cut, not validated against what actually feels
like a good suggestion over real usage — expect it to want tuning once the owner has used it a
few times; (3) on-device paint/safe-area of the new sheet, same caveat as Phase 1 below (desktop
Chromium, not the canonical S25 WebView). **By design, not a gap:** walk and Other activity never
carry a recovery-gate note — `recovery-gate.ts` has no modality-agnostic equivalent, and building
one was explicitly scoped out of this item (see the plan). Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [cardio] Cardiovascular hub Phase 1 (v1.212.0, 2026-07-27) — NOT verified on device / on real zone data · needs: data
New `/cardio` screen + `GET /api/cardio-week` + the workout-select IA split. The quota logic
(`computeZoneQuota`, 7 tests) and the route are dev-server verified — 200 with all 5 zones, Z5
correctly `not-required` for the seed's `zone2-base` framework — and a real Chromium render
(Playwright) confirmed the zone-bar fill actually scales with percentage, not just renders at
0%. **What is NOT verified:** (1) the local seed has no `oura_heartrate` rows, so every zone
shows `doneMin: 0` — a genuinely non-zero quota from real ring/strap wear has not been observed;
(2) Samsung WebView paint of the zone bars and safe-area clearance on the new screen (the
sandbox render is a real desktop Chromium, not the canonical APK WebView); (3) the plan-driven
quota-size path — the seed user has no active running plan, so the quota always falls back to
the framework default rather than a plan's personalised `weeklyBaseMinutes`. Device smoke: open
`/cardio` on the S25 after a day of ring/strap wear and with a real running plan set up; confirm
non-zero zone minutes, the bars render and clear the status/gesture bars, and the quota total
reflects the plan's actual volume rather than the 150-min floor. Entry:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).
### [readiness] 🔴 Nightly temperature treats one frame's simultaneous probes as consecutive samples (found 2026-07-27, OPEN)
Same audit; **description rewritten twice** — first after re-verifying against full production
history, then again after the `open_oura` source answered the protocol questions. `open_oura` decodes
`0x46`/`0x69`/`0x75` with one shared decoder as a **flat probe vector** of centi-°C, so the repo's
`decodeTemperatures` is already correct and the earlier "three interleaved channels" framing was
wrong. The defect is entirely in the rollup: a frame's probes are **simultaneous**, but
`adapter.ts:4861-4869` stamps every value with the frame's single `ds` and feeds them to
`nightlyTemperatureCentiC`, a *temporal* median-7 pipeline — 631 frames become 2,398 "samples" on 631
real timestamps. Running the shipped path over one real night reproduces production's stored
**36.00 °C** exactly. Collapsing each frame to one value does **not** fix it (per-frame median →
37.00 °C): `0x46` frames hold three values with the middle on an exact 0.5 °C grid in 98.3% of 30,135
rows, so the median *is* the quantised probe. Of the 21 nights with a value, **19 are exact whole
degrees**, range 34.00–37.00 °C, σ = 0.743 °C, and the baseline's own spread converges to **2.63 °C**
— leaving the illness radar's `tempZ` and readiness's `bodyTemperature` contributor with no
discriminative power. Queued as backlog Q-2; preferred remedy (use `0x75` alone) is justified
empirically. One question stays open and needs the **Oura app binary**: which stream
`nightly_temperature_calculate` actually consumes.

### [sleep][devices] 🟠 Sleep/HRV/breathing metrics changed scale at the BLE re-key with no conversion (found 2026-07-27, OPEN)
Same audit. Four `sleep_sessions` columns shifted regime on 2026-07-07/08 while keeping the same
column and the same scoring curves: ~~`restless_periods` **230.6 → 2.5**~~ (**Q-3 fixed in v1.223.0**
— see below), `respiratory_rate` **13.11 → 9.32 rpm** (written from an estimator its own docs call
"not calibrated, display/debug only"), `average_hrv_ms` **27.5 → 49.0**, `lowest_heart_rate`
**65.1 → 56.7**. These have **non-overlapping** ranges. No baseline, trend or z-score may span
2026-07-07 without a documented conversion. Still queued as backlog Q-4.

### [sleep] ✅ `restless_periods` was two quantities in one column — now unscored (v1.223.0, 2026-07-27) — NOT verified on device · needs: browser
Q-3. The column holds Oura's restlessness measure on Cloud nights (**138–330**) and `model.awakenings`
on BLE nights (**0–5**); one curve, topping out at 50, was applied to both. Measured over the full
history: **every Cloud night clamped to the maximum 32-point penalty** while BLE nights drew ≤2.5, so
restfulness read **48.6 vs 86.3** across the eras — a 37.7-point gap that was purely units, depressing
every pre-cutover score by ~2.6 points. The term is **dropped rather than re-scaled**: a count of
movement periods and a count of wake events are different quantities, so any conversion would be
invented. `efficiency` and the awake fraction are unit-stable and carry the signal. Useful discovery:
the era is already recorded per-field in `sleep_sessions.source_map`, so no new column was needed.
Remainders (a calibrated awakenings penalty; the chronic-stress consumer, whose score is populated on
**0 of 70 rows**) queued as **Q-3b**. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [sleep] ✅ Sleep Score gained an autonomic axis (v1.215.0, 2026-07-27) — NOT verified on device · needs: browser
Owner-directed, from the case study of the night of 2026-07-25
([`docs/reviews/2026-07-27-night-2026-07-25-case-study.md`](docs/reviews/2026-07-27-night-2026-07-25-case-study.md)).
That night was rated **5/5 "Terrible"** and scored **80**: normal on every contributor the model had,
abnormal only in autonomic state (HRV −2.76 σ, overnight HR +10 bpm) and a 2 h-early wake. Shipped:
one shared baseline derivation every caller uses (four of six previously passed none, so the same
night scored 82 on some surfaces and 80 on others), a new `hr` contributor, a directional `schedule`
contributor (only a late bedtime or early wake is penalised), and rebalanced weights putting
autonomic state at 28 of 110 rather than 12 of 100. **That night now scores 71 — 2nd lowest of 20 and
5 clear of the 3rd — where it used to sit 5th and indistinguishable from ordinary nights.** The top
of the range is unmoved (best night still 98) and a perfect night still reaches 100, pinned by a test.
**What is NOT verified:** the sleep-detail contributor chart gains two bars and has not been seen on
the S25; only a dev-server run against a seeded local Postgres was possible. **Historical scores
change meaning** — any night with a mature baseline now scores differently than when it was
persisted. Both remainders have now shipped — Q-16 in v1.220.0 and Q-17 in v1.221.0 (both below).

### [readiness] ✅ Body Battery: an evening nap was throwing away the whole day (v1.221.0, 2026-07-27) — NOT verified on device · needs: hardware
Q-17, and **the finding was filed with the wrong cause**. It read as *"consumes nothing on a
**ring-only** day"*; nothing in the route filters on `source`. The real cause is the **F-1
nap-vs-night bug in a fifth place** — the wake anchor was `sleepSessions` sorted by `sleepEnd`
descending, first element. On 2026-07-26 production holds two rows: the night ending **05:54** and a
45-minute evening nap ending **18:09**. The nap won, and since the walk keeps only HR at or after
`wakeTime`, the whole day was discarded: **164 ring samples sat unused**, and the 18:09→19:39 window
held exactly the **0** that was stored. Ring-only days merely showed it, because a strap day's ~1,500
workout samples happened to land after the nap. Fixed by using the shared night selection scoped to
today, plus a fallback when the recorded wake is in the future, and the response now reports the
anchor the curve actually used rather than re-deriving it. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).
⚠️ Server-side only, but the card has not been re-checked on the S25.

### [sleep] ✅ Sleep Score vs how it actually felt — a calibration view (v1.220.0, 2026-07-27) — NOT verified on device · needs: browser
Owner decision on Q-16: `sleep_quality_feel` stays **out** of the score and becomes something to look
back on when tuning. `GET /api/admin/sleep-feel-calibration` + a card atop Admin → Day Review pair
each night's model score with the next morning's rating and report rank agreement, the range each
side uses, mean score per rating, and the worst disagreements; the single-day audit gained
`context.morningCheckin` so one day reads "scored 91 · you said Terrible" in place. Comparisons are
**rank-based on purpose** — the rating spans 1–5 while the model's real range is 81–98, so a raw
difference would be meaningless. Against production (24 rated mornings) it says **Spearman +0.42**,
and surfaces three concrete targets: the model uses 15 points where the owner uses the whole scale,
"Good" nights average *higher* (92.5) than "Great" ones (91.0), and 2026-07-21 was rated **Poor**
while scoring **92**. Nothing here changes a score. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).
⚠️ Admin-only surface, not seen on the S25.

### [workouts] ✅ AI no longer quotes bodyweight 1RMs in kilograms (v1.224.0, 2026-07-27) — NOT verified on device · needs: browser
Q-19. `app/api/ai-chat/route.ts` tells the model *"Quote them exactly — NEVER recompute a 1RM"*, so a
Pull-Up read back to the user as "118 kg" — the exact misreading Q-12 removed from the UI. Every
surface whose text reaches the **user** is fixed: the ai-chat context and its two 1RM-bearing tools,
the prescription card's rationale bullets (`exerciseType` threaded through following the existing
`equipmentById` pattern), both digests' PR lines (via a new shared `describePersonalRecord`), and a
guard on the kg achievement milestones — `prFor` matches by **substring**, so a bodyweight "Pistol
Squat" would have unlocked Century Squat at its `BW_REF` value. Proven end-to-end on `pnpm dev`:
*"what is my pull-up PR?"* → **"6 reps (bodyweight)"**, while bench still answers "98kg". Three
model-input-only builders remain (never quoted at the user) — queued as **Q-19b**. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [workouts] ✅ Bodyweight sets no longer count as zero volume (v1.227.0, 2026-07-27) — NOT verified on device · needs: browser
Q-13. The same sets were priced at `BW_REF + added` for the 1RM and intensity but at the **raw**
weight for volume, three lines apart, so 208 real reps (19 Pull-Up / 93 reps, 13 Hanging Leg Raise /
115 reps) read as 82–88% intensity and zero work done — missing from `user_stats`,
`computeVolumeAcwr` (which gates early deload), weekly volume and the prescription engine's volume
budget. Owner decision: price a rep at **real body weight × a per-exercise fraction** (Dempster/Winter
segmental masses — Pull-Up 1.00, Hanging Leg Raise 0.32), deliberately *not* `BW_REF`, which would
have added 20,800 kg and made pull-ups a top-3 volume contributor instead of the **8,856 kg** (~3.5%)
this adds. Isometrics stay unpriced on purpose — their "reps" are seconds. Migration 152 backfills the
13 historical logs. ⚠️ **This deliberately breaks an invariant the first audit verified:**
`exercise_logs.volume` no longer equals Σ(`set_logs.weight_kg` × reps) on bodyweight rows, because the
set records the *bar* and volume records work *done* — any future check must exempt bodyweight rather
than "correct" it back. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [workouts] ✅ Bodyweight sets no longer record a prescription they were never given (v1.227.3, 2026-07-27) — NOT verified on device · needs: browser
Q-14. `planned_pct` stored the progression style's nominal percentage while `intensity_pct` is
BW_REF-relative, and for a bodyweight movement that percentage is never a load target —
`resolveBodyweightStyle` turns it into a **rep** target. So every bodyweight set recorded a phantom
14–18 pp overshoot (Pull-Up planned 75.0 / actual 88.5; Hanging Leg Raise 68.0 / 83.9 ×3); all eight
≥2 pp deviations in production were this, while weighted exercises deviate by ≤2.3 pp of real
autoregulation. Owner decision: NULL `planned_pct` where no %1RM was prescribed and record the
prescribed rep target instead — `planned_reps` is written for **every** exercise type, not just
bodyweight. Migration 153 adds the column to `set_logs`/`set_hr_stats` and clears the 6 historical
rows; `planned_reps` is left NULL on them rather than reconstructed from a 1RM that has since moved.
`sync-helpers` now replays the *prescribed* reps, not the performed ones. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [workouts] 🔴 `personal_records` is not the all-time best, and "starting weights" never reach the bar (found 2026-07-27, **enlarged 2026-07-28**, OPEN)
Same audit. `POST /api/personal-records/seed` uses the unconditional upsert (no `IfBetter` gate, no
validation, `achievedAt = now`), bypassing the correct paths; its only caller is the workout-builder
review screen, so reviewing a program rewrites PRs. **5 of 36 rows disagree with the best surviving
log** — Barbell Bench Press shows **90.8 kg against a real 96.0**, Barbell Front Squat **67.5 against
73.8**, and four PR values appear in no exercise log at all. Separately, PRs are keyed on exercise
*name*, so five near-duplicate spellings split one exercise's best into two rows.

**Tracing the seeded value on 2026-07-28 found worse.** (a) The builder's *"Enter your 1RM for each
main lift to pre-seed working weights"* **does not do that**: `session-data.ts:226` reads
`lastLog?.estimated1rm ?? null` and never consults the PR map, so with no prior log
`computeInitialWeights` falls through every branch to a hardcoded **`return 60`** — 60 kg on the bar
for any new weighted lift, whatever you typed. (b) **Two weight paths disagree**:
`/api/next-session/prescription` uses `max(lastLog, PR)` and shows real kg on the done-screen "next
workout" card, while the workout screen uses the last log alone — so the preview and the session it
previews can show different weights. (c) Deleting the seed route (the literal form of the owner's
"derive from logs only" decision) would break `ai-periodization/baseline/complete`, which 400s with
`no_prior_data` when no PR exists, making "skip the AMRAP baseline" unreachable for a new user.

Decision stands — PRs derived from logs only — but delivered by giving the user-entered starting 1RM
its **own** store, plus one shared basis resolver used by both weight paths (which kills the magic
60). Queued as backlog Q-5, **plan-first**.

### [devices] ⏳ Ring clock anchors are now append-only observations (2026-07-29) — phase 1 of 2, inert
`oura_ble_clock_anchors` held **exactly one row**, created at the 2026-07-07 re-key and mutated
forward on every ingest, applied to **every `ds` in the database**. It doesn't stretch time
(ring-vs-ring intervals were always fine) but it **offsets every ring timestamp by that one row's
lag** — hours, by the redecode route's own notes. Hence Q-23 §1 (ring rows interleaved with
chest-strap wall clock), sliding day boundaries under the steps rollup's one-way max-merge, and
Q-22 §2: a ring clock **reset was silently fatal**, since the forward-only update meant post-reset
frames mapped weeks into the past and fell below the rollup cutoff, contributing zero forever.
**Landed:** migration 161 (`epoch`/`observed_source` on anchors, `epoch` on `oura_raw_samples`),
`lib/oura-ble/clock.ts` (`resolveDsToMs` — nearest observation, interpolating, epoch-isolated,
`null` rather than a guess), and append-only ingest with reset detection.
⚠️ **No timestamp has changed yet — every read still uses the single newest anchor.** Phase 1 only
starts *recording* the observations phase 2 needs. **Phase 2 (queued, Q-23)** switches the ~11 read
sites to `resolveDsToMs`; it wants a few days of accumulated observations first so the improvement is
measurable rather than assumed, and is deliberately kept apart from the step backfill. Plan:
[`plans/2026-07-29-ring-clock-anchor-epochs.md`](docs/superpowers/plans/2026-07-29-ring-clock-anchor-epochs.md).
Journal: [`docs/overview/history-2026-07-28.md`](docs/overview/history-2026-07-28.md).

### [activity] 🟠 Step backfill preview computed; three days materially inflated (2026-07-28, OPEN)
Recomputed all 20 ring-era days: stored **106,902** → recomputed **104,458** (net **−2,444**). Most
days barely move; **07-24 −1,719**, **07-27 −1,059**, **07-28 −3,326**; two rise (07-12 +2,696,
07-13 +1,327). ⚠️ **Indicative only** — it buckets by `measured_at` while the rollup buckets by
`dayForDs` via the mutable clock anchor, which has moved since; the two rising days are the likely
artefacts. Run `/api/oura-ble/samples/step-backfill-preview` (rollup's own bucketing) before any
destructive backfill — and note Q-22 §3: that preview is a hand-copied duplicate of the rollup block
and should be collapsed into one function first.

### [activity] 🟠 Three days hold inflated step totals that cannot self-correct (found 2026-07-28, OPEN)
The v1.228.5 guard stops new inflation but the rollup's max-merge (`> existingSteps`) means a stored
day can only ever rise. Verified against production by re-running the guarded merge over each day's
real frames: **2026-07-24 7,691 → 5,972**, **2026-07-27 6,981 → 5,922**, **2026-07-28 4,903 →
1,578** (−6,103 total). Correcting them is destructive and already has an owner-gated lever
(`?allowStepsDecrease=1` on the redecode route, with a read-only preview at
`/api/oura-ble/samples/step-backfill-preview`) — awaiting an explicit decision. Note the wider
ring-era history is also suspect: phone-sourced days (to 07-08) averaged ~2,300/day against ~5,300
for ring-sourced days, and the retired flat-30 estimate that produced 2026-07-09→22 is documented
in-code as over-counting.

### [activity] ✅ The Activity Score is persisted (v1.228.4, 2026-07-28) — NOT verified on device · needs: browser
Q-7. It was computed on every `/api/readiness-score` call and then discarded, while
`/api/health/trends` fell back to `oura_daily.activity_score` — NULL every day since the 2026-07-07
re-key, because the Cloud stopped scoring. Activity Score v2 (v1.207.0) therefore shipped with
**0 of 20 days** of trend. Now written as a third compute-and-persist block beside the existing
readiness and sleep ones: today's date key, only the `activity_*` columns (never the shared
`source`/`model_versions`, which the upsert replaces wholesale), best-effort so a persist failure
never fails the read. `oura_daily_derived.activity_score` is a COALESCE column, so the on-device
rollup's eventual push fills or overwrites the same field without conflict — persisting now costs no
future device work.

### [devices][readiness] 🟡 Eight device-owned `oura_daily_derived` columns have no producer (found 2026-07-27, **re-diagnosed 2026-07-28**, OPEN)
Same audit. The finding said the device "has never pushed" these. Tracing the chain found the
opposite: **nothing on the device could push them.** There are **zero** `queueMutation` call sites
for `oura_daily_derived`/`oura_daily_summary` anywhere; the local table's only live writer is
`applyDelta`, which hardcodes `sync_status='synced'` and so can never create an outbox row; and
`lib/oura-ble/rollup/` **does not exist** — `lib/sqlite/migrations.ts:1030` says so outright
(*"the rollup that writes them isn't built yet"*). The push loop and server branch are correct and
need no change. `worn_hours_ble`, `active_calories_est` and `pwv` are written *only* inside the
device-push branch, so they are unreachable by construction. This is Phase-1 Task 5/6 + Phase-2 Task
A2 — planned and entry-gate-cleared, not started. Queued as backlog **Q-7b**, which exists mainly to
stop a future session "fixing" a sync layer that is already correct. Related: `/api/oura/sync` still
writes a daily `oura_daily` row containing nothing but `non_wear_time_sec`, so "Oura sync succeeded"
is a false-positive health signal.

### [heart-rate][workouts] 🟡 Only ~20% of logged sets have usable HR (found 2026-07-27, measurement only)
Same audit. Of 550 `set_hr_stats` rows, **436 (79%) have `coverage_ok = false`** and **370 (67%) have
a NULL `peak_bpm`**, so v1.197.0's "Heart & Recovery" card trends over roughly one set in five;
`workout_hr_stats` holds 0 rows. Likely cause (strap disconnection / ring power-gating during
lifting) leaves no trace in Postgres — **this needs the device smoke checklist, not more SQL.** Queued
as backlog Q-11.

### [sleep] ⚠️ Only 12 of 57 nights have a persisted derived score — tooling shipped, **not yet run on prod** (v1.222.0, 2026-07-27)
`oura_daily_derived` scores are written as a side effect of loading `/api/readiness-score`, which only
ever persists *today*, so historical nights are unscored and calibration work over that table reads a
~21% sample. F-2 shipped the fix: `POST /api/admin/backfill-derived-scores?from=&to=&dryRun=`
recomputes through `buildDayAudit` and persists **exactly** what the live route would write (via a new
shared `PillarAudit.persist` field, so the two can't drift — including the subtlety that the stored
readiness is the composite *before* illness suppression, not the displayed score). Dry-run by default,
31 days/call, sequential, idempotent. **The remaining work is operational:** nobody has paged through
production with `dryRun=false` yet, so coverage is still 21%. Journal:
[`docs/overview/history-2026-07-23.md`](docs/overview/history-2026-07-23.md).

### [platform] ⏰ Claude read-only prod-DB access is approved FOR BETA ONLY — revisit on beta exit (2026-07-26)
Owner approved standing read-only production-DB access for Claude sessions for the duration of beta
(*"until we move out of the 'beta' phase and know everything is wired up correctly"*), accepting the
§9 risk that a leaked `CLAUDE_DB_QUERY_SECRET` exposes the full health history. Plan:
[`docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md`](docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md).
**This row exists so a temporary decision cannot decay into a permanent one by default.** On beta exit
— first non-owner user with real data, or the owner declaring beta over — either unset
`CLAUDE_DB_QUERY_SECRET` in Railway, or consciously re-approve after re-reading §9. If re-approved,
decision 8.1 (views unscoped across all users) must be revisited: it is defensible only while this is
a single-user app, and stops being so the moment a second user has data. Emergency stop at any time:
`REVOKE ALL ON SCHEMA claude_ro FROM claude_readonly;` (immediate, no deploy).

### [cardio][devices] Cadence: strap CONFIRMED on-device; ring path blocked by the hourly drain (v1.211.2, 2026-07-27)
**First real treadmill capture (owner, 102 spm counted ground truth) — strap PASSES, ring produced
nothing.**

**Strap ✅ validated on real hardware.** `frameType: 0x01` — the H10 emits **raw** PMD frames, not
delta. That was the genuinely disputed part of the protocol (sources disagree; both conventions
were made to decode and the observed type surfaced rather than guessed), and it is now settled.
50 Hz granted as requested. Accuracy vs 102 spm: first 10 s bin **103.1 (+1.1)**, mean 99.4 (−2.6),
final 98.5. Inside the ±3–5 spm bar. The mean reads low because the capture ran 33.5 s while the
counted 51 steps spanned ~30 s — the start/stop edges drag it down. **Still unproven: running pace**
(where octave error is most likely) and battery cost over a full session. n=1, walking only.

**Ring ❌ no data — my design error, now fixed.** `ringStrideHz: null`. Two causes:
(1) one gait window needs a *pair* of 0x7e/0x7f frames spanning ~30 s, so a 33 s capture yields at
most one; (2) decisively, `OuraRingService.kt` drains ring history **hourly**
(`DRAIN_INTERVAL_MS = 3_600_000`) and gait frames largely reach JS with that drain. A short capture
therefore *cannot* produce ring cadence. The console now shows a gait-window count and a **Sync
ring** button (`drainHistory`, an existing plugin method — JS only, no APK rebuild) so the ring is
testable on demand. **The `stride_frequency` units question (D-2) remains OPEN** — the capture that
answers it has not yet been taken.

**Bug found while root-causing that, fixed in v1.211.1:** `cadence-tracker.ts` stamped every ring
window with `Date.now()`, so an hourly drain's burst — an hour of history arriving at once — looked
like ~120 live readings, jittering the display and flooding the saved activity average. Now
deduped on the ring's own `ds` and rate-limited to one recorded reading per ~25 s, with later
(newer) windows in a burst *superseding* the earlier ones rather than the first-arriving (oldest,
hour-stale) window being the one kept. Regression-tested (`cadence-tracker.test.ts`).

### [cardio] Cadence metric (v1.211.0, 2026-07-27) — strap now confirmed (above); other surfaces still device-gated
Everything that actually produces a cadence number is BLE-bound and inert in the sandbox. **The
strap path is Kotlin and requires a rebuilt APK** — CI publishes one to the rolling `apk-latest`
release on merge (`/releases/download/apk-latest/app-debug.apk`), so no local Gradle build is
needed. Sandbox-verified: full gate green (2035 tests, tsc, lint, check-reconcile,
check-push-mutations), migration 140 applied, a dev-server `POST /api/activity-logs` with cadence
round-tripping through Postgres to `GET`, an implausible value rejected 400, and a Playwright pass
at 412×915 confirming the detail sheet paints "CADENCE · 168 spm avg · strap" with its sparkline
and the admin console renders both unit interpretations.
**Unproven until the treadmill run:** (1) whether the H10 delivers a PMD stream at all and in which
frame encoding — both conventions decode and the observed frame type is surfaced in the console,
because a silent zero looks identical to standing still; (2) real accuracy vs the treadmill for
either source; (3) **the ring's `stride_frequency` units (the open D-2 question)** — the conversion
is deliberately left as one of two principled values (×60 steps/s or ×120 strides/s) with both
rendered against ground truth, rather than guessed; (4) battery cost of a sustained 50 Hz stream
over a full run, and that HR streaming is unaffected; (5) safe-area / Samsung-WebView rendering of
the new readouts. Owner action: **Admin → Tools → Cadence calibration**, walk a known cadence on
the treadmill, and check which stride interpretation matches — that single capture also unblocks
the AD-2 Hz bands and step-counter trust, which depend on the same answer.

### [heart-rate][devices] D6 comparison harness (v1.212.1, 2026-07-27) — NOT device-verified; ±5bpm band unvalidated · needs: data
The admin route/console/DB path were exercised end-to-end against local Postgres (401 anon, 200 +
real bucketed comparison for an admin), and the pure merge/scoring function plus the minute-bucketing
helper are unit-tested. **What has NOT happened:** a real H10 spot-check — wearing both the ring and
the strap simultaneously for ~15 min and running the console against that window. Per the plan's own
gate, that run is the point of D6, not a formality: it's the first real signal on whether the ring's
own HR is trustworthy, and the ±5bpm tolerance band is a first guess to be tuned from that data, not
a validated threshold. Owner action: **Admin → Oura BLE → Comparison harness**, wear both devices for
a short burst, run it, and confirm the two sources roughly agree (or don't — either result is useful
data for D5, which is gated on this).

### [cardio][platform] `localToActivityLog` drops display fields for unsynced activities (found 2026-07-27, pre-existing)
`components/health/activity-history-card.tsx` has a second, hand-written row mapper that silently
drops fields. Cadence was added to it in v1.211.0, but it **still drops** `routePolyline`, `splits`,
`bestEfforts`, `paceSeries`, `avgPaceSecPerKm`, `elevationGainM/LossM` and `notes` — so a *pending*
(offline/unsynced) activity opened from that card shows a detail sheet missing its route, splits and
elevation until the server copy lands. Exactly the "update every row→object mapper" class in
CLAUDE.md. Not fixed in v1.211.0 because it is pre-existing and outside that change's scope; low
severity (transient, resolves on sync).

### [readiness] Readiness composite is persisted under the wrong day (found 2026-07-26 by Admin → Day Review) — OPEN, not yet fixed
The new Day Review tool's drift flag fired on its first real run: **stored 36 vs recompute 40** for
the same date. Root cause is pre-existing, in `app/api/readiness-score/route.ts`: the compute-and-persist
block writes the composite to `oura_daily_derived` keyed on **`latestSummary.date`** — the most recent
night that has an `oura_daily_summary` row, which is not necessarily today. So *today's* check-in,
today's activity score and today's illness inputs get persisted into a row **labelled with an earlier
date**, and any later read of that row (analysis, trends, the audit's `stored` comparison) attributes
them to the wrong day. The sleep-score persist immediately below it already does the right thing —
it keys on `lastSleep.date`, the actual wake day of the scored night.
**Deliberately not fixed in v1.210.0** — the correct key is a real behavioural decision (is that row
"the day the signals are about" or "the night the baselines came from"?), and changing it rewrites how
existing `oura_daily_derived.readiness_*` rows are interpreted. Needs an owner call before a fix, plus a
decision on whether historical rows get corrected. Reproduce: Admin → Day Review, pick a day whose
summary row is older than today, look for the amber "differs from this recompute" line.

### [platform] Admin → Day Review (v1.210.0, 2026-07-26) — NOT verified on device or against real ring data · needs: data
Admin-only, read-only, no offline-first domain, no native plugin, no new safe-area surface (it renders
inside the existing `/admin` shell). Verified in-sandbox: full gate green, dev-server exercised
end-to-end (200 on both date separators, 400 on an invalid calendar date, 401 unauthenticated),
contributions proven to sum to the score each model reports, and a Playwright pass at the 412×915 S25
viewport (tab renders, date stepper navigates, pillars expand, no console errors).
**Two things the sandbox can't prove:** (1) the local seed has **no `oura_daily_summary` or
`oura_heartrate` rows**, so the readiness composite and the zone-minutes/move-hours paths were exercised
by inserting synthetic summary rows and deleting them afterwards — the Activity zone-minutes and
move-hours contributors have never run on real data here; (2) whether the numbers are **sane against the
owner's real history**, which is the entire purpose of the tool. First device action: open Admin → Day
Review on a day that felt clearly wrong and check the contributor breakdown against how the day actually
felt. Known fidelity limit (surfaced in the payload, not hidden): sub-scores are exposed rounded, so a
rebuilt `contributionSum` can sit up to a point off the score — each pillar says so inline.

### [cardio] Guided walk uplifts (v1.208.1, 2026-07-23) — hardware back-button guard NOT device-verified · needs: android

The new confirm-exit dialog's hardware/gesture back-button path (`mobile-auth-handler.tsx`,
mirrors the existing workout-screen guard) can only be exercised on the APK — the web sandbox
has no Capacitor `App.addListener('backButton', ...)`. The in-screen "End walk" button and the
bottom-nav tab-away guard were both verified working via a live dev-server Playwright pass.

### [cardio][devices] AD-2 ring-cadence walk/run detection (v1.208.0, 2026-07-23) — Hz bands provisional, NOT device-verified · needs: data

The whole confirmation path (`classifyGait`/`gait-confirm`) is BLE-gated and inert in the sandbox
by design (no ring). Two things need an owner APK rebuild + on-device pass before this can be
called fully trusted: (1) the walk/run Hz bands are physiological-prior estimates, not calibrated
against a real captured walk/run/lifting session (the shared D-2 units question); (2) the
probe-phase backdating (route not clipped to the ~90s-later confirm instant) needs a real walk to
confirm. Run `docs/device-smoke-checklist.md`: a garage lifting session must never confirm; a
real walk must confirm within ~90s with the correct backdated start/route; a run must classify
as run; removing the ring mid-walk must fall back to the GPS/AD-1 path without crashing.

### [app-shell][activity] Core score-cards + Activity overhaul (v1.204.0 → v1.209.0, four rounds, 2026-07-23/26) — NOT verified on device / real ring data · needs: data
Home cards redesigned (W-A), sleep recalibrated + overnight HRV (W-C), readiness recalibrated + check-in
(W-D), and Activity Score v2 (W-B) — **all four workstreams now fully shipped** across four rounds, each
after live owner review of screenshots/mockups.

**Round 4 (v1.209.0, visual only — no scoring change):** the round-3 fixed-accent-tick ring was replaced
after another two mockup rounds. Landed on four options, offered as a real **user-selectable
preference** ("Score Card Style" in More → Home Widgets, `lib/home/home-prefs.ts`) — the owner's own
idea mid-review, rendered as a **vertical list with a checkmark** (the owner asked for a list once a
third option made the original 2-button toggle too cramped): **Default** (plain closed circle),
**Open ring**, **Perforated ring** — each with the coloured accent moved from the ring onto each card's
**icon** (readiness blue, HR red, sleep purple, activity orange) and the dot removed, circles sized up
(114px default/open-ring, 94px perforated — perforated keeps its own tuned size since it needs denser
dots at a smaller diameter to read as texture; the two plain-stroke styles share the larger size) — plus
**Accent ring**, added in a follow-up clarification to keep the round-3 fixed-accent-tick design
(white icon + coloured dot + coloured arc, 80px) selectable rather than discarded outright. For the
three newer styles, **home-row state (good/moderate/low) is no longer shown visually at all** now that
both the arc and the dot are gone — carried only in the `aria-label` and via the number/detail-screen
tap-through; this tradeoff was flagged to the owner during the mockup rounds and accepted (Accent ring
keeps its original dot).

**Round 5 (same PR, v1.209.0):** asked to brainstorm further, six new frame concepts were mocked up
(gradient sweep, plate-rim dashes, double hairline, soft halo, compass ticks, no frame) — the owner
rejected five outright and rated **Halo** only "average," but chose to add it as a fifth selectable
style anyway rather than keep guessing blind. Halo drops the stroke entirely for a soft blurred glow
(CSS `radial-gradient` + blur, not an SVG frame) in the card's identity colour behind the icon/number,
sharing the 114px size. Sandbox-verified: `tsc` clean, full suite 1952 passing, Playwright screenshots +
DOM-structure checks confirmed all **five** ring styles render at their correct sizes/content model and
the settings list switches between them correctly (both via a direct localStorage flip and via a real
click on a list row, confirmed the stored preference updates).

**Round 3 (v1.207.0):** the round-2 progress-fill ring ("still not what I am after — a progress bar
doesn't work for HR") was replaced after two mockup rounds (13 concepts total, shown to the owner before
any code) with **"M — fixed accent tick"**: a thin white ring + one fixed-position, fixed-length arc in
each card's own identity colour (the same hexes each metric's detail-screen sparkline already uses —
`#60a5fa`/`#f87171`/`#818cf8`/`#f97316` — not new colours). Same length/position on every card regardless
of score, so it can't be misread as a percentage; state still lives only in the dot. Also added **active
minutes** to Activity Score v2 — zone-minutes (WHO moderate/vigorous, vigorous double-counted) and
move-every-hour (an HR-elevation proxy, since there's no hourly step data), both computed from the
intraday HR series already fetched for the HR card (`todayHrRows`) — the "device-gated" deferral in the
original plan was overcautious, nothing new was needed. New gauges on the Activity detail screen. A
duplicate `ageFromDob` (accidentally created in round 1) was found and deleted in favour of the existing
canonical one in `lib/date-utils.ts`.
**Sandbox-verified (round 3):** `tsc` clean, full suite 1927 passing (17 new). Synthetic `oura_heartrate`
rows inserted directly into the local dev DB (then deleted) to prove the zone-minutes/moved-hours
computation end-to-end, since the seed has no intraday HR data by default — confirmed correct values and
sub-scores. Playwright screenshots confirmed the new ring (arc + dot, no text) and the new gauge card
render correctly.
**Round 2 (v1.206.0):** the Activity detail screen's contributor chart + "how to improve it" guide were
found silently empty (wired to the permanently-null frozen Oura field) — fixed to serve the Activity
Score v2's own components; added a goals-vs-actual gauge card; fixed `/api/ai/health-insight`'s activity
section, which read the same frozen fields and always said "activity data is missing" even with a real
score showing.
**Caveats still open (all rounds):** (1) Samsung WebView render of the new ring — non-intersection at the
real S25 width, safe-area, colour rendering against the true blue-gradient hero (sandbox renders a plain
fallback background since the weather-driven hero has no network path here — the ring/dot/arc behaviour
was still clearly correct against it); (2) real-ring scores — the seed lacks ≥14-night baselines /
overnight HRV / a mature composite / real intraday HR, so the sleep-HRV term, the +1.5σ readiness terms,
zone-minutes/moved-hours, and a real "great day → ~100" are unproven on real data. **Deliberately not in
scope this round:** the "yesterday-completed" home display (circle shows today's live score) and an
hourly move-nudge notification. Anchors/weights are tunable starting values. Run
`docs/device-smoke-checklist.md` on the S25.

### [cardio][platform] Auto walk/run "Activity detected" notification gate (v1.204.1, 2026-07-23) — NOT verified on device · needs: android
The passive walk/run detector fired the "Activity detected · Recording your walk or run" ping on the
**first** GPS point clearing 0.8 m/s, before the end-of-session save gates ran — so indoor GPS drift
during stationary garage training posted a false ping every session (the session was still correctly
discarded, nothing saved). Fix (`lib/activity/auto-detection-service.ts`): the ping is now held behind
a **sustained-movement latch** — fires at most once per session, only once the live session has covered
`NOTIFY_MIN_DISTANCE_M` (200 m) over `NOTIFY_MIN_ELAPSED_SEC` (90 s), via the pure `shouldNotifyActivity`
predicate. Detection/session-start and the save-path quality gates (`detection-thresholds.ts`) are
unchanged. **Sandbox-verified:** 6 unit tests on the gate predicate + all activity/auto-detection-store
suites green (1867 tests pass; the one failing suite is the pre-existing `onnxruntime-web` sandbox dep
gap, unrelated). **NOT verified on device (APK-only path):** the significant-motion sensor → GPS →
Capacitor local-notification chain does not run in the web/dev sandbox. Owner action (device smoke): on
the S25 APK, (1) do a stationary garage weight session → confirm **no** "Activity detected" ping; (2) take
a real ≥200 m walk → confirm the ping fires once (~90 s / 200 m in) and the walk still saves as before.
Plan: `docs/superpowers/plans/2026-07-22-activity-detection-notification-gate.md`.

### [heart-rate][workouts] Per-set HR metrics "Heart & Recovery" card (v1.199.0/.200.1, 2026-07-21/22) — card paint NOT verified on device · needs: browser
New per-set HR snapshots (`set_hr_stats`, migration 139) + the exercise-history "Heart & Recovery" card
(`components/workout/exercise-hr-trend-card.tsx`) + a `getWorkoutHrTrends` AI-chat tool. **The data path
is fully sandbox-tested** (formula, DB round-trip, `computeWorkoutHr` integration, trend aggregator, chat
tool — 24 tests) **and dev-server verified** (trend route 200 + correct aggregation; recap route actually
persisted a per-set row). **Accessibility fix (v1.200.1):** the card was shipped **unreachable** — the
only entry points were `session-select`/`/stats`, which the owner reported don't surface it. Now tapping
an **exercise on the day screen** opens its history sheet (`onExerciseTap` → `ExerciseHistorySheet`;
wired through `day-overlay-sheet.tsx` until LB-3 deleted it and moved the tap onto `/health/day`). **Playwright-verified in dev** that the tap opens the correct sheet (screenshot) and both
`/api/workout/exercise-hr-trend` + `/api/exercise-history` return 200 with data — **but the sheet's
content paint could not be confirmed in the dev harness** (nested bottom-sheet showed persistent loading
skeletons behind successful 200s; believed a turbopack dev-compile/timing artifact since it's the same
sheet that ships elsewhere). **NOT verified on device:** the card's actual paint + look/safe-area inside
the bottom sheet and Samsung-WebView SVG sparkline rendering. No risk to existing data — reads only.
Owner action: on Health → Training, tap a trained day → tap an exercise (one with monitored sets) → scroll
to "Heart & Recovery"; existing sessions inside the 180 d window populate via Admin → Tools → Additional
tools → "Run backfill" (`POST /api/workout/backfill-set-hr-stats`, oldest-first, resumable). Plan:
`docs/superpowers/plans/2026-07-21-per-set-hr-metrics.md`.

### [workouts][app-shell] Workout & health UX batch (v1.198.0, 2026-07-22) — capture paths NOT device-verified · needs: browser
Owner-directed batch (see `docs/overview/entries/2026-07-22-workout-screen-fixes.md`): workout
category/intensity pills, home deload "why" panel, per-factor health deep-dives across the 4 pillars,
AI-prescription card refreshing in place (no app reopen), and an end-of-workout Time Summary
(setup/work/rest actual-vs-planned). Logic + endpoints are `tsc`/lint/test green and dev-server
verified. **NOT exercised in-sandbox:** the **timing capture** (new `prep_time_sec` bar-load time +
the last-set rest) only runs during a real device workout — the seed has no set-timing, so the card
logic is proven but on-device capture is not; **Readiness per-factor scores** are null until BLE
daily-summary history exists (deep-dives render guide text without a live score); category badges +
prescription-card refresh only hit their real paths on an `ai_dynamic` program. Migration 138 is
additive/nullable. Run `docs/device-smoke-checklist.md` on the S25. Follow-up: planned *work* time
could use the user's measured pace when history exists (currently standard pace, labelled as such).

### [platform] AI usage observability panel (v1.197.0, 2026-07-21) — panel render NOT eyeballed on device
All 15 `@ai-sdk/google` call sites now route through one instrumentation wrapper (`lib/ai/instrument.ts`)
that logs metadata (section/model/tokens/latency/ok/fingerprint) to `ai_call_log` (migration 136),
surfaced in a new **Admin → AI Usage** tab (calls by section, tokens, est. cost, over-time, double-trip
detection). Instrumentation + admin route are **dev-server verified end-to-end** with a real Gemini key
(all three wrapper shapes log real token counts; 403 for non-admin; double-trip detection works) — a
circular-import bug that silently dropped all logs was found and fixed there. **NOT verified:** the
panel's pixel render at the S25 viewport / both themes (admin-only surface, no browser in sandbox; uses
theme tokens + CSS bars, no chart.js). Est. cost uses approximate Flash-Lite pricing (labelled an
estimate). Foundation for the B3 double-trip-reduction work. Audit: `docs/reviews/2026-07-21-ui-responsiveness-audit.md`.

### [devices][platform] Oura raw-on-device: local v18 schema (2026-07-21) — NOT verified on device · needs: hardware
Local SQLite is at **v18**: v17 added four calculated-form tables (`oura_bucket` tier store,
`oura_daily_summary`, `oura_daily_derived`, `oura_heartrate`) + Oura columns on local `sleep_sessions`
(via reconcile); **v18 is corrective** — it drops+recreates `oura_bucket`/`oura_daily_summary`/
`oura_daily_derived` to fix the `oura_bucket` PK (re-keyed on `bucket_start_ms`) + type/column drift.
Additive/nullable, not yet read or written by any code (the on-device rollup that populates them lands in
a later PR). Verified in-sandbox: `check-reconcile` green, and **every migration version + the reconcile
pass applied cleanly to a real in-memory SQLite, including the idempotent re-run of the reconcile ALTERs
(the partial-upgrade path that has killed the local DB twice)**. NOT verified on device: the Capacitor
SQLite plugin's actual v16→v18 upgrade transaction on the S25 — open the app once and confirm the local DB
loads (no dead-store banner) per `docs/device-smoke-checklist.md`. Part of the Oura raw-on-device
architecture (`docs/superpowers/plans/2026-07-21-oura-raw-on-device-*.md`); the data-requirements map
(`…-oura-data-requirements-keep-cull-calculate-matrix.md`) is the foundation for what these tables hold.

### [platform][devices] D1/F3: restore pull endpoint live server-side (2026-07-22) — full restore flow device-gated
`GET /api/sync/pull?mode=restore` now unclamps the 90-day floor (`getSyncDelta(windowDays=null)` → full
history) and the previously-unlimited pull route gained rate limiting (separate `sync-pull` 60/min vs
`sync-pull-restore` 120/min buckets). **This server half is fully sandbox-verified** (route test 6/6 +
the F1 DB-backed window test). **NOT reachable / NOT verified end-to-end:** no client calls `?mode=restore`
yet — the restore driver loop (`pullDelta` outer `hasMore`, seed-cursor-to-epoch-once-then-loop,
loop-until-`hasMore===false`) lives in `lib/local-store/sync-engine.ts` where `getLocalStore` is null on
web, so it ships with the device-gated client batch and is proven only by the RST **wipe→restore** smoke on
the S25 (full sleep/HRV/RHR/score history returns, not a 90-day slice). Until then the endpoint is dormant
infrastructure.

### [platform][devices] D1/Track-B: dedicated timeseries pull endpoint live server-side (2026-07-22) — dormant, client-gated
`POST /api/sync/oura-timeseries` (`getOuraTimeseriesDelta`) serves `oura_heartrate` + coarse `oura_bucket`
on a single pooled connection with an exact keyset `(updated_at,id)` cursor, outside the shared
`getSyncDelta` fan-out. **Server half fully sandbox-verified** — DB-backed drain/stall-safety/concurrent-pool
tests (10 concurrent restore drains stay ≤ pool max:10, no leak) + a pure-mock route test, all green.
**NOT reachable / NOT verified end-to-end:** nothing calls it yet. The client drain-loop consumer, the
`oura_heartrate`/`oura_bucket` local tables + `applyDelta` mapping, the push registration
(SYNCED_MUTATION_DOMAINS + pushMutations branches) and B3 replace-by-day outbox are all device-gated /
D2-blocked (`getLocalStore` null on web) and ride the client batch + the RST wipe→restore S25 proof.
**Bucket pull returns empty until the device push lands** (the server `oura_bucket` table is greenfield —
no writer yet). Accepted bounded behaviour: the server HR rollup restamps ~14 days of `updated_at` per run,
so a synced client re-pulls that span — removed by the C1 single-writer flip, not before.

### [devices][sleep] D1 client batch pt.1: sleep restore widening + oura_daily guard (2026-07-22) — NOT verified on device · needs: hardware
The `applyDelta` pull path now carries the 12 Oura sleep columns (HRV/RHR/stages) through to the local
`sleep_sessions` table (was stripped to stage-hours — review R6 data-loss), clobber-guarded; and `oura_daily`
gained a local `sync_status` column (RECONCILE) with its `INSERT OR REPLACE` converted to a clobber-guarded
`ON CONFLICT(day)` upsert (D4). **Verified in sandbox by compile + mock-SQL unit tests only** —
`getLocalStore` is null on web, so native SQLite never runs here. **NOT verified on device:** (1) the RECONCILE
add of `oura_daily.sync_status` on the S25's existing local DB (the partial-upgrade path that has killed the
local store twice — open the app once, confirm no dead-store banner + history intact), and (2) the durability
payoff — a wipe→restore returning **sleep with HRV/stages intact** (not stripped), per `docs/device-smoke-checklist.md`
+ the RST proof. Until the S25 smoke runs, treat this as not-device-verified. The rest of the client batch
(F3 restore driver loop; summary/derived local persistence; the D2-blocked F4 arms + device write helpers +
Track-B push/B3) is still pending. **Update 2026-07-23:** an on-device attempt found `sleep_sessions`/`oura_daily`
unaffected — the transaction failed one domain later, on `oura_daily_summary`; see the RECONCILE_COLUMNS
schema-drift fix in the "Restore from cloud" row below. **Update 2026-07-26:** F4 mark-synced arms shipped
(see the D0/D1 Oura on-device backlog note) — device write helpers + Track-B push/B3 remain D2-blocked.

### [platform][devices] D1/F3 "Restore from cloud" driver + button (v1.200.0, 2026-07-22) — real on-device bug found + fixed 2026-07-23
`pullDelta` gained a `restore` param (`&mode=restore` → server full-history unclamp) and now surfaces
`hasMore`; the new `restoreFromCloud` driver seeds the cursor to epoch once then drains restore pulls until
`hasMore=false` (resumable), fronted by a "Restore from cloud" button under More → profile. Restore applies
**all four** day-grained finished-form domains locally — sleep, `oura_daily`, `oura_daily_summary`,
`oura_daily_derived` (readiness/illness/resilience/body-comp + EMA baselines), clobber-guarded.

**On-device attempt (2026-07-23) found a real bug, now fixed:** plain "Sync now" failed with a generic
toast; two follow-ups (surface the real error, then unmask a rollback that was hiding it) isolated the true
cause: `no such column: hrv_baseline_mean_x8` on `oura_daily_summary`. Root cause — **#725** extended
`CREATE_OURA_DAILY_SUMMARY_LOCAL`/`CREATE_OURA_DAILY_DERIVED_LOCAL` with 30 baseline/derived columns behind
a **v18 corrective DROP+CREATE**, but a versioned migration only runs once per device; any device already
past v18 before #725 shipped keeps the old (pre-#725) schema forever, and the new columns were never
registered in `RECONCILE_COLUMNS` (the mechanism that actually self-heals — it runs on every open, not once
per version). Exactly the "17 tables once missing from reconcile" bug class CLAUDE.md warns about. **Fixed**
by registering all 13 missing `oura_daily_summary` columns + 17 missing `oura_daily_derived` columns in
`RECONCILE_COLUMNS`, self-healing on the next app open — no wipe, no version bump, no APK rebuild needed
(confirmed **not** a stale-APK/Capacitor-version issue — the owner rebuilt the APK and the error persisted
unchanged, which is what pinned this to a JS/schema bug rather than the native plugin).
**NOT yet re-verified:** owner needs to retry Sync/Restore once this fix deploys and confirm it succeeds —
that closes out the RST durability gate for the day-grained domains. Three known, lower-priority, non-blocking
warts from the same incident (documented, not yet fixed): (1) `illness_flag`/`illness_score`/`resilience_level`
kept their pre-#725 column type on drifted devices (SQLite's loose typing means read/write still works, just
without a corrective ALTER); (2) `oura_bucket`'s PK correction (the other half of #725/v18) likely also never
applied on an affected device — moot today since nothing writes local buckets before D2; (3) Track-B
time-series restore (`/api/sync/oura-timeseries`) still needs its own client driver (not wired).

**Round 2 (2026-07-23), same investigation:** after the RECONCILE_COLUMNS fix deployed, the missing-column
error was gone but retrying Sync surfaced a **new, deeper** bug at the same site: `SQL failed [COMMIT]: Run:
Cannot perform this operation because there is no current transaction.` Root cause: `applyDelta`/
`logWorkoutLocally` managed their transaction with literal `'BEGIN'`/`'COMMIT'`/`'ROLLBACK'` **SQL text**
through `runSQL()`, but `@capacitor-community/sqlite`'s `run()` defaults its own `transaction` param to
`true` — every individual `.run()` call auto-wraps itself in its own begin+commit unless told otherwise, so
the manual sequence never was one atomic transaction: the first write's auto-commit silently closed
whatever the literal `BEGIN` opened, every later write auto-committed itself in isolation (data still landed,
just non-atomically), and the final literal `COMMIT` found no transaction the plugin's bookkeeping still
considered open. **Fixed** by using the plugin's real `beginTransaction()`/`commitTransaction()`/
`rollbackTransaction()` methods (first-class API, not raw SQL text), gated through a module-level flag in
`sqlite-service.ts` so every write's `runSQL()` call gets `transaction:false` while a manual transaction is
open — zero change to the dozens of individual write call sites. **NOT yet re-verified** — same as above,
owner needs to retry Sync/Restore once this deploys.

**Round 3 (2026-07-26):** owner tapped "Restore from cloud" on-device (without wiping local data first) as
a sanity check — got a "Restored 0 records from cloud" **success** toast. Investigation (re-ran the
server-side `getSyncDelta(epoch, windowDays:null)` query against the local seeded DB — returned real
history correctly, ruling out a server regression) found the real bug in the client driver:
`restoreFromCloud` treated a failed pull page (dead network, expired session, rate limit) identically to
"genuinely nothing to restore" — both returned `{ synced: 0 }`, so a transient failure silently rendered
as a success toast. An existing unit test even encoded this as expected behavior. **Fixed**: `restoreFromCloud`
now returns `{ synced, failed }`; the UI shows an error toast on `failed:true` instead of a false-positive
success. **NOT yet re-verified on-device** — owner should retry "Restore from cloud" once this deploys and
confirm it now reports a non-zero count (their history is substantial — months of data, 14+ backfilled step
days). This does not change the D1 durability gate's real remaining requirement: a true wipe-then-restore
test is still the outstanding owner checklist item.

### [workouts] Workout screen 3-card redesign (v1.193.0) — REVERTED in v1.195.1 (2026-07-21)
The #718 3-card rewrite (Workout / Run / Activity) shipped a `RunCard` that called `.reduce` on
`zoneTargets` — a `WeeklyZoneTargets` **object**, not an array — so `/workout-select` threw
"reduce is not a function" and would not load for any user with a real running plan (the seed had
none, so it passed dev/CI). On-device QA hit it immediately. **v1.195.1 restored the original
full-height swipe carousel** (the owner also missed it) and added a Run + Log-Activity button row
beneath it; `run-card.tsx` deleted. The 3-card redesign is shelved — revisit only if re-attempted
with the correct `zoneTargets` shape. Round-2 health refinements (Body Battery diagrams, ACWR
monotony/strain graph, Heart & Recovery visual cohesion, Trends pill-swipe gesture) are queued.

### [app-shell] Health UX device-gated batch (v1.192.0, 2026-07-21) — NOT verified on device · needs: browser
The #2/#4/#7/#9a items shipped web-verified (tsc/lint/test/build + dev-server 200) but their
device-specific behaviour is unconfirmed in the sandbox: the redesigned detail-screen back button
(safe-area + back-stack), the moved standalone "Measure HR now" card (live HR from ring **or** Polar
strap, safe-area), the live direct-BLE ring battery (`/api/oura-ble/battery-latest` reads `null` until
the native service posts a keepalive poll — verified endpoint, not real telemetry), and the Heart &
Recovery range scales (need real multi-day data). Also the energy-budget card (v1.191.0) was not
exercised with a logged day (seed has no food/goal today). Run `docs/device-smoke-checklist.md` on the
S25 to confirm. **~~Follow-up: activity energy in the budget~~ ✅ SHIPPED v1.194.0 (strength) →
v1.195.0 (all movement)** — the energy budget's "burned" now folds in strength workouts + logged
activities (walk/run/cycle/…) + passive steps, all via the shared MET/Schofield estimator
(`lib/health/daily-energy.ts`, 9 unit tests). Double-counting is handled: the budget bases on a
**resting** floor (BMR×1.2) and adds movement explicitly (rather than an inflated activity multiplier
that already assumes exercise); steps below a 3,000/day baseline don't count; and steps inside a logged
outdoor walk/run are subtracted from the passive total. Verified 624 kcal active energy for a lift +
30-min run + 12k-step day. **On-device look of the budget with a real day still wants the S25 smoke run.**

### [platform] 🔴 Postgres volume approaching 1 GB for one user (2026-07-21) — HANDOVER, structural fix pending
Railway postgres-volume hit **92% of 1 GB**. Immediate crisis de-escalated by an owner-run `REINDEX`
of `oura_raw_samples` (~105 MB of index bloat from the migration-115 `measured_at` backfill reclaimed;
DB 320→205 MB) + a WAL cap/restart to flush ~180 MB of WAL. **Root problem unsolved:** `oura_raw_samples`
raw-BLE archival (`body_hex`) is 91% of the DB and grows ~50 MB/week unbounded, so the volume refills
in ~3-4 months. Long-term fix (owner decision) is likely **(a) store `body_hex` as `bytea` not hex TEXT
= instant ~50% cut** and/or **(b) S3 cold-storage of aged raw events**. Full data + query outputs +
plan captured in **[`docs/db-volume-cleanup-handover.md`](docs/db-volume-cleanup-handover.md)** — read
that first when picking this up. Also note a perf flag: `oura_raw_samples` takes 15.2 K seq scans (may
need an index).

### [devices][platform] Oura-BLE rollup DB-pool fix (v1.188.1, 2026-07-21) — server-side, needs on-device 499-check
Fixed the home "Sync failed" toast, root-caused to the Oura-BLE ingest: `aggregateOuraRawSamples` ran
**inline** on every `/api/oura-ble/samples` POST and fanned reads over **10 of the 10 pool connections**
for 12–30 s — starving the outbox sync and blowing the native client's 30 s timeout (→ 499 → cursor-held
re-drain retry storm → prod `NO_SOCKET`/`TCP_INVALID_SYN`). Now the rollup reads via **one** connection
and is **time-boxed** (`ROLLUP_RESPONSE_DEADLINE_MS = 10 s`) so the POST returns 2xx promptly and the rollup
finishes in the background, with a per-user in-flight guard. **Verified:** full suite (1901 tests) + real-HTTP
`pnpm dev` exercise of the 200/rollup/deadline branches. **NOT device-verified** — `getLocalStore`/the native
POST path don't run in the sandbox, so the actual 499→2xx improvement on a real ring drain is unconfirmed.
Ships via Railway (no APK rebuild). **Device-smoke:** pull-to-sync on the S25 while the ring drains; confirm
`/api/oura-ble/samples` returns 2xx quickly (no 499 in Railway HTTP logs) and no "Sync failed" toast. Row I19
in `docs/oura-ble-operations.md §1`.

### [nutrition] Offline saved-meal create/edit/delete (v1.188.0, 2026-07-21) — new sync domain, NOT device-verified · needs: android
Saved meals became a full offline-first write domain: new SQLite v16 tables (`saved_meals` +
`saved_meal_items`), local-first read hydrated from the page's server fetch (clobber-gated on
`sync_status`), and an outbox `saved_meals` domain whose `pushMutations` branch replays create/edit/
delete idempotently (`writeSavedMeal` upserts on the client-minted id). No Postgres migration or
getSyncDelta change — cross-device convergence rides the existing `cachedFetch` refresh. **Entirely
APK-only** (`getLocalStore` null on web → unchanged online-only fallback, no web regression); the local
mirror, outbox replay, and clobber-gate only run on the S25. Scope: existing library foods only —
"add a new food from scratch" stays online-only with a needs-connection message. **Device-smoke:**
airplane-mode → create/edit/delete a meal from logged foods, confirm instant list update + pending
count in More→sync-health, then reconnect and confirm all three land server-side and pending clears.

### [nutrition] Offline food search (v1.187.0, 2026-07-21) — APK-only, NOT device-verified · needs: android
Food-library search, the build-a-meal ingredient search, and the "recently logged here" quick-pick
now read the local `food_items` store first (new `searchFoodItems`/`getRecentFoodItemsForMeal` local
methods) so re-logging a usual food works offline. `getLocalStore` returns null on web, so this path
is dead in `pnpm dev` (web = unchanged server fetch, no regression) and only runs on the S25 native
SQLite. **Device-smoke:** airplane-mode, open the food logger, confirm My-Foods search + build-a-meal
ingredient search + the recent-for-meal quick-pick return previously-logged foods with no signal.
Saved-meal *view + logging* were already offline (cachedFetch persistence + food-log outbox); only
saved-meal *create/edit while offline* remains a gap (deferred, owner decision).

### [workouts] Deload badge on exercise history (v1.186.0, 2026-07-21) — badge absent offline until fetch lands
Exercise-history Session Log rows now show an amber "Deload" pill when `isDeload` is true. The flag is
server-computed and already on each entry; no plumbing added. **Known limitation (pre-existing):** the
offline local-seed path in `exercise-history-sheet.tsx` stubs `isDeload: false` (the local store doesn't
carry the phase flag), so the badge is transiently absent when seeded offline and only correct once the
server fetch resolves. Fixing that needs the deload flag persisted in the local store — deferred.
Builder-review row keys were also made stable (`clientId`) in the same PR; no visible change.

### [workouts] Workout-screen open-flash / zoom-lock / prescription-at-session-end (v1.185.1–v1.185.3, 2026-07-20) — NOT device-verified · needs: browser
Three WebView/pipeline fixes from this session, none reproducible in the web sandbox:
(1) **Open-flash** — the pre-workout screen no longer replaces the painted exercise list with the
full-screen "Preparing your AI workout" takeover (heading swaps in place instead). Pure render change,
verified in `pnpm dev`, but the `aiPrescriptionPending` branch needs an ai_dynamic program mid-regeneration
to see on-device. (2) **Zoom-lock** — viewport now sets `maximum-scale=1, user-scalable=no` to stop the
app reopening stuck-zoomed after minimize/reopen; the stuck-zoom state only manifests in the Android
WebView, so **needs an on-device minimize→reopen check**. (3) **Prescription-at-session-end** — the next
AI prescription is generated in-process at completion (new `lib/ai-periodization/generate-prescription.ts`)
instead of via the unreliable self-origin `fetch(.../prescribe)` on next open; full test suite + tsc green,
but the **Gemini end-to-end path is not testable in-sandbox** (local seed is a `manual` program, no API
key) — needs real-data/on-device confirmation that finishing an ai_dynamic session queues the next
prescription and the card shows "Auto". Note the completion-time regeneration threads the just-completed
session as `excludeSessionId` so it can't self-trigger the emergency deload (reconciled with the W5 fix on merge).

### [cardio][workouts] Run-explain narration + prescription volume pills (v1.185.0, 2026-07-20) — NOT device-verified · needs: browser
Two new UI surfaces (owner chose to surface, not delete, the W4 §5 dead fields): the prescribed-run
card now shows an AI one-liner from `running-plan/explain` (falls back to the deterministic rationale
on failure/offline), and the AI-prescription card shows per-muscle weekly-volume pills. Both render
fine in `pnpm dev` but are APK surfaces (running screen, workout prescription card). **Device-smoke:**
confirm the run AI sentence renders and degrades to the plain rationale offline, and the volume pills
render + sum sensibly on the S25.

### [workouts][app-shell] Workout-screen render-perf (W2, 2026-07-20) — perceived responsiveness NOT device-verified · needs: browser
The 2026-07-20 audit (§2.1) flagged the workout orchestrator's broad `useShallow` pick as re-rendering
on every weight-dial tick. Re-verification found the premise wrong — the dial mutates `perSetWeights`,
which the orchestrator never subscribed (it was already isolated by design). The real dial-tick hot path
was the **814-line `ActiveWorkoutScreen`** (it subscribed the whole `perSetWeights` array and fed
`SetCard`/warmup/live-1RM by value). Fix: extracted self-subscribing memoized leaves (`ActiveSetCard`,
`SetsGrid`) + leaf-ified `Live1rmReadout`/`PipView`, so a dial detent re-renders only those small leaves;
the parent now reads just `perSetWeights[0]` (working-weight header + warmup). Also narrowed the
orchestrator pick (reps/setWeights/lap/rest moved to leaves + `getState()` in handlers). **Pure
render-optimization — the same values render, only *which* component re-renders changed** (trivially
revertible). tsc/lint/tests/build green. **NOT verified:** the actual perceived-smoothness improvement is
web-sandbox-invisible — needs the S25 APK active-workout smoke (log several sets across exercises: no
dropped dial ticks, no stale displayed weight/reps, rest ring + lap/rest counters still update, live-1RM
+ warmup update as set-1 weight changes) per `docs/device-smoke-checklist.md`.

### [readiness] Chronic-stress rollup wiring (Chunk 1, 2026-07-20) — score is null in-sandbox; NOT device-verified on real ring data · needs: data
`cumulative_stress_1_2_2` (ChronicStress) is now wired into `aggregateOuraRawSamples` (`chronic_stress`
step) via `lib/health/chronic-stress-assembly.ts` + a new per-5-min HRV series (`lib/health/hrv-5min.ts`,
ported from the preserved `sleepstaging_2_6_0` source per the owner's unblock). The golden model test is
unaffected and a synthetic-full-data unit test proves the assembly produces a non-null score. **What is
NOT verified (and can't be in-sandbox):** (1) a real **non-null** score — the model's 21-day gate means
nothing renders until ≥21 nights of real ring data with granular hypnogram/HRV/temp-skin signals exist,
and the seed DB has none; (2) whether the score is *sane vs Oura's own historical ChronicStress* — owner
/ on-device only. Two documented approximations pending owner calibration: the **fever-deviation limit**
(`TEMP_DEV_FEVER_LIMIT_C = 1.0`°C, biased against over-masking so the 21-night gate isn't starved; the
`highestTemp > 38°C` branch is the primary fever gate) and the **30-sec hypnogram** (up-sampled 10× from
the 5-min stager since the Ring 5 emits no native 30-sec phase events, making SFI transition-counting
coarser). No surface yet — a Health ChronicStress card (Chunk 2) is deferred until the owner confirms a
plausible on-device value. First score also needs a wide/full rollup pass covering ≥21 nights (the
in-memory history is built from that pass's stashed signals).

### [workouts] `active-workout-screen.tsx` has grown past the 800-line component-size guidance (found 2026-07-20)
The 2026-07-20 wiring/caching-perf audit (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`
§2.5) found `components/workout/active-workout-screen.tsx` is now 814 lines — a new hotspot not on
CLAUDE.md's named list (`session-select-content.tsx`, `workout-screen.tsx`, `config-screen.tsx`,
`health-content.tsx`/`health-sections.tsx`, `program-editor-sheet.tsx`). Advisory only — no single
extraction was obviously correct at audit time, so no plan was written for it (per the "no
orphaned findings" rule, recording it here instead). Watch it: new features should extract into
`components/workout/` children rather than appending further, and it's a candidate for a split
plan once a natural seam appears (e.g. the rest-ring/lap display vs. the exercise-list body).

### [workouts] Warm-up / bar-load status-bar chip counts DOWN + red/negative over-run (v1.181.0) — NOT device-verified · needs: android
Owner report: the green Android Now Bar prep pill counted up; they want a countdown, and at 0 it should
turn red and show how far over target it is. Both prep UIs already render a fixed target
(`WARMUP_GOAL_SEC=600`; bar-load `transitionSecForEquipment`), so the chip now passes a **future finish
anchor** and the native chip counts down, flipping to a red negative `−M:SS` over-run at the boundary.
- **This is a NATIVE change (`MainActivity.java`) — the Railway WebView deploy alone is NOT sufficient.**
  The JS half (`workout-screen.tsx`, the future anchor) is coupled to the native half: a future anchor
  renders wrong on the old native. It requires an **APK rebuild** (`npx cap sync android &&
  ./gradlew assembleDebug`, install on the S25) to take effect.
- **On-device smoke:** start a workout → warm-up pill counts down from 10:00; enter a barbell set's
  get-ready → counts down from 4:00; let one run past 0 → stays green→**red**, ticking `−0:15`, no
  "Start set" action fires. Kotlin is compile-checked only by the Android CI job (no Android SDK in the
  sandbox); `tsc`/lint green.

### [devices] Phase 2: native chest-strap foreground service (v1.180.0) — NOT device-verified · needs: hardware
Shipped for on-device testing at the owner's request. New `com.trainingai.app.polar` native package
(foreground service + GATT client + Capacitor plugin) that holds the Polar H10 connection all day so
strap HR streams with the screen off / app backgrounded (Phase 1 was foreground-only).
- **Kotlin is compile-checked only** — the Android CI job runs `assembleDebug` + the `0x2A37`
  JVM decoder test (`PolarProtocolTest`). There is no Android SDK in the sandbox, so **all runtime
  BLE / foreground-service / background behaviour is APK-only**: real all-day + screen-off streaming,
  connect/reconnect-backoff, worn-gating, and the native `/api/hr-ingest` POST using the
  `CookieManager` session cookie. On-device smoke on the S25 is the real gate
  (`npx cap sync android && ./gradlew assembleDebug`, install, wear the strap through a day of
  intermittent walks with the phone pocketed; confirm HR lands + the ring battery is unaffected).
- **Separate foreground-service chip** — Android requires one notification per foreground service,
  so this adds a "TrainingAI · Chest strap" chip alongside the Oura ring's. Consolidating both into a
  single "Sensors" notification is a deferred follow-up (needs one service to own a shared chip).
- **Mid-session pairing** still needs an app restart to activate the service (mount-time gate,
  inherited from Phase 1).

### [devices][heart-rate] Always-on chest-strap HR + "activity detected" notification (v1.177.0) — NOT device-verified · needs: hardware
Shipped to `main` for on-device testing at the owner's request; all JS, deploys via Railway (no APK rebuild).
- **Always-on strap + strap-preferred HR all day (Phase 1):** the strap now connects and wins precedence
  over the Oura ring app-wide (ambient mode), not only during workouts. Unit tests prove **ambient never
  starts the ring's burst loop** (ring-battery-safe in logic) and that ambient persistence is thinned to
  ~1 sample/30 s. But **no BLE runs in the sandbox** — real strap connect/stream, the ring battery holding
  over a full day, and actual `oura_heartrate` write-volume are **APK-only**. **Foreground-only:**
  background/screen-off all-day capture needs the native foreground service (**Phase 2**, still on the
  backlog). A strap paired **mid-session** needs an app restart to go ambient (mount-time gate). No off
  toggle yet (default-on when paired, per owner).
- **"Activity detected" notification + reworded GPS chip:** `LocalNotifications` no-op on web, so the
  one-off heads-up firing at the confirmed-walk (`probing→tracking`) transition and clearing when GPS
  stops, plus the reworded "TrainingAI · Activity / Tracking your walk or run" foreground chip, are
  **APK-only**. Verified in-sandbox: tsc, lint, build, 1715 tests (10 new live-hr/store).

### [cross] Deep app review 2026-07-19 — 1 critical + 6 high verified findings, ALL QUEUED (fixes not yet shipped)
Full-system audit (`docs/reviews/2026-07-18-deep-app-review.md`: 13 review agents, adversarial
verification of every critical/high, empirical dev-server probes; ~100 raw findings). Everything
below is **live on `main` right now** and queued in `docs/implementation-backlog.md`
(▶ Deep-review batch, plans P1–P5); this row is struck per-item as the fix PRs land.
- ~~**CRITICAL — new-food logs never reach the server (D-1):**~~ ✅ **FIXED v1.171.1**
  (`fix/s1-food-items-sync-envelope`). `food_items` added to the push envelope; the enum and the
  local-store `PendingMutation` type now both derive from one canonical `SYNCED_MUTATION_DOMAINS`
  list, and a source-scan test (D-2) fails CI if any `queueMutation` domain literal is missing from
  it. A one-shot `requeueStrandedFoodItems` heal (run before each push) re-queues the item + re-opens
  any log already dead-lettered by this bug. Server path verified on local Postgres; **the on-device
  native-SQLite heal itself is NOT device-verified** (`getLocalStore` returns null in-sandbox — the
  final gate is an APK smoke: log a new food online, confirm it appears server-side).
- ~~**HIGH — Time-in-Zone feature dead since ship (J-8):**~~ ✅ **FIXED v1.172.0** (P2) — additive
  `normalizeDateParamIso` (dash) revives the day iterator; zone-cache also invalidate-on-HR-rewrite +
  canonical profile + profile stamp. ⚠️ **Zone *values* not device-verified** — sandbox seed has no
  `oura_heartrate`, so only iteration/persist/cache-stamp are proven; real zone minutes need the S25.
- ~~**HIGH — Training Stress (OTS) route 500s in prod / never persists (J-9):**~~ ✅ **FIXED v1.172.0**
  (P2) — dash-form date; route now 200s and OTS persists on a good read. ⚠️ **Not device-verified** —
  gates `no_readiness` in-sandbox (no BLE-derived readiness); real OTS + the J-6 gappy-day grid need
  the S25 + ring data.
- ~~**HIGH — AI layers blind to live readiness (F8=E2-1+E2-12):**~~ ✅ **FIXED v1.176.0** (P3) — new
  canonical `lib/health/live-readiness.ts` (`liveReadinessByDay`/`liveReadinessForDay`/`getLiveReadiness`:
  own BLE composite wins, pre-re-key Cloud fills gaps, frozen post-re-key Cloud withheld) reads across
  prescribe signals, chat context/tools, weekly digest, health insight, and next-session. Also E2-8
  (provisional≠absent), E2-11 (prescription-retry guard widened to `consumed` alone), F9 (resilience+OTS
  surfaced to chat/digest), F6/F7 hygiene. ⚠️ **Not device / real-token verified** — no real ring data in
  sandbox; composite-vs-frozen precedence is unit-tested + seeded-smoked, S25 end-to-end freshness is device-gated.
- ~~**HIGH — BLE rollup statement-timeout cliff ~Sep–Oct 2026 (C-1=H-2):**~~ ✅ **FIXED v1.174.0** (P4
  efficiency half) — the rollup is now O(window): 35d bounded reads + an incremental daily-summary fold
  seeded from the persisted checkpoint (byte-identical to full replay) + window-scoped upsert, coalesced
  per-drain (+0x50 trigger), with K6 failure telemetry. ⚠️ **Not device-verified on real ring data** —
  admin ingest/redecode routes + real drain throughput need the S25 (rollup logic covered by 32 DB-backed
  test files on the windowed path).
- ~~**HIGH — per-workout HR stats erased by the 180d prune + rr_intervals unbounded (H-3, H-1/G-6):**~~
  ✅ **FIXED v1.177.0** (P4b retention half, `fix/s2-ble-retention`) — Lever W persists a durable
  `workout_hr_stats` snapshot (mig 135) on first recap view (COALESCE fuller-wins) with a fallback when
  the raw series thins + an admin backfill; Lever R adds the 90d `rr_intervals` write-path prune (safe
  once workout-HRV is snapshotted). ⚠️ **Not device / real-token verified** — APK recap render of the new
  snapshot summary, real strap-RR prune, and the admin backfill (seed user non-admin, `requireAdmin`→403)
  are unit/DB-tested, not on-device; the backfill must be run before ~2027-01 (first BLE workout hits 180d).
- **HIGH — native drain cursor hole-jump race (R-1):** a batch succeeding after a failed batch
  confirms past the failed span (`OuraRingService.kt` non-volatile `drainIngestFailed`, never
  re-checked in `confirmStored`) — silent permanent loss of ~one ≤255-event history batch per
  incident. Kotlin fix + owner APK rebuild (native pen).
- ~~**HIGH — dead local store silently no-ops writes (K4):**~~ ✅ **FIXED v1.172.0**
  (`fix/s1-error-surfacing-standard`). A failed native init now sets a dead-store flag →
  `getLocalStore` returns null, so writes take the online API fallback (the same path web uses — no
  risky global `runSQL`-throw) instead of no-op'ing behind a success toast; plus an amber
  "Local storage unavailable — saving online only" banner and one `error_events` telemetry row. This
  also realises R3 Task 4.2's intent (that plan's `runSQL`-throw approach is now superseded).
  **The dead-store path itself is APK-only (native SQLite) — NOT device-verified.**
- Also verified then downgraded to medium (**all FIXED v1.172.0 except where noted**): chat's
  body-weight regex auto-log (F1, still open — Stream 1 Task 5), fitness-test
  HRR1 deterministically null (E2-9, Stream 2), ✅ workout-screen infinite-skeleton path + dead error toast
  (K2), ✅ zero signal at dead-letter time (K3), `daily_zone_minutes` compute-once-forever cache
  (J-1, latent until J-8 lands). Positive: 14/17 sampled prior "fixed" claims verified
  still-fixed; admin gating, Zod coverage, ownership checks, safe-area utilities, S7 signal
  consistency, and the formula library all held up.

### [platform][app-shell] P5 error-surfacing (v1.172.0, 2026-07-19) — APK-only surfaces NOT device-verified · needs: android
Shipped the §K standard; the JS/server logic is unit-tested (cachedFetch `onError` channel,
dead-letter signal) and server-render smoked (authenticated /workout, /more, /health/heart-rate all
200, no error boundaries). These surfaces run only on the canonical APK runtime and could not be
exercised in the web sandbox — flagged per the Canonical Runtime rule:
- **Dead-store banner + write-rerouting (K4):** `getLocalStore` only returns null-on-dead when
  `isSQLiteAvailable()` is true (native + plugin). Requires a real APK with a forced init failure to
  observe the banner render, the telemetry row, and a food/body-metric save actually taking the API
  fallback. The web fallback path (which the fix reuses) IS exercised by `pnpm dev`.
- **Dead-letter toast + More-tab badge (K3):** the toast fires from `reconcileDeadLetters` after a
  real 5×-failed outbox push (native SQLite outbox); the badge is `useSyncExternalStore`-driven.
  Logic is unit-tested; on-device appearance at an actual quarantine transition is unverified.
- **Chest-strap HR re-buffer (K5):** BLE-only; the re-buffer on a failed `/api/hr-ingest` POST needs
  a paired strap on a flaky connection to observe. Pure buffer-cap logic is straightforward but
  device-unverified.
- Web-observable pieces (K2 workout error-with-retry, K9 card retry states, K1/K8 telemetry, K7
  pull-to-sync toast) are covered by the render smoke + unit tests, but the literal error UI only
  appears under a live 500/429, which was simulated in unit tests, not click-driven in-session.

### [workouts] §E1 workout-flow batch (v1.172.1, 2026-07-19) — two APK-only surfaces NOT device-verified · needs: android
The server/logic pieces are unit-tested (rehydrate reset) and DB-verified (E1-2 `loggedAt`, E1-6 `achievedAt`
against local Postgres), and `/workout` renders 200 with `allTimePr1rm` in the route payload. Two surfaces run
only on the canonical APK runtime:
- **E1-4 rehydrate reset:** the full workout-identity reset on a stale/date-rolled session fires from zustand's
  `onRehydrateStorage` at app reopen. The pure `applyRehydrateFixups` is unit-tested (a stale/warmup/date-rolled
  session fully clears; a recent session keeps its identity), but the actual app-kill-and-reopen-days-later
  behaviour needs an on-device run.
- **E1-5 offline id-only seed:** the strict-id resolution + offline reselect path only runs when `getLocalStore`
  is non-null (native SQLite) and the network fetch fails — not reproducible in the web sandbox.

### [workouts][platform] PERF-9 workout-data `?tab=all` batch (2026-07-18) — shipped, `ai_dynamic` batch branch NOT runtime-verified
- The `?tab=all` batch was dev-server verified for **byte-identical** per-session output vs the single-tab
  path (exercises/phaseStatus/aiPrescriptionPending/dataDate), zero prescribe calls, zero write POSTs — but
  only on the local **`manual`**-mode Push/Pull/Legs seed. The batch's `ai_dynamic` derivation (AI-prescription
  override, expiry-stops-driving-load, `aiPrescriptionPending`, baseline/deload phase-status) ran its empty
  paths only. It is a line-for-line mirror of the single-tab path minus the writes, and shares the same
  `buildWorkoutExercises` helper (so the exercise mapping cannot drift), and `deload-reverts` unit-tests the
  payload — but a real `ai_dynamic` program's batch output has not been compared against its single-tab output
  at runtime. Low risk (structural parity + shared helper); flagged per the verification-disclosure rule.
- Not exercised on-device: native SQLite `setCached` of the per-session seeds + Samsung WebView paint. The
  client change is a like-for-like swap of an existing `cachedFetch`+`setCached` seed pattern.

### [workouts] R4 workout-flow hygiene — WK-13 / WK-16 (v1.170.2) — shipped, both APK-only surfaces NOT device-verified · needs: android
- **WK-13 (day rollover while foregrounded):** the `rolloverDay` store action is unit-tested and the
  `visibilitychange` listener was confirmed to attach + fire without error on the dev server. The actual
  bug it fixes — an app held open **across local midnight** dropping yesterday's ticks/Complete button —
  can only be observed on a real device kept foregrounded past midnight. NOT verified on-device.
- **WK-16 (one timezone basis for the completion flow):** server date behaviour is provably unchanged
  (`normalizeDateParam` already discarded the payload's datetime suffix and fell back to the server's own
  `todayInTz(tz)`), and the optimistic calendar stamp now uses the same `YYYY/MM/DD` user-tz format
  `getCalendarData` keys with. The divergence it fixes is only observable on a device whose OS clock is set
  to a **non-`Australia/Brisbane`** timezone near midnight — the dev sandbox tz is Brisbane (device == user
  tz), so it's unobservable here. NOT verified on-device.
- **Deferred (item 8 backlog notes, not regressions):** WK-15 (re-key phase counting off `session_id` —
  needs a backfill migration for the nullable column; renaming a session still resets phase progress) and
  WK-18 calendar_event outbox (a failed Google Calendar add still drops silently).

### [workouts] Goal-aware accessory intensity (v1.170.0) — shipped, owner's live program NOT device-verified · needs: data
- The math (`pctForExpectedRpe` inverse, goal-aware bands, the prescribe + workout-data apply points)
  is fully unit-covered (16 tests + regression sweep) and `tsc`/lint/full-suite/build green; dev-server
  verified the manual path is untouched and an ai_dynamic accessory moved 75%→66% at 12 reps (RPE-8
  strength target).
- **NOT verified on-device:** the fix is visible only where an accessory flows through an **AI-dynamic**
  path; the owner's live "RPE 6 → RPE 8" change is confirmable only against their production program on
  the S25 (open an accessory, confirm the slider reads ~RPE 8 and the prescribed weight rose). Run
  `docs/device-smoke-checklist.md` or treat this row as the not-yet-device-verified marker.
- **Out of scope (flagged follow-ups):** a stored **static** accessory style % on a **non-AI-dynamic**
  program is per-user DB data, untouched (retro-fixing needs re-generation or a confirm-first migration);
  **per-muscle-group** intensity profiles were explicitly deferred by the owner. `ACCESSORY_SPEC` target
  RPEs are starting points — tunable per goal if the owner wants more/less.

### [platform][readiness] On-device health-anomaly alerts (v1.169.0) — shipped, native delivery NOT verified
- The pure decision logic (`computeHealthAlertActions` — illness/stress/readiness fire/skip, dedup,
  precedence) is fully unit-covered (11 cases) and `tsc`/lint/full-suite/build green; the two dependency
  constants (`STRESS_HIGH_LEVEL`, `STRESS_HIGH_DAY_THRESHOLD_MIN`) and the `body-battery.stress.highMinutes`
  field are confirmed live on `main`.
- **NOT verified on-device (owner APK smoke pending):** `Capacitor.LocalNotifications` no-ops in the web
  sandbox, so the **actual notification delivery** — scheduling, the `health-alerts` channel auto-create,
  the mount/resume firing from `sync-provider.tsx`, the per-day dedup persistence, and the tap-through
  route (`/health/readiness`) — is APK-only and unexercised here. Client/JS only (ships via Railway, no
  APK rebuild), so the code reaches the device on next WebView load; only the native transport needs the
  smoke run.
- **Scope, by design:** delivers the offline-first 90% — the anomaly fires the next time the app is
  opened/resumed that day. True closed-all-day-unsynced push needs the deferred FCM-native endgame.

### [cardio] Running Prescription Coach Phase 1 (v1.167.0) — shipped, offline-first + device paths NOT verified
- The engine (`lib/running/`, 22 tests), persistence (`running_plans`/`prescribed_runs`, mig 132, SQLite v15),
  `GET/POST /api/running-plan` + `PATCH runs/[id]` + `explain`, and the `/running` UI are sandbox-verified:
  full suite (1698) / `tsc` / lint / `check-push-mutations` / `pnpm build` green, and a dev-server round-trip with
  real auth exercised create → gate-aware prescription → `rest` on seeded low readiness → complete/skip →
  no-clobber re-GET → real Gemini `explain`.
- **NOT verified on-device (owner APK smoke pending):** the **offline-first completion path** — native SQLite
  (`getLocalStore` is null in-sandbox), so the local-first read of today's status, the `prescribed_run` outbox
  push, the `pushMutations` mirror, and the `applyDelta` pull clobber-gate only ran via the web API fallback here;
  the SQLite **v15** table create + reconcile need the APK. Also **safe-area insets** (`/running` header + `pb-safe`
  Start button render as 0 in-sandbox) and the **guided-activity hand-off round-trip** (Start → `/activity` →
  `activity_logs` row → `activity_log_id` link → next prescription). JS/server ships via Railway with no APK rebuild;
  the local SQLite table is created by the existing JS migration runner on next open.
- **Adaptive re-prescription is Phase 1 only** — the plan is regenerated each `GET` from current signals but the
  weekly base volume does not yet grow from logged runs, and there is no multi-week look-ahead (Phase 2, backlogged).

### [app-shell] App icon → dumbbell (v1.166.3) — launcher + notification icon NOT device-verified · needs: android
- Replaced the blank white launcher placeholder with a green dumbbell (candidate B): Android adaptive
  foreground/background + a new `<monochrome>` themed-icon cutout across all densities, legacy
  `ic_launcher`/`ic_launcher_round`, a new `ic_stat_dumbbell` notification silhouette (Oura foreground-service
  notification now uses it, `OuraRingService.kt`), and the PWA `app/icon.tsx`/`apple-icon.tsx` refreshed to
  match (manifest cache-bust `?v=3`, version 1.166.3).
- **Verified in-sandbox + CI:** the PWA icon routes render valid PNGs (`/icon?v=3` 512×512, `/apple-icon`
  180×180, both 200/image-png), lint clean, and CI's "Android (Kotlin tests + debug APK)" job compiled the
  Kotlin change + resources. **NOT verified on-device:** the *visual appearance* of the native launcher icon,
  themed-icon cutout, and notification small-icon only takes effect after an **owner APK rebuild** (`npx cap
  sync android && ./gradlew assembleDebug`) — the home-screen icon won't change until that rebuild. The
  in-app/browser icon updates immediately via Railway.

### [cardio] Cardio Baseline Fitness Tests (v1.166.0) — shipped, on-device flow NOT verified
- The guided-test flow (`/baselines`), the offline-first `fitness_tests` domain (mig 131, SQLite v14, full
  outbox/sync mirror), the VO₂max equations (`lib/health/fitness-tests.ts`, unit-tested), and
  `/api/fitness-tests` (GET/POST/DELETE, dev-server round-tripped against local Postgres) are all
  sandbox-verified; `tsc`/lint/`check-push-mutations`/full suite (1669) green.
- **NOT verified on-device (owner APK smoke pending):** **live HR** (`useLiveHr` shows `—` in the sandbox —
  ring/strap sources are APK-only), **GPS distance** (`navigator.geolocation` yields no fix in-sandbox, so a
  real 6MWT/Cooper VO₂max is only obtainable on-device outdoors, screen-off), the **native SQLite offline
  path** (`getLocalStore` is null in-sandbox → local write/outbox/`pullDelta`/offline-render only run via the
  web API fallback here; the SQLite v14 create, the pull-clobber `sync_status` guard, and cross-device delete
  propagation need the APK), **safe-area insets** on the four full-screen test surfaces, and **haptics** on
  finish. JS/server ships via Railway; the SQLite v14 migration + native paths require an APK rebuild.

### [cardio][heart-rate] HR/cardio baseline bug fixes (v1.173.2) — shipped, guided-HRR + safe-area NOT device-verified · needs: android
- **What changed (3 owner-reported bugs):** (1) 6MWT VO₂max was ~half of reality — switched from the
  clinical-population Ross 2010 distance-only equation to the **Burr 2011** healthy-adult multivariable
  equation (weight/sex/RHR/age threaded through `app/baselines/page.tsx`), Ross kept only as a
  missing-data fallback; (2) Resting HR + Recovery now runs a guided rest→effort→recovery phase machine
  (`TestHrrGuide`) and measures the 1-min drop from a deterministic `recoveryStartMs` (was measured
  from end-of-capture → always blank); (3) fitness-test screens moved off floorless `pb-safe` to the
  floored `pb-safe-action`/`-lg` utilities. CLAUDE.md Safe-Area section rewritten so the doc no longer
  prescribes the floorless utility for anchored controls.
- **Sandbox-verified:** `tsc`/lint green; 16 fitness-test unit tests (Burr + Ross fallback, phased-HRR
  recovery computation, phase helpers); `/baselines` renders authenticated (200) against local Postgres.
- **NOT verified on-device (APK smoke pending):** the guided-HRR recovery drop depends on **live BLE HR
  samples** arriving through the recovery minute (sandbox shows `—`), **GPS** distance for a real Burr
  VO₂max, native SQLite save, **safe-area** clearance on the four test surfaces (insets render 0 in web),
  and phase-transition haptics. JS/server ships via Railway; no migration/native change, so no APK rebuild.
- **Cooper 12-min run confirmed unaffected** (correct Cooper 1968 equation, shares no code with the bugs).

### [workouts] Stale-session-id fix / strict id-only identity (v1.171.0) — shipped, NOT verified on-device
- **What changed:** `/api/workout-data` now resolves sessions **by id only** (removed the
  `find by name` and `sessions[0]` fallbacks) and returns `{ sessionNotFound: true }` for an unknown
  id; the 3 card-prefetch callers pass `sess.id`; program save force-re-syncs the offline mirror
  (`pullDelta(userId, true)`), and `pullDelta` gained `fullResync` (since=0); the workout screen
  recovers a stale id via an id-based full re-sync + a "reopen the session" reselect screen; exercise
  ids round-trip through the editor; prescribe self-heals a valid-but-stateless session.
- **Highest risk — removing workout-data's name fallback.** Audited every `workout-data?tab=` caller
  (all pass id or `meta`; chat's `sessionType` feeds WeightsPanel, not a session load) and full
  suite/build are green, but a missed name-based caller would now 404 as `sessionNotFound`. **On-device
  smoke required:** open each session (Push/Pull/Legs/Upper/Lower), confirm exercises + AI card load;
  edit a program → reopen → confirm the AI prescription regenerates (no "couldn't generate"); confirm
  a genuinely stale link shows the reselect screen and recovers after reselect.
- **Device-only unverified paths:** the native SQLite mirror write on save, `fullResync` rebuild,
  the `sessionNotFound`→re-sync→reselect flow, and baseline-1RM preservation across an edit — none run
  in the web sandbox. JS/server-only — live via Railway on merge, no APK rebuild.
- **Owner recovery for the currently-stuck device:** after deploy, opening the broken session
  force-re-syncs the mirror; then reopen it from the session list (correct id). A reinstall also works.

### [activity] Step-counter real-data console — shipped, step count NOT owner-validated on-device
- The real-data pipeline (`lib/oura-ble/step-counter-pipeline.ts`: stored `0x7e/0x7f` → `unpack27` →
  `runStepsMotionDecoder` → `runStepCounter`) is wired, exposed by admin-gated
  `GET /api/oura-ble/step-counter-export`, and surfaced by `StepCounterExportConsole` on `/admin/oura-ble`.
  The wiring is unit-tested (pair → dequantize → step_counter over synthetic frames), the authed route
  happy-path was exercised on the dev server against the local DB (seeded anchor + 8 paired frames →
  valid JSON: paired windows, decoded stride-frequency summary, step_counter total, Tier-1 gate estimate),
  and the admin page renders. `tsc`/lint/full suite (1657) green.
- **The step_counter TOTAL is NOT a trusted count yet** — two things are unconfirmed and are exactly what
  the console exists to validate against a phone: (1) that `unpack27`'s 27-column order matches
  `steps_motion_decoder`'s `data_columns` order (Sub-plan D-2), and (2) the `0x47` → step_counter 8-column
  motion mapping (`regular_motion` isn't decoded → NaN→0; motion is often absent daytime → the stream is
  zeroed). Trust the **golden-verified decoded stride-frequency** (~1.5–3 Hz walking) and the **Tier-1 gate
  estimate** as the physical cross-checks meanwhile. Owner validation: do a counted walk, sync the ring, run
  the console, compare the total to the phone. JS/server-only — ships via Railway, **no APK rebuild**.

### [sleep] BDI reclaim (breathing-disturbance index) — shipped, real-night value NOT device-verified · needs: data
- The moonstone SleepNet apnea head (a free byproduct of the nightly staging pass) is now captured as
  `bdi_derived` (disturbed asleep-epochs/hour) and persisted to `oura_daily_derived` in the rollup, with a
  read path. The BDI math (`bdiFromApnea`) is unit-tested (disturbed-count, awake-epoch drop, no-sleep zero),
  the read path is DB-integration-tested (round-trip + COALESCE no-clobber), and the rollup plumbing is
  typecheck + full-suite green.
- **NOT trustworthy until on-device validation:** the neural stager and its apnea head only run against
  synthetic vectors in the sandbox — a real-night number requires the owner to run the admin SleepNet dump on
  a worn-overnight drain (`components/oura-ble/sleepnet-dump-console.tsx`) and confirm a sane value (the
  per-beat IBI-timestamp reconstruction feeding the model is itself an unproven device assumption). This is
  why the **user-facing display is deferred** (backlog follow-on) and no Health surface ships in this PR.
  Observational, not a diagnosis. JS/server-only — ships via Railway, **no APK rebuild**.

### [readiness] Stress-resilience (v1.163.0) — shipped, rollup compute path NOT device-verified end-to-end · needs: data
- The `stress_resilience_2_2_1` TS port is **golden-verified** against the captured `.pt` vector (all 13
  outputs within 1e-3); the orchestrator's provisional-contributor gating, band cut-points, `<5`-valid-day
  null gate and confidence are unit-tested. The read path is dev-server verified: seeding
  `oura_daily_derived.resilience_*` and hitting `GET /api/readiness-score` returns
  `ownResilienceLevel/Band/Confidence` (4 → "solid" → 1.0), and nulling the level hides the tile with **no**
  frozen-Cloud fallthrough.
- **Unverified on device:** the rollup `resilience` step (`aggregateOuraRawSamples`) builds the daytime
  stress series from raw BLE temp/met/hr and runs one ONNX pass per 30-min bucket — the sandbox has no raw
  BLE samples, so the per-night index computation + level fit can only be exercised via the seeded read
  path, not end-to-end. A real level also needs ≥14 nights of mature `oura_daily_summary` baseline **and**
  ≥5 days with ≥4 h of daytime-stress coverage (the ring power-gates when worn-idle at a desk), so live
  resilience is only observable on-device after history accrues. Also the tile rendering at ≤640px in both
  themes (self-hides while null). JS/server-only — ships via Railway, **no APK rebuild**.

### [cardio] Training Stress Score (OTS) + VO₂max (v1.162.0) — shipped, OTS `ok` path NOT device-verified end-to-end · needs: data
- VO₂max derivation + the OTS core port are **golden-verified** against the captured `.pt` vector
  (parity within 1e-3) and the assembly/gating is unit-tested. The route (`GET /api/training-stress`)
  runs the full chain on the dev server and correctly gates.
- **Unverified on device:** the raw `0x50` MET-stream decode → 1-min series (native BLE ingest) — the
  sandbox has no real MET data, so the route's `ok` path (a live OTS number + persistence) can only be
  exercised with the golden MET series in unit tests, not end-to-end. On a real worn day the ring must
  yield ≥720 minutes with ≥360 valid (≥0.9 MET) for OTS to compute. Also the done-screen badge / health
  line rendering at ≤640px in both themes (they self-hide while gated, so appear only with live MET).
  JS/server-only — ships via Railway, no APK rebuild.

### [devices][app-shell] Frozen-Cloud display honesty (v1.161.2, item 21) — shipped, NOT visually verified at S25 viewport / both themes
- New display markers/date-stamps: readiness-card temp row "Pre-re-key" chip on the Cloud fallback;
  heart-rate page VO₂ max / vascular age "as of \<date\>" stamps; RHR/HRV/SpO₂ tiles append the
  reading's date when it isn't today's; admin tester drops the dead Battery stat (live plugin
  battery strip unchanged). All server/JSON contracts + route SSR verified on the dev server
  (readiness-score new fields present / `resilienceLevel`+`sleepTimeStatus` gone / 10c derived
  stress preserved; VO₂ date-stamp via a seeded pre-re-key row; health-insight + ai-chat 200).
- **Unverified:** the pixel-level appearance of the new chips/date lines at ≤640px in **both**
  dark and light themes — no browser in the sandbox (Playwright unavailable). JS/server-only change
  (no native/safe-area/gesture/offline-first surface), ships via Railway, no APK rebuild. Give the
  markers an on-device eyeball on the next APK build.

### [workouts] "Preparing your AI workout" pre-start gate (v1.156.0, poll fix v1.165.2) — UI device-confirmed; generation-success still to verify
- New behavior: while an ai_dynamic non-baseline prescription is regenerating (`consumed` + null),
  the pre-workout screen shows a "Preparing…" state (Start held) and bounded-polls workout-data
  (~10 × 3s = 30s) until the AI numbers land, then swaps them in; on timeout it reveals the base
  numbers with a note. Server flag (`isAiPrescriptionPending` + `aiPrescriptionPending` in
  `/api/workout-data`) and the helper are unit-tested.
- **Device-CONFIRMED (owner screenshots, 2026-07-17):** the "Preparing…" card + Start-gating render,
  and the timeout→base-fallback note renders. Those halves of #584 are verified.
- **v1.165.2 fix:** the poll was re-firing `/prescribe` every tick (cachedFetch always revalidates →
  workout-data re-fires generation), bursting ~8 Gemini calls in 24s and rate-limiting itself into
  the 502 → base-fallback the owner hit. Poll now sends `?poll=1` to read-only-check (no re-fire);
  generation fires once per screen-open + on manual refresh.
- **Still to verify on-device:** that a real generation now **succeeds** (preparing → moderated numbers
  swap in) rather than falling back — the rate-limit was the suspected cause but can't be reproduced
  in the sandbox. If it still falls back after v1.165.2 with only one generation firing, the failure
  is a deeper `/prescribe` error (Railway logs needed).

### [devices][heart-rate] Polar H10 chest-strap live HR (v1.154.0, this session) — shipped, NOT verified on-device
- The whole BLE half is device-only: pairing via the OS picker, streaming, the worn-gate
  fallback (unclip → ring takes over in ~15 s, re-clip → strap reclaims), reconnect retry, and
  two-device coexistence with the ring's own GATT connection. The web sandbox exercises none of
  it (`@capacitor-community/bluetooth-le` is native; the source degrades to inert `disconnected`).
- **Requires an owner APK rebuild first**: `npx cap sync android && ./gradlew assembleDebug`
  (new native plugin — self-registers, no `MainActivity` edit). JS/server halves are live via
  Railway on merge.
- Sandbox-verified: parser/merge/rMSSD unit tests (16), `/api/hr-ingest` +
  `/api/oura/hr-data?sessionId` live-route smokes against the local DB (RR beat-time
  reconstruction exact; seeded ±25 ms alternation returned rMSSD 25), full suite green,
  `pnpm build` clean.

These are the **open** risks — mostly features that shipped but were only verifiable in the web
sandbox, never on the Samsung S25 (no Capacitor/native SQLite/safe-area insets in the sandbox).
Run `docs/device-smoke-checklist.md` as the concrete on-device verification step.

### [sleep][devices] Neural SleepNet stager now primary (v1.151.0, this session) — assembler validated on 3 real nights; production 5-min output not yet eyeballed on-device
Oura's `sleepnet_moonstone` model (ONNX, onnxruntime-node, server-side in the rollup) replaced the
heuristic stager as primary; the heuristic stays the automatic fallback when inference/preprocess
can't run. Validated via the admin dump on 3 real nights (07-14/15/16): sane inputs (HR ~62–66 bpm,
full-night beat span) and REM 21.6–25.9% (in/near the Cloud band 23–28%), vs the heuristic's erratic
17.6–24.2%. **Open:** the production path downsamples the model's 30-s hypnogram to the 5-min grid
(majority vote) — the resulting `sleep_sessions` %s haven't been compared against the admin dump's
30-s %s on-device yet. After deploy, cross-check the Health tab sleep card vs `/admin/oura-ble` →
SleepNet dump for the same night. Also `spo2=0` on all dumps (the ring isn't feeding SpO₂ to the
assembler — minor, REM is right without it; tag mapping TBD). Perf: runs one ONNX inference per night
in the aggregate — negligible for a normal sync, ~adds up over a full-history redecode.

### [platform] Admin console G-1 domain-section skeleton — ① Data section device-verified (owner, on S25 APK)
`oura-ble-debug.tsx` was re-sliced into the six domain `CollapsibleSection`s. Every BLE lever was moved
**verbatim with its handler** (state stays at the top level of the component, so wiring is preserved by
construction), and it's tsc/lint clean + builds. **✅ Owner confirmed on-device (screenshots, real S25
APK + production data):** the ① Data·Ingestion·Retention chevron renders and expands correctly, and its
G-2 footprint card + **Lever 1b backfill button work end-to-end against real data** (see the dedicated
Lever 1b entry below). **Remaining to spot-check:** the other five domain sections (Sleep,
Steps·Activity·Energy, Recovery·Readiness·Illness, Cardio·Body-comp, Cloud-legacy) — chevron
render/toggle and that a moved lever in each still fires (Sync/Drain, a HR lever, Enable steps, Dump
sleep frames, Battery soak). Hand-rolled chevrons in `sample-inspector.tsx` / `time-audit-card.tsx` /
`admin-content.tsx` are not yet converted (deferred).

### [readiness] Illness radar advisory render (v1.150.0, this session) — shipped, NOT verified on-device
The radar logic + readiness-route suppression are verified end-to-end on the dev server (a +3σ
skin-temp night → `fever`, readiness 85→22). The **advisory line** in the readiness detail
(`components/health/health-score-detail.tsx`) is a plain bordered text card (Lucide icon + flag label +
copy) inside an existing scroll container — no safe-area/fixed/gesture surface, so low device risk — but
its Samsung WebView render was not checked on-device. Verify the advisory shows on a real elevated/fever
night. Also not yet persisted to `oura_daily_derived` (analysis record deferred to the readiness-persist PR).

### [workouts] Next-workout prescription card on the done screen (v1.149.0, session 295) — shipped, NOT device-verified · needs: browser
Server/JS only (no APK rebuild), but the plan's own gate is on-device: complete a workout on
the APK, tap "Show" on the new "Next workout" card, and confirm the previewed per-set
weights/reps/rest match what `/workout` actually opens with for that next session. Web `pnpm dev`
verification only proves the endpoint returns a well-formed response and the card renders it —
it cannot prove the previewed loads agree with the live workout screen's own computation for a
real AI-dynamic prescription, since the seeded dev-DB user's exact periodization state wasn't
independently cross-checked set-by-set.

### [workouts] Rest-timer status-bar chip (v1.147.0 → v1.166.0, session 292) — CONFIRMED working on-device
Android 16 promoted ongoing notification (One UI Now Bar / status-bar pill) showing a live rest
countdown during a workout, tap-to-reopen. Native-only: an `AndroidRestChip` JavascriptInterface
bridge in `MainActivity.java`, `POST_PROMOTED_NOTIFICATIONS`, `ic_rest_timer` drawable, a guarded
`lib/native/rest-timer-chip.ts` bridge (no-op off-device), start/stop wiring in `workout-screen.tsx`,
Profile → Preferences toggle (`ta_pref_rest_chip`, default on).
**CONFIRMED on-device (owner APK 2026-07-16): the pill shows with the ticking countdown.** Two
device-only gotchas that took the debugging: (1) Samsung gates third-party Now Bar behind
**Developer options → "Live notifications for all apps"** (off by default) — must be on; (2) the app's
**PiP window suppresses the pill** — while the app shows PiP, Samsung hides its status-bar chip.
Promotion mechanism: `NotificationCompat.Builder` + `setRequestPromotedOngoing(true)` (androidx.core
1.17.0, added 1.17.0-alpha01) + `CATEGORY_STOPWATCH`; the hand-written raw extra (v1.147.0) did NOT
promote — NotificationCompat does.
**v1.155.0 follow-ups (native, MainActivity — NOT yet device-verified):** (a) **suppress PiP during
rest** so the pill is the leave surface (PiP still opens for the active set) — gated on `restChipActive`
in `onUserLeaveHint`; (b) **overtime persistence** — a `Handler` re-posts the chip counting UP at the
rest boundary (`setChronometerCountDown(false)`, `setWhen` now in the past) instead of `setTimeoutAfter`
clearing it at 0:00 (which let another app's chip steal the slot); safety timeout extended to 30 min;
(c) **"Start set" notification action** reusing the PiP `ACTION_LOG` broadcast (pipReceiver moved to
onCreate→onDestroy so it's delivered while backgrounded — no app open, no new JS). **On-device smoke
after rebuild:** home-out during rest → pill (no PiP); let it hit 0:00 → flips to count-up overtime,
doesn't vanish; tap "Start set" from the notification → next set starts; home-out during a set → PiP
still works. **CONFIRMED on-device (owner APK 2026-07-17): pill-during-rest + overtime count-up both
work.**
**v1.165.3 (native, NOT yet device-verified):** overtime tints the pill **red** — `builder.setColor(0xFFEF4444)`
(the app's overtime red) on the count-up re-post only; the Now Bar chip follows the notification's
accent colour, so the countdown pill keeps the system-default blue and the overtime pill goes red. If
the chip doesn't pick up the colour on-device, the fallback is a red variant of `ic_rest_timer` (the
chip always tints its icon by `setColor` even when it won't recolour the pill background).
**v1.166.0 (green warm-up/prep pill — native + JS, NOT yet device-verified):** the pill now also shows
during the two "prep" periods it previously skipped, tinted **green** (`WARMUP_COLOR = 0xFF22C55E`):
the whole-workout warm-up (`store.mode === 'warmup'`) and the pre-set get-ready / bar-load screen
(`mode === 'active' && !timerStarted`). The bridge gained a `mode` arg (`"rest" | "warmup"`);
warm-up/prep **counts up** from its start anchor (green, no overtime), a working-set rest still counts
down (blue → red). Anchors: warm-up = `workoutStartMs`; get-ready = `workoutStartMs +
readyElapsedBaselineSec*1000` (survives a background remount). No "Start set" action on the green pill.
PiP is already suppressed while the chip is active, so these prep periods now show the green pill
instead of PiP too. Colour model: **green = preparing, blue = resting between work sets, red =
overtime.** On-device smoke: warm-up screen → green count-up pill; get-ready/bar-load before a set →
green; start the set → clears; between working sets → blue; past 0:00 → red.

### [workouts] Rest timer on the "All sets done!" screen (v1.146.0) — shipped, NOT device-verified · needs: browser
After logging the last set of an exercise, the rest countdown ring now stays on the "All sets
done!" screen (`active-workout-screen.tsx`, extracted into `components/workout/rest-ring.tsx`)
instead of being replaced by a static card — the rest period was always running (beep +
notification already scheduled; the last set IS awarded `progressionStyle[last].restSec`, 90s
fallback), only the ring was hidden. Tests/lint/`tsc` green, `/workout` compiles + renders 200 in
`pnpm dev`. **NOT verified on the APK** — reaching the all-sets-done state requires driving the
full log-all-sets flow, and the ring is a visual change on the workout screen. Safe-area untouched
(ring is in the existing centre flex zone). On-device smoke: log every set of an exercise, confirm
the ring counts down on the done panel and rolls into red "Overtime" if you wait.

### [heart-rate] Live-HR beat-median smoothing (v1.145.1, 2026-07-14) — shipped, NOT verified on-device
Owner-reported spiky in-workout/rest HR readings. Root cause: the live path decoded a *batch* of
beats per BLE frame but surfaced only the single newest one (`latestBpmWithTsFromFrames` →
last-array-element), so instantaneous beat-to-beat HRV read as jumpy and a lone motion/decode
artifact showed unfiltered. Fix (pure TS, JS-only — ships via Railway, **no APK rebuild**, no
native/burst-cadence change): `decode-live-hr.ts` now exposes `smoothedBpmFromFrames()` which
medians the most-recent `HR_AVG_WINDOW_BEATS = 10` fresh beats (reusing the shared `median()`),
applied at the decode source so the live number, exercise trace, and sparkline all inherit it; the
near-live freshness/dedup guard is preserved and the `latest*` newest-beat functions were removed.
Also added an admin **Live HR test console** (`components/oura-ble/live-hr-test-console.tsx`, mounted
on `/admin/oura-ble`) that surfaces the manager diagnostics (frames/HR-frames/decode-hits), the raw
within-batch beat spread the median smooths over, and a rolling log of surfaced readings with deltas.
Unit tests (median-not-newest, artifact rejection, window bound, freshness guard, `allBeatsFromFrames`)
+ `tsc`/`eslint` clean; the full local `pnpm build` fails only on the pre-existing sandbox-absent
`@capacitor/splash-screen` module (CI installs it). **NOT verifiable in the web sandbox** (no BLE
frames — `getOuraBle()` is null): the on-device smoothness of the rest-window readout. On device:
during a workout rest (or via the new console's Start/Measure), confirm the surfaced bpm tracks
smoothly with no single-beat spikes while `decodeHits` advances, and that the batch-spread row shows
multiple beats per burst. If bursts prove sparse, `HR_AVG_WINDOW_BEATS` is the single tunable.

### [app-shell] Persistent tab shell (v1.145.0, session 298) — shipped, NOT verified on-device
Instant tab switching via a persistent client `TabShell` that keeps all five tab trees mounted
and flips visibility instead of navigating routes (`components/shell/tab-shell.tsx` +
`tab-page.tsx` + `tab-visibility.tsx` + `lib/shell-nav.ts`). **Verified in the web sandbox**
(Playwright vs `pnpm dev`): every tab tap — first activation and revisit — issues zero
RSC/document requests, URL syncs per tab, scroll position and sub-tab/date state survive
switches, deep links work. `pnpm lint`/`tsc`/tests (1294)/`build` green. **NOT verified on the
S25**, and several load-bearing behaviours only exist on-device: (a) the actual *feel* and paint
timing in the Samsung WebView (the whole point of the change); (b) memory/GC pressure with all
five heavy trees kept alive at once (`content-visibility:hidden` skips their *rendering*, not
their JS state — if this janks on-device, the fallback is to unmount the least-recently-used
hidden tab, but that costs its keep-alive); (c) the Android hardware back button now exits the
app from a tab instead of unwinding tab history (intended, `replaceState` not `pushState` — but
confirm it doesn't strand a mid-workout leave-dialog); (d) `inert`/`content-visibility` WebView
rendering; (e) the Nutrition cross-midnight rollover (only reproducible by rolling the device
clock). Run the "Persistent tab shell" section of `docs/device-smoke-checklist.md` on-device.

### [app-shell] R7 UI Polish & Accessibility (v1.143.7, session 287) — shipped, PARTIALLY verified
Chart black-bar fix, double-inset sheet fix, `DismissibleBanner` primitive + two banner
rewrites, `aria-expanded` sweep, and palette-literal→token/emoji→icon swaps (see Current Status
above for the full list). `pnpm lint`/`tsc`/tests/build all green, and most of it was verified
live via Playwright in both light and dark theme. **NOT verified live: the workout-load-
comparison chart's black-bar fix inside the actual Day-in-Review sheet** (`day-review-sheet.tsx`
→ `workout-load-comparison-chart.tsx`) — the verification pass couldn't get the sheet to expand
past its collapsed header in headless Playwright, and the seed data had no day with an actual
comparison chart to render. The fix is the same `resolveColor()` pattern already verified working
elsewhere (the R6 PR's HR-recovery-chart fix, and `trend-sparkline.tsx`'s long-standing use of
it), so risk is low, but it hasn't been observed rendering. Also **not exercised: the Oura
stale-sync amber+warning-icon indicator** (`more/oura-section.tsx`) — the seed data's Oura Ring
was never connected, so the stale-sync branch never renders. A follow-up pass should open the
Day-in-Review sheet on a day with real workout-load history and confirm the "today" bar is
brand-coloured (not black) in both themes, and separately confirm the Oura section's stale-sync
line shows amber + a warning icon when `lastSyncedAt` is old.

**Also found during this pass, not fixed (out of scope, noted for a future backlog entry):** a
reproducible React hydration mismatch on Home's week-strip "today" cell — SSR renders a muted,
non-"today" `aria-label`/styling; the client re-renders it brand-coloured/bold with "today" in
the label immediately after hydration. Root cause looks like the today-check running with a
different date server-side vs client-side (the classic `todayInTz()` SSR/client boundary drift
this project's CLAUDE.md already has a standing rule about).

### [app-shell] R6 Performance & Paint, Chunks 1/2/3/5 (v1.143.6, session 287) — shipped, PARTIALLY verified
Bundle-size, hydration, and render-hygiene batch (see Current Status above for the full list).
Every change is either a pure import-strategy swap (dynamic-with-skeleton → static, static →
dynamic), a `useMemo`/leaf-component extraction with no logic change, or a data-fetch
consolidation/split verified against the Network panel — `pnpm lint`/`tsc`/tests/build all
green, and the majority was verified live via Playwright (Home reload, all 3 Health tabs,
Nutrition's 6-date swipe — see Current Status for specifics). **NOT verified live: the Warm Up
screen's memoized `MuscleHeatmap` (PERF-2 fix in `warmup-screen.tsx`)** — the verification
pass's workout-entry point wasn't reached in the time available. The fix is a direct,
minimal `useMemo` wrap copying an already-shipped identical fix in the sibling
`active-workout-screen.tsx:176-181`, so risk is low, but this hasn't been observed rendering.
A follow-up pass should start a workout, open the Warm Up screen, and confirm the muscle
diagram renders correctly and does not re-render every second (a temporary `console.count` in
`MuscleHeatmap` during the check, removed after).

### [workouts] Workout-system hardening Chunk 5 (v1.143.5, session 287) — shipped, PARTIALLY verified
UI/UX polish + in-workout HR theming sweep across nine workout files (see Current Status above
for the full list). All server/client logic is either pure-function-driven (weight snapping, RPE
re-tap) or a mechanical color-token/icon swap with no new branching — `pnpm lint`/`tsc`/tests/build
all green. **Verified live via Playwright:** `/workout-select`'s carousel dots and card layout
render correctly in both light and dark themes at the 384×832 viewport. **NOT reached live** (ran
out of time mid-verification): the active-workout screen's header buttons and set-card borders,
the exercise-summary screen's chevron/1RM-arrow icons, the done-screen PR-card color / share-icon
visibility / HR error-retry state, and the weight-dial's check/recommended-dot icons — these were
verified via code review and the full build/lint/tsc/test gate only, not observed rendering. A
follow-up on-device or Playwright pass into an actual active workout should confirm these render
as intended (theme-token borders visible, icons showing, no broken layout).

### [devices][platform] Admin Oura BLE debug UI cleanup (v1.143.3, session 297) — shipped, NOT verified on-device
Pure UI reorganisation of `/admin/oura-ble` (owner-requested — the screen had grown a single giant
"Advanced (raw protocol)" panel cramming ~25 raw buttons + four large tester cards together). Now:
raw commands grouped by function under one collapsible (`Raw protocol commands`), and each tester
(Step calibration, Live step test, Continuous capture, Battery soak, Sleep epochs) is its own
`CollapsibleSection` (new shared primitive `components/ui/collapsible-section.tsx`). The log console
gained Copy + Clear buttons (new shared `lib/use-copy.ts` hook, WebView-first execCommand path)
so logs no longer need screenshotting; the four tester cards' duplicated copy logic was folded onto
the same hook. **No functionality was removed** — all handlers preserved; this is layout only.
`tsc`/`eslint` clean. **APK-only screen — the native OuraBle plugin is inert in the web sandbox, so
the collapsibles/copy could only be checked to compile, not exercised with real ring data.** On
device: open `/admin` → Tools → Oura BLE debug, confirm each section expands/collapses, the raw
buttons still fire (watch the Log section), and the log Copy button lands the full text on the
clipboard. Candidates for outright removal (kept this pass because in-use status couldn't be
confirmed from the sandbox): Step calibration and Live step test are the pre-production step-count
spikes now superseded by Continuous capture; Battery soak was a one-off measurement.

### [sleep][devices] BLE sleep-timing fixes (v1.143.2 → v1.144.1, sessions 292–293) — verified on real data; window clamp hardened
Three owner-reported sleep-timing fixes across two nights.
**(1) Future wake time (v1.143.2):** the sleep detail could show a wake a few minutes in the future when
opened right after waking; `lib/sleep/actual-window.ts` now anchors the end to the ring's recorded wake
(`phaseWindowEnd ?? sleepEnd`). Verified on-device (07-14 read `10:14 pm – 6:07 am`, no future wake).
**(2) Bedtime too early (v1.143.2, then hardened v1.144.1):** the night window included evening
wind-down before real sleep. v1.143.2 clamped to the 0x72 sleep-accelerometer span (fixed 07-14: 8:42 pm
→ 10 pm). But 07-15 defeated it — a short dense-but-AWAKE burst at 19:53–20:03 (elevated HR + movement)
made the accelerometer "start" ~2h early, so bedtime showed 8:28 pm. v1.144.1 reworks the clamp
(`lib/sleep/sensing-span.ts`) to key on HR-sample **density** per epoch (the ring spot-checks HR while
awake but streams hundreds of beats/epoch continuously only while asleep), clamping to the span of
substantial dense runs — dropping a short evening burst while still spanning a genuinely split night.
Pinned to both owners' per-epoch dumps (07-14, 07-15) + a DB-backed end-to-end regression; the 07-09
split-night merge test stays green. **Server-side — ships via Railway, retroactive on a redecode; no APK
rebuild.** ⛔ v1.144.1 NOT yet confirmed on real data: after deploy, redecode `2026-07-15` and check
bedtime snaps to ~10 pm (was 8:28 pm) and other recent nights' durations didn't shift unexpectedly.
**(3) Debugger timeout fixed (2026-07-21):** the per-night sleep-epoch dump 500'd with a gateway
"upstream error" because it re-decoded every stored sample + re-aggregated all history (`debugDate`
forced `fullHistory`). Added a `?dump=1` lightweight path (skip re-decode, keep the 35-day bound via a
`dumpOnly` flag), applied to BOTH the "Sleep epochs" button and the "SleepNet neural stager" dump
console (which had the same timeout + a bare `res.json()` that crashed on the plain-text error). Admin-tool only.
**(4) Evening-activity burst pulled into the night (v1.184.5):** the owner's 07-21 dump (via the fixed
debugger) showed it was NOT an orphan — a 6-epoch dense evening-activity burst at 17:19–17:44 (~4h before
real sleep) got spanned into the night by the density clamp's "first-to-last substantial run" logic →
window 17:19–06:44, ~13h, bedtime ~5:53 pm, and SleepNet staged the sparse evening in between as sleep.
Fixed in `lib/sleep/sensing-span.ts`: anchor the span on the LONGEST substantial run and fold in only
comparable-length neighbours (≥ 0.5× longest), so the tiny burst drops and the night starts at real onset
(~21:39); a genuinely split night stays whole (07-09 merge test green). Pinned to the 07-21 dump structure.
**⛔ v1.184.5 NOT yet confirmed on real data:** after deploy, redecode `2026-07-21` and check bedtime snaps
to ~10 pm (was 5:53 pm) and the duration is ~8–9h.

### [activity][devices] Battery-soak tester for the continuous-streaming step counter (v1.141.0, session 291) — shipped, NOT verified on-device
`lib/oura-ble/battery-soak.ts` + the "Battery soak" card on `/admin/oura-ble`. Everything it
does is BLE (feature toggle, accel stream, watchdog re-arm, reconnect handling, measurement
restore) — inert in the sandbox, so it shipped unverified by design; the owner's daytime soak
run is itself the verification. Specific risks to watch on the first run: (a) the guaranteed
restore — after Stop, tap Feature status and confirm DAYTIME_HR/SPO2/REAL_STEPS are back ON;
(b) WebView background throttling stalling the JS re-arm timers with the screen off (stalls
are logged in the exported JSON — that data feeds the Chunk 3 native decision); (c) the
reconnect path re-applying REAL_STEPS-off fast enough to keep the stream alive. An app kill
mid-soak self-heals (the native service re-enables all measurements on every connect).

### [activity][devices] Ring step count over-counts on full days; step data auto-refresh unverified on-device (session 290) — over-count open, fix shipped-but-unverified
Two parts. **(a) Over-count — OPEN.** The ring's own step estimate (col14 walk gate,
`lib/health/step-estimate.ts`) reads ~16,800 vs ~11,260 (Garmin)/~10,500 (Samsung) on a full day.
The gate was only ever calibrated on isolated short walks; across a full day, non-walk activity
(driving, gym, cooking, gestures) trips scattered low-col14 windows that each add 30 steps. The
prior "accurate" totals were Samsung Health Connect (now off), so the ring's full-day estimate has
never actually been validated. **Direction decided (session 291):** col14 is unfixable (can't
separate walking from rhythmic hand motion) and is being replaced by the gait-gated accel counter —
see `docs/superpowers/plans/2026-07-13-ring-accel-step-counter.md` (REVISION section) and backlog
item 1; col14 retires in that plan's Chunk 2. Additional additive risk to fold into the fix:
`body-metadata` adds `activity_logs`
(treadmill) steps on top of `body_metrics.steps`, and `mergeStepSources` adds non-overlapping live
windows on top of the gate estimate. **(b) Auto-refresh fix — SHIPPED (v1.138.1), NOT verified
on-device.** `sync-provider.tsx` now invalidates Oura caches when the native ring service's
autonomous (hourly/on-connect) drain lands new data, so steps update without a manual pull-to-sync.
Native/BLE — traced and reasoned in-sandbox (no ring), only truly confirmable on the S25 APK: leave
the app an hour with the ring connected and confirm today's steps update on their own.

### [nutrition] Nutrition quick-edit sheet (NUT-1/2/3) fixes — shipped, interactive verification blocked in the sandbox this session (v1.139.10, session 287)
`QuickEditLogSheet`'s stale-quantity fix (added `key={editingLog?.id}`), its synchronous
cache-invalidate/callback restructure, and `SavedMealsSheet`'s `logDate` threading all shipped
in `fix/nutrition-fixes-chunk1`. Live Playwright verification of these three (open the sheet by
clicking the pencil icon on a logged food row) repeatedly failed in this session's sandbox — the
click handler visibly fired (a `DialogContent` a11y warning appeared in the console) but the
sheet's content never rendered in the DOM, across a fresh dev-server restart and several click
strategies (locator click, raw mouse click, direct `onClick` invocation). A sibling fix in the
same PR (NUT-4, a plain API 400) verified live without issue on the same page in the same
session, so this looks like an environment-specific rendering/timing quirk rather than a defect
in the fix — but it was never actually confirmed working. **Gate: manually open the quick-edit
sheet on two different food logs in a row** (web `pnpm dev` is sufficient — this is pure React
state, not device-gated) and confirm the second log doesn't show the first log's stale quantity,
before trusting this fix in production.

### [nutrition][platform] Supplement/meal-type reminder cancellation (NUT-5) — shipped, NOT verified on-device (v1.139.11, session 287)
`computeSupplementReminderActions` now emits `cancel` for inactive/reminder-disabled supplements
instead of silently dropping them, and the manage-sheet handlers + meal-type deletion call
`cancelSupplementReminder`/`cancelMealReminder` directly. Verified only via unit tests — the
actual `LocalNotifications.cancel` OS call is native-only and no-ops in this sandbox
(`Capacitor.isNativePlatform()` is `false`). Gate: on the S25 APK, enable a supplement reminder
2 min out, then disable/delete it before it fires — the OS notification must not appear; delete
a meal type with reminders on and confirm its reminder doesn't fire either.

### [nutrition] Nutrition hygiene pass (NUT-10/NUT-11) — shipped, interactive verification blocked in the sandbox this session (v1.139.13, session 287)
R5's final chunk: removed the dead "save to my food library" toggle from the scan review screen
(`ReviewStep`), threaded a `region` hint into the AI-correction refine call, clamped quantity
inputs (`QuickEditLogSheet`/`AssignStep`/`SavedMealsSheet`) to a sane range, gated `AssignStep`'s
"today after logging" projection off for past-day logs, moved `meal-type-manager.tsx`'s
drag-reorder PATCH out of the `setMealTypes` state updater, and bumped touch-target padding
(`p-1.5`/`p-2.5` → `p-4`, ≥44px) plus an emoji→Lucide swap and a hex-literal→token swap across
`saved-meals-sheet.tsx`/`meal-type-manager.tsx`/`meal-card.tsx`/`manage-supplements-sheet.tsx`/
`water-log-sheet.tsx`. These are pure client-side changes, **not device-gated** — the gate is a
plain `pnpm dev` check, not an APK smoke run. But this session hit the same Sheet-rendering
sandbox limitation as the NUT-1/2/3 row above (click handlers fire — confirmed via a
`DialogContent` a11y console warning — but sheet content never renders in this session's headless
Playwright/Turbopack combination), so none of the Sheet-gated pieces above were interactively
confirmed; only the meal-types reorder PATCH endpoint and the scan route's `region` acceptance
were verified live via direct API calls. **Gate: manually exercise each surface via `pnpm dev`**
— open the scan review screen and confirm the save-to-library toggle is gone, type an
out-of-range quantity into the quick-edit/assign/saved-meal sheets and confirm it clamps, log
against a past day from the day-detail sheet and confirm the "today" projection is hidden,
reorder meal types twice in a row (React 19 StrictMode is on in dev) and confirm only one PATCH
fires per drag, and eyeball the touch-target sizes are visibly larger. The `p-4` touch-target
bump is code-only per CLAUDE.md's unconditional ≥44px rule — not yet confirmed against a real
48dp on-device measurement.

### [app-shell] Home/Nutrition/More bounded-shell fix (v1.138.13, session 294) — shipped, NOT verified on-device
Switched the three tab screens from `min-h-screen` (page body scrolled under the fixed tab bar) to
the bounded `h-screen` shell Health already uses, so the inner container scrolls and the nav can't
overlap bottom content. Verified only in the web sandbox (safe-area insets render as 0 there); the
on-device gate is that the last card and the rest-day streak banner clear the tab bar — including the
raised center Workout button, which pokes ~16px above the nav while `pb-nav-safe` gives ~12px
clearance (so the banner's bottom-center could tuck a few px under the button; the banner's own
padding keeps its text clear). Also note the class of bug: the static safe-area CI checks are
grep-based and can't detect a correctly-classed container that isn't the actual scroll context.
Run `docs/device-smoke-checklist.md` on the S25.

### [platform] Dependabot remediation (2026-07-27) — cleared from 24 alerts down to 1 accepted residual
Superseded the session-287 entry above (that one predates `gh`-less alert access being worked
around via `pnpm audit` + reading GitHub's own push-time advisory summary). Two PRs cleared the
standing threshold item:
- **#803** — bumped `next` (App Router Server Actions DoS/SSRF/cache-confusion advisories) and
  `sharp` (libvips CVEs), plus pnpm overrides for transitive advisories (`js-yaml`, `tar`,
  `postcss`, `brace-expansion`). Deliberately left `next-auth`/`@auth/core` out — auth/session
  changes need their own sign-off gate per CLAUDE.md, filed separately rather than riding in on a
  routine dependency bump. `pnpm audit` count: 24 (3 critical/13 high/8 moderate) → 11 (3
  critical/4 high/2 moderate); the remaining `pnpm audit` count is a different accounting than
  GitHub's own dependency-graph scan (see below), and does not by itself mean 11 GHSA alerts.
- **next-auth bump to `beta.32`** — separate PR fixing the auth-check-fail-open CVE, run through
  the auth-change confirmation gate rather than folded into #803.
- **Residual, accepted, documented (not silently dropped):** two `sharp` copies below 0.35.0
  remain out of our direct control — one bundled inside `next@15.5.22` itself (Next pins its own
  `sharp` for the Image Optimization API; overriding it risks breaking Next's image pipeline in
  ways untested upstream, so this waits for Next's own bump) and one inside `@capacitor/assets`'s
  dev-only CLI (never invoked at runtime, never exposed to external input). GitHub's own scan
  reports this residual as **1 high** alert as of this write-up (confirmed via the advisory link
  GitHub prints on every push to `main`, since this sandbox has no `gh` CLI/Dependabot-alerts API
  access). **Next implementer session:** no action needed below the ≥5 high/critical threshold —
  re-check when `next` bumps its bundled `sharp` past 0.35.0, or opportunistically if touching
  `@capacitor/assets`.

### [app-shell][platform] Home-day-timeline reads server-only (R3 SYNC-R3, session 287) — known limitation, documented exception
`components/home-day-timeline.tsx` renders today's Home timeline (workouts, food, mood,
activity, supplements — all individually local-first domains) from `/api/day-timeline` only. It
merges several already-local-first domains into one cross-domain, server-assembled aggregate,
so it doesn't cleanly fit either "trivially local-first" or the sanctioned cross-session-
aggregate exception list — a real client-side timeline assembler was judged out of scope for the
R3 batch that found it (see the plan's Task 2.2, `docs/superpowers/plans/2026-07-09-r3-offline-first-integrity.md`).
**Effect:** a same-day offline log (food/mood/activity/workout) won't appear on the Home
timeline until the next sync, even though the underlying domain writes are already
local-first-safe and not lost. Documented as a sanctioned exception in CLAUDE.md's Offline-First
read-site status list. Revisit if this becomes a live user-reported pain point.

### [app-shell] Perceived latency / More-tab cache-wipe (v1.133.0, session 277) — shipped, NOT verified on-device
Both structural-latency findings from the 2026-07-11 offline-feel review shipped in full: tab
taps no longer do a network RSC round-trip on revisit (`experimental.staleTimes`, empirically
verified zero-network against `pnpm dev`), app open serves the cached document stale-while-
revalidate instead of blocking network-first, and More's pull-to-sync no longer calls
`invalidateCache('')` (replaced with targeted domain-flag invalidation) or fires the frozen Oura
Cloud sync unconditionally (now BLE-freshness-gated). Review:
`docs/reviews/2026-07-11-offline-feel-performance-review.md`; plan
`docs/superpowers/plans/2026-07-11-instant-nav-and-app-open.md`. P4 (bundle the shell into the
APK) remains the unqueued Track A endgame bullet. **Superseded (tab-tap half):** the persistent
tab shell (v1.144.0, session 298) took the RSC round-trip off tab switching entirely — warm tab
taps no longer touch the router at all, so the `staleTimes` router-cache behaviour now only
matters for *cold* route entries (app open, deep links, back from `/profile`/`/admin`). **What's
NOT verified:** real cold-open timing and the splash screen (`@capacitor/splash-screen`,
compile-gated only — needs an owner APK rebuild to take effect). See
`docs/device-smoke-checklist.md` §8.

### [platform][app-shell] Offline shell availability (v1.130.0, session 271) — shipped, NOT verified on-device
Fixed in full: the service worker now precaches every `_next/static` asset + an unauthenticated
`/offline` fallback page per build, retains the current + previous cache generation across
deploys instead of wiping, and falls back to the exact cached document or `/offline` (never a raw
Chromium error) on a failed navigation fetch. Verified via a genuine offline repro in-sandbox
(dev server killed outright, not `context.setOffline`) — see session 271's journal entry for the
before/after. **What's NOT verified:** the plan's own stated merge gate is on-device Samsung
WebView airplane-mode behaviour (`docs/device-smoke-checklist.md` §2b) — whether the WebView
actually keeps the SW registered and persists Cache Storage across a real deploy + reopen, real
airplane-mode radio behaviour, and native `@capacitor/network` events. No physical device was
available in this sandbox. Also unverified: the true `next build && next start` production path
(blocked on local Postgres SSL — see session 271's journal for the mechanism); verification ran
on `next dev` instead, which shares the identical SW/cache code path.

### [devices] Oura BLE derived metrics (v1.120.0) — verified with synthetic frames only, not real ring data
The SpO₂ R/PI→% calibration, the 5-min binned HR series (`oura_heartrate` source `ble`), and the
signal-density wear time all shipped verified end-to-end against synthetic frames in the sandbox —
real-ring unknowns remain: whether/how often the Ring 5 emits `0x86 aohr` daytime HR (the daytime
half of the HR chart; sleep HR from IBI is proven), whether the 15-min-bin density yields a
wear-time figure comparable to Oura's (~23 h/day on the owner's old chart), and how close the
gen4-coefficient SpO₂ estimate sits to Oura's reported values. **Owner:** after deploy tap
**Redecode**, then compare the Health cards/charts against pre-re-key Oura app history (backlog
has the validation item). If aohr turns out absent, daytime HR needs the on-demand-measurement
path instead — a follow-up, not a fix to this.

### [devices] Oura direct-BLE: drained history could be silently lost (BLE-1) — FIXED in two layers; needs APK rebuild + Full re-sync
Found in the session-217 review and **confirmed live the same day** (ring delivered
`green_ibi_quality×1520, ibi_and_amplitude×360, spo2_r_pi×103, temp×520, hrv×2`; the DB kept
12 IBI events and zero of three metric types). Fixed in two layers: **v1.117.5** decoupled
the cursors — the persisted resume cursor only advances via `confirmStored(ds)` after the
server 2xx's (durable, but only while the tester screen is mounted to forward frames);
**v1.119.0** makes it set-and-forget — the native service POSTs each drained batch itself
(shared-CookieManager session cookie) and drives `confirmStored` internally, drains auto-run
on connect + hourly, and a failed batch skips all later confirms so the cursor never jumps a
hole. **Owner actions:** (1) rebuild + install the APK (`npx cap sync android && ./gradlew
assembleDebug`, or take the new Android CI job's `app-debug-apk` artifact); (2)
`/admin/oura-ble` → Advanced → **Full re-sync**, then the data-integrity runbook in
`docs/oura-ble-operations.md` §4 — frame counters and stored per-event counts must agree for
every biometric type. Do the re-sync promptly: events the ring's finite buffer has already
overwritten are unrecoverable. Kotlin is compile-gated by the new Android CI job but NOT yet
verified on-device (incl. the native cookie-auth POST path).

### [devices][app-shell] Health screens frozen since the ring re-key (BLE-3/4, found session 217) — mapping SHIPPED v1.118.0; cutover SHIPPED v1.128.1; overnight verification remains
The ring left the Oura ecosystem on 2026-07-07 (Option A re-key), so the Oura Cloud has no
data after that date. **v1.118.0 closed the mapping gap:** `aggregateOuraRawSamples` now
rolls raw BLE samples into `sleep_sessions` (bedtime window, stages, efficiency, sleep
HR/HRV) and `body_metrics` (HRV/RHR/SpO₂ per wake day) automatically after each biometric
ingest — verified live against local Postgres with captured frames. **The Cloud-sync cutover
shipped v1.128.1 (session 268):** app-open/resume and Health-tab auto-syncs skip the frozen
`/api/oura/sync` when BLE data is <48 h fresh (`GET /api/oura-ble/freshness`), and the More-page
ring status reads the BLE timestamp instead of the permanently-empty Cloud sync. **Still open:**
verify against a real overnight drain on-device, `source` provenance and the per-epoch clock
anchor (both remain on the data-mapping item — backlog item 5), and the tester decoded-field
inspector. The 0–100 readiness/sleep/activity scores return with the Phase-5 own-scores work.

### [sleep][devices] Sleep hypnogram/stages over BLE — believed impossible, now corrected; rollup wired but UNCONFIRMED on-device (session 221)
Earlier journal rows (v1.119.4/.5) state the Ring 5 emits "no sleep-phase (0x4b/0x4e/0x5a)
events" and that stages are "null by design". **That was premature** — checked against
`open_oura` (the sanctioned source): the ring **does** emit its own hypnogram over BLE
(`sleep_phase_*` tags carry DEEP/LIGHT/REM/AWAKE; observed on a real Ring 5), and there's no
sleep feature to enable. Same pattern as the REAL_STEPS "can't enable → actually can"
correction. **Shipped this session:** the rollup now assembles `sleep_phase_5_min` + stage
hours from these events (single-tag-longest to avoid triple-counting; dormant until events
arrive), and the Health hypnogram was redesigned into a banded ribbon. **Still open (on-device,
backlog):** we've captured **zero** phase events so far, so a clean *worn-overnight →
next-morning* drain is needed (and a check that the sync cursor isn't skipping the staging span)
before the 30 s-epoch / single-tag / timestamp assumptions can be validated against a real
captured vector. Full analysis: [`docs/oura-ble-sleep-staging-findings.md`](docs/oura-ble-sleep-staging-findings.md).

### [devices] Oura direct-BLE Phase 2 plugin (v1.116.4, session 216) — RESOLVED on device by v1.117.x; connect-failure history retained below
**Resolution (2026-07-07, v1.117.1–.4):** clean scan → bond → MTU 247 → `auth: SUCCESS` →
READY in ~4.7 s, feature-enable acked, full multi-thousand-event history drain, real
biometrics decoded and stored (HR 82 bpm / temp 37.00 °C) — the go/no-go this row tracked
has passed. The paragraphs below are retained as the diagnostic record of the
connect-reliability rounds (status 133/147/135, Samsung `autoConnect` misbehaviour), which
remain the reference if a new failure signature appears.
The native Kotlin `OuraBle` plugin + `OuraRingService` foreground service + `/admin/oura-ble`
debug screen shipped **compile-gated only in the sandbox**: there is no Android SDK here, so the
gradle build + JUnit tests (`./gradlew :app:testDebugUnitTest`) and **every** on-device BLE
behaviour are unrun. **v1.116.1 fixed a real on-device bug found immediately after merge:** the
debug screen hung forever on "Checking native plugin…" — `getOuraBle()` (`lib/oura-ble/plugin.ts`)
returned Capacitor's `registerPlugin()` Proxy directly from an `async` function; since that Proxy's
`get` trap answers *any* property access (including `then`) with a callable, JS's promise-resolution
algorithm treated it as a thenable and called `plugin.then(...)` as a native method, which the bridge
rejected as unimplemented (`"OuraBle.then() is not implemented on android"`) — an unhandled
rejection that never let the outer promise settle. Fixed by wrapping the plugin in a plain
`{ plugin }` object, matching the pattern the codebase's only other `registerPlugin()` caller
(`gps-tracking.ts`) already used. Diagnosed via real `chrome://inspect` remote-debug console output
against the production APK — this is genuine on-device signal, not sandbox-inferred. Owner
verification still required for everything past this point: (1) confirm the fix loads (JS-only fix,
ships via Railway — no APK rebuild needed, just reopen the app); (2) run the plan's on-device spike
protocol (`docs/superpowers/plans/2026-07-07-oura-ble-phase-2-onphone-spike.md` §"On-device spike
protocol") — first connect + auth (record time-to-connect and the RE8 bonding behaviour), live
accel/battery/SyncTime/Live-HR (the RE10 0-beats retest), history drain, and a 2–3-day persistence
soak (connects/drops, Samsung battery-optimisation kills, wedge-guard). The **reconnection-UX
go/no-go** from that soak gates Phases 3–5 (decoder port → `oura_raw_samples` offline domain → our
own `lib/health/*`). **v1.116.2 addendum:** the owner's first real connect attempt showed the
scan/match logic working (found `Oura Ring 5`, correct mfr-id match, valid RSSI) but hit two
distinct generic Android GATT connect failures — status 133 (from a duplicate-start race, now
guarded) and status 147 (`GATT_CONN_FAIL_ESTABLISH`, mitigated with a connect-settle delay). The
owner then tried a Bluetooth-stack reset (toggle off/on) hypothesizing a wedged radio, but saw the
identical failure on the *old*, unpatched build — consistent with it being the reproducible code
race, not a stack-level wedge. **v1.116.3 addendum:** after rebuilding with the v1.116.2 fixes, the
race was confirmed genuinely fixed (a single clean scan→connect sequence), but a clean attempt
still hit status 133 ~10s after connecting — a different, well-known flaky spot in Android's BLE
stack unrelated to any app race. Added a bounded same-device connect retry (up to 2 extra attempts)
before falling back to a full re-scan, bumped the settle delay to 500ms, and fixed a genuine
off-by-one in the retry backoff schedule (`scheduleRetry()` was indexing `BACKOFF_MS` after
`consecutiveFailures` was already incremented, so the first retry fired at 10s instead of 5s —
confirmed against the on-device log). **v1.116.4 addendum:** tried switching `connectGatt()` to
`autoConnect=true` (handing connection establishment to Android's background BLE mechanism, the
standard fix for this failure class) with a bounded 15s timeout given the ring's rotating address.
On-device this was **worse, not better**: an instant, deterministic status-135 failure on every
attempt, including after a full Bluetooth toggle and a full phone reboot (ruling out accumulated
stack state) — since `autoConnect=true` is supposed to fail slowly/silently, this pattern points to
Samsung's BLE stack not honouring `autoConnect` the way stock Android does. Reverted back to a
direct connect (`autoConnect=false`) with the same-device retry restored, keeping the connect
timeout as a generic safety net. **These native fixes require an APK rebuild to take effect**
(`npx cap sync android && ./gradlew assembleDebug`) — no successful `auth: SUCCESS` has been
observed yet, so the actual ring auth handshake on-device remains unconfirmed. App-level races,
phone Bluetooth-stack state, Windows PC interference, and autoConnect-vs-direct-connect have all
now been ruled out or tried without success; recommended the owner capture a Bluetooth HCI snoop
log (Developer Options → "Enable Bluetooth HCI snoop log") on the next attempt for real
protocol-level diagnosis rather than continued guessing.

### [cross] Full app overview review (2026-07-06, session 213) — ~90 verified findings pending planning
A nine-dimension audit (caching, offline-sync, performance, UI, security, dates/formulas,
workouts, nutrition, APK/BLE readiness) is written up in
**`docs/reviews/2026-07-06-full-app-overview-review.md`** — every finding verified with
file:line. The findings are grouped into plan batches (R1–R8 + APK/BLE Tracks A/B) and
registered in `docs/implementation-backlog.md` § "Not yet queued" for planning sessions to
pick up. Highest-impact (see the review's executive summary): the
unverified-rowcount/mass-assignment ownership bug class (SEC-1..3/6), workout deletes never
reaching the device local store (SYNC-C1 — deleted sessions resurrect), the
`progress-summary` cachedFetch/cachedFetchToday variant clash (CACHE-F1), the quick-edit
food sheet stale-quantity corruption (NUT-1), `advance()`'s stale closure losing
single-exercise completions (WK-1), and offline food logging of new items failing entirely
(SYNC-O2). Also verified **fixed/clean** during the review: readiness-score TTLs, legacy
`ta_*` seeds, the training-load inline ACWR copy (gone), auth coverage on all 149 routes,
AI-route schema/rate-limit discipline, local migration/reconcile registration (all 26
tables), and poison-pill outbox handling.

### [platform] Dual-path read-fallback divergences (2026-07-06 audit) — deferred, fix-on-touch
Found while planning the APK-canonical-target work
(`docs/superpowers/plans/2026-07-06-apk-canonical-target-implementation.md`); the write-path
drift and two quick read fixes are queued (backlog item 2), these three heavier read-side
duplications are deliberately deferred to fix-on-touch:
- **Strength trend computed twice:** `app/health/health-content.tsx:413-444` re-implements
  per-exercise 1RM/gain% client-side for the device seed while web delegates to
  `/api/strength-trend` — two implementations of the same trend math that can disagree during
  the seed window. Converge on touch (shared lib fn or seed from the same route shape).
- **Exercise history device path stubs `isDeload:false`** and re-derives `rpeDelta`
  (`components/exercise-history-sheet.tsx:31-50`) — server overwrite makes the divergence
  transient, but the deload flag is always wrong until the fetch lands.
- **Nutrition `calsBurnedToday` has two sources:** device sums local activity logs
  (`app/nutrition/nutrition-content.tsx:192`), web reads `/api/body-metadata` — one number,
  two derivations.

### [workouts][heart-rate] Workout HR/UI polish (v1.143.1, session 296) — shipped, NOT verified on-device
- Follow-up to the Live HR rework (below), owner-reported on-device: (1) the workout-phase action bars sat
  flush against the 3-button nav bar. `pb-safe-action-lg` used `max(env, 4rem)`, which let the
  edge-to-edge inset eat the intended clearance (~16px above nav); changed to
  `max(calc(env + 2rem), 4rem)` so the inset is *added* to the gap (web/no-inset look unchanged at
  4rem). **Consistency sweep:** warmup, pre-workout, exercise-summary and done screens were on plain
  `pb-safe-action` (0.75rem floor → button flush against the nav bar on-device) and now all use
  `pb-safe-action-lg` — every full-screen workout action bar clears the nav bar identically. (Bottom
  sheets keep `SheetContent`'s baked inset per the safe-area rules.) (2) The in-workout Live HR card
  now renders in a `compact` variant (44px trace vs 72px) so it no longer squishes the fixed-height
  rest-timer zone; the summary card keeps the full-height chart + set lines. (3) The done-screen HR
  Recovery chart (`hr-recovery-chart.tsx`) now passes its 30s buckets through `rollingMedian` (window
  5) + higher line tension, so the spiky trace reads as a clean recovery curve (display-only — the
  per-set bpm/min recovery numbers come from `hr-analysis`, unchanged).
- **NOT verified on-device:** the safe-area clearance in particular is invisible in the web sandbox
  (insets render as 0), so the nav-bar gap must be checked on the S25 APK. `tsc`/lint/tests green,
  full `pnpm build` clean.

### [heart-rate][workouts] Live HR — rest-only in-workout + full-exercise summary replay (v1.143.1, session 296) — shipped, NOT verified on-device
- Owner-reported (on-device) rework of the session-295 full-exercise chart: (1) during a workout the
  Live HR card now shows **only in the rest phase** (`sinceMs={restStartMs}`) — the set-phase PPG
  reads poorly under grip/motion, so the mid-set trace dropped then ramped in rest and read as
  inaccurate; and only genuinely-live readings feed it (held/stale values no longer fabricate a moving
  line). (2) The **exercise-summary card** now replays the *whole* exercise's HR with dotted per-set
  markers — previously it mounted a fresh chart with no carried-over samples and showed a flat line.
- Mechanism: a shared, non-persisted per-exercise HR trace singleton
  (`lib/live-hr/exercise-trace.ts`) recorded once by the workout orchestrator's 1 Hz tick across
  set+rest; `LiveHrChart` is now a pure reader of it (active card filters to the current rest window,
  summary shows the full trace + set lines). Set boundaries are captured at log time because
  `commitExerciseSummary` clears the store's set-timing arrays the instant the summary opens. Trace
  logic unit-tested (`lib/live-hr/__tests__/exercise-trace.test.ts`, 7 tests).
- **NOT verified on-device:** the live trace, rest-only gating, summary replay, and set-boundary lines
  all require the real Oura BLE stream (`getLiveHrManager().getCurrent()` is null in the web sandbox,
  so both cards only show their empty state). Web smoke: `tsc`/lint/tests green, full `pnpm build`
  clean, `/workout` route compiles and serves. Owner to verify on the S25.

### [app-shell] UB1 deep-link cold-launch redirect (v1.124.9, session 256) — NOT verified on device · needs: android
- The admin-bounce latency fix (Chunk 2) is verified end-to-end on the local dev DB. Chunk 1 —
  the actual reported bug (a deep-link cold-launch with an existing WebView session yanking the
  user back to home mid-navigation) — is APK-only: `Capacitor.isNativePlatform()` is false in the
  web sandbox, so `App.getLaunchUrl()` never returns a deep-link URL and the fixed code path never
  runs there.
- **Needs on-device confirmation:** sign in fresh (first-ever exchange) → lands on home as before.
  Sign in again so the process cold-launches from the deep link with a session already in the
  WebView jar; as soon as home paints, navigate to `/admin`; wait out the exchange → **stay on
  `/admin`** (this is the UB1 repro). Warm re-auth from `/sign-in` still lands on home correctly.

### [platform] R3 offline-first integrity, Chunk 1 local-store surfaces (v1.124.7, session 254) — NOT verified on device · needs: android
- Server-side soft-delete (SYNC-C1) and its ~35 read-site guards are verified end-to-end on the
  local dev DB. Three sub-tasks are APK-only and unverified: the local-store mirror on history
  edit/delete (SYNC-R4, `deleteExerciseLogLocally`/`updateExerciseLogLocally`), Home's body-metric
  tile local-first seed (SYNC-R1, `session-select-content.tsx`), and the `food_items` outbox
  domain's push ordering (SYNC-O2) — `getLocalStore` returns `null` in the web sandbox, so none of
  these can be exercised without the APK.
- **Needs on-device confirmation:** delete a synced workout on-device, force a pull on a second
  device/after clearing app data → it doesn't resurrect; edit a past set offline → the Stats/Health
  list reflects it immediately and survives a restart before sync; go offline, scan/add a
  brand-new food → it logs, appears in the day list, survives restart, and dedups correctly once
  reconnected (no duplicate `food_items` row).

### [workouts] Workout leave-confirmation on Android hardware back button (v1.82.0, session 182) — NOT verified on device · needs: android
- The hardware/gesture back button now checks `isWorkoutActive()` and shows the shared
  `LeaveWorkoutDialog` (previously it bypassed every "leave workout?" guard). Verified via
  Playwright in the web sandbox for the pre-workout back chevron and bottom-nav tabs.
- **Needs on-device confirmation** that a real hardware back-press / edge-swipe mid-workout
  shows the dialog, and "Leave" still triggers `App.minimizeApp()`/`window.history.back()`.

### [cardio] GPS background-location walk detection (v1.80.1, session 181) — NOT verified on device · needs: hardware
- Root cause: `@capacitor-community/background-geolocation`'s `addWatcher` only requests
  foreground location, never `ACCESS_BACKGROUND_LOCATION`, so a backgrounded GPS start is
  silently refused; the error was discarded with no logging/UI. Fixed with a native
  `window.AndroidLocation` bridge, a Profile/More status card, and errors routed into
  `useAutoDetectionStore.detectionError`.
- **Needs on-device confirmation** that the card renders, "Open Settings" opens the right
  screen, the card flips to "Enabled" after granting "Allow all the time", and a real
  backgrounded walk is detected end-to-end.
- **Open question:** Android 12+ may block starting a *new* foreground service from the
  background even with the permission granted — a persistent lightweight foreground service
  may be needed as a follow-up.

**Update 2026-07-11 (session 272), owner-reported:** the open question above is now confirmed
live impact, not theoretical — auto walk/run detection has stopped presenting walks, and the
GPS watcher appears to be the source of a reported phone battery drain. Root cause traced to the
watcher's off-switches (probe timeout, stall) running in WebView timers that Android
throttles/suspends with the screen off while the native GPS foreground service keeps running
underneath — reachable precisely because this section's original fix got "Allow all the time"
granted. Both detected-walk sources are also dead (Oura-Cloud froze at the 2026-07-07 re-key;
background sessions rarely finalize). Fix planned:
`docs/superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md` (**backlog
item 1**) — a timer-independent GPS watchdog, then the ring's walk-specific gate as the GPS
trigger (battery win), then a deferred native pipeline. Until it ships: a persistent "Tracking
your activity" notification while not walking indicates a wedged watcher; force-killing the app
clears it.

### [platform] Offline-sync protocol hardening (Batch A, v1.76.0, session 177) — NOT verified on device · needs: android
- Shipped: mutation-id-based outbox confirms, dead-letter quarantine after 5 attempts +
  `sync-health-card.tsx` retry/discard UI, `applyDelta` pull-clobber guards on every domain,
  server-authoritative `personal_records`, workout-log replay idempotency, `applyDelta` in a
  real transaction, bulk `saveProgram` inserts, and a paginated sync-pull cursor.
- **Not exercisable in the sandbox** (`getLocalStore` returns null there) — verified via unit
  tests + one DB-level replay-idempotency check. **Needs an on-device pass:** local SQLite v13
  migration applies cleanly, a failed mutation quarantines after 5 attempts with working
  Retry/Discard, and a pull no longer reverts a pending offline edit.

### [nutrition] Supplement reminders (v1.50.0) — NOT verified on device · needs: android
- `reconcileSupplementReminders()` on app open/resume; `cancelSupplementReminder()` on toggle-off.
- **Risk — ID collision:** IDs 8500–8699 (200-ID range) hash from `supplementId`; two supplements
  could collide (unlikely with <10 supplements). **Risk — timezone:** `reminderTime` (`"HH:MM"`,
  no tz) compared against local device time; a timezone change fires at the wrong time until the
  next reconcile.

### [workouts] Injury workout warning (v1.50.0) — NOT verified on device · needs: browser
- Amber banner in `active-workout-screen.tsx` when an exercise's muscles overlap an active injury.
- **Risk:** custom exercises with no muscle assignments never trigger it; matching is string
  equality between `injury.muscleName` and `exercise_library.muscle_groups` — casing/naming drift
  (e.g. "Quads" vs "Quadriceps") misses. Verify `MUSCLE_OPTIONS`/`MUSCLE_TO_SLUG`/`muscle_groups`
  all agree.

### [workouts][platform] Workout reminder notifications (v1.45.0) — NOT verified on device · needs: android
- Channel `workout-reminders`, ID 8000. Only fires for weekly/rotation schedule modes (disabled
  for auto-schedule). Cancelled by `cancelWorkoutReminder()` on workout start.

### [workouts] Per-session phase tracking (v1.42.x) — data-quality risk
- Phase counts recompute from `workout_sessions.session_name` via `GROUP BY session_name`.
  Inconsistent historical name casing (`"push"` vs `"Push"`) would split counts and produce wrong
  phase resets. No normalisation migration was written — watch if users report unexpected resets.

### [devices] Oura Ring integration — mostly shipped, expansion pending
- ✅ SpO2 re-auth done (scope fixed `spo2Daily`→`spo2`; user reconnected, `spo2_pct` populates).
- **Data expansion available but unbuilt:** many synced `oura_daily` fields aren't displayed yet
  (sedentary/non-wear time, temperature deviation, stress/recovery, resilience, vascular age,
  VO2 max, ring battery). Full reference in `docs/oura-ring-data-reference.md`.

### [workouts][platform] AI periodization (v1.54.0) — ops dependency
- Tier 5 refinements shipped (accumulation ceiling, deload auto-advance, low-confidence
  explain/confirm); exercise-swap UI dropped. Muscle-group weekly volume targets now auto-seed
  (v1.72.0) so the engine no longer runs unconstrained — a manual *editing* UI is still a
  nice-to-have.
- **v1.104.6:** volume targets now use real per-muscle MEV/MAV/MRV landmarks (not a large/small
  binary), and the time-budget trimmer is volume-aware (cuts the muscle furthest over its MAV
  first, can cross role tiers for a severe outlier). Also fixed a live-reproduced bug where
  Gemini's occasional 0-1 `pct` fraction 502'd the whole prescription.
- **Known gap:** the model can drop a `session_exercise_id` from its response entirely (observed
  live, not fixed) — that exercise silently gets no prescription for the session rather than an
  explicit sets=0/skip signal.
- **Ops note:** requires `GOOGLE_GENERATIVE_AI_API_KEY` in Railway env vars — without it the
  prescribe route 502s (emergency deload still works, it skips AI).

### [cross] Recently resolved (full detail in the session journal)
- ✅ **AI workout prescription "couldn't generate" every session** — client now fires `POST …/prescribe` directly + `?poll=1` made `no-store` (v1.173.2/.4); device-confirmed 2026-07-19.
- ✅ **AI chat "Invalid input" (localDate slash vs dash)** — `chatSchema` regex relaxed to accept both separators (v1.173.2); permanent CLAUDE.md rule added.
- ✅ **Culling Lever 1b (historical decoded backfill)** — device-verified end-to-end on the S25 APK against real prod data (2026-07-15); `body_hex` untouched.
- ✅ **Live HR — DHR on-demand burst** — true-live in-workout HR verified working on-device (v1.122.11, owner-confirmed 2026-07-09).
- ✅ **Home week-strip rest-day hydration mismatch** (found 2026-07-06, session 208) — root-caused
  as `session-select-content.tsx`'s week-strip building "today" from the device's local timezone
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) while the server buckets workout/rest days
  in AEST; the two disagreed whenever they diverged, producing exactly the server-vs-client
  "today"/rest-day mismatch this issue described. Fixed as part of R8 (Dates & Formulas
  Consolidation) by rebuilding the week strip on `todayInTz()`/`startOfWeekInTz()`/
  `todayDayOfWeek()`/`shiftDateStr()` — all server-tz — instead of the device tz.
- ✅ **Local SQLite never opened on-device** — v4's `PRAGMA journal_mode=WAL` inside the upgrade
  transaction; WAL moved post-open (#27) + missing v8 columns (#28). Confirmed on S25 (v1.68.0).
- ✅ **Sleep duration discrepancy** — Oura row authoritative for duration in `mergeByDate` (v1.62.0/.1).
- ✅ **Activity walk detection** — distance/speed/duration filters on Oura + timeline routes (v1.62.0).
- ✅ **AI "Baseline needed" stuck** — "Use prior data →" advances from existing PRs (v1.62.0).
- ✅ **Feedback screenshot size** — route rejects `screenshotData` > 500 KB (v1.56.0).

---

## 📋 What's Left To Do

> **Ready-to-build work is queued in [`docs/implementation-backlog.md`](docs/implementation-backlog.md);
> open uplift ideas are in [`docs/planned_upgrades.md`](docs/planned_upgrades.md).** The list below
> is the residual legacy backlog — mostly ✅/🚫 — plus the device-only verifications that can't be
> exercised in the sandbox.

**Next free Postgres migration number: 167.** (**Corrected 2026-08-02** — 166 was claimed and used
the same day by `166_sleep_sessions_oura_id_user_scope.sql` (#1004). Previously said 166; before
that, "next: 127"
and was 38 migrations stale; on disk through 165 now. Known same-number collisions: 081, 087, 146,
161 — apply order between each pair is ambiguous but independent, per CLAUDE.md's migration-number
rule; do not rename an applied migration. Local SQLite is at **v20**. Claim any new number against
both the directory AND open plan docs before writing a migration — this line drifts fast because
multiple parallel sessions claim numbers; treat it as a hint, verify with `ls lib/data/postgres/migrations/`
before trusting it.)

### 🔴 Security
- ✅ **AI SDK CVE bump done.** `@ai-sdk/google ^3.0.86` (+ `@ai-sdk/openai`, `@ai-sdk/react`,
  `@ai-sdk/provider-utils@4.0.33`), `package.json`/`pnpm-lock.yaml` in sync. No open security items.

### ✅ Local-first reads — operational on-device
The headline goal (every screen paints from local data instantly, then revalidates) works since
session 166's SQLite-open fix. Remaining server-only reads are cross-session aggregates
(`weekly-stats`, `weekly-muscle-sets`, `weights-summary`, `muscle-recovery`), server-computed by
design — they stay on `cachedFetch`.

### 🟡 Derived-score read paths (v1.158.1) — known limitation + prod check
The Readiness/Sleep sparklines (`/api/health/trends`), the Body Battery morning anchor
(`/api/body-battery`), and the Sleep contributor bars (`/api/readiness-score`) now coalesce our own
`oura_daily_derived` scores over the frozen post-re-key Cloud columns (data-efficiency S1/S2/S6, item 3a).
**No backfill** — `oura_daily_derived` only has rows from each persist's start date, so sparklines fill
in from ~2026-07-15 (readiness) / this release (sleep) **forward**; derived `activity_score` stays
Cloud-only-then-null until P-D writes it (the coalesce is already in place for it). **Prod check after
deploy** (the local seed is Cloud-shaped + always fresh, so the frozen-vs-live split can't repro in the
sandbox): open Health → Sleep/Readiness, confirm today-forward sparkline points appear and the
contributor bars render on a BLE night; confirm Body Battery no longer opens at a flat 50.

### 🔵 Device-only (cannot test in the sandbox — requires Samsung Galaxy S25 Ultra)
- [ ] **GPS background-location walk detection** (v1.80.1, APK rebuild): confirm the status card
  renders, "Open Settings" works, the card flips to "Enabled" after "Allow all the time", and a
  real backgrounded walk is detected end-to-end (may be blocked by Android 12+ foreground-service
  restriction — see Known Issues). **Update 2026-07-11:** end-to-end background
  detection is known-broken and owner-reported — the fix is planned as backlog item 1
  (`2026-07-11-ring-triggered-walk-detection-gps-battery.md`); its on-device soak supersedes
  this checklist line.
- [ ] **Android App Links for mobile auth** (APK rebuild): replace the custom
  `trainingai://auth-complete` scheme with a verified `https://…/auth-complete` App Link
  (`android:autoVerify="true"` + `/.well-known/assetlinks.json` with the release-cert SHA-256).
  Defence-in-depth only — the shipped PKCE binding already makes an intercepted token unredeemable.
- [ ] **Offline-sync on-device pass** (Batch A + local-first): v13 migration applies on a fresh
  APK launch; body-weight/supplement/injury writes round-trip through the outbox offline;
  `pullDelta` populates on first open; rest-timer reconciles after suspend mid-rest; a failed
  mutation quarantines after 5 attempts with working Retry/Discard.
- [ ] **Notification verification:** supplement reminder fires at `reminderTime` and cancels on
  toggle-off; workout reminder fires on training days only and cancels on workout start; injury
  amber banner fires when an exercise overlaps an active injury.
- [ ] **Guided interval walk — on-device (v1.158.0):** the config→active→summary flow and the
  server page + save path are dev-verified (authed page 200; a `walk` `activity_log` persisted via
  the web fallback), but the client interaction and the two device-only behaviours are unverified in
  the sandbox. Confirm on the S25: (a) live HR + the fast/slow zone verdict update during the walk
  (sandbox shows "—", no ring); (b) the background interval cues (`lib/walk/walk-cues.ts`) fire with
  sound/vibration at each transition while backgrounded / screen-off (local-notification exact timing
  under Doze can drift a few seconds — acceptable for cues); (c) the walk lands in activity history
  through the local-store path (`getLocalStore` is null on web). Open via Log Activity → Interval walk.
- [ ] **Set-log planned snapshot — native local-store leg** (2026-07-17, migration 126): the
  server + web write paths are dev-DB-verified, but the on-device sync chain (raw SQLite insert,
  `mapSetLog`, `applyDelta`, `RECONCILE_COLUMNS`) runs only on the APK (`getLocalStore` is null in
  the sandbox). Confirm: log a set offline on the S25 → kill/reopen → the set still renders and,
  after reconnecting, the row round-trips with `planned_pct`/`planned_rest_sec` intact through
  `pushMutations` and back via `getSyncDelta`/`applyDelta`; plus a cross-device pull of a web-logged
  set carrying the snapshot. Columns are write-and-store (no UI), so nothing is user-visible.
- [ ] **Run/activity leave-confirmation guard (v1.244.0):** confirm hardware back and bottom-nav
  tab taps mid-run/mid-activity on the S25 show "Leave activity?" and discard on confirm, keep
  recording on cancel — mirrors the already-verified guided-walk/workout equivalents, but this is a
  new call site (`/activity`) never exercised on a real back gesture before.
- 🔄 **Health Connect is no longer dormant** (corrected 2026-08-02). This line used to read "HC is
  dormant… verification items are parked". Q-43 (v1.250.0) made HC a **first-class tier-2 source**:
  it is how every non-Oura user gets sleep, and `saveSleepSession` now stamps provenance through the
  ranked merge. The Tasker ingest route is still the unexercised part. **The HC device check is
  owed** — see the owner checklist in
  [`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoff-2026-08-02-platform-batch-queue-drain.md);
  nothing in the HC path has ever run against a real provider.

### 🟢 Nice-to-have
- **Body Battery model tuning** (v1.66.0): the charge/drain constants are heuristic. A
  `body_battery_daily` snapshot table (migration 100) records daily end value / min-max /
  charged-drained / RHR-HRmax inputs / observed peak HR / sample count / `model_version`. After
  ~1–2 weeks of data, correlate end-of-day battery vs next-day readiness/HRV, swap `220−age` for
  observed max HR, retune constants, bump `MODEL_VERSION`. Methodology: `docs/body-battery-tuning.md`.
- **Manual per-muscle weekly-volume-target editing UI** in program config (the engine already
  auto-seeds targets — Batch 1 in `planned_upgrades.md`).

---

## 🗂️ Document Map

`projectOverview.md` is the lean index (current status + **Waiting on the owner** + Known Issues &
Risks + What's Left). The
append-only session journal and the batched archives live under `docs/`:

| File | Contents |
|------|----------|
| `docs/overview/known-issues-resolved.md` | **Completed Known Issues** — entries archived out of this file once nothing was still owed (53 moved 2026-08-13). Grep it before concluding something has never been looked at. Striking an issue means *moving* it here — see `CLAUDE.md` Session Wrap-Up step 2 |
| `docs/implementation-backlog.md` | **Upcoming (ready)** — priority-ordered queue; implementers take the top item |
| `docs/planned_upgrades.md` | **Upcoming (ideas)** — open uplift findings, batched by data/structure |
| `docs/overview/uplift-archive.md` | **Completed** — shipped uplift batches split out of `planned_upgrades.md` |
| `docs/overview/entries/` | **Recent journal (uncompacted)** — one file per PR/session (`YYYY-MM-DD-<slug>.md`); read these + the newest history file for "what happened lately". Folded into the batched history by the compaction sweep — see the README there. **Corrected 2026-07-30:** this line said "near-empty (compacted 2026-07-20)" but the directory holds ~179 files from 07-20→07-29 — the compaction sweep is overdue; a future session should run it. |
| [`docs/agents/README.md`](docs/agents/README.md) | **The standing agents** — the four roles, their authority, the two-lane file-ownership contract, the Q-number bands, and the handoff protocol. Cold-start prompts in `docs/agents/prompts/`, live batons in `docs/agents/state/` |
| `docs/overview/status-archive.md` | The 157 dated status notes that had accumulated in this file's Current Status section, archived 2026-08-17. Superseded by the journal; do not add to it |
| [`docs/overview/history-2026-08-25.md`](docs/overview/history-2026-08-25.md) … `history-2026-07-17.md` | **Completed journal (batched)** — eleven files covering 2026-07-17 → 2026-08-24, folded from 498 + 41 loose entries by the 2026-08-17 and 2026-08-18 compaction sweeps, oldest-first within each. Every entry keeps a `<!-- from: … -->` marker naming the PR file it came from. `history-2026-08-18.md` was started because `history-2026-08-15.md` had passed the ~250 KB rule at 300 KB, and `history-2026-08-24.md` because `history-2026-08-18.md` had, at 326 KB. **The 2026-08-24 sweep folded 57 of 153 loose entries**, and **the 2026-08-25 sweep (LA-25) folded 25 of 191, taking unlinked 59 → 34** — the rest are cited by path from `projectOverview.md`, the domain indexes or an agent baton, and folding a linked entry breaks those citations. `history-2026-08-25.md` was started because `history-2026-08-24.md` was at 223 KB and 25 more entries would have passed the ~250 KB rule |
| `docs/overview/history-2026-07-20.md` | **Completed journal (batched)** — the 2026-07-17 → 2026-07-20 loose entries, compacted 2026-07-20, newest at top |
| `docs/overview/history-2026-07-16.md` | **Completed journal (batched)** — sessions 2026-07-16 → 2026-07-17, newest at top |
| `docs/overview/history-current.md` | Sessions ~287 → 2026-07-16 (closed batch) |
| `docs/overview/history-newer.md` | Sessions ~217–286 (closed batch) |
| `docs/overview/history-newest.md` | Sessions ~209–216 (closed batch) |
| `docs/overview/history-latest.md` | Sessions ~177–209 (closed batch) |
| `docs/overview/history-recent.md` | Sessions ~105–176 + roadmap / version-history tables |
| `docs/overview/history-past.md` | Sessions ~51–104 |
| `docs/overview/history-early.md` | Sessions ~1–50 + legacy architecture appendix |
| `docs/superpowers/plans/archive/` | All completed implementation plans (shipped) — reference |
| `docs/superpowers/specs/archive/` | All completed design specs (shipped) — reference |
| `docs/reviews/` | Full review write-ups that seed backlog items (source material) |
| [`docs/domains/`](docs/domains/README.md) | **Per-pillar entry point — read this first when working in one area.** Eleven indexes (`sleep`, `readiness`, `heart-rate`, `cardio`, `activity`, `workouts`, `nutrition`, `body`, `devices`, `app-shell`, `platform`), each gathering that pillar's code locations, reference docs, open issues, handoffs and gotchas. Its `README.md` holds the boundary rules and the `[domain]` tag convention used by the Known-Issues headings above and by handoff filenames |

**Reference docs:** `docs/module-map.md` (**what shared module/infrastructure already
exists and where** — read before building any new feature or helper; documents the
no-cron-layer scheduling patterns), `docs/oura-ring-data-reference.md` (Oura v2 field
reference), `docs/device-smoke-checklist.md` (on-device verification steps),
`docs/owner-action-required.md` (**everything left that the sandbox can't do** — owner-run
device/APK/data/decision items, grouped by action type; read when asking "what's left"),
`docs/body-battery-tuning.md` (Body Battery model methodology),
`docs/sleep-system.md` (**sleep reference** — staging pipeline, scoring, what's
reliable vs approximate, tuning discipline, open levers; read before any sleep work),
`docs/public-launch-checklist.md` (**things deliberately deferred because the app is
personal-use-only** — read when asked "what needs fixing before going public").

**Runbooks:** `docs/runbooks/db-backup-restore.md` (manual `pg_dump`/`pg_restore`
against Railway, disaster-recovery walkthrough), `docs/runbooks/account-recovery.md`
(password reset via `scripts/reset-password.js` when locked out of both
credentials and Google OAuth).

**When adding a session note:** write a **new file** in `docs/overview/entries/` named
`YYYY-MM-DD-<branch-slug>.md` — do **not** prepend to a shared `history-*.md` (that shared-line edit
was the most frequent multi-PR merge conflict; per-entry files take it to zero). See
[`docs/overview/entries/README.md`](docs/overview/entries/README.md) for the convention and the
compaction chore. Keep this index to current status, Known Issues & Risks, and What's Left. The
compaction sweep folds loose entries into the newest `history-*.md`, starting a new one when it
approaches ~250 KB and adding it to this table.
