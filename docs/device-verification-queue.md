# Device verification queue — the S25 checks that are owed

**What this is.** The device gate in `CLAUDE.md` says an offline-first, native, safe-area, gesture or
notification change is unverified until it has been run on the Samsung S25 Ultra. Sessions cannot
reach a device, so each such change either waits or ships with a Known-Issues row saying it is not
device-verified. This file is the running list of what is owed, so one device run can clear several
at once instead of the owner being asked piecemeal.

**How to use it.** Work top-down; each item names the screen, the action, and what a *pass* looks
like. Answering "pass" or describing what actually happened is enough — a screenshot only where the
item asks for one. Items are struck from this file in the PR that acts on the answer.

**Build to test against:** the current `apk-latest` release, or a Railway deploy if the item is
JS-only (marked **JS** below — those need no new APK, just a fresh app open).

---

## 1. Barcode scan of a zero-calorie product — **JS** · LB-15 / LA-30

1. Nutrition → scan a barcode for something with **0 kcal** (sparkling water, a sugar-free drink,
   black coffee pods).
2. **Pass:** the product is found, and the **Save** button is enabled.
3. **Fail:** "not found", or the product appears but Save stays greyed out.

*Why:* the save guard required `calories > 0`, so a genuinely zero-calorie product read as invalid.
Lane B shipped a fix; nobody has confirmed it against a real barcode.

## 2. Photo/pill scan that would not log — **JS** · owner report, 2026-08-25

1. Repeat the scan that failed: photograph the supplement/pill.
2. **Pass:** the scan returns something and the log button works.
3. **Fail:** note whether the item was *not recognised*, or recognised but *not loggable* — these
   are two different bugs and the screenshot did not separate them.

## 3. Outbox flush on pull-to-refresh — offline-first

1. Turn on **airplane mode**. Log something (a set, a food item, a mood check-in).
2. Turn networking back on. Go to **More** and **pull down to refresh**.
3. **Pass:** the write reaches the server — reopen the app and the entry is still there after a
   force-close.
4. **Fail:** the entry disappears after a restart, or the refresh spins without settling.

*Note:* the **"Sync now"** button in Data & Sync only **pulls**. It does not flush the outbox. Pull-to-refresh on More is the one that pushes.

## 4. Safe-area clearance on a navless takeover screen

1. Start a workout and reach a **full-screen phase** (warm-up, or an active set screen).
2. **Pass:** the bottom action button sits clear of the gesture bar — you can tap it without the
   system's back/home gesture firing first.
3. **Fail:** the button is flush with or under the gesture bar. **Screenshot this one** if it fails.

*Why:* the web sandbox renders safe-area insets as 0, so this class of regression is invisible until
it is on the phone. It has recurred eleven times.

## 5. A score with no value renders as "—" — **JS** · Q-278 / Q-281

1. Health → Readiness, and Health → Activity. Find a day with **no score** (scroll back; Activity
   has one on roughly half of all days).
2. **Pass:** the value reads `—`, with no band label ("Low"/"Good") attached to it.
3. **Fail:** it reads `0`, or carries yesterday's number, or shows a band label next to a dash.

## 6. Cold-start time to first paint — BF-19

1. Force-close the app. Open it and **count seconds** until the Home screen shows real numbers
   (not skeletons).
2. Repeat twice more and give the rough range. A stopwatch is not needed — "about 4 seconds, maybe 6
   the first time" is a usable answer.

*Why:* nothing in the app measures this, so there is no baseline to improve against. The one
measurable driver identified so far is 80 deferred module loads.

## 7. Catalogue hydration after a fresh install — BF-16a

**Only if you are already reinstalling for another reason.** Do not uninstall to run this.

> ⛔ **An uninstall destroys the Oura ring key**, which lives only in Android SharedPreferences and
> is not recoverable from this repo, the server, or any log. The owner confirmed on 2026-08-26 that
> a backup of `key.hex` exists. Flush the outbox (item 3) before any uninstall regardless — unsynced
> mutations do not survive it.

1. After a fresh install and login, open **Config → exercise picker**.
2. **Pass:** the exercise catalogue is populated without needing a manual sync.
