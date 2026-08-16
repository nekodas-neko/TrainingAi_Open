# Device Smoke Checklist

One page, ~5-minute pass on the Samsung Galaxy S25 Ultra. Run after any merge that
touches a screen layout, an offline-sync domain, a gesture handler, a card/SVG grid,
or a notification/reminder — i.e. anything CLAUDE.md flags as unverifiable in the
web sandbox. Not every merge needs every section; use judgement, but default to
running the sections relevant to what changed. Per CLAUDE.md's Canonical Runtime section, this
checklist is the **merge gate** for anything the web sandbox can't exercise — green `pnpm dev`
alone is never sufficient for offline-first domains, native plugins, safe-area, gestures, or
notifications.

## 1. Safe-area

- Open every new/changed screen. Confirm content clears the status bar at the top
  and the gesture bar / bottom nav at the bottom — no button or text sits under
  either.
- Repeat in **both** light and dark theme (Settings → theme toggle).
- Toggle Android's navigation mode (Settings → System → Gestures → System
  navigation → Gesture / 2-button / 3-button) and re-check the same screens — the
  inset differs by mode and gesture-nav is not the only config real users have.

## 2. Offline round-trip

- Log a food entry, a mood check-in, and a body metric while online — confirm each
  appears immediately.
- Enable airplane mode. Repeat the same three writes. Confirm they still appear
  (local-first read) with no error toast.
- Force-close the app (recent-apps swipe-away, not just backgrounding) while still
  in airplane mode. Reopen — confirm all six entries are still there.
- Disable airplane mode. Confirm the outbox drains (sync-health indicator returns
  to synced, or the entries later show as synced) without a manual pull-to-sync.

## 2b. Offline shell availability (the merge gate for the offline-shell change)

- With the app open and online, browse Home once so the SW is installed and
  precaching has run (More → About shows "Service worker active").
- Enable airplane mode. Force-close the app (recent-apps swipe-away). Reopen —
  confirm it cold-starts to Home, not a blank/error page.
- Still offline, tap every bottom-nav tab (Home, Workout, Nutrition, Health,
  More). Confirm each renders its saved data with the "Offline — showing saved
  data" pill, and NONE shows a Chromium error page or "Loading chunk failed".
- Still offline, open a screen you have never visited on this build — confirm it
  shows the in-app "You're offline" screen WITH the bottom nav (not a dead-end).
- Disable airplane mode while on that screen — confirm it auto-recovers (reloads
  the screen) without a manual tap.
- Deploy-survival: after the NEXT deploy lands, open the app once online, then go
  offline and repeat the tab sweep — coverage should hold (the previous cache
  generation is retained).

## 3. Console

- Connect `chrome://inspect` (USB debugging) or check `adb logcat` for the
  WebView's console output.
- Confirm no `[initSQLite] failed` line — that means the local store never opened
  and every read/write in step 2 was silently served from nothing.
- Confirm no uncaught hydration-mismatch warnings on the screens touched.

## 4. Gestures

- On a screen with pull-to-sync, start a slow vertical drag from the very top —
  confirm the refresh indicator engages and normal scroll still works below the
  fold (the gesture must direction-lock, not swallow scrolling — sessions 150/152).
- On a drag-reorderable list (program editor, card order), reorder two items, then
  navigate away and back — confirm the new order persisted (not just visually
  during the drag).

## 5. Rendering

- On any screen with adjacent cards containing an SVG (muscle heatmap, sparkline,
  score ring), confirm sibling cards keep their gradient background — Samsung's
  WebView compositor has wiped these before.
- On a running timer (workout rest/set timer), watch it tick for ~10s — confirm no
  visible jank or dropped frames from a parent re-rendering on every tick.

## 6. Notifications

- If a change touched a reminder or rest-timer notification, trigger it (or set a
  short test value) and confirm it fires within ~1 minute of the expected time,
  with the correct title/body.

## 7. Oura direct-BLE (only if the BLE pipeline changed; APK rebuild first if Kotlin changed)

