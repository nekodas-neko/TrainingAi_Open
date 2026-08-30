# Device verification queue — the S25 checks that are owed

**What this is.** The device gate in `CLAUDE.md` says an offline-first, native, safe-area, gesture or
notification change is unverified until it has been run on the Samsung S25 Ultra. Sessions cannot
reach a device, so each such change either waits or ships with a Known-Issues row saying it is not
device-verified. This file is the running list of what is owed, so one device run can clear several
at once instead of the owner being asked piecemeal.

**How to use it.** It is **grouped by screen, not by entry**, because the cost is picking the phone
up and getting to a screen — not the tap itself. Work a whole section while you are there. Each item
names the action and what a *pass* looks like. Answering "pass", or describing what actually
happened, is enough; a screenshot only where the item asks for one. Items are struck from this file
in the PR that acts on the answer.

**Build to test against:** the current `apk-latest` release, or a Railway deploy if the item is
marked **JS** — those need no new APK, just a fresh app open.

**Coverage.** Every `Gate: device` entry in the Lane B queue is represented below (27 on
2026-08-26). Three of them are **not** presses and are listed at the end so nobody hunts for a
button that does not exist. **S8 and S9 were added 2026-08-30** — they are Lane A entries whose gate
is also a device, added here because the cost is picking the phone up and they ride along free.

**Start with N4.** The Log Food screen was rebuilt on 2026-08-26 and has never been seen on the
phone; several other items in this section are reached *through* it, so if it is wrong they are all
blocked behind it.

---

# Nutrition — one pass clears seven entries

Everything in this section is **JS**. Open the app fresh after a deploy; no APK needed.

## N1. The delete that did nothing — BF-34 · **BF-34 PASSES; a different bug found**
**2026-08-30 — BF-34 is device-verified.** Owner: *"Delete worked."* The dialog appears and stays.

**What the same tap found instead is [BF-47](implementation-backlog.md):** *"the item vanishes then
re-appears; then when you swap screens - it dissapears."* The loader treats the server copy as
authoritative while the delete is still queued in the outbox, so the server puts the row back.
Traced to `use-food-logs-loader.ts`; nothing further owed from the device until that ships, when this
becomes: delete a food offline **and** online, and confirm it never reappears.


## ~~N2. Back unwinds the nest one layer per press~~ ✅ 2026-08-30
Owner: *"Looks good."* Two presses, one layer each, and switching tabs first did not consume one.
**This is the evidence that BF-49 and BF-51 ① are not the general back stack** — that is correct;
those two paths are wired wrong individually.


## ~~N3. The swipe tray on the meal list~~ ✅ 2026-08-30
Owner: *"Yes all good here."* No accidental tray on a diagonal flick; left-drag opens, right closes,
a second row closes the first, tray Delete confirms. BF-29 is device-verified.


## N4. The Log Food screen, rebuilt — **PASSED 2026-08-30, four follow-ups filed**
The rebuild is verified: no tile grid, three tabs readable at 412 dp, Meals holds only meals, Photo
and Barcode each take the full screen. LB-16 / BF-37 are device-verified.

Filed from the same pass: **[BF-50](implementation-backlog.md)** (capture row too small, the describe
pane wastes its space, the camera opens a chooser it does not need, multi-select can only delete),
**BF-46** (the meal tile renders but only ever the placeholder), and **LB-18 answered** — `Recent`
goes global rather than staying scoped to the current meal bucket.


## N5. The meal builder — footer, recipe links, and duplicates — BF-31 / BF-26 / BF-11c / BF-11d
1. **Meals** tab → open a meal → **Edit** → scroll the ingredients to the end.
2. **Pass:** the batch figures stay pinned above **Save**, and the action row clears the gesture bar.
   *(That footer moved to its own component on 2026-08-26, so this is a re-check, not a first one.)*
3. Tap the inline **name** field. **Pass:** the keyboard does not push the footer over the input or
   off screen.
4. **New** → paste a **recipe URL** into the ingredient search. **Pass:** the offer changes to
   *"Import the recipe from &lt;site&gt;"* — the AI-estimate offer must be gone, not sitting beside it —
   and pressing it fills the ingredient list.
