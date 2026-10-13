# Mobile client

Standalone Expo / React Native iOS and Android client in `TrainingAi_Open/apps/mobile`. This project owns its dependencies, lockfile, app configuration, build scripts and tests. The repository root contains the Next.js backend and the existing Capacitor Android app during migration.

Implementation scope and checklist: [Native App Implementation Plan](https://chatgpt.com/space/page_580c9ed4236881919f92daccfd908684).

## Structure

| Directory | Responsibility |
| --- | --- |
| `src/app` | App composition, providers and navigation. |
| `src/features/account` | Backend sign-in API, session lifecycle and account UI. |
| `src/features/home` | Home dashboard, exercise readiness and saved layout preferences. |
| `src/features/health` | Health overview, models, interval calculations and reading state. |
| `src/features/settings` | More shell, settings screen and account controls. |
| `src/features/workouts`, `programs` | Cached program, session previews, local workout journal, history and program management. |
| `src/features/activities`, `progress` | Cardio Hub, resumable activity recording and offline saves; strength progress and personal records. |
| `src/features/nutrition`, `meal-plans` | Daily diary, food capture, recipes and labels, supplements, day review, targets and guided meal planning. |
| `src/features/social` | Friend requests/codes, activity feed, leaderboards and read-only friend profiles. |
| `src/features/coach` | Native streamed conversations, interactive cards, previews, confirmation, history and undo through the existing coach backend. |
| `src/features/devices` | Direct device integrations remain deferred; rewards/collection remain a separate module. |
| `src/integrations/auth` | Native secure storage, browser callbacks and iOS Apple sign-in. |
| `src/integrations/apple-health`, `health-connect`, `device-health` | Platform readers, permission flows, source inspection and shared projection adapters. |
| `src/core/storage` | SQLite initialization, migrations and device/account/backend storage scopes. |
| `src/core/sync` | Authenticated mutation uploads using the existing backend sync endpoint. |
| `src/shared` | Reusable native UI library and central theme tokens. |
| `src/development/diagnostics` | Opt-in local development reports. |
| `tests` | Centralized pure logic and API/session tests. |

The remaining reserved directories contain `.gitkeep` files only. Workout loads the active backend program, next-session recommendation and exercise previews, saving one validated snapshot per account and backend for offline viewing. Saved recommendations are labelled. Opening Workout or returning to the app checks quietly when the cache is over five minutes old; failed checks back off. Manual refresh always checks, and uploaded workouts invalidate the recommendation immediately. Starting a workout fetches its current prescription, with an explicit saved-session option when offline. Weight/reps, optional set timing and rest countdowns persist in SQLite so an unfinished workout can be resumed. Finishing atomically saves recorded sets and an ordered upload queue; the existing backend sync endpoint receives exercise logs before completion, using stable IDs for retries. Uploads retry while the app is open or returns to the foreground. The Workout landing screen follows the original session carousel: session details, the same front/back muscle artwork, recovery chips, completion state and a direct start/resume action. Program settings opens the program manager from the Workout header. More links to programs, the exercise library, workout history and strength progress. Cardio Hub opens in its original Workout position and reads the existing heart, zone, step and trend endpoints. Other activity follows picker → title/Start → pauseable timer → review/Save, with account-scoped draft recovery, durable offline saves and upload readback. Running plans include goal setup, prescriptions, recovery gating, duration/type overrides, bests and weekly targets. Guided walks include Today/Long/Short/Custom presets, configured intervals, exit handling, accurate segment durations and a single durable summary save. Fitness baselines include timed protocols, measured distance/manual HR entry, shared score calculations, early-test gating and atomic test/effort records. Activity edits preserve recorded sensor/route fields and queue offline. GPS, live heart-rate/cadence, route maps/scrubbing, platform cues and automatic detected-activity review remain deferred; missing sensors stay unavailable. Nutrition’s core flows and the first Home dashboard pass are implemented; remaining parity and device checks are tracked in the implementation plan. SQLite and appearance persistence are implemented. Sleep, readiness and body measurements belong to health; history and reviews belong to progress. Notifications and background work should get their own platform adapters when their first feature needs them.

More > Friends follows the existing Activity/Leaderboard and Manage flows. Friend requests use email or code; incoming and sent requests have separate actions. Drafts and accepted reads are scoped to the account/backend. Friendship changes require a connection and update cached visibility only after acknowledgement. Friend profiles show existing backend statistics, titles, XP and achievement details without awarding rewards. Touch and hold your code on More > Profile to copy it, or use the native share button. The accompanying leaderboard fixes correct distinct session counts and local-week boundaries; they require backend deployment.

Features own their logic and state. App composition connects providers and screens. Native services live behind platform adapters, with `.ios` implementations and unavailable fallbacks. Reusable native UI belongs in `src/shared`. The explicit local `@trainingai/shared` dependency supplies pure date helpers and workout payload validators; only native-compatible leaf modules are imported, never Next.js pages or server modules.

The carousel opens the original pre-workout session view. Start Workout runs a three-second countdown, then logging follows warm-up, exercise preparation, one set at a time, rest and exercise summary. Continuing from the final summary finishes the workout without an extra review step. Back returns to the session hub; solo exercise logging returns there after its summary. Headers and primary bottom actions stay fixed. Minimize keeps the workout and its timers running; other tabs show a compact resume bar. The ready screen shows working load, preparation progress and set targets; the active screen uses a weight wheel, reps controls, effort strip and two-column set grid. Rest uses the original countdown ring, including the final set’s rest on its summary. Corrections and extra options open in sheets. The current step is saved with the workout, including across reloads. Equipment-aware starting loads, set targets, weight/reps controls, bodyweight assistance and AMRAP labels follow the original logging flow. Per-set effort distinguishes expected values from ratings; accepting a suggested load reduction preserves the prescribed load for comparison. Exercise results and the completion recap use shared 1RM calculations and recorded timings. Older unfinished workouts resume their existing progress without fabricated effort or target loads. Supersets alternate using the shared workout order; re-logging preserves earlier results, and injury swaps retain already-recorded sets under their original exercise. Exercise details include demonstration media and full history. AI preparation includes prescription acceptance/dismissal, regeneration, duration and intensity controls and phase transitions. Programs support manual editing, the original AI builder question sequence and adjustment chat, schedules, progression sets and phase sets. Injuries can be recorded, edited, resolved or deleted. Workout history supports durable offline edits/deletes, calendar browsing, strength trends, weekly stats and personal records. Server recap and next-session prescription cards load when opened. The completion screen uses the existing backend energy estimate, activity selector and daily training-stress readout; missing profile/sensor inputs remain unavailable. Cached views and editor drafts are scoped to the account/backend. Program and injury saves, activations, resolutions and deletions persist locally and replay in order when connected. Program retries recover server identities from stable session IDs; dependent phase clones are queued with the save. Pending changes stay visible across refreshes and reopening, with upload status and a retry action. Generation and connected phase/progression-set editing still use the backend. Live heart-rate/device links, speech, rest notifications, calendar integration and rewards are excluded from this pass. Generated exercise media requires the accompanying authenticated `/api/exercise-media` backend alias to be deployed.

## UI library

Build screens with the components exported by `src/shared/ui`. The theme provider supplies semantic colours, spacing, typography, radii and control sizes from `src/shared/theme`; changing those tokens updates the library together. `ThemeProvider` also accepts overrides for future re-theming. Feature screens own content and actions; shared components own control styling and interaction states. Native Apple sign-in keeps Apple’s official button appearance.

Use the shared `Icon` component for Lucide icons, matching the existing app’s navigation. Icon names are mapped centrally and their colours, sizes and stroke width follow the theme. Adding the SVG renderer requires a new signed development build once; later icon and styling edits use reload.

## Local development

Run commands **from this directory**:

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm dev:status
pnpm dev:stop
```

On Windows, `src/development/Start Development.cmd` and `src/development/Stop Development.cmd` run the same managed launcher. It starts Metro on port 8088 and the local report receiver on port 8090, detects the private LAN address and maintains `.env.local`. The iPhone and PC must share a network. Open the installed development client and connect to the launcher URL.

Browser Google/email sign-in, account verification, native Apple sign-in/linking and Apple Health queries have been carried across from the prototype. The shell has been reviewed on iPhone. It uses Home, Health, Workout, Nutrition and More tabs. Unimplemented feature rows are disabled and labelled Coming soon. Apple Health reading is available from More > Apple Health; account controls and sign-in feedback are at More > Account & settings. The shell follows the existing app’s green accent, tinted dark surfaces, health colours and raised Workout tab. More > Appearance saves system/light/dark mode and eight accent presets on this device, restoring them before the shell opens. Preferences are device-wide; future account data uses separate account and backend scopes. Save failures retain the current appearance and offer a retry. Adding SQLite requires a new signed development build before phone verification. Expo Go supports previews; native account and HealthKit access require the signed iPhone development build.

```powershell
pnpm typecheck
pnpm test
pnpm exec expo export --platform ios --output-dir dist
```

The Apple CI workflow runs these checks independently. Backend TypeScript, ESLint and Vitest exclude this directory. Its nested `pnpm-workspace.yaml` keeps the app's React and native dependencies separate from the root workspace.

## Native builds and privacy

`pnpm build:ios` runs the Windows EAS launcher with this app as its project root. Apple credentials and two-factor codes are entered by the user in their terminal. Keep the registered bundle ID and scheme `com.fitnessai.training`, Expo project `meowi/trainingai-mobile` and existing EAS project ID. Moving source files requires no new signing identity or app installation.

You can also double-click `src/development/Build iPhone.cmd`. It uses saved signing without prompts, waits for the build, opens the builds page and starts the development server. On a signing/setup error, choose S in the launcher to run with interactive prompts. Bookmark [iPhone builds](https://expo.dev/accounts/meowi/projects/trainingai-mobile/builds) on your phone and install the latest finished iOS development build from there. Apple still asks you to confirm installation. Regular UI/JavaScript edits use reload; only native library or configuration changes need a new build.

`.env.local`, `.expo` reports/logs and signing credentials are ignored and excluded from EAS uploads. Development reports are opt-in and stay on the PC. Apple Health upload is enabled explicitly from More > Apple Health. The anchored import persists batches before checkpointing, uploads through `/api/apple-health/sync`, and refreshes backend health views after projection. That backend endpoint must be deployed before account syncing can succeed. SDNN is stored separately and does not feed RMSSD baselines. Missing or denied health metrics remain unavailable and retain their source information.

## Reference baseline

The implementation plan is based on backend `main` at `e3c692f9a58fc27c90cf0737fb65de7f69515dae` (v1.489.0), tagged locally as `native-app-baseline-2026-10-10`. The structure branch is `feat/native-app-structure`. Compare that fixed commit with the current `origin/main` for the later feature-drift audit; the tag has not been pushed.


## Native Android preparation

The replacement Android package remains `com.trainingai.app`; development builds use `com.trainingai.app.dev`. iOS keeps `com.fitnessai.training` and the existing Expo project. Run `pnpm build:android` for the development APK or `pnpm build:android -- --profile preview` for an internal APK. The Windows launcher is `src/development/Build Android.cmd`.

Local Android builds require the existing signing key through ignored `credentials.json` and the `android-*` EAS profiles. The native CI workflow can reuse the existing `ANDROID_DEBUG_KEYSTORE_B64` secret and its established alias/passwords; explicit `ANDROID_KEYSTORE_*` credentials take precedence when configured. A replacement must use the signer of the actual installed APK. Do not generate a new key for an in-place upgrade. Certificate matching and version-code continuity must be verified before a replacement is installed. Legacy offline data and phone settings are intentionally excluded from import; verify the existing synced account records load after signing in. Backend Android callbacks and the core Health Connect reader/importer are implemented. The Android developer owns native compilation, runtime acceptance and the actual upgrade check; this PC does not need an Android SDK or emulator. The shared sign-in, streaming export, haptics, diagnostic reporting and screen-back adapters also need that acceptance pass.

### Backend and Health Connect handover

Deploy the native browser sign-in changes and `/api/health-connect/sync` with `202610131300_health_connect_records.sql` and the other branch migrations. The existing backend runs pending migrations through `ensureSchema`; verify the deployed migration log/ledger records successful application before accepting the new endpoints. A running service alone does not confirm that every migration succeeded. Named browser clients use signed, client-bound transactions:

| Client | Exact callback |
| --- | --- |
| `ios` | `com.fitnessai.training:/auth/callback` |
| `android` | `com.trainingai.app:/auth/callback` |
| `android-dev` | `com.trainingai.app.dev:/auth/callback` |

Google still returns to the existing backend OAuth callback; the backend then returns to the installed app. The original unnamed Capacitor flow and existing iPhone transactions remain supported. Native application identity selects the Android client, independently of the Metro configuration.

Health Connect covers sleep sessions/stages, heart-rate samples, resting heart rate, RMSSD, steps, active calories and weight. Raw record IDs, source packages, recording methods, modification timestamps and available device descriptions are retained. The account-scoped queue persists before uploading, resumes paged history, handles corrections/deletions and expired cursors, and preserves history that permissions no longer allow it to inspect. RMSSD and Apple's SDNN remain distinct. Permission-denied measurements remain unavailable. Uploads run while the app is foregrounded or returns to the foreground; background delivery is deferred. Additional legacy Android coverage (body composition, oxygen, basal/total energy, nutrition, exercise/distance and cadence) remains listed in the [deployment plan](https://chatgpt.com/space/page_c3a9c1659c348191bf8bf95e43fe8f2f).

`mobile.yml` prepares an unpublished Android debug compilation in CI alongside TypeScript, logic tests and all-platform JavaScript exports. `mobile-build.yml` makes signed EAS builds using the existing keystore. These workflows must run after the changes are pushed; local prebuild/configuration checks do not verify native compilation or device behaviour.

### Preserve the existing Android installation

The accepted scope is a fresh native local store: sign in again and load existing synced account records from the backend. Legacy unsynced/offline work, unfinished sessions and phone settings will not be imported. A custom importer and account-ownership investigation are no longer required for this handover. This decision concerns the old Android data; the new app's offline saves and durable upload queues remain supported.

The native app opens `fitnessai.sqlite`; the legacy Capacitor database is named `trainingai`. Leave the legacy database and Android preference files untouched. Direct Bluetooth integrations and any reuse of their pairing information remain deferred. The read-only `pnpm inspect:legacy` tool is available for optional investigation, not a release requirement. Private snapshots, device keys and credentials stay local.

On the Android developer's SDK-equipped machine, compare the installed release APK with the candidate:

```powershell
pnpm verify:android --existing C:\handover\installed.apk --replacement C:\handover\native-preview.apk
```

Provide `--apksigner` and `--apkanalyzer` paths (or `APKSIGNER` / `APKANALYZER`) if those SDK tools are not on PATH. This verifies each APK's signature, requires the same `com.trainingai.app` package and signer certificates, and requires a higher version code. The old release pipeline derives codes as `major * 1000000 + minor * 1000 + patch`; read the real installed APK rather than assuming a starting value. Seed EAS's remote Android version above that code before building the replacement, using `eas build:version:set --platform android --profile android-preview`, then keep it increasing for later replacement builds. The `.dev` package is a separate install and is not an upgrade test.

The final acceptance is an in-place preview upgrade, followed by signing in and verifying the existing server account's program, workout, nutrition and health records. Legacy unsynced data and phone settings are intentionally excluded. Do not uninstall the existing app to resolve signing failures. The APK comparison reports binary compatibility only; it does not perform a data import.
