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

## N1. The delete that did nothing — BF-34
1. Nutrition → tap a logged food row → tap the **bin**.
2. **Pass:** the "Delete food log?" confirmation appears **and stays**, and you can tap it.
3. **Fail:** it flashes and vanishes, leaving nothing to press — the original report.
4. Then tap **Cancel**. **Pass:** the food is still there.

*Why:* the sheet closed and the dialog opened in the same tick, and the dialog mistook the sheet's
exit for a back press. Fixed against a state machine and e2e, never on a real gesture bar.

## N2. Back unwinds the nest one layer per press — LB-17 / BF-30 / LB-16
1. Nutrition → **Log Food** → the **Meals** tab → tap a **meal**.
2. Press back **twice** — not three times. LB-16 removed a layer: Log Food *is* the list now, so the
   old middle step is gone. If you find yourself pressing a third time, something regressed.
3. **Pass:** meal → the Log Food screen → the page. One layer per press, nothing skipping two.
4. **Fail:** any press closes two layers at once, or the first press leaves the page entirely.
5. Also: **switch tabs a few times first, then press back.** It must still take exactly two presses —
   a tab is not a navigation and must not consume one.

## N3. The swipe tray on the meal list — BF-29
1. On the **Meals** tab, scroll the list vertically, including a diagonal thumb-flick.
2. **Pass:** no action tray opens by accident.
3. Drag one row **left**. **Pass:** the tray opens; a right-drag closes it; opening a second row
   closes the first; tray **Delete** raises a confirmation rather than deleting.

*Why:* a gesture this app has nowhere else, and the sandbox cannot prove it coexists with Samsung's
own scroll physics.

## N4. The Log Food screen, rebuilt — LB-16 / BF-37 · **the big one in this section**
1. Nutrition → **Log Food**. There should be **no tile grid** and no "How would you like to log
   food?" — the screen opens on a list, with **Recent · Meals · Single foods** as tabs and
   **Photo · Barcode · Describe or enter** as a row above them.
2. **Pass:** three tabs readable at this width without wrapping; the action row's three buttons all
   comfortably tappable.
3. **Meals** holds only saved meals; **Single foods** holds only single foods. Tapping a meal opens
   its own screen; tapping a food goes to the portion step.
4. **Recent** shows what you last logged. ⚠ It is scoped to the *current meal bucket*, so at 7 pm it
   shows dinner foods, not everything (LB-18). **Tell us whether that reads right or wrong** — that
   is the open question, not a defect.
5. Tap **Describe or enter**: the description box and the "enter them yourself" way out must both be
   visible at once, without hunting.
6. Tap **Photo**, then **Barcode**: each should take the whole screen — the tabs must not still be
   showing behind a half-open camera.
7. Also look at: a meal row's photo tile rendering in a long scroller (data-URI images in a list are
   a shape Samsung's compositor has mishandled before).

*Why this one matters:* it is a new tab strip, a rebuilt action row and one fewer sheet in the back
stack, and the sandbox renders none of those the way the phone does.

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

## N6. The day screen's grouping — BF-24
1. Nutrition, main day view.
2. **Pass:** each meal is its own card with its name as a label above it — food rows grouped *within*
   a meal, not meals grouped inside one container.
3. Owner's watching brief: do the grouped-section backgrounds read well at this size?

## N7. The food-database row's mismatch warning — Q-406 · **JS**
1. Nutrition → **Log Food** → the **Meals** tab → **New** → search the food database for something
   whose macros and calories disagree (many branded products do).
2. **Pass:** the row shows the amber line *"Its macros and calories disagree — check before using"*,
   with its macros still readable beside it, and a tap still adds the food.
3. **Fail:** the sentence is missing (an icon alone has no hover on a phone), or the tap no longer
   adds — the row lost its `+` in this conversion, deliberately, because the tap is the add.

## N8. Water — Q-319
1. Log water from the **Water widget**, then log a different amount again.
2. **Pass:** the second write adds to the first rather than replacing it, and survives a force-close.

---

# App shell and gestures — one pass clears four

## A1. The back gesture across surface types — BF-27
1. Press back on: **a plain sheet**; **a confirm dialog**; **a nest** (Log Food → My Foods).
2. **Pass:** each closes the top surface only, and the page underneath does **not** navigate away.
3. **On the dialog specifically — it must CANCEL, never confirm.** Verify the underlying thing still
   exists afterwards.

## A2. The timeline's row taps — Q-93-followup · **JS**
1. Home → timeline → tap a **workout** row, then a **walk** row.
2. **Pass:** each opens `/health/day`, and back returns to Home.
3. **Also:** does the row's tap fight `PullToSync`'s vertical gesture? A short downward drag started
   on a row should scroll or refresh, not open the row.

## A3. Timezone auto-detect across local midnight — Q-477
1. Profile → **Auto-detect timezone**.
2. Leave the app open across **local midnight**, then bring it to the foreground.
3. **Pass:** the day rolls over — Home shows the new day rather than yesterday's.

*Why:* the rollover hangs off `visibilitychange`, which behaves differently in a WebView.

## A4. A card whose fetch fails — Q-499
1. Turn on **airplane mode**, then open a screen with self-fetching cards (Health).
2. **Pass:** cards that cannot load say so.
3. **Fail:** a card silently vanishes, which reads as "no data" rather than "this failed".

---

# Workouts — one pass clears three

## W1. Safe-area on a navless takeover
1. Start a workout and reach a **full-screen phase** (warm-up, or an active set screen).
2. **Pass:** the bottom action button sits clear of the gesture bar — tappable without the system's
   back/home gesture firing first.
3. **Fail:** flush with or under it. **Screenshot this one** if it fails.

*Why:* the sandbox renders safe-area insets as 0. This class has recurred eleven times.

## W2. The set flow past set 1 — Q-461
1. Log set 1, then set 2, then set 3 without leaving the screen.
2. **Pass:** each logs; the 3-second countdown between the press and the warm-up behaves.
3. **Also, one look with Android's reduce-motion ON** — the bounce is the cue that a set is ready,
   and reduce-motion may remove it entirely.

## W3. Volume landmarks at S25 width — Q-305
1. Wherever the landmarks now render, look at them at **412 dp**.
2. **Pass:** nothing is clipped or wrapped into unreadability.

---

# Devices / Oura BLE — one pass clears seven, needs the ring

These are the admin consoles. Several are buttons that were added but never pressed on the phone.

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