5. **The number that matters:** after importing a recipe whose page states a yield (most do), the
   batch field must read **1 portion**, and the calories must look like **one serving**, not the
   whole tray. If it reads the recipe's yield, stop and say so — that is a logging error of exactly
   that factor.
6. Import a page that does **not** state a yield. **Pass:** an amber line says the ingredients are
   the whole recipe and to set how many portions it makes; setting it clears the line.
7. Paste a URL for a page with **several dishes** (a "5 weeknight dinners" roundup). **Pass:** a list
   of dishes with tick controls; tapping one leaves it out; **Save N meals** creates one saved meal
   per kept dish, and they appear on the Meals tab.
8. **Paste the SAME single-recipe URL a second time** and press Save (BF-11d). **Pass:** it asks —
   *"You already have …"* with **Update it** and **Save as new**. **Save as new must be the answer a
   dismissal gives**, so nothing is overwritten by accident. Tap **Update it** once and check the
   meal's **printed label still scans** if you have one: the id must not have changed.
9. **Paste the same MULTI-dish URL a second time.** **Pass:** every dish you already have comes back
   **unticked**, labelled *already in your meals*, and Save says a smaller number. Tapping one keeps
   a copy anyway.

*Why:* every scan here is a live AI call against a live page, so nothing in the sandbox exercises it
end to end — the multi-dish list has never seen a real page, only the shape the route promises.

*Why:* BF-26 converged the two quantity sheets and its action row's inset renders 0 in the sandbox.

## ~~N6. The day screen's grouping~~ ✅ 2026-08-30 — BF-24 verified, one change wanted
The grouping is right: each meal its own card, rows within it. **BF-24 is device-verified.**

The owner's watching brief produced one change, folded into **BF-45 ②**: a collapsed meal must still
show its **total calories and total macros**, on a line below the header.


## N7. The food-database mismatch warning — **BLOCKED, and the blocker is [BF-48](implementation-backlog.md)**
**2026-08-30 — could not be run.** Owner: *"When I try add a food via the 'single food' section; it
only searches saved/history food - its not checking the food data base."* Confirmed in source: the
food database is reachable **only** from the meal builder's ingredient picker, so there is no
food-database row on Log Food to carry the warning.

**Re-run this check once BF-48 lands**, from Log Food → Single foods. Q-406's device gate stays owed.


## N8. Water — Q-319 · **deferred by the owner 2026-08-30**
*"This is not important lets leave for later."* Still owed, not withdrawn.


## A1. The back gesture across surface types — BF-27 · **re-worded 2026-08-30**
The owner asked what to do here, which means the item was written for someone who already knew what
BF-27 changed. Concretely — the Android **back gesture** (swipe in from the screen edge), not an
in-app arrow:

1. Nutrition → tap a logged food → a **sheet** opens. Swipe back. **Pass:** the sheet closes and you
   are still on Nutrition. **Fail:** the whole tab changes, or you leave the app.
2. Nutrition → tap a food's **bin** → the *"Delete food log?"* **dialog**. Swipe back.
   **Pass: the food is STILL THERE** — back must cancel, never confirm. This is the one that matters;
   a back gesture that confirms a destructive dialog deletes data on a mis-swipe.
3. Log Food → **Meals** → a meal (a **nest**). Swipe back twice — one layer each.

*(3 is what N2 already passed, so if you have done N2 you have done 3 — 1 and 2 are what is left.)*


## A2. The timeline's row taps — **FAILED 2026-08-30, filed as [BF-49](implementation-backlog.md)**
Owner: *"tapping workout; then back -> leads to heath training not home. Same with tapping a food
item from timeline."* Back resolves to the tab that owns the destination rather than unwinding to the
origin, on both routes. Nothing further owed from the device until BF-49 ships.


## A3. Timezone auto-detect across local midnight — Q-477 · **deferred by the owner 2026-08-30**
*"lets leave this on the backburner; will be hard to test."* It is: the check needs the app open
across local midnight. Still owed; a future run should schedule it rather than attempt it on demand.


