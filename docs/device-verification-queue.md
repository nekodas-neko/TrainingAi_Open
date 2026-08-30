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
2026-08-26). **A first full pass ran 2026-08-29/30** — struck items carry the owner's own words and
the date. Three of them are **not** presses and are listed at the end so nobody hunts for a
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


## ~~A1. The back gesture across surface types~~ ✅ 2026-08-30
Owner: *"Confirm this works."* Sheet closes without leaving the tab; the delete dialog **cancels**
rather than confirms; the nest unwinds one layer per press (N2). **BF-27 is device-verified across
all three surface types.**


## A2. The timeline's row taps — **FAILED 2026-08-30, filed as [BF-49](implementation-backlog.md)**
Owner: *"tapping workout; then back -> leads to heath training not home. Same with tapping a food
item from timeline."* Back resolves to the tab that owns the destination rather than unwinding to the
origin, on both routes. Nothing further owed from the device until BF-49 ships.


## A3. Timezone auto-detect across local midnight — Q-477 · **deferred by the owner 2026-08-30**
*"lets leave this on the backburner; will be hard to test."* It is: the check needs the app open
across local midnight. Still owed; a future run should schedule it rather than attempt it on demand.


## ~~A4. A card whose fetch fails~~ ❌ FAILED 2026-08-30 — Q-499 confirmed
Owner re-ran it properly (airplane mode, then reopen): *"nothing said it couldnt load."* A card whose
fetch fails renders as absence. **Q-499's gate is cleared as a failure** and it is now a build item;
nothing further owed from the device until it ships.


## ~~W1. Safe-area on a navless takeover~~ ✅ 2026-08-30
Owner: *"Seems good!"* The bottom action button on a full-screen workout phase clears the gesture
bar. The eleven-times-recurring class is clear on this build.


## W2. The set flow past set 1 — Q-461 · **deprioritised by the owner 2026-08-30**
*"Not sure if I care about this?"* Fair — it verifies that sets 2 and 3 log and the countdown
behaves, which the owner exercises every session anyway. **Treat a normal workout as the check:** if
sets log and the rest timer behaves, it passes. Only worth a deliberate run for the reduce-motion
half, since nothing else in the app depends on that setting.


## ~~W3. Volume landmarks at S25 width~~ ✅ 2026-08-30
Owner: *"Looks good."* Nothing clipped or wrapped at 412 dp. **Q-305 is device-verified.**


## D1. Devices card vs a keyless service — LB-5 · **not safely testable, 2026-08-30**
Owner: *"Not sure what to look for; everything is always connected."* Correct, and the item was
badly written: it asks what the card does **when no ring key is stored**, and the only way to reach
that state is to remove the key — which is the one thing that must never be done, since the key lives
only in Android SharedPreferences.

**Reclassified as not-a-press.** LB-5 should be verified in code or with a test double, not by
breaking the device. Moved to the "gated on a device but NOT a press" list below.

**What the owner found instead is [BF-53](implementation-backlog.md), and it is live:** *"the 'not
me' button for weigh in's doesnt actually remove it."* Both the dismiss and confirm routes validate a
`bigserial` id with a UUID regex, so every press returns 400 and the client swallows it.


## ~~D2. The frame packer button~~ ✅ 2026-08-30 — correctly disabled, and it says why
The screenshot answers it: **Pack sealed frames (Lever 5)** is greyed out with the reason printed
beside it — *"no sealed buckets to pack"*. That is the pass, and better than the check asked for,
since it explains itself rather than just being inert. **Q-316 is device-verified.**

The earlier worry that 652k rows meant something was pack-able was wrong: sealed *buckets* are the
unit, not rows, and there are none. The same screenshot instead produced **BF-54** — the table list
beside this button reports 297 rows for a table holding 180,415.


## D3. Declaring a re-key — Q-317 · **declined by the owner 2026-08-30, and rightly**
Owner: *"Dont wanna press a rekey button."* Good instinct — the button only *declares* a re-key to
the server, but nothing on screen says that, and a control the owner is afraid to press near the ring
key is itself a finding.

**Do not ask again.** Q-317's acknowledgement behaviour should be verified without pressing it in
production — a staging user, or a test. Reclassified as not-a-press.


## ~~D4. Redecode reporting~~ ❌ 2026-08-30 — fails the half it was checking
Owner: *"clicking redecode gave the message 'redecode job 1 started - this can take minutes'; thats
all I can really see."* One line, then nothing — no progress, no completion, no outcome. **That is
exactly the gap Q-318 and Q-535 describe**, now observed rather than inferred. The job may have
succeeded; the console cannot say. Nothing further owed from the device until the polling ships.


## ~~D5. Read stats and the raw DB footprint~~ ✅ 2026-08-30 — measured
Owner: **652,417 total rows, 95.7 MB on disk.** Read stats returns real numbers, so the button
passes — and the figure is the point. For scale, production Postgres was 171 MB at its 2026-08-18
baseline, so the phone is holding more than half a server's worth of raw frames under a retention
decision that says it should keep 14 days. Recorded on **Q-538**, whose `pruneRaw` still has no
caller.


## ~~D6. The sparkline axis~~ ⚠️ 2026-08-30 — soft pass
Owner: *"sure I think this is fine."* Taken as a pass, and flagged as a soft one: the check needs
data spanning an **idle gap** to distinguish index-plotting from time-plotting, and it is not clear
that condition was met. **If BF-10's symptom is ever seen again, disbelieve this line and re-run it**
against a period with a known gap.


