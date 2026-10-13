# Native mobile remaining work

Snapshot of the [deployment plan](https://chatgpt.com/space/page_c3a9c1659c348191bf8bf95e43fe8f2f), 13 October 2026. Keep this repository copy aligned when completing handover tasks.

Outstanding work following [PR #2836](https://github.com/nekodas-neko/TrainingAi_Open/pull/2836).

## Core functionality

- [ ] Add resumable downloads of supported account history for offline use, with progress and account isolation. [#2837](https://github.com/nekodas-neko/TrainingAi_Open/issues/2837)

## Deferred UI work

- [ ] Add drag reordering for programme sessions and exercises, preserving supersets. [#2838](https://github.com/nekodas-neko/TrainingAi_Open/issues/2838)

- [ ] Expand the session icon picker to all 22 original fitness icons with readable labels. [#2838](https://github.com/nekodas-neko/TrainingAi_Open/issues/2838)

- [ ] Add Markdown links, tables, italics, code and richer lists to Coach and generated explanations. [#2838](https://github.com/nekodas-neko/TrainingAi_Open/issues/2838)

- [ ] Add About source credits and release notes; show native app/build, app-code and backend versions distinctly. [#2838](https://github.com/nekodas-neko/TrainingAi_Open/issues/2838)

## Backend follow-ups

- [ ] Complete [#2813](https://github.com/nekodas-neko/TrainingAi_Open/issues/2813): ownership-scoped food reads by ID and manual supplement-dose reads by supplement/date. Remove client workarounds after verification.

## Deployment and internal rollout

- [ ] Obtain approval and pass CI on the reviewed implementation before merging. [#2840](https://github.com/nekodas-neko/TrainingAi_Open/issues/2840)

- [ ] Merge and release the backend changes for native sign-in, health imports, meal statuses, exercise media, profiles, activities and community. [#2839](https://github.com/nekodas-neko/TrainingAi_Open/issues/2839)

- [ ] Verify this PR's Health Connect ledger, affected-date projection queue and meal-status migrations in the deployed database before connected device acceptance. [#2839](https://github.com/nekodas-neko/TrainingAi_Open/issues/2839)

- [ ] Compare current-user nutrition, sleep/energy, training stress and permanent snapshots against an authorised database copy; record any historical calorie changes and obtain tuning approval where applicable. [#2839](https://github.com/nekodas-neko/TrainingAi_Open/issues/2839)

- [ ] Confirm required historical 1RM/recovery backfills have been applied. [#2839](https://github.com/nekodas-neko/TrainingAi_Open/issues/2839)

- [ ] Configure `EXPO_TOKEN`, separate development signing credentials, replacement-environment approval and the installed certificate fingerprint. [#2840](https://github.com/nekodas-neko/TrainingAi_Open/issues/2840)

- [ ] Verify the replacement APK retains `com.trainingai.app` and the installed app’s signing certificate. [#2840](https://github.com/nekodas-neko/TrainingAi_Open/issues/2840)

- [ ] Set EAS’s Android version code above the installed APK and keep subsequent builds increasing. [#2840](https://github.com/nekodas-neko/TrainingAi_Open/issues/2840)

- [ ] Produce the remaining signed Android development/preview and iPhone preview builds using the existing Expo project. [#2840](https://github.com/nekodas-neko/TrainingAi_Open/issues/2840)

- [ ] Record app/backend versions, internal installation instructions and a rollback procedure. Retain the Capacitor build path until the replacement is accepted. [#2840](https://github.com/nekodas-neko/TrainingAi_Open/issues/2840)

## Device acceptance

Android checks belong to the Android developer; iPhone checks use the existing iPhone.

| Area | Checks | Tracking |
| --- | --- | --- |
| Android upgrade | Install over the existing app, sign in again and verify synced account records load. | [#2840](https://github.com/nekodas-neko/TrainingAi_Open/issues/2840) |
| Account | Google/email and supported Apple sign-in; approval/denial, expiry, account switching, sign-out and deletion. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Workout | Start/finish, supersets, re-log, injury swaps, bodyweight/AMRAP/deload, effort, rests, minimise/resume, offline reopen and correct uploads. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Programmes | Manual/AI creation, review/apply, schedules, phases/styles, activation, injuries and interrupted/offline writes. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Health | Body/Training/Progress, history, clinical records, edits/deletes, imports, missing permissions and source separation. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Nutrition | Camera/photos/barcodes/QR, portions, recipes, labels/printing/sharing, supplements, meal statuses, diary edits and plans. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Home | Summaries, check-ins, dated navigation, reordering/colours, caching and stable loading layouts. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Weather | City search, device location allow/deny/revoke, saved-city fallback, travel, units, UV/daylight and offline reopen on both platforms. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Backgrounds | All weather conditions, daylight transitions, per-tab preferences, light/dark contrast, reduced motion and animation suspension/resume while backgrounding the app. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Coach | Live streaming, stop/retry/history, widgets, confirmed changes, stale refusal, undo and dependent-screen refresh. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Community | Invites, friendship decisions/removal, privacy, sharing, feed, leaderboards and profiles. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Data | Exact upload readback, manual refresh, history downloads, exports and preservation of new native offline work. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Alerts and calendar | Timer/guided cues while foregrounded/backgrounded, pause/finish cancellation, reminder days/time-zone changes, permission revocation, notification taps/account switching, keep-awake release and calendar create/update/delete/deduplication. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |
| Platform | Android Back, keyboards/sheets, existing module gestures, insets, accessibility and background/low-memory recovery. | [#2841](https://github.com/nekodas-neko/TrainingAi_Open/issues/2841) |

## Deferred rewards

- [ ] Own XP, levels and progress to the next level. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

- [ ] Achievement browser, criteria, progress and details. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

- [ ] Personal trophy case. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

- [ ] Equip and clear unlocked titles. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

- [ ] Current/past season results and badges. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

- [ ] Collection inventories, ladder progression, merging and decay explanations. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

- [ ] Animated Home collection and interactions. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

- [ ] Post-workout XP, unlock feedback and reward-state refresh. [#2842](https://github.com/nekodas-neko/TrainingAi_Open/issues/2842)

## Deferred health and device integrations

- [ ] Health-anomaly alerts driven by changing health data, including server-triggered delivery. [#2843](https://github.com/nekodas-neko/TrainingAi_Open/issues/2843)

- [ ] Background health reading/import for Apple Health and Health Connect. [#2843](https://github.com/nekodas-neko/TrainingAi_Open/issues/2843)

- [ ] Extended-history progress, earliest-available dates and Stop/resume controls. [#2843](https://github.com/nekodas-neko/TrainingAi_Open/issues/2843)

- [ ] Additional HealthKit readings: oxygen, breathing, temperature, body composition, basal energy, distance and workouts. [#2843](https://github.com/nekodas-neko/TrainingAi_Open/issues/2843)

- [ ] Additional Health Connect readings: body composition, oxygen, basal/total energy, nutrition, exercise/distance and cadence. [#2843](https://github.com/nekodas-neko/TrainingAi_Open/issues/2843)

- [ ] Direct Oura Bluetooth capture/sync/reconnect, carrying over the existing `oura_ble.xml` pairing key and history cursor before replacement. [#2844](https://github.com/nekodas-neko/TrainingAi_Open/issues/2844)

- [ ] Polar/chest-strap pairing and live heart rate. [#2844](https://github.com/nekodas-neko/TrainingAi_Open/issues/2844)

- [ ] Bluetooth scale connection, composition readings and calibration. [#2844](https://github.com/nekodas-neko/TrainingAi_Open/issues/2844)

- [ ] Colmi and other supported direct-device integrations. [#2844](https://github.com/nekodas-neko/TrainingAi_Open/issues/2844)

- [ ] Device permission/connection/battery settings and overlapping-source deduplication. [#2844](https://github.com/nekodas-neko/TrainingAi_Open/issues/2844)

- [ ] Live workout heart rate, exercise charts and personal recovery comparisons. [#2844](https://github.com/nekodas-neko/TrainingAi_Open/issues/2844)

## Deferred activity and platform integrations

- [ ] GPS routes, distance/pace/elevation and interruption recovery. [#2845](https://github.com/nekodas-neko/TrainingAi_Open/issues/2845)

- [ ] Recorded route maps and linked chart scrubbing. [#2845](https://github.com/nekodas-neko/TrainingAi_Open/issues/2845)

- [ ] Live cadence and gait feedback. [#2845](https://github.com/nekodas-neko/TrainingAi_Open/issues/2845)

- [ ] Retrospective detected-activity review, confirm/edit/reject and Home notices. [#2845](https://github.com/nekodas-neko/TrainingAi_Open/issues/2845)

- [ ] Sustained recording and workout/activity status while locked or outside the app. [#2846](https://github.com/nekodas-neko/TrainingAi_Open/issues/2846)

- [ ] Picture-in-picture, exact-alarm rest timers and Android Now Bar presentation. [#2846](https://github.com/nekodas-neko/TrainingAi_Open/issues/2846)

- [ ] Native media-saving actions and photo-library permission handling. [#2838](https://github.com/nekodas-neko/TrainingAi_Open/issues/2838)

## Later data projects

- [ ] Shared cross-platform health representation and sync/projection pipeline. [#2847](https://github.com/nekodas-neko/TrainingAi_Open/issues/2847)

- [ ] Processing/completeness status and baseline handling. [#2847](https://github.com/nekodas-neko/TrainingAi_Open/issues/2847)

- [ ] Compact dashboard data contract. [#2847](https://github.com/nekodas-neko/TrainingAi_Open/issues/2847)

- [ ] Installed-client capability/version compatibility contract. [#2847](https://github.com/nekodas-neko/TrainingAi_Open/issues/2847)

## Later public release

- [ ] Finalise branding, app icons and splash screens. [#2848](https://github.com/nekodas-neko/TrainingAi_Open/issues/2848)

- [ ] Prepare store listings and health/privacy information. [#2848](https://github.com/nekodas-neko/TrainingAi_Open/issues/2848)

- [ ] Choose public distribution and native update policy. [#2848](https://github.com/nekodas-neko/TrainingAi_Open/issues/2848)

## Reference commits

| Reference | Commit |
| --- | --- |
| Native runtime handover checkpoint | `cdb6a5c8b573d0705706104445014c5ff6deb39e` |
| Main comparison checkpoint | `0e2df9995d6493db0c8ee980a8493e4280907327` |
| Original migration baseline | `e3c692f9a58fc27c90cf0737fb65de7f69515dae` |