## A4. A card whose fetch fails — Q-499 · **inconclusive 2026-08-30, needs a re-run**
Owner: *"Everything seems to be working; nothing is showing that it cant load."* **That reads as a
pass and may be one, but it may also mean the failure was never induced** — a card that loads from
cache offline is doing the right thing and proves nothing about the error state.

Re-run and say which happened: **turn airplane mode ON first**, then **force-close** the app (so no
cached fetch has already run), then open **Health**. A card whose fetch fails must say so.
**Fail:** it silently vanishes, which reads as "no data" rather than "this failed".


## ~~W1. Safe-area on a navless takeover~~ ✅ 2026-08-30
Owner: *"Seems good!"* The bottom action button on a full-screen workout phase clears the gesture
bar. The eleven-times-recurring class is clear on this build.


## W2. The set flow past set 1 — Q-461 · **deprioritised by the owner 2026-08-30**
*"Not sure if I care about this?"* Fair — it verifies that sets 2 and 3 log and the countdown
behaves, which the owner exercises every session anyway. **Treat a normal workout as the check:** if
sets log and the rest timer behaves, it passes. Only worth a deliberate run for the reduce-motion
half, since nothing else in the app depends on that setting.


## W3. Volume landmarks at S25 width — Q-305 · **re-worded 2026-08-30**
The owner asked what is needed, and the old wording (*"wherever the landmarks now render"*) did not
say where to look — a check nobody can locate is not a check.

**Volume landmarks** are the weekly set-count guides per muscle group (the MEV/MAV-style bands) shown
in the training-volume view. Open that view on the phone and answer one question: **is anything
clipped, wrapped mid-word, or unreadable at 412 dp?** A screenshot is the fastest answer. If you
cannot find the landmarks on any screen, say that — "it does not render anywhere" is a more important
answer than a layout note.


## D1. Devices card vs a keyless service — LB-5
1. Open the **Devices** card with the BLE service running.
2. **Pass:** if the service has no ring key stored, the card says so rather than reporting the ring
   healthy. (`getOuraBle()` returns `null` in the web sandbox, so this branch is device-only.)

## D2. The frame packer button — Q-316
1. `/admin/oura-ble` → the **pack** button.
2. **Pass:** it is disabled at zero, and after a press the footprint reloads and the raw count drops.

## D3. Declaring a re-key — Q-317
1. The **re-key** button in the same console.
2. **Pass:** it acknowledges immediately rather than looking inert — an inert-looking button invites a
   second press, which is the failure this guards.

## D4. Redecode reporting — Q-318 / Q-535
1. Press **Redecode** and watch the console.
2. **Pass:** it reports progress and a real outcome. **Fail:** it says "done" while work is still in
   flight, or reports "failed: 502" for work that actually succeeded.

## D5. Read stats and the raw DB footprint — Q-538
1. Press **Read stats**.
2. **Pass:** it returns real numbers. Note the `oura_raw.db` size — it grows without bound today
   because `pruneRaw` has no caller.

## D6. The sparkline axis — BF-10
1. `/admin/oura-ble` → **Device Metrics**, with ring data spanning an idle gap.
2. **Pass:** the sparkline plots by **time**, so a gap in sampling shows as a gap.
3. **Fail:** evenly-spaced points regardless of when they were taken.

## D7. Is `spo2V` populated? — Q-34
1. In the debug column view, check whether **`spo2V`** has values at all.
2. This is a yes/no that unblocks a verdict; no pass/fail beyond reporting what you see.

---

# Standalone

## S1. Outbox flush on pull-to-refresh — offline-first
1. **Airplane mode.** Log something (a set, a food item, a mood check-in).
2. Networking back on → **More** → **pull down to refresh**.
3. **Pass:** the write reaches the server — force-close, reopen, the entry is still there.
4. **Fail:** it disappears after a restart, or the refresh spins without settling.

*Note:* **"Sync now"** in Data & Sync only **pulls**. Pull-to-refresh on More is the one that pushes.

## S2. A score with no value renders as "—" — Q-278 / Q-281 · **JS**
1. Health → Readiness, and Health → Activity. Find a day with **no score**.
2. **Pass:** the value reads `—`, with no band label attached.
3. **Fail:** it reads `0`, carries yesterday's number, or shows a band label beside a dash.

