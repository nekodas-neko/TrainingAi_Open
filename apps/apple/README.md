# Apple client

Standalone Expo / React Native iPhone client in `TrainingAi_Open/apps/apple`. This project owns its dependencies, lockfile, app configuration, build scripts and tests. The repository root remains the Next.js backend and Capacitor Android client.

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
| `src/features/coach`, `social`, `devices` | Reserved for coaching, community/rewards and device integrations. |
| `src/integrations/auth` | iOS keychain, browser callback and native Apple sign-in adapters. |
| `src/integrations/apple-health` | iOS HealthKit queries and source inspection. |
| `src/core/storage` | SQLite initialization, migrations and device/account/backend storage scopes. |
| `src/core/sync` | Authenticated mutation uploads using the existing backend sync endpoint. |
| `src/shared` | Reusable native UI library and central theme tokens. |
| `src/development/diagnostics` | Opt-in local development reports. |
| `tests` | Centralized pure logic and API/session tests. |

The remaining reserved directories contain `.gitkeep` files only. Workout loads the active backend program, next-session recommendation and exercise previews, saving one validated snapshot per account and backend for offline viewing. Saved recommendations are labelled. Opening Workout or returning to the app checks quietly when the cache is over five minutes old; failed checks back off. Manual refresh always checks, and uploaded workouts invalidate the recommendation immediately. Starting a workout fetches its current prescription, with an explicit saved-session option when offline. Weight/reps, optional set timing and rest countdowns persist in SQLite so an unfinished workout can be resumed. Finishing atomically saves recorded sets and an ordered upload queue; the existing backend sync endpoint receives exercise logs before completion, using stable IDs for retries. Uploads retry while the app is open or returns to the foreground. The Workout landing screen follows the original session carousel: session details, the same front/back muscle artwork, recovery chips, completion state and a direct start/resume action. Program settings opens the program manager from the Workout header. More links to programs, the exercise library, workout history and strength progress. Cardio Hub opens in its original Workout position and reads the existing heart, zone, step and trend endpoints. Other activity follows picker → title/Start → pauseable timer → review/Save, with account-scoped draft recovery, durable offline saves and upload readback. Running plans include goal setup, prescriptions, recovery gating, duration/type overrides, bests and weekly targets. Guided walks include Today/Long/Short/Custom presets, configured intervals, exit handling, accurate segment durations and a single durable summary save. Fitness baselines include timed protocols, measured distance/manual HR entry, shared score calculations, early-test gating and atomic test/effort records. Activity edits preserve recorded sensor/route fields and queue offline. GPS, live heart-rate/cadence, route maps/scrubbing, platform cues and automatic detected-activity review remain deferred; missing sensors stay unavailable. Nutrition’s core flows and the first Home dashboard pass are implemented; remaining parity and device checks are tracked in the implementation plan. SQLite and appearance persistence are implemented. Sleep, readiness and body measurements belong to health; history and reviews belong to progress. Notifications and background work should get their own platform adapters when their first feature needs them.

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