- Open the app → the "TrainingAI · Oura Ring" foreground notification appears without
  touching `/admin/oura-ble` (auto-start), and lands on "Connected · auth OK" (ring must
  be awake — on charger, or worn + moving; a worn-idle ring's radio sleeps by design).
- On `/admin/oura-ble`: status pill **Connected**, battery %, and the Advanced log shows
  `enabled measurement features (DAYTIME_HR + SPO2 + REAL_STEPS → automatic)` with three
  `set_feature_mode_ack` frames.
- **Steps capture** (only when working the steps decoder — plan
  `docs/superpowers/plans/2026-07-09-oura-ble-steps.md`): with the ring worn, walk a
  counted distance (e.g. 100 steps), tap **Sync now**, and confirm the Frames counter now
  lists `real_step_event_feature_1`/`_2` climbing. If those tags never appear after the
  walk, the REAL_STEPS enable didn't stick — tap **Feature status** and check the `0x0b`
  mode before touching the decoder.
- Tap **Sync now** → log shows `drain start from cursor=N`, batches progress,
  `bytes_left` trends to 0, `drain complete`; the "Recorded to server" tiles and the
  cadence/span block update to cover the drained window.
- Re-tap Sync now immediately → stored count stays ~0 (dedup) and the cursor doesn't
  regress.
- One-time device config for the persistence soak: Settings → Battery → add TrainingAI
  to **Never sleeping apps** (Samsung kills long-lived foreground services otherwise).

## Instant nav & app open (2026-07-11 plan)
- [ ] Tab taps: with remote devtools (chrome://inspect) attached, tap between all five tabs — revisits within ~5 min issue NO `?_rsc=` network requests and paint instantly.
- [ ] Cold open (app killed, warm cache): the splash shows, and the home screen paints in well under the previous multi-second wait; airplane-mode cold open still reaches the offline behaviour (the offline-shell checklist section).
- [ ] More → pull-to-sync, then visit Home/Health/Nutrition: all paint instantly (no skeleton wall — the cache-wipe regression stays dead).
- [ ] First open after a deploy: expect the one-time slower load (full re-download) — verify the SECOND open is instant again.

## Persistent tab shell (2026-07-14 — v1.144.0)
- [ ] Tab taps: switch between all five tabs repeatedly — every switch after a tab's first open is instant (no skeleton, no repaint of the old screen, no network in remote devtools), including after leaving the app idle >5 min.
- [ ] Scroll: scroll Home to the bottom, visit two other tabs, return — scroll position is exactly where it was.
- [ ] State: open Health's Body sub-tab, switch away and back — still on Body. Nutrition on a past date, switch away and back — still on that date.
- [ ] Cross-midnight: with the app alive across midnight (or device clock rolled), re-showing Nutrition/Home shows the new day, not yesterday.
- [ ] Android back button: from any tab, back exits the app (new intended behaviour — tab flips no longer stack history entries).
- [ ] Full-screen workout: start a workout, confirm the tab bar is gone; finish/leave → lands back in the shell; mid-workout tab tap still shows the leave dialog.
- [ ] Cross-tab links: Home's body-stats affordance opens Health/Body; Home's profile card opens More — both instant, no navigation flash.
- [ ] Edge-swipe: left/right switches tabs; opening a bottom sheet and edge-swiping does nothing (modal guard).
- [ ] Memory/jank: after visiting all five tabs, interact with the heaviest screens — no new jank vs. the pre-shell build (hidden tabs are content-visibility-skipped).
- [ ] Safe-area: the bottom nav still clears the gesture bar on every tab (unchanged, but re-confirm since the nav is now always mounted).

## AI Coach — the /coach route (2026-08-09, Q-157 phase 2)

**Why this section exists:** `/coach` is a full-screen navless route with a bottom-anchored
composer, which is the exact shape that has put a control under the gesture bar 11+ times. The
sandbox renders every safe-area inset as 0, so none of this could be checked before shipping.
Every entry below was verified in Chromium at 412×891 and is listed here because Chromium cannot
prove it on the device.

- [ ] **Composer clearance (the one that matters).** Open Coach from Home. The message box and send
      button sit clear of the gesture bar with a comfortable gap — not flush, not underneath. Try it
      with the keyboard open too: the composer should ride above the keyboard, not hide behind it.
- [ ] **Header clearance.** "AI Coach" and both 48dp round buttons sit below the status bar /
      punch-hole, not under it.
- [ ] **Entry points — all three reach Coach.** Home tab's floating sparkle button (bottom-right,
      above the nav bar and clear of the gesture bar) · `/overview`'s "AI Coach" text button ·
      the workout done-screen's "Ask AI Coach" button.
- [ ] **Back behaves.** The 48dp back arrow returns to where you came from, and the Android system
      back gesture does the same rather than exiting the app.
- [ ] **The conversation flow.** Tap "Change my workout" → a list of your real sessions appears →
      tap one → **it collapses into a message bubble showing what you picked**, and the next
      question appears. That collapse is the single most important behaviour on this screen.
- [ ] **Change your mind.** Tap that collapsed bubble — the picker should re-open.
- [ ] **Type instead of tapping.** With a list on screen, type an answer instead. The list should
      dim to show it has stepped aside, and the typed answer should work.
- [ ] **A real change.** Say "swap my deadlifts for romanian deadlifts". Check the confirmation
      card: the toggle renders as a **pill, not a black circle** (a global tap-target rule made
      every Switch in the app render as a circle — fixed in this PR, worth confirming on-device),
      the consequences read as true statements about your program, and Apply writes it. Then open
      Config and confirm the exercise actually changed.
- [ ] **Undo.** History (clock icon, top right) → the change is listed → undo it → the exercise is
      back. Undo is refused once you have trained since; that is intended, not a bug.
- [ ] **Offline.** Airplane mode, then open Coach and try to send: an explicit "You're offline"
      card appears, the composer is visibly disabled, and your unsent text stays on screen rather
      than vanishing. History still opens.
- [ ] **Both themes.** Switch light/dark with Coach open — no black-on-black, no white-on-white,
      and the widget cards keep their purple tint in both.
- [ ] **The tier-3 screen.** Say "change my sessions per cycle to 5". You should get a red-edged
      card that offers only "Review what this does" — no toggle, no Apply. Tap it: a full screen
      opens showing what you'd lose. Check the action row clears the gesture bar, then confirm a
      quick tap on "Hold to apply" does **nothing** and a ~1.5s hold applies and returns you.
- [ ] **Samsung WebView rendering.** No flicker or missing backgrounds on the widget cards while
      scrolling a long conversation.

## Sign-out wipes the device, not just the session (Q-172) — RUN THIS ONE FIRST

**Why this section exists:** the fix for this shipped, but `clearLocalStoreData()` is a **no-op in
the browser**, so the seven-table clear has *never actually executed anywhere*. It has only ever
been reasoned about. If it is wrong, the previous account's data stays on the device after sign-out.
Nothing in CI or `pnpm dev` can tell you either way.

- [ ] **Sign out from More → the sign-out button, and sign back in as the same account.** Everything
      should still be there. (This is the control — it proves the wipe isn't destroying live data.)
- [ ] **The real test.** Sign out, then sign in as a *different* account (or a fresh one). Check
      Home, Nutrition (food logs + supplements), Health (weight, sleep), and workout history. You
      should see **nothing** from the first account. Any row that leaks is the bug.
- [ ] **The sign-out button.** There used to be two, and only one ran the full clear — that was
      Q-172's leak. The other pair lived on the unreachable chat screen and was deleted with it
      (Q-189), so More/Profile is now the only one. If you find a second anywhere, that is a finding
      in itself — repeat the check above for it.
- [ ] **Offline sign-out.** Airplane mode → sign out → sign in as the other account. The local wipe
      must not depend on the network.

## Ring battery and the Home header (2026-08-12, v1.290.1 / v1.290.2)

**No new APK needed** — these are JavaScript changes, so they arrive with the Railway deploy. Just
force-close and reopen the app.

- [ ] **Home header.** The ring-battery icon is **gone** from the top-right cluster, leaving the
      reorder-sections and refresh buttons. Nothing else moved.
- [ ] **Header still clears the status bar.** The greeting and date sit below the punch-hole, and
      both remaining buttons are still comfortably tappable.
- [ ] **More → Oura Ring 5 card.** It shows a real **percentage** next to the "Live" pill, not
      "Not live". This has read "Not live" for over a month.
- [ ] **It refreshes.** Leave the More tab, come back — the percentage re-reads rather than
      freezing at whatever it first showed.
- [ ] **Health → Body → Ring.** The Battery tile still shows a percentage. Both cards now share one
      cache key, so this confirms the shared key didn't break the other reader.

## Cold app start (Q-147) — a measurement, not a pass/fail

**Why this section exists:** how long the app takes to open from cold has **never been measured on
the device**. Every performance decision so far has been made without that number, including one
project (bundling the shell into the APK) that was dropped on the assumption it wouldn't help.

- [ ] **Force-close the app** (recents → swipe away). Wait ~10 seconds so it is genuinely cold.
- [ ] **Open it and count** — phone stopwatch, or just count seconds out loud — from tap to the
      point Home is **usable**, not merely painted. Note whether you see a skeleton/pulse first.
- [ ] **Do it three times** and write down all three; the first is often slower than the rest.
- [ ] **Then a warm open** for comparison: leave the app, reopen it within a few seconds, and time
      that too.
- [ ] **Report the four numbers.** Three cold, one warm. That's the whole task — there is nothing
      to fix here until the number exists.

---

Fill in an on-device check like this in the PR description whenever CLAUDE.md's
"which failure surfaces were NOT exercised" rule applies — this checklist is the
concrete list of surfaces it's referring to.
