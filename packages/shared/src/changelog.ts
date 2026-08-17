export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.318.7",
    date: "2026-08-17",
    changes: [
      "Accessibility: the option groups across the app \u2014 intensity and session length on Workout, the goal and profile pickers, the home score-card style \u2014 now respond to the arrow keys and act as a single stop when tabbing, instead of making you tab through every option one at a time. The goal pickers also stop greying themselves out for the moment it takes to save, which was interrupting keyboard use. Nothing changes for touch.",
    ],
  },
  {
    version: "1.318.6",
    date: "2026-08-17",
    changes: [
      "The AI Insight card no longer appears on a health screen that has nothing recorded yet. It was being asked to comment on empty data and would state your steps were zero rather than unrecorded \u2014 a brand-new account was told its inactivity created a significant gap on its first ever visit. Screens that do have data are unchanged.",
    ],
  },
  {
    version: "1.318.5",
    date: "2026-08-17",
    changes: [
      "Internal: a repeating server fault no longer fills the error log with thousands of near-identical copies of itself. One fault in August wrote 5,771 entries and 49 MB \u2014 the de-duplication was there, but each copy looked different to it because the database driver includes the whole query text, which changes with the size of the batch that failed.",
    ],
  },
  {
    version: "1.318.4",
    date: "2026-08-17",
    changes: [
      "Admin: when a re-decode fails it now says why. It was reporting which database query failed and never the reason, so a timeout, a dropped connection and a permissions problem all looked identical \u2014 which is why the sleep-time re-decode failed three times without anyone being able to tell what was wrong.",
    ],
  },
  {
    version: "1.318.3",
    date: "2026-08-17",
    changes: [
      "The Workout tab now tells a new account what to do instead of showing an empty card with a Start Workout button that did nothing. Before you have a program it says so and offers to create one; cardio and one-off activities were always available and still are.",
    ],
  },
  {
    version: "1.318.2",
    date: "2026-08-17",
    changes: [
      "The sleep-time fix in 1.318.0 did not actually apply \u2014 the database change behind it was too large to finish inside the time limit it runs under, so it was undone every time the app started, and re-decoding your history faithfully rebuilt the same wrong times. Split into two smaller steps, the important one first. **Run the re-decode again once this is live** \u2014 the previous run could not have worked.",
    ],
  },
  {
    version: "1.318.1",
    date: "2026-08-17",
    changes: [
      "Fixed: an activity started from the Coach's \"Log an activity\" link, from the end of a guided walk, or by opening the activity screen directly is no longer thrown away when you save it. Those routes left the screen with no activity type — it still timed the activity and still offered Save, but Save quietly did nothing and the activity was gone. The screen now asks what you are doing first, and Save says so if anything is still missing.",
    ],
  },
  {
    version: "1.318.0",
    date: "2026-08-17",
    changes: [
      "Groundwork for fixing the sleep times on Health, which have been showing midday bedtimes since the app was reinstalled. Re-pairing the ring made it replay several days of stored history, and the app mistook that replay for the ring\u2019s clock having been reset \u2014 which shifted every night in your history by about 14 hours. Nothing was lost: the readings are all still there and the durations, heart rate and HRV were never affected. This release corrects the clock records themselves; the stored nights are rewritten by a follow-up re-decode.",
    ],
  },
  {
    version: "1.317.6",
    date: "2026-08-17",
    changes: [
      "Fixed: a panel that streams new content no longer drags the whole page down with it. The ring's debug log did this on every line during a scan — the screen kept sliding away while you were aiming at a button, on the one screen where a mistimed tap can clear the ring key. The AI chat in the program builder had the same fault and is fixed with it.",
    ],
  },
  {
    version: "1.317.5",
    date: "2026-08-17",
    changes: [
      "Fixed: a deload the coach decides on its own now actually lightens the session. It was labelled \"Deload\" on the workout header while prescribing full weights, which is why one kept getting recommended \u2014 nothing about the training had changed, so the fatigue that triggered it never cleared. Sets now drop to the lighter deload prescription, and the session no longer flashes a \"New Personal Record!\" on submaximal work. Your recorded personal bests were never affected: the server has always refused to store a PR from a deload, so the badge was showing a record that was not being kept.",
    ],
  },
  {
    version: "1.317.4",
    date: "2026-08-17",
    changes: [
      "Accessibility: the option groups on More — Fitness Goal, Biological Sex, Activity Level, Weight Units and Food Region — now announce what they are and which option is selected. A screen reader previously read the buttons as a loose run with no indication of what they were choosing between. The Auto-detect button on the Timezone row now says what it detects.",
    ],
  },
  {
    version: "1.317.3",
    date: "2026-08-16",
    changes: [
      "Accessibility: the goal and body-measurement fields on More (steps, sleep, water, calories, weight, body fat) now announce their names to screen readers. They were showing a visible label that was not attached to the field underneath it.",
    ],
  },
  {
    version: "1.317.2",
    date: "2026-08-16",
    changes: [
      "Fixed: changing a goal on More now shows up on Health straight away. The water goal was fetched only by the Progress tab, so the value shown on the Body tab was never refreshed — your new goal was saved correctly the whole time, it just wasn't on screen.",
    ],
  },
  {
    version: "1.317.1",
    date: "2026-08-15",
    changes: [
      "Fixed: logging Exercise Readiness on Home now swaps the prompt for your tuned recommendation the moment you tap save, instead of leaving \"How are you feeling?\" on screen underneath the \"Readiness saved\" toast. The card was waiting on a local database write that can queue for minutes behind a sync.",
    ],
  },
  {
    version: "1.317.0",
    date: "2026-08-15",
    changes: [
      "Fixed: swiping to a previous day on Nutrition and back to a fresh today no longer leaves the previous day's meals showing on today. The screen keeps what is on it when a refresh comes back empty — so a hiccup can't wipe food you just logged — but it now knows which day that food belongs to, instead of holding onto it across a date change until the app was restarted.",
      "The weekly Training Load bar now draws a deload day as the training it was, striped rather than solid, instead of showing it as the same flat grey mark a rest day gets. Deload volume still stays out of the week's total lifted, so the headline number is unchanged. A testing day is now marked T rather than D.",
      "The day screen now has an Energy section: eaten, burned, and the net for the day, broken down into what came from workouts, activities, steps and resting burn. It reads the same numbers as Nutrition's Energy Balance card rather than computing its own. It stays out of the way on a day with nothing logged.",
      "Activity rows on the day screen show distance, calories, pace, average and max heart rate, steps and elevation — all of which the screen already had and was not displaying — instead of just a title and a duration.",
    ],
  },
  {
    version: "1.316.0",
    date: "2026-08-15",
    changes: [
      "Nutrition now has a Log Food button in its action row, alongside Water and Saved Meals. It opens the logger already set to the meal you are most likely eating, worked out from the time of day against your own Breakfast/Lunch/Dinner hours — the same way saving a meal and logging a planned meal already decide.",
    ],
  },
  {
    version: "1.315.0",
    date: "2026-08-15",
    changes: [
      "Planned meals can now be answered both ways. Alongside \"I ate this\" there is a dismiss button for a meal you skipped, so the plan stops asking about it for the rest of the day — and one tap undoes it if you hit it by mistake. Declining a meal never adds anything to your food or macros for the day.",
    ],
  },
  {
    version: "1.314.0",
    date: "2026-08-15",
    changes: [
      "Water and Saved Meals now sit directly under the macro ring on Nutrition, above your meals. Saved Meals used to be below every meal card, so how far you scrolled to reach it depended on how many meals your day had.",
    ],
  },
  {
    version: "1.313.0",
    date: "2026-08-15",
    changes: [
      "The developer tools — ring BLE debug, cadence calibration, device data capture, the error log, AI usage and the day-review audit — have moved out of the Admin Console to Settings → Developer. They were buttons inside a tab inside a console reachable only from the bottom of the More scroll, despite being the tools used most often. Admin now holds user administration only: users, invites, exercises, activities and feedback.",
    ],
  },
  {
    version: "1.312.0",
    date: "2026-08-15",
    changes: [
      "The Program Builder is its own screen at /program, opened from a control in the Workout tab's header or from More → Program. It used to live inside More under a sub-tab also called \"Workout\", two screens away from the Workout tab itself.",
      "The \"New program\" button on a post-deload AI prescription now actually opens the new-program sheet. It opened the Program Builder and stopped there, because the redirect in between dropped the part of the link that said which sheet to open.",
    ],
  },
  {
    version: "1.311.0",
    date: "2026-08-15",
    changes: [
      "Preferences, Theme & Appearance and Home Widgets have moved onto their own Settings screen, reached from a row in More. More is now a short list of rows instead of one long scroll holding your profile, achievements, goals, devices, every setting and the changelog.",
    ],
  },
  {
    version: "1.310.0",
    date: "2026-08-15",
    changes: [
      "\"Sync now\", \"Restore from cloud\" and \"Export my data\" have moved off the About list onto their own Data & Sync screen. They used to sit directly under the version number, which is not where anyone looks for a restore.",
    ],
  },
  {
    version: "1.309.0",
    date: "2026-08-15",
    changes: [
      "Your ring, chest strap and scale now live on a single Devices screen, reached from a row in More. They used to be four separate cards stacked two-thirds of the way down the More scroll, so \"is my ring connected?\" meant scrolling past your achievements and goals to find out.",
    ],
  },
  {
    version: "1.308.0",
    date: "2026-08-15",
    changes: [
      "The \"Why this recommendation?\" panel now tells you when body temperature isn't being used yet, and how far along its baseline is — for example \"still learning your baseline (18 of 30 nights)\". Before this it simply said nothing about temperature until a full month of sleep had been recorded, which was indistinguishable from the feature not existing.",
    ],
  },
  {
    version: "1.307.3",
    date: "2026-08-15",
    changes: [
      "The Heart Rate screen could fail to render on arrival when it had a cached profile to show. It read that cache while the page was still being built on the server, which produces two different first paints and can blank the screen.",
    ],
  },
  {
    version: "1.307.2",
    date: "2026-08-14",
    changes: [
      "Removed the Health tab's leftover card show/hide mechanism. The screen that set it was taken out in June 2026 but the reading half stayed, so any card hidden in that brief window stayed hidden with no way to bring it back — those cards are visible again.",
    ],
  },
  {
    version: "1.307.1",
    date: "2026-08-14",
    changes: [
      "Changing a goal now shows up on the Health tab straight away instead of after up to half an hour. The same delay applied to goals changed through Coach.",
      "Your goals are now kept on the server rather than only on the phone you set them on. Before this, opening the app on another device — or after a re-install — could show default goals while your real ones sat on the server, with no way for the two to agree.",
      "Clearing a goal now works. Emptying a goal field used to leave the old value stored, so it came back the next time the screen loaded.",
    ],
  },
  {
    version: "1.307.0",
    date: "2026-08-14",
    changes: [
      "Walks, runs and hikes now record a step count and calories burned instead of leaving both blank. Steps are worked out from the cadence your chest strap was already recording during the activity, and calories from its duration and your profile — both shown as estimates, because that is what they are.",
    ],
  },
  {
    version: "1.306.5",
    date: "2026-08-14",
    changes: [
      "Fixed four places where a save could be lost if the app's on-device database was not available: a finished guided walk, the end-of-day check-in, saving a meal, and deleting a food entry. They now fall back to saving on the server instead. The walk screen was the worst of them — it said the walk was saved and would sync later, when in fact nothing had been stored anywhere.",
    ],
  },
  {
    version: "1.306.4",
    date: "2026-08-14",
    changes: [
      "The Exercise Readiness check-in could open showing sore muscles left over from an earlier time you opened it, sometimes wide enough to warn about a whole-session deload — then show the right, shorter list if you closed and reopened. It now works out the suggestions fresh each time you open it.",
    ],
  },
  {
    version: "1.306.3",
    date: "2026-08-14",
    changes: [
      "Tell the AI Coach something hurts and it now asks about it — which exercise, what the pain is like, when it started — instead of immediately offering to log an injury. It was also filling in a severity you had never mentioned; it no longer guesses, and when it does not know, the confirmation screen tells you what will be recorded and where to change it.",
    ],
  },
  {
    version: "1.306.2",
    date: "2026-08-14",
    changes: [
      "Fixed the source of that 72.5 kg Incline Bench Press prescription. One log from the August 6th deload week kept a max-effort estimate it should never have had, and the app was allowed to read it as a genuine best lift. It now refuses to build a prescription off any deload set, whatever that set claims, and the bad row has been corrected.",
    ],
  },
  {
    version: "1.306.1",
    date: "2026-08-14",
    changes: [
      "AI workout plans now go stale after a week, as they were always meant to. If you hadn't run a particular session for more than seven days, it kept handing you the exact numbers it worked out last time — so a session planned during a deload week could still be prescribing deload percentages days after you'd recovered. It now regenerates instead.",
    ],
  },
  {
    version: "1.306.0",
    date: "2026-08-14",
    changes: [
      "The Oura Cloud connection is gone — the Connect / Sync Now / Disconnect buttons, the Health tab's Sync button, and the background syncs behind them. Your ring has been read directly over Bluetooth since July, so none of those could fetch anything; they just spent a request failing. All of your older Oura data is untouched.",
      "The ring card on More → Profile now shows what is actually true: battery and when the ring was last heard from, over Bluetooth. It used to show a battery percentage frozen since July, and a \"connected\" state that described a saved password rather than the ring.",
    ],
  },
  {
    version: "1.305.3",
    date: "2026-08-14",
    changes: [
      "The Warm Up countdown now scales with how long your session actually is. A 30-minute Quick session was still telling you to warm up for a flat 10 minutes, even though the app had already trimmed the exercise list to fit the shorter session — the two numbers came from different places. They now come from the same one, and the Android rest-timer notification agrees with the screen.",
    ],
  },
  {
    version: "1.305.2",
    date: "2026-08-13",
    changes: [
      "The \"Build or Modify Program\" link now actually opens the Program Builder. It was sending you to the More screen's Profile tab instead — the link worked, it just pointed at a tab name that no longer existed, so you landed somewhere real and wrong. The same link on the session-select recommendation card had the same problem.",
    ],
  },
  {
    version: "1.305.1",
    date: "2026-08-13",
    changes: [
      "Internal: a lookup table the app needs to read your ring's motion data was being shipped inside the app's own JavaScript, where anyone could fetch it without signing in. It is now served only to a signed-in session and cached on your phone, so step detection still works offline once the app has been online once.",
    ],
  },
  {
    version: "1.305.0",
    date: "2026-08-13",
    changes: [
      "The app no longer calls the Oura Cloud on its own. Since your ring moved onto our own Bluetooth key in July, that connection has been dead — but every finished workout and every app open still tried it, waited for it to be refused, and wrote an error nobody could act on. Your heart-rate data comes from the ring over Bluetooth and is unaffected.",
      "None of your Oura history is touched — everything synced before July is still there.",
    ],
  },
  {
    version: "1.304.3",
    date: "2026-08-13",
    changes: [
      "Internal: the server stopped logging a security warning on every restart that did not apply to it. Nothing was actually wrong, and a warning that is always there is one nobody reads. The real version of that problem — a stored login token the server can no longer unlock — now says so instead of failing with a confusing \"invalid token\" message.",
    ],
  },
  {
    version: "1.304.2",
    date: "2026-08-13",
    changes: [
      "Your ring's data is now processed once per sync instead of once per batch of it — the check meant to do that had been reading as \"always\" rather than \"only at the end\", so a single sync did the same work several times over.",
      "The admin Redecode tool also runs off the main thread now. It walks your whole ring history, and until now it did that where it could slow everything else down.",
      "Barcode lookups now record their failures. When barcode scanning stopped working earlier today there was nothing in the logs to explain it, because that one route never reported anything.",
    ],
  },
  {
    version: "1.304.1",
    date: "2026-08-13",
    changes: [
      "The server now processes your ring data on a separate thread. Even after the last few releases cut that job from half an hour to about two minutes, anything you did during those two minutes could still be slow or fail — a sync landing at the wrong moment got an error and made the ring send everything again. It no longer competes with the rest of the app.",
    ],
  },
  {
    version: "1.304.0",
    date: "2026-08-13",
    changes: [
      "Your Sleep Score's heart-rate and HRV parts now compare against your last two weeks instead of your whole history. Your HRV has roughly doubled and your resting heart rate has dropped a lot since you started — measured against the all-time average, almost every night looked better than baseline and scored a flat 100, which is why those two stopped telling you anything.",
      "Expect those two parts of the score to move around now, and a genuinely poor night to score lower than it used to.",
    ],
  },
  {
    version: "1.303.3",
    date: "2026-08-13",
    changes: [
      "Internal: closed a gap where ring data could be left unprocessed. If the server restarted between a sync arriving and it being processed, the next sync only covered its own data, so the stranded readings were never rolled up into your sleep and heart-rate history.",
    ],
  },
  {
    version: "1.303.2",
    date: "2026-08-13",
    changes: [
      "Fixed the app going slow for a few minutes after every update. The previous release stopped the server reprocessing all your ring history on each sync, but a fresh server still had no record of how far it had got, so it redid the lot once per deploy — about six minutes of everything being slow, every time. That progress marker is now saved, so a restart picks up where it left off.",
    ],
  },
  {
    version: "1.303.1",
    date: "2026-08-13",
    changes: [
      "Internal: when the AI food scan fails, the failure is now recorded where it can be seen. It was only ever written to the server console, so a scan that kept failing was invisible unless someone went looking by hand.",
    ],
  },
  {
    version: "1.303.0",
    date: "2026-08-13",
    changes: [
      "The app should stop going slow for stretches at a time. Every time the ring synced, the server re-processed the last 35 days of ring data from scratch — about a million records — to take in the few minutes that were actually new. Those passes take longer than the gap between syncs, so they ran back to back and blocked everything else: scanning food, saving a workout, even screens that touch no data at all could sit there for a minute or more. It now only re-processes what changed.",
    ],
  },
  {
    version: "1.302.3",
    date: "2026-08-13",
    changes: [
      "Barcode scanning now tells you when the food database is down, instead of saying the product isn't in it. Open Food Facts had an outage today and every scan came back as \"no match found\" — which sent you off to type the item in by hand for no reason. Scanning a photo and entering manually still work either way.",
    ],
  },
  {
    version: "1.302.2",
    date: "2026-08-13",
    changes: [
      "Fixed heart-rate readings going missing during a workout. If the chest strap ever sent two readings stamped at the same second, the whole batch around them was rejected — losing up to 5,000 points at once, not just the repeated one. The strap then retried and failed the same way, so those readings were gone for good.",
    ],
  },
  {
    version: "1.302.1",
    date: "2026-08-13",
    changes: [
      "Fixed a check-in that could disappear behind a \"saved\" message. If you tapped Save in the first few seconds after opening the app — while it was still upgrading its on-device database, which it does once after every update — the write reached nothing and nothing was queued to send. It now waits for the database, and if it genuinely cannot use it, saves straight to the server instead.",
      "The morning and readiness check-ins now close the moment you tap Save. They used to sit on \"Saving…\" until the on-device write finished, which meant waiting behind whatever the background sync was doing — up to a couple of minutes on a bad morning. The save still completes, just not while you watch it.",
    ],
  },
  {
    version: "1.302.0",
    date: "2026-08-12",
    changes: [
      "Removed the old chat screen that nothing in the app linked to any more. Every chat entry point already went to Coach; this was a second copy sitting behind it with its own AI route.",
      "Read-aloud is gone with it. It could only ever be started from that unreachable screen, so it has not been usable for some time.",
    ],
  },
  {
    version: "1.301.0",
    date: "2026-08-12",
    changes: [
      "A deload week now lightens every exercise in the session, not just the ones the AI wrote a prescription for. Accessories used to stay at full weight, and a session whose prescription had expired stayed at full weight entirely — so a deload week could reduce nothing at all.",
      "Expect deload weeks to feel noticeably easier than they did.",
      "Reverting to full weights still works for these exercises, the same as before.",
    ],
  },
  {
    version: "1.300.0",
    date: "2026-08-12",
    changes: [
      "Prescribed weights now follow your last real session instead of your all-time best. If you deliberately drop the weight to work on form, the app comes down with you — before, the all-time PR always won, so no number of lighter sessions could ever lower what it asked for. Your PR record is untouched; only the prescription changed.",
      "The flip side, so it is not a surprise: one light or interrupted session will now lower the next prescription too.",
      "Deload sessions are skipped when working this out, so a deload week no longer throws away the real session before it.",
      "Fixed the target weight showing 0 kg, and the weight dial starting at zero, for the whole session after a deload.",
    ],
  },
  {
    version: "1.299.0",
    date: "2026-08-12",
    changes: [
      "A planned meal can be logged in one tap. Open the plan card, expand the meals, and \"I ate this\" writes every ingredient into your day — so the plan finally does something on the day it is for, instead of telling you what to eat and then playing no part in it.",
      "Each ingredient lands in your food library as a reusable item rather than a one-off portion, so \"Cooked quinoa\" is something you can log again at any weight.",
      "A meal already logged shows as logged instead of offering to log it twice, and it goes into the bucket the plan intended — logging the 7am breakfast at 3pm still files it under breakfast.",
    ],
  },

  {
    version: "1.298.0",
    date: "2026-08-12",
    changes: [
      "You can reorder meals and tell a meal what to change while you are still building the plan, not only after saving it. Both controls existed on a saved plan and were missing from the setup screen where you actually first see the meals.",
      "Moving a meal in the setup screen re-splits the day around the new order, the same as it does on a saved plan — a meal that lands next to your training time gets more carbs, and its portions are resized to match.",
      "Batch recipes read more clearly. A recipe now makes \"portions\" while an ingredient is measured in \"servings\" of that food, so the two are no longer the same word meaning different things, and the totals show the whole batch and one portion side by side.",
    ],
  },

  {
    version: "1.297.0",
    date: "2026-08-12",
    changes: [
      "Your macro targets tell you when they do not add up to your calorie goal, and offer to fix it in one tap. They were four independent boxes with nothing keeping them in agreement — 150g protein, 180g carbs and 60g fat is 1,860 calories, so beside a 1,750 goal every meal plan read \"over by 110\" for reasons that had nothing to do with the food.",
      "Fixed a rounding mismatch that would have made the meal plan tell you your macros still did not add up straight after you had made them add up.",
    ],
  },

  {
    version: "1.296.0",
    date: "2026-08-12",
    changes: [
      "The meal plan card shows how today is actually going, not just what the plan asks for. Its three macro bars were drawn completely full no matter what the number beside them said — they looked like progress and were not. They now fill with what you have eaten, and mark anything you have gone past.",
    ],
  },

  {
    version: "1.295.0",
    date: "2026-08-12",
    changes: [
      "A meal plan can now add food to one of your own meals instead of just shrinking it. Putting a saved meal into a slot only ever resized what was already in it, so a protein ice cream — milk and whey, no carbohydrate source at all \u2014 could never reach a carb target however it was portioned. It now asks for something that belongs with the meal: in testing it added frozen banana to the ice cream and landed on target exactly.",
      "It only keeps the addition if it genuinely helps. A token ingredient that improves the fit by a fraction is thrown away, because fewer ingredients is a better meal, and if the suggestion fails the meal keeps the honest gap it had before.",
    ],
  },
  {
    version: "1.294.0",
    date: "2026-08-12",
    changes: [
      "You can tell a plan meal what to change. \"Make it vegetarian\", \"swap the rice for potato\" \u2014 it rewrites that one meal and keeps the rest of it, instead of throwing it away and suggesting something unrelated. Read the ingredients afterwards; an instruction steers the AI, it does not guarantee anything.",
      "Meals can be moved earlier or later. Moving one is not just a relabel \u2014 a meal that ends up next to your training time gets more carbs and a meal that moves away gets fewer, so the whole day is re-split around the new order.",
    ],
  },
  {
    version: "1.293.0",
    date: "2026-08-12",
    changes: [
      "Adding a food while building a meal now works offline, and the food appears everywhere straight away. Adding one by hand, from the food database, or by estimate all went straight to the server and nowhere else \u2014 so it was missing from your Food Library sheet until a cache expired, invisible to the offline search in the same screen, and impossible at all with no signal.",
      "A food-database result whose macros do not add up to its own calorie figure now says so. These entries are filled in field by field by different people, so a yogurt can claim 123 calories beside macros that come to 164 \u2014 the numbers stand as given, but the row no longer looks verified.",
      "A food found by searching the database is no longer recorded as if you had scanned its barcode.",
    ],
  },
  {
    version: "1.292.1",
    date: "2026-08-12",
    changes: [
      "Sleep bed/wake times going forward are now computed with a more accurate clock correction — tested against real recent nights, this moves them a small, consistent amount (a few minutes) rather than the changing-every-sync behaviour some nights showed before. Existing sleep history will be corrected separately.",
    ],
  },
  {
    version: "1.292.0",
    date: "2026-08-12",
    changes: [
      "A saved meal can say how many servings it makes. A batch recipe — protein ice cream that fills two bowls, a tray of overnight oats — was stored as if the whole batch were one meal, so a meal plan put the entire tub in one slot. Set \"Makes 2 servings\" and the card shows one bowl's macros, logging it logs one bowl, and a meal plan takes one bowl.",
      "Every meal you already saved counts as one serving, so nothing you have changes until you say otherwise.",
    ],
  },
  {
    version: "1.291.0",
    date: "2026-08-12",
    changes: [
      "Searching the food database actually returns the food you asked for now. \"Milk\" was coming back with cream cheese, cheddar and processed cheese — the database matches on ingredient lists, and all of those contain milk. Results are also filtered to products sold in Australia, so you get Coles, Woolworths and Chobani instead of French and Moroccan brands you cannot buy.",
      "Ingredient quantities take servings again, not just grams. Each ingredient has a srv/g switch — two scoops of whey, or 137 g of chicken, whichever you actually mean. It shows what one serving weighs so \"1 serving\" is never a mystery.",
      "The food database stopped saying it was not responding so often. We were asking it faster than it allows and it was refusing us; it now gets asked once you stop typing, and a refusal is retried before you are told anything.",
      "Sheet headers put the ✕ alone in the top-right corner, with the buttons on their own full-width row beneath. The ✕ was crowding the New Meal button.",
    ],
  },
  {
    version: "1.290.2",
    date: "2026-08-12",
    changes: [
      "The Oura card on More shows your ring's real battery percentage again. It had been reading \"Not live\" for over a month, because it was still asking Oura's cloud for a number that stopped updating when the ring moved to a direct connection. It now reads the same live value the Health tab does, and only says \"Not live\" when there genuinely is no reading.",
    ],
  },
  {
    version: "1.290.1",
    date: "2026-08-12",
    changes: [
      "Removed the ring-battery icon from the Home header. The ring's battery still shows on the Health tab's Ring Status card, which reads the live value from the ring itself.",
    ],
  },
  {
    version: "1.290.0",
    date: "2026-08-12",
    changes: [
      "Building a saved meal can now search a real food database, not just the foods you had already saved. Searching \"greek yogurt\" used to return whatever four things happened to be in your library; it now returns branded products with their macros. If the database is slow or down it says so instead of showing an empty list.",
      "Anything you search for can also be worked out by the app directly — one tap estimates the macros, saves it to your foods, and adds it to the meal, so nothing is a dead end.",
      "Ingredients in a saved meal are set in grams now, instead of a whole-number multiplier that could only go 1×, 2×, 3×. Each line shows its own protein, carbs and fat, with a running total for the meal.",
      "A saved meal's calories are now a pill you can pick out at a glance, rather than one number in a run-on line.",
      "Fixed the close X sitting on top of the New Meal button at the top of a sheet. Every sheet in the app now keeps that corner clear.",
      "Fixed a serving size like \"1 glass (200 ml)\" being read as one gram, which divided a scanned product's macros by a hundred.",
    ],
  },
  {
    version: "1.289.1",
    date: "2026-08-11",
    changes: [
      "Meals you kept from your own library or typed in are now marked as yours on the review step. They looked identical to the AI's suggestions, so it was easy to hit regenerate and replace your own food by accident.",
      "The meal plan card now lists what each meal is actually made of, and when to eat it, instead of just a name and its macros.",
    ],
  },
  {
    version: "1.289.0",
    date: "2026-08-11",
    changes: [
      "Meals you type into a plan now get their macros looked up, using the same estimate that reads a photo of your food. \"200 g chicken with rice and broccoli\" becomes a real meal the plan keeps exactly and resizes to fit — not just a hint about the kind of food to suggest. If it cannot work out the macros it says so and falls back to steering.",
      "Saved Meals redesigned. Tap a meal to see every ingredient with its weight and its own macros, instead of a name and a bare \"x1\". Each meal shows how its calories split across protein, carbs and fat.",
      "Deleting a saved meal now asks first. The bin was a small icon between two other small icons and deleted on the first tap.",
      "Select several saved meals at once to delete them together.",
    ],
  },
  {
    version: "1.288.0",
    date: "2026-08-11",
    changes: [
      "You can edit a saved meal plan now. Manage plan → Edit meals lets you swap, reroll or rename any single meal without rebuilding the whole plan. This did not work before because saving a plan threw away what each meal was actually made of — plans now keep their ingredients, so there is something to change.",
      "New setup step: build a plan around meals you already eat. Pick meals from your library and they go in exactly as saved, with the portions resized to fit the day; or just describe what you usually eat and the plan leans that way. At least one slot always stays open for the plan to work with.",
      "Swapping a meal in for a saved one keeps its macros honest — portions are resized to that slot's target, and any gap is shown rather than papered over.",
      "Meal plans remember their suggested meal times, so a saved plan can tell you when to eat rather than just what.",
    ],
  },
  {
    version: "1.287.0",
    date: "2026-08-11",
    changes: [
      "Meal plan portions are now sized to actually hit your macros. The AI picks the food; the gram weights are worked out in code afterwards, so protein and carbs land on target instead of a meal being 200 kcal out in either direction.",
      "A training day and a rest day now get different portions of the same meal — more rice on a training day — rather than one fixed portion that could only ever suit one of them. That is what was making a split plan permanently show \"adjust portions to close the gap\".",
      "New: regenerate a single meal instead of the whole plan. Tap the refresh icon on any meal and only that one is replaced, on both day types, with everything else left alone.",
      "Each meal now shows a bar per macro — calories, protein, carbs, fat — against what it was aiming for, with a running day total above the list, so you can see what swapping a meal does before you accept it.",
      "Manage plan does a lot more: change how many meals you split into, change your training time, or bring an old plan up to your current calorie target. None of those cost an AI call — they re-split the same totals instantly.",
      "Fixed: if your saved macros did not add up to your saved calorie goal, a plan was being built against two numbers that could not both be met, and always looked wrong by the difference. It now fits carbs to the calorie goal and says so.",
    ],
  },
  {
    version: "1.286.0",
    date: "2026-08-11",
    changes: [
      "The volume part of your Activity Score no longer moves its own goalposts. It was scoring you against the median of your own past sessions, so getting stronger raised the bar by exactly as much and the number never budged. It now scores against a fixed per-session target, which means a heavy week finally reads differently from a light one.",
    ],
  },
  {
    version: "1.285.0",
    date: "2026-08-11",
    changes: [
      "The \"move every hour\" part of your Activity Score now measures your waking day. It was counting movement in any hour of the 24, including while you slept, but comparing that against a 15-hour waking goal — so it read 100 every day no matter what you did. It now counts only the hours you are actually up, which means it can finally tell an active day from a sedentary one.",
    ],
  },
  {
    version: "1.284.0",
    date: "2026-08-11",
    changes: [
      "Your Activity Score can tell a big training week from a quiet one again. The strength target was set to 3 sessions a week — a general health floor, not a target for how you actually train — so it read 100 every single day and took the volume target with it. Nearly half the score could not move. It is now 5, and both parts respond. Expect the number to sit lower than it did: an ordinary week should no longer look like your best one.",
    ],
  },
  {
    version: "1.283.0",
    date: "2026-08-11",
    changes: [
      "Meal plans now break each meal into its actual ingredients with weights, the same way scanning a photo of your food does. Saving a meal to your library saves those ingredients, so you can adjust one of them later instead of getting an all-or-nothing blob.",
      "Fixed: the \"Save to my meals\" switch on a new plan looked like it worked and did nothing at all.",
      "Each meal now shows what its ingredients actually add up to next to what it was aiming for, and flags the ones that miss by a lot rather than quietly pretending they match.",
      "New Manage plan sheet: rename a plan, switch it off without deleting it, or delete it. Tapping Manage used to start building a whole new plan instead.",
    ],
  },
  {
    version: "1.282.0",
    date: "2026-08-11",
    changes: [
      "New Meal Plan on the Nutrition tab. Tell it where you shop, anything you avoid, how many meals you want and when you usually train, and it builds a day of eating around the calorie target you already have — with carbs weighted toward the meals either side of training. Save it, edit it, and it shows as a card with the day's totals.",
      "You can give it a training-day and a rest-day version, with slightly fewer carbs on rest days and protein held the same.",
      "Anything you avoid is now a searchable list rather than something you type. Searching works on everyday words too — \"milk\" finds dairy, \"shellfish\" finds crustacean — and you can mark something as an allergy rather than just a preference. It is saved against you, not against one plan, so a new plan never forgets it.",
      "Before you save a plan you see every meal's ingredients next to anything you have marked as an allergy. Plans are written by AI, so read them — the app does not claim to have checked.",
      "About a month after building a plan, Nutrition asks whether it still fits, and tells you if your measured maintenance has moved since.",
      "Saved meals gained search, a count, and full macros per meal instead of just protein.",
      "Your meal plan works offline — it is stored on the device with the meal names and macros, not just references to them.",
    ],
  },
  {
    version: "1.281.0",
    date: "2026-08-11",
    changes: [
      "AI Coach can draw charts now. Ask to see your weight over time, or your volume by muscle, and you get the picture instead of a paragraph of numbers. Before this it had no way to draw one at all — and worse, it would sometimes answer a chart request with a colour-coded list that was meant to be the chart's legend, with no chart above it.",
    ],
  },
  {
    version: "1.280.0",
    date: "2026-08-11",
    changes: [
      "New Energy Balance card on Nutrition, Health and (optionally) Home: a five-band bar from well-under to well-over, showing calories eaten against calories burned and how that compares to what your goal actually asks for. Eating at maintenance while trying to lose now reads as over-eating rather than as a win, and an over-aggressive deficit reads red instead of looking like success.",
      "The app now measures your real maintenance calories from your own food logs against your weight trend, instead of using a textbook formula. It needs about two weeks of logging to calibrate and tells you how many days are left until then, rather than showing you a made-up number in the meantime. Once calibrated it shows a confidence level and keeps adjusting as you log.",
      "Your calorie target is one number again. The Nutrition tab and the Health tab had drifted 200 kcal apart because two different places stored it and only one of them was being updated.",
      "The Energy Budget card on Health had never actually appeared for anyone — it was registered on one tab and built on another, so it always rendered as nothing. It works now.",
      "The Calorie Nudge on Nutrition now suggests a target based on your measured maintenance rather than nudging your existing number up and down, so it no longer disagrees with the Energy Balance card sitting above it.",
      "You can add Energy Balance to Home from More > Home widgets, and hide, reorder or recolour it like any other card.",
    ],
  },
  {
    version: "1.279.2",
    date: "2026-08-11",
    changes: [
      "Your Activity Score no longer marks you down for not doing cardio on a lifting day. Zone-2 minutes need a sustained raised heart rate, which lifting with rest between sets rarely produces — so a training day scored a flat zero on that measure, at full weight, for a reason that had nothing to do with effort. On a day you lift and record no zone minutes, that measure now steps aside instead. Rest days are unchanged: a zero there still counts.",
    ],
  },
  {
    version: "1.279.1",
    date: "2026-08-11",
    changes: [
      "Taking a deload week from the home screen now actually lightens your sessions. Confirming one set the banner and suppressed PRs, but the prescribed weights and sets came out identical to a normal week — so for up to seven days you trained at full intensity believing you had backed off. The pre-workout Deload button was already doing this correctly; both now go through the same reduction.",
    ],
  },
  {
    version: "1.279.0",
    date: "2026-08-10",
    changes: [
      "AI Coach pickers are now instant. When it shows you a list — your sessions, your exercises, replacements for one — it no longer writes that list out itself; the app reads it straight from your data. A question that took nine or ten seconds a day ago now answers in about one, and the list is guaranteed to match what is actually in your program.",
      "Typing a message while AI Coach has a list open no longer breaks the conversation. It used to wedge permanently — every following message came back as \"Something went wrong\", and asking again could not fix it. Changing your mind mid-list is now just a normal thing to do.",
    ],
  },
  {
    version: "1.278.0",
    date: "2026-08-10",
    changes: [
      "Fixed a meal type you could never delete. If you logged food against a meal type and then deleted that log, the meal type refused to go — pointing at an entry you could no longer see, with no way to clear it. Meal types with logs you can still see are unchanged: they stay protected.",
    ],
  },
  {
    version: "1.277.3",
    date: "2026-08-10",
    changes: [
      "Signing out now clears the device properly. Two of the three sign-out buttons left everything behind, and even the one that worked was missing seven tables — your heart-rate samples, sleep rollups and running prescriptions stayed on the phone. Nobody could see them while you were the only account on the device, but they should never have been there.",
    ],
  },
  {
    version: "1.277.2",
    date: "2026-08-10",
    changes: [
      "Two small controls are easier to hit: the camera button on your profile photo, and the Deload badge on an exercise in the pre-workout list. The badge is very slightly taller; the camera button looks the same and just has more room around it.",
    ],
  },
  {
    version: "1.277.1",
    date: "2026-08-09",
    changes: [
      "AI Coach is about three times faster. A question that took nine or ten seconds to come back now takes under three. Nothing about its answers changed — it was spending most of that time thinking to itself before replying.",
      "The ring battery moved off the date line and into the icon row at the top right of Home, as an icon only — the percentage is still there if you long-press or use a screen reader. The date line was too crowded.",
    ],
  },
  {
    version: "1.277.0",
    date: "2026-08-09",
    changes: [
      "The \"Fatigue detected\" card now tells you why. Tap \"Why this recommendation?\" and it shows the two numbers that raised it — your readiness score and your training load against your four-week average — along with the thresholds each one crossed, and what taking the deload week actually does.",
    ],
  },
  {
    version: "1.276.4",
    date: "2026-08-09",
    changes: [
      "The little dots under the session, guided-walk and run-type carousels are easier to hit. They were 7 px wide with nothing around them; they now carry a proper touch area and sit slightly further apart, while looking the same size.",
    ],
  },
  {
    version: "1.276.3",
    date: "2026-08-09",
    changes: [
      "Deleting something no longer has it reappear for a minute. A layer of browser caching sat underneath the app's own and could not be cleared by it, so on some screens a removed row came back on the next refresh and looked like a sync delay.",
    ],
  },
  {
    version: "1.276.2",
    date: "2026-08-09",
    changes: [
      "Every icon-only button in the app now tells a screen reader what it does — back arrows, the send button, the profile photo picker and a dozen more announced as just \"button\" before. The sign-in fields and both chat boxes gained proper labels too, so their name no longer disappears the moment you start typing.",
    ],
  },
  {
    version: "1.276.1",
    date: "2026-08-09",
    changes: [
      "The heart-rate chart, zone breakdown and HR-coloured route line in an activity's detail sheet now actually appear. They had never rendered for any activity — the request behind them was rejected before it reached the server, and the screen showed the same empty state it shows when there genuinely is no data.",
      "Re-opening an activity, or the AI Coach history, now shows what you saw last time straight away instead of a blank panel while it reloads.",
    ],
  },
  {
    version: "1.276.0",
    date: "2026-08-09",
    changes: [
      "Ask AI Coach to swap in an exercise the app has never heard of — a Jefferson curl, say — and it can now add it and make the swap in one confirmation. The card shows what it will record the new exercise as training, because those muscles are what drive your deload and recovery, so you can check them before anything is written.",
      "Undoing an exercise swap now puts back the link to the original exercise, not just its name. Before, an undone swap left the row displaying the old name while still pointing at the replacement underneath.",
    ],
  },
  {
    version: "1.275.3",
    date: "2026-08-09",
    changes: [
      "Small grey text on grey chips is a shade darker in light theme, so it now meets the accessibility contrast minimum. The step is deliberately tiny and should look the same to you.",
    ],
  },
  {
    version: "1.275.2",
    date: "2026-08-09",
    changes: [
      "Logging an activity now rejects impossible numbers instead of storing them. A mistyped duration could previously save a single walk lasting weeks, and every weekly total quietly absorbed it.",
    ],
  },
  {
    version: "1.275.1",
    date: "2026-08-09",
    changes: [
      "The home header now shows your day and greets you by your own clock. If your profile timezone was not Brisbane it could show tomorrow's date and say \"Good morning\" in the evening, and the week strip and streak card bucketed days the same wrong way.",
    ],
  },
  {
    version: "1.275.0",
    date: "2026-08-09",
    changes: [
      "Swapping an exercise with AI Coach now finishes. Pick the exercise, and it shows you a list of replacements that train the same muscles and avoid anything you have flagged as injured — instead of asking what you want in text and leaving you with nothing to tap.",
      "Coach no longer prints the names of its own internal lookups at the end of an answer.",
      "Saving a readiness check-in now refreshes the session it affects, so a check-in with nothing sore clears a deload recommendation instead of leaving yesterday's on screen.",
    ],
  },
  {
    version: "1.274.1",
    date: "2026-08-09",
    changes: [
      "Body Battery now starts the day on your readiness score straight away. It used to open on your sleep score and quietly re-anchor to a different number once you visited the Health screen, so the two Home cards disagreed for the first part of the morning.",
    ],
  },
  {
    version: "1.274.0",
    date: "2026-08-09",
    changes: [
      "Tell AI Coach you are beaten up and it can start your deload week there and then, or call one off that has already started. It shows you how early it is — how far into the cycle you are — and warns you that anything logged today stops counting toward the block. Undoable, and it puts the sessions back.",
      "A long question above a Coach picker now wraps to two lines instead of being cut off mid-sentence.",
    ],
  },
  {
    version: "1.273.0",
    date: "2026-08-09",
    changes: [
      "AI Coach can now change your periodisation — cycle length, phase model, phase mode. Because this one can move you backwards through a block you have already earned, it does not confirm in the chat: it opens its own screen showing exactly what you would lose, and the button has to be held rather than tapped.",
      "Ask for a change without saying how much (\"bump my calories a bit\") and Coach gives you a dial to set it on, with the difference from your current value shown.",
      "Ask Coach for something it deliberately does not do — building a whole new program, logging a run — and it points you at the screen that does, instead of apologising.",
      "Comparisons of a handful of things now come back as a chart with the options underneath doubling as its legend; longer lists skip the chart, which was unreadable at phone width.",
    ],
  },
  {
    version: "1.272.0",
    date: "2026-08-09",
    changes: [
      "AI Coach can now change more than your program: calorie and macro targets, and your steps and water goals. Same confirmation as before — you see the before and after, and nothing is written until you tap Apply.",
      "Tell Coach about an injury in plain words (\"my left shoulder is bothering me\") and it logs it. Your next session weighs it when deciding load, exactly as it does for an injury you enter yourself — Coach records it and lets the app do the rest.",
      "Say you're recovered and it clears the injury.",
      "A change that has drifted since Coach suggested it is now refused rather than applied over the top — if you changed a goal elsewhere in the meantime, Coach asks again instead of overwriting you.",
    ],
  },
  {
    version: "1.271.0",
    date: "2026-08-09",
    changes: [
      "AI Coach replaces the old AI chat. It opens as its own screen and can now show you things to tap — your sessions, your exercises — instead of asking you to type names back at it.",
      "It can change your program. Ask it to swap an exercise and it shows you exactly what would change, what that costs you (which muscles you stop training, which record stops progressing), and nothing is written until you tap Apply. Every change can be undone until your next workout.",
      "Coach remembers. A history view lists every change you've made and your recent conversations.",
      "Nutrition and training questions are now checked against the web rather than answered from memory, with links to where the numbers came from.",
      "Fixed every on/off switch in the app rendering as a black circle instead of a toggle — including the ones in the goal-recommendation sheet.",
    ],
  },
  {
    version: "1.270.32",
    date: "2026-08-09",
    changes: [
      "Fixed the \"Today's Timeline\" home widget showing yesterday's bed/wake times until you restarted the app after a ring sync finished — it now catches up live, the same fix already shipped for the Sleep and Health screens.",
    ],
  },
  {
    version: "1.270.31",
    date: "2026-08-08",
    changes: [
      "The app no longer talks to the server before you have signed in. Opening it to the login screen used to fire 22 requests that were all rejected, including one that kicked off an Oura sync — wasted time and battery on the slowest moment of a cold start.",
    ],
  },
  {
    version: "1.270.30",
    date: "2026-08-08",
    changes: [
      "Your ring's battery level now shows on the Home header. The chip existed but was reading the Oura Cloud value, which has been frozen since the ring was re-keyed — so it never appeared at all.",
    ],
  },
  {
    version: "1.270.29",
    date: "2026-08-08",
    changes: [
      "Dates and times across the app now render in the timezone set in your profile, not the one your phone happens to be in. Previously nothing on screen could read your setting, so anything showing a specific moment drifted when you travelled.",
    ],
  },
  {
    version: "1.270.28",
    date: "2026-08-08",
    changes: [
      "The Deload choice has moved off Home onto the pre-workout screen, beside the session-length picker — you now pick it while looking at the session it applies to, and can change your mind without backing out.",
    ],
  },
  {
    version: "1.270.27",
    date: "2026-08-08",
    changes: [
      "A completed session now carries a COMPLETED stamp across its muscle diagram instead of a banner above it, and the Front/Back labels are gone — the silhouettes already say which is which.",
      "Fixed brand-coloured tints across More, Profile, the set cards and the workout builder rendering as the wrong colour (a green tint came out salmon). It was only visible in the light theme.",
    ],
  },
  {
    version: "1.270.26",
    date: "2026-08-08",
    changes: [
      "The \"rest was adequate\" marker on a set now means your heart rate actually came down, and shows nothing when the ring did not sample enough to tell. It used to pass any set whose sampled heart rate was under 120 — which, with a ring, was every set ever recorded.",
    ],
  },
  {
    version: "1.270.25",
    date: "2026-08-08",
    changes: [
      "Steps are now placed at the time you actually took them. When the ring caught up on buffered history, up to half an hour of walking was being squeezed into a couple of minutes — which is how a single minute came to show 1,555 steps. Daily totals were roughly right; the timeline was not.",
      "A physically impossible step window is now discarded rather than added to your day.",
    ],
  },
  {
    version: "1.270.24",
    date: "2026-08-08",
    changes: [
      "Your Year Review no longer reports your most-trained lift as dropping to zero when the last time you trained it was a deload week.",
    ],
  },
  {
    version: "1.270.23",
    date: "2026-08-08",
    changes: [
      "The \"name this activity\" sheet no longer appears by itself when a Guided Walk finishes. Auto-detection now throws away a detection that was already running when you started a walk, activity or workout, instead of letting it finish and ask you to name it.",
    ],
  },
  {
    version: "1.270.22",
    date: "2026-08-08",
    changes: [
      "The date labels under the strength-trend chart no longer show a day earlier than the session they belong to when your device is set to a timezone behind UTC.",
    ],
  },
  {
    version: "1.270.21",
    date: "2026-08-08",
    changes: [
      "The \"we detected a walk/run — save it?\" sheet now saves to the phone first and syncs after, so it works offline and the activity appears immediately instead of waiting for the server.",
      "Detected activities are now filed under the correct calendar day, and their start/end times recorded as your wall time rather than the phone's clock — previously a device set to another timezone stored the wrong day and time permanently.",
    ],
  },
  {
    version: "1.270.20",
    date: "2026-08-08",
    changes: [
      "Buttons now meet the 48dp minimum tap size on mobile, up from 44px — including the tappable cards that were not covered before.",
      "The admin and ring-debug consoles now use a proper confirmation dialog instead of the browser's grey pop-up, so a destructive action states exactly what it will do.",
      "Replaced the last few emoji used as interface icons with real icons, and gave the leaderboard's \"closing in on you\" marker a label.",
    ],
  },
  {
    version: "1.270.19",
    date: "2026-08-08",
    changes: [
      "Fixed several places that were invisible in the light theme: the rings around your Home scores, the locked achievement tiles, the 60/70/80 markers on the Estimated 1RM bars, and the Sets/1RM toggle.",
      "Readiness bars, session scores and the alternative-session list now name their band (High / Moderate / Low) instead of only colouring the number.",
    ],
  },
  {
    version: "1.270.18",
    date: "2026-08-08",
    changes: [
      "Your calendar and streak now count a workout on the day you actually trained, using your own timezone. Previously an evening session could land on the next day for anyone outside Brisbane.",
    ],
  },
  {
    version: "1.270.17",
    date: "2026-08-08",
    changes: [
      "Expandable sections in Settings, Config, Goals and the workout builder now tell screen readers whether they are open or closed.",
      "The day arrows on the Nutrition screen are now labelled, instead of being announced as an unnamed button.",
    ],
  },
  {
    version: "1.270.16",
    date: "2026-08-08",
    changes: [
      "In light theme, the per-screen wallpaper no longer flashes its dark version for a moment when you open Health, Nutrition, More, Stats, Overview, workout selection or the session explainer.",
    ],
  },
  {
    version: "1.270.15",
    date: "2026-08-08",
    changes: [
      "The same database-error detail now gets recorded for failures in the many routes that don't catch their own errors — previously those reached you as a bare error with nothing logged at all.",
    ],
  },
  {
    version: "1.270.14",
    date: "2026-08-08",
    changes: [
      "A newly added exercise now shows up straight away in Config, workout selection, Stats and the injury-swap picker, instead of taking up to an hour to appear.",
      "Your heart-rate profile, health trends, muscle tonnage, profile details and the cardio/running stats pages also refresh promptly after a change rather than serving a cached copy for several minutes.",
    ],
  },
  {
    version: "1.270.13",
    date: "2026-08-08",
    changes: [
      "Finishing a run or walk now refreshes your all-time bests, run-type splits, walk segments and cardio trends straight away instead of leaving them on yesterday's numbers for six hours.",
      "Confirming a weigh-in from the scale now updates the weight card, progress card and the nutrition calorie header immediately.",
      "Sleep streak achievements refresh when new sleep data arrives, instead of waiting for some unrelated change to clear the cache.",
      "The \"+XP earned\" badge on the finished-workout screen no longer occasionally shows your entire lifetime XP as this session's gain.",
    ],
  },
  {
    version: "1.270.12",
    date: "2026-08-08",
    changes: [
      "Weekly Muscle Sets no longer shows the same muscle twice — abs work logged under the exercise library's \"core\" label used to appear as its own untargeted row while \"Abs\" sat next to it at 0 and coloured red. The muscle diagram above the list had always folded them together, so the two disagreed.",
      "The weekly volume and muscle tonnage trends fold the same synonyms, so one muscle is one row and one line.",
    ],
  },
  {
    version: "1.270.11",
    date: "2026-08-08",
    changes: [
      "Light theme's green is now actually applied — the light-mode colour had been written but never wired up, so brand-green text and icons rendered in the dark-theme green and were hard to read on white.",
      "Text on green buttons and badges now switches between black and white based on whichever is readable against your chosen accent colour, instead of always being white. Blue, cyan and gold in particular had near-invisible button labels.",
    ],
  },
  {
    version: "1.270.10",
    date: "2026-08-08",
    changes: [
      "Server errors now record the actual database error behind them, so the intermittent sync failures can be diagnosed from the logs instead of guessed at.",
    ],
  },
  {
    version: "1.270.9",
    date: "2026-08-08",
    changes: [
      "Dates are now validated everywhere they enter the app, so a malformed one returns a clear error instead of a blank 500 — and a phone whose sync cursor got corrupted is told what is wrong instead of retrying forever.",
      "Dates shown next to your exercises and recommendations no longer read a day early on a phone set to a timezone behind UTC.",
    ],
  },
  {
    version: "1.270.8",
    date: "2026-08-08",
    changes: [
      "Workouts and food items restored onto a new phone now come back complete — the sync was quietly dropping which program session a workout belonged to, whether it was a deload, and a food item's barcode.",
    ],
  },
  {
    version: "1.270.7",
    date: "2026-08-08",
    changes: [
      "A supplement renamed, added or switched off while offline no longer reverts when your phone next syncs, and a supplement deleted on one device now disappears on the others.",
    ],
  },
  {
    version: "1.270.6",
    date: "2026-08-08",
    changes: [
      "Closed a hole where a program could be pointed at another account's training blocks — their phase names and cycle structure could then show up on your workout screen, and their program name could surface in an error when you deleted your own phase set.",
    ],
  },
  {
    version: "1.270.5",
    date: "2026-08-08",
    changes: [
      "A workout finished offline now gets its per-set heart-rate breakdown once it syncs, the same as one finished online — before, that half of the recap was only ever filled in by a manual backfill.",
    ],
  },
  {
    version: "1.270.4",
    date: "2026-08-08",
    changes: [
      "Finishing a workout now pulls its heart-rate data in one pass on the server instead of the server calling itself over the network — a call that had been failing silently, leaving that workout's recap with no heart-rate breakdown until a manual backfill.",
    ],
  },
  {
    version: "1.270.3",
    date: "2026-08-08",
    changes: [
      "The \"session N of this phase\" count on your workout screen now recomputes from your real training history each time it is shown, so it can no longer sit on a stale number after a re-sync or a deleted session.",
    ],
  },
  {
    version: "1.270.2",
    date: "2026-08-08",
    changes: [
      "Fixed the workout card looking cramped — the recovery percentages had stopped scrolling and were pushing the body diagram up into the session name. They scroll again on a single line.",
    ],
  },
  {
    version: "1.270.1",
    date: "2026-08-08",
    changes: [
      "Removed the redundant \"Interval walk\" shortcut from the Log Activity sheet — Guided Walk already has its own entry point on the Cardio Hub screen.",
    ],
  },
  {
    version: "1.270.0",
    date: "2026-08-08",
    changes: [
      "Tapping a day on the training calendar now opens a full day screen you can swipe between days on — with that night's sleep and hypnogram, your whole body composition, the day's scores, and heart rate across the day. It used to be a small sheet with your workout and three numbers.",
    ],
  },
  {
    version: "1.269.2",
    date: "2026-08-07",
    changes: [
      "The recovery percentages on the workout card no longer scroll past — they sit still and wrap onto a second line, so every muscle is readable at a glance instead of being half cut off at the edges.",
    ],
  },
  {
    version: "1.269.1",
    date: "2026-08-07",
    changes: [
      "Increased bottom clearance on the Pause/Finish, End Test, and End Walk buttons during a tracked activity, fitness test, or guided walk, so they no longer sit flush against the gesture bar.",
    ],
  },
  {
    version: "1.269.0",
    date: "2026-08-07",
    changes: [
      "The workout screen's \"Other Activity\" row is now a \"Cardio Hub\" card — it matches the workout card above it and names what it leads to (Run, Walk, Log anything) instead of just being a grey bar.",
    ],
  },
  {
    version: "1.268.0",
    date: "2026-08-07",
    changes: [
      "Added fourteen new looks for the four home score cards (Readiness / Heart Rate / Sleep / Activity) — Bare, Watermark, Overlap, Squircle, Frosted, Pill row, Rail, Duotone rail, Footnote, No label, Accent rule, Divider, Band and Underline. Pick one under More → Home widgets → Score Card Style.",
    ],
  },
  {
    version: "1.267.19",
    date: "2026-08-07",
    changes: [
      "Fixed two cases where the pre-workout screen could keep showing an outdated plan for up to 6 hours: confirming an early deload from Home, and logging a new injury.",
    ],
  },
  {
    version: "1.267.18",
    date: "2026-08-07",
    changes: [
      "Fixed a bug where Home could briefly flash yesterday's date on load, most noticeable overnight — the header now always agrees with your device's calendar day.",
    ],
  },
  {
    version: "1.267.17",
    date: "2026-08-07",
    changes: [
      "Fixed the Body Battery card's \"How it moves\" panel always saying it opens at Readiness, even on mornings it actually opened at last night's Sleep score.",
    ],
  },
  {
    version: "1.267.16",
    date: "2026-08-07",
    changes: [
      "The \"Body temp elevated\" recommendation now shows the real numbers behind it — your actual temperature deviation, the alert threshold, and how many nights of baseline it's based on — instead of just a qualitative sentence.",
    ],
  },
  {
    version: "1.267.15",
    date: "2026-08-07",
    changes: [
      "Fixed the home \"Recommended Today\" card sometimes getting stuck showing \"Last: —\" for a well-established session instead of the real last-trained day.",
    ],
  },
  {
    version: "1.267.14",
    date: "2026-08-07",
    changes: [
      "Fixed the Body Battery chart's right-edge time label always saying \"now\" even when the underlying data was actually stale — it now shows the real time of the last reading.",
    ],
  },
  {
    version: "1.267.13",
    date: "2026-08-07",
    changes: [
      "Fixed manually choosing \"Deload\" on Home before an AI-driven session — it now actually reduces the prescribed weight/reps/rest instead of showing the same numbers as a full session.",
    ],
  },
  {
    version: "1.267.12",
    date: "2026-08-07",
    changes: [
      "The sore-muscle check-in now warns you when marking several sore muscles will lighten your entire session, not just the affected exercises.",
    ],
  },
  {
    version: "1.267.11",
    date: "2026-08-07",
    changes: [
      "Morning Check-in: Recovery and Sleep quality no longer start pre-filled with a guess derived from your Readiness/Sleep score — they open neutral until you actually answer. \"Motivation to train\" is replaced with a quick \"Anything going on?\" flag (feeling sick / alcohol / travel or poor sleep) that now also feeds the app's illness-aware training adjustments.",
    ],
  },
  {
    version: "1.267.10",
    date: "2026-08-07",
    changes: [
      "The Running screen's run-type carousel now has a themed icon and colour per type, and the separate Skip button is gone — swiping to a different run type is the pick.",
    ],
  },
  {
    version: "1.267.9",
    date: "2026-08-07",
    changes: [
      "Fixed deloaded sets inflating your estimated 1RM and personal records — a light deload set no longer gets scored as a genuine max-effort lift, whether it's one exercise or a whole deloaded session. Also corrected four personal records that had already been inflated by this bug.",
    ],
  },
  {
    version: "1.267.8",
    date: "2026-08-07",
    changes: [
      "Tapping a \"Woke up\" or \"Fell asleep\" card in Today's Timeline now opens that night's sleep detail directly, instead of doing nothing.",
    ],
  },
  {
    version: "1.267.7",
    date: "2026-08-06",
    changes: [
      "Fixed a bug where picking a different run type after skipping today's run could silently revert back to skipped on the APK.",
    ],
  },
  {
    version: "1.267.6",
    date: "2026-08-06",
    changes: [
      "Guided Walk's preset picker is now Long / Short / Custom — Custom remembers your own sets/fast/slow setup, and editing the steppers away from Long or Short now correctly shows Custom selected instead of silently claiming the wrong preset is active.",
    ],
  },
  {
    version: "1.267.5",
    date: "2026-08-06",
    changes: [
      "On days with no dedicated workout logged, the Cardiovascular screen now shows a \"Zone 1 minutes moved today\" credit — separate from the training quota, which still excludes Zone 1 as before.",
    ],
  },
  {
    version: "1.267.3",
    date: "2026-08-06",
    changes: [
      "The header refresh button on the pre-workout screen now stays visibly busy for as long as an AI prescription is actually regenerating, instead of flashing done while the real update is still in progress underneath it.",
    ],
  },
  {
    version: "1.267.2",
    date: "2026-08-06",
    changes: [
      "The exercise-summary/rest screen now shows the next exercise and its planned starting weight, so you can start thinking about it during the rest countdown.",
    ],
  },
  {
    version: "1.267.1",
    date: "2026-08-06",
    changes: [
      "The Sleep screen now has more to explore: a toggle between 14-day sleep-stage, bedtime, and wake-time trends, plus a skin temperature chart.",
    ],
  },
  {
    version: "1.267.0",
    date: "2026-08-06",
    changes: [
      "Sleep Score now applies an awake-time fragmentation cap: a night with an unusually high amount of time spent awake, compared to your own recent pattern, is capped lower even if duration, HRV and heart rate all looked normal. A clean night is unaffected and can still reach a perfect score — this only ever lowers a score, never raises one, and only once there's enough sleep history to know what's normal for you.",
    ],
  },
  {
    version: "1.266.11",
    date: "2026-08-06",
    changes: [
      "Fixed the sleep hypnogram sometimes appearing to be missing after a ring sync or redecode — the screen now picks up the new data right away instead of needing you to leave and come back.",
    ],
  },
  {
    version: "1.266.10",
    date: "2026-08-06",
    changes: [
      "The home screen's \"Heart Rate · Today\" chart line is smoother, and can now show a clearly-marked dashed estimate across short gaps in coverage.",
    ],
  },
  {
    version: "1.266.9",
    date: "2026-08-06",
    changes: [
      "You can now tap a meal card on the \"Today's Timeline\" (home and health screens) to jump straight to that day's food log.",
    ],
  },
  {
    version: "1.266.8",
    date: "2026-08-05",
    changes: [
      "The Workout tab's \"already trained today\" indication is now a clear, full-width \"Completed Today\" banner instead of a small icon and text you could easily miss.",
    ],
  },
  {
    version: "1.266.7",
    date: "2026-08-05",
    changes: [
      "Fixed the Workout tab's session card not showing \"trained today\" right after you finished a workout — it needed a tab switch or app reopen to catch up. It now updates the moment you're back.",
    ],
  },
  {
    version: "1.266.6",
    date: "2026-08-05",
    changes: [
      "Fixed automatic activity detection sometimes logging a second, overlapping walk/run while you were already in a Guided Walk or a manually-started activity. It already knew to stay quiet during a lifting workout — now it applies the same logic there too.",
    ],
  },
  {
    version: "1.266.5",
    date: "2026-08-05",
    changes: [
      "A Guided Walk now shows as \"Guided Walk\" on your home timeline instead of the generic \"Outdoor walking\" — the ring/strap segment data was already there, it just wasn't being shown.",
    ],
  },
  {
    version: "1.266.4",
    date: "2026-08-05",
    changes: [
      "Fixed the Body tab's \"Burned\" and \"Balance\" cards reading 0/no data on days with a real logged workout or walk. Both now use the same calorie-burned calculation that was already correct elsewhere in the app — including your strength workouts and walks/runs, not just Health Connect data.",
      "The home screen's nutrition ring and the nutrition tab's \"+N from cardio\" label pick up the same fix.",
    ],
  },
  {
    version: "1.266.3",
    date: "2026-08-05",
    changes: [
      "Fixed a visible scrollbar on the cardio page's right edge, plus the same issue on the year-in-review, stats, nutrition, more, session-select and health screens.",
    ],
  },
  {
    version: "1.266.2",
    date: "2026-08-05",
    changes: [
      "Fixed sleep times looking pushed back from your actual bedtime. The sleep list, its detail view, and the Body-tab sleep card were showing your bedtime with sleep-onset time already subtracted, instead of when you actually went to bed — matching a hint from the Hypnogram and home timeline, which already showed it correctly.",
      "Time to fall asleep is still shown, just next to the time range instead of hidden inside it.",
    ],
  },
  {
    version: "1.266.1",
    date: "2026-08-05",
    changes: [
      "Per-set and per-workout heart rate now get attributed as soon as a workout is completed, not only when you happen to open its recap. A session you never revisit used to keep zero heart-rate detail forever, even though the data existed.",
      "When your ring/strap data lands later than the workout itself, the session stays queued for the existing backfill instead of being marked done with nothing in it — so a later pass can still fill it in properly.",
    ],
  },
  {
    version: "1.266.0",
    date: "2026-08-05",
    changes: [
      "Picking a shorter session no longer costs you a disproportionate slice of it to warmup. Once the app has learned how long your warmups actually take, it was subtracting that whole figure from whatever budget you chose — so a 30-minute session handed over 9 of its minutes (30%) while a 60-minute one handed over the same 9 (15%), and the shorter session got trimmed harder to make up the difference.",
      "On the reported Push session that meant a 30-minute pick had 21 working minutes and lost three exercises. It now has 24 and loses one fewer.",
      "Your learned warmup is still used as-is for your session's normal length, and for the longer pick — it only gets capped when you have deliberately shortened the session below what it is set to.",
    ],
  },
  {
    version: "1.265.0",
    date: "2026-08-05",
    changes: [
      "Guided-walk summaries now show cadence, and show it first. The fast/slow average cards, the per-interval breakdown and the fast/slow history card all led with pace, which over a single 1–3 minute block is a small and noisy GPS sample. Step rate is the direct read on how hard you were working, so it takes the headline and pace sits beside it.",
      "Nothing new is being recorded — cadence was already measured per interval and saved with every walk, it just never made it onto the summary screen.",
      "A walk with no chest strap connected has no cadence to show and reads exactly as it did before: pace leads, nothing is blanked out.",
    ],
  },
  {
    version: "1.264.0",
    date: "2026-08-05",
    changes: [
      "New admin panel: Body Battery vs how recovered you said you felt. It sits under Day Review next to the Sleep Score one and works the same way — each day's end-of-day battery against that morning's recovery rating, how closely the two agree, and the days they disagree most about. Across your data they track each other properly, so this is here to notice if that ever stops being true after a model change.",
      "Internal only: the two calibration panels now share one engine and one card instead of two copies. The Sleep Score panel looks and behaves exactly as before.",
      "Both panels take their rating labels straight from the check-in screen now, so rewording a scale can't leave a panel describing your days with the old words.",
    ],
  },
  {
    version: "1.263.0",
    date: "2026-08-05",
    changes: [
      "New \"HRV vs volume\" trend on the Health screen. On days your overnight HRV came in above your own median you moved about 33% more weight — 5,799 kg against 4,376 kg. The existing \"Recovery vs strength\" view scores HRV against how heavy your lifts were relative to your best; this one scores it against how much total work you did, which is where your body actually seems to respond.",
      "It is shown as an observation and nothing acts on it. Measured across 30 days it is a real pattern, but not yet strong enough to trust as a rule — it needs about 60 days before anything should adjust your training on the strength of it.",
    ],
  },
  {
    version: "1.262.0",
    date: "2026-08-05",
    changes: [
      "New \"Bedtime vs sleep\" trend on the Health screen. Measured against your own last three months, this is the strongest relationship in everything the app records: every hour later you go to bed costs about 0.70 hours of sleep, and your wake time does not make it back. Before 22:00 you average 8.15 h; after 23:00, 6.92 h.",
      "The trend bars stopped putting a \"+\" in front of numbers that aren't changes. Hours slept, sleep efficiency and a 1–5 recovery rating are readings, not deltas — only the three views that genuinely compare against a baseline are signed now.",
    ],
  },
  {
    version: "1.261.0",
    date: "2026-08-05",
    changes: [
      "Everything that analyses your sleep now counts nights rather than rows. The ring stores one row per sleep window, so a ten-minute doze in front of the TV is stored exactly like a night — and on six of your 54 recorded dates that doze is what got used. 4 July was read as 0.1 hours of sleep instead of 8.2. That fed the sleep-vs-lifting chart, the last-meal-vs-sleep chart, the sleep figures on your progress card, your bedtime estimate, and everything the AI coach says about how you slept.",
      "The reverse case is fixed too: the night of 29 May was recorded as two rows either side of a wake-up, and was being read as a 4-hour night. It is one 6.5-hour night, and now counts as one.",
      "The under-slept signal that feeds your session recommendations had the same gap — a nap could pull it down by a third on its own, and a sleep row with no duration recorded was being counted as zero hours rather than ignored. Both fixed.",
      "Two nights still read short and cannot be recovered: 1 June and 4 June were only partly recorded, and 2–3 June have no sleep data at all.",
    ],
  },
  {
    version: "1.260.1",
    date: "2026-08-05",
    changes: [
      "Internal only, no visible change: the automated checks that run before anything ships were failing at random on a handful of heavy tests. They were not broken — they were just slower than the time limit allowed, so any busy moment tipped them over. That meant a red result had to be double-checked by hand every time, and it wasted a whole session once. Those tests now get a time limit matched to what they actually take.",
    ],
  },
  {
    version: "1.260.0",
    date: "2026-08-05",
    changes: [
      "Each set's heart rate now records which device measured it — chest strap, ring, or both. The column has existed since the feature shipped and was never filled in, across all 582 sets, so there was no way to tell strap-measured sets from ring-measured ones. That is the first thing worth knowing when a set's heart rate looks wrong, since the two differ under load.",
    ],
  },
  {
    version: "1.259.2",
    date: "2026-08-05",
    changes: [
      "Internal only, no visible change: the read-only view I use to audit your production data was filtering one table on the wrong column, so it reported that table as empty when it holds 573 rows. Nothing in the app was affected — but an audit run through it could reach the wrong conclusion, and one did. Fixed, with a test.",
    ],
  },
  {
    version: "1.259.1",
    date: "2026-08-05",
    changes: [
      "Two ring features that have never produced anything should start working. A database query was checking a column that nothing has ever filled in — so it always came back empty, and both things reading it quietly gave up. That is why your daytime-HRV model was never built (a Body Battery input) and why the device-metrics admin screen showed no days despite the ring uploading all day.",
    ],
  },
  {
    version: "1.259.0",
    date: "2026-08-05",
    changes: [
      "The ring and chest-strap \"Connected\" notifications are now quiet like the scale's — no status-bar icon, tucked at the bottom of the shade. Android needs some notification while they are running, so they cannot go away entirely.",
      "You now get told when either one is actually low. Below 35% the ring or strap posts a proper notification once — not on every reading, and not again until it has genuinely recovered or been charged. The ring checks every five minutes, so without that it would have nagged you 288 times a day.",
    ],
  },
  {
    version: "1.258.2",
    date: "2026-08-05",
    changes: [
      "Your health trend insights are now checked before they are shown. They were never tested — the app compared the best and worst group and wrote a confident sentence whenever they differed at all. Five of these were checked against your real data and every one fell apart: three were just both numbers drifting over the calendar together, and one pointed the wrong way. Insights now need enough days behind them, a result unlikely to be chance, and one that survives removing the calendar trend — and they tell you how many days they are based on. Expect several views to go quiet; that is the honest answer, and when one is withheld it now says why instead of \"no meaningful difference\".",
    ],
  },
  {
    version: "1.258.1",
    date: "2026-08-05",
    changes: [
      "Exercise demo GIFs and photos show again. The app's own security policy did not list the host they are served from, so the browser blocked every one — you only saw the exercises that happened to have a second copy stored on our own server.",
    ],
  },
  {
    version: "1.258.0",
    date: "2026-08-05",
    changes: [
      "Voice set-logging now works in the app. It never has: microphone permission was missing from the Android manifest, so the request failed before any prompt could appear and the button switched itself off the moment you pressed it — and even with permission, the app's embedded browser has no speech recognition of its own. It now uses Android's own recogniser. Say \"eighty kilos five reps\" and the dial and rep counter follow. If it cannot hear you or you deny the microphone, it says so instead of going quiet. Needs the new APK.",
    ],
  },
  {
    version: "1.257.3",
    date: "2026-08-05",
    changes: [
      "The scale's ongoing \"Connected — listening for weigh-ins\" notification no longer takes a status-bar icon or a normal spot in the shade. Android requires some notification while the service is running, so it cannot be removed outright, but it now sits collapsed at the bottom and out of the way. \"Weigh-in logged\" and the other one-off alerts are untouched — those are the ones worth telling you about. Needs the new APK.",
    ],
  },
  {
    version: "1.257.2",
    date: "2026-08-05",
    changes: [
      "Every workout's heart-rate summary — average, peak, best 1-minute recovery and rest-window HRV — has been failing to save since the feature shipped, so that table was empty for all 66 of your completed workouts. The rest-window HRV is a decimal and the column only accepts whole numbers, which made the database reject the entire row; the failure was logged where nobody could see it, and the workout screen looked normal either way. Fixed, and there is now a button under Admin → Tools to fill in the history.",
    ],
  },
  {
    version: "1.257.1",
    date: "2026-08-05",
    changes: [
      "The floating picture-in-picture window now keeps counting your rest after the last set of an exercise. It used to switch to a static \"Done — tap Next\" card at exactly that point, so backgrounding the app during that rest lost the countdown — the one moment the little window is most useful.",
    ],
  },
  {
    version: "1.257.0",
    date: "2026-08-05",
    changes: [
      "The More tab now refreshes when you come back to it. Every tab stays loaded in the background for speed, and More was the one that never re-fetched — so your profile, stats, season badges, friends feed, ring battery and sync status stayed as they were when the app started. Restarting the app was the only way to update them.",
      "The heart-rate strap now reconnects on its own. Both the app and the background service stop trying after a few minutes if the strap is unreachable, which is right while it is off your chest — but nothing ever started trying again, so putting the strap on after opening the app did nothing until a restart. It now retries while the app is open, when you switch back to it, and when a workout starts.",
      "Pairing a strap now connects it straight away instead of waiting for the next app start.",
    ],
  },
  {
    version: "1.256.4",
    date: "2026-08-04",
    changes: [
      "Fixed a timing hole where changing a workout's length at the same moment the app was generating its plan could leave the plan and its \"already applied\" marker describing two different things. The two are now written together, so they cannot disagree.",
    ],
  },
  {
    version: "1.256.3",
    date: "2026-08-04",
    changes: [
      "The last 21 places that could fail server-side without leaving a trace now record what went wrong. Routine things — a name you have already used, a calendar permission you have not granted — are deliberately still not recorded as faults, so real problems do not get buried in noise.",
    ],
  },
  {
    version: "1.256.2",
    date: "2026-08-04",
    changes: [
      "When something goes wrong on the server, it now gets recorded instead of vanishing. 80 of the app's screens and data endpoints previously failed with no trace at all, which is why a couple of recent faults could not be diagnosed. Nothing changes on any screen — it just means the next problem can actually be found.",
    ],
  },
  {
    version: "1.256.1",
    date: "2026-08-04",
    changes: [
      "When the app can't work out whether a newer version exists to install, it now records why instead of just going quiet — so a missing setting can be told apart from GitHub being briefly unreachable. Visible in the admin data-capture panel.",
    ],
  },
  {
    version: "1.256.0",
    date: "2026-08-04",
    changes: [
      "The “Update available” banner in More now only appears when there is genuinely a new app to install. It was comparing your installed app against the website's version, but almost every update reaches your phone through the web without reinstalling anything — so it was telling you to reinstall for changes you already had, on every single release. It now compares against the newest app file that was actually built, and it can finally tell you when you are up to date instead of just showing nothing.",
    ],
  },
  {
    version: "1.255.1",
    date: "2026-08-04",
    changes: [
      "Fixed a bug that could file your ring's step counts on days that had not happened yet — five days worth landed in the future once, then quietly corrected themselves as those dates arrived. Step readings are now placed using the closest available clock reading from the ring rather than the most recent one, and anything that still lands in the future is set aside and re-read on the next sync instead of being saved to the wrong day.",
    ],
  },
  {
    version: "1.255.0",
    date: "2026-08-04",
    changes: [
      "Navigation speed is now measured on the phone instead of guessed at. Every tap that changes screen records how long the new screen took to arrive, and whether it had been pre-loaded first. The numbers show up in the admin data-capture panel as one more row you can copy out — nothing to turn on, and nothing changes on any normal screen.",
    ],
  },
  {
    version: "1.254.1",
    date: "2026-08-04",
    changes: [
      "Four screens now load the page you are about to open before you tap it, so moving between them should feel quicker: finishing a workout back to session select, finishing an activity back to workout select, and the cardio exits from workout select and the running plan. Tapping a session other than the recommended one is still not pre-loaded — that one is a bigger change and is queued separately.",
    ],
  },
  {
    version: "1.254.0",
    date: "2026-08-04",
    changes: [
      "The guided interval walk now has a Treadmill mode. It skips GPS entirely rather than recording indoor noise, so an indoor walk no longer drags your pace and distance stats around — it saves with no distance or pace at all. Your fast and slow heart-rate stats still count it.",
    ],
  },
  {
    version: "1.253.3",
    date: "2026-08-04",
    changes: [
      "The skip button during a workout now asks before throwing away a set you are part-way through. It only asked in solo mode — in a normal program workout one tap jumped straight to the next exercise and took the in-progress set and rest timer with it. It still does not ask when there is nothing to lose.",
    ],
  },
  {
    version: "1.253.2",
    date: "2026-08-04",
    changes: [
      "Your weight trend now takes the lowest scale reading of the day rather than the first. If the first weigh-in happened to be with clothes on, it used to be locked in for the whole day with no way to correct it short of editing the weight by hand. A later, lighter reading now replaces it. On a normal day the fasted morning weigh-in is already the lowest, so nothing changes.",
    ],
  },
  {
    version: "1.253.1",
    date: "2026-08-04",
    changes: [
      "Body Battery is now stricter about when it admits it does not have enough heart-rate data. The first morning on the new model recorded 30 readings in four hours and the battery moved three points — a flat line that looked like a calm day rather than an unmeasured one — and it still passed as trustworthy. The threshold has been raised so days like that say \"Limited data\".",
    ],
  },
  {
    version: "1.253.0",
    date: "2026-08-04",
    changes: [
      "Body Battery now uses the highest heart rate you have actually reached rather than an age formula. The formula assumed 190 when your real peak over three months is 168, and because effort is measured against that ceiling, everything you did read as easier than it was — the battery barely drained. Over the last 36 days it ended above 80 on half of them and sat pinned at 100 on 14. It now ends around 50 on a typical day.",
      "Body Battery recharges at half the old rate while you rest. The old rate could refill the entire tank in about four hours of sitting still, which is why it was so often full.",
      "Body Battery now tells you when your ring did not record enough heart rate to trust the day's line. The ring stops sampling when you are still, and on roughly one day in five that produced a nearly flat line that looked like a genuinely calm day. Those days now say \"Limited data\" instead of presenting a number as measured.",
    ],
  },
  {
    version: "1.252.9",
    date: "2026-08-04",
    changes: [
      "Fixed a serious sync fault: body measurements — weight, steps, macros, water, heart rate and HRV — could not be saved to your phone or pulled down from the server. Two database statements were left short of the columns they were writing when body-composition fields were added for the scale, so every one of those writes failed on the device.",
    ],
  },
  {
    version: "1.252.8",
    date: "2026-08-03",
    changes: [
      "Fixed: a phone call or other mid-night wake-up could make a night's recorded bedtime jump hours later than it really was, discarding the real sleep you got beforehand. That earlier sleep is now kept, with the interruption counted as awake time instead.",
    ],
  },
  {
    version: "1.252.7",
    date: "2026-08-03",
    changes: [
      "Fixed: the \"Update available\" banner in More was stuck on permanently, even right after installing the newest app. The app's build number had been frozen at an old value, so it always looked out of date. Takes effect once you install the next APK.",
    ],
  },
  {
    version: "1.252.6",
    date: "2026-08-03",
    changes: [
      "Fixed: after your training phase moved, the prescription card and the session list could keep showing the old phase for up to a minute. Both now refresh straight away.",
    ],
  },
  {
    version: "1.252.5",
    date: "2026-08-03",
    changes: [
      "Fixed: the workout preview sheet showed a kilogram target for bodyweight exercises — a number with no relation to anything you have lifted. It now shows a rep target, matching the rest of the app.",
    ],
  },
  {
    version: "1.252.4",
    date: "2026-08-03",
    changes: [
      "Fixed: the Year in Review could name a bodyweight movement as your biggest lift of the year, and show it in kilograms — a pull-up outranked a real bench press because bodyweight strength is measured in reps, not weight. Bodyweight records now read as a rep max, and the headline PR is picked from lifts that carry actual weight.",
      "Fixed: the deload explanation showed a kilogram target for bodyweight exercises, which was a number you never lifted.",
    ],
  },
  {
    version: "1.252.3",
    date: "2026-08-03",
    changes: [
      "Admin → Tools → Additional tools has a new check that says whether the app's neural models are being served from cloud storage or from the code repo.",
    ],
  },
  {
    version: "1.252.2",
    date: "2026-08-03",
    changes: [
      "A workout that hasn't uploaded yet now counts towards your streak and shows on the home week strip straight away, instead of waiting for the next sync.",
    ],
  },
  {
    version: "1.252.1",
    date: "2026-08-03",
    changes: [
      "Fixed: sleep, activity and scale times were shown in your phone's timezone rather than your own, so they would read hours off if the phone's zone ever differed — while travelling, for instance.",
    ],
  },
  {
    version: "1.252.0",
    date: "2026-08-03",
    changes: [
      "Auto-apply now actually moves you between training phases. It only ever set a flag before, so four of five session types had been sitting in accumulation since late June against prescriptions already written for intensification loads.",
      "When a phase moves automatically, the prescription card explains why — the signals that earned it, the thresholds they were measured against, and what the load change is for.",
      "Deloads still ask before applying. A forced transition (one a session cap broke a tie on, rather than your lifts earning it) also still asks.",
    ],
  },
  {
    version: "1.251.2",
    date: "2026-08-02",
    changes: [
      "The first tap on Health, Workout, Nutrition or More is quicker — the app now loads those screens' code quietly in the background once the home screen has settled, instead of waiting until you tap.",
    ],
  },
  {
    version: "1.251.1",
    date: "2026-08-02",
    changes: [
      "Sleep staging now expects REM to come back round roughly every 95 minutes, the way sleep cycles actually run, instead of assuming it simply builds up as the night goes on.",
    ],
  },
  {
    version: "1.251.0",
    date: "2026-08-02",
    changes: [
      "Sleep staging now also reads how much your blood-oxygen wobbles within each five minutes — irregular breathing in REM shows up there, and it is the first staging signal that does not come from your heartbeat.",
    ],
  },
  {
    version: "1.250.12",
    date: "2026-08-02",
    changes: [
      "The app no longer names the ring's vendor in everyday screens — heart rate, readiness and check-ins now just describe the data. Connecting the ring still names it, because that is what you are connecting to.",
      "Fixed: the morning check-in labelled the app's own readiness score as the ring's.",
    ],
  },
  {
    version: "1.250.11",
    date: "2026-08-02",
    changes: [
      "The training calendar now shows workouts and activities saved on your phone straight away, instead of waiting for them to reach the server.",
    ],
  },
  {
    version: "1.250.10",
    date: "2026-08-02",
    changes: [
      "A guided walk that measured no cadence no longer saves an empty cadence record, which made the activity look like it had cadence data when it had none.",
    ],
  },
  {
    version: "1.250.9",
    date: "2026-08-02",
    changes: [
      "Readiness breakdown: a factor that is still learning your baseline now shows how much it counts (%) instead of a number that looked like a score — a user with no resting-HR data saw \"Resting heart rate 88\". Those factors also sort last instead of mixing in among real scores.",
    ],
  },
  {
    version: "1.250.8",
    date: "2026-08-02",
    changes: [
      "Fixed: a recorded bed period with no actual sleep in it could be treated as last night, which dropped your real night's sleep out of the readiness score.",
    ],
  },
  {
    version: "1.250.7",
    date: "2026-08-02",
    changes: [
      "Fixed: if a second person wearing an Oura ring used the app, their sleep could silently fail to save because it collided with another user's night.",
    ],
  },
  {
    version: "1.250.6",
    date: "2026-08-02",
    changes: [
      "Ring data maintenance no longer rewrites rows it isn't changing, which was quietly growing the database's indexes on every pass.",
    ],
  },
  {
    version: "1.250.5",
    date: "2026-08-02",
    changes: [
      "Admin: the Oura BLE page now shows the on-device raw store's row counts, disk use and low-disk flag — the numbers the operations runbook asks for.",
    ],
  },
  {
    version: "1.250.4",
    date: "2026-08-02",
    changes: [
      "Runs and walks now save your heart rate on the activity, not just treadmill sessions.",
      "Fixed: an activity that recorded no distance could fail to save its heart rate and calories too.",
    ],
  },
  {
    version: "1.250.3",
    date: "2026-08-02",
    changes: [
      "Fixed: the heart-rate strap card said \"Connecting…\" forever, even long after the app had stopped trying. It now tells you whether the strap is connecting, retrying or not connected, and there's a Connect button to retry without restarting the app.",
    ],
  },
  {
    version: "1.250.2",
    date: "2026-08-02",
    changes: [
      "Fixed: Body Battery could jump part-way through the morning as it re-anchored from last night's sleep to today's readiness, shifting the whole day's curve. It now settles once and stays put, and says \"provisional\" while it's still on the early-morning fallback.",
    ],
  },
  {
    version: "1.250.1",
    date: "2026-08-02",
    changes: [
      "Fixed: accepting a phase change emptied your AI prescription card with no way to get it back. The card now shows \"Preparing your AI workout…\" and a fresh prescription for the new phase arrives on its own.",
    ],
  },
  {
    version: "1.250.0",
    date: "2026-08-02",
    changes: [
      "Readiness now works without a ring. If the app only has your phone's health data it computes a score from what it does have, labelled so you can see it's built on part of the usual picture, instead of showing nothing at all.",
      "Your readiness history and the wake-up entry on your day timeline fill in from that score too, so those screens are no longer blank without a ring.",
      "Sleep from Health Connect now merges with ring data night by night instead of whichever arrived first winning, and it keeps the sleep-stage graph when your phone provides one.",
    ],
  },
  {
    version: "1.249.6",
    date: "2026-08-02",
    changes: [
      "Fixed: the on-device database failed part of its startup check every time the app opened, which made syncing slower and less reliable than it should be.",
      "Sync messages now tell you when something actually failed versus when the app is just waiting before its next retry.",
    ],
  },
  {
    version: "1.249.5",
    date: "2026-08-02",
    changes: [
      "Fixed: a guided walk could fail to sync and never reach your training calendar. Any walk stuck this way will send once you pull to sync — tap Retry on the sync-health card if it shows one.",
    ],
  },
  {
    version: "1.249.4",
    date: "2026-08-01",
    changes: [
      "Fixed: the scale's \"weighing you…\" toast could pop up just from switching to the Home tab, with nobody on the scale.",
    ],
  },
  {
    version: "1.249.3",
    date: "2026-08-01",
    changes: [
      "The scale now asks for any weigh-ins it may have saved on its own if a connection attempt was too slow to catch one live, instead of that reading being lost.",
    ],
  },
  {
    version: "1.249.2",
    date: "2026-08-01",
    changes: [
      "Fixed: the \"weighing you…\" scale toast could still get stuck on screen in one more case — a background reconnect right after a successful weigh-in.",
    ],
  },
  {
    version: "1.249.1",
    date: "2026-08-01",
    changes: [
      "The scale now stays connected while you're on the Home screen, like the heart-rate strap, so a weigh-in registers faster and is less likely to be missed.",
      "Fixed: a weigh-in could occasionally be logged twice, and the \"weighing you…\" toast could get stuck on screen after a reading was already captured.",
      "Fixed: the scale could occasionally try to connect to a nearby unrelated Bluetooth device instead of your paired scale.",
      "Fixed: a stale progress bar could show underneath the scale's success/failure toast.",
    ],
  },
  {
    version: "1.249.0",
    date: "2026-07-31",
    changes: [
      "The heart stats card's +/- comparison is now a compact colored number right next to each stat instead of a separate line of text.",
      "The Running screen now shows a \"By run type\" card with your average pace, distance, and heart rate for each run type you've completed (tempo, easy, long, etc.) — covers runs started from the Running screen's picker.",
      "Interval walk now shows a \"Your fast / slow blocks\" card with your average pace, distance, and heart rate for fast and slow blocks across your past interval walks.",
    ],
  },
  {
    version: "1.248.0",
    date: "2026-07-31",
    changes: [
      "Fixed: right after opening the Running screen, the run-type carousel could show a different run type than the recommendation card below it — they now always match.",
      "Fixed: the active run screen's timer sat under the status bar and the Pause/Finish buttons sat too close to the bottom edge — both now have proper clearance.",
      "The heart stats card on the Cardiovascular home screen now covers the last 30 days (was 7) and shows how your resting, average, and max heart rate compare to the previous 30 days.",
      "Interval walk now lets you swipe between the Standard and Quick presets in a carousel, matching the Running screen's picker, instead of two stacked buttons.",
    ],
  },
  {
    version: "1.247.0",
    date: "2026-07-30",
    changes: [
      "Fixed: an AI-recommended phase change (e.g. moving up to Intensification) could silently mark itself \"Dismissed\" after sitting unanswered for a week, with no prompt or notice — it now always waits for you to Move or Skip it yourself, no matter how long it sits.",
      "The next AI workout plan is now generated right before you start that session instead of right after you finish the previous one, so it's never more than a few minutes stale.",
      "The AI Periodization card on Health → Training now shows how many days since you last trained each session instead of an Auto/Ready status dot.",
    ],
  },
  {
    version: "1.246.9",
    date: "2026-07-30",
    changes: [
      "The scale now detects a weigh-in starting faster, giving it a better chance of catching the reading before you step off.",
      "Experimental: the app now also tries to recover any recent weigh-ins the scale saved on its own if a connection was missed — this is unverified and may not do anything yet depending on what the scale actually supports.",
    ],
  },
  {
    version: "1.246.8",
    date: "2026-07-30",
    changes: [
      "You'll now get a notification if a scale weigh-in couldn't be captured after a few tries, instead of it failing silently — tap it as a reminder to step back on the scale.",
      "The scale now tries one more time before giving up on a weigh-in, and the retry notification tells you to stay on the scale rather than just saying \"Retrying…\".",
    ],
  },
  {
    version: "1.246.7",
    date: "2026-07-30",
    changes: [
      "Fixed: a scale weigh-in could still go unread even with the previous stalled-connection fix in place, if the scale's own handshake response arrived but no real reading followed it — the app now keeps watching for a stall after that handshake instead of only checking once at the start.",
    ],
  },
  {
    version: "1.246.6",
    date: "2026-07-30",
    changes: [
      "Fixed: the very first scale weigh-in of a session could go unread even while standing on the scale the whole time — the app now detects a stalled connection and retries automatically instead of waiting out the full timeout.",
    ],
  },
  {
    version: "1.246.5",
    date: "2026-07-30",
    changes: [
      "AI-adaptive programs now show \"Phase · Session N\" instead of a meaningless \"Cycle 1/1\" on the pre-workout screen, workout header, session picker, and recommendation card — those programs don't have a fixed cycle count, so the old label never actually meant anything.",
      "The AI prescription card on the pre-workout screen no longer pops in and shifts the exercise list a couple seconds after opening — it now shows instantly from your last-known plan while it quietly checks for anything new.",
    ],
  },
  {
    version: "1.246.4",
    date: "2026-07-30",
    changes: [
      "The heart-rate strap card now shows a live connection status — Not connected (it only connects during workouts), Connecting, Connected · on your chest, or Connected without chest contact — so a paired strap never reads as permanently connected.",
    ],
  },
  {
    version: "1.246.2",
    date: "2026-07-30",
    changes: [
      "Deactivating an account now takes effect within a day of that person continuing to use the app, instead of waiting up to a week for their login to be reissued. This happens quietly in the background — nobody gets signed out or asked to log in again because of it.",
    ],
  },
  {
    version: "1.246.1",
    date: "2026-07-30",
    changes: [
      "Fixed: skipping today's run hid the run-type carousel entirely, leaving only a \"Back to Cardio\" dead end — swiping to a different run type or adjusting the duration now works after a skip too, same as before skipping.",
      "Fixed: the \"Recommended\" badge and reason text on the run-type carousel were clipped off — the card is now tall enough to show them fully.",
    ],
  },
  {
    version: "1.246.0",
    date: "2026-07-30",
    changes: [
      "The run-type picker on the Running screen is now a swipeable carousel, like choosing a workout session — and it highlights whichever run type would do the most to close your biggest open heart-rate-zone gap for the week (e.g. suggesting an interval session when you still owe Zone 4/5 time).",
      "Fixed: reloading the Running screen shortly after changing your run type or duration could still show your old choice for up to a minute before catching up.",
    ],
  },
  {
    version: "1.245.0",
    date: "2026-07-30",
    changes: [
      "Skipping today's prescribed run now offers a real alternative instead of just leaving — pick a different run type (recovery, easy, long, tempo, interval) or adjust the duration ±10 minutes, and the app re-prescribes it with the same safety checks as its own suggestions.",
      "Setting up a running plan now always asks for your default session length, not just when choosing a fixed-time plan.",
      "The Cardiovascular hub's \"How much time do you have?\" button is now hidden once you have a running plan — the Running screen's own duration picker covers that.",
      "Fixed: choosing a different run type or duration could silently revert back to the original suggestion if you reloaded the page before starting.",
    ],
  },
  {
    version: "1.244.0",
    date: "2026-07-30",
    changes: [
      "Your Running screen now shows a \"Your bests\" card — best 1K, best 5K, best average pace, and longest run — pulled from your run history.",
      "The Cardiovascular hub's zone-minutes card now has a Today / This week toggle, matching the one Steps already had.",
      "Skipping today's run no longer leaves you stuck on a dead-end screen — there's now a button back to the Cardiovascular hub.",
      "Leaving a run or other tracked activity mid-recording (hardware back button or switching tabs) now asks you to confirm before discarding it, the same protection guided walks and workouts already had.",
    ],
  },
  {
    version: "1.243.2",
    date: "2026-07-30",
    changes: [
      "New: background scale sync now shows a \"X.X kg logged\" notification after a normal weigh-in, instead of no confirmation at all once the syncing notification disappeared.",
      "Fixed: a genuine second weigh-in taken within about 2 minutes of the first could get silently missed while background sync was still cooling down after the scale's own post-use settling period. That cooldown is now much shorter.",
    ],
  },
  {
    version: "1.243.1",
    date: "2026-07-29",
    changes: [
      "A guided walk's current phase (fast, slow, warm up, cool down) and its countdown now show in the Android status-bar pill while the app is backgrounded — same live pill your runs already get, so you can check where you're up to without opening the app.",
    ],
  },
  {
    version: "1.243.0",
    date: "2026-07-30",
    changes: [
      "Nightly body temperature is now measured properly. The ring reports several temperature probes at the same instant, and all of them were being fed to the nightly calculation as if they were readings taken one after another — so a night's worth of readings looked like four times as many, spread across the same timestamps. It also mixed in a second sensor stream whose values land on a half-degree grid, which is why 19 of the last 21 nights came out as exact whole numbers. Nightly temperature now uses the sleep sensor alone, one reading per moment.",
      "Because of that, the temperature part of your Readiness score and the illness signal had almost no ability to tell nights apart. Both should now respond to real changes. Past nights are recalculated as your ring data re-syncs.",
    ],
  },
  {
    version: "1.242.4",
    date: "2026-07-30",
    changes: [
      "Fixed: background scale sync could still fire a \"weigh-in detected\" notification every few minutes with nobody near the scale, even after the previous fix. Android's Bluetooth scan was occasionally re-delivering an old, no-longer-current sighting of the scale instead of a fresh one — it's now checked against its own timestamp and discarded if it isn't genuinely recent.",
    ],
  },
  {
    version: "1.242.3",
    date: "2026-07-30",
    changes: [
      "Fixed: signing in for the first time on a fresh app install could not complete. The sign-in page the app opens was itself behind the login check, so it bounced to the normal sign-in screen and lost the code that ties the browser back to the app — leaving the app waiting for a hand-back that never came. Signing in again on an install that had already worked was unaffected, which is why this went unnoticed.",
    ],
  },
  {
    version: "1.242.2",
    date: "2026-07-30",
    changes: [
      "Fixed: an abandoned run/walk/other-activity session could show a wildly inflated elapsed time (an old bug — one report showed over 25,000 minutes for a half-kilometre route). Reopening the app after killing it mid-activity now abandons a session that's been sitting for more than 12 hours instead of resuming its timer from wherever it was left.",
      "Fixed: three exercise names that were merged into their canonical version a couple of sessions ago (Cable Lat Pulldown, Straight Arm Pulldown, Cable Crunch) were still selectable when building or editing a program, which would have quietly split your history again. They no longer appear as options.",
      "Food logs opened offline now group correctly under their meal type (Breakfast, Lunch, etc.) even if you haven't opened the app in a while — previously the meal-type names could go stale offline once the on-device cache expired.",
    ],
  },
  {
    version: "1.242.1",
    date: "2026-07-30",
    changes: [
      "Starting a workout, opening a run or guided walk, and finishing a walk now load their next screen in the background beforehand, so tapping doesn't wait on the network. The home health cards already did this; these are the remaining places that didn't.",
    ],
  },
  {
    version: "1.242.0",
    date: "2026-07-30",
    changes: [
      "Fixed: background scale sync could get stuck retrying for many minutes if the scale woke up without being weighed (some scales briefly re-advertise from any nearby vibration). It now backs off for a couple of minutes after giving up, instead of restarting the whole retry cycle every time the scale stirs.",
      "New: a Body Composition card in Health > Body shows everything your scale measures beyond weight and body fat — skeletal muscle %, fat-free mass, muscle mass, bone mass, body water %, subcutaneous fat %, visceral fat index, protein %, BMR, and metabolic age — with a trend line, once you've weighed in with the scale.",
    ],
  },
  {
    version: "1.241.2",
    date: "2026-07-29",
    changes: [
      "The back arrow on the Readiness, Heart Rate, Sleep and Activity screens now works. It was visible and in the right place, but an invisible layer sat on top of it and swallowed every tap, so the Android back button was the only way out.",
      "Opening one of those screens directly — from a notification, or when the app restores onto it — and pressing back used to leave the app instead of returning to it. It now goes to the home screen.",
    ],
  },
  {
    version: "1.241.1",
    date: "2026-07-29",
    changes: [
      "Opening a screen no longer pauses before it moves. The animation was waiting on a fixed timer that had to expire before anything happened — so every screen froze for the same beat whether its content was ready or not, and usually it was ready long before. It now moves as soon as the screen is actually there.",
      "The four health cards on the home screen now load their detail page in the background before you tap, so opening one doesn't wait on the network.",
      "Screens no longer briefly overlap while one replaces the other, which made dense pages look smeared mid-animation.",
    ],
  },
  {
    version: "1.241.0",
    date: "2026-07-29",
    changes: [
      "Opening a screen now rises into place instead of sliding in from the side, and closing it drops back down — the Android convention, where sideways motion means \"another page at the same level\" and vertical means \"deeper in\". The travel is much shorter too, so a screen that takes a moment to fill in has far less distance over which that can show.",
      "Closing a screen used to cut instantly even though opening it animated. Every back button now mirrors the way its screen opened.",
      "Switching between the five main tabs now fades and settles into place rather than just cross-dissolving.",
    ],
  },
  {
    version: "1.240.4",
    date: "2026-07-29",
    changes: [
      "The app was writing a debug log for every single message passed between the web layer and the phone — including converting every database result to text just to print it, whether or not anything was watching. That was roughly a sixth of all the work the app's main thread was doing. It's now off.",
    ],
  },
  {
    version: "1.240.3",
    date: "2026-07-29",
    changes: [
      "The five main tabs all stay loaded so switching between them keeps your place — but the four you weren't looking at were still running their loading shimmers, spinners and meteors the whole time. They now pause the moment a tab goes off screen and resume when you come back to it.",
    ],
  },
  {
    version: "1.240.2",
    date: "2026-07-29",
    changes: [
      "The animated wallpaper was quietly costing the app a third of its speed. The stars were drawn in a way the phone couldn't hand off to its graphics chip, so it re-did that work every frame — on every screen, for as long as the app was open. The background looks the same; it just no longer competes with everything you tap. It also stops entirely while the app is in the background.",
    ],
  },
  {
    version: "1.240.1",
    date: "2026-07-29",
    changes: [
      "Opening a screen no longer pauses on the old one before sliding. The slide was waiting for the new screen to finish loading before it would start, so a slow screen looked frozen — it now moves straight away and the content fills in behind it.",
      "Switching between the five main tabs now crossfades instead of cutting.",
      "Reading your workout history from the phone's own database was doing one query per session and then one per exercise — over a hundred for three months of training, on the home screen, Health, and mid-workout. It's now three queries no matter how much history you have.",
    ],
  },
  {
    version: "1.240.0",
    date: "2026-07-29",
    changes: [
      "The guided walk's summary screen now shows a route map (colored by heart-rate zone, same as your other activities) and a \"fast average\" / \"slow average\" pace-and-heart-rate breakdown. Every fast and slow block is now saved with its own pace, heart rate, and distance — the same detail your lifts get per set — so future walks can be compared and averaged against each other.",
    ],
  },
  {
    version: "1.239.1",
    date: "2026-07-29",
    changes: [
      "The Health screen no longer loads all three of its tabs when it can only show you one. It was fetching Body, Training and Progress data every time it opened, then displaying a third of it. Each tab's data is now loaded when you actually switch to it, which cut the screen's requests by around a fifth.",
    ],
  },
  {
    version: "1.239.0",
    date: "2026-07-29",
    changes: [
      "Opening a screen from a card or button — a workout, a sleep or readiness detail, an activity — now slides in from the right and slides back out when you leave, instead of the new screen replacing the old one instantly. Switching between the five main tabs stays instant, which is how a native tab bar behaves.",
    ],
  },
  {
    version: "1.238.0",
    date: "2026-07-29",
    changes: [
      "Scale background sync no longer keeps a permanent \"Watching for scale…\" notification up — it now wakes only when you actually step on the scale, connects, syncs, and clears itself within a few seconds.",
    ],
  },
  {
    version: "1.237.0",
    date: "2026-07-29",
    changes: [
      "New: weigh in on the scale as many times a day as you like — your morning reading sets the trend line on your weight chart (the fasted, consistent number), and any later readings that day (e.g. an evening weigh-in) are recorded alongside it in Settings > Scale instead of overwriting it.",
    ],
  },
  {
    version: "1.236.0",
    date: "2026-07-29",
    changes: [
      "Fixed: weighing in with socks on (or any time the scale can't get a clean skin-contact reading) no longer produces a nonsense body-fat/water/muscle reading — your weight still saves, and body composition is skipped with a notification explaining why instead of silently writing a wrong number.",
    ],
  },
  {
    version: "1.235.0",
    date: "2026-07-29",
    changes: [
      "Exercise Readiness has been reworked. Sore muscles now show a body map beside the pills, and any muscle still recovering from recent training is marked sore for you \u2014 \"sore\" now means \"not recovered\". It uses the recovery curve rather than a flat clock, so a hard leg day still counts at 47 hours while a light one doesn't. Anything that feels fine, tap to remove.",
      "New Time Constraints section: Quick, Normal or Long, set to your session's own length give or take 30 minutes. Picking one rebuilds today's plan against that budget \u2014 a quick session drops the work you're already ahead on for the week rather than trimming everything to token sets. The same choice shows on the pre-workout screen, so both stay in step.",
      "Issues is now just the things that are actually issues: Heavy Legs and Low Motivation are gone, since one is muscle soreness and the other is an energy level, and both already have their own section. Sick/Unwell now does something \u2014 it recommends a rest day, and deloads the session if you train anyway.",
    ],
  },
  {
    version: "1.234.6",
    date: "2026-07-29",
    changes: [
      "Food items saved while offline are now checked against the same limits as ones saved online. They previously weren't checked at all — a non-numeric value silently became 0, and an impossible calorie count was stored as-is.",
    ],
  },
  {
    version: "1.234.5",
    date: "2026-07-29",
    changes: [
      "Fixed the HR-zone route coloring showing a single flat color for the whole route on logs without detailed pace data, instead of actually varying by effort — a date-parsing edge case was silently shifting every point's estimated time by hours.",
    ],
  },
  {
    version: "1.234.4",
    date: "2026-07-29",
    changes: [
      "Fixed the app taking a very long time to open, and sometimes showing an empty screen with no data. A change meant to make it start faster was serving a saved copy of the app that no longer matched the server, which made it reload itself over and over. It now always fetches a matching copy, as it did before.",
    ],
  },
  {
    version: "1.234.3",
    date: "2026-07-29",
    changes: [
      "HR-zone route coloring now also shows up right on the activity completion screen, not just when you look back at it later, and now also covers logs that don't have detailed pace data by assuming a steady effort across the whole route instead of leaving the line flat.",
    ],
  },
  {
    version: "1.234.2",
    date: "2026-07-29",
    changes: [
      "Step counting had three more faults behind the one fixed yesterday, all of which inflated your totals. The biggest: when the app counted steps live it used a raw motion-peak counter that also counts hand movement \u2014 an earlier test of that counter recorded 114 \"steps\" during a minute of cooking with no walking at all. Because that reading takes priority over the ring\u2019s own step model, it replaced the correct figure. Live counts now go through the same walking-rhythm filter used everywhere else. A guided walk on 29 July confirmed the ring\u2019s own model is accurate \u2014 3,716 steps against Samsung Health\u2019s 3,759, a 1.1% difference \u2014 so the live readings were the entire problem. Also fixed: two overlapping readings of the same walk were being added together instead of counted once, and a walk crossing midnight was credited in full to the first day while the second day counted the same minutes again.",
    ],
  },
  {
    version: "1.234.1",
    date: "2026-07-29",
    changes: [
      "Opening the app, and moving to screens outside the five main tabs, no longer waits for the server before anything appears. The app now shows you the last version of the screen straight away and refreshes it behind the scenes, instead of holding a blank screen until a request finishes travelling to Singapore and back.",
      "The app icon is no longer re-downloaded every time you change screen — it was a 26 kB file being fetched twice per screen, and on some screens it was the slowest request on them.",
    ],
  },
  {
    version: "1.234.0",
    date: "2026-07-29",
    changes: [
      "The guided walk's summary screen now shows a heart-rate chart with the fast and slow blocks shaded, so you can see at a glance where the effort actually was instead of just reading a bare number per interval.",
    ],
  },
  {
    version: "1.233.2",
    date: "2026-07-29",
    changes: [
      "The Health screen no longer sits blank for a second before it fills in. It was waiting on a call out to Oura's servers for your ring's battery and firmware — values that haven't changed since the ring was moved onto the direct Bluetooth connection, and that the screen was already ignoring in favour of the live Bluetooth reading. That call has been removed, so the screen now draws as fast as the rest of the app.",
    ],
  },
  {
    version: "1.233.1",
    date: "2026-07-29",
    changes: [
      "The rule keeping your main lift the heaviest movement now also applies to prescriptions that were already written before it shipped. Upper's tricep work was still showing 5 sets at a higher percentage than the incline bench because that plan was generated days earlier — it now corrects itself as soon as you open the session, rather than waiting for the plan to expire.",
    ],
  },
  {
    version: "1.233.0",
    date: "2026-07-29",
    changes: [
      "The guided interval walk now tracks a live map, distance, and pace — and pace, not heart rate, is the headline stat during a fast/slow phase, since heart rate alone doesn't reliably tell fast and slow apart on a walk. Route, splits, and per-phase pace are now saved with the walk, so a fast set and a slow set actually have numbers to compare.",
    ],
  },
  {
    version: "1.232.0",
    date: "2026-07-28",
    changes: [
      "Your main lift is now always the heaviest movement in the session. An isolation exercise could previously be prescribed a higher percentage than the compound it supports \u2014 tricep work outranking your incline bench, for instance \u2014 which is never the right shape for a session.",
      "Set counts now respect each exercise's role, with one deliberate exception: if a muscle is genuinely behind its weekly target, its exercise can still carry extra sets. Lagging muscles get corrected with more volume, never with a heavier bar.",
    ],
  },
  {
    version: "1.231.4",
    date: "2026-07-28",
    changes: [
      "Seven screens now show their contents the instant you open them instead of flashing a spinner first. The home timeline, a day's detail from the week strip, an exercise's history and heart-rate card, the activity picker, and the macro-target and food-logging panes all paint from what they showed you last time, then quietly update. Opening something you've already looked at should now feel immediate.",
    ],
  },
  {
    version: "1.231.3",
    date: "2026-07-28",
    changes: [
      "The route line on the activity map is now colored by heart-rate zone — blue through red — so you can see at a glance where you were pushing harder or easing off, instead of one flat color for the whole route.",
    ],
  },
  {
    version: "1.231.2",
    date: "2026-07-28",
    changes: [
      "The AI that plans your sessions is no longer told a bodyweight record is a weight. Pull-ups were being described to it as \"118 kg\" — an internal number that means nothing for a movement you can't load — which could skew what it prescribes. It now reads them as rep maxes, matching what you already see on screen.",
    ],
  },
  {
    version: "1.231.1",
    date: "2026-07-28",
    changes: [
      "Removed the small map credits line from the bottom of the activity route map, for a cleaner look.",
    ],
  },
  {
    version: "1.231.0",
    date: "2026-07-28",
    changes: [
      "The \"starting weights\" you enter when building a program now actually reach the bar. They never did — the number went into your personal records, which the workout screen doesn't read for working weights, so a lift with no history always opened at a hardcoded 60 kg regardless of what you'd typed.",
      "Your personal records are no longer rewritten when you review a program. Reviewing one used to overwrite them with whatever starting numbers were in the builder, with no check that the new value was actually better. Records now come only from what you've logged.",
      "The \"next workout\" card on the done screen and the session it previews can no longer disagree about a weight — both now work it out the same way.",
    ],
  },
  {
    version: "1.230.4",
    date: "2026-07-28",
    changes: [
      "The activity route map now uses a clearer, more detailed street-map style instead of the muted terrain-style tiles.",
    ],
  },
  {
    version: "1.230.3",
    date: "2026-07-28",
    changes: [
      "Bodyweight exercises now show a rep target instead of a kilogram weight when the app opens offline. The on-device database had no copy of the exercise catalogue, so anything read without a connection was assumed to be a weighted lift — pull-ups would briefly render as kg until the server responded. The catalogue is now mirrored on the phone and kept up to date whenever a workout loads.",
    ],
  },
  {
    version: "1.230.2",
    date: "2026-07-28",
    changes: [
      "Fixed the actual cause of the blank activity route map: the map's own background-caching logic was quietly blocked by a security policy that covered the map image itself but not the background request that fetches it, so every tile request silently failed. Both are now allowed.",
    ],
  },
  {
    version: "1.230.1",
    date: "2026-07-28",
    changes: [
      "Candidate fix for the activity route map still showing a blank grey background for some users even with a confirmed-valid map key and correct network config — the tile layer is now promoted to its own GPU layer to stop it being wiped by the same Samsung WebView compositor quirk documented elsewhere in this app. Not yet confirmed to resolve it on-device.",
    ],
  },
  {
    version: "1.230.0",
    date: "2026-07-28",
    changes: [
      "New: choose how long you've got before you train. A Short / Standard / Long picker on the pre-workout screen rebuilds today's plan around 30, your program's own budget, or 90 minutes \u2014 Standard is unchanged. A short session drops the exercises whose muscles are furthest ahead of their weekly target rather than cutting everything to two token sets, and a long one adds work where you're furthest behind, never past what you can recover from. The choice applies to today only and is never saved to your program.",
      "Fixed: the AI's numbers weren't actually reaching the bar on most sessions. Whenever it suggested moving to a new training phase, the whole prescription was set aside and the session quietly ran your base program instead \u2014 four of five sessions were affected. Its sets, reps and loads now apply straight away; the phase change itself still waits for you to accept it.",
      "Fixed: the AI could suggest \"moving\" to the phase you were already in, which reset your progress through that block every time you accepted it. That can no longer be produced or stored.",
      "Fixed: sessions were being planned shorter than they really take. The estimate skipped one rest period per exercise \u2014 about 7-8 minutes on a five-exercise session \u2014 which is why half of recent workouts ran past their time budget. Estimates now count every rest.",
      "Fixed: logging soreness in your check-in now changes today's workout straight away. Previously the plan could keep showing the pre-check-in numbers for hours, and a check-in logged after you'd opened the app that morning was ignored entirely.",
      "Fixed: an exercise can no longer be prescribed as a single working set.",
      "Fixed: the end-of-workout screen loads instantly on a revisit instead of showing \"Loading...\" on every card while it re-fetches everything at once.",
      "Heart-rate recovery after your sets is now summarised per exercise rather than set by set, and a set where your heart rate rose is no longer shown with a downward arrow and a green tick.",
    ],
  },
  {
    version: "1.229.3",
    date: "2026-07-28",
    changes: [
      "The Oura ring's live heart-rate loop no longer runs during a workout when the chest strap is already connected — it was draining the ring's battery for a reading that was never even shown, since the strap already wins over the ring whenever both are available. The ring now only kicks in to cover gaps where the strap isn't connected, and steps back down automatically once the strap reconnects.",
    ],
  },
  {
    version: "1.229.2",
    date: "2026-07-28",
    changes: [
      "Fixed step counts being badly inflated \u2014 28 July read 4,903 steps when the ring\u2019s own data says 1,578. When the app counts your steps live, it timed the count against the wrong signal: the steps came from the ring\u2019s motion sensor, but the start and end of the walk came from a separate signal that pauses whenever the ring powers its radio down. So a real walk was recorded as having happened in a fraction of the time it actually took \u2014 one on 28 July was logged as 3,605 steps in 13 minutes, and since a live count takes priority over the ring\u2019s own step model for the period it covers, that replaced the real figure. Walks are now timed by the same sensor data the steps are counted from, and any reading faster than the detector can physically produce is discarded. Three days (24, 27 and 28 July) still hold inflated totals from before this fix; correcting them is a separate step.",
    ],
  },
  {
    version: "1.229.1",
    date: "2026-07-28",
    changes: [
      "Your Activity Score is now recorded each day, so it builds a trend. It was being calculated every time you opened the app and then thrown away \u2014 the health trends chart was reading it from the Oura Cloud instead, which has recorded nothing since the ring moved to direct Bluetooth on 7 July. The score has been shown since v1.207.0 with no history behind it at all.",
    ],
  },
  {
    version: "1.229.0",
    date: "2026-07-27",
    changes: [
      "New: pair a Renpho body-composition scale directly over Bluetooth in Profile settings, no more relying on Health Connect for weight and body fat — now also captures skeletal muscle %, bone mass, body water %, protein %, BMR and more.",
      "Optional background sync — leave it on and a weigh-in reaches the app as soon as you step on the scale, without opening TrainingAI first.",
      "If a reading looks like a big jump from your usual weight (e.g. someone else used the scale), it's held for you to confirm or dismiss instead of being saved automatically.",
    ],
  },
  {
    version: "1.228.3",
    date: "2026-07-27",
    changes: [
      "Body temperature deviation is no longer reported while the ring's personal baseline is still warming up. The baseline starts from zero and takes about two weeks to settle, so early readings were meaningless \u2014 the app reported a body temperature deviation of +17.0\u00b0C on 9 July, and that figure was being fed verbatim to the AI health insight and shown on your day log. It is now withheld until the baseline has 14 nights behind it, the same threshold the illness radar already used.",
    ],
  },
  {
    version: "1.228.2",
    date: "2026-07-28",
    changes: [
      "Logging your last set now takes you straight to the exercise summary — no more \"all sets done, tap Complete\" screen sitting there to be spam-tapped while you're just trying to rest. The rest countdown ring now lives on the summary screen itself, so you still get the same visual feedback.",
    ],
  },
  {
    version: "1.228.1",
    date: "2026-07-28",
    changes: [
      "The heart-rate card no longer claims \"N stray high readings ignored\" when nothing was actually rejected — that number came from a counter that reported 3 or 4 on perfectly clean data regardless of whether your sensor had misread anything. It now shows your single highest reading alongside the corroborated max, and separately flags any readings thrown out as physiologically impossible, which is a real fault signal worth watching.",
    ],
  },
  {
    version: "1.228.0",
    date: "2026-07-27",
    changes: [
      "Added \"Intervals (Norwegian 4×4)\" as a new running-plan goal — 4×4-minute high-intensity intervals with active recovery, twice a week, with easy running filling the rest.",
    ],
  },
  {
    version: "1.227.3",
    date: "2026-07-27",
    changes: [
      "Bodyweight sets no longer record a target you were never given. A pull-up prescription is a rep target, not a percentage of your one-rep max \u2014 but the percentage that target was derived from was being stored as though it were the plan, next to an intensity measured on a different scale. Every bodyweight set therefore looked like you had overshot the plan by 14-18 points. The prescribed rep count is now recorded instead, for every exercise.",
    ],
  },
  {
    version: "1.227.2",
    date: "2026-07-27",
    changes: [
      "Live runs now show their progress in the Android status-bar pill \u2014 distance-so-far/target for a distance-goal run, time-remaining for a duration-goal run, or a plain elapsed clock for a freeform run. Toggle it from Profile \u2192 Preferences \u2192 Run in Status Bar.",
    ],
  },
  {
    version: "1.227.1",
    date: "2026-07-28",
    changes: [
      "Your max heart rate is now worked out in one place instead of three that disagreed. Different screens could anchor effort on different numbers \u2014 the split was hidden only because your observed max still sits below the age-based estimate, and the first reading above it would have made them diverge.",
      "A stray heart-rate spike can no longer set your max. Readings outside 30\u2013220 bpm are discarded as sensor errors, and the max has to be reached several times before it counts \u2014 previously the guided-walk and fitness-test targets took the single highest reading ever recorded, so one bad reading raised your targets permanently.",
      "Fitness-test results now report a corroborated peak and resting HR rather than the single highest and lowest samples, so one motion artefact no longer becomes your recorded peak.",
    ],
  },
  {
    version: "1.227.0",
    date: "2026-07-27",
    changes: [
      "Pull-ups and hanging leg raises now count toward your training volume. They were recording zero work \u2014 208 reps of yours were missing from your lifetime and weekly volume, and from the acute-vs-chronic load ratio that decides when to recommend a deload \u2014 even while the same sets were being scored at 82-88% intensity. A rep is now priced at your actual body weight times the share of it that movement lifts, which adds about 8,900 kg to your lifetime total.",
    ],
  },
  {
    version: "1.226.3",
    date: "2026-07-28",
    changes: [
      "Fixed the map on activity screens still showing a blank grey background for some users after the previous Thunderforest tile fix — the app now recovers automatically if the map key was pasted in as a full example URL instead of just the key itself.",
    ],
  },
  {
    version: "1.226.2",
    date: "2026-07-28",
    changes: [
      "Chest strap: the \"unreachable, retrying\" notification no longer nags forever when the strap just isn't being worn — it gives up quietly after a few minutes instead of repeating every 2 minutes all day. It also now shows the strap's battery % once connected, same as the ring.",
      "Fixed the daily digest wrongly claiming your weekly step goal was already met after only 1-2 days — it was comparing your weekly total against your daily target instead of the actual weekly target.",
      "The \"Your day in review is ready\" banner no longer shows first thing in the morning before there's anything to review — it now only appears in the evening.",
    ],
  },
  {
    version: "1.226.1",
    date: "2026-07-27",
    changes: [
      "Hardened the Thunderforest map-tile key against a stray space or newline picked up when it's pasted into the hosting dashboard — invisible there, but enough to make every tile request silently fail. The key is now trimmed before use.",
    ],
  },
  {
    version: "1.226.0",
    date: "2026-07-27",
    changes: [
      "The AI coach no longer tells you your Pull-Up one-rep max is 118 kg. Bodyweight exercises are tracked internally against a fixed reference weight, and that internal number was being quoted straight back at you in chat, in your prescription rationale and in your daily and weekly recaps. Ask about a pull-up PR now and you get \"6 reps\"; weighted lifts are unchanged.",
      "Bodyweight exercises can no longer unlock the 100 kg squat / bench / deadlift milestones by accident.",
    ],
  },
  {
    version: "1.225.0",
    date: "2026-07-27",
    changes: [
      "GPS activities with elevation data (mainly runs) now show an elevation-vs-distance chart on the activity detail sheet, alongside the existing elevation gain/loss numbers.",
    ],
  },
  {
    version: "1.224.0",
    date: "2026-07-27",
    changes: [
      "Runs now get their own live tracking screen: your heart rate and which zone you're in, distance and pace, splits and elevation gained so far, a live map, and your cadence, all in one place — and if today's run has a target zone, it tells you whether you're in it.",
    ],
  },
  {
    version: "1.223.0",
    date: "2026-07-27",
    changes: [
      "Sleep Scores from before 7 July were being marked down about 3 points every single night for no real reason. The ring's \"restlessness\" reading changed to a completely different scale when it switched to direct Bluetooth, and the score kept applying the old scale's penalty — which meant every earlier night took the maximum restlessness hit no matter how settled it actually was. Restlessness no longer feeds the score; how efficiently you slept and how long you were awake still do, and those never changed scale.",
    ],
  },
  {
    version: "1.222.0",
    date: "2026-07-27",
    changes: [
      "Your Sleep and Readiness scores can now be filled in for past days. Until now a score was only ever saved for the day you happened to open the app, so only 12 of 57 nights had one on record — which made any look back over your history read from a fifth of it.",
    ],
  },
  {
    version: "1.221.2",
    date: "2026-07-27",
    changes: [
      "Fixed the activity route map showing a blank grey background with the correct Thunderforest attribution but no actual map imagery — the app's security policy never allowed loading tile images from Thunderforest's domain, so every tile request was silently blocked.",
    ],
  },
  {
    version: "1.221.1",
    date: "2026-07-27",
    changes: [
      "The daytime-stress signal behind Body Battery's extra drain now uses our own model instead of Oura's, trained on your own overnight heart-rate and skin-temperature data. No visible change today — it needs a few days to learn from your data before it contributes anything, exactly like before.",
      "New Admin → Oura BLE → Comparison harness console: compares our own daytime-HRV estimate against the Polar H10 chest strap, the same way the existing heart-rate comparison does.",
    ],
  },
  {
    version: "1.221.0",
    date: "2026-07-27",
    changes: [
      "Fixed Body Battery sitting flat all day after an afternoon nap. The nap was being treated as the moment you woke up, so every heart-rate reading from earlier in the day was thrown away and the battery just held yesterday's number — which looked like a real measurement rather than missing data. On 26 July that discarded 164 readings.",
    ],
  },
  {
    version: "1.220.0",
    date: "2026-07-27",
    changes: [
      "Naps no longer drag down your sleep quality trend or your weekly recap's average sleep score. A 20-minute afternoon doze was being scored as if it were a night's sleep in those two places, which also fed the AI's view of how you'd been sleeping when it planned your sessions.",
      "New in Admin → Day Review: your Sleep Score for each night next to the rating you gave it the next morning, so you can see where the model disagrees with you. Your rating still doesn't affect the score — this is purely a record to tune against.",
    ],
  },
  {
    version: "1.219.0",
    date: "2026-07-27",
    changes: [
      "Bodyweight exercises now show your strength as a rep max instead of a kilogram figure. A pull-up 1RM in kg was never a weight you lifted — it was an internal number — so pull-ups, hanging leg raises and the rest now read \"6 RM\" across the overview, history, trend charts and the in-workout cards.",
      "Fixed a fake Pull-Up personal record. An internal change in early July made bodyweight strength jump about 40% overnight with no change in your actual performance, and it was recorded as a real PR. Your June sessions have been put back on the same footing, so the history now reads honestly — around 5 to 6 reps since June — and the Pull-Up and Hanging Leg Raise records point at the sessions you actually earned them in (2026-06-21 and 2026-06-23).",
    ],
  },
  {
    version: "1.218.1",
    date: "2026-07-27",
    changes: [
      "Your lifetime totals now count only workouts you actually finished. Sessions you started and walked away from were being counted toward your total volume and sets — about a quarter of the displayed figure — while the workout count excluded them, so the three numbers disagreed with each other.",
      "Fourteen real workouts from May and June that were missing a completion mark have been marked finished from their own last logged set, so tightening this up did not quietly delete them.",
    ],
  },
  {
    version: "1.218.0",
    date: "2026-07-27",
    changes: [
      "Your running plan now remembers your fitness level from the day you set it up, so future runs can be measured against where you actually started.",
      "Added occasional \"push\" sessions — roughly every 5th run, the app asks you to beat your best outdoor distance from this block instead of just repeating the usual target, with a small, achievable stretch goal.",
      "A push session only ever compares against outdoor runs with GPS, so a treadmill session never sets an unfair (or unfairly easy) bar for your next outdoor run.",
    ],
  },
  {
    version: "1.217.1",
    date: "2026-07-27",
    changes: [
      "Fixed the long-standing \u201cmy sleep score doesn\u2019t match how I slept\u201d problem: a nap taken after waking was being scored as though it were the night. A 20-minute nap once produced a Sleep Score of 5 against a 7.86-hour night at 90% efficiency. The app now works out which sleep was the night by when it happened, so a nap can never stand in for it.",
      "A night broken by a wake-up is now treated as one night instead of two. The sleep adds up, the time you spent awake in the middle counts against your efficiency, and the wake-up counts as an awakening \u2014 rather than the second half being scored on its own as a short night.",
      "Naps are also kept out of your resting heart rate and HRV for the day. A 45-minute doze was overwriting the night\u2019s real figures, which shifted every heart-rate zone boundary and put a false spike in the HRV and resting-HR charts.",
      "Readiness and the illness check read the same corrected night, so they no longer react to a nap.",
    ],
  },
  {
    version: "1.217.0",
    date: "2026-07-27",
    changes: [
      "Added a new running plan option: instead of your sessions growing longer each week, you can now keep the same time budget (20/30/45/60 min) and let the app ask you to cover a little more ground in it week over week.",
      "Fixed a bug where every running plan's week-over-week growth was silently stuck at week one, forever — so runs never actually got longer or further no matter how long you'd been on the plan.",
      "Fixed a bug where the running plan always reasoned about a generic placeholder goal instead of the goal you actually picked when setting it up.",
      "Fixed the \"Start run\" button on the Running screen, which was landing you on the activity screen with no run type selected instead of dropping you straight into a run.",
      "Finishing a run now marks today's running-plan card as done, instead of leaving it showing as still pending after you've already logged the run.",
    ],
  },
  {
    version: "1.216.1",
    date: "2026-07-27",
    changes: [
      "The cadence calibration screen now syncs the ring automatically when you stop a capture, and only counts ring readings that actually fall inside the walk you just did. Previously it depended on when the ring happened to sync on its own — a 150 steps/min test was synced 16 seconds in, so almost every ring reading it reported came from before the test started.",
      "Capture exports now say how much of the walk the ring actually covered, so a partly-seen capture can't be read as a complete one.",
    ],
  },
  {
    version: "1.216.0",
    date: "2026-07-27",
    changes: [
      "The Cardiovascular screen now has a Trends card: weekly heart-rate zone minutes, a pace-vs-heart-rate efficiency curve for your runs, and a cadence trend — pick which one to view with three tabs.",
    ],
  },
  {
    version: "1.215.0",
    date: "2026-07-27",
    changes: [
      "Your Sleep Score now looks at how your body actually behaved overnight, not just how long and how soundly you slept. It compares your overnight heart-rate variability and your average heart rate against your own normal, so a night that looks fine on paper but left you wrecked no longer scores like a good one. The night of 25 July \u2014 seven hours, 94% efficiency, but your lowest HRV on record and ten beats above your usual \u2014 used to score 80. It now scores 71.",
      "The Sleep Score also notices when you go to bed later than usual or wake earlier than usual, which a duration-only view hides. Going to bed early or sleeping in is not counted against you.",
      "Every screen now agrees on the same Sleep Score for the same night. The weekly digest, sleep trend, Body Battery and the Health screen previously each worked it out slightly differently, so one night could show two different numbers depending on where you looked.",
      "Naps and short rest periods no longer skew the personal baselines your sleep is compared against \u2014 only full nights count toward them.",
      "A genuinely excellent night can still score 100.",
    ],
  },
  {
    version: "1.214.1",
    date: "2026-07-27",
    changes: [
      "Cadence from the Oura ring is switched off for now. On-device testing showed it reporting the same figure for two walks whose real cadence differed by nearly double, so it isn\u2019t actually measuring your step rate. Cadence now comes from the chest strap only; the ring\u2019s raw readings are still visible in the admin calibration screen while the cause is worked out.",
      "Cadence now handles slow walking properly. Anything under about 84 steps/min was being treated as \u201cnot walking\u201d and thrown away, so a genuine slow walk recorded nothing at all.",
      "A saved activity\u2019s cadence is no longer skewed by the occasional bad reading. One misread window on a 64 steps/min walk was pulling the average up by 10; it now sits within 1 of the real figure.",
      "The cadence calibration screen only looks at readings from the walk you just did. The ring sends its whole backlog when it syncs, so a 3-minute test was being judged against 19 minutes of earlier, faster walking.",
    ],
  },
  {
    version: "1.214.0",
    date: "2026-07-27",
    changes: [
      "Activity detail now shows a hero heart-rate + pace chart you can drag a finger across — the route map's marker slides to show exactly where you were at that moment.",
      "Added a pace-per-km bar chart and your fastest 1km/5km efforts for GPS runs and walks — both were already being recorded but never shown anywhere.",
      "Added a time-in-zone donut next to the existing zone breakdown, and turned the splits list into a proper table.",
    ],
  },
  {
    version: "1.213.1",
    date: "2026-07-27",
    changes: [
      "Fixed cadence reporting a confident but wrong number for slower walking. The detector had a lower limit of 72 steps/min \u2014 above the 60 it was supposed to accept \u2014 so anything slower stuck to that limit and was reported as a real reading instead of admitting it had nothing. A real 102 steps/min walk came back as 71.4.",
      "Cadence now says nothing rather than guessing when the rhythm it finds sits at the very edge of what it searches, which is a sign the real rhythm is outside that range.",
      "The cadence calibration screen now records every reading the ring sends along with whether it thought you were walking, instead of only showing the most recent one \u2014 which was often a non-walking reading and made results look contradictory.",
      "The cadence calibration screen now separates \u201cthe ring sent no data\u201d from \u201cthe ring sent data but didn\u2019t think you were walking\u201d, shows how confident each strap reading is, and includes the raw sensor trace in its export so a bad reading can be diagnosed afterwards.",
    ],
  },
  {
    version: "1.213.0",
    date: "2026-07-27",
    changes: [
      "The Cardiovascular screen now asks how much time you have and suggests a run, walk or activity to fit it — always your choice, never a lock-in.",
      "When it suggests a run, it shows the same reason your running plan already knows about — like easing off after a heavy leg day — right there in the picker.",
    ],
  },
  {
    version: "1.212.1",
    date: "2026-07-27",
    changes: [
      "New Admin → Oura BLE → Comparison harness console: run a spot-check comparing the ring's own heart rate against the Polar H10 chest strap over a chosen window, per minute, flagging anything more than 5 bpm apart.",
    ],
  },
  {
    version: "1.212.0",
    date: "2026-07-27",
    changes: [
      "New Cardiovascular screen: shows this week's heart-rate zone targets — how many minutes you've done and how many are left in each zone — plus your resting, average and max heart rate and your step progress for today and the week.",
      "Gym sessions, runs, walks and any logged activity all count toward the same weekly zone totals — a heavy lifting session moves the same zone minutes a cardio session would.",
      "The workout screen now splits into your gym session and one Other Activity door leading to the new Cardiovascular screen, replacing the separate Run and Log Activity buttons.",
    ],
  },
  {
    version: "1.211.2",
    date: "2026-07-27",
    changes: [
      "Fixed cadence from the ring being able to jump around and skew a saved activity's average. The ring sends its data in hourly batches covering the whole preceding hour, and every reading in a batch was being treated as if it had just happened.",
      "The cadence calibration screen now shows how many gait windows the ring has actually sent, and has a \u201cSync ring\u201d button \u2014 the ring only sends automatically once an hour, so a short test would otherwise show nothing from it no matter how long you walked.",
    ],
  },
  {
    version: "1.211.1",
    date: "2026-07-27",
    changes: [
      "Fixed \"Activity detected\" falsely popping up during a workout (e.g. resting between deadlift sets) — passive walk/run detection is now suppressed for the whole time a workout is in progress, since any ring or phone motion during a session is training-related, not a real walk.",
    ],
  },
  {
    version: "1.211.0",
    date: "2026-07-27",
    changes: [
      "Cadence (steps per minute) is now measured during walks, runs, hikes and treadmill sessions \u2014 shown live while you move, and saved with the activity along with a graph of how it changed.",
      "Two sensors measure it independently: the Oura ring's own stride signal, and the Polar H10 chest strap's accelerometer. The strap leads when connected because it updates every second; the ring covers everything else. Each saved activity records which one measured it.",
      "New Admin \u2192 Cadence calibration screen: compares both sensors side by side against a treadmill's displayed cadence, so their accuracy can be checked against something known.",
      "Cycling and swimming are deliberately excluded \u2014 they have no step rate, and pedal cadence would otherwise be reported as a confident but meaningless number.",
    ],
  },
  {
    version: "1.210.1",
    date: "2026-07-26",
    changes: [
      "Fixed: changing \"Score Card Style\" (More \u2192 Home Widgets) now updates the home score circles immediately, instead of only after fully closing and reopening the app.",
    ],
  },
  {
    version: "1.210.0",
    date: "2026-07-26",
    changes: [
      "New Admin \u2192 Day Review tab: pick any day and see everything that fed each score \u2014 Sleep, Readiness, Activity and Heart Rate \u2014 in one place. For each pillar it shows the raw measurements, every contributor's sub-score, how much weight it actually carried and how many points it put into the final number, plus what was missing and why. Built for working out why a score didn't match how the day actually felt.",
      "Each pillar also shows the score that was saved at the time next to a fresh recompute, and flags them when they disagree.",
      "A \"Copy JSON\" button copies the whole day's breakdown \u2014 including the model's own weights and curves \u2014 for reviewing score tuning.",
      "Day Review can also return a date range (up to 31 days) in one go, so score calibration can be judged across a stretch of days rather than one at a time.",
    ],
  },
  {
    version: "1.209.0",
    date: "2026-07-26",
    changes: [
      "New look for the four home score circles: a plain ring outline, sized up a bit, with each card's icon coloured to match its section (Heart Rate red, Sleep purple, etc) instead of plain white — no more coloured arc or dot.",
      "New \"Score Card Style\" setting (More → Home Widgets) lets you pick between five ring looks for the home score circles — Default, Open ring, Perforated, Accent ring (how it looked before this update), or Halo (a soft glow instead of a ring).",
    ],
  },
  {
    version: "1.208.7",
    date: "2026-07-26",
    changes: [
      "Fixed \"Restore from cloud\" (More → profile) showing a misleading \"Restored 0 records\" success message when the restore actually failed to connect — it now shows a clear error and tells you to try again instead.",
    ],
  },
  {
    version: "1.208.6",
    date: "2026-07-23",
    changes: [
      "Stopped the AI workout prescription being generated 2–3 times when you open a workout (the biggest source of wasted AI calls, spotted via the new Admin → AI Usage panel) — repeated requests within a short window now reuse the in-progress or just-made result instead of re-running the model. No change to what you see; it just stops burning duplicate calls.",
      "Fixed the empty \"Calls over time\" chart in the Admin → AI Usage panel (the bars were collapsing to zero height and rendering blank).",
    ],
  },
  {
    version: "1.208.5",
    date: "2026-07-23",
    changes: [
      "Fixed guided-walk and manual activity saves failing to sync to the server (\"invalid activity_logs payload\", visible under More → profile as a failed-sync item) — an activity with no GPS/distance/heart-rate data was sending empty fields in a format the server rejected outright. Existing failed items can now be retried successfully.",
    ],
  },
  {
    version: "1.208.4",
    date: "2026-07-23",
    changes: [
      "Fixed the follow-up \"Sync failed\" error some devices hit right after the previous fix — the sync transaction now uses the app's real begin/commit database calls instead of plain SQL text, which is the correct and more reliable way to do it.",
    ],
  },
  {
    version: "1.208.3",
    date: "2026-07-23",
    changes: [
      "Fixed \"Sync failed\" on devices whose local database was set up a while back — it was missing some newer health-summary columns and needed a one-time repair, which now happens automatically the next time the app opens.",
    ],
  },
  {
    version: "1.208.2",
    date: "2026-07-23",
    changes: [
      "The guided interval walk's summary now shows a time-in-zone breakdown and Session Load for the walk you just finished, the same view your other logged activities already have.",
    ],
  },
  {
    version: "1.208.1",
    date: "2026-07-23",
    changes: [
      "Fixed the guided interval walk's heart-rate zone targets: they were using a generic fallback profile (190bpm max, 60bpm resting) instead of your real data, making the \"fast\" target unreachable without jogging. Targets now use your actual observed heart-rate history.",
      "Fixed the guided walk's preset buttons (Standard/Quick) giving no visual feedback when tapped — they now highlight the active preset and give a tap response, so it's clear the selection registered.",
      "Added a confirm-before-exit prompt to the guided walk (End walk button, switching tabs mid-walk, and the hardware back button) so you can't accidentally lose an in-progress walk.",
    ],
  },
  {
    version: "1.208.0",
    date: "2026-07-23",
    changes: [
      "Fixed false \"Activity detected\" notifications firing during stationary training (e.g. a garage lifting session): walk/run confirmation now comes from your ring's real stride cadence instead of GPS speed, the same way Garmin and Oura's own detection works. GPS still records your route, but no longer decides whether a walk actually started — a sustained ~90-second cadence signature does, and the saved activity's start time is backdated to when you actually started moving, not when the app confirmed it.",
    ],
  },
  {
    version: "1.207.0",
    date: "2026-07-23",
    changes: [
      "The home score circles have a new look: a thin ring plus a bold coloured accent arc in each card's own colour (blue for Readiness, red for Heart Rate, indigo for Sleep, orange for Activity) — no more fill-style progress ring, since that didn't make sense for a heart-rate reading.",
      "Added \"active minutes\" to the Activity score: time spent with your heart rate elevated today, and how many hours had at least some movement — both now show as real gauges on the Activity detail screen with \"how to improve it\" guidance, and feed into your Activity score.",
    ],
  },
  {
    version: "1.206.1",
    date: "2026-07-23",
    changes: [
      "Auto walk/run detection no longer pops \"Activity detected · Recording your walk or run\" while you're training in one spot. The alert now waits until you've actually covered some ground (~200 m over ~90 s) instead of firing on the first GPS reading, so indoor GPS drift during a stationary session stops triggering it. What counts as a saved walk is unchanged.",
    ],
  },
  {
    version: "1.206.0",
    date: "2026-07-23",
    changes: [
      "Redesigned the four home score circles: bolder progress rings (the arc fills to match your score) with the number and icon front and centre, and dropped the small text label under each — just a coloured dot now, so the cards read cleaner at a glance.",
      "The Activity detail screen is now as thorough as Readiness and Sleep: real contributor breakdowns for your training frequency and volume (with the same tap-to-expand \"how to improve it\" guidance), plus goal gauges for steps, active energy, weekly sessions and weekly volume.",
      "Fixed the Activity AI insight, which was incorrectly saying your activity data was \"missing\" even with a real score showing — it now reads your actual steps, active energy and training data.",
    ],
  },
  {
    version: "1.205.0",
    date: "2026-07-23",
    changes: [
      "The HR Recovery Profile card now shows a month-over-month trend per intensity band, so you can see whether your cardio recovery is getting faster over time. The AI coach can also see this now — ask it things like \"is my recovery from hard efforts improving\" or \"how does my recovery at 150bpm compare to 180bpm\" and it'll pull real numbers across all your lifting and workouts.",
    ],
  },
  {
    version: "1.204.0",
    date: "2026-07-23",
    changes: [
      "Redesigned the four home score cards (Readiness / Heart Rate / Sleep / Activity) as clean full-width circles — white number and icon, with a small colour dot + label showing how you're tracking. Calmer and easier to read at a glance.",
      "The Heart Rate card now shows your average resting heart rate with a low/steady/elevated read against your own baseline, instead of the last raw reading (which could misleadingly show a resting pulse as \"high\").",
      "Recalibrated the Sleep score so a genuinely excellent night can reach the high-90s/100 (it used to cap out around the low 90s no matter how good the night was), and it now factors in your overnight HRV.",
      "Recalibrated the Readiness score so a great day can actually reach 100 — a well-rested, recovered day with a good morning check-in now scores at the top, and your mood/energy check-in counts toward it.",
      "Reworked the Activity score to measure real daily goals (steps, active energy, and your recent training) instead of just comparing you to your own recent average, so 100 means a genuinely good day. Doing too much now eases the score back rather than always rewarding more.",
    ],
  },
  {
    version: "1.203.2",
    date: "2026-07-23",
    changes: [
      "Fixed a bug where a failed Sync would report a confusing \"no current transaction\" error that hid the real cause; sync errors now name the specific step that failed so problems can be pinned down and fixed.",
    ],
  },
  {
    version: "1.203.1",
    date: "2026-07-22",
    changes: [
      "Fixed the ring's step count reading 0: the step model was being fed its gait features in the wrong column order, so it saw no walking and returned zero steps even on a clear walk. Steps from the ring now compute correctly again.",
    ],
  },
  {
    version: "1.203.0",
    date: "2026-07-23",
    changes: [
      "The HR Recovery Profile card now also includes recovery from completed workouts (e.g. runs), not just between-set rests — a band that mixes lifting and workout recovery is now labelled \"Mixed\" so you can tell when a number combines different kinds of effort.",
    ],
  },
  {
    version: "1.202.0",
    date: "2026-07-23",
    changes: [
      "New \"HR Recovery Profile\" card on Health → Body → Heart & recovery: shows how fast your heart rate settles grouped by how hard you were working (e.g. \"from 150 bpm you shed ~34 bpm/min\"), instead of only comparing sets of the same exercise. This is an intensity-normalised, cross-workout view of cardio fitness — currently built from between-set rests, with running and interval recovery to follow.",
    ],
  },
  {
    version: "1.201.3",
    date: "2026-07-23",
    changes: [
      "Sync and Restore now show the actual error if they fail, instead of a generic \"try again\" — so a stuck sync can be diagnosed rather than silently retried.",
    ],
  },
  {
    version: "1.201.2",
    date: "2026-07-23",
    changes: [
      "The exercise \"Heart & Recovery\" card now shows the full recovery curve — how much your heart rate has dropped at 30s, 1min, 90s and 2min into your rest — not just the 60-second figure. For heavier lifts the 2-minute mark is where recovery really shows.",
    ],
  },
  {
    version: "1.201.1",
    date: "2026-07-23",
    changes: [
      "The Main / Secondary / Accessory exercise tags are now solid coloured pills with white text, so they're easy to read against the workout background instead of the faint tinted labels before.",
    ],
  },
  {
    version: "1.201.0",
    date: "2026-07-23",
    changes: [
      "Morning check-in: removed the \"Resting soreness\" scale — it overlapped with Recovery. Recovery covers how you feel; per-muscle soreness is still logged separately.",
      "The \"body temperature elevated\" deload/rest suggestion now only fires once there are ~30 nights of temperature history, so an unsettled baseline can't trigger a false alarm.",
      "Clearer wording on the pre-workout check-in: it lightens loads on sore muscles and can flag a deload or rest day — it tunes today's session, it doesn't rewrite your whole plan.",
      "The \"vs recent\" ranges for heart rate and sleep now show green/amber/red zones so you can see at a glance which end is healthy (e.g. lower resting HR is better, higher HRV is better).",
      "The energy-budget card no longer silently disappears when your profile is missing height/age/sex — it shows a prompt that links straight to your profile to fill them in.",
      "Moved the 24-hour heart-rate graph out of the Oura-ring section into the Heart & Recovery section, so all your heart data lives in one place.",
      "Fixed the oversized session dots on the Workout screen — a global tap-target rule was blowing them up into big circles; they're now the small indicators they were meant to be.",
    ],
  },
  {
    version: "1.200.2",
    date: "2026-07-22",
    changes: [
      "Made the exercise \"Heart & Recovery\" card easier to read: the rest-recovery number now shows a clear ↓/↑ arrow (↓ = your heart rate fell during rest = recovering; ↑ = still climbing) instead of a confusing double-minus, with a one-line legend and plainer labels (\"HR settled in 60s rest\", \"Recovered by next set\").",
    ],
  },
  {
    version: "1.200.1",
    date: "2026-07-22",
    changes: [
      "You can now reach the new \"Heart & Recovery\" trends: on the Health → Training calendar, tap a day you trained, then tap an exercise — its history sheet now opens with the peak-HR and rest-recovery charts. Previously the card existed but there was no way to get to it.",
    ],
  },
  {
    version: "1.200.0",
    date: "2026-07-22",
    changes: [
      "New \"Restore from cloud\" button under More → your profile. If you wipe the app or set it up on a new phone, this rebuilds your full history from the server — your entire sleep, readiness and daily record, not just the last few months — and now brings sleep back with its HRV, resting heart rate and sleep stages intact instead of only the stage hours.",
    ],
  },
  {
    version: "1.199.1",
    date: "2026-07-22",
    changes: [
      "The Main / Secondary / Accessory tag on each exercise is now colour-coded (Main = green, Secondary = blue, Accessory = purple) and sits on the right of the row, so you can read an exercise's role at a glance.",
      "Each health-factor explainer card now shows a golden-zone gauge — the healthy zone in green with a marker for where you currently sit — instead of a plain fill bar, so it reads as \"aim for the green zone\" rather than \"fill it up\". Metrics with a sweet spot in the middle (like body temperature, where both a rise and a drop are worse) show the ideal zone in the centre with high and low on either side.",
      "Another fix for the AI workout plan not appearing without reopening the app: the prescription card now refreshes itself repeatedly while a new plan is being generated, so it shows up as soon as it's ready.",
    ],
  },
  {
    version: "1.199.0",
    date: "2026-07-22",
    changes: [
      "Your heart rate during each set is now saved permanently: peak and average HR during the set, how many beats it drops during the rest that follows, and how long it takes to recover. Open an exercise from your history to see a new \"Heart & Recovery\" card trending peak HR and rest recovery over time, broken down by working weight (e.g. how much your HR drops after a 90% set vs a 70% set). This is a cardiovascular signal only — it reflects how fast your heart settles between sets, not muscular or nervous-system readiness.",
      "The AI coach can now see this per-set heart-rate data too — ask it things like \"which lift takes me longest to recover between sets?\" or \"has my bench heart rate come down at the same weight?\" and it can compare across exercises and tie it to your sleep and readiness.",
    ],
  },
  {
    version: "1.198.0",
    date: "2026-07-22",
    changes: [
      "Workout exercises now show their category (Main / Secondary / Accessory) and the training-intensity band the working weight falls in, so a bare percentage reads as a strength or hypertrophy load.",
      "The Home \"ease off / deload\" recommendation now has a \"Why this recommendation?\" panel that lists the actual signals behind it (body temperature, readiness, HRV/sleep trends, training days in a row, energy, soreness) and explains what Deload, Rest and Full each do.",
      "Every health-score factor (Readiness, Sleep, Activity, Heart Rate) now has a full explainer laid out below the bars — what it measures, what it's compared against, what your score means, and how to improve it. Tap a bar to jump to its detail.",
      "The workout's AI prescription card now refreshes in place the moment a new plan is generated, instead of needing you to close and reopen the app.",
      "New end-of-workout Time Summary: your setup (bar-load), set-work and rest time versus what the session was planned around, per exercise, with a rest-budget headline — and the rest after your final set is now counted instead of being lost.",
    ],
  },
  {
    version: "1.197.1",
    date: "2026-07-21",
    changes: [
      "The Health detail screens (Readiness, Sleep, Heart rate, Activity) no longer flash a loading spinner on the AI insight card each time you open them — it now paints the last insight instantly from cache. The Health screen also loads its time-in-zone chart lazily, so the tab opens faster, and the Trends chart no longer shows a pulsing placeholder over data it already has.",
    ],
  },
  {
    version: "1.197.0",
    date: "2026-07-21",
    changes: [
      "Added an AI Usage panel in Admin: every AI call (coaching insights, digests, chat, prescriptions, nutrition scans, …) is now logged with its token count, latency and a privacy-safe fingerprint, so you can see how many AI calls happen, from which features, how much they cost, and spot the same call being made twice in a row. No prompt text or health data is stored — metadata only.",
    ],
  },
  {
    version: "1.196.0",
    date: "2026-07-21",
    changes: [
      "Your daily step count now comes from Oura's own step-counting model instead of the old estimate that over-counted (e.g. ~16,800 when your phone said ~10,500). New days use the accurate model straight away; older days keep their existing number for now.",
    ],
  },
  {
    version: "1.195.5",
    date: "2026-07-22",
    changes: [
      "Fixed the recurring \"Sync failed\" message and cards failing to load: the ring-data ingest now saves instantly and does its heavy processing (including the on-device sleep model) fully in the background, so it can't stall your workout/food/mood sync or the Home and Health screens.",
      "Restored the sleep hypnogram (the coloured sleep-stage ribbon) on recent nights — it had disappeared because the same overloaded ingest wasn't finishing the sleep-stage calculation.",
      "Health screen now loads its cards in bounded batches instead of firing everything at the server at once, which was overwhelming the database connection pool.",
    ],
  },
  {
    version: "1.195.4",
    date: "2026-07-21",
    changes: [
      "Fixed cards on Home and Health (Progress summary, Training Load, Body Battery, workout data) sometimes failing to load — especially just after an update — with a \"Sync failed\" message. The server now warms up its database check at startup instead of on the first request, and the Body Battery screen no longer waits on background bookkeeping before responding, so those pages load reliably again.",
    ],
  },
  {
    version: "1.195.3",
    date: "2026-07-21",
    changes: [
      "Your sleep score now reflects last night's actual sleep instead of the frozen Oura Cloud number — a great 7h45m / 90%-efficiency night no longer reads as a 31.",
      "The Muscle Status body map (muscle recovery + injuries) now sits at the top of the Body tab instead of buried at the bottom.",
      "The Run and Log Activity buttons on the Workout screen now have a visible border so they don't disappear into the dark background.",
    ],
  },
  {
    version: "1.195.2",
    date: "2026-07-21",
    changes: [
      "Swiping the Trends filter pills (and other horizontal strips) no longer drags the Body / Training / Progress tabs along with them — the strip scrolls on its own now.",
      "Body Battery's \"how it moves\" is now a compact recharge-vs-drain diagram with icons instead of a wall of text.",
      "Training Load shows your monotony as a visual meter (varied → monotonous) with the weekly-strain figure, instead of a bare number.",
      "Tidied the Heart & Recovery section so the resting-HR / HRV / SpO₂ tiles and their \"vs recent days\" ranges read as one connected panel.",
    ],
  },
  {
    version: "1.195.1",
    date: "2026-07-21",
    changes: [
      "Fixed the Workout screen failing to load for anyone with a running plan set up, and brought back the swipe-between-sessions card carousel you know — with quick Run and Log Activity buttons underneath.",
      "Fixed the back button on the Readiness / Heart / Sleep / Activity detail screens — the decorative header art was silently swallowing the tap.",
      "The Energy Budget card now appears as soon as your profile is set, even before you've logged any food today (it just shows your full budget still available).",
      "Sleep night detail no longer shows Oura's 0–100 sub-scores next to the stage hours — they're frozen since the ring re-key and read as contradictory (e.g. \"REM 0\" beside \"2.5 h\"). The hypnogram and real stage/metric figures remain.",
    ],
  },
  {
    version: "1.195.0",
    date: "2026-07-21",
    changes: [
      "The Energy Budget now counts all your movement — weights, runs, walks, cycling, swimming, any logged activity, plus your daily steps — added on top of a resting base, so an active day genuinely gives you more to eat. Each activity is estimated from established MET values (Compendium of Physical Activities) and your body profile, and the maths is de-duplicated so movement is never counted twice: the budget starts from your resting energy (not an inflated 'active' estimate that already assumes exercise), steps below a normal daily baseline aren't counted, and the steps taken during a logged walk or run are removed from your step total so they're not counted on top of the activity itself.",
    ],
  },
  {
    version: "1.194.0",
    date: "2026-07-21",
    changes: [
      "The Energy Budget now counts your strength workouts, not just cardio — a completed gym session adds its estimated energy burn back to your daily budget (e.g. a 55-minute session ≈ 290 kcal), so a training day gives you more to eat.",
    ],
  },
  {
    version: "1.193.0",
    date: "2026-07-21",
    changes: [
      "The Workout screen is redesigned into three cards instead of one full-height swipe carousel: a Workout card (pick any session from a compact chip row, see its muscle map and recovery, and start it), a Run card (your running goal and next prescribed run, tapping through to the running plan), and a small Log Activity card for walks, sports and other cardio — so everything you can start is visible at a glance and there's room for runs and activities alongside your sessions.",
    ],
  },
  {
    version: "1.192.0",
    date: "2026-07-21",
    changes: [
      "The back button on the Readiness / Heart / Sleep / Activity detail screens now sits in a clearly-visible tappable chip, so it's obvious and easy to hit over any header art in both light and dark themes.",
      "\"Measure HR now\" is now its own card in Heart & Recovery, no longer tucked inside the Oura Ring section — so it's available whether your live heart rate comes from the ring or a chest strap.",
      "Resting HR, HRV and SpO₂ now show a scale marking where today's reading sits against your recent days, so it's clear what's normal for you.",
      "Body Battery now always explains how it moves — it opens at your Readiness/Sleep score, recharges as you rest, and drains as you train or your heart rate and stress climb.",
      "The Oura Ring battery now shows your live level from the direct-Bluetooth connection when available, instead of always reading \"Not live\" from the frozen cloud value.",
    ],
  },
  {
    version: "1.191.0",
    date: "2026-07-21",
    changes: [
      "Tapping into an individual sleep night now shows the full picture — efficiency, overnight HRV, lowest heart rate and breathing rate (which the card already showed but the detail view dropped) — plus a scale for each metric showing where that night sits against your recent nights.",
      "The Activity screen now explains what drives your score: Movement (steps + active calories, ~60%) vs Training (your logged gym volume, up to ~40%), so it's clear that workouts do count and by how much.",
      "The Health tab now has an Energy Budget card — your daily calorie goal (or maintenance) counting down as you eat and back up as you burn, with the remaining amount and your projected weekly weight change at today's pace.",
      "Body weight now shows your last-known reading (with the date it was logged) instead of a blank dash when you haven't weighed in within the last 7 days.",
    ],
  },
  {
    version: "1.190.1",
    date: "2026-07-21",
    changes: [
      "The Training Load (ACWR) and Sleep vs Performance cards on the Body tab are now collapsed by default — showing just the headline number/insight — and expand on tap for the full detail, so they no longer each take up a whole screen.",
      "Sleep vs Performance now shows its sleep-duration buckets as a small bar chart (up = lifts above baseline, down = below) instead of plain numbers, so the pattern is visible at a glance.",
    ],
  },
  {
    version: "1.190.0",
    date: "2026-07-21",
    changes: [
      "The Body tab now opens with a muscle map showing which muscles you've worked this week (brighter = more volume) plus your live recovery strip — the at-a-glance headline for the screen.",
      "The Training tab's weekly load chart and your Sessions / Sets / Volume / Avg-Duration stats are now one combined card instead of two separate blocks, so the week reads as a single unit.",
    ],
  },
  {
    version: "1.189.1",
    date: "2026-07-21",
    changes: [
      "Quick-logging a saved meal now goes into the meal (breakfast, lunch, etc.) you opened, instead of whichever meal matches the current time of day — so adding a breakfast at lunchtime lands in breakfast.",
      "Average session duration on the Training tab now reflects your real workout length (start to finish), instead of only the gap between your first and last logged set — which badly understated a session logged in bursts (a true 55-minute session was reading as ~28 minutes).",
      "The Progress tab now leads with Strength Trend and Trends — the two most useful cards — instead of burying them at the bottom.",
      "The Trends card no longer jumps in height as you flick between its views; the chart area is a fixed size so the card stays put while you scroll.",
      "The More tab paints instantly on repeat visits — season badges and program info are now served from cache rather than flashing empty until they load.",
    ],
  },
  {
    version: "1.189.0",
    date: "2026-07-21",
    changes: [
      "The Readiness screen now shows how your score is built, not just the number. A new breakdown explains what drives it — either the Oura base with its training-load and body-temperature adjustments, or (when the ring's cloud score isn't available) the factors your composite score is weighted from. Contributors are now a proper labelled graph, sorted weakest-first with a neutral-50 reference line, and the score carries a \"vs your 14-day average\" chip so you can see at a glance whether today is up or down.",
    ],
  },
  {
    version: "1.188.1",
    date: "2026-07-21",
    changes: [
      "Fixed the occasional \"Sync failed — will retry automatically\" message on the home screen. A background Oura ring sync was doing heavy processing while it saved each batch of ring data, which could tie up the server's database connections long enough that your own workout/food/mood sync couldn't get through. Ring data is now saved instantly and the heavy processing runs separately, so it no longer blocks — or stalls — the rest of the app.",
    ],
  },
  {
    version: "1.188.0",
    date: "2026-07-21",
    changes: [
      "Saved meals now work fully offline — you can create, edit and delete a saved meal with no signal, and it appears in your list instantly and syncs when you're back online. (Adding a brand-new food from scratch still needs a connection; picking foods you've logged before works offline.)",
    ],
  },
  {
    version: "1.187.0",
    date: "2026-07-21",
    changes: [
      "Searching your food library now works offline — typing a food name matches your previously-logged foods straight from the device, so you can re-log a usual food at the gym with no signal. The same applies to the ingredient search when building a saved meal and the \"recently logged here\" quick-pick.",
    ],
  },
  {
    version: "1.186.0",
    date: "2026-07-21",
    changes: [
      "Exercise history now marks deload (recovery) weeks with a small amber \"Deload\" tag on each session row, so a lighter week's numbers are no longer mistaken for a bad session.",
    ],
  },
  {
    version: "1.185.4",
    date: "2026-07-21",
    changes: [
      "Fixed sleep nights that started far too early (e.g. a 5:53 pm bedtime reading ~13 h asleep) when the ring recorded a short burst of activity in the early evening, hours before you actually went to bed. The night is now anchored to your real, continuous sleep period and ignores a brief unrelated evening burst — so bedtime and total time asleep are correct. Nights genuinely split by a long mid-sleep wake are still kept whole.",
    ],
  },
  {
    version: "1.185.3",
    date: "2026-07-20",
    changes: [
      "Your next AI workout is now built the moment you finish a session, instead of when you next open it — so a session you've just trained gets its updated plan (and its 'Auto' status) queued right away rather than sitting blank until you reopen it. The old approach relied on an internal request that sometimes silently never ran; the new one builds it in-process, so it's reliable and also works for workouts completed offline once they sync.",
    ],
  },
  {
    version: "1.185.2",
    date: "2026-07-20",
    changes: [
      "Fixed the app occasionally reopening zoomed in after you minimized it — an accidental pinch or double-tap (easy to trigger during the app-switch gesture) could zoom the view and leave it stuck until a full relaunch. Zoom is now locked to the normal scale so it can't happen.",
    ],
  },
  {
    version: "1.185.1",
    date: "2026-07-20",
    changes: [
      "Opening a workout no longer flashes — the exercise list used to appear, get replaced by a full-screen 'Preparing your AI workout' screen, then swap back to the list. Now the list stays put the whole time; while a fresh AI prescription is being built the heading simply reads 'Preparing your AI workout…' and the Start button waits, then your numbers update in place.",
    ],
  },
  {
    version: "1.185.0",
    date: "2026-07-20",
    changes: [
      "Your prescribed run now gets a warm, one-line coach's explanation of why today's run is what it is (it falls back to the plain reasoning if the AI is unavailable).",
      "The AI workout prescription card now shows a per-muscle weekly volume breakdown (sets/week), so you can see at a glance how the session spreads training load across muscle groups.",
    ],
  },
  {
    version: "1.184.4",
    date: "2026-07-20",
    changes: [
      "Smoothed out first paint on the Friends leaderboard, friend feed, achievements card and Heart Rate page — on a repeat visit they now show your last-known data instantly instead of flashing an empty/loading state for a moment.",
    ],
  },
  {
    version: "1.184.3",
    date: "2026-07-20",
    changes: [
      "Confirming an early deload week now actually lightens your prescribed sets — it switches your working weights and reps to your program's deload style for the week, instead of only pausing PRs and showing a banner while keeping full load.",
    ],
  },
  {
    version: "1.184.2",
    date: "2026-07-20",
    changes: [
      "The friends leaderboard's Streak ranking now shows real training streaks instead of 0 for everyone — your best run of consecutive training weeks (weekly view) and best consecutive-day streak (all-time view), computed the same way as your own streak card.",
    ],
  },
  {
    version: "1.184.1",
    date: "2026-07-20",
    changes: [
      "Fixed a couple of stale-data glitches: logging food or a weight/steps entry now immediately refreshes your Profile achievements (previously it could lag by up to 30 minutes), and a supplement you checked off is no longer shown as 'already taken' the next morning — the daily supplement status now resets correctly at your local midnight, even offline.",
    ],
  },
  {
    version: "1.184.0",
    date: "2026-07-20",
    changes: [
      "The running plan now lets you pick a goal — Get faster (5K/3K speed), Go further (distance), Heart health, or Recovery & resilience — and builds a different plan for each: speed adds VO₂max intervals and threshold work, distance grows an easy-run base, heart-health keeps you in Zone 2 to hit the 150 min/week guideline, and recovery is all easy aerobic to lower resting HR and speed heart-rate recovery. The Running screen now also shows your target minutes in each heart-rate zone for the week (with your easy/hard split), so you can see what the whole week should look like, not just today's run.",
    ],
  },
  {
    version: "1.183.0",
    date: "2026-07-20",
    changes: [
      "New \"Are you making progress?\" card on the Heart Rate page. It compares your recent resting HR, heart-rate recovery and overnight HRV against your own baseline and tells you plainly whether each is improving, holding steady or slipping — with the healthy ranges built in (e.g. HR recovery graded below-normal / normal / good / strong / excellent) and how often to re-check. Small day-to-day wobble is treated as steady so noise doesn't look like a trend.",
    ],
  },
  {
    version: "1.182.0",
    date: "2026-07-20",
    changes: [
      "New Heart-rate profile card on the Heart Rate page: your real max / average / min heart rate recorded over the last 90 days. The max is spike-proof — a single stray high reading (like a 205 from a motion glitch) can't set it; a level only counts as your max once you've genuinely reached it several times. It shows your recorded max next to the age-estimated max and tells you which one your effort zones are anchored to, so you know whether the app is using real data or an estimate yet.",
    ],
  },
  {
    version: "1.181.2",
    date: "2026-07-20",
    changes: [
      "Fixed a rare bug that could silently lose a batch of Oura ring history. When the ring's history was syncing and one upload failed while a later one succeeded, the sync position could skip past the failed span, permanently dropping up to a few hundred events. The sync now holds its position on any failure and re-pulls the whole span (duplicates are ignored), so nothing is lost. (Requires the app to be rebuilt/updated to take effect.)",
    ],
  },
  {
    version: "1.181.1",
    date: "2026-07-20",
    changes: [
      "Renaming a training session in your program no longer resets its phase progress. Phase progress is now tracked by the session's identity rather than its name, so you can rename \"Push\" to \"Chest Day\" (or fix a typo) and it keeps every session you'd already logged toward the current phase — the phase timeline, deload timing and cycle counts all stay put.",
    ],
  },
  {
    version: "1.181.0",
    date: "2026-07-20",
    changes: [
      "The warm-up / bar-load timer pill in the Android status bar now counts DOWN to its target instead of counting up: the whole-workout warm-up counts down from 10:00, and the pre-set bar-load / get-ready pill counts down from the equipment-appropriate prep time (barbell 4:00, machines/dumbbells 2:00, bodyweight 1:00) — matching the on-screen timer bars. When it reaches 0 it turns red and keeps ticking as a negative time (−0:15) so you can see how far over the target you are. (Requires the app to be rebuilt/updated to take effect.)",
    ],
  },
  {
    version: "1.180.1",
    date: "2026-07-20",
    changes: [
      "Fixed AI-prescribed secondary lifts occasionally being set harder than the main lift on strength- and power-focused programs. During a build (accumulation) block the main lift is deliberately kept submaximal to bank volume, but the recent 'never lighter than an accessory' floor was pushing secondaries up to a near-failure effort — above the main. Secondaries are now capped at the main's own effort for that block, so a secondary can match but never out-work the primary lift. Powerbuilding and hypertrophy programs (where the main already runs hard) are unchanged.",
    ],
  },
  {
    version: "1.180.0",
    date: "2026-07-20",
    changes: [
      "Your heart-rate chest strap now keeps tracking all day even with the screen off and the phone in your pocket — not just while the app is open. A background service holds the strap connection and records its beat-accurate HR (and heart-rate variability) continuously, so intermittent walks through the day are captured without you having to open anything. (Requires the latest app build installed on your phone.)",
    ],
  },
  {
    version: "1.179.0",
    date: "2026-07-20",
    changes: [
      "Slimmed the Morning Check-in from five questions to four: 'Wake mood' has been removed because it overlapped almost entirely with 'Motivation to train'. Recovery, Motivation, Sleep quality (feel) and Resting soreness remain — Sleep quality is kept deliberately so your own opinion can be compared against Oura's objective sleep score.",
      "Fixed 'Your week in review' showing nonsense on early days of the week — e.g. on a Monday it reported '0 sessions, a 100% decrease' because it was reviewing the brand-new week (a few hours old) against last week's full total. It now reviews the last completed week (Monday–Sunday) against the week before it, so the recap is always a fair, full-week comparison no matter which day you open it.",
    ],
  },
  {
    version: "1.178.1",
    date: "2026-07-20",
    changes: [
      "The running coach's recovery gate now actually protects you where it previously only looked like it did. Its 'hard leg day' check reads the real time since your last leg session (it was measuring to midnight tonight, so an evening leg day never counted the next morning); its 'short sleep' check now looks at last night specifically (it was using the week's best night, so it almost never fired); a monotonous week of same-every-day load now nudges a hard run easier; and it won't stack two hard running days back-to-back.",
      "Your weekly easy/hard running balance now counts only runs you actually completed — simply opening the running tab used to create a 'planned' run that counted as training and could push you toward a hard interval day before you'd run at all.",
      "Fixed per-exercise deloads reverting to full weight on custom (non-library) exercises the next day while the muscle was still sore — the next-day re-check now recognises a custom exercise's muscles the same way the original recommendation did.",
    ],
  },
  {
    version: "1.178.0",
    date: "2026-07-20",
    changes: [
      "Your workout heart-rate summary — average and peak BPM, best 1-minute recovery, and workout HRV — is now saved as a permanent record the first time you view a session recap. Previously these were recomputed from the raw beat-by-beat data every time, so they silently vanished once that data aged out (~6 months); old recaps kept a blank HR card. Now the numbers stick around even after the raw trace is cleaned up.",
      "Storage housekeeping: the beat-to-beat interval data from the chest strap is now trimmed after 90 days (it was growing without bound), and older workout HR data can be backfilled into the new permanent summaries so nothing is lost when the trim reaches it.",
    ],
  },
  {
    version: "1.177.0",
    date: "2026-07-20",
    changes: [
      "Your heart-rate chest strap now tracks all day, not just during a workout. Whenever it's worn and connected, its beat-accurate reading is used everywhere in the app in preference to the Oura ring — so intermittent walks and general wear get strap-quality HR without opening a workout first. This is careful not to drain the Oura ring: the ring's power-hungry live mode still only runs during a workout. (Currently active while the app is open; all-day background tracking with the screen off is a follow-up.)",
      "Added a notification when a walk or run is detected and starts recording, so you get a live 'activity detected' heads-up instead of only finding out afterwards. The existing GPS tracking notification was also reworded to clearly say it's recording your walk or run, rather than adding a second notification.",
    ],
  },
  {
    version: "1.176.1",
    date: "2026-07-20",
    changes: [
      "Fixed the AI prescription cutting an exercise down to a single working set to fit your time budget (this is what dropped Pull-Up to 1 set). Nothing is ever trimmed below 2 working sets now; if a session still won't fit the time budget at that floor, the card tells you rather than gutting an exercise.",
      "Fixed secondary compound lifts (e.g. Bent-Over Barbell Row) being prescribed too light — they could come out around RPE 6 (\"Light\") because only accessories had a minimum-effort target. Secondary compounds are now worked at least as hard as your accessories (~RPE 8), and capped just under your main lift for the session so they push you without out-loading the primary.",
    ],
  },
  {
    version: "1.176.0",
    date: "2026-07-19",
    changes: [
      "Every AI feature — the chat coach, the weekly digest, the health insight card, and the workout/run recommendations — now reads your live readiness score from the ring instead of the frozen Oura Cloud number that stopped updating in early July. The AI was quietly working off a stale reading; it now sees the same up-to-date readiness the rest of the app shows.",
      "The AI coach and weekly digest can now see your resilience trend and training-stress load, so their advice reflects how much you're recovering versus accumulating fatigue — not just last night's sleep.",
      "Fixed a gap where a one-off AI hiccup at the end of a workout could silently cost you your next auto-generated AI workout; the app now reliably retries until the recommendation is ready.",
    ],
  },
  {
    version: "1.175.1",
    date: "2026-07-19",
    changes: [
      "Freshness fixes across a few screens: the Running screen no longer shows yesterday's run as \"today's\" after midnight; the Time-in-Zone/Training Stress, body-battery, and heart-rate-profile numbers now refresh promptly after a workout, an activity, or a ring sync instead of lingering stale; and an activity you log offline no longer briefly vanishes from \"Activities This Week\" when the app syncs. The session-load number on the RPE trend is now labelled \"sRPE load\" so it isn't confused with the differently-scaled \"Session Load\" on the zone breakdown.",
      "Security and robustness hardening (no visible change): the profile-photo upload now streams and size-checks before buffering and only accepts JPEG/PNG/WebP; the Health Connect sync endpoint throttles bad-secret attempts; injury edits and chest-strap heart-rate uploads validate their input; and out-of-range heart-rate timestamps from a bad phone clock are dropped rather than polluting your data.",
    ],
  },
  {
    version: "1.175.0",
    date: "2026-07-19",
    changes: [
      "Made the Oura ring data pipeline scale: it used to re-process your entire ring history on every sync batch, which would have gradually slowed syncing to a crawl (and eventually stalled it) as history piled up. It now only re-derives the recent window each sync while keeping older days' results exactly as before, so morning syncs stay fast no matter how many months of data you've collected.",
      "The morning catch-up sync no longer re-runs the same heavy analysis dozens of times back-to-back — it's coalesced to run once the batch settles, so your overnight data appears faster. A sync that carries only activity data now updates your daily stats too (it was previously skipped).",
      "If the ring data roll-up ever fails, it now raises an alert instead of failing silently while health screens quietly go stale.",
    ],
  },
  {
    version: "1.174.0",
    date: "2026-07-19",
    changes: [
      "Your next AI workout is now generated the moment you finish a session and saved, so the next time you open that session it loads instantly — no \"Preparing your AI workout…\" wait at all. (Generation was already meant to happen at completion, but the request wasn't reliably reaching the server in production; the app now makes it directly from your device.)",
      "The AI prescription card shows more detail: the estimated session length (e.g. \"~35 min\") next to the confidence, a plain-English \"Why 60% confidence\" breakdown of exactly what's holding the score back (and that it rises as you log more sessions, morning check-ins, and sleep/HRV data), and any per-exercise load adjustment note (e.g. an easier or heavier set based on your recent RPE and 1RM trend).",
    ],
  },
  {
    version: "1.173.5",
    date: "2026-07-19",
    changes: [
      "Follow-up to the AI-workout-prescription fix: the recommended workout now appears on its own within a couple of seconds of opening a session, instead of getting stuck on \"Preparing your AI workout…\" until you closed and reopened the screen. The screen checks for the finished prescription with a fresh request each time now — previously the check was being served a cached \"still preparing\" answer for up to 30 seconds after the prescription was actually ready.",
    ],
  },
  {
    version: "1.173.4",
    date: "2026-07-19",
    changes: [
      "Fixed the AI chat mis-logging your body weight. Asking something like \"should I try 100 kg on deadlift?\" no longer silently records 100 kg as your body weight, and \"log my weight — I benched 100 kg, I'm 92 kg now\" now correctly saves 92, not the first number it sees. It only logs a weight when you actually state your current weight.",
      "Hardened the AI features: a malformed chart from the assistant can no longer crash the chat window (bad charts are skipped, and chart axis colours render correctly instead of black); the program builder now drops any exercise the AI invents that isn't in the exercise library (so muscle/volume tracking stays accurate); the program generator's instructions no longer contradict themselves on how many exercises to include; and speak-aloud (text-to-speech) falls back to the main AI key so it works without extra setup.",
    ],
  },
  {
    version: "1.173.3",
    date: "2026-07-19",
    changes: [
      "Polished the Running screen: its accent colours now actually show (they were silently rendering as unstyled), the first-ever visit shows a loading placeholder and a clear 'Couldn't load — Retry' if the plan fails to load instead of a blank page, and if creating a plan fails you now get an error toast instead of a button that quietly does nothing.",
      "Fixed a few light-theme legibility and tap-target issues: the chest-strap pairing error, trend-vs-last-week chips, and sleep-recovery labels are readable in light mode again; the 'Take deload week now' / 'Dismiss' and 'Use prior data' buttons are now proper, comfortably-sized tap targets; and the AI-periodization card uses the app's workout icons instead of raw emoji. Health trend sparklines no longer flash a loading shimmer when the data was already cached.",
    ],
  },
  {
    version: "1.173.2",
    date: "2026-07-19",
    changes: [
      "Fixed the 6-Minute Walk Test VO₂max reading far too low (~18 for a normal walk, roughly half of what your Oura ring reports). It was using a formula built for clinical/rehab patients. It now uses a formula validated on healthy adults (Burr 2011) that factors in your weight, sex, resting heart rate and age alongside the distance walked — so the estimate lands in a realistic range. If those profile details are missing it falls back to the old distance-only estimate. The 12-minute Cooper run was already correct and is unchanged.",
      "The Resting HR + Recovery test now guides you through its three phases — rest → hard effort → recover — with an on-screen prompt, a per-phase countdown, and a buzz at each transition, instead of a bare timer with no instructions. The guided recovery minute is what lets the '1-minute heart-rate recovery' reading capture properly.",
      "Fixed the buttons on the Fitness Baseline screens sitting too low (under the phone's gesture bar) — the Discard/Save and test screens now keep a proper clearance above the navigation bar.",
      "Fixed the AI chat (\"AI Analysis\") returning a raw \"Invalid input\" error instead of answering. The app sends today's date in slash format (YYYY/MM/DD) but the chat's input validator only accepted dashes, so every message was rejected before it reached the AI. The validator now accepts both formats.",
      "Fixed the AI workout prescription never generating — every session showed \"Preparing your AI workout…\" then fell back to the base program. The app now requests the AI prescription directly from your device rather than relying on a server-side background call that wasn't completing in production. The \"Refresh now\" button also retries generation properly.",
    ],
  },
  {
    version: "1.173.1",
    date: "2026-07-19",
    changes: [
      "Fixed a batch of workout-flow issues: Google Calendar workout events are titled with the session's name again (e.g. \"Push · TrainingAI\") instead of a raw internal ID; a workout logged offline and synced later now keeps its real date in your 1RM history and trends (it used to jump to the day it synced); and the \"New Personal Record!\" celebration on the per-exercise summary now only fires when you actually beat your all-time best, not just last session — no more phantom PRs on a recovery day.",
      "Reopening a session you already finished earlier today now shows a calm \"Done for today\" state instead of a green \"Complete Workout\" button that did nothing useful (it used to create an empty, broken completion). And a workout you started but abandoned days ago no longer lingers as a resumable \"Continue Workout\" with a multi-day timer — the app cleanly resets it on reopen (your logged sets are already saved).",
      "Deleting or editing an old workout no longer makes a months-old personal record show up in this week's digest as if it just happened.",
    ],
  },
  {
    version: "1.173.0",
    date: "2026-07-19",
    changes: [
      "Fixed the Time-in-Zone chart and the Training Stress score, both of which had silently shown nothing. A date-format mismatch meant the time-in-zone chart always came back empty and the training-stress score errored out on every load — both now work, and your training-stress score is saved each day so trends can build up.",
      "Made the daily time-in-zone chart self-correct: when late-arriving ring heart-rate fills in a past day, or your resting/max HR changes, the affected days now recompute instead of showing stale zone minutes forever. The zones also use one consistent profile across the whole chart.",
      "Fitness tests: the '1-minute heart-rate recovery' number now actually records (it was always blank before), measured from your peak effort. Ending a timed VO₂max test early no longer saves a wildly wrong VO₂max — it skips the score and tells you the test needs its full duration.",
      "Chest-strap heart rate: a single bad reading at strap-on (or a stray beat interval) no longer throws away the whole batch of ~40 samples — good readings are kept, only the bad ones are dropped.",
    ],
  },
  {
    version: "1.172.0",
    date: "2026-07-19",
    changes: [
      "Failures that used to happen silently now tell you about them. If a workout can't be saved to the server after repeated tries, you get a one-time alert and a red dot on the More tab (where you can retry or discard it) — instead of it vanishing with no warning. If the workout screen can't load, you now see a 'Couldn't load — Retry' screen instead of an endless loading spinner. And several health/social cards that used to just disappear (or show blanks) when a fetch failed now show a small 'Couldn't load — Retry' state, so a temporary glitch no longer looks like 'no data'.",
      "If the app's on-device storage ever fails to open, it now shows a clear 'Local storage unavailable — saving online only' banner and automatically routes your saves straight to the server, instead of silently dropping them behind a success message.",
      "Heart-rate chest-strap readings are no longer lost when a batch fails to upload on a flaky connection — they're kept and retried on the next upload.",
    ],
  },
  {
    version: "1.171.1",
    date: "2026-07-19",
    changes: [
      "Fixed a silent data-loss bug in food logging: when you logged a brand-new food (from a scan, a photo, a barcode, or typed in by hand — anything not picked from your existing library), the new food item never actually reached the server, so its log entry couldn't sync and was eventually dropped. It still showed on your phone, which is why it looked fine — but it was stranded on-device and missing from other devices and any cloud backup. New foods now sync correctly, and the app automatically re-sends any food logs that were previously stranded by this bug the next time it syncs.",
    ],
  },
  {
    version: "1.171.0",
    date: "2026-07-18",
    changes: [
      "Fixed the AI workout prescription failing to generate (\"couldn't generate\") after editing your program. The cause was your device holding an out-of-date copy of the program, so it asked the AI engine about a session that had been replaced — which correctly failed. Now: editing a program refreshes the on-device copy immediately; exercise identities are preserved on edit (so your AI strength baselines aren't reset every time you tweak the program); and if the app ever does open a stale session link, it re-syncs and asks you to reopen the session instead of silently loading the wrong one. Everything now keys off stable IDs, never session names.",
    ],
  },
  {
    version: "1.170.2",
    date: "2026-07-18",
    changes: [
      "Fixed: if you leave the app open past midnight, the workout screen now correctly rolls over to the new day — yesterday's logged-exercise ticks and the 'Complete Workout' button no longer linger until you restart the app.",
      "Workout completion now stamps the day consistently in your profile timezone everywhere (the calendar/streak update, the offline queue, and the saved log), so a set finished close to midnight lands on the right day even if your phone's clock is set to a different timezone.",
    ],
  },
  {
    version: "1.170.1",
    date: "2026-07-18",
    changes: [
      "Fixed: a value you logged by hand (like your weight) is no longer silently overwritten when a background sync from Health Connect or Oura arrives for the same day. Each health field now remembers where it came from and ranks sources (your manual entry beats the ring, which beats the cloud, which beats Health Connect), so a lower-priority source can only fill in a blank — never replace your data. Crucially this is per-field: logging a manual weight no longer freezes your ring's HRV or your step count for that day; those keep updating from their own source.",
    ],
  },
  {
    version: "1.170.0",
    date: "2026-07-18",
    changes: [
      "Accessory exercises now target a real, goal-appropriate effort instead of a fixed light band. Accessory load is derived from a per-goal target RPE (~8) — so a strength program's accessories sit heavier than a hypertrophy program's, and the same challenge is hit whether you're doing 8 reps or 15 (the weight floats to match). No more accessories stuck reading 'RPE 6 · Light'. Main and secondary compound lifts are unchanged.",
    ],
  },
  {
    version: "1.169.0",
    date: "2026-07-18",
    changes: [
      "New: on-device health anomaly alerts. When the app's own signals flag something — possible illness (skin temp / RHR / HRV drifting against your baseline), a high-stress day, or Low readiness — you now get a native notification the next time you open or resume the app, instead of it only living on a screen you have to check. One alert per type per day; readiness-low is suppressed when a more specific illness or stress alert fires. Toggle it under More → Preferences → Health Anomaly Alerts.",
    ],
  },
  {
    version: "1.168.0",
    date: "2026-07-18",
    changes: [
      "Improved sleep staging: added an LF/HF heart-rate-variability signal — a frequency-domain measure of autonomic balance that helps tell REM from deep sleep independently of the existing signals. On nights with dense enough heart-beat data it can lift REM detection closer to the Oura baseline; on sparse nights it stays neutral. Redecode a night to see it reflected.",
    ],
  },
  {
    version: "1.167.0",
    date: "2026-07-18",
    changes: [
      "New: a running coach — do a baseline, set a goal, and the app prescribes your next run (easy, long, tempo or intervals) with a target heart-rate zone, using the polarized 80/20 method. It is recovery-aware: after a heavy leg day or on a low-readiness morning it automatically dials the run back so you train when it actually helps.",
    ],
  },
  {
    version: "1.166.3",
    date: "2026-07-18",
    changes: [
      "New app icon: a green dumbbell, replacing the blank placeholder. The home-screen icon, the Android themed-icon (monochrome) cutout, and the Oura background-sync notification icon now all show the dumbbell. (The home-screen launcher icon updates after the next APK rebuild; the in-app/browser icon updates immediately.)",
    ],
  },
  {
    version: "1.166.2",
    date: "2026-07-18",
    changes: [
      "New Fitness Baselines: guided cardio tests you can run from a new Baselines screen — a 6-minute walk, a Cooper 12-minute run, and a resting-HR + 1-minute recovery check. Each captures your distance and live heart rate, estimates your VO₂max (or HR recovery), and saves the result so repeating a test later shows your progress. A \"Cardio Baselines\" card on the Health → Training tab shows your latest numbers.",
    ],
  },
  {
    version: "1.166.1",
    date: "2026-07-17",
    changes: [
      "Fixed: the Deload/Rest prompt could appear on a fresh day because it was reading yesterday's daytime-stress instead of today's — so a stressful day (or a busy rest day) wrongly suppressed the next day's workout. It now reads today's stress only.",
    ],
  },
  {
    version: "1.166.0",
    date: "2026-07-17",
    changes: [
      "The rest-timer status-bar pill is now colour-coded: it stays blue while counting down your rest, turns red once you go past your rest time (the overtime count-up), and shows green while you're warming up or getting ready. The pill now also appears during the whole-workout warm-up and the pre-set \"load the bar / get ready\" screen — counting up in green — instead of only during rest between sets. Requires reinstalling the app.",
    ],
  },
  {
    version: "1.165.2",
    date: "2026-07-17",
    changes: [
      "Fixed the new \"Preparing your AI workout\" screen so it no longer causes the AI generation to fail: while waiting, it was re-requesting a brand-new prescription every few seconds, firing a burst of AI calls that tripped the model's rate limit and made them all error out (which then showed the \"couldn't generate\" fallback). It now just checks whether the one in-progress generation has finished, and waits a little longer before falling back.",
    ],
  },
  {
    version: "1.165.1",
    date: "2026-07-17",
    changes: [
      "Activity route maps can now use running-friendly \"Outdoors\" map tiles (trails, contours) when a map key is configured — they fall back to standard OpenStreetMap tiles otherwise.",
    ],
  },
  {
    version: "1.165.0",
    date: "2026-07-17",
    changes: [
      "New: your heart-rate recovery is now trended. The Heart Rate detail page shows a 14-day sparkline of your post-set 60-second HR drop (HRR) — a rising line means your fitness is improving — alongside the resting-HR and HRV trends.",
    ],
  },
  {
    version: "1.164.0",
    date: "2026-07-17",
    changes: [
      "New: time-in-heart-rate-zone. Every workout and cardio activity now shows a Whoop-style zone breakdown with a \"Session Load\" number, and the Health tab has a day/week/month Time-in-Zone card so you can see how long you spend in each zone over time.",
    ],
  },
  {
    version: "1.163.0",
    date: "2026-07-17",
    changes: [
      "Your stress-resilience level is back — computed from your own sleep and recovery signals plus daytime stress, instead of the frozen Oura Cloud value. It appears on the Readiness detail screen once enough history has accrued (and shows a \"still building\" hint while it learns).",
    ],
  },
  {
    version: "1.162.0",
    date: "2026-07-17",
    changes: [
      "New: a daily Training Stress Score — your ring's movement (MET) over the day, weighted by your resting-HR fitness band and an estimated VO₂max, and scaled by your readiness — now appears next to the workout calorie estimate and on the Health training-load card. It only shows once your readiness baseline has learned enough to be trustworthy.",
    ],
  },
  {
    version: "1.161.3",
    date: "2026-07-17",
    changes: [
      "Health metrics now say what they measure: HRV cards are labelled with their window (overnight vs 7-day-vs-28-day baseline), the sleep card's \"RHR\" chip is now honestly \"Lowest HR\", the sleep score badge shows the same computed score as the Home chip (it was blank on every ring-BLE night), and the Overview readiness headline is the same blended score Home shows (hidden on low-data days, matching Home).",
    ],
  },
  {
    version: "1.161.2",
    date: "2026-07-17",
    changes: [
      "Health surfaces no longer present frozen pre-re-key Oura Cloud data as current: temperature deviation now comes from the ring's own nightly baseline (Cloud shown only as a marked pre-re-key fallback), VO₂ max and vascular age are back on the heart-rate page date-stamped 'as of' their last Cloud day, the SpO₂/HRV/resting-HR tiles show the reading's date when it isn't from today, the AI coach is told which values are frozen, and the stale stress/recovery/day-summary/bedtime/resilience passthroughs are gated or removed.",
    ],
  },
  {
    version: "1.161.1",
    date: "2026-07-17",
    changes: [
      "The AI coach now sees more of what your ring already measures when it plans a session: your skin-temperature deviation, sleep quality (not just hours), and SpO₂ all feed the prescription and the rest-day call, and the AI chat can answer SpO₂ questions. The weekly recap also reports your average nightly sleep score, and its 'avg sleep' line now correctly covers just this week.",
    ],
  },
  {
    version: "1.161.0",
    date: "2026-07-17",
    changes: [
      "Daytime stress now sticks around and gets used: the minute-by-minute stress your ring measures during the day is saved each day, so a stressful day nudges your next-session recommendation toward a deload, your readiness stress and recovery tiles reflect it, and the AI chat and weekly recap can talk about it. The expanded Body Battery card also shows an intraday stress strip with how long you spent stressed today.",
    ],
  },
  {
    version: "1.160.0",
    date: "2026-07-17",
    changes: [
      "The illness radar now reaches every decision layer: when your temperature, resting HR, HRV and breathing rate drift together against your baseline, the AI coach is told, the next-session recommendation deloads, an already-generated prescription automatically reduces load for the day (and restores itself when you recover), the chat and weekly digest can discuss it, and an advisory appears right on the Home screen at elevated/fever.",
    ],
  },
  {
    version: "1.159.0",
    date: "2026-07-17",
    changes: [
      "The illness radar now watches your breathing rate as a fourth biomarker — your nightly respiratory rate (which the ring already measures) gets its own personal baseline, and a sustained rise now counts toward the illness flag alongside skin temperature, resting heart rate and HRV. Fully backfilled from your existing ring history.",
    ],
  },
  {
    version: "1.158.1",
    date: "2026-07-17",
    changes: [
      "The 14-day Readiness and Sleep sparklines, the Body Battery morning anchor, and the Sleep contributor bars now run on the app's own daily scores computed from your ring — instead of the pre-July Oura Cloud data that stopped updating when the ring moved to direct Bluetooth. Sparklines fill in from today forward; the battery no longer starts every day at a flat 50.",
    ],
  },
  {
    version: "1.158.0",
    date: "2026-07-17",
    changes: [
      "New guided **interval walk** — a timed fast/slow walking workout (the classic 3-min-fast / 3-min-slow method, fully configurable) with live heart-rate effort zones telling you when to push or ease off, and audio/vibration cues that keep firing even with your phone in your pocket. Start it from Log Activity → Interval walk; it saves to your activity history with per-interval heart rates when you finish.",
    ],
  },
  {
    version: "1.157.1",
    date: "2026-07-17",
    changes: [
      "More reliable app loading right after an update — the app now always fetches the latest page when you open or reload it online, instead of sometimes showing a cached page from a previous version that could fail to load its resources. Offline still works: your last-loaded screens and the offline page are served as before.",
    ],
  },
  {
    version: "1.157.0",
    date: "2026-07-17",
    changes: [
      "Two new Trends on the Health tab: \"Fuelling vs strength\" shows how eating above or below your usual amount going into a session tracks with your lifts on the bar, and \"Volume vs soreness\" shows how the amount of work you do for a muscle tracks with that muscle being sore the next morning. Both need a bit of paired logging (food + workouts, or workouts + morning check-ins) before they light up.",
    ],
  },
  {
    version: "1.156.0",
    date: "2026-07-16",
    changes: [
      "When your AI-adjusted workout is still being generated (right after finishing a session or editing your program), the pre-workout screen now shows a \"Preparing your AI workout…\" state and waits for the real prescription to land, instead of briefly showing your base-program numbers that the AI is about to replace. It refreshes automatically the moment the new prescription is ready. If generation is slow or offline, after a short wait it falls back to your base program with a note so you're never blocked from training.",
    ],
  },
  {
    version: "1.155.0",
    date: "2026-07-16",
    changes: [
      "Rest-timer status-bar pill improvements: pressing home during a rest now shows the pill instead of the floating mini-window (the floating window still opens during a set), so the countdown lands in the status bar next to the clock. When rest hits 0:00 the pill no longer disappears — it flips to a red-style count-up showing how far into overtime you are, instead of vanishing and letting another app's chip take the slot. And the notification now has a \"Start set\" button so you can begin your next set straight from it without opening the app. Requires reinstalling the app.",
    ],
  },
  {
    version: "1.154.1",
    date: "2026-07-16",
    changes: [
      "The daytime-stress drain on Body Battery now uses Oura's own stress rule instead of a rough approximation — it maps your heart-rate-variability dip through Oura's stress/recovery curves (scaled to your personal night-time HRV baseline) into a −1…+1 level, so the amount your battery drains from stress is properly calibrated to you rather than a flat estimate.",
    ],
  },
  {
    version: "1.154.0",
    date: "2026-07-16",
    changes: [
      "Pair your Polar H10 (or any Bluetooth heart-rate strap) from More → Profile — while worn it becomes the heart-rate source during workouts, with beat-accurate readings through sets and rest, and the ring takes over automatically whenever the strap isn't connected or isn't on your chest.",
      "Workouts recorded with the strap now show a Workout HRV figure (rest-window rMSSD) on the done screen, computed from the strap's beat-to-beat intervals.",
    ],
  },
  {
    version: "1.153.1",
    date: "2026-07-16",
    changes: [
      "The Body Battery detail now shows how much of today's drain came from daytime stress, with a note when your stress is elevated right now — so you can see when it's stress, not just training, pulling your energy down. It only appears on days the ring captured enough daytime signal to measure it.",
    ],
  },
  {
    version: "1.153.0",
    date: "2026-07-16",
    changes: [
      "Body Battery now factors in daytime stress. Using Oura's dHRV model, the app estimates your daytime heart-rate variability from skin temperature, activity and heart rate; when it dips below your daytime norm — a sign of stress — your battery drains a little faster, even if your heart rate is low. On days the ring doesn't capture enough daytime signal, the battery behaves exactly as before.",
    ],
  },
  {
    version: "1.152.1",
    date: "2026-07-16",
    changes: [
      "The workout calorie estimate now lets you pick the activity type (walking, running, cycling, HIIT, etc.) right on the done screen — it defaults to strength training and recalculates instantly when you change it, using that activity's own effort values.",
    ],
  },
  {
    version: "1.152.0",
    date: "2026-07-16",
    changes: [
      "Your workout done screen now shows an estimated calorie burn for the session, using Oura's own energy model — its exact strength-training MET values and Schofield BMR formula, scaled by your age, weight, and how hard you rated the session. Tapping your session effort updates the estimate. It appears once your profile has a date of birth, sex, and a logged body weight.",
    ],
  },
  {
    version: "1.151.1",
    date: "2026-07-16",
    changes: [
      "Sleep staging now feeds the ring's blood-oxygen (SpO₂) signal into the neural model. It was silently missing before — the ring reports SpO₂ in a raw form the sleep pipeline wasn't reading — so the model scored your nights with that input blank. Staging is a touch more accurate as a result.",
    ],
  },
  {
    version: "1.151.0",
    date: "2026-07-16",
    changes: [
      "Your sleep stages are now scored by Oura's own neural sleep model, running on your ring's raw signals, instead of our heuristic estimator. In practice that means more accurate REM (the estimator tended to under-read it) and more honest awake-in-bed time. The estimator stays as an automatic fallback on nights without enough signal to run the model.",
    ],
  },
  {
    version: "1.150.0",
    date: "2026-07-15",
    changes: [
      "New illness radar: when your skin temperature, resting heart rate and HRV drift together in the direction that signals your body is fighting something — measured against your own baseline — your readiness detail now shows an advisory and lowers your readiness accordingly. It only speaks up once it has learned your baseline (about two weeks of nights), so it never cries wolf on a cold start.",
    ],
  },
  {
    version: "1.149.3",
    date: "2026-07-15",
    changes: [
      "Your readiness score now factors in your Recovery Index (how early in the night your resting heart rate settles) instead of treating it as a flat neutral — a night where your HR bottoms out early now nudges readiness up, a late-settling night nudges it down.",
    ],
  },
  {
    version: "1.149.2",
    date: "2026-07-15",
    changes: [
      "The Health tab's Lean Mass card is now a Body Composition card — alongside lean mass it shows your fat mass and estimated BMR (daily calories burned at rest), all derived from your logged weight and body-fat %.",
    ],
  },
  {
    version: "1.149.1",
    date: "2026-07-15",
    changes: [
      "Your nightly HRV from the ring is now calculated as a quality-gated median instead of a plain average — brief active moments during the night (and out-of-range readings) no longer drag the number around, so it better matches your true overnight recovery signal.",
    ],
  },
  {
    version: "1.149.0",
    date: "2026-07-15",
    changes: [
      "The workout-completion screen now has a \"Next workout\" card — tap Show to preview your next scheduled session's exercises with the actual weights, reps, and rest it'll prescribe (driven by the same AI periodization the workout screen uses), so you know what's coming before you even start it.",
    ],
  },
  {
    version: "1.148.1",
    date: "2026-07-15",
    changes: [
      "Fixed the rest-timer status-bar pill not actually appearing next to the clock (it was showing only as a notification in the shade). The countdown is now requested as a proper Android 16 \"Live Update\", so on Android 16 it shows as the pill with the ticking rest time. Requires reinstalling the app to take effect.",
    ],
  },
  {
    version: "1.148.0",
    date: "2026-07-15",
    changes: [
      "Nutrition tab: fixed today's burned calories inflating yesterday's macro ring, and the supplements checklist showing today's ticks while looking at a past day.",
      "Nutrition tab: Saved Meals, food library, meal-type settings, and \"recently logged\" now paint instantly on repeat visits instead of flashing a spinner; meal-type edits/deletes feel instant and a double-tap on delete no longer fires two requests.",
      "Nutrition tab: merged the weekly chart and logging-adherence cards into one, compacted the Saved Meals / End of Day buttons into a single row, and added a Water tile (today only) for quick water logging without leaving the tab.",
      "Fixed the weekly nutrition chart rendering its gridlines/bars solid black on some devices, and replaced a few hardcoded colors in the end-of-day review and supplements screens with the app's theme so they stay legible in light mode.",
    ],
  },
  {
    version: "1.147.0",
    date: "2026-07-14",
    changes: [
      "Your rest timer now shows a live countdown in the Android status-bar pill (next to the clock) while you're resting between sets — the same style of chip the phone's Clock app and YouTube Music use. It ticks down on its own even when you've switched to another app, and tapping it jumps you straight back into your workout. You can turn it off under Profile → Preferences → \"Rest Timer in Status Bar\". (On Android 16 it appears as the status-bar pill; on older Android it shows as a live countdown in the notification shade instead.)",
    ],
  },
  {
    version: "1.146.0",
    date: "2026-07-14",
    changes: [
      "The rest timer now keeps counting down on the \"All sets done!\" screen after you log the last set of an exercise, instead of disappearing — the last set is still awarded its rest period, and the ring rolls into a red \"Overtime\" count if you linger past it, exactly like between earlier sets.",
      "Removed the \"Next Session\" target-weights card from the per-exercise summary screen (the one shown after logging each exercise). The next-workout prescription is moving to the workout-completion screen instead, where it can show the whole next session at once.",
    ],
  },
  {
    version: "1.145.1",
    date: "2026-07-15",
    changes: [
      "Live heart rate now reads smoother during workouts and rests. Instead of showing the single most-recent heartbeat from the ring — which naturally jumps 10–20 bpm beat-to-beat and let the occasional misread value flash on screen — the app now shows the median of the most recent beats, so one bad reading can't spike the number. (Added an admin Live HR test console to verify this on-device.)",
    ],
  },
  {
    version: "1.145.0",
    date: "2026-07-14",
    changes: [
      "Tab switching is now instant, every time — the five main tabs (Home, Health, Workout, Nutrition, More) stay loaded in the background like a native app (think MyFitnessPal or Samsung Health), so tapping between them no longer waits on the network or rebuilds the screen. Your scroll position and place within each tab are kept exactly where you left them, and each tab quietly refreshes its data when you return to it.",
    ],
  },
  {
    version: "1.144.1",
    date: "2026-07-15",
    changes: [
      "Further fixed detected bedtimes that started too early on some nights. The previous fix anchored the night to when the ring's motion sensor began, but an evening where the ring briefly recorded a burst of activity before you were actually asleep could still push bedtime ~2 hours early (e.g. showing 8:28 pm for a 10 pm bedtime). The night is now anchored to when the ring begins continuously monitoring your heart rate — which only happens once you're actually asleep — so bedtime and total time asleep are correct even after an active evening. Nights that are genuinely split by a long mid-sleep wake are still kept whole.",
    ],
  },
  {
    version: "1.144.0",
    date: "2026-07-14",
    changes: [
      "Fixed a bug where the session-select week strip could briefly show the wrong \"today\" cell and rest/session state right after loading, because it computed today's date from the device's timezone instead of the same timezone the server uses to bucket your workouts.",
      "Fixed several places that computed \"today\" or date windows in the wrong timezone or with error-prone date math: the AI chat assistant's recent-workout/PR/milestone lookups, a handful of API routes that read a date from the URL, and the sleep widget on Home.",
      "Consolidated several duplicated formulas into a single shared implementation each: the AI \"how am I doing vs my plateau\" trend detector now uses the same regression as the strength-projection card; readiness/training-load score bands, sleep-stage colors, ACWR training-load bands, and the AI chat's target-weight rounding are now computed the same way everywhere they're shown.",
    ],
  },
  {
    version: "1.143.7",
    date: "2026-07-14",
    changes: [
      "Fixed a bug where two workout-load bar charts (in the Day-in-Review sheet and the session-effort trend) could render their bars solid black instead of the app's brand color. Also fixed the Day-in-Review sheet having extra padding at the bottom on devices with a gesture bar.",
      "Rebuilt the \"Day in review\" and \"Week in review\" home banners on a shared, more robust component — the dismiss (X) button is now a proper full-size tappable button instead of a small icon crammed inside the banner, and the day-review banner no longer overflows slightly off the right edge of the screen.",
      "Replaced a handful of hardcoded colors with the app's theme system so they stay legible in both light and dark mode (the rest-day icon, the Oura \"last synced\" stale indicator — which also now shows a warning icon instead of just changing color, an admin update-available banner, and the exercise-readiness mood card), and swapped a couple of emoji/text-glyph indicators for proper icons. Two admin screens' expand/collapse toggles now correctly announce their state to screen readers.",
    ],
  },
  {
    version: "1.143.6",
    date: "2026-07-14",
    changes: [
      "Performance pass across Home, Health, and Nutrition: several cards that used to flash a loading skeleton on every visit now paint instantly from cache instead; the Health screen's Oura, workout-density, and nutrition/activity trend cards now share a single data fetch instead of three separate ones; swiping between days in Nutrition no longer re-fetches your targets, meal types, and weekly summary on every swipe (just the day's food log) and no longer flashes blank while it loads; and the warm-up screen's muscle diagram no longer redraws every second.",
      "The workout load-comparison chart on the day-review screen and several Health cards no longer pull chart-rendering code into every page load, trimming the amount downloaded on first open.",
    ],
  },
  {
    version: "1.143.5",
    date: "2026-07-14",
    changes: [
      "Workout screen polish pass: the deload badge on the pre-workout exercise list is now a proper separate button instead of being nested inside the exercise row's tap target; set-log and set-complete haptic feedback fires instantly instead of waiting on the network; the session-effort (RPE) rating can now be changed after you've picked it, not just set once; and voice-logged weights now snap to your equipment's real increment (2.5 kg for barbells, 1.25 kg otherwise) instead of landing on an odd number.",
      "Fixed several small UI issues: the workout-select carousel dots are now real tappable buttons; borders and dividers that were hardcoded white now follow the light/dark theme properly; the exercise-summary screen's header icon and 1RM change indicator now use the correct icon; personal-record badges use the app's amber accent color instead of a plain yellow, and the PR share icon is visible without hovering; a few icon-only buttons got accessibility labels.",
      "The end-of-workout heart-rate card now shows a clear error with a Retry button if it can't load, instead of silently saying \"no data\"; the HR recovery chart's gridlines now render in the correct theme color instead of black.",
    ],
  },
  {
    version: "1.143.4",
    date: "2026-07-14",
    changes: [
      "AI-dynamic programs: your workout's prescribed weights now stay honest between the day it was planned and the day you actually train it. If you log fresh soreness today for a muscle the plan is targeting, that exercise now gets a lighter deload automatically — even though the plan itself was generated after your last session, not today. And if a plan sits unused long enough to expire, it no longer keeps driving your loaded weights — you fall back to your normal program.",
    ],
  },
  {
    version: "1.143.3",
    date: "2026-07-14",
    changes: [
      "Tidied up the admin Oura BLE debug screen. The single giant \"Advanced (raw protocol)\" panel is gone — the raw commands are now grouped by function (Connection, Heart rate, Accelerometer, History & sync, Measurements, Diagnostics), and each testing module (Step calibration, Live step test, Continuous capture, Battery soak, Sleep epochs) is its own collapsible section you expand only when needed. The log output now has a Copy button (and a Clear button), so you can grab the full log as text instead of screenshotting it.",
    ],
  },
  {
    version: "1.143.2",
    date: "2026-07-14",
    changes: [
      "Fixed two sleep-timing bugs on the Health sleep view. The wake time shown in the sleep detail no longer drifts a few minutes past your real wake-up (it occasionally read as a time in the future when opened just after waking) — it now shows the ring's actual recorded wake time, matching the chart below it. And a night's detected bedtime no longer starts too early when the ring recorded some evening wind-down before you were actually asleep: the sleep window is now anchored to when the ring's sleep-motion sensor actually starts, so bedtime and total time asleep reflect real sleep instead of pre-bed couch time.",
    ],
  },
  {
    version: "1.143.1",
    date: "2026-07-13",
    changes: [
      "Live HR during a workout now shows only while you're resting between sets (not mid-set, where the ring reads unreliably under grip and made the line look like it dropped then spiked). The per-exercise summary card now replays your full heart-rate trace for that exercise with each set marked, so you can see how your HR moved across the whole exercise.",
      "Every workout-phase action button (warm-up, pre-workout, Start/Log/Complete Set, exercise summary, and the done screen) now sits consistently higher above the phone's navigation bar so it's no longer cramped against the bottom edge; the in-workout Live HR card is more compact so the rest timer isn't squished; and the end-of-session HR Recovery graph is smoothed so the line reads cleanly instead of looking spiky.",
    ],
  },
  {
    version: "1.143.0",
    date: "2026-07-13",
    changes: [
      "The ring-only accurate step counter is live (opt-in): a new \"Continuous step capture\" toggle in the Oura BLE debug tools streams the ring's accelerometer continuously from 6am to 10pm, counts steps with the walking-rhythm gate (which ignores cooking, gesturing and desk motion), and records them as accurate step windows. Heart-rate and SpO₂ recording are untouched, workouts' live HR takes priority automatically, and the ring runs fully stock overnight. Battery level is logged every 5 minutes so the first day doubles as the battery test. Off by default.",
    ],
  },
  {
    version: "1.142.0",
    date: "2026-07-13",
    changes: [
      "Smarter autoregulation: if you rate a lift very hard (high RPE) AND don't finish the prescribed reps, the next session now eases the load 5–10% (scaled by how far short you fell) so you can hit the full rep count with clean reps. Previously it only backed a lift off when your estimated 1RM was also dropping, so a too-heavy weight you were grinding through could stay too heavy. A hard set where you still complete every rep is left alone — that's a productive hard session. Your target reps are kept; only the weight comes down.",
    ],
  },
  {
    version: "1.141.0",
    date: "2026-07-13",
    changes: [
      "New battery-soak test in the Oura BLE debug tools: one tap starts an all-day accelerometer streaming run (with steps recording paused but heart-rate/SpO₂ recording untouched), logs the ring's battery level every 5 minutes with automatic stream re-arming, and exports the drain curve as JSON. This measures the real battery cost of the upcoming ring-only accurate step counter before it's built.",
    ],
  },
  {
    version: "1.140.5",
    date: "2026-07-13",
    changes: [
      "Editing your program (changing an exercise's role, swapping exercises, or adjusting the time budget) now takes effect right away. Previously the AI kept using the recommendation it had already generated — so a role or structure change wouldn't show up until you completed that session again or the old recommendation expired (up to a week later). Now saving a program edit refreshes the recommendation the next time you open the session.",
    ],
  },
  {
    version: "1.140.4",
    date: "2026-07-13",
    changes: [
      "Fixed an edge case where deleting an abandoned (never-completed) workout could incorrectly reduce your training-phase session count, and made sure that count only ever reflects sessions you actually completed.",
    ],
  },
  {
    version: "1.140.3",
    date: "2026-07-13",
    changes: [
      "Small hygiene and performance cleanups: the pre-workout \"Starting in 3...2...1\" countdown no longer causes the whole screen to re-render every second, and a couple of other internal-only render efficiency fixes.",
    ],
  },
  {
    version: "1.140.2",
    date: "2026-07-13",
    changes: [
      "Fixed the rest timer beep/notification and on-screen ring going silent or mismatched during a superset — switching between exercises no longer clobbers the just-logged set's rest countdown, and a set with no configured rest time now gets a real countdown instead of staying silent. A workout resumed hours after the app was closed (or across midnight) no longer replays a stale timer — it now resets cleanly instead.",
    ],
  },
  {
    version: "1.140.1",
    date: "2026-07-13",
    changes: [
      "Offline-sync hardening: an edited or deleted set now correctly propagates to other devices instead of vanishing invisibly; a deleted workout session now disappears from this device's own history instantly instead of waiting for the next sync; exercise history now shows during a workout even offline; and a few other under-the-hood sync robustness fixes.",
    ],
  },
  {
    version: "1.140.0",
    date: "2026-07-13",
    changes: [
      "Your AI workout plans now learn your real warm-up and bar-load/transition times instead of always assuming a fixed 15% warm-up and a generous 4-minute barbell setup. Once you have enough logged history (about 8 sessions for warm-up, 5 logged transitions per exercise/equipment type), the plan uses your own median times — so if you consistently warm up faster and get to the bar quicker, that freed-up time automatically fills with more working sets. Until then it falls back to the previous safe estimates, so nothing changes early on.",
    ],
  },
  {
    version: "1.139.16",
    date: "2026-07-13",
    changes: [
      "Fixed several places where accepting/dismissing an AI prescription, editing a workout from the Health tab, or completing a workout could leave stale numbers cached for up to several hours (pre-workout cards, weights/strength trends, achievements). Today's recommended session no longer shows yesterday's rest-day banner if the app stayed open across midnight.",
    ],
  },
  {
    version: "1.139.15",
    date: "2026-07-13",
    changes: [
      "Offline-sync hardening: writes made offline for body metrics, activity logs, day check-ins, injuries, and supplements now get the same validation as the live app instead of silently accepting corrupted or malformed data on reconnect. Water quick-add from two devices now sums correctly instead of one overwriting the other. Fixed your lifetime stats (sessions/volume/sets) and phase-progress counters to self-correct if they ever drift out of sync with your actual workout history.",
    ],
  },
  {
    version: "1.139.14",
    date: "2026-07-13",
    changes: [
      "Nutrition hygiene pass: removed the non-functional \"save to my food library\" toggle from the food scan review screen (every logged food was already being saved), fixed a couple of small validation and display gaps, and touched up icon/color/touch-target polish across the nutrition and supplement screens.",
    ],
  },
  {
    version: "1.139.13",
    date: "2026-07-13",
    changes: [
      "Program editor: the exercise Role selector (Main Compound / Secondary Compound / Accessory) now shows for AI-dynamic programs too — previously it only appeared for phase-based programs, so you couldn't change an exercise's role.",
      "Program editor: each exercise's name is now shown on its own full-width line instead of a cramped field squeezed next to the action buttons, so names are readable again.",
    ],
  },
  {
    version: "1.139.12",
    date: "2026-07-13",
    changes: [
      "Consolidated the AI food-scan review screen's ingredient-weight-adjustment math onto the same formula used to actually log the meal, so the preview total can never drift from what gets saved.",
    ],
  },
  {
    version: "1.139.11",
    date: "2026-07-13",
    changes: [
      "Supplement reminders now cancel properly when you disable, delete, or turn off a supplement (and when you delete a meal type) instead of the old notification still firing. Your end-of-day digest now refreshes automatically after logging more food or training — it no longer shows lunchtime numbers all evening.",
    ],
  },
  {
    version: "1.139.10",
    date: "2026-07-13",
    changes: [
      "Fixed the food quick-edit sheet showing and saving the wrong quantity when editing a second log right after the first — edits and quantity updates now apply and reflect instantly. Logging a saved meal while viewing a past day now logs (and shows) on that day instead of writing to today. \"Add as new food\" from the meal builder no longer fails.",
    ],
  },
  {
    version: "1.139.9",
    date: "2026-07-13",
    changes: [
      "AI-dynamic training: the prescription card's displayed weight now always matches what the bar actually loads (barbell exercises round to the nearest 2.5kg pair instead of drifting 1.25kg light), one Gemini outage no longer costs two sessions of missing prescriptions, phase transitions are now validated instead of accepting any phase, and a new AI-dynamic program can no longer skip its baseline week just because an old program logged the same exercise name.",
    ],
  },
  {
    version: "1.139.8",
    date: "2026-07-13",
    changes: [
      "Fixed the Home Body Battery bar overflowing the right screen edge — it now sits within the same margins as the other cards.",
    ],
  },
  {
    version: "1.139.7",
    date: "2026-07-13",
    changes: [
      "AI-dynamic training: a card-initiated deload session no longer mints a personal record — deload state for these programs lives outside the automatic phase engine and wasn't being checked before deciding whether a set's estimated 1RM should count.",
    ],
  },
  {
    version: "1.139.6",
    date: "2026-07-13",
    changes: [
      "Fixed sleep nights showing far too much Awake time. A recent attempt to detect lying-awake-in-bed was over-eager and mislabelled normal light-sleep stirring as awake. Reverted it — Awake now reflects only clear wake again. Redecode a night (Oura BLE tester) to restage.",
    ],
  },
  {
    version: "1.139.5",
    date: "2026-07-13",
    changes: [
      "Weekly volume-vs-target tracking (AI-dynamic training) now measures the week using your local timezone instead of UTC — a session logged just after Monday midnight AEST previously could still count toward the prior week's total near a week boundary.",
    ],
  },
  {
    version: "1.139.4",
    date: "2026-07-13",
    changes: [
      "AI-dynamic training no longer forces a blanket emergency deload just because you have any active injury logged — a single minor injury now lets the AI weigh it alongside your other signals instead of always cutting the session to 2 sets at 50%.",
    ],
  },
  {
    version: "1.139.3",
    date: "2026-07-13",
    changes: [
      "Powerbuilding sessions now prescribe secondary compounds at a moderate load (a step below your main lift, a couple more reps) instead of the same near-max weight — so a session is one heavy anchor plus moderate volume, easier on time and recovery. The load still shifts with your phase.",
    ],
  },
  {
    version: "1.139.2",
    date: "2026-07-13",
    changes: [
      "AI-dynamic training now tracks whether you actually followed its last prescribed session, so future autoregulation (rep-completion-based load adjustments) can factor in real adherence instead of always assuming no data.",
    ],
  },
  {
    version: "1.139.1",
    date: "2026-07-13",
    changes: [
      "Fixed the Home streak resetting a day too early — it now allows two rest days in a row and only breaks on the third, matching the streak banner and the rest-day guidance (previously a second rest day, or a rest day next to an activity-only day, could reset it).",
    ],
  },
  {
    version: "1.139.0",
    date: "2026-07-13",
    changes: [
      "Live HR during a workout is now a full-exercise chart — it shows the whole exercise (peaks during lifts, dips during rest) with a dotted line marking each logged set, instead of just a rest-time sparkline.",
      "Fixed spurious HR readings (e.g. a stray 38/60 bpm mid-set): impossible jumps are now rejected and the big number reads from the cleaned signal, so a bad decode no longer flashes as your heart rate.",
      "Live HR keeps moving instead of freezing when the ring goes quiet, and the reading + trace now tint by heart-rate zone (Recovery → Peak).",
    ],
  },
  {
    version: "1.138.14",
    date: "2026-07-13",
    changes: [
      "Fixed a rare case where resuming the same exercise via Continue Workout could leave the next exercise's set weights blank or stale.",
    ],
  },
  {
    version: "1.138.13",
    date: "2026-07-13",
    changes: [
      "Fixed the Home, Nutrition and More screens so their content scrolls inside a fixed app frame instead of the whole page sliding under the bottom tab bar — the last cards (streak/rest banner, etc.) are no longer tucked behind the navigation.",
    ],
  },
  {
    version: "1.138.12",
    date: "2026-07-13",
    changes: [
      "Morning Check-in scales now read left-to-right from worst to best (good on the right), with a word under every rung — e.g. Wake mood shows Awful · Poor · Average · Good · Great — instead of only labelling the two ends.",
    ],
  },
  {
    version: "1.138.11",
    date: "2026-07-13",
    changes: [
      "AI-built powerbuilding programs now use one heavy compound per session (4×6 @80%) with moderate 4×8 @70% secondaries, instead of stacking three near-max lifts into every session — so new programs fit their time budget and are easier to recover from.",
    ],
  },
  {
    version: "1.138.10",
    date: "2026-07-13",
    changes: [
      "Fixed a bug where a manually-dialed set weight could get silently overwritten mid-exercise by a late background data refresh.",
    ],
  },
  {
    version: "1.138.9",
    date: "2026-07-12",
    changes: [
      "Admin: added an “Export active program” tool (Admin → tools) that copies your full program — every session's exercises with role, sets×reps@%, rest and estimated vs budgeted time — as text.",
    ],
  },
  {
    version: "1.138.8",
    date: "2026-07-12",
    changes: [
      "Fixed new personal records and XP earned during a workout disappearing from the done screen if the app refreshed mid-session.",
    ],
  },
  {
    version: "1.138.7",
    date: "2026-07-12",
    changes: [
      "Fixed a rendering glitch where a program with the same exercise twice in one session could misbehave on the pre-workout and warm-up screens.",
    ],
  },
  {
    version: "1.138.6",
    date: "2026-07-12",
    changes: [
      "Fixed voice-logged weight/reps outside the normal range (e.g. a mis-heard '0 reps') silently failing to save — they're now clamped to the same range the manual +/- controls allow.",
    ],
  },
  {
    version: "1.138.5",
    date: "2026-07-12",
    changes: [
      "Workout Review moved to More → Workout: each session in your active program now has a “Review” button.",
      "Workout Review now shows the full picture — every exercise the AI wanted to drop, including the ones it kept to protect a muscle you're under-target on — and frames the time against your full session budget (warmup + working).",
      "Sessions now plan to use the full hour minus warmup (no separate finish-early buffer) — you'll still finish early as your real rest/set times come in under the estimates.",
    ],
  },
  {
    version: "1.138.4",
    date: "2026-07-12",
    changes: [
      "Fixed the training-load history chart losing continuity after a session is renamed — it now matches by the session's stable id instead of its (possibly changed) name.",
    ],
  },
  {
    version: "1.138.3",
    date: "2026-07-12",
    changes: [
      "Fixed workout recaps not updating after editing or deleting an exercise log — the AI-generated summary now regenerates instead of describing the pre-edit session forever.",
    ],
  },
  {
    version: "1.138.2",
    date: "2026-07-12",
    changes: [
      "Fixed a bug where editing or deleting an older workout log could incorrectly resurrect a deloaded set's inflated number as your personal record.",
    ],
  },
  {
    version: "1.138.1",
    date: "2026-07-12",
    changes: [
      "Fixed step counts (and other ring data) not updating on their own — the app now refreshes automatically after the ring syncs in the background, instead of only after a manual pull-to-sync.",
    ],
  },
  {
    version: "1.138.0",
    date: "2026-07-12",
    changes: [
      "New: Workout Review — tap “Review & adjust” on your recommended session and the AI checks it against your recent timing, RPE, soreness and weekly volume, then proposes dropping or tuning exercises so the session fits its time budget. Review the changes and apply each one for just this cycle or permanently.",
    ],
  },
  {
    version: "1.137.11",
    date: "2026-07-12",
    changes: [
      "Fixed the workout summary sometimes showing a different estimated 1RM than what actually got saved during a baseline (AMRAP) testing phase.",
    ],
  },
  {
    version: "1.137.10",
    date: "2026-07-12",
    changes: [
      "Fixed a bug where a superset with unequal set counts (e.g. 3 sets on one exercise, 4 on its partner) could end the workout before the longer exercise's extra sets were logged.",
    ],
  },
  {
    version: "1.137.9",
    date: "2026-07-12",
    changes: [
      "Fixed a bug where rapidly double-tapping \"Complete\" on a workout set could log the same set twice.",
    ],
  },
  {
    version: "1.137.8",
    date: "2026-07-12",
    changes: [
      "Fixed a crash that made the Home and Health screens fail to load (\"Something went wrong\") when the heart-rate chart had a gap in the ring's coverage.",
    ],
  },
  {
    version: "1.137.7",
    date: "2026-07-12",
    changes: [
      "Fixed a bug where completing a single-exercise workout could silently fail to save — no completion time, no XP/PR, no calendar event — while multi-exercise workouts were unaffected.",
    ],
  },
  {
    version: "1.137.6",
    date: "2026-07-12",
    changes: [
      "Fixed several save/delete actions (morning check-in, end-of-day review, session RPE, supplement deletion, saved-meal deletion, AI prescription accept/transition) that could silently report success even when the request actually failed.",
    ],
  },
  {
    version: "1.137.5",
    date: "2026-07-12",
    changes: [
      "Home: the early-deload card no longer marks a deload as started if the save fails — it now shows an error and lets you retry.",
    ],
  },
  {
    version: "1.137.4",
    date: "2026-07-12",
    changes: [
      "Health tab: reopening a day's detail overlay now paints instantly from cache instead of re-fetching every time.",
    ],
  },
  {
    version: "1.137.3",
    date: "2026-07-12",
    changes: [
      "Overview: logging a body-metric value (weight, steps, calories, macros, measurements) now saves offline-first and syncs in the background instead of requiring a live connection.",
    ],
  },
  {
    version: "1.137.2",
    date: "2026-07-12",
    changes: [
      "Health tab: today's weight/steps tiles no longer show blank on a fresh offline app-open — they were only ever filled in from the network before this fix.",
    ],
  },
  {
    version: "1.137.1",
    date: "2026-07-12",
    changes: [
      "Health tab: cards that failed to load their data (nutrition/activity trends, workout density, correlation trends) now show a short message instead of silently disappearing.",
    ],
  },
  {
    version: "1.137.0",
    date: "2026-07-12",
    changes: [
      "Body tab regrouped under labelled sections (Body, Sleep, Heart & Recovery, Activity & Intake, Ring, Injuries) instead of one long scattered scroll — heart data used to be spread across four separate spots.",
      "Removed the card-reorder button in the Health tab header, which hadn't actually done anything for a while.",
    ],
  },
  {
    version: "1.136.1",
    date: "2026-07-12",
    changes: [
      "Health tab: the weekly training stats and body-metric trends now paint instantly on a repeat visit instead of flashing a loading skeleton, and the whole card fleet renders a bit smoother while you interact with the screen.",
    ],
  },
  {
    version: "1.136.0",
    date: "2026-07-12",
    changes: [
      "Health tab: removed several Oura cards that went dark after the ring re-key and could never show data again (Activity/Stress & Recovery/Advanced sub-cards, the Body-tab indicators strip, and dead bedtime/temperature-deviation cards on the detail pages) — what's left actually reflects live ring data.",
      "Sleep sessions now capture a respiratory rate from the ring's raw beat data, and the sleep card's breaths/min chip is live again.",
      "The heart-rate chart no longer draws a fake flat line across gaps where the ring wasn't recording, and never disappears entirely — it now shows an empty state instead. The heart-rate detail page also gets the full 24h chart.",
    ],
  },
  {
    version: "1.135.1",
    date: "2026-07-12",
    changes: [
      "Health tab: fresher data after logging a set, water, or a walk (fixed several cache-refresh gaps), and the AI insight card no longer burns through its hourly budget on a few visits.",
    ],
  },
  {
    version: "1.135.0",
    date: "2026-07-12",
    changes: [
      "Workout planning now learns your real per-set work and rest times (per exercise, per effort band) and reserves a finish-early margin — sessions are planned to end ~10% under your time budget.",
    ],
  },
  {
    version: "1.134.0",
    date: "2026-07-12",
    changes: [
      "Home screen keeps working offline for sleep, streaks/week strip and weekly totals (they now paint from your on-device data first). Faster and smoother home overall — fewer re-renders, a leaner screen, and cleaned-up colours/tap targets for accessibility.",
    ],
  },
  {
    version: "1.133.0",
    date: "2026-07-11",
    changes: [
      "Instant tab switching and faster app open — navigation reuses cached screens instead of refetching, the cached app shell paints immediately on open, and More-tab pull-to-sync no longer clears every screen's cached data. Splash screen on launch (takes effect after the next app update).",
    ],
  },
  {
    version: "1.132.0",
    date: "2026-07-11",
    changes: [
      "Readiness score now builds its own personal baselines from your ring data (14+ nights of HRV, resting heart rate, temperature and sleep history) instead of a crude sleep+load estimate, closing the gap the frozen Oura Cloud sync left behind. Nightly temperature deviation is computed for the first time too.",
    ],
  },
  {
    version: "1.131.0",
    date: "2026-07-11",
    changes: [
      "Walk detection is now triggered by the ring's own paired step-gate windows instead of only the phone's motion sensor, and GPS now shuts itself off reliably (a timer-independent watchdog force-stops it even if the screen has been off for a while) — should mean noticeably less battery drain from background walk detection.",
    ],
  },
  {
    version: "1.130.1",
    date: "2026-07-11",
    changes: [
      "Home: faster refresh (ring drain instead of a dead cloud sync call), the streak/calendar now update immediately after completing a workout instead of waiting on the network, and one fewer redundant request per load.",
    ],
  },
  {
    version: "1.130.0",
    date: "2026-07-11",
    changes: [
      "The app now opens and works with no signal — a proper \"you're offline\" screen instead of a blank error page, an \"Offline — showing saved data\" indicator, and your recently-visited screens keep working without a connection.",
    ],
  },
  {
    version: "1.129.1",
    date: "2026-07-11",
    changes: [
      "Live workout HR now holds your last reading instead of blanking, the graphs are averaged for a smoother line, and \"Measure now\" moved to the Body/Health screen.",
    ],
  },
  {
    version: "1.129.0",
    date: "2026-07-11",
    changes: [
      "Sleep staging now catches quiet wakefulness — lying awake in bed (e.g. on your phone) with your heart rate and movement both mildly up. Previously that read as light sleep because neither signal alone crossed the wake threshold; now a sustained stretch of both together is correctly marked awake, so time-awake and time-asleep are more honest. Still, motionless drifting-off after it stays counted as sleep. Redecode a past night to restage.",
    ],
  },
  {
    version: "1.128.1",
    date: "2026-07-11",
    changes: [
      "Stopped firing the frozen Oura Cloud sync on app open when the ring's direct connection already has fresh data — the More page's ring status now shows an honest \"Ring synced\" time instead of a stale-looking Cloud sync timestamp.",
    ],
  },
  {
    version: "1.128.0",
    date: "2026-07-11",
    changes: [
      "The ring now automatically switches to accurate live step counting when it detects you walking (while the app is open), instead of only ever using the rough estimate — corrects your step count in real time without needing to manually run the tester.",
    ],
  },
  {
    version: "1.127.0",
    date: "2026-07-11",
    changes: [
      "The ring's live step counter (accessed from the admin Oura BLE tester) can now save its accurate count for a walk, which corrects that day's step total immediately instead of only ever using the rough estimate.",
    ],
  },
  {
    version: "1.126.0",
    date: "2026-07-10",
    changes: [
      "Sleep stages read REM as connected cycles now, not scattered minutes. The stager decides REM and light sleep across a whole bout at once instead of one 5-minute block at a time, so a brief dip in the middle of a REM cycle stays REM — closer to how real sleep flows. Deep sleep is unchanged. Redecode a past night (Oura BLE tester) to restage your history.",
    ],
  },
  {
    version: "1.125.0",
    date: "2026-07-10",
    changes: [
      "Steps are back — estimated directly from the ring over Bluetooth. The ring's motion data now drives a daily step estimate (calibrated against counted walks), so step tiles fill again for the first time since the ring left the Oura cloud. It's an estimate: steady walking counts reliably, very slow ambling can under-count, and desk activity never counts as steps.",
      "New in the Oura BLE tester: a live step test that streams the ring's realtime accelerometer and counts steps as you walk — the trial run for a future, more accurate step counter.",
    ],
  },
  {
    version: "1.124.10",
    date: "2026-07-10",
    changes: [
      "Fixed the ring's \"Time Worn\" stat and trend overstating how long you'd worn it today (it was comparing against a full 24 hours instead of the time that had actually passed).",
      "The ring battery on Body/Health, More, and the status chip now shows \"Not live\" instead of a stale-looking percentage, since the Oura Cloud stopped receiving updates after switching to direct ring connection.",
    ],
  },
  {
    version: "1.124.9",
    date: "2026-07-10",
    changes: [
      "Fixed the app sometimes yanking you back to Home mid-navigation right after opening it — this happened if you tapped away from Home before a background sign-in check finished.",
      "Non-admin visits to the admin screen now bounce back to Home instantly instead of a brief pause first.",
    ],
  },
  {
    version: "1.124.8",
    date: "2026-07-10",
    changes: [
      "Fixed the Home AI daily/weekly update cards being able to push the whole page sideways and enable horizontal scrolling when the update contained a very long word or an equation.",
    ],
  },
  {
    version: "1.124.7",
    date: "2026-07-10",
    changes: [
      "Fixed a bug where deleting a workout on one device could make it silently reappear later after syncing — deletes now propagate properly instead of only removing the workout from where you deleted it.",
      "Fixed logging a brand-new food item while offline sometimes failing to save at all.",
    ],
  },
  {
    version: "1.124.6",
    date: "2026-07-10",
    changes: [
      "Fixed completed exercises briefly showing as unmarked when reopening or finishing a workout — the green checkmarks now appear immediately instead of flashing blank for about a second.",
    ],
  },
  {
    version: "1.124.5",
    date: "2026-07-10",
    changes: [
      "The app should feel a lot snappier now — switching between the bottom-nav tabs (Home, Workout, Health, More) and edge-swiping between them used to wait on a ~0.2s slide animation before the new screen appeared; it now just paints immediately. Also removed an extra database round-trip that ran every time you opened Health.",
    ],
  },
  {
    version: "1.124.4",
    date: "2026-07-10",
    changes: [
      "REM detection now leans harder on your breathing pattern (which cleanly marks REM on your ring). Adjusting the REM threshold alone had stopped making any difference, so this uses the stronger signal instead. Tap Sync/Redecode to recompute recent nights, then check REM on the Sleep screen — if it's still short of your usual amount, the ring's own signal has hit its limit and the remaining gap needs the on-device model route.",
    ],
  },
  {
    version: "1.124.3",
    date: "2026-07-10",
    changes: [
      "Fixed a batch of small caching bugs across the app — Health/Nutrition sometimes disagreeing on your weight trend, phase labels on workout cards taking up to 6 hours to update after an editing your program, \"trained today\" occasionally showing stale from a previous day, and a few screens (day review, health timeline, profile) refreshing slower than they should after a save. No visible redesign — things should just feel a little more up-to-date everywhere.",
    ],
  },
  {
    version: "1.124.2",
    date: "2026-07-10",
    changes: [
      "Nudged REM detection up again on ring-only nights — it was still reading low (around half your usual amount). Tap Sync/Redecode to recompute recent nights, then check REM on the Sleep screen.",
    ],
  },
  {
    version: "1.124.1",
    date: "2026-07-09",
    changes: [
      "Sleep staging now reads your breathing regularity to spot REM. During REM sleep breathing gets erratic; in deep sleep it's steady — the ring's beat-to-beat timing carries that rhythm, so we use it as an extra REM signal on top of heart rate. This should lift REM detection on nights read directly from the ring, which had been reading low. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.124.0",
    date: "2026-07-09",
    changes: [
      "Your Activity score chip is back too — it now computes its own 0–100 score from your steps/active calories (relative to your own recent average) plus credit for logged gym volume, so a heavy lifting day with a low step count no longer scores as sedentary. It no longer depends on the cloud-only Oura activity score, which has been frozen since the ring switched to reading directly over Bluetooth.",
    ],
  },
  {
    version: "1.123.1",
    date: "2026-07-09",
    changes: [
      "Tuned the new Sleep score so it's harder to max out — a normal good night was scoring in the mid-90s, leaving almost no room above it. Scores now sit a bit lower across the board, with 90+ reserved for genuinely excellent nights. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.123.0",
    date: "2026-07-09",
    changes: [
      "Your home-screen Sleep and Readiness score chips are back — they'd been blank since the ring switched to reading directly over Bluetooth. Sleep now gets its own 0–100 score computed from your night (duration, efficiency, REM/deep when available, how long you took to fall asleep, restlessness and sleep timing), and Readiness falls back to the app's own recovery score when there's no cloud score. Each chip now lights up on its own as its data becomes available, instead of the whole row waiting for everything.",
    ],
  },
  {
    version: "1.122.20",
    date: "2026-07-09",
    changes: [
      "Another small nudge to REM sleep detection on ring-only nights — it's been climbing steadily toward your usual range with each pass and this continues that trend. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.122.19",
    date: "2026-07-09",
    changes: [
      "Fixed sleep nights showing a time range that didn't add up to the total minutes shown below it (e.g. a night looked like it was missing 10-15 minutes). The displayed sleep window now always matches the stage breakdown and the sleep-stages chart. Also nudged REM detection up again — it was still reading a bit low on ring-only nights. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.122.18",
    date: "2026-07-09",
    changes: [
      "Brief movement during the night (a single 5-minute stir) no longer gets subtracted from your total sleep time — it's now counted as sleep with a restless period noted, matching how it's actually experienced. A sustained awakening (10+ minutes of movement) still counts as real awake time. Also improved REM detection — REM sleep was being under-counted on nights read directly from the ring; the detection now better matches how your night actually played out. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.122.17",
    date: "2026-07-09",
    changes: [
      "Fixed some nights showing a very long time to fall asleep (e.g. 105 minutes / a post-midnight sleep start) when you actually fell asleep much earlier. The sleep detection used to treat an elevated heart rate as \"still awake\" even if you were lying completely still — but early-night sleep can run at a higher heart rate. It now counts a still stretch (no movement recorded) as sleep even if your heart rate is up, so onset latency and sleep start reflect when you really fell asleep. Genuinely restless time before sleep (with movement) still counts as onset latency. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.122.16",
    date: "2026-07-09",
    changes: [
      "Pull down to refresh on any screen now also forces an immediate sync of your ring's latest recorded data (heart rate, sleep, temperature, SpO₂), instead of waiting for the automatic hourly background sync.",
    ],
  },
  {
    version: "1.122.15",
    date: "2026-07-09",
    changes: [
      "Live heart rate now saves ring battery by only actively measuring during your rest between sets — when your hand is still and the reading is good. During a set it coasts on your most-recent reading (a heart-rate reading mid-set is unreliable anyway since you're moving), then springs back to live the moment you rest. You can still tap Measure any time to force a fresh reading.",
    ],
  },
  {
    version: "1.122.14",
    date: "2026-07-09",
    changes: [
      "Sleep times now show when you actually fell asleep and woke up, not when you got into bed. The time range on each night (and the summary card) is the real sleep window, and the metric that used to show a 'fell asleep' clock time now just shows the sleep latency (how long it took to drop off). Times are read from the sleep stages, so they line up with the hypnogram.",
    ],
  },
  {
    version: "1.122.13",
    date: "2026-07-09",
    changes: [
      "Live heart rate during a workout is now confirmed working and got a cleaner card, plus a Measure button you can tap to grab a fresh reading on demand (hold your ring hand still for a few seconds — the ring's sensor needs stillness). It also refreshes a bit more often now. Best used during rest between sets to watch your heart rate recover.",
    ],
  },
  {
    version: "1.122.12",
    date: "2026-07-09",
    changes: [
      "Fixed sleep nights showing wrong bedtimes and wake times (e.g. a 7:40pm bedtime or a 2:59pm wake-up). A short evening rest or afternoon nap the ring recorded as its own session was being merged into that night, dragging the start earlier or the end later. Each night now only includes its actual continuous sleep period; separate naps no longer distort it. No re-sync needed — this corrects the display immediately.",
    ],
  },
  {
    version: "1.122.11",
    date: "2026-07-09",
    changes: [
      "Live HR now tries to get a truly-live reading during a workout by actively asking the ring to take an on-demand heart-rate measurement (the same thing the official Oura app's \"Measure now\" does), re-triggered every 15 seconds. For the best reading, stay relatively still between sets — the ring's optical sensor needs a few seconds without motion. Requires the new app build; if the live burst doesn't come through it falls back to the most-recent recorded value.",
    ],
  },
  {
    version: "1.122.10",
    date: "2026-07-09",
    changes: [
      "Live HR during a workout now works by reading your ring's most-recently-recorded heart rate (refreshed about every 15 seconds), since the ring won't stream a truly-live beat over Bluetooth. So the number is near-live — a few seconds behind rather than instant — which is still enough to watch your heart rate recover between sets. Shows a dash if the ring hasn't recorded a recent beat.",
    ],
  },
  {
    version: "1.122.9",
    date: "2026-07-09",
    changes: [
      "Improved REM sleep detection. The stager now reads how spread-out your heartbeats are within each 5-minute block — REM comes with irregular, surging heart rate that a simple 5-minute average hides, so more genuine REM is now picked up instead of being called Light. Deep and Light are unchanged where the beat pattern is steady. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.122.8",
    date: "2026-07-09",
    changes: [
      "The sleep detail view now shows when you actually fell asleep and how long it took, right next to your average heart rate — so you can see the onset latency directly instead of only the small badge on the sleep card.",
    ],
  },
  {
    version: "1.122.7",
    date: "2026-07-09",
    changes: [
      "Sleep onset (how long it took you to fall asleep) is now worked out from your heart rate settling for the night, instead of being counted from the moment the ring thought you were in bed. Time spent lying awake before your heart rate drops is now shown as onset latency rather than sleep, so total sleep time and efficiency better match when you actually fell asleep. The latency is now pinpointed to the exact heart-rate reading where you settled — down to the second — rather than rounded to the nearest 5 minutes. Tap Sync/Redecode to recompute past nights.",
    ],
  },
  {
    version: "1.122.6",
    date: "2026-07-09",
    changes: [
      "Completes the previous sleep-duration fix: re-rolling a night now clears the old split-chunk rows before writing the merged one, so nights that were stuck showing an inflated total (e.g. 15h) actually correct on Sync/Redecode instead of staying doubled.",
    ],
  },
  {
    version: "1.122.5",
    date: "2026-07-09",
    changes: [
      "Fixed some nights showing an impossible total sleep time (e.g. 15h). When the ring recorded a night in more than one chunk (a long wake, or lying still in the evening), the chunks were being added together. Those chunks are now merged into one night, so durations are realistic. Tap Sync/Redecode to correct affected nights.",
    ],
  },
  {
    version: "1.122.4",
    date: "2026-07-09",
    changes: [
      "Live HR during a workout now asks the ring to stream more aggressively (turns on the exercise-HR trace and a faster HR mode, not just the standard live mode) to try to fix the readout showing a dash. This needs the new app build to take effect, and it's still experimental — if it doesn't stream, the diagnostics view will say so and we'll switch to showing your most-recent recorded heart rate instead.",
    ],
  },
  {
    version: "1.122.3",
    date: "2026-07-09",
    changes: [
      "Sharpened sleep-stage detection using more of the signals real sleep research relies on: how steady your heart rate is (steady ⇒ deep, fluctuating ⇒ REM), your skin temperature (warmer ⇒ deep), and the time of night (deep is weighted earlier, REM later). Heart rate and HRV still lead; these refine the Deep-vs-REM call. Tap Sync/Redecode to re-roll recent nights.",
    ],
  },
  {
    version: "1.122.2",
    date: "2026-07-09",
    changes: [
      "Fixed sleep stages collapsing to almost all Light with little/no REM. The Deep/REM/Light split is now derived from each night's own heart-rate and HRV patterns — Deep when your heart rate is low and HRV high, REM when heart rate rises and HRV drops — so the mix reflects that night's real data and varies naturally night to night (a night with little deep genuinely shows little deep, not a padded average). Sparse HRV gaps are filled from nearby readings so nights no longer wash out to all Light. Tap Sync/Redecode to re-roll recent nights. (Sleep start/end time accuracy is a separate follow-up.)",
    ],
  },
  {
    version: "1.122.1",
    date: "2026-07-09",
    changes: [
      "Added a diagnostics view to the workout Live HR card (tap the small activity icon next to \"Live HR\") to help track down why heart rate isn't showing. It reports whether any data is reaching the app from the ring, which kinds of frames arrive, whether they decode to a heart rate, and lets you copy the raw frames — so the \"—\" case can be pinned to either the ring not streaming or a decoding problem.",
    ],
  },
  {
    version: "1.122.0",
    date: "2026-07-09",
    changes: [
      "Sleep stages are back — the hypnogram (Deep/Light/REM/Awake), stage durations, efficiency, sleep latency and awakenings are now computed on-device from the ring's movement, heart rate, HRV and temperature, since the ring no longer sends stages to the cloud. This is our own estimate (not Oura's algorithm) so it won't match exactly, but it fills in the full sleep picture. Tap Sync/Redecode to backfill recent nights.",
    ],
  },
  {
    version: "1.121.2",
    date: "2026-07-09",
    changes: [
      "Fixed wrong sleep end times (some showing afternoon/evening) and the occasional duplicate night. The ring's short bedtime fragments were being treated as whole sleep windows; sleep is now detected from the full night's sleep signals, so start and end times are accurate and each night appears once (tap Sync/Redecode to correct past nights).",
    ],
  },
  {
    version: "1.121.1",
    date: "2026-07-09",
    changes: [
      "Fixed last night's HRV and resting heart rate sometimes showing blank on the Health screen. When the ring hadn't yet finalised its own bedtime for a just-finished night, that night was skipped — now sleep is detected from the ring's sleep signals too, so HRV and resting heart rate fill in for every night (tap Sync/Redecode to backfill).",
    ],
  },
  {
    version: "1.121.0",
    date: "2026-07-08",
    changes: [
      "Redesigned the sleep hypnogram into a cleaner banded ribbon — each stage (Awake, REM, Light, Deep) sits in its own lane with connected transitions, so a night's sleep architecture reads at a glance. Prepared the ring's own sleep-stage data to feed it directly once the ring's overnight stage events are captured.",
    ],
  },
  {
    version: "1.120.6",
    date: "2026-07-08",
    changes: [
      "Added a live heart-rate readout on the rest and exercise-summary screens during a workout, so you can watch your heart rate recover between sets. It reads directly from your ring; if the ring isn't streaming it simply shows a dash.",
    ],
  },
  {
    version: "1.120.5",
    date: "2026-07-08",
    changes: [
      "The workout HR chart on the done screen now shades your working sets, so you can see heart rate climb during each set and recover in the rest between them. It reads the heart rate captured directly from the ring during the session and loads without waiting on a cloud sync.",
    ],
  },
  {
    version: "1.120.4",
    date: "2026-07-08",
    changes: [
      "Fixed the ring's sleep data failing to save after a sync. Each ring sleep window is now updated in place, so a re-sync no longer collides with the previously-stored copy of the same night — sleep, and the metrics derived from it, save reliably.",
    ],
  },
  {
    version: "1.120.3",
    date: "2026-07-08",
    changes: [
      "Made the ring's health-data processing resilient: heart-rate, HRV, SpO₂, sleep and wear-time are now written independently, so if one step hits an error the others still save (previously a single failing step could silently leave a whole day's SpO₂ blank). The admin Redecode tool now also reports exactly which step failed.",
    ],
  },
  {
    version: "1.120.2",
    date: "2026-07-08",
    changes: [
      "Fixed the ring's SpO₂ not showing for a day when a night's readings straddled midnight. SpO₂ is now recorded against each reading's own date, so the day holding most of the night (which was previously left blank) fills correctly.",
    ],
  },
  {
    version: "1.120.1",
    date: "2026-07-08",
    changes: [
      "Fixed the admin Oura BLE \"Redecode\" failing with a 500 on a large history. The timestamp-repair step is now done in bounded batches so it can't exceed the database statement timeout, and the endpoint reports the real reason if any step fails instead of a blank error.",
    ],
  },
  {
    version: "1.120.0",
    date: "2026-07-08",
    changes: [
      "SpO₂ now fills from the ring over Bluetooth. The Ring 5 sends raw optical values rather than a computed percentage, so the app now converts them with Oura's own calibration formula — the Health SpO₂ card shows a nightly estimate again.",
      "The \"Heart rate · today\" chart is back. Heart-rate samples recorded by the ring (sleep beats and daytime always-on readings) are rolled into a 5-minute series that feeds the Home and Health heart-rate charts.",
      "Heart rate during workouts is stored at 15-second resolution (5-minute bins elsewhere), so workout sessions can be charted through sets and rests once enough in-gym data accumulates.",
      "Ring wear time is back. Days are scored by how much of the day the ring recorded on-finger signals, so the Health wear-time trend and low-wear confidence warnings work again without the Oura cloud.",
      "The HRV card now correctly says rMSSD (the measure the ring reports) instead of SDNN.",
    ],
  },
  {
    version: "1.119.5",
    date: "2026-07-08",
    changes: [
      "Fixed the Oura ring resting heart rate reading far too low (e.g. 30 bpm). A single long gap between beats decodes to an artificially low rate; resting HR is now the lowest 5-minute average across the night (matching how Oura computes it) rather than the single lowest beat, and implausible values are filtered out. Ring sleep sessions also now show a sleep duration.",
    ],
  },
  {
    version: "1.119.4",
    date: "2026-07-08",
    changes: [
      "Oura ring sleep data now reaches the Health screens. The ring doesn't broadcast a \"bedtime\" marker over Bluetooth (Oura works that out in its cloud), so the app now detects your sleep window from the ring's own sleep-tracking signal — last night's HRV and resting heart rate now show up on the Health tab.",
      "Admin: tidied the Tools tab — the Oura BLE console is now up top, and the one-off \"fix lbs logged as kg\" utility moved into a collapsible \"Additional tools\" section.",
    ],
  },
  {
    version: "1.119.3",
    date: "2026-07-08",
    changes: [
      "Fixed overnight Oura ring syncs failing to save heart-rate / HRV / SpO₂ / sleep data. A debug event carrying an embedded zero byte was rejected by the database and stalled every upload after it, so the ring's data never landed. Those events are now cleaned before storage, and the decoder can never again jam the sync — ring data lands reliably.",
    ],
  },
  {
    version: "1.119.2",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE reliability: the ring sync service now restarts automatically after a phone reboot or app update, and the tester offers a one-tap prompt to exempt the app from battery optimization so Android/Samsung doesn't kill background syncing. Ring data frames are also batched across the native bridge (one crossing per ~100 events instead of one each) for smoother, lower-overhead drains.",
    ],
  },
  {
    version: "1.119.1",
    date: "2026-07-07",
    changes: [
      "Fixed a bug where an overnight Oura ring sync could fail to save any data — the rollup that turns raw ring samples into sleep and heart-rate metrics choked on a full night's worth of samples, which stalled the whole upload. Ring data now lands reliably, and a failed rollup can never block the raw data from being stored.",
      "Fixed the weather forecast not loading (a Content-Security-Policy setting was blocking the weather service).",
      "Oura ring tester (admin) now shows exactly what's being pulled off the ring: per-event decoded fields, HRV and SpO₂ readings, undecoded event types highlighted for follow-up, and the current sync cursor.",
    ],
  },
  {
    version: "1.119.0",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE: syncing is now fully hands-off. The ring's history drains automatically on every connect and hourly while connected, and the app's native service uploads the data to the server itself — no need to keep the tester screen open. The sync position still only advances once the server confirms storage, so nothing is lost if an upload fails; drains also run at high Bluetooth priority for faster syncs. Kotlin code is now compile- and test-gated in CI, which also publishes a ready-to-install debug APK for every change.",
    ],
  },
  {
    version: "1.118.0",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE now turns raw ring data into real health metrics: sleep sessions (bedtime window, sleep stages, efficiency, sleep heart rate and HRV) and daily HRV / resting-HR / SpO₂ now flow from the ring straight into the Health screens — no Oura Cloud needed. Also decodes 25+ more ring event types (activity/MET, motion, sleep summaries, bedtime), timestamps every sample against a persisted ring-clock anchor, and adds a Redecode button that retroactively re-processes stored data whenever decoding improves.",
    ],
  },
  {
    version: "1.117.5",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE: fixed a data-loss bug where the ring's sync position could move past events that weren't actually saved to the server — the position now only advances after the server confirms storage, and failed uploads retry instead of being dropped. Added a \"Full re-sync\" that re-pulls the ring's entire buffer (safe to repeat) to recover anything previously missed.",
    ],
  },
  {
    version: "1.117.4",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE: ring samples are now anchored to real wall-clock time (instead of the moment they were synced), so a backfilled night lands on its actual timestamps. The tester now shows each metric's real measured time, its sampling cadence, and the data's time span.",
    ],
  },
  {
    version: "1.117.3",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE: the ring connection now starts automatically when the app opens — no need to tap Start. The tester's frame list also labels the last few connection acknowledgements (time sync, notifications) by name.",
    ],
  },
  {
    version: "1.117.2",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE: the ring's measurement features (heart rate, SpO₂) are now switched on automatically when the ring connects, so it actually records biometrics to its history instead of only system events. History now drains in full on each sync instead of one small batch at a time.",
    ],
  },
  {
    version: "1.117.1",
    date: "2026-07-07",
    changes: [
      "Reliability: a transient database hiccup during a deploy could leave the whole app showing \"Something went wrong\" until a manual restart — the startup now recovers on its own.",
    ],
  },
  {
    version: "1.117.0",
    date: "2026-07-07",
    changes: [
      "Oura direct-BLE: the ring's history is now decoded (heart rate, temperature, HRV, SpO₂, battery) and recorded to the database. The admin BLE screen was rebuilt into a cleaner tester showing the latest recorded values and a one-tap Sync.",
    ],
  },
  {
    version: "1.116.4",
    date: "2026-07-07",
    changes: [
      "Oura BLE debug screen: reverted the ring connection back to a direct connect after on-device testing showed it was less reliable than before.",
    ],
  },
  {
    version: "1.116.3",
    date: "2026-07-07",
    changes: [
      "Oura BLE debug screen: retry the ring connection a couple of times before giving up and re-scanning, and fixed the first retry delay firing later than intended.",
    ],
  },
  {
    version: "1.116.2",
    date: "2026-07-07",
    changes: [
      "Oura BLE debug screen: fixed a race that could cause two overlapping connection attempts to the ring, added a settle delay to reduce generic Android BLE connect failures, guarded the Start service button against double-taps, and switched the log to your local time instead of raw timestamps.",
    ],
  },
  {
    version: "1.116.1",
    date: "2026-07-07",
    changes: [
      "Fixed the Oura BLE debug screen (admin) hanging forever on \"Checking native plugin\" instead of loading.",
    ],
  },
  {
    version: "1.116.0",
    date: "2026-07-07",
    changes: [
      "Direct-BLE Oura debug screen (admin): connect to the ring natively over Bluetooth, see live data and connection metrics. Requires an APK rebuild; web shows an unavailable state.",
    ],
  },
  {
    version: "1.115.5",
    date: "2026-07-06",
    changes: [
      "Admin time audit: added a monitoring baseline date, so sessions from before your timing habits were dialed in can be excluded from both the audit review and planning averages.",
    ],
  },
  {
    version: "1.115.4",
    date: "2026-07-06",
    changes: [
      "Admin time audit: an implausibly long warmup (over 15 min) is now capped in the reported bucket, with the excess rolled into unaccounted time and flagged for review alongside runaway sets/rests and excessive unaccounted time.",
    ],
  },
  {
    version: "1.115.3",
    date: "2026-07-06",
    changes: [
      "Fixed: activity logs saved while offline could silently lose their calories-burned value once synced.",
      "Fixed food-log edits and deletes sometimes not appearing on other devices after syncing.",
    ],
  },
  {
    version: "1.115.2",
    date: "2026-07-06",
    changes: [
      "Fixed: resolving an injury (or any partial edit) could silently erase its notes. Editing an injury's resolved date now leaves the rest of the entry untouched.",
      "Fixed offline supplement/injury edits and logs sometimes not appearing on other devices after syncing.",
    ],
  },
  {
    version: "1.115.1",
    date: "2026-07-06",
    changes: [
      "The AI chat can now answer six new kinds of questions: sleep/HRV vs. training performance correlation, best day of the week to train, which exercises have plateaued, progress vs. last month/quarter, overtraining risk (ACWR), and all-time milestones.",
    ],
  },
  {
    version: "1.114.2",
    date: "2026-07-06",
    changes: [
      "The recommended-workout card's \"last time\" average reps now rounds down instead of to nearest, so it never shows a rep count higher than all but one of your sets actually hit.",
    ],
  },
  {
    version: "1.114.1",
    date: "2026-07-06",
    changes: [
      "Fixed the weekly AI recap to cover this week so far (Monday through today) instead of the prior fully-elapsed week.",
    ],
  },
  {
    version: "1.114.0",
    date: "2026-07-06",
    changes: [
      "Added an \"End of Day Review\" on Home — a short AI check-in on today's training, nutrition, and morning check-in, plus a training-load comparison chart when you've logged a session.",
    ],
  },
  {
    version: "1.113.1",
    date: "2026-07-06",
    changes: [
      "Added a Day & Week Review Reminders toggle (Profile → Preferences) — an evening wind-down nudge before bed and a weekly recap reminder on Sunday (Android app only).",
    ],
  },
  {
    version: "1.113.0",
    date: "2026-07-06",
    changes: [
      "Added an AI-generated \"Session recap\" to the workout Done screen — tap Generate for a short review of the session you just finished.",
      "Rest days now show recovery guidance (readiness-based suggestions) instead of just a blank day.",
      "Added body measurement tracking (waist, chest, arm, thigh, hip, neck) as optional widgets on the Overview screen.",
    ],
  },
  {
    version: "1.112.0",
    date: "2026-07-06",
    changes: [
      "The AI chat now proactively connects training, sleep/HRV/readiness, and nutrition instead of only answering from whichever single domain the question named.",
      "Replaced the always-visible Weekly AI Summary card (on Health, Stats, and Overview) with a one-time \"Your week in review\" notification on Home, recapping the week that just ended — it shows once and stays dismissed.",
    ],
  },
  {
    version: "1.111.0",
    date: "2026-07-06",
    changes: [
      "Added \"Export my data\" to Profile — download your full training, nutrition, and health history as a single file.",
    ],
  },
  {
    version: "1.110.0",
    date: "2026-07-06",
    changes: [
      "Added an Update Available banner to the Profile screen (Android app only) that links straight to the latest APK.",
      "Push notifications now have a \"Send test\" button to confirm they're working.",
      "New admin tool: an Errors tab shows recent client and server errors — previously invisible, now surfaced instead of silently failing.",
    ],
  },
  {
    version: "1.109.0",
    date: "2026-07-06",
    changes: [
      "The sleep detail view now shows average heart rate, restless periods, and a bedtime tip from your Oura Ring.",
      "Added a \"last synced\" indicator to the Oura Ring connection settings.",
    ],
  },
  {
    version: "1.108.0",
    date: "2026-07-05",
    changes: [
      "Stats, Overview, Workout Select, and \"Why this session?\" now each get their own themed wallpaper instead of sharing the sky/weather background.",
    ],
  },
  {
    version: "1.107.1",
    date: "2026-07-05",
    changes: [
      "Renamed the daily energy/soreness check-in to \"Exercise Readiness\" to make it clearer what it's for.",
    ],
  },
  {
    version: "1.107.0",
    date: "2026-07-05",
    changes: [
      "The Health calendar day-detail now lets you edit or delete an entire logged session, not just individual exercises.",
    ],
  },
  {
    version: "1.106.2",
    date: "2026-07-05",
    changes: [
      "\"Why this?\" now opens instantly with no double-computed recommendation, clears the status bar and gesture bar properly, and leads with the plain-language AI explanation before the raw signals.",
    ],
  },
  {
    version: "1.106.1",
    date: "2026-07-05",
    changes: [
      "Fixed the AI chat assistant claiming a completed workout hadn't happened yet — the weekly schedule it reads collapsed to a single day every Sunday (a locale bug), and it now marks completed days explicitly so the assistant can't mistake logged data for a still-pending session.",
      "Redesigned the sleep hypnogram to match Oura's look — a single continuous stepped ribbon instead of disconnected rounded bars, with an Oura-style blue colour ramp instead of the old grey/purple mix.",
    ],
  },
  {
    version: "1.106.0",
    date: "2026-07-05",
    changes: [
      "Opening the app now triggers a throttled background Oura sync (once per 6 hours), so your morning sleep and readiness data appears without visiting Health or tapping refresh.",
    ],
  },
  {
    version: "1.105.11",
    date: "2026-07-05",
    changes: [
      "UI polish batch: fixed oversized tap targets on the strength trend pager and profile avatar badge, removed a skeleton flash on the Health training tab, matched the morning check-in dial colours/labels to the evening version, made the workout calendar's per-exercise summary a single compact line, reordered the Log Food tiles and made Saved Meals its own tile, and added a \"Recommended today\" badge to the workout carousel.",
    ],
  },
  {
    version: "1.105.10",
    date: "2026-07-05",
    changes: [
      "Fixed the Home/Health Heart-Rate Today chart missing its overnight sleep band; it now draws from the actual sleep-session time.",
    ],
  },
  {
    version: "1.105.9",
    date: "2026-07-05",
    changes: [
      "Fixed a past workout's heart-rate recovery data showing \"No HR data\" forever on the Health calendar — expanding a session now re-checks Oura instead of relying on a sync that may have been missed.",
    ],
  },
  {
    version: "1.105.8",
    date: "2026-07-05",
    changes: [
      "Fixed logging a saved meal showing the calorie/macro total for a moment then reverting to zero — the total now updates instantly and stays correct.",
    ],
  },
  {
    version: "1.105.7",
    date: "2026-07-05",
    changes: [
      "Fixed the warm-up ramp-up timer shown before every set: barbell lifts now get the full 4:00 (was showing the same 2:00 as a machine exercise), and minimizing the app mid-ramp no longer resets its progress.",
    ],
  },
  {
    version: "1.105.6",
    date: "2026-07-05",
    changes: [
      "Hardened a handful of API routes: closed an Oura-account enumeration gap, validated Health Connect data before saving it, and gave a few write routes proper rate limits and error handling.",
    ],
  },
  {
    version: "1.105.5",
    date: "2026-07-05",
    changes: [
      "Smoother workout screen: weight-dial and RPE taps no longer stutter, the count-up numbers on the done screen animate correctly, and killing the app mid-activity no longer restores a stale done screen.",
    ],
  },
  {
    version: "1.105.4",
    date: "2026-07-05",
    changes: [
      "Fixed a few workout-timing data-quality issues: superset transition times no longer go negative, the AI's set-duration signal ignores tracking-error outliers, and a stranded-offline workout no longer loses its per-set timing on rebuild.",
    ],
  },
  {
    version: "1.105.3",
    date: "2026-07-05",
    changes: [
      "Fixed superset rest timing recording as 0 for every switched-back set, and editing a logged exercise's weight/reps no longer wipes its recorded timing or RPE.",
    ],
  },
  {
    version: "1.105.2",
    date: "2026-07-05",
    changes: [
      "AI-prescribed workouts no longer drop or duplicate exercises silently, and a dropped exercise that needed a deload now still gets it.",
    ],
  },
  {
    version: "1.105.1",
    date: "2026-07-05",
    changes: [
      "Fixed bodyweight exercises (like pull-ups) the AI drops from its prescription showing raw, un-rescaled rep targets instead of a rep-max-based target.",
    ],
  },
  {
    version: "1.105.0",
    date: "2026-07-05",
    changes: [
      "Light mode: fixed muddy dark skies behind the Readiness/Activity health heroes and a broken sleep-moon icon, invisible heart-rate chart lines, unreadable end-of-day wellness scales, and a dark-screen flash when opening health detail pages.",
      "Unified the protein/carbs/fat colour scheme across Home, Nutrition, and meal cards so the same macro is always the same colour.",
      "Replaced emoji icons with consistent Lucide icons across chat, health, nutrition, and workout screens.",
      "Fixed the sleep-stage hypnogram's hour labels sometimes misaligning with the sleep-stage ribbon on merged Samsung Health + Oura nights.",
    ],
  },
  {
    version: "1.104.10",
    date: "2026-07-05",
    changes: [
      "Fixed the AI chat button being hidden under the bottom navigation bar, the chat history drawer's header/footer touching the status and gesture bars, and several bottom sheets having doubled or missing bottom padding on-device.",
    ],
  },
  {
    version: "1.104.9",
    date: "2026-07-05",
    changes: [
      "Fixed your training load (ACWR) sometimes showing a different number and status on Home than on the Health screen for the same day — they now always agree.",
    ],
  },
  {
    version: "1.104.8",
    date: "2026-07-05",
    changes: [
      "Fixed AI-prescribed rep targets for bodyweight exercises (like pull-ups) being silently overwritten and flattened to 1 rep per set on AI Dynamic Periodization programs.",
    ],
  },
  {
    version: "1.104.7",
    date: "2026-07-05",
    changes: [
      "Fixed a bug where the rest time between exercises was never recorded — it was silently dropped for every exercise after the first, on every workout, since the feature first shipped.",
    ],
  },
  {
    version: "1.104.6",
    date: "2026-07-05",
    changes: [
      "AI workout recommendations now weigh each muscle group's own weekly training target — not just whether an exercise is a warm-up or an accessory — when trimming sets to fit your session's time budget. Also fixed an occasional error that could stop a recommendation from generating at all.",
    ],
  },
  {
    version: "1.104.5",
    date: "2026-07-05",
    changes: [
      "Deleting a food log, activity, supplement, or injury now actually propagates to your other devices instead of the deleted item silently reappearing.",
    ],
  },
  {
    version: "1.104.4",
    date: "2026-07-05",
    changes: [
      "A run or ride recorded on-device now keeps its full route, pace, and elevation data instead of losing it on save; logging a single body metric (like weight) no longer wipes out the rest of the day's numbers; logging a saved meal now shows up immediately even if its ingredients weren't already cached.",
    ],
  },
  {
    version: "1.104.3",
    date: "2026-07-05",
    changes: [
      "Finishing a workout with no signal now still marks it complete on your phone and finishes syncing once you're back online, instead of silently never completing.",
    ],
  },
  {
    version: "1.104.2",
    date: "2026-07-05",
    changes: [
      "Hardened offline sync: a stuck or rejected sync request no longer blocks every other queued change behind it, and cross-device syncing no longer has any path for one account's data to be written into another's.",
    ],
  },
  {
    version: "1.104.1",
    date: "2026-07-04",
    changes: [
      "Fixed a crash opening Stats right after Health, and several places where the app could briefly show yesterday's numbers or a stale exercise list after editing a program.",
    ],
  },
  {
    version: "1.104.0",
    date: "2026-07-04",
    changes: [
      "Supersets and circuits: exercises linked in your program builder now alternate during a workout — log a set of one, then the other, with rest and per-exercise summaries handled automatically.",
    ],
  },
  {
    version: "1.103.0",
    date: "2026-07-04",
    changes: [
      "Added \"Your Year\" — a shareable year-in-review under More → Your Year showing your total volume, session streak, most-trained exercise, personal records, and a monthly training bar chart.",
    ],
  },
  {
    version: "1.102.0",
    date: "2026-07-04",
    changes: [
      "When an active injury affects the exercise you're on, you can now tap Swap to pick a safe alternative that avoids the injured muscle, or skip the exercise for today — the change only applies to this workout, your program stays the same.",
    ],
  },
  {
    version: "1.101.0",
    date: "2026-07-04",
    changes: [
      "Nutrition now offers a weekly calorie nudge when your weight trend diverges from your fitness goal — apply it in one tap or dismiss it for the week.",
    ],
  },
  {
    version: "1.100.0",
    date: "2026-07-04",
    changes: [
      "Training Load now shows monotony and strain (Foster) alongside ACWR, flagging monotonous training patterns ACWR alone can miss.",
      "Nutrition now shows a Logging Adherence card — the share of the last 7/28 days you logged every required meal.",
      "Sleep now shows a Sleep Consistency card — how much your bedtime varies night to night, cross-checked against Oura's own sleep regularity score.",
      "Weekly muscle sets can now be tapped to reveal a 6-week tonnage trend sparkline for that muscle.",
      "The Body Weight card now shows whether your rate of change is on track, too slow, too fast, or trending the wrong way relative to your goal.",
    ],
  },
  {
    version: "1.99.0",
    date: "2026-07-04",
    changes: [
      "Health, Nutrition, and More/Profile now have their own themed background scene (dark and light variants) instead of sharing Home's time-of-day sky — enable it under More → Dynamic background.",
    ],
  },
  {
    version: "1.98.2",
    date: "2026-07-04",
    changes: [
      "\"Log Activity\" on the workout screen is now easier to spot with a filled button and icon.",
      "Opening a workout session no longer shows a loading spinner when its data was already prefetched.",
      "Exercise cards on the pre-workout screen now show a single representative set and estimated 1RM instead of a long list of every set.",
      "Removed the underline under the Home greeting header.",
    ],
  },
  {
    version: "1.98.1",
    date: "2026-07-04",
    changes: [
      "Content on Home, Health, Nutrition, More, Workout, and Admin no longer butts flush against the bottom navigation bar — added breathing room to clear the nav (and the elevated Workout button) on every screen.",
    ],
  },
  {
    version: "1.98.0",
    date: "2026-07-04",
    changes: [
      "Redesigned the sleep-stage hypnogram as a filled, connected ribbon (matching Oura's style) instead of thin floating bars, and added a large version to the Sleep detail page showing your latest night's stages, estimated sleep cycles, and per-stage totals.",
    ],
  },
  {
    version: "1.97.1",
    date: "2026-07-04",
    changes: [
      "Fixed the Home heart-rate chart shading phantom \"Sleep\" bands over daytime stillness — only real overnight sleep is shaded now.",
      "The rest/deload offer now appears after 3 straight training days instead of 4.",
      "Fixed Session Duration and Wear Time trend charts rendering as solid black.",
      "Sped up the Training Load (ACWR) card by trimming an unused database query.",
    ],
  },
  {
    version: "1.97.0",
    date: "2026-07-04",
    changes: [
      "Fixed the Readiness, Sleep, Activity, and Heart Rate detail pages showing illegible white text in light mode — they now use a properly lightened palette and dark text when your device is in light mode.",
    ],
  },
  {
    version: "1.96.0",
    date: "2026-07-04",
    changes: [
      "Added Protein per kg Bodyweight, Steps, and Water trend charts to Health → Body.",
    ],
  },
  {
    version: "1.95.0",
    date: "2026-07-04",
    changes: [
      "Added an HRV vs Baseline card on Health → Body, showing how your recent recovery signal compares to your personal 28-day baseline.",
    ],
  },
  {
    version: "1.94.0",
    date: "2026-07-04",
    changes: [
      "Exercise stats now show an RPE trend chart, so you can see whether recent sets have felt harder or easier than expected.",
    ],
  },
  {
    version: "1.93.0",
    date: "2026-07-04",
    changes: [
      "Added Session Duration and Workout Density trend charts to Health → Training, tracking training efficiency over the last 14 days.",
    ],
  },
  {
    version: "1.92.0",
    date: "2026-07-04",
    changes: [
      "Readiness, HRV, and RHR now flag days where your ring wasn't worn enough hours for a confident reading, and exclude those days from baseline calculations.",
      "Added a 14-day ring wear-time trend chart to the Health screen.",
    ],
  },
  {
    version: "1.91.0",
    date: "2026-07-04",
    changes: [
      "Tapping a nav tab or a home card now smoothly transitions instead of hard-cutting.",
      "Home and Health content fades in as it loads instead of popping in.",
      "The Friends tab crossfades between Activity and Leaderboard.",
      "More numbers count up on load: readiness/sleep/activity detail scores and your weekly session/set totals.",
    ],
  },
  {
    version: "1.90.0",
    date: "2026-07-04",
    changes: [
      "Edge-swipe left or right anywhere to jump between Home, Health, Workout, Nutrition, and More.",
      "Swipe between days on the Nutrition screen and between months on the training calendar.",
      "Readiness score and workout volume now count up instead of popping in instantly.",
      "Food-log items animate in and out when added or removed.",
      "All animations now fully respect your device's \"Remove animations\" / reduced-motion setting.",
    ],
  },
  {
    version: "1.89.0",
    date: "2026-07-04",
    changes: [
      "Added haptic feedback to pull-to-sync, food logging, mood check-ins, new personal records, and bottom-nav taps.",
      "Collapsible sections (achievements, settings) now animate open/closed instead of snapping.",
      "Smoother, more reliable progress-bar and macro-ring animations on Samsung devices.",
    ],
  },
  {
    version: "1.88.9",
    date: "2026-07-04",
    changes: [
      "Faster loading on chat, nutrition, home overview, and the active workout screen — heavy chart/markdown/drag-and-drop code now only downloads when you actually open those screens.",
    ],
  },
  {
    version: "1.88.8",
    date: "2026-07-04",
    changes: [
      "Workout screen render performance — set logging, RPE, and Home cards update faster and with less jank.",
    ],
  },
  {
    version: "1.88.7",
    date: "2026-07-04",
    changes: [
      "Deploys now always land on your device automatically — the app's offline cache refreshes on every update instead of occasionally needing a manual cache-clear.",
    ],
  },
  {
    version: "1.88.6",
    date: "2026-07-04",
    changes: [
      "Bottom sheets, the workout flow, and full-screen pages now consistently clear the gesture bar and bottom nav — every screen shares one safe-area formula instead of each hand-rolling its own.",
    ],
  },
  {
    version: "1.88.5",
    date: "2026-07-04",
    changes: [
      "Home screen no longer double-fetches readiness, body battery, training load, muscle recovery, and heart-rate data on load.",
      "A dead network connection now backs off instead of retrying the sync pull on every screen you open.",
    ],
  },
  {
    version: "1.88.4",
    date: "2026-07-04",
    changes: [
      "Exercise history now shows your true last 20 logs for a lift, no longer artificially capped to the last 90 days.",
      "Several health and workout screens load faster — exercise history, muscle recovery, weekly muscle sets, strength trend, sleep/performance correlation, and a few others now respond from cache more often.",
      "The admin badge no longer makes a doomed request for non-admin accounts.",
    ],
  },
  {
    version: "1.88.3",
    date: "2026-07-04",
    changes: [
      "Logging, editing, or deleting a food entry now updates your calorie/macro tiles and weekly chart instantly — no more waiting on cache expiry to see the change.",
      "Readiness, body battery, training load, and other 'today' cards no longer briefly flash yesterday's numbers right after midnight.",
    ],
  },
  {
    version: "1.88.2",
    date: "2026-07-04",
    changes: [
      "Home now shows a completed workout instantly instead of briefly re-showing the pre-workout recommendation.",
      "The workout done screen no longer waits on a live Oura sync before showing your results — heart-rate recovery data loads on tap instead.",
      "Logging a multi-ingredient meal is faster — new food items save in parallel instead of one at a time.",
      "Saving a body metric, mood check-in, or deleting a workout entry now gives instant feedback instead of waiting on the network round-trip.",
    ],
  },
  {
    version: "1.88.1",
    date: "2026-07-04",
    changes: [
      "Home and Timeline workout cards no longer repeat the full exercise-name list — just duration, sets, and exercise count.",
      "The Activity score ring now shows a distinct colored segment for the training-boost portion of the score, alongside the existing text banner.",
      "The End of Day reminder now fires exactly 30 minutes before your estimated bedtime, computed to the minute instead of rounded to the hour.",
      "End of Day review's wellness scales are now colored, benchmarked sliders (one color per metric) instead of plain toggle buttons, on a themed night-gradient background.",
    ],
  },
  {
    version: "1.88.0",
    date: "2026-07-03",
    changes: [
      "Per-exercise deload: when your check-in reports sore muscles that affect only part of a session, just those exercises drop to deload weights — tap the amber chip to see why or lift full weights anyway. Mostly-sore sessions still get a whole-session deload offer. Deloaded sets never count toward personal records.",
    ],
  },
  {
    version: "1.87.1",
    date: "2026-07-03",
    changes: [
      "Fixed: the Health > Progress Trends card could show stale data after logging session effort, a morning check-in, or an End of Day review until the cache expired.",
      "Fixed: deleting a middle set in the progression-style editor could make the remaining sets show the wrong values.",
    ],
  },
  {
    version: "1.87.0",
    date: "2026-07-03",
    changes: [
      "Session time estimates are now equipment-aware: barbell exercises get a realistic 4-minute setup/loading allowance vs 2 minutes for machines/dumbbells/cables and 1 minute for bodyweight moves, so AI-planned and AI-generated sessions fit your time budget more accurately.",
      "The app now records when your warmup ends, separating warmup time from the first working set in session timing.",
      "New admin tool: a workout time audit showing where each session's time actually went (warmup, sets, rest, transitions) by exercise and equipment type.",
    ],
  },
  {
    version: "1.86.0",
    date: "2026-07-03",
    changes: [
      "Buttons and tap targets are bigger and easier to hit throughout the app, and low-contrast text in the workout screen is easier to read.",
      "Health, Nutrition, More and Home now share the same header layout for a more consistent look.",
      "Logging a body-weight or step count now shows an inline error and disables Save for invalid values, instead of only failing silently after tapping Save.",
      "Back buttons on Health detail pages (Sleep, Readiness, Activity, Heart Rate) now return you to wherever you came from, instead of always jumping to the Health tab.",
      "If a screen ever crashes, you'll now see a friendly retry screen instead of a blank white page.",
      "Home shows a loading skeleton instead of a blank screen on a very first app open.",
      "Fixed a gap where tapping the Workout tab's button mid-set could exit an active workout without asking to confirm.",
      "Removed an old unused workout-mockup preview page and legacy chat widget.",
    ],
  },
  {
    version: "1.85.0",
    date: "2026-07-03",
    changes: [
      "New: the sleep detail sheet now shows a true stepped hypnogram (stage-by-stage timeline) instead of a flat color strip.",
      "New: the muscle heatmap on Health > Training tints each muscle by how many sets you've logged this week toward its target.",
      "New: the strength trend card projects your 1RM 30 days out and flags a \"Plateau\" when a lift has been flat for 3+ weeks — AI training recommendations now factor this in too.",
      "Workout timer ring and picture-in-picture view now give every set beyond the third its own distinct color instead of repeating amber/green/violet.",
      "Consolidated four separate sparkline chart implementations into one shared component and unified score-color thresholds across Health detail pages — no visible change, fewer places for these to drift out of sync.",
    ],
  },
  {
    version: "1.84.0",
    date: "2026-07-03",
    changes: [
      "New: a Trends card on Health > Progress — five swipeable correlation views (recovery calibration, session effort, rest discipline, recovery vs strength, meals vs sleep) surfacing patterns from your existing workout, sleep, HRV and meal-timing data.",
    ],
  },
  {
    version: "1.83.0",
    date: "2026-07-03",
    changes: [
      "Fixed a bug where certain back/navigation actions during a workout could leave the session without ever asking to confirm — every path (including the Android back button) now shows a \"Leave workout?\" prompt before discarding anything.",
      "Barbell exercises now only let you adjust weight in 2.5kg steps (matching how plates actually load in pairs) — other equipment keeps the finer 1.25kg steps.",
      "Reopening the app mid-workout now shows a \"Continue Workout\" option that picks up exactly where you left off, instead of forcing a one-off re-log that broke the normal flow between exercises.",
      "AI training recommendations now take an active injury in today's session into account, and factor in your SpO2 trend alongside sleep and HRV.",
    ],
  },
  {
    version: "1.82.0",
    date: "2026-07-03",
    changes: [
      "New: a one-tap session effort (RPE) prompt on the workout done screen — rate how hard the session felt from 1 (easy) to 10 (max effort), captured for future rest-adherence and training-load trends.",
    ],
  },
  {
    version: "1.81.0",
    date: "2026-07-02",
    changes: [
      "Oura sync now captures caffeine/alcohol/illness tags, breathing/meditation/nap sessions, and rest-mode periods — all now visible on the Home day timeline; also fills in the breathing disturbance index from your SpO2 data.",
    ],
  },
  {
    version: "1.80.1",
    date: "2026-07-02",
    changes: [
      "Fix: passive walk/run detection now tells you when it can't see your location — most commonly because Android's location permission is set to \"only while using the app\" instead of \"all the time\", which silently blocked every background detection attempt. A new card on the Profile screen flags this and links straight to the fix.",
    ],
  },
  {
    version: "1.80.0",
    date: "2026-07-02",
    changes: [
      "New morning check-in: a quick 5-scale wellness prompt (wake mood, recovery, motivation, sleep quality, soreness) on your first app open of the day, pre-filled from your Oura readiness and sleep score, and now factored into AI-dynamic training recommendations.",
    ],
  },
  {
    version: "1.79.0",
    date: "2026-07-02",
    changes: [
      "AI upgrade: chat can now pull your real workout, recovery, nutrition and readiness data on demand and knows your Oura/sleep/check-in state; weekly summary and \"why this session\" load instantly after first generation; program/nutrition AI responses are schema-validated; interrupted AI answers now say so instead of stopping mid-sentence.",
    ],
  },
  {
    version: "1.78.0",
    date: "2026-07-02",
    changes: [
      "Security hardening: PKCE-bound mobile sign-in, durable rate limits, Oura OAuth CSRF protection, enforced CSP, stricter input validation.",
    ],
  },
  {
    version: "1.77.0",
    date: "2026-07-02",
    changes: [
      "1RM estimates are more accurate: weighted, bodyweight, and edited-set logs now share one estimator with a proper AMRAP-scaled average and a sane ceiling on very high rep counts, instead of drifting between slightly different formulas.",
      "AI-dynamic programs now compute your acute:chronic training load (ACWR) from your real weekly volume across every session type, instead of a rough count scoped to one session — fewer false 'ease off' signals early in a program.",
      "Prescription confidence is now computed the same way the app uses to decide whether to auto-apply a session, instead of trusting the AI's own self-reported number.",
      "Emergency deloads are now offered, not forced: generating a recommendation no longer silently resets your phase — it only takes effect once you accept it.",
      "Phase transitions now have upper limits at every stage (not just accumulation), so the AI can't leave you stuck in a heavy intensification or peak block indefinitely.",
      "The AI and the app's own fatigue adjustments no longer both cut your working weight for the same reason — the AI is now told to prescribe a neutral load and let auto-adjustments react to how you actually perform.",
      "Weekly volume targets per muscle group now use one consistent naming scheme app-wide (heatmap, program setup, and AI prescriptions all agree), and each muscle has a minimum/maximum weekly volume band instead of one fixed number.",
      "Muscle recovery time on the heatmap now scales with how much you trained that muscle, instead of assuming every session takes the same time to recover from.",
    ],
  },
  {
    version: "1.76.0",
    date: "2026-07-02",
    changes: [
      "Offline sync is more resilient: a single failed food/workout/mood log can no longer strand every other log from that day in the queue, retries now back off and give up after 5 attempts instead of retrying forever, and a new sync status card (More tab) shows anything that failed to sync with Retry/Discard buttons.",
      "Faster repeat visits across the app — Home, Nutrition, Health, and More screens now paint from cache instantly on a second visit instead of showing a loading spinner while they refetch.",
      "Friends feed, leaderboard, and supplements now load instantly and stay in sync after adds/removes/toggles.",
      "Avatars and exercise thumbnails render sharper and load faster (AVIF/WebP via next/image) across Profile, Friends, and the workout builder.",
      "Smoother workout screen — the per-second timer no longer causes the whole screen to redraw every second.",
    ],
  },
  {
    version: "1.75.0",
    date: "2026-07-01",
    changes: [
      "New End of Day review. The end-of-night prompt is now a proper wrap-up: your day's calories and macros, a Body Battery reading, per-meal boxes to quickly backfill anything you forgot to log, a few one-tap 1–5 check-in scales (tiredness, mental drain, movement, hydration, late/heavy meal) that open pre-filled from your data so you can just glance and save, a sore-muscle picker, and a free-text journal. It's all saved on-device first, and over time this is the data that'll teach the app what actually leaves you drained. Open it from the moon button on the Nutrition tab or the end-of-day reminder.",
    ],
  },
  {
    version: "1.74.5",
    date: "2026-07-01",
    changes: [
      "Fix: the on-device database is now self-healing if an app update ever fails partway through. Previously, if a database upgrade hit an error mid-way, the whole on-device store could be left dead — every screen that reads from it (food, activity, sleep, mood) would come up empty until the app was reinstalled. Now, if an upgrade fails, the app reopens the database as-is and repairs any missing tables or columns on the spot, so your data keeps rendering instead of vanishing.",
    ],
  },
  {
    version: "1.74.4",
    date: "2026-07-01",
    changes: [
      "Fix: logged food no longer disappears when you reload the Nutrition page. The page had started reading food only from the on-device database, so if that database hit any hiccup the list came up empty and your food looked like it vanished — even though it was saved. The page now always falls back to your saved server copy when you're online, with the on-device copy used as a fast/offline layer on top.",
    ],
  },
  {
    version: "1.74.3",
    date: "2026-07-01",
    changes: [
      "Fix: automatic walk/run detection was holding GPS on 24/7 in the background, which drained the battery fast. It now keeps GPS off until the phone's motion sensor detects you've actually started moving, runs GPS only for the walk/run, then shuts it off again when you stop. Detection is unchanged — it just costs far less battery. (Requires an Android app rebuild to take effect.)",
    ],
  },
  {
    version: "1.74.2",
    date: "2026-07-01",
    changes: [
      "Bodyweight exercises (pull-ups, dips, etc.) now progress on reps instead of your body weight. Your first session is an AMRAP to set a rep max; after that each set is prescribed as a percentage of that max, and the summary shows a \"Rep Max\" in reps rather than a body-weight-inflated 1RM. Changing your weigh-in no longer moves the number, and adding weight (weighted pull-ups / assisted dips) still counts.",
      "New live readout under the rest timer shows your running average weight × reps and projected 1RM for the session so far, colour-coded green/red against your previous 1RM — so you can see after each set whether you're on track to beat it, even by one rep.",
      "Screen headers now clear the status bar with a bit of breathing room instead of sitting flush against it.",
      "Fix: the 1RM trend charts on the exercise ready screen and the set summary no longer clip the top value label when your estimate is trending up.",
    ],
  },
  {
    version: "1.74.1",
    date: "2026-07-01",
    changes: [
      "Fix: steps from a treadmill session now count toward your daily and weekly step totals (and the steps goal). They were being recorded against the activity but left out of the day/week totals, which only counted pedometer/Health Connect steps.",
    ],
  },
  {
    version: "1.74.0",
    date: "2026-07-01",
    changes: [
      "Scanned meals now log as their components. When AI breaks a meal into ingredients (e.g. pulled beef + bao buns + potatoes + pear), each one is saved as its own entry with its own macros — so you can edit or delete any part — instead of everything collapsing into a single combined item.",
      "The end-of-night backfill now lists your meals with an AI text box under each one. Instead of a single generic chat, you describe what you had for each meal and it's logged straight to that meal (broken into components too), with a badge showing which meals still have nothing logged.",
      "Fix: logged food no longer silently disappears after changing pages or closing the app. A single malformed queued change could make the whole sync batch fail, stranding every food log queued behind it so it never reached the server — one bad change can no longer block the rest.",
      "Fix: the barcode scanner now loads instead of reporting \"unavailable\".",
      "The Log Food screen is tidier: the Recent and Saved Meals tabs are now swipeable, the redundant \"Add Food\" tab is gone (Manual Entry does the same thing), the logging options fit on screen without scrolling, and the sheet has a lifted background instead of pure black.",
    ],
  },
  {
    version: "1.73.2",
    date: "2026-07-01",
    changes: [
      "Fix: a saved activity (treadmill/walk/run) now shows up on the Training Calendar and home timeline straightaway. It was saving correctly, but the calendar and timeline kept showing their cached copy and only picked up the new activity after a delay — they now refresh the moment you save.",
    ],
  },
  {
    version: "1.73.1",
    date: "2026-07-01",
    changes: [
      "Fix: treadmill sessions no longer try to track your GPS route. A treadmill is stationary, so the phone's GPS was drifting around the neighbourhood and logging a nonsense distance and pace — it's now a clean timer with the distance you enter afterwards.",
      "Fix: a saved activity (walk/run/treadmill) could show a \"saved\" confirmation but never actually appear. If another source — Samsung Health via Health Connect, or Oura — had recorded an activity for the same minute, the sync silently got stuck and the entry never reached the server. Same-minute overlaps now merge instead of vanishing.",
    ],
  },
  {
    version: "1.73.0",
    date: "2026-07-01",
    changes: [
      "Your RPE now shapes progression. When a lift runs harder than its target intensity AND your 1RM is slipping, next session's load eases 5–10% for that exercise — sized by how badly you missed (miss by ~a rep → 5%, miss badly → the full 10%). A hard set on a lift that's still gaining is left alone.",
      "The inverse too: when a lift feels easy and you're beating the target, the engine raises the demand — climbing your target reps up the goal's rep band, then stepping the weight up once you're at the top (RPE-modulated double progression). An earned extra set steals time from lower-value work so it never blows past your session time limit.",
      "Expected RPE is now reps-aware, so an AMRAP or +1 last set reads as on-target instead of falsely flagging as 'too hard'.",
    ],
  },
  {
    version: "1.72.8",
    date: "2026-07-01",
    changes: [
      "Fix: the rest-complete notification now fires on time instead of arriving up to ~30 seconds late. It's scheduled as an exact alarm that isn't deferred while the screen is off or the app is in the background. (Requires an Android app rebuild to take effect.)",
    ],
  },
  {
    version: "1.72.7",
    date: "2026-07-01",
    changes: [
      "Fix: the workout weight dial now steps in 1.25 kg increments to match the prescribed load. Previously it stepped by 2.5 kg, so a prescription like 23.75 kg snapped up to 25 kg on the active set and you couldn't dial it back — now the exact recommended weight is always selectable.",
    ],
  },
  {
    version: "1.72.6",
    date: "2026-07-01",
    changes: [
      "Fix: the last-set push (main lift AMRAP, everything else +1) now shows from your very first session of an AI program — previously it only appeared once the AI had generated its first prescription (from session two), so your opening session's last set didn't pre-fill the extra rep.",
    ],
  },
  {
    version: "1.72.5",
    date: "2026-07-01",
    changes: [
      "The training-goal screen now shows a phase-progression chart for the selected goal — bars for Accumulate → Build → Peak → Deload showing how load climbs and reps drop across the cycle, so you can see the wave before you pick.",
    ],
  },
  {
    version: "1.72.4",
    date: "2026-07-01",
    changes: [
      "Only your main lift now goes AMRAP each session — secondary compounds and accessories take a controlled +1 rep instead of all maxing out, so a session isn't three or four all-out lifts. Your 1RM still climbs across every exercise.",
      "The program builder now asks before discarding — if you back out or dismiss it with a generated program on screen, it confirms first so you don't lose your work.",
    ],
  },
  {
    version: "1.72.3",
    date: "2026-07-01",
    changes: [
      "You can now reorder exercises when building a program — up/down arrows on each exercise let you, say, warm up on a secondary lift before your main one. Each exercise keeps its role (main/compound/accessory); only the order changes.",
      "The exercise-swap list no longer offers single-muscle isolations (curls, pushdowns, lateral raises) as replacements for a main lift, and flags any main slot that's holding an isolation.",
    ],
  },
  {
    version: "1.72.2",
    date: "2026-07-01",
    changes: [
      "The AI builder no longer asks for a rest-day schedule — AI Training picks your session and rest days for you each day, so that step was redundant. (Linear and Phase programs still set a schedule.)",
      "\"Use prior data\" now checks you actually have prior 1RMs for the session's lifts before skipping the baseline — if there's nothing to use, it tells you to run a quick AMRAP baseline instead of starting you off with placeholder weights. (It also now seeds those starting weights correctly.)",
      "The weekly muscle-volume card now shows your progress against your program's own per-muscle targets (and flags under-trained muscles), replacing the duplicate generic card.",
    ],
  },
  {
    version: "1.72.1",
    date: "2026-07-01",
    changes: [
      "Fix: the Health → Training tab no longer shows two near-identical weekly muscle-volume widgets — the duplicate has been removed (your per-muscle targets still guide the AI).",
      "Fix: the home-screen readiness and sleep widgets no longer go blank after creating or switching a program — they now retry a failed load instead of staying empty until you restart the app.",
      "When building an AI program, each exercise now shows the working range it'll train in (e.g. \"72.5–92.5% · 2–8 reps · AI sets each phase\") instead of a single fixed prescription, so it's clear the AI adjusts load and reps by phase rather than locking one number in.",
    ],
  },
  {
    version: "1.72.0",
    date: "2026-06-30",
    changes: [
      "AI Training now actually loads your phase's prescription — the sets, reps and weight on the bar follow the AI's plan for accumulation, intensification and realisation, instead of staying on a fixed setup.",
      "Your last working set now pushes for a little more each session to grow your 1RM: big lifts get an AMRAP set (beat the target), accessories get a +1 rep — and the dial is pre-filled so you don't have to touch your phone.",
      "Every AI session is kept inside the time you've allotted for it — it trims sets to fit, cutting accessories first and never gutting your main lifts.",
      "New \"Why these reps/sets?\" breakdown on the prescription card explains, per exercise, what drove the choice (phase, compound vs accessory, your 1RM trend, the last-set push).",
      "Powerbuilding and Strength + Hypertrophy goals now periodize properly — previously every AI program quietly trained as pure strength regardless of the goal you picked.",
      "AI programs now set weekly per-muscle volume targets at creation, so the engine balances your sets across the week and nothing gets under- or over-trained.",
    ],
  },
  {
    version: "1.71.4",
    date: "2026-06-30",
    changes: [
      "Fix: The AI Periodization session counts now reflect your real workout history — they recompute from your actual logged sessions each time the card loads, so stale or test sessions can no longer leave an inflated count.",
    ],
  },
  {
    version: "1.71.3",
    date: "2026-06-30",
    changes: [
      "Fix: Sleep latency (how long you took to fall asleep) now syncs from Oura and shows on the timeline's \"Fell asleep\" entry — we were reading the wrong field name from Oura, so it had always come through blank.",
    ],
  },
  {
    version: "1.71.2",
    date: "2026-06-30",
    changes: [
      "Fix: Walks and other activities you've recorded now appear on the home timeline — previously it only showed ring-detected walks, so a logged walk was missing.",
      "Fix: Activity durations in the day view no longer show a long decimal (e.g. 37 min, not 37.0335…).",
    ],
  },
  {
    version: "1.71.1",
    date: "2026-06-30",
    changes: [
      "Improvement: The \"Yesterday\" heading on the home timeline now stands out clearly (bold, with a divider line) instead of blending into the cards.",
      "Improvement: Workouts on the timeline now show their start and end time (e.g. 9:06 AM – 10:39 AM), not just the duration.",
      "Improvement: The timeline now lists the exercises you did in each workout, not just the count.",
    ],
  },
  {
    version: "1.71.0",
    date: "2026-06-30",
    changes: [
      "Improvement: Your Activity score now counts the gym sessions you log in the app, not just what your ring detects — lifting barely raises your heart rate, so Oura was under-counting your training. Tap the Activity card to see the breakdown (e.g. \"Oura 62 · +8 training → 70\").",
      "Improvement: The home timeline now shows yesterday too — your wake-up, when you fell asleep (with sleep latency), and any walks/runs or workouts — under a \"Yesterday\" heading.",
      "Improvement: Meals on the timeline now sit at the actual time you logged them when logged within their window, instead of always jumping to the start of the window.",
      "Fix: Deleting a workout now correctly lowers its session count in AI Periodization — the count no longer stays stuck including the deleted session.",
      "Fix: Walk/run auto-detection is stricter now (needs a real distance, pace and duration), so slow pottering around the house no longer gets flagged as a walk to review.",
      "Fix: Your daily step count from Oura now actually saves and shows up on the home screen.",
      "Improvement: The \"Workout detected\" review card now appears on your Home screen instead of buried in the Health tab.",
    ],
  },
  {
    version: "1.70.1",
    date: "2026-06-30",
    changes: [
      "Fix: Your daily mood check-in now saves on the app — previously it silently failed to sync, so the app kept asking for your mood again every time you reopened it.",
    ],
  },
  {
    version: "1.70.0",
    date: "2026-06-30",
    changes: [
      "Improvement: Your program — session tabs, exercise list and per-set targets — now stores on your device and renders even with no connection, so the workout screen still loads offline after a cold start.",
    ],
  },
  {
    version: "1.69.0",
    date: "2026-06-30",
    changes: [
      "Improvement: Your accumulation block no longer runs forever — after 6 accumulation sessions the AI now recommends moving on to the heavier intensification phase.",
      "Improvement: After a deload, the app now prompts you to start a fresh accumulation block, with a one-tap option to build a brand-new program to keep your body adapting.",
      "Improvement: When an AI session prescription is low-confidence, it now explains why (not enough logged sessions, no recent mood/soreness check-in, no 1RM history, program too new, or no sleep/HRV data) and asks you to confirm before applying.",
    ],
  },
  {
    version: "1.68.1",
    date: "2026-06-30",
    changes: [
      "Fix: The home timeline now shows your main night's sleep for the wake-up time instead of occasionally picking a short nap (no more \"woke up 9:14 PM / 0h 12m\").",
      "Fix: Empty or deleted workouts no longer appear on the home timeline or draw a phantom band on the heart-rate chart.",
      "Fix: Activity durations now display as whole minutes (e.g. 37 min, not 37.0335…).",
      "Fix: The back button on the Sleep/Readiness/Activity/Heart-Rate detail pages now clears the status bar instead of hiding behind it.",
      "Fix: The daily check-in no longer reappears after you save it, and choosing \"Rest day\" now sticks instead of glitching back to the prompt.",
      "Improvement: AI Periodization, Muscle Volume This Week, Weekly Volume vs Target, and the muscle-soreness diagram now paint instantly from cache instead of reloading on every open.",
      "Improvement: Health > Progress now shows your best 1RM as the end value in both the Sets and 1RM views — the Sets bar shows your last working set, the 1RM bar shows your current 1RM estimate.",
    ],
  },
  {
    version: "1.68.0",
    date: "2026-06-30",
    changes: [
      "Fix: Starting a workout no longer hangs on an endless loading screen on the last day of a month (a date bug was erroring out that day's session).",
      "Improvement: Workout history, personal records, and Oura data now load from the on-device database — faster, more reliable on a poor connection, and available offline. (The local database had silently never opened on Android; that's now fixed.)",
      "Fix: Deleting a workout now clears it everywhere immediately — home timeline, the heart-rate chart's workout band, and training stats — and no longer leaves an empty 0-exercise session behind.",
      "Improvement: The home Heart Rate card no longer reloads every time you return to the home screen; it now shows instantly from cache.",
      "Improvement: The Oura section on the Health screen paints instantly instead of flashing a loading skeleton on each visit.",
    ],
  },
  {
    version: "1.67.1",
    date: "2026-06-30",
    changes: [
      "Fix: Body Battery now drains from the left so the filled portion always sits on the right of the bar.",
      "Fix: Body Battery no longer flashes/reloads on every screen change — it now shows instantly from cache like the score chips.",
      "Improvement: Expanded Body Battery now explains how it works (opens at readiness, drains with activity, recharges at rest) when today's heart-rate data hasn't synced yet, and labels the charged/drained totals.",
    ],
  },
  {
    version: "1.67.0",
    date: "2026-06-29",
    changes: [
      "New: Body Battery — a Garmin-style energy tank on the home screen, just below the Readiness/HR/Sleep/Activity chips.",
      "New: The battery opens each morning at your readiness score, then recharges during genuine rest and drains during workouts and elevated heart rate through the day.",
      "New: The card is a colour-shifting bar (green when high, amber and red as it drops); tap to expand the wake-to-now energy graph plus how much you charged and drained today.",
    ],
  },
  {
    version: "1.66.0",
    date: "2026-06-29",
    changes: [
      "New: Sleep, Readiness, and Activity detail pages now feature themed hero backgrounds — night sky with crescent moon, sunrise with blue sky and clouds, and dusk mountain silhouette respectively.",
      "New: 14-day trend sparkline charts added to Sleep, Readiness, Activity, and Heart Rate detail pages so score variance is visible at a glance.",
      "Fix: Back button on health detail pages now reliably navigates to the Health tab (was using router.back() which does nothing when landing directly).",
      "Fix: Stress and Recovery times on the Activity page now correctly display in minutes (Oura reports these in seconds).",
      "Fix: AI health insight 429 errors no longer appear in the browser console — rate limits are silently swallowed.",
      "Fix: AI insight rate limit now applies only to actual AI calls; serving a cached insight no longer counts against the quota.",
      "Fix: React hydration mismatch on health detail pages eliminated by moving cache reads out of useState initializers.",
    ],
  },
  {
    version: "1.65.1",
    date: "2026-06-29",
    changes: [
      "Fix: Workouts logged in the app now reliably save to the server and appear on the training calendar — a sync change had been silently dropping them.",
      "Improvement: Backend database hardening to prevent the connection issues that briefly took the app offline (pooled-connection error handling, query and idle-transaction timeouts).",
    ],
  },
  {
    version: "1.65.0",
    date: "2026-06-29",
    changes: [
      "New: 'Why this?' link on the recommended session card — tap to see a full breakdown of why this session was selected.",
      "New: Session explain page shows your overall readiness score as a ring, weighted contributor bars (muscle recovery/balance/freshness), and per-signal cards (Oura readiness, sleep trend, HRV trend, energy level, sore muscles, consecutive training days).",
      "New: Dynamic weight shifting — when Oura readiness is below 60 or your 14-day sleep trend drops below 85%, the scoring shifts to weight muscle recovery more heavily (40%→55%) so fatigued sessions are deprioritised.",
      "New: Energy level now feeds into deload recommendations — 'drained' triggers a strong deload advisory; 'low' bumps any existing recommendation one tier up.",
      "New: HRV warning shown when your 14-day HRV trend falls below 85% of baseline.",
      "New: Ranked alternatives section shows why other sessions scored lower than the recommendation.",
      "New: Streaming AI insight card on the session explain page — Gemini generates a personalised 2-sentence explanation based on your actual signals.",
    ],
  },
  {
    version: "1.64.1",
    date: "2026-06-29",
    changes: [
      "Fix: Saved meals now appear in the meal card immediately after logging — a cache-read race meant the stale food list was served back to the UI before the cache was cleared.",
      "Improvement: Meal card headers now show a P/C/F gram breakdown alongside calories when the meal has logged items.",
    ],
  },
  {
    version: "1.64.0",
    date: "2026-06-29",
    changes: [
      "Improvement: Workout ready screen now shows session timer, prominent working weight card, and a segmented 2-minute warmup timer (W1/W2/W3) — no intermediate screen before sets start.",
      "Fix: Rest timer now continues past zero in red overtime mode (+N seconds) so you can see exactly how long you over-rested.",
      "Fix: Working weights on the ready screen now correctly auto-scale from your estimated 1RM — no more 60 kg default when the weight should be higher.",
      "Fix: Workout summary and done screens now respect iOS/Android safe area insets — no content clipped by the status bar.",
      "Improvement: Warmup screen has a 10-minute progress bar and compact muscle heatmap so everything fits on one screen.",
      "Fix: 1RM estimation now averages per-set estimates instead of taking the max — a strong last set nudges progression smoothly rather than spiking it.",
    ],
  },
  {
    version: "1.63.0",
    date: "2026-06-28",
    changes: [
      "Fix: Synced biometric and program data (body metrics, sleep, mood, programs) now immediately refreshes the home screen — stale data after background sync is eliminated.",
      "Improvement: Health > Body tab no longer duplicates Readiness/Activity/Sleep contributor breakdowns — each section now links to its dedicated detail page instead.",
      "Refactor: Home screen card widgets extracted into focused components (HomeCardWidget, MiniSparkline, EarlyDeloadCard, GoalsCheckinCard) with React.memo to reduce unnecessary re-renders.",
    ],
  },
  {
    version: "1.62.1",
    date: "2026-06-28",
    changes: [
      "Fix: Day timeline wakeup time now shows when you actually fell asleep (Oura onset) rather than when you got into bed (Samsung Health in-bed time). No more 8:10 PM 'wakeup' on the home screen.",
    ],
  },
  {
    version: "1.62.0",
    date: "2026-06-28",
    changes: [
      "New: Voice logging — tap the microphone button on an active set card and say your reps and weight (e.g. '80kg 5 reps', '5 by 80', or just '5 reps'). Works on Chrome and Samsung Internet. Gracefully hidden on browsers without Web Speech API support.",
      "New: Push notifications infrastructure — subscribe via Profile → Preferences → Push Notifications. The app can now send web push notifications to your device even when the browser is closed. Requires VAPID keys configured on the server.",
      "New: Exercise ID foreign key added to exercise logs, personal records, and session exercises — enables correct cross-session exercise deduplication and faster indexed lookups (migration 099).",
      "Fix: AI periodization baseline 'Baseline needed' no longer stays stuck — tap 'Use prior data →' to use existing personal records as baseline without repeating AMRAP tests.",
    ],
  },
  {
    version: "1.61.0",
    date: "2026-06-26",
    changes: [
      "New: Activity detail sheet now shows a heart rate chart for the activity window — fetches per-minute HR from Oura ring data for the exact start/end time of the activity.",
      "New: Daily check-in redesigned into 3 clear sections: Energy, Sore Muscles, and Issues.",
      "New: Energy level auto-defaults from Oura readiness score on check-in open (≥80→Good, 60–79→OK, 40–59→Low, <40→Drained). You can still override it freely.",
      "New: Sore muscles section is always visible and grouped by body region — Upper Body (Chest, Back, Shoulders, Biceps, Triceps), Lower Body (Quads, Hamstrings, Glutes, Calves), Core.",
      "Fix: 'Tight back' removed from Issues — select Back in sore muscles instead.",
      "Fix: Issues section cleaned up to: Stiff/Tight, Heavy Legs, Joint Pain, Sick/Unwell, Low Motivation.",
      "Fix: Sleep quality question removed from check-in — Oura already tracks this.",
      "Fix: Mood check-in no longer resets after tab-switch.",
    ],
  },
  {
    version: "1.60.3",
    date: "2026-06-25",
    changes: [
      "Fix: GPS auto-detect no longer logs train or bus rides as exercise — individual GPS segment speeds between stops exceed 8 m/s (28.8 km/h); if more than 10% of segments are that fast the session is discarded as motorised transport.",
      "New: Health tab navigation is now a full slide carousel — swiping left/right moves the panel in real time under your finger rather than jumping instantly. Overdraging past the first or last tab has gentle resistance.",
    ],
  },
  {
    version: "1.60.2",
    date: "2026-06-24",
    changes: [
      "Fix: Pull-to-sync is harder to trigger accidentally — indicator threshold raised from 72px to 100px and direction-lock threshold raised from 20px to 36px, requiring a clearer intentional downward gesture.",
      "Fix: Health > Training load section no longer shows a skeleton on every tab open — seeds from cache on first paint.",
      "New: Swipe left/right on the Health screen cycles through Body / Training / Progress tabs.",
      "Fix: Home screen Deload, Rest, and Full action buttons and the rest-day card now use Lucide icons instead of emojis.",
      "Fix: Auto-detect exercise now discards sessions with average speed above 27 km/h — car drives no longer appear as detected walks or runs.",
      "Fix: Activity distance in the history card is now rounded to 2 decimal places.",
      "Fix: Recommended session card no longer flashes a skeleton on each page navigation — lazy cache seed from sessionStorage / localStorage eliminates the micro-load.",
      "Fix: HR graph y-axis now has ±10 bpm padding around the recorded min/max — the line no longer sits pinned to the chart edges.",
      "New: Exercise review sheet shows a HR sparkline (red area chart from Oura heartrate data) for the detected activity window.",
      "New: Exercise review sheet header shows the date and time of the detected activity.",
    ],
  },
  {
    version: "1.60.1",
    date: "2026-06-24",
    changes: [
      "Fix: Exercise detection no longer queues 40+ walks — dedup bug in ExerciseDetectedCard meant every page load re-added all unreviewed Oura sessions to the store. Now deduplicates by ouraWorkoutId.",
      "Fix: Zero-distance and sub-5-minute Oura workouts are filtered out before surfacing as detected sessions.",
      "Fix: Unreviewed Oura workouts older than 30 days are excluded from the pending queue to prevent historical backlog accumulation.",
      "Fix: Saving a GPS-tracked phone session now auto-marks any overlapping Oura workout as reviewed, preventing the same walk from appearing twice.",
      "New: 'Dismiss all' button replaces 'Dismiss' when multiple sessions are queued — clears entire backlog in one tap.",
    ],
  },
  {
    version: "1.60.0",
    date: "2026-06-24",
    changes: [
      "New: Treadmill activity sessions — timer-based session on the Activity screen, post-workout distance entry, auto-calculated steps from height (stride ratio), HR pulled from Oura Ring data.",
      "New: Exercise Detected card — Oura Ring walk/run workouts surfaced as pending review sessions on the Health > Training tab. Tap to review, adjust type (walk/run), and save.",
      "New: Auto exercise detection service — background GPS tracking on Android (Capacitor) with 3-minute stall detection; detected walks/runs stored as pending sessions.",
      "New: /api/oura/hr-window endpoint — returns avg/max HR for a time window, reads local cache first, falls back to on-demand Oura API fetch.",
      "New: Oura workouts synced to DB (oura_workouts table) on each Oura Ring sync; walk/run activities shown as pending review.",
      "steps column added to activity_logs — treadmill step counts stored separately from body_metrics.steps to avoid double-counting with Health Connect.",
    ],
  },
  {
    version: "1.59.3",
    date: "2026-06-24",
    changes: [
      "Fix: Workout done screen now scrolls when HR recovery data is loaded — Share and Done buttons are always reachable.",
      "Fix: HR recovery chart line no longer clips the top edge of the graph area.",
    ],
  },
  {
    version: "1.59.2",
    date: "2026-06-24",
    changes: [
      "Fix: Scrolling on the Home and Health screens is now fully responsive — no more lag or stuck scroll caused by the drag-to-reorder gesture sensor.",
      "Fix: Pull-to-sync no longer accidentally triggers when scrolling down — the gesture now requires a sustained 20px downward movement before activating.",
      "Fix: Drag-to-reorder widgets removed from Home and Health screens; show/hide edit mode is preserved.",
    ],
  },
  {
    version: "1.59.1",
    date: "2026-06-24",
    changes: [
      "New: Pull-to-sync gesture on Home, Health, and More screens — pull down from the top of the page to trigger a full sync (Oura Ring, local changes, and server data).",
      "New: Sync runs in the background — indicator dismisses after a moment and the app stays fully responsive while data updates.",
      "Fix: Background syncs (Health Connect, Oura auto-sync, pull-to-sync) are now fully silent — no more repeated toast notifications interrupting touch gestures.",
    ],
  },
  {
    version: "1.59.0",
    date: "2026-06-23",
    changes: [
      "New: Compact readiness card — replaced the tall readiness block with a slim tappable strip (~52px). Tap to expand for full details.",
      "New: Readiness card shows all four Oura health pillars as icon chips: Sleep score (moon), Activity score (bolt), and current Heart Rate bpm (heart). Missing values show — placeholders.",
      "New: Score arc — 44px SVG ring filled proportionally, colored green (High), amber (Moderate), or red (Low).",
      "New: Expanded view shows score breakdown (Oura base → ACWR/temp adjustment → final), readiness/sleep/activity contributor bars sorted by score, and a Heart Rate today grid (Current/Min/Avg/Max).",
      "Fix: ACWR training load penalty is now suspended for the first 28 days after starting a new program, preventing incorrect readiness penalties when chronic load baseline doesn't reflect the new program's volume.",
      "Fix: Readiness API now returns activity score, sleep contributors, activity contributors, and HR stats — all fields from existing DB data, no new migrations needed.",
    ],
  },
  {
    version: "1.57.0",
    date: "2026-06-23",
    changes: [
      "New: 24-hour Heart Rate chart in Oura section — full-day 1-min HR data synced from Oura API, displayed as a smooth 5-min-averaged line chart (midnight to midnight).",
      "New: Sleep and workout windows highlighted as coloured bands on HR chart (indigo = sleep from Oura source field, orange = gym session from workout_sessions table).",
      "New: Workout session name shown in HR chart legend (e.g. 'Workout: Push' instead of 'Workout').",
      "New: Sleep hypnogram in sleep detail sheet — 5-min stage timeline (Deep/Light/REM/Awake) from Oura sleep_phase_5_min field.",
      "Fix: Home screen readiness score and workout metadata now loaded from cache before first paint, eliminating flash on repeat visits.",
      "Fix: HR recovery chart set markers now correctly positioned using LinearScale (was using CategoryScale, treating float minute-values as array indices).",
      "Fix: HR recovery chart legend now shows exercise names with colour swatches instead of S1/S2 text labels.",
    ],
  },
  {
    version: "1.56.1",
    date: "2026-06-22",
    changes: [
      "Fix: completing an AMRAP baseline set in an AI Dynamic program no longer crashes the workout screen. Root cause was Zustand 5's use of useSyncExternalStore, which bypasses React 18 batching — 8 sequential store updates produced 8 synchronous re-renders, one with inconsistent state. Fix: all 8 updates are now applied atomically in a single store action.",
    ],
  },
  {
    version: "1.56.0",
    date: "2026-06-21",
    changes: [
      "Fix: Strength Trend sparklines now update immediately after completing a workout (were stale for up to 15 min).",
      "Fix: Calendar day-overlay now refreshes after completing a workout, logging water, or saving body metrics.",
      "Fix: Editing a food log serving size on the app no longer flickers back to the old value after saving.",
      "Fix: AI pre-workout prescription card now correctly shows as used after training — no more stale Pending status next session.",
      "Fix: Serving size edits via PATCH are now validated to the same 0.01–100 range as new log entries.",
      "Performance: Logging a set no longer reads the full 141-exercise library — now uses a single targeted lookup.",
      "Fix: Logged food now appears in the meal card immediately — no longer waits for background sync to complete before updating the UI.",
      "Fix: Dark mode brand accent colours (blue, purple, orange, pink, cyan, red, gold) now apply correctly — broken CSS compound selector caused all themes to show dull light-mode values in dark mode.",
      "Fix: SQLite→API fallback now works correctly across all local-first write paths (food logs, water, supplements, activity, injury, body metrics). Previously a SQLite error would show a failure toast without trying the API.",
      "Fix: Week strip session name colour no longer uses bright brand cyan — now matches foreground text.",
    ],
  },
  {
    version: "1.55.0",
    date: "2026-06-21",
    changes: [
      "New: Exercise library expanded from 75 to 141 exercises — 66 new entries covering all major equipment types (barbell, dumbbell, cable, machine, kettlebell, bodyweight).",
      "New: Every exercise now has equipment tags — filters in the exercise picker correctly narrow results to barbell-only, dumbbell-only, machine-only, etc.",
      "New: Muscle group filter row in the exercise picker (Chest / Back / Shoulders / Arms / Legs / Glutes / Core / Traps) above the existing equipment chips.",
      "New: Exercise preview sheet — tap the ℹ️ button on any exercise in the picker or program editor to see an animated GIF, equipment badges, primary/secondary muscle tags, and how-to instructions.",
      "Fix: 11 incorrect or incomplete muscle assignments corrected (e.g. Barbell Deadlift now includes quads secondary, Ab Wheel corrected from shoulders to lats, Plank adds shoulders and glutes secondary).",
    ],
  },
  {
    version: "1.54.0",
    date: "2026-06-20",
    changes: [
      "New: AI-driven workout periodization engine — the app now dynamically prescribes sets, reps, and intensity for each session based on your performance signals (RPE trend, ACWR, sleep/HRV, soreness, rep completion, weekly volume).",
      "New: Baseline phase uses AMRAP sets to establish your working 1RM. The app then progresses you through accumulation → intensification → realisation → deload phases automatically.",
      "New: Emergency deload detection — if ACWR exceeds 1.5, you've trained 4+ consecutive days, or recovery signals are poor, the app immediately prescribes a deload session without waiting for AI.",
      "New: Training goal and auto-apply settings in program config (strength / hypertrophy / power / endurance), with per-session time budgets that constrain prescription volume.",
      "New: Phase transition UI in pre-workout screen — accept or dismiss AI prescriptions, and confirm recommended phase advances before they apply.",
      "New: AI Periodization Status card on Health > Training tab showing current phase and prescription status for each session.",
      "New: Weekly Volume vs Target card on Health > Training tab with progress bars per muscle group.",
    ],
  },
  {
    version: "1.53.0",
    date: "2026-06-20",
    changes: [
      "New: All user-facing write operations now use local-first architecture — water log, food logs (create/edit/delete), supplement CRUD, activity log, and saved meal logging all write to SQLite instantly then sync to server in the background. No API call blocks the UI.",
      "New: 'Complete' button in workouts transitions to exercise summary screen instantly (was up to 5 seconds) — server sync now runs entirely in background via fire-and-forget fetch.",
      "Fix: 'Complete' button was silently failing when SQLite (addToOutbox) threw an error; errors are now caught so navigation always proceeds.",
      "Fix: waterMl was missing from upsertBodyMetrics SQL — water log mutations pushed via sync/push are now correctly persisted to the database.",
      "New: supplements and activity_logs domains added to pushMutations outbox, enabling full offline queuing for these write paths.",
    ],
  },
  {
    version: "1.52.0",
    date: "2026-06-20",
    changes: [
      "New: Local-first offline storage now uses SQLite (via @capacitor-community/sqlite) instead of Dexie/IndexedDB. Body metrics, mood logs, sleep sessions, activity logs, supplements, injuries, and food log reads are all served from the local SQLite cache on first load.",
      "New: Supplements and injuries now write locally first when on the APK — toggles and edits are reflected instantly and synced in the background via the mutations outbox.",
      "New: Food logs, supplements, supplement_logs, and injuries are now included in delta sync — changes made offline are pushed to the server when connectivity is restored.",
    ],
  },
  {
    version: "1.51.0",
    date: "2026-06-20",
    changes: [
      "New: RPE (Rate of Perceived Exertion) is now recorded on every set. The active set card has a horizontal RPE slider (6–10) at the bottom with a description label (e.g. 'RPE 8 · Hard').",
      "New: RPE defaults are pre-filled from set intensity — 80% → RPE 8, 90% → RPE 9, 100% → RPE 10.",
      "New: Completed sets now display in a stable 2-column grid showing load, RPE, set duration and rest time. The grid pre-allocates all set cells so the active card and rest timer never shift position as sets complete.",
      "New: RPE values are persisted to the database and appear on the exercise summary screen after each exercise.",
      "Fix: RPE defaults were always 7 regardless of intensity due to a timing bug — initRpeValues was called before store.sets was set. Moved initialisation into launchExercise.",
      "Fix: Bottom action bar padding increased to 4rem minimum to clear the Android gesture navigation bar on the S25 Ultra.",
    ],
  },
  {
    version: "1.50.4",
    date: "2026-06-18",
    changes: [
      "Fix: Health > Progress tab crash on Samsung WebView resolved — strength sparkline is now rendered as pure SVG with no canvas dependency.",
      "Fix: Strength progress card in Sets mode now correctly shows estimated 1RM on the right label (regression fix).",
      "UI: Strength Trend card moved to the bottom of the Progress tab.",
      "Fix: Goals tab 'This Week' steps target now matches the home screen (weekly goal shown as daily × 7).",
      "Fix: Admin console top edge now respects the device status bar safe area.",
      "Fix: Manual sync button in Profile now bypasses the 5-minute throttle and always fetches the latest data.",
    ],
  },
  {
    version: "1.50.3",
    date: "2026-06-18",
    changes: [
      "Fix: Health > Progress tab no longer crashes with an application error on first load.",
      "Fix: 'Add Supplement' button in the Manage Supplements sheet now clears the device navigation bar on Samsung Galaxy S25 Ultra.",
      "Fix: Back button in Workout Config now correctly navigates back through browser history instead of silently switching tabs.",
    ],
  },
  {
    version: "1.50.2",
    date: "2026-06-18",
    changes: [
      "Internal: workout-card prefetch migrated from raw sessionStorage to the cachedFetch/readCacheSync cache layer — no visible change, improves offline reliability on APK.",
    ],
  },
  {
    version: "1.50.1",
    date: "2026-06-18",
    changes: [
      "Fix: 1RM estimation now correctly ignores sets with more than 30 reps (previously they were capped at 30 reps, inflating the estimate).",
      "Fix: Strength progress bar in Working mode now shows your working weight, not the estimated 1RM.",
      "Performance: Health page Body tab loads body metrics instantly from local storage before the network response arrives.",
      "Accessibility: food log sheet, food library sheet, and AI chat overlay now use Radix UI Sheet — proper focus trapping, ARIA semantics, and Android back-button dismiss.",
    ],
  },
  {
    version: "1.50.0",
    date: "2026-06-18",
    changes: [
      "New: submit feedback (bug reports & feature requests) from the Profile tab — with optional screenshot attachment.",
      "New: injury log in Health > Body tab — track muscle injuries on the heatmap, with severity levels and a day counter. Active workout will warn you when an exercise targets an injured muscle.",
      "New: supplement tracker in Nutrition — daily checklist to log your supplements, with daily reminders.",
      "Fix: calendar legend no longer overflows on long session names.",
    ],
  },
  {
    version: "1.49.0",
    date: "2026-06-17",
    changes: [
      "Health > Progress: new Strength Trend card shows your 1RM history over 90 days for each exercise in your program — swipe left/right to browse lifts, see % gain and peak.",
    ],
  },
  {
    version: "1.48.0",
    date: "2026-06-17",
    changes: [
      "Done screen now shows actual volume lifted (kg) and real sets logged instead of estimates.",
      "PR trophy card on the done screen has per-PR share buttons — tap a PR to share it instantly.",
      "Health > Training weekly stats card now shows total volume lifted this week instead of avg intensity.",
    ],
  },
  {
    version: "1.47.0",
    date: "2026-06-17",
    changes: [
      "Health > Training: new Weekly Volume card shows sets logged per muscle group this week vs. the 10–20 sets/week hypertrophy target, with color-coded bars and a target-minimum marker.",
    ],
  },
  {
    version: "1.46.0",
    date: "2026-06-17",
    changes: [
      "Exercise picker in Workout Config: tap the book icon next to any exercise to browse the full library with search and equipment filters (Barbell, Dumbbell, Cable, Machine, Kettlebell, Bodyweight).",
    ],
  },
  {
    version: "1.45.1",
    date: "2026-06-17",
    changes: [
      "Achievements page loads faster — lifetime session, volume, and set counts now read from a pre-computed table instead of scanning the full workout history on every visit.",
    ],
  },
  {
    version: "1.45.0",
    date: "2026-06-17",
    changes: [
      "Workout reminder notifications: set a daily reminder in Workout Config (weekly/rotation schedules only) — fires once per training day at your chosen time, clears automatically when you start your workout.",
    ],
  },
  {
    version: "1.44.0",
    date: "2026-06-17",
    changes: [
      "Nutrition goal recommendations now use Katch-McArdle BMR and lean-mass protein dosing when body fat % is logged — more accurate for higher body fat levels.",
      "Calendar legend now wraps neatly for programs with 4 or more sessions.",
    ],
  },
  {
    version: "1.43.0",
    date: "2026-06-17",
    changes: [
      "Added 'Sync now' button in Profile › About — tap to force a full 30-day Health Connect re-sync immediately.",
      "Health Connect: calories burned now only reads when the TotalCaloriesBurned permission is granted.",
      "Health Connect: HRV now uses RMSSD (the correct overnight metric) instead of SDNN.",
      "Health Connect: rest-timer notification is reconciled when the app resumes from background mid-rest.",
      "Fixed: deleting a food entry now shows a toast error instead of silently failing.",
      "Food quick-edit sheet now slides up smoothly with Radix animation and traps focus correctly.",
      "Cache correctness: stats page, exercise history, and workout metadata now use shared stale-while-revalidate cache.",
      "Performance: login no longer issues one DB query per default progression style (N+1 fix).",
    ],
  },
  {
    version: "1.42.4",
    date: "2026-06-17",
    changes: [
      "Fixed food logging always showing \"Failed to save food item\" when logging via scan or manual entry.",
    ],
  },
  {
    version: "1.42.3",
    date: "2026-06-16",
    changes: [
      "Performance: chart.js now loads on demand instead of on every page — home, health, and nutrition screens open faster.",
      "Performance: GPS workout screens no longer re-render on every location sample — saves battery during long runs.",
      "Performance: barcode scanner and haptic feedback plugins no longer bundled for web browsers.",
      "Performance: opening the workout screen no longer runs 3 database-wide queries just to cache your XP.",
    ],
  },
  {
    version: "1.42.2",
    date: "2026-06-16",
    changes: [
      "Cache correctness: admin exercise edits, activity-type edits, meal-type edits, and the AI workout builder now all immediately update cached data — no more stale lists for up to 6 hours.",
      "Cache correctness: logging a body metric from the overview screen now immediately refreshes readiness inputs (mood, sleep, HRV).",
      "Cache correctness: deleting or creating a program clears the program list cache, preventing deleted programs from reappearing.",
      "1RM calculation: sets with more than 30 reps now use 30 reps as a conservative floor rather than silently showing 0.",
    ],
  },
  {
    version: "1.42.1",
    date: "2026-06-16",
    changes: [
      "Security: sign-out now fully clears all cached data (SQLite, localStorage, IndexedDB) — second accounts on the same device no longer see the previous user's stats.",
      "Security: nutrition food logs and phase-set style references now verify ownership before writing, preventing cross-account data references.",
      "Reliability: editing a workout with more than 30 reps per set no longer produces an inflated 1RM estimate.",
    ],
  },
  {
    version: "1.42.0",
    date: "2026-06-16",
    changes: [
      "Estimated 1RM card (Health > Progress) now shows your current training phase and cycle (e.g. 'Accumulation · C2/4') for automatic-phase programs, and a 'Last: Push' annotation for whichever session was most recently logged.",
      "Progress bars on the Estimated 1RM card are wider and now have faint dashed reference lines at 60%, 70%, and 80% intensity so you can see at a glance where each lift sits relative to typical training zones.",
      "Latest/Working Set view toggle moved behind a small settings cog icon on the Estimated 1RM card to declutter the header.",
    ],
  },
  {
    version: "1.41.1",
    date: "2026-06-15",
    changes: [
      "Fixed the new Goals card's 'Workouts' target on Health > Progress disagreeing with the home screen's 'This Week' target (e.g. showing 1/4 instead of 1/5) for rotation-style programs.",
    ],
  },
  {
    version: "1.41.0",
    date: "2026-06-15",
    changes: [
      "Health > Progress: Estimated 1RM cards now have a Latest/Working Set toggle — Working Set shows how close today's actual top set (or bodyweight reps) is to your all-time best for that lift.",
      "Added a new Goals card to Health > Progress showing live progress toward your Steps, Calories, Water, Sleep and Workout goals, with a Today/This Week toggle.",
      "The Weight Trend card now shows direction-aware progress toward your long-term Weight and Body Fat % goals (handles both losing and gaining toward a target).",
    ],
  },
  {
    version: "1.40.1",
    date: "2026-06-15",
    changes: [
      "Fixed: renaming an exercise in Admin > Exercises failed with a database error — renames now save correctly and update the exercise everywhere it's used (programs, workout history, and personal records).",
    ],
  },
  {
    version: "1.40.0",
    date: "2026-06-15",
    changes: [
      "Added an Admin Console tool (Tools tab > 'Fix lbs logged as kg') to correct dumbbell exercise history that was logged in pounds but recorded as kilograms — converts set weights, recalculates 1RM/target/volume, and updates personal records for sessions before a chosen date.",
    ],
  },
  {
    version: "1.39.1",
    date: "2026-06-15",
    changes: [
      "Estimated 1RM progress bars on Health > Progress now compare each exercise's latest estimate against its own all-time personal record (turning gold when you're at or above your PR), instead of against the heaviest lift in the list.",
    ],
  },
  {
    version: "1.39.0",
    date: "2026-06-15",
    changes: [
      "Steps, calorie and water goals set to 'Weekly' now show your actual calendar-week progress (Monday through today) instead of a rolling 7-day total, on both the Profile Goals page and the home screen.",
      "Added a weekly water progress indicator to the home screen's Water tile when the water goal is set to 'Weekly'.",
    ],
  },
  {
    version: "1.38.0",
    date: "2026-06-15",
    changes: [
      "AI goal recommendations now consider your active program and, for automatic phase-mode programs, your current phase (e.g. deload, testing, peak) when explaining training volume changes and suggesting numeric targets.",
      "Reordered the Profile Goals cards so Daily Water Goal comes before Calorie Goal, putting Macro Targets directly below Calorie Goal.",
    ],
  },
  {
    version: "1.37.2",
    date: "2026-06-15",
    changes: [
      "The Profile Goals section header now matches Appearance/Home Widgets — an icon, title and subtitle in a collapsible card.",
      "The 'Log a new weigh-in' and 'Log body fat %' links on the Goals section now open the Health page's Body tab, where logging actually happens.",
      "AI goal recommendations now factor in your body fat % trend (alongside weight) when generating insights.",
    ],
  },
  {
    version: "1.37.1",
    date: "2026-06-15",
    changes: [
      "The Profile Goals section is now collapsible (collapsed by default), matching the other Profile sections.",
      "Weight and Body Fat % now show your latest reading alongside your target in a single 'current → target' row, instead of separate read-only and target fields.",
    ],
  },
  {
    version: "1.37.0",
    date: "2026-06-15",
    changes: [
      "Reorganised Profile into a single 'Goals' section that follows a required-info → targets → AI-recommendation workflow: current weight (read-only, from your latest weigh-in, with a link to Health to log a new one), height, biological sex, birth year and activity level, followed by your fitness goal, target weight, target body fat %, steps/sleep/calorie/water goals, and a new collapsible 'Macro Targets' pane.",
      "Macro targets (calories, protein, carbs, fat, fiber) moved from the Nutrition page settings into the Profile Goals section, and now auto-refresh after applying an AI recommendation.",
      "Edit Profile no longer edits height, sex or birth year (now set in Goals) — Display Name, Weight Goal, Timezone, Units, Food Region and password change are unchanged.",
    ],
  },
  {
    version: "1.36.0",
    date: "2026-06-15",
    changes: [
      "Added AI-powered nutrition & activity goal recommendations — set your Activity Level and Fitness Goal in the new 'Activity & Goals' Profile section, then tap 'Get AI Recommendation' for personalised daily targets (steps, calories, protein, carbs, fat, water) based on your recent weigh-ins, sleep, mood, workouts and PRs. Review the suggested changes and apply only the ones you want.",
      "Added a bi-weekly goals check-in card on the home screen that prompts you to review your nutrition/activity goals every couple of weeks, with 'Review now' and 'Remind me later' options.",
      "The Health page's TDEE calculation now uses your actual Activity Level (set in Profile) instead of a fixed 1.4× multiplier.",
    ],
  },
  {
    version: "1.35.12",
    date: "2026-06-15",
    changes: [
      "Fixed estimated 1RM (and next-session weight targets) decreasing even when you matched or exceeded your program's prescribed reps — the 1RM estimate is now corrected relative to each set's prescribed %1RM/reps, so hitting the prescription exactly keeps your 1RM stable, exceeding it raises it, and falling short lowers it",
    ],
  },
  {
    version: "1.35.11",
    date: "2026-06-14",
    changes: [
      "Fixed the block-cycle position not updating when switching to a different phase set on a program already using automatic block periodization — the cycle anchor is now re-derived from training history whenever the phase set changes, so the new set's cycle length is reflected immediately instead of needing a manual 'Recalibrate'",
      "Fixed personal records (1RMs) not being updated when a workout synced from the offline queue — syncing a session now records a new PR the same way logging it live does",
    ],
  },
  {
    version: "1.35.10",
    date: "2026-06-14",
    changes: [
      "Fixed workout sessions getting relinked to the wrong program session after reordering or removing a session in Workout Config — already-logged workouts now stay attached to the same session by id, regardless of where it moves in the list",
      "Fixed the 2nd+ exercise logged into a workout session sometimes being scored against a different training phase than the 1st (when the session straddled a block-cycle boundary) — every exercise in a session now shares the phase the session was created under, so 1RM scaling and PR recording stay consistent",
    ],
  },
  {
    version: "1.35.9",
    date: "2026-06-14",
    changes: [
      "Replaced the Profile 'On program' weeks stat (for programs using automatic phases) with overall block progress — shows 'Cycle X/Y' and your current phase name, matching the progress shown on the workout screens. Programs without automatic phases still show lifetime weeks-on-program with the 12-week review nudge.",
    ],
  },
  {
    version: "1.35.8",
    date: "2026-06-14",
    changes: [
      "Fixed the 'On program' stat on Profile counting weeks from your very first logged workout instead of the start of your current training block — it now reflects how long you've been on this block since switching to automatic phases",
    ],
  },
  {
    version: "1.35.7",
    date: "2026-06-14",
    changes: [
      "Fixed the previous data repair skipping sessions whose name (e.g. 'Push') also appears in an old, inactive program — the relink now matches against your currently active program only",
    ],
  },
  {
    version: "1.35.6",
    date: "2026-06-14",
    changes: [
      "Added a one-time data repair that relinks already-logged workouts to their session if an earlier config save had severed the link — fixes sessions still showing 'Never trained' on the workout-select screen despite being completed today",
    ],
  },
  {
    version: "1.35.5",
    date: "2026-06-14",
    changes: [
      "Fixed a session showing 'Never trained' right after completing it if you then edited any exercise's role in Workout Config — saving the program config was severing the link between a just-logged workout and its session",
      "Fixed the 'Leave workout?' warning appearing on the session-select screen after a workout was already completed",
    ],
  },
  {
    version: "1.35.4",
    date: "2026-06-14",
    changes: [
      "Fixed automatic phase progression staying stuck on the first phase (Baseline/Testing) for good — the session count that drives phase advancement was always 0 due to a broken DB join that the v1.35.2 fix didn't catch",
      "Removed the 'Block Start' date field — your position in the current block is now calculated automatically from your training history when automatic phase mode is first turned on",
      "Added a one-tap 'Recalibrate cycle position' button for automatic phase programs — recalculates your block-cycle position from your full training history with no manual counting",
      "Block-cycle progress now reflects deletions live — if a logged session is removed, the cycle count drops accordingly instead of relying on a stored counter",
    ],
  },
  {
    version: "1.35.3",
    date: "2026-06-14",
    changes: [
      "Added a 'Block Start' date field to automatic phase programs in Workout Config — lets you correct the block-cycle anchor date if phase progression looks wrong",
    ],
  },
  {
    version: "1.35.2",
    date: "2026-06-14",
    changes: [
      "Fixed automatic phase progression getting permanently stuck on Baseline/Testing cycle 1 — block cycles now advance correctly as you log sessions",
      "Baseline/Testing sessions now correctly apply the AMRAP-scaled 1RM estimate and record the active phase against the workout",
    ],
  },
  {
    version: "1.35.1",
    date: "2026-06-14",
    changes: [
      "Fixed meal reminder notifications repeatedly re-firing after being tapped",
      "Tapping a meal reminder notification now opens the Nutrition page",
    ],
  },
  {
    version: "1.35.0",
    date: "2026-06-13",
    changes: [
      "Stats now refresh instantly after a workout — XP/level, weekly stats, strength, home 'Next Session' and readiness no longer show stale numbers",
      "Switching your active program now updates the home 'Next Session' card straight away",
      "Mood, body-metric and activity logs now immediately update the readiness and weekly summaries",
      "The calorie-goal streak now respects your goal direction — staying under counts when cutting, hitting the target when bulking, within ±10% when maintaining",
      "Personal records are now only saved once a set has actually been logged (no more phantom PRs from a failed save)",
      "Bodyweight-exercise 1RM estimates now use your most recent weigh-in",
      "Smoother active-workout screen with fewer unnecessary redraws",
      "Nutrition buttons are larger, easier to tap, and properly labelled for screen readers; meal lists show a loading placeholder",
      "Hardened security: rate-limited the AI voice and exercise-generation features and restricted shared-library exercise creation to admins",
    ],
  },
  {
    version: "1.34.0",
    date: "2026-06-13",
    changes: [
      "Home screen weather chip now shows the UV index during daylight hours, colour-coded by severity",
      "Fixed the Nutrition card on the home screen linking to Health instead of Nutrition",
      "Health page now opens on the Training tab (calendar) by default",
      "Activity times (walks, runs, etc.) now show in 12-hour format",
      "Added an Estimated 1RM progress card to Health > Progress, grouped by session",
      "Fixed the workout select screen showing 'Trained today' for sessions you didn't actually train",
      "Profile screen rework: centred title, copy-to-clipboard friend code, and a new icon-based stats grid (Sessions, Sets, Volume, Best Streak, Distance, Member since/Program weeks)",
      "Step goal can now be set to a weekly target — the home Steps widget shows your 7-day total against it",
      "Toggle switches throughout the app are now a more proportionate size",
      "Fixed the Workout Config back button returning to the wrong page",
    ],
  },
  {
    version: "1.33.0",
    date: "2026-06-13",
    changes: [
      "Added meal reminder notifications — if a meal's time window ends with nothing logged, you'll get a 'Don't forget to log...' notification (Android app only); toggle globally in Nutrition Settings or per meal type in Meal Types",
    ],
  },
  {
    version: "1.32.1",
    date: "2026-06-13",
    changes: [
      "Fixed reordering sessions and exercises in the program editor not actually saving the new order — dragging now updates correctly and the order sticks after saving",
    ],
  },
  {
    version: "1.32.0",
    date: "2026-06-13",
    changes: [
      "Tapping a friend in the feed or leaderboard now opens their full profile — avatar, equipped title, level/XP progress, lifetime sessions, volume, best streak, and a trophy case of their top achievements",
      "Runner profiles now show a total distance stat alongside sessions, volume, and streak",
      "Reorder your training sessions and exercises by dragging — new grip handles in the program editor let you rearrange your program without retyping anything",
      "Fixed low-contrast session-name text on the Weekly Schedule and Friends activity cards against the dynamic background",
      "Improved contrast on the Health page's Resting HR, HRV, and SpO2 cards",
      "Fixed the accent colour occasionally reverting to green after a refresh",
      "Added more breathing room under the Start Workout button on the pre-workout screen",
    ],
  },
  {
    version: "1.31.0",
    date: "2026-06-13",
    changes: [
      "Fixed the home screen Streak card and activity bar strip not showing training history from before the current month — your streak no longer resets to almost nothing at the start of a new month",
      "Workout streak on the home screen now matches the streak shown in Achievements (one rest day no longer breaks either)",
      "Improved card contrast in light mode on the Home and Health screens",
      "Health page info buttons (Lean Mass, BMI, Trend, Balance) are now easier to tap and screen-reader friendly",
      "Added a back button to the Log Activity screen",
      "Chat screen header no longer sits under the status bar",
      "Fixed mood check-in not always saving and updating immediately",
      "Activity tracking: smoother map updates, an offline message when disconnected, and faster GPS distance updates during long activities",
      "General performance and security improvements across syncing, caching, and Health Connect",
    ],
  },
  {
    version: "1.30.3",
    date: "2026-06-12",
    changes: [
      "Dynamic background now reaches a properly dark, near-black night sky within 2 hours of sunset and holds it until shortly before sunrise, instead of the pink/magenta dusk colours lingering for hours into the evening",
    ],
  },
  {
    version: "1.30.2",
    date: "2026-06-12",
    changes: [
      "Fixed a remaining \"invalid record specified\" error in Health Connect sync — the heart rate permission key was also wrong, so sync was still failing entirely. Steps, weight, sleep, body fat, nutrition, resting heart rate, and exercise sessions now sync correctly",
    ],
  },
  {
    version: "1.30.1",
    date: "2026-06-12",
    changes: [
      "Fixed the weight dial haptic tick not firing on Android",
      "Fixed Health Connect sync failing entirely with an \"invalid record specified\" error — steps, heart rate, weight, sleep and other health data now sync correctly",
    ],
  },
  {
    version: "1.30.0",
    date: "2026-06-12",
    changes: [
      "Native haptic feedback (weight dial, session swipe, set logging, workout completion) replaces basic vibration",
      "Rest timer now sends a notification when it finishes, even if the app is in the background",
      "Status bar icons now show correctly against the app's dark theme",
      "Nutrition photo scan uses the native camera/gallery picker on Android",
      "Offline sync now resumes immediately when your connection comes back, instead of waiting for the next app open",
    ],
  },
  {
    version: "1.29.4",
    date: "2026-06-12",
    changes: [
      "Fixed an exercise shared between two sessions (e.g. an exercise that appears in both your Push and Upper sessions) incorrectly showing as already done in the other session's Recommended Workout list — completion is now tracked per session",
    ],
  },
  {
    version: "1.29.3",
    date: "2026-06-12",
    changes: [
      "Home screen greeting no longer gets cut off by the weather chip — the weather chip now sits next to the date, and your name can wrap onto a second line if needed",
    ],
  },
  {
    version: "1.29.2",
    date: "2026-06-12",
    changes: [
      "Cards on Home and Health now have a more opaque background, matching the Training Load card, so they're easier to read against the dynamic background",
      "Fixed the Workout Config screen and Nutrition meal cards rendering as solid black instead of showing the dynamic background through them",
      "The training calendar on Health now sits on its own card, fixing the sun/moon glow overlapping date cells",
    ],
  },
  {
    version: "1.29.1",
    date: "2026-06-12",
    changes: [
      "Fixed the dynamic background not appearing — it now actually shows behind the Home, Health, Workout, Nutrition, and More screens when enabled",
      "Fallback location search now shows a list of matching cities/suburbs (with region and country) to pick from, and clarifies that postcodes aren't supported",
    ],
  },
  {
    version: "1.29.0",
    date: "2026-06-12",
    changes: [
      "New optional dynamic background: an animated sky scene (gradient, sun/moon, weather effects) that follows the time of day and local weather, in the style of the Samsung Weather app",
      "Enable it from Profile > Theme & Appearance > \"Dynamic background\" — choose which tabs (Home/Health/Workout/Nutrition/More) show it, and set a fallback city if device location is unavailable",
      "Home screen now shows a small weather chip (icon + temperature) in the header",
    ],
  },
  {
    version: "1.28.0",
    date: "2026-06-12",
    changes: [
      "The AI workout builder now creates a private, per-program copy of the phase progression when you customise phase cycle lengths, named \"<template> (<program name>)\" — editing it doesn't affect other programs",
      "Renaming a program automatically renames its phase progression to match",
      "Deleting a program now also removes its phase progression, instead of leaving unused copies behind",
      "Saving a program with a name you already use now shows a clear error instead of silently overwriting the existing one",
    ],
  },
  {
    version: "1.27.0",
    date: "2026-06-11",
    changes: [
      "Trophy Case and achievements now live on the Profile tab — the separate Achievements tab has been removed",
      "Health > Training tab now shows the calendar before the training load chart",
      "Strength, Hypertrophy, S+H, Powerbuilding Progression, Baselining, and Linear Progression phase sets are now read-only \"Default\" templates — clone them to customise",
      "Widget colour pickers now offer a curated MMO-rarity palette (Common/Uncommon/Rare/Epic/Arcane/Legendary/Mythic/Primal) with a custom colour fallback",
    ],
  },
  {
    version: "1.26.0",
    date: "2026-06-11",
    changes: [
      "\"Log Activity\" now starts a live timer (mirroring the workout flow) instead of a manual entry form — pick an activity type, hit Start, and Pause/Resume/Finish when done",
      "Distance-based activities (Walk, Run, Cycle, Hike, Swim) track live GPS distance and pace, and save a route map, splits, best efforts, and elevation gain/loss",
      "Tap a logged activity on the Health > Training calendar or the Activities card to view its full stats and route on a map",
    ],
  },
  {
    version: "1.25.4",
    date: "2026-06-11",
    changes: [
      "Home screen card widgets (Body Weight, Nutrition, Sleep, Steps, Mood, Streak, This Week) can now be dragged to reorder in edit mode — previously only the Recommended Today card could be dragged",
      "The Training Load chart on Health > Training now shows a colour legend mapping each bar segment to its session name",
    ],
  },
  {
    version: "1.25.3",
    date: "2026-06-11",
    changes: [
      "Bigger 'Log' touch targets on the Health page Steps tile and on Body tab metric tiles",
    ],
  },
  {
    version: "1.25.2",
    date: "2026-06-11",
    changes: [
      "The food logger, food library, and quick-edit nutrition sheets now close on the Android back gesture instead of leaving them open and navigating away from the page",
    ],
  },
  {
    version: "1.25.1",
    date: "2026-06-11",
    changes: [
      "Fixed the post-workout summary screen instantly bouncing back to the workout screen, which also let \"Complete Workout\" be tapped repeatedly and fire duplicate completion/calendar requests",
    ],
  },
  {
    version: "1.25.0",
    date: "2026-06-10",
    changes: [
      "Health Calendar now marks days with a logged activity (run, swim, yoga, etc.) with a small dot, separate from workout-session dots",
      "Tapping a day with a logged activity now shows it in the day overview alongside workouts and body data, with type icon, time, duration, distance, and calories",
      "Activities can now be deleted from the day overview",
    ],
  },
  {
    version: "1.24.0",
    date: "2026-06-10",
    changes: [
      "Activity logging redesigned: log any activity (run, swim, yoga, etc.) from a Log Activity sheet on Workout Select, with type, title, time, duration, distance, and calories",
      "Health > Training tab now shows an Activities history card with the last two weeks of logged activities, including heart rate and notes when expanded",
      "Activity types are now configurable in the Admin Console — add, edit, reorder, and delete custom activity types with their own icon",
      "Health Connect sync now backfills heart rate, distance, and calories onto recently-logged activities once that data becomes available",
    ],
  },
  {
    version: "1.23.1",
    date: "2026-06-10",
    changes: [
      "Fixed: the Admin Console link lived on a dead profile page only reachable via the home avatar or Health 'Goals' link — it's now in More > Profile",
      "Home screen widget customization (which tiles/cards show, their colours, weight chart length) moved into More > Profile under 'Home Widgets'",
      "Home avatar and Health 'Goals' link now open More > Profile directly",
    ],
  },
  {
    version: "1.23.0",
    date: "2026-06-10",
    changes: [
      "Bodyweight exercises (push-ups, pull-ups, sit-ups, dips, etc.) now have their own workout UI — reps are the main control, with an optional collapsible 'Add weight' for weighted/assisted variants",
      "1RM, PR tracking, and intensity % for bodyweight exercises now factor in your logged bodyweight plus any added/assisted load",
      "Set targets, warmup suggestions, and 'Next Session' weight targets are hidden for bodyweight exercises since they don't apply",
      "Exercise library admin and Add Exercise now let you mark an exercise as Weighted or Bodyweight",
    ],
  },
  {
    version: "1.22.0",
    date: "2026-06-09",
    changes: [
      "You can now add new exercises to the library yourself — from exercise search, the workout builder swap panel, or the admin manager",
      "Just type a name and tap Generate — AI fills in the proper name, instructions, target muscles, and equipment",
      "Before saving, similar exercises already in the library are suggested so you can reuse or rename instead of creating a duplicate",
      "AI-generated names now follow the equipment naming convention (e.g. 'Hip Thrust' becomes 'Barbell Hip Thrust')",
      "Fixed: similar-exercise suggestions sometimes didn't show up the first time you opened Add Exercise in a session",
    ],
  },
  {
    version: "1.21.0",
    date: "2026-06-09",
    changes: [
      "Food log delete now asks for confirmation before removing an entry — no more accidental deletes",
      "Section drag-reorder on the home screen no longer scrambles position when sections are hidden",
      "Day overlay date header now shows the correct date before 10am (was showing yesterday due to UTC parsing)",
      "Distance tile no longer incorrectly opens the Steps detail sheet",
      "Home screen and health tab localStorage reads (water goal, target weight, target body fat) moved to proper React state — no longer re-read on every render",
      "Cache TTL comparisons now use epoch ms instead of ISO string — more reliable and compliant",
      "Achievements API now caches for 30 seconds to reduce DB load on the profile page",
      "Fixed exercise admin 'Save failed' error caused by null gifUrl/imageUrl failing validation",
    ],
  },
  {
    version: "1.20.9",
    date: "2026-06-09",
    changes: [
      "Recommended Today card now has a colour picker in home screen edit mode — tap the dot top-right to change the accent colour (card, border, progress bar, Start button all update together)",
      "AMRAP baseline 1RM cap: reps capped at 36 before Epley formula so very high-rep AMRAP sets no longer produce absurdly inflated 1RM estimates",
    ],
  },
  {
    version: "1.20.8",
    date: "2026-06-09",
    changes: [
      "Sleep vs Performance now compares % deviation from each exercise's own baseline instead of raw average 1RM — removes the exercise-selection bias that made heavier compound days skew the numbers",
      "Exercises need at least 3 logged sessions to contribute a baseline; single-session exercises are excluded",
      "Buckets now show +X% / −X% relative to baseline; below-baseline buckets display in red",
    ],
  },
  {
    version: "1.20.7",
    date: "2026-06-09",
    changes: [
      "ACWR now requires at least 4 non-deload sessions in the 28-day window with at least 2 older than 7 days — prevents skewed ratios from sessions bunched in the acute window with no chronic baseline",
      "Sleep vs Performance card now shows 'Not enough data yet' when there isn't sufficient paired sleep + workout data, matching the ACWR card's pattern instead of showing a raw status string",
    ],
  },
  {
    version: "1.20.6",
    date: "2026-06-09",
    changes: [
      "Calendar day detail sheet (Health → Training) now shows edit and delete buttons on each exercise row again — tap pencil to edit per-set weight/reps, tap trash to remove",
      "Fixed double macro display on single-item meal cards — P/C/F totals footer only appears when 2+ items are logged in a meal",
      "Railway builds now cache node_modules and .next/cache between deploys — build time should drop from ~7 min to ~2 min after the first warm build",
    ],
  },
  {
    version: "1.20.5",
    date: "2026-06-09",
    changes: [
      "Saved Meals reworked: single tabbed sheet with My Meals list (log / edit / delete) and inline Build tab — no more separate collapsible section and builder sheet",
      "Edit a saved meal by tapping the pencil — switches to Build tab pre-populated with existing ingredients at top",
      "Fixed double macro display in meal cards — P/C/F totals footer only shown when a meal has more than one item",
      "Equipped title now persists across full app restarts via localStorage",
    ],
  },
  {
    version: "1.20.4",
    date: "2026-06-09",
    changes: [
      "Edit saved meals: tap the pencil icon on any saved meal to update its name or ingredients in place",
      "Tappable title on More > Profile tab: tap your equipped title (or 'Tap to set title') to open the title picker",
      "Fixed exercise summary next-session grid overflowing when a progression style has more than 5 sets",
    ],
  },
  {
    version: "1.20.3",
    date: "2026-06-09",
    changes: [
      "More > Profile tab now shows your full profile: avatar, level, XP bar, stats, achievements, goals, and appearance settings — no more separate Goals page link",
    ],
  },
  {
    version: "1.20.2",
    date: "2026-06-09",
    changes: [
      "Nutrition photo scan: photo now shows a preview + optional context field before sending to AI — add notes like 'it\\'s protein pasta' to improve accuracy",
    ],
  },
  {
    version: "1.20.1",
    date: "2026-06-09",
    changes: [
      "Fixed profile name/details showing as blank on first app load — now server-rendered with no flash",
      "Fixed cycle progress bar always showing empty — session ID now correctly linked when logging exercises",
      "Progress bar now shows per-phase progress (resets each phase) instead of whole-program progress",
      "Fixed nutrition photo scan showing 'Network error' instead of a real error message when AI is unavailable",
    ],
  },
  {
    version: "1.20.0",
    date: "2026-06-08",
    changes: [
      "Nav restructure: bottom nav now has Home, Nutrition, Workout, Health, and More tabs",
      "Nutrition moved to its own standalone page (/nutrition) — no longer buried inside Health",
      "Health tab now has Body / Training / Progress sub-tabs — training stats and calendar visible without leaving Health",
      "More tab (/more) replaces separate Profile/Config pages — contains Profile, Achievements, Friends, and Config",
      "Friend system: add friends by email or TAI-XXXX code, activity feed shows friends' PRs and workouts",
      "Friend leaderboard: weekly and all-time rankings for sessions, volume, and streak",
      "Achievement badge tiers: Bronze / Silver / Gold borders and glow based on XP reward",
      "New badge shimmer animation on first view of a newly-unlocked achievement",
      "Trophy case: pin up to 3 achievement badges to your profile showcase",
      "Equippable titles: earn titles by unlocking milestone achievements, display alongside your name",
      "Season system: quarterly snapshots with Gold/Silver/Bronze placement badges",
      "Public profile pages at /profile/[userId] — visible to friends",
      "Weekly AI digest now includes friends activity context",
      "Log Activity placeholder on Workout tab (activity logging deferred to next session)",
    ],
  },
  {
    version: "1.19.0",
    date: "2026-06-08",
    changes: [
      "Google Calendar: workout events now save automatically at end of session (was silently skipped because the session log was cleared before the calendar call)",
      "Complete Workout button now appears instantly after finishing the last exercise (previously required an API round-trip to reappear)",
      "Cycle progress bar moves after every logged session, not just on full-cycle completion — shows exact session-level progress through the program",
      "Health tab body metric sheets and nutrition settings now dismiss with Android back gesture",
      "Body tab log/info buttons enlarged to meet 44dp touch target minimum",
      "Samsung WebView gradient backgrounds fixed on Body tab cards (willChange: transform compositor fix)",
      "Done screen safe-area padding prevents buttons being hidden behind gesture bar",
      "Exercise summary sets grid now supports 4–5 sets without layout overflow",
      "Timezone-correct streak calculation — streak no longer resets incorrectly before 10am AEST",
      "Food and workout streaks now use AEST dates (were using UTC, causing wrong dates before 10am)",
      "User upsert now correctly resolves email conflicts, preventing duplicate user rows on re-auth",
      "Exercise log and set data now written in a single DB transaction — no more partial logs on network drop",
      "Session name now always correct in exercise logs (fixed stale closure)",
      "High-rep sets (>30 reps) excluded from 1RM calculation to prevent inflated estimates",
      "Date format with dashes now correctly handled in exercise log route",
      "Saved meal quick-log now invalidates nutrition cache immediately",
      "Body metric save no longer briefly flashes old value after writing",
      "Sync-workout no longer double-counts sessions on re-sync",
      "Next-session API no longer crashes for users with null timezone",
    ],
  },
  {
    version: "1.18.0",
    date: "2026-06-08",
    changes: [
      "Workout builder: optional baseline week — toggle 'Add baseline test week' on review to prepend an AMRAP test cycle before your program starts",
      "Baseline week: each exercise shows AMRAP Test instructions instead of set targets — pick a challenging weight and do as many reps as possible",
      "Baseline 1RM: rep count is scaled down by a rep-band factor (≤5 reps: 100%, 6–8: 97%, 9–12: 93%, 13–20: 88%, >20: 82%) for a conservative estimate that seeds your working weights",
      "Baseline PRs are always recorded even if a deload flag is active",
      "Exercise ready screen shows suggested starting weight (~65% of last known 1RM) during baseline",
      "Set card badge shows 'A' and logged row shows 'AMRAP · Logged' during baseline",
    ],
  },
  {
    version: "1.17.0",
    date: "2026-06-07",
    changes: [
      "Home screen edit mode no longer locks scrolling — drag-to-reorder works without preventing normal scroll",
      "Card widgets (Weight, Nutrition, Sleep, Steps, Mood) now have colour pickers — tap the colour dot in edit mode or go to Profile → Card Widgets",
      "Streak and This Week sections also have colour pickers in edit mode",
      "Nutrition: Saved Meals section on the Health tab — quick-log a saved meal in one tap",
      "Nutrition: food logger now has Recent / Saved Meals / Add Food tabs",
      "Meal builder: when a food search returns no results, a link appears to add the searched item as a new food immediately",
      "Workout builder: new Program Length step — pick 8 / 10 / 12 / 14 / 16 / 20 weeks or use a custom stepper",
      "Workout builder review: phase cycle counts are scaled to your chosen program length and can be edited per-phase",
      "Workout builder: linear programs no longer incorrectly show phases",
      "Workout builder: phase structure picker no longer includes 'Linear Progression' as an option (it belongs to linear mode)",
    ],
  },
  {
    version: "1.16.0",
    date: "2026-06-07",
    changes: [
      "Metric tiles on home screen now navigate to the Body tab when tapped, and show a Log chip to log data without navigating",
      "Streak and This Week cards tap through to Stats",
      "Advanced Settings (Progression Sets + Phase Sets) moved inside the Workouts section in Config, collapsed by default",
      "Body screen: new tiles for Distance, Calories Burned, BMI, Weight Trend, Energy Balance, and Lean Mass",
      "BMI category now uses body fat % thresholds when available — accurately classifies muscular builds as Athletic instead of Overweight",
      "Log buttons added to Body Fat % and Steps tiles",
      "BMI, Trend, Balance, and Lean Mass tiles have a small ⓘ button that reveals how the value is calculated",
      "Profile: sex field added (Male / Female / Other) and date of birth simplified to birth year only",
      "Profile: Goals section renamed from Daily Goals; duplicate achievements button removed",
    ],
  },
  {
    version: "1.15.0",
    date: "2026-06-07",
    changes: [
      "APK: long-press any home section to drag and reorder — no longer need to tap the grid edit icon first",
      "APK: screen stays on during active workout and rest timers — returns to normal timeout after workout is done",
      "APK: PiP no longer opens when pressing Home from the pre-workout screen",
      "APK: haptic feedback now works reliably (VIBRATE permission was missing from the manifest)",
      "Powerbuilding goal % range corrected to 80–90% in the training goal selector",
      "This Week counter now shows the correct target from your program schedule instead of a hardcoded 5",
      "Builder phase review shows amber 'style missing' warning if a phase has a null style, rather than silently showing only the cycle count",
      "Saving body metrics, food logs, and nutrition targets now reflects immediately rather than serving stale cached data",
      "Mood log, readiness score, and history day overlays are now cached — fewer server round-trips on each home screen load",
      "Sign-out clears all local cache so a second account on the same device cannot see the first user's cached data",
      "Security: food search LIKE wildcards now escaped; workout completion restricted to session owner",
      "AI chat and sleep correlation date windows fixed for AEST users (were returning UTC dates, showing wrong day's data before 10am)",
    ],
  },
  {
    version: "1.14.0",
    date: "2026-06-07",
    changes: [
      "Fixed S+H Progression Peak phase showing '2 cycles' with no sets/reps detail (Strength 4-set style was missing due to a silent migration failure)",
      "Training goal selector redesigned as a spectrum scale — shows where each goal sits on the volume-to-intensity continuum with accurate % ranges",
      "Home screen sections can now be individually hidden — tap the eye icon in edit mode, or toggle in Profile → Home Widgets → Home Sections",
      "Hidden sections shown in a 'Hidden sections' restore panel at the bottom of the home screen while in edit mode",
    ],
  },
  {
    version: "1.13.2",
    date: "2026-06-06",
    changes: [
      "Fixed Health Connect steps, distance and calories combining two days into one on fresh sync",
      "Fixed builder phase progression showing no sets/reps detail for Hypertrophy Intensification (and audited all goal phase sets)",
      "Fixed '~Xw left' showing whole-block time remaining instead of current phase time remaining",
    ],
  },
  {
    version: "1.13.1",
    date: "2026-06-06",
    changes: [
      "PiP workout view now shows a circular ring timer — arc fills during rest, pulses during a set, turns red when you go over time",
      "PiP set controls reordered to Reps −, Reps +, Log",
    ],
  },
  {
    version: "1.13.0",
    date: "2026-06-06",
    changes: [
      "Download the Android APK directly from the app — link in Profile → About and a dismissible banner on the home screen",
      "APK link always points to the latest GitHub release — no manual update needed",
    ],
  },
  {
    version: "1.12.0",
    date: "2026-06-06",
    changes: [
      "AI builder: 4 training goals (Hypertrophy, Strength + Hypertrophy, Powerbuilding, Strength) each auto-select the correct phase progression — no manual phase picker step",
      "Builder review screen now shows the full phase progression timeline (Accumulation → Intensification → Peak → Testing → Deload) with cycle counts and set/rep/% info before saving",
      "Powerbuilding goal uses Powerbuilding Progression: 4 accumulation cycles at 4×6 @ 80%, intensification at 5×5 @ 85%, peaking at 3×3 @ 90%",
      "Going back from the review screen now clears the generated program so re-generating picks up the new goal",
    ],
  },
  {
    version: "1.11.0",
    date: "2026-06-05",
    changes: [
      "Workout builder now fills large muscles (chest, back, quads, hamstrings, glutes) to their target sets before adding shoulder/arm isolation work",
      "Builder generates clean session names — Push, Pull, Legs, Upper Push, Lower Squat etc. — no parenthetical muscle annotations",
      "Home screen card widgets (Sleep, Steps, Mood, Nutrition, Weight Trend) are now individually draggable anywhere in the feed",
      "Nutrition: custom name input appears when saving a food item to your library",
      "Profile widget toggles and card corner icons now use crisp Lucide vector icons instead of emoji",
      "Theme colour picker: rainbow hue slider lets you pick any accent colour, alongside the 8 preset swatches",
    ],
  },
  {
    version: "1.10.1",
    date: "2026-06-05",
    changes: [
      "Fixed tinted card backgrounds (streak, this week, nutrition) disappearing in the Android APK after loading",
    ],
  },
  {
    version: "1.10.0",
    date: "2026-06-05",
    changes: [
      "AI workout builder now assigns Powerbuilding (4×6 @ 80%) to primary compounds for strength+hypertrophy goals — the sweet spot between strength and size",
      "6 new progression style variants added: Hypertrophy 3-set, Strength 3-set, Strength 4-set, Peak 4-set, General 4-set, and Powerbuilding",
      "Strength style updated to 5×5 @ 80% — more strength volume per session",
      "Rest times are now percentage-driven: 80% intensity = 120s rest, 90% = 180s rest",
      "AI builder time budget is now accurate for each goal type — strength+hypertrophy sessions correctly account for longer rest periods",
      "Swapping an exercise in the builder review now keeps its progression style assignment",
      "AI chat refinements now correctly preserve and assign progression styles",
      "Builder now returns a clear error if no exercises match your equipment selection, instead of generating an invalid program",
    ],
  },
  {
    version: "1.8.3",
    date: "2026-06-04",
    changes: [
      "Barbell Squat now shows the correct GIF — fixed dataset name lookup (Barbell Full Squat) that was returning unrelated exercises",
      "Dumbbell Curl GIF corrected — matched to Dumbbell Biceps Curl in the dataset",
      "GIF sync now covers all exercises in the library, not just ones already in your program or history — fixes 'No GIF' for exercises like Adductor Machine",
      "Exercise GIF unmatched count in admin now reflects the true number across the full library",
      "Recovery pills on the workout selector now show all muscles trained in the session — no more single-muscle pill looping",
      "Home screen sleep and nutrition no longer show yesterday's data after midnight — cache is date-validated before use",
      "Workout header no longer briefly flashes the session UUID before the name loads",
      "Admin page and profile page now show the bottom navigation bar consistently",
      "Exercises tab in admin console now correctly labelled (was showing 'Invites')",
    ],
  },
  {
    version: "1.8.2",
    date: "2026-06-04",
    changes: [
      "Exercise names now include equipment — workouts show 'Barbell Squat', 'Dumbbell Romanian Deadlift', 'Cable Lateral Raise' etc. for accurate GIF matching",
      "All exercise history preserved — existing logs automatically migrated to the new specific names",
      "AI workout builder now includes a schedule step — choose rolling rotation (with live example) or fixed weekly days",
      "Session names no longer show as UUIDs in the workout header — displays the human-readable name",
      "Muscle heatmap on the workout selector correctly reflects the session's actual exercises",
      "Session names in calendar and training load legend are cleaner — AI-generated parenthetical muscle lists stripped",
      "Setting a program as active is now instant (optimistic update)",
    ],
  },
  {
    version: "1.8.1",
    date: "2026-06-03",
    changes: [
      "Active workout header now shows phase name and cycle number (e.g. Hypertrophy · C2/4) when using a phase-based program",
      "Meal types in Nutrition Settings can now be drag-to-reordered — grip handle is functional",
      "Safe-area insets added to all scrollable pages — content no longer clips behind the home indicator on notched devices",
      "Multiple timezone bug fixes: ACWR chronic load span, morning briefing date window, and early-deload banner rollover all now respect the device timezone",
      "Faster workout logging — set writes are now a single batch DB insert instead of one query per set",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-06-03",
    changes: [
      "AI-powered workout builder: 7-step wizard generates personalized training programs via Gemini based on equipment, time, goals, and muscles",
      "Intelligent exercise count calculation — 60min session = ~5 exercises; scales with available time and training frequency",
      "Science-backed volume guidelines built into AI prompts — hypertrophy 10–20 sets/muscle/week, strength 15–25, mixed 15–20",
      "Recommended training splits based on frequency: 1d=Full Body, 2d=Full Body×2, 3d=PPL, 4d=UL×2, 5d=PPL+Upper+Lower, 6d=PPL×2",
      "Equipment selection with two distinct categories: Home gym (individual pieces: dumbbells/barbell/cables/kettlebells) and Commercial gym (Full Gym standalone)",
      "Days per week dial — WeightDial component now perfectly centred regardless of viewport size",
      "Review screen with exercise swap dropdowns — instantly swap to alternative exercises for the same muscle group",
      "AI refinement chat — message the AI to request changes (e.g., 'Make it more glute-focused') and see the program update in real-time",
      "Save to templates — generates program saves to the workout templates library via existing API",
      "Phase set integration — auto-resolves phase structure names (Linear Progression, Baselining, Phase-Based Progression) with graceful fallback logic",
      "Rate limiting 20/hr per user on both generate and chat endpoints — prevents abuse while allowing interactive refinement",
    ],
  },
  {
    version: "1.7.2",
    date: "2026-06-02",
    changes: [
      "Accessibility: added aria-labels to all icon-only buttons for screen reader compatibility",
      "Food logger back-navigation fixed via step stack — prevents 'libraryItemId' heuristic bugs",
      "Meal-type chips and quantity buttons enlarged to 44dp minimum (Android touch target)",
      "Recent items row height set to 48dp minimum for easier tapping",
      "Exercise stats sheet: added AbortController to prevent stale fetch overwrites when switching exercises",
      "Exercise stats sheet: error state now displays instead of blank sparkline on fetch failure",
      "Rate-limit map now prunes expired entries every 5 minutes to prevent unbounded growth on long-running servers",
      "Mobile auth token pruning continues to clear expired tokens on create/validate",
      "Barcode and exercise-gif parameters now validated with Zod for length and format constraints",
      "Rest timer ring and weight dial now responsive — adapt to viewport size for better mobile UX",
      "Per-key in-flight lock added to cachedFetch to prevent concurrent fetches for the same cache key",
    ],
  },
  {
    version: "1.7.1",
    date: "2026-06-02",
    changes: [
      "Session type switching now resets stale workout state — prevents weight/rep carryover when changing from Push to Pull, etc.",
      "Rep +/− buttons enlarged to 48×48dp (Android minimum touch target) for easier tapping on mobile",
      "1RM calculation guards against empty weight arrays — prevents -Infinity propagation from edge cases",
      "Workout store now tracks date and resets yesterday's logged exercises on app reopen — fixes pre-workout screen showing old data",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-06-02",
    changes: [
      "Block Periodization mode for training programs — defines a sequence of named phases (Accumulation → Intensification → Peak → Deload) each with a progression style and duration",
      "Phase editor in Config: drag-to-reorder phases, set duration in cycles, assign Primary and Secondary styles per phase",
      "Enabling Block Periodization auto-populates 5 default phases with sensible styles (Hypertrophy, Strength, Peak, Deload, General)",
      "New Accessory phase type: accessories always follow the Accessory phase style regardless of the current block — set it once, never think about it again",
      "Default progression styles (Hypertrophy, Strength, Peak, Deload, General) seeded automatically for new users",
      "Phase badge shown on session cards on the workout select screen",
      "Block progress card on home screen — shows current phase name, cycle within phase, and approximate weeks remaining",
      "Early deload card on home screen when the readiness score recommends backing off",
      "Deload banner and current phase indicator shown on the pre-workout screen",
      "Deload sessions excluded from all stats aggregates (volume, sets, intensity, duration) and from the chronic ACWR window",
      "Deload days marked with an amber 'D' badge on the weekly training load bar chart",
      "Phase and early-deload flag stamped on every workout session for accurate historical reporting",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-06-01",
    changes: [
      "7-day nutrition chart on Health tab — bar chart showing calories, protein, carbs, or fat per day with a metric toggle",
      "Today's bar turns orange when over calorie target; 7-day average shown as caption",
      "Recently logged items shown in the food logger when a meal slot is pre-selected — tap to re-log without scanning",
      "Daily calorie progress bar in the Assign step — shows total calories today + this item vs. target",
      "AI scan confidence now shown as a colour-coded percentage bar (green/amber/orange) instead of a text badge",
      "Barcode not-found now shows a dedicated screen with 'Scan photo instead' and 'Enter manually' options instead of silently falling back",
      "AI chat now includes today's food logs and nutrition targets in its context — Claude knows what you've eaten today",
      "Workout cache invalidated after saving program config — exercise list now reflects changes immediately without requiring a manual reload",
      "Package renamed from 'google-sheet-super-agent' to 'trainingai'",
    ],
  },
  {
    version: "1.5.2",
    date: "2026-06-01",
    changes: [
      "Barcode scan now returns correct per-serving macros — previously returned per-100g values, inflating numbers by up to 2.5× for a 40g bar",
      "Serving size parser handles formats like '1 bar (40g)' correctly",
      "Adjusting serving size in the Review step live-scales all macros proportionally",
      "Food logs and saved meal quick-log now use AEST date — items logged before 10am were being filed under yesterday's date and not appearing",
      "Timezone rule added to CLAUDE.md as a standing instruction to prevent future UTC date bugs",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-05-31",
    changes: [
      "Barcode scanner now uses native Capacitor MLKit on Android — faster, better in low light; static import fixes 'failed to resolve module specifier' error",
      "Barcode scanner camera pass-through fixed: portal to document.body + CSS visibility hide so the nutrition page no longer bleeds through behind the camera",
      "Nutrition data cached in SQLite (meal types + targets: 6h TTL, today's food logs: 60s TTL) — loads instantly on return visits",
      "Nutrition date now uses AEST timezone — food logs and mood fetch no longer show the wrong day before 10am AEST",
      "Warmup exercise strip now shows animated GIFs instead of static JPEG thumbnails",
      "Session timer no longer carries over between workouts — switching from Pull to Push resets the timer",
      "Bottom nav shows 'Leave workout?' confirmation when navigating away mid-workout",
      "beforeunload warning added when trying to close the app mid-workout",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-05-31",
    changes: [
      "Full nutrition logging system: AI photo scan, barcode scan (Capacitor + ZXing), free-text AI description, manual entry",
      "Gemini 3.1 Flash Lite analyses food photos and text descriptions — returns calories, protein, carbs, fat, fiber, sugar, sodium, saturated fat",
      "Barcode scanning looks up Open Food Facts database; falls back to manual entry if not found",
      "Dynamic meal types (Breakfast, Lunch, Dinner, etc.) — fully user-configurable, auto-suggested by time of day",
      "Saved meal templates for one-tap quick-logging of repeated meals",
      "Custom daily macro targets (calories, protein, carbs, fat, fiber) stored in DB",
      "Nutrition tab moved first in Health tab order; macro ring + meal cards replace the static placeholder",
      "Food region setting (AU/US/UK/NZ) biases AI toward local brands — stored per user",
      "Calorie goal migrates from localStorage to nutrition_targets DB automatically on profile load",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-05-31",
    changes: [
      "Stats page redesigned: calendar at top, training load below, weekly AI summary as a compact pill at the bottom",
      "Training load bars now reflect actual session volume (kg lifted) — heavier sessions show taller bars",
      "Weekly AI summary collapses to a single-row pill by default; tap to expand the full weekly analysis",
      "All dates and times throughout the app now use your local timezone (GMT+10) — no more UTC drift",
      "Training load bars colour-coded by session type, matching calendar dot colours",
      "Readiness score moved to the home/overview page",
      "Weekly stats window fixed to Monday–Sunday ISO week; abandoned sessions no longer inflate counts",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-05-30",
    changes: [
      "Exercise GIFs and thumbnails now show in the stats sheet and warmup screen — JPEG loads instantly, animated GIF swaps in once ready",
      "Exercise media sourced from forked dataset (1,324 exercises) — no API key or cost required",
      "Media cached in DB on first use per exercise; every subsequent open is instant",
      "AI chat context capped: 14-day body metrics window, compact summaries for sessions older than 15, 10k-char hard limit on training data",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-05-30",
    changes: [
      "Morning briefing now pops up as a dismissible sheet — no longer a static card on the home screen",
      "Morning briefing resets at local midnight (AEST) instead of UTC midnight",
      "Muscle recovery strip auto-scrolls through all muscles as a marquee — no touch required",
      "Recovery strip filters to the current session's muscles and updates as you swipe between sessions",
      "Recovery data cached locally — pills appear instantly on return visits",
      "CLAUDE.md updated to reflect PostgreSQL data model — removed all stale Google Sheets references",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-05-30",
    changes: [
      "Muscle recovery estimator — colour-coded chips on workout select screen showing recovery % per muscle group since last session",
      "Exercise library filters now dynamic — tabs match your actual program sessions instead of hardcoded Push/Pull/Legs",
      "AI morning briefing card on home screen — Gemini 2-3 sentence daily summary of sleep, training load, and HRV, cached per day",
      "ACWR and Sleep vs Performance cards moved from Stats to Health page",
    ],
  },
  {
    version: "1.1.1",
    date: "2026-05-30",
    changes: [
      "Admin console speed — isAdmin stored in JWT, eliminating extra DB lookup on every admin request",
      "Pending-user badge now visible on home screen profile avatar button",
      "Calendar workout start times fixed — AEST midnight no longer incorrectly treated as real start",
      "Weekly digest now renders Gemini markdown (bold, lists, headings) correctly",
      "Training Load (ACWR) card: added explanatory info panel with threshold guide",
      "Sleep vs Performance card: added explanatory info panel",
      "Mood check-in shortcut added to Trained Today / Recommended card on home screen",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-05-30",
    changes: [
      "Admin notification badge on Profile showing pending user count",
      "AI chat context truncation — capped at 20 turns and 50 sessions to stay within Gemini limits",
      "Program week tracker on Profile stats strip — shows weeks running and prompts review at 12w",
      "Workout start time wired through to DB — session duration now reflects actual start, not midnight",
      "Lean mass trend chart on Health > Body tab derived from weight + body fat %",
      "Acute:Chronic Workload Ratio (ACWR) insight card on Stats page",
      "Personal record tracker — new all-time 1RM detected per exercise, trophy card on Done screen",
      "All-time 1RM shown in exercise stats sheet",
      "Readiness/Energy Score card on home screen from sleep, HRV, RHR, and training load",
      "Sleep vs Performance correlation insight on Stats page",
      "Weekly AI digest card on Stats page — Gemini summary, cached by week",
      "Removed all hardcoded Push/Pull/Legs session name assumptions across the codebase",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-05-30",
    changes: [
      "Workout select: single-card carousel with fixed muscle body diagram",
      "Muscle heatmap stays visible during session swipes — only colours update",
      "Chart.js sparklines with last-value label in exercise stats and summary",
      "Health Connect: SpO₂, HRV, resting heart rate sync",
      "Workout state persists across page reloads (Zustand + localStorage)",
      "Session timer runs from warmup through to workout complete",
      "Mood check-in moved to warmup screen",
      "Offline-first workout logging with outbox sync",
      "Drag-to-reorder home screen sections",
      "Native Android APK with Health Connect integration",
    ],
  },
];

export const CURRENT_VERSION = CHANGELOG[0].version;
