# Native mobile remaining work

Snapshot of the [deployment plan](https://chatgpt.com/space/page_c3a9c1659c348191bf8bf95e43fe8f2f), 13 October 2026. Keep this repository copy aligned when completing handover tasks.

Outstanding work after pushing the current native changes.

## Core functionality

- [ ] Add resumable downloads of supported account history for offline use, with progress and account isolation.

## Deferred UI work

- [ ] Add drag reordering for programme sessions and exercises, preserving supersets.

- [ ] Expand the session icon picker to all 22 original fitness icons with readable labels.

- [ ] Add Markdown links, tables, italics, code and richer lists to Coach and generated explanations.

- [ ] Add About source credits and release notes; show native app/build, app-code and backend versions distinctly.

## Backend follow-ups

- [ ] Complete [#2813](https://github.com/nekodas-neko/TrainingAi_Open/issues/2813): ownership-scoped food reads by ID and manual supplement-dose reads by supplement/date. Remove client workarounds after verification.

## Deployment and internal rollout

- [ ] Review the PR, pass mobile checks and Android native compilation, and fix CI failures.

- [ ] Merge and release the backend changes for native sign-in, health imports, meal statuses, exercise media, profiles, activities and community.

- [ ] Verify all branch migrations applied successfully, including the Health Connect ledger and meal-status migrations.

- [ ] Confirm required historical 1RM/recovery backfills have been applied.

- [ ] Configure `EXPO_TOKEN` for signed EAS builds and reuse the existing Android signing key.

- [ ] Verify the replacement APK retains `com.trainingai.app` and the installed app’s signing certificate.

- [ ] Set EAS’s Android version code above the installed APK and keep subsequent builds increasing.

- [ ] Produce signed iPhone and Android development/preview builds using the existing Expo project.

- [ ] Record app/backend versions, internal installation instructions and a rollback procedure. Retain the Capacitor build path until the replacement is accepted.

## Device acceptance

Android checks belong to the Android developer; iPhone checks use the existing iPhone.

| Area | Checks |
| --- | --- |
| Android upgrade | Install over the existing app, sign in again and verify synced account records load. |
| Account | Google/email and supported Apple sign-in; approval/denial, expiry, account switching, sign-out and deletion. |
| Workout | Start/finish, supersets, re-log, injury swaps, bodyweight/AMRAP/deload, effort, rests, minimise/resume, offline reopen and correct uploads. |
| Programmes | Manual/AI creation, review/apply, schedules, phases/styles, activation, injuries and interrupted/offline writes. |
| Health | Body/Training/Progress, history, clinical records, edits/deletes, imports, missing permissions and source separation. |
| Nutrition | Camera/photos/barcodes/QR, portions, recipes, labels/printing/sharing, supplements, meal statuses, diary edits and plans. |
| Home | Summaries, check-ins, dated navigation, reordering/colours, caching and stable loading layouts. |
| Weather | City search, device location allow/deny/revoke, saved-city fallback, travel, units, UV/daylight and offline reopen on both platforms. |
| Backgrounds | All weather conditions, daylight transitions, per-tab preferences, light/dark contrast, reduced motion and animation suspension/resume while backgrounding the app. |
| Coach | Live streaming, stop/retry/history, widgets, confirmed changes, stale refusal, undo and dependent-screen refresh. |
| Community | Invites, friendship decisions/removal, privacy, sharing, feed, leaderboards and profiles. |
| Data | Exact upload readback, manual refresh, history downloads, exports and preservation of new native offline work. |
| Alerts and calendar | Timer/guided cues while foregrounded/backgrounded, pause/finish cancellation, reminder days/time-zone changes, permission revocation, notification taps/account switching, keep-awake release and calendar create/update/delete/deduplication. |
| Platform | Android Back, keyboards/sheets, existing module gestures, insets, accessibility and background/low-memory recovery. |

## Deferred rewards

- [ ] Own XP, levels and progress to the next level.

- [ ] Achievement browser, criteria, progress and details.

- [ ] Personal trophy case.

- [ ] Equip and clear unlocked titles.

- [ ] Current/past season results and badges.

- [ ] Collection inventories, ladder progression, merging and decay explanations.

- [ ] Animated Home collection and interactions.

- [ ] Post-workout XP, unlock feedback and reward-state refresh.

## Deferred health and device integrations

- [ ] Health-anomaly alerts driven by changing health data, including server-triggered delivery.

- [ ] Background health reading/import for Apple Health and Health Connect.

- [ ] Extended-history progress, earliest-available dates and Stop/resume controls.

- [ ] Additional HealthKit readings: oxygen, breathing, temperature, body composition, basal energy, distance and workouts.

- [ ] Additional Health Connect readings: body composition, oxygen, basal/total energy, nutrition, exercise/distance and cadence.

- [ ] Direct Oura Bluetooth pairing, persistent keys, capture, sync and reconnect.

- [ ] Polar/chest-strap pairing and live heart rate.

- [ ] Bluetooth scale connection, composition readings and calibration.

- [ ] Colmi and other supported direct-device integrations.

- [ ] Device permission/connection/battery settings and overlapping-source deduplication.

- [ ] Live workout heart rate, exercise charts and personal recovery comparisons.

## Deferred activity and platform integrations

- [ ] GPS routes, distance/pace/elevation and interruption recovery.

- [ ] Recorded route maps and linked chart scrubbing.

- [ ] Live cadence and gait feedback.

- [ ] Retrospective detected-activity review, confirm/edit/reject and Home notices.

- [ ] Sustained recording and workout/activity status while locked or outside the app.

## Later data projects

- [ ] Shared cross-platform health representation and sync/projection pipeline.

- [ ] Processing/completeness status and baseline handling.

- [ ] Compact dashboard data contract.

- [ ] Installed-client capability/version compatibility contract.

## Later public release

- [ ] Finalise branding, app icons and splash screens.

- [ ] Prepare store listings and health/privacy information.

- [ ] Choose public distribution and native update policy.

## Reference commits

| Reference | Commit |
| --- | --- |
| Native runtime handover checkpoint | `57df93b092ecfb252b6eb007a1c4f0acd850e382` |
| Main comparison checkpoint | `0e2df9995d6493db0c8ee980a8493e4280907327` |
| Original migration baseline | `e3c692f9a58fc27c90cf0737fb65de7f69515dae` |