## S3. Cold-start time to first paint — BF-19 / Q-147
1. Force-close. Open, and **count seconds** until Home shows real numbers, not skeletons.
2. Repeat twice; a rough range is enough — "about 4 seconds, maybe 6 the first time" is usable.

*Why:* nothing in the app measures this, so there is no baseline to improve against.

## S4. Barcode scan of a zero-calorie product — **JS** · LB-15 / LA-30
1. Nutrition → scan a barcode for something with **0 kcal**.
2. **Pass:** found, and **Save** is enabled. **Fail:** "not found", or Save stays greyed out.

## S5. Photo/pill scan that would not log — **JS** · owner report 2026-08-25
1. Repeat the failing scan.
2. **Fail:** note whether the item was *not recognised* or recognised but *not loggable* — two
   different bugs the screenshot did not separate.

## S8. One photo scan, timed — BF-4 · **JS**

**The whole gate on BF-4 is a single scan.** Every hypothesis about *"the photo scan feels slower"*
has already been measured against production `ai_call_log`; what is missing is one current sample to
compare them to.

1. Nutrition → add food → **camera** (a photo scan, **not** a barcode).
2. Scan any food. Note roughly how long from shutter to the result appearing.
3. **Pass:** it completes. Either way, say how long it felt and whether that matches your original
   report — a scan that now feels fine is as useful an answer as a slow one, and closes the entry.

## S9. Overnight ring drain on the current APK — Q-388

**Must be the current `apk-latest` build.** The fast-HR trap fix shipped in
`feat/ring-service-device-pass` and has never reached the ring; the entry says to measure its effect
**before** anything else is attempted, and nobody can while the device runs an older build.

1. Install the current APK (see CLAUDE.md → *Getting a new APK*; the rolling release upgrades in
   place, no uninstall).
2. Wear the ring one full night with **no charging**.
3. Report the battery percentage at bed and on waking, and the hours between.
4. **Pass:** drain is materially better than the measured **15–38 points over ~9.8 h**. Stock Oura
   firmware, with SpO₂ equally on, ran ~14%/day — that is the number to beat.
5. **Do not turn SpO₂ off to improve this.** You already established the binary framing was wrong;
   the entry is now about finding what *we* do differently from stock.

## S6. Coach changing your programme — Q-467
1. Ask Coach for a programme change and accept it.
2. **Pass:** the app reflects it, and a stale/conflicting change is refused rather than applied twice.

## S7. Catalogue hydration after a fresh install — BF-16a

**Only if you are already reinstalling for another reason. Do not uninstall to run this.**

> ⛔ **An uninstall destroys the Oura ring key**, which lives only in Android SharedPreferences and
> is not recoverable from this repo, the server, or any log. The owner confirmed on 2026-08-26 that
> a backup of `key.hex` exists. Flush the outbox (S1) before any uninstall regardless — unsynced
> mutations do not survive it.

1. After a fresh install and login, open **Config → exercise picker**.
2. **Pass:** the catalogue is populated without a manual sync.

---

# Gated on a device but NOT a press

Listed so nobody goes looking for a button. These need a device to *exist*, not to be tapped.

- **Q-250** — an Android emulator job in CI. Infrastructure work (Maestro/Espresso-shaped), and the
  thing that would retire much of this file.
- **PS-7** — the camera pose-landmarker spike. Needs an APK built with a throwaway route, and a
  confirm-before-merge decision first; it is not a check of shipped behaviour.
- **Q-486** — the workout outbox's silent enqueue failure. **Cannot be induced on a working phone** —
  reproducing it needs a broken local store. Carried as a known gap, not a check.
- **Q-544** — server-side disk maintenance behind a native-plugin gate. Wants the same
  GET-preview + press-until-`remaining: 0` treatment as the other maintenance buttons; until that is
  built there is nothing to press.
- **Q-7b** — ten device-owned `oura_daily_derived` columns have no producer. A missing writer, not a
  check.
- **Q-168** — AI Coach follow-ups. A feature, not a verification.