## ~~D7. Is `spo2V` populated?~~ ✅ 2026-08-30 — yes
Owner: *"in the device metrics I see values for it."* That answers the question the item existed to
ask; the debug column view was the route suggested, not the requirement. **`spo2V` is populated.**


## S1. Outbox flush on pull-to-refresh — offline-first
1. **Airplane mode.** Log something (a set, a food item, a mood check-in).
2. Networking back on → **More** → **pull down to refresh**.
3. **Pass:** the write reaches the server — force-close, reopen, the entry is still there.
4. **Fail:** it disappears after a restart, or the refresh spins without settling.

*Note:* **"Sync now"** in Data & Sync only **pulls**. Pull-to-refresh on More is the one that pushes.

## ~~S2. A score with no value renders as "—"~~ ⊘ 2026-08-30 — no such day exists to test with
Owner, after being pointed at history: *"I cant find one without."* Every day reachable in Readiness
and Activity carries a score.

**Closed as un-exercisable rather than passed**, and the distinction matters: Q-278/Q-281 assert that
a *missing* score renders `—` with no band label, and that path has still never run on the phone.
**If a scoreless day ever appears** — a night the ring is not worn, a gap after a re-key — check it
then. Do not re-ask for this in the meantime.


## ~~S3. Cold-start time to first paint~~ ✅ 2026-08-30
Owner: *"loads fast."* No number captured, which is fine for a first reading — **the baseline this
was meant to establish is "fast enough not to notice"**, and BF-19's client-side reporter is what
will produce a figure when one is needed. Not worth re-asking for a stopwatch.


## ~~S4. Barcode scan of a zero-calorie product~~ ✅ 2026-08-30
Owner: *"it did the 0 cal supplement."* Found, and Save enabled. **LB-15 / LA-30 are
device-verified** — a zero-calorie product is no longer refused.


## ~~S5. Photo/pill scan that would not log~~ ✅ 2026-08-30 — no longer reproduces
The owner re-ran the failing scan as part of S4/S8 and it logged. **The 2026-08-25 report does not
reproduce on this build.** Recorded as *stopped*, not *fixed* — nothing in a diff was traced to it,
so if it returns it is a fresh report and not a regression of a known fix.


## ~~S8. One photo scan, timed~~ ✅ 2026-08-30 — BF-4's gate cleared
Owner: *"took about 4 seconds from analysing photo."* **Four seconds is not the slowdown BF-4 was
filed about**, and the owner ran it without complaint. BF-4 can close on this reading against its
measured `ai_call_log` figures.


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

## ~~S6. Coach changing your programme~~ ✅ 2026-08-30 — Coach passes; one line in it is a bug
The screenshot reverses the first reading. Coach proposed **Barbell Good Morning → Barbell Jefferson
Curl** exactly as asked, with six consequences, Cancel/Apply, and Q-403's permanence warning spelled
out. **Q-467's device gate is met.**

The report came from one line in that list — *"Sets the role to primary (was secondary)"* — which
nobody asked for and which silently undoes this owner's deliberate no-Primary `Lower` session. Filed
as **BF-56**. The card is not at fault; disclosing the change is how it was caught.


## S10. Pair the scale on the partner's phone — BF-58 · **costs nothing, may shrink the entry**
The scale pairing is **device-local** (`localStorage`, no server record), so a second phone pairing
the same scale needs no permission from anything.

1. On the partner's phone, in her own account: pair the same body-composition scale.
2. She steps on it with **her phone nearby and yours out of Bluetooth range** (another room).
3. **Pass:** the weigh-in appears in *her* account.
4. Then repeat with **both phones nearby** and report what happens — one phone, both, or neither.
   **That is the race BF-58 is about**, and one run answers it.

## S11. Does the scale buffer readings it could not deliver? — BF-58
**This single question decides whether the race in S10 matters at all.** If the scale stores a
weigh-in taken while no phone was listening and replays it on the next connect, the losing phone
catches up and nothing is lost.

`ScaleProtocol.REQUEST_STORED_MEASUREMENTS_CMD` (`0x22 0x04 0x15`) and `STORED_RECORD_MARKER`
(`0x23`) already exist in the code, and the comment is candid that they are **speculative, borrowed
from a different firmware generation, and never tested against this hardware**.

1. Weigh in with **no phone in Bluetooth range** — leave both phones in another room.
2. Bring your phone back and let it connect.
3. **Pass:** the earlier weigh-in arrives. **Fail:** nothing does. Either answer is useful — a "no"
   means the race is real and the band rule has to be right.

Plan: `docs/superpowers/plans/2026-07-30-scale-stored-measurement-drain-and-scan-latency.md`.

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
- **LB-5** — the Devices card against a keyless BLE service. Reaching that state means removing the
  ring key, which is the one action that must never be taken (it lives only in SharedPreferences).
  Verify in code or against a test double. *Moved here 2026-08-30.*
- **Q-317** — declaring a re-key. The owner declined to press it and was right to: nothing on screen
  says the button only *declares* a re-key to the server rather than re-keying the ring, and asking
  someone to press it near the one irreplaceable credential is a bad check. Verify off production.
  *Moved here 2026-08-30.* **The unclear labelling is itself worth fixing** — see Q-317.
