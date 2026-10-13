# Android native client handover

The shared Expo / React Native client is in `mobile/`. Start by compiling and exercising the Android implementation already on this branch, then verify a signed upgrade over the existing Capacitor app. Android runtime testing has not been performed on Joshua's PC; it has no Android SDK or device. iPhone flows have been tested during implementation, with final acceptance still tracked separately.

This handover is dated 13 October 2026. Native runtime checkpoint: `57df93b092ecfb252b6eb007a1c4f0acd850e382`. Main alignment checkpoint: `0e2df9995d6493db0c8ee980a8493e4280907327`. Original migration baseline: `e3c692f9a58fc27c90cf0737fb65de7f69515dae`. Compare the main checkpoint with later main commits when checking for new feature drift.

## Where to start

1. Check the PR's **Mobile client checks** and **Native Android compile** jobs. Resolve compilation failures before configuring replacement signing.
2. Install the separate development app, connect it to Metro and test Google/email sign-in against a backend with this branch's native-auth changes deployed.
3. Exercise Health Connect permissions, imports and backend readback. Test Android Back, sheets, keyboards, exports and streamed Coach responses.
4. Obtain the installed Capacitor APK and its existing signing key from the owner. Verify package, certificate and version code before an in-place preview upgrade.
5. Follow the [remaining-work checklist](remaining-work.md) for outstanding features, rollout and full module acceptance. Rewards and direct-device integrations remain deferred.

## Project boundaries

| Path | Responsibility |
| --- | --- |
| `mobile/` | Independent native app, package manifest, pnpm lockfile and Expo configuration |
| `mobile/src/app` | Providers, app composition and custom navigation |
| `mobile/src/features` | Home, Health, Workout, Nutrition, More, activities, programmes, community and Coach |
| `mobile/src/shared/ui`, `shared/theme` | Reusable controls, layout, animation and theme tokens |
| `mobile/src/integrations` | Authentication, HealthKit, Health Connect, sharing, camera and feedback adapters |
| `mobile/src/core/storage`, `core/sync` | SQLite, account/backend scopes and durable mutation queues |
| `mobile/tests` | Centralized mobile logic tests |
| Root `app/`, `lib/` | Next.js backend and existing web/Capacitor implementation |
| `packages/shared` | Pure cross-platform calculations and contracts |
| Root `android/` | Existing Capacitor app; retain until the native replacement is accepted |

Run native commands inside `mobile/`. Do not merge its dependencies or lockfile into the root workspace. Read `mobile/AGENTS.md` and `mobile/README.md`; native UI uses the shared library and preserves the original feature flows. Keep backend imports out of native runtime code.

## Expo development setup

Use Node 22 and pnpm 10.33.0, matching CI. Clone the whole repository, check out `feat/native-app-structure` (or main after merge), then enter `mobile/`:

```text
npm install --global pnpm@10.33.0
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Copy `.env.example` to `.env.local`. Its public `EXPO_PUBLIC_API_URL` points to the existing Railway backend. Use a backend containing this PR's endpoints before testing imports and Android browser authentication. The mobile app needs no database password or server OAuth secrets. Changing the API URL requires restarting Metro.

This app needs its own **development build**, which includes SQLite, secure storage and Health Connect. Expo Go cannot test these native modules. Metro serves JavaScript to that installed development app; EAS is the cloud build service. Preview APKs include the JavaScript and run without Metro. JavaScript/UI changes reload; native dependencies, plugins or app configuration changes require rebuilding. See [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).

### Option A — use a cloud-built development APK

Request access to the existing Expo project `@meowi/trainingai-mobile` and its builds. Do not create a new Expo project.

```text
npx eas-cli@latest login
pnpm build:android
```

The build launcher uses `android-development`, prepares the local shared-package snapshot for upload and requires the existing Android key configured in ignored `credentials.json`. Obtain the key and passwords privately from the owner. The required shape is:

```json
{
  "android": {
    "keystore": {
      "keystorePath": "android-signing.keystore",
      "keystorePassword": "<provided privately>",
      "keyAlias": "<existing alias>",
      "keyPassword": "<provided privately>"
    }
  }
}
```

Download/install the Android development APK from the [existing Expo builds page](https://expo.dev/accounts/meowi/projects/trainingai-mobile/builds). It uses `com.trainingai.app.dev` and can coexist with the Capacitor app. Neither this package nor an ordinary locally signed debug APK proves replacement compatibility.

### Option B — compile locally

Install Android Studio, Android SDK/platform tools and the platform/build-tools required by Expo's generated Gradle project. Use JDK 21 to match this branch's Android CI. Configure `JAVA_HOME`, `ANDROID_HOME` and platform-tools on PATH; verify `java -version` and `adb devices`. Enable USB debugging and authorize your computer on the phone. An emulator can cover UI, but actual health-source and upgrade checks require the target phone. Follow [Expo Android environment setup](https://docs.expo.dev/workflow/android-studio-emulator/) for the SDK installation.

Set the development profile before prebuild/run so local compilation selects the separate package:

```powershell
# PowerShell, inside mobile/
$env:EAS_BUILD_PROFILE = 'android-development'
pnpm exec expo run:android --device --port 8088
```

On macOS/Linux, prefix the command with `EAS_BUILD_PROFILE=android-development`. Expo generates ignored `mobile/android/`; root `android/` is the old Capacitor app. For later native configuration changes, regenerate the disposable native project with `pnpm exec expo prebuild --platform android --clean --no-install`, then rebuild. Do not keep manual native changes only in generated files; use app configuration/config plugins.

### Daily feedback loop

On Windows, the managed launcher starts Metro and the opt-in report receiver:

```powershell
$env:EAS_BUILD_PROFILE = 'android-development'
pnpm dev
pnpm dev:status
pnpm dev:stop
```

The commands above are separate start/status/stop actions. Metro uses port 8088 and the receiver uses 8090. The launcher prints the PC LAN URL; its current "iPhone server URL" label also applies to the Android development client. Open the installed client and choose that server. Keep phone and PC on the same LAN and allow those ports through your local firewall.

On macOS/Linux, the managed `pnpm dev` launcher is unavailable. Run `EAS_BUILD_PROFILE=android-development pnpm exec expo start --dev-client --lan --port 8088`. For USB-only Metro connectivity, use `adb reverse tcp:8088 tcp:8088` and the development client's localhost server URL. Reload from the dev menu or use Fast Refresh for normal edits.

Diagnostics are opt-in and saved under ignored `.expo/`. The Windows launcher configures the report URL/key locally; do not commit or publish reports, local environment files or signing credentials. If a native module is missing, install a build containing that dependency rather than repeatedly reloading.

## Application and authentication identities

| Build | Package / bundle ID | Named auth client | Backend-to-app callback |
| --- | --- | --- | --- |
| Android development | `com.trainingai.app.dev` | `android-dev` | `com.trainingai.app.dev:/auth/callback` |
| Android preview/production | `com.trainingai.app` | `android` | `com.trainingai.app:/auth/callback` |
| Existing iPhone | `com.fitnessai.training` | `ios` | `com.fitnessai.training:/auth/callback` |

Keep EAS project ID `60c9f273-9824-4a24-b987-7a2555b6232f`, owner `meowi`, and the existing iOS signing identity. Android auth selects its named client from the installed application ID, not from the Metro address. Google returns to the backend's existing OAuth callback; the backend then redirects into the app. Do not replace Google's callback with the custom app scheme.

`src/integrations/auth/platform.native.ts` supplies secure storage, browser authentication and `expo/fetch`. Retain its streaming fetch support for Coach and exports. Native Apple sign-in is iOS-only; Google/email are the Android flows implemented here.

Verify both Android identities: successful callback, cancellation, pending approval, inactive account, session expiry, sign-out, account switching and opening the app from a cold start. Keep session data isolated from display-cache freshness.

## Health Connect and data flow

The current reader covers sleep/stages, heart rate, resting heart rate, RMSSD, steps, active calories and weight. More exposes the platform-appropriate connection screen. On a supported phone, make sure Health Connect is available and another health app actually writes data into it; data visible only in that app is not necessarily available through Health Connect. Refer to [Android Health Connect setup](https://developer.android.com/health-and-fitness/health-connect/get-started).

Read `src/integrations/health-connect/reader.android.ts`, `src/features/health/data/HealthConnectImportStore.ts` and `src/features/health/useDeviceHealthImport.android.ts`. The persisted queue uploads to `/api/health-connect/sync`. Backend code retains raw records/provenance and projects supported records into existing health views. Imports resume paged history, process corrections/deletions and recover expired cursors; foreground activity triggers uploads. Background delivery and additional record types remain deferred.

Test allow/deny/revoke, no data, multiple sources, overnight sleep, paged history, history permission, corrections/deletions, interrupted upload and offline/reopen. Inspect server readback and refreshed Home/Health values, not just a successful permission prompt. Preserve source package/record IDs and timestamps. SDNN from Apple and RMSSD from Android remain distinct. Missing readings must stay unavailable rather than becoming zero.

The new native store is `fitnessai.sqlite`, scoped by backend and account. Durable queues retain new native offline work until verified uploads. Manual Sync/Restore now bypasses catalogue freshness for programme templates, progression styles and phase sets, preserves pending edits and surfaces failures. It does not download every older account record; resumable full history is still outstanding.

## Backend rollout dependencies

Before connected acceptance, deploy this branch's native Android auth, Health Connect, meal-status, media, profile/activity and community changes. Confirm successful migration application in the deployed ledger/logs, including:

- `202610131300_health_connect_records.sql`
- `202610112228_meal_logging_statuses.sql`

The existing backend invokes `ensureSchema`; a running service does not prove every migration succeeded. Coordinate deployment and any historical backfills with the owner. Do not point at an unchanged backend and diagnose its missing endpoints as Android rendering failures.

## Signing and replacement verification

The accepted migration starts a fresh native local store: sign in again and load existing synced server records. **Legacy unsynced data, unfinished sessions and phone settings will not be imported.** Leave the old `trainingai` database and Android preference files untouched. Direct Bluetooth integrations and reuse of pairing keys remain deferred.

Obtain the actual installed APK and matching keystore. A replacement must retain `com.trainingai.app`, the installed APK's signer and a higher version code. Before building the replacement, read the installed code and seed EAS above it:

```text
npx eas-cli@latest build:version:set --platform android --profile android-preview
pnpm build:android -- --profile preview
pnpm verify:android --existing /path/to/installed.apk --replacement /path/to/native-preview.apk
```

Supply `--apksigner` and `--apkanalyzer` paths (or `APKSIGNER` / `APKANALYZER`) if the SDK tools are not on PATH. The legacy pipeline's version-code formula is `major * 1000000 + minor * 1000 + patch`; inspect the actual APK instead of assuming a value. The verifier checks both signatures, matching package/certificates and increasing code.

Install the verified preview APK over the existing app without uninstalling. Then sign in and check programmes, workout history, nutrition and health account records. If Android rejects the signer/version, resolve it rather than uninstalling to make the installation appear successful. Keep the Capacitor build path; rollback must also satisfy Android signing/version rules.

## CI and acceptance

`.github/workflows/mobile.yml` runs mobile TypeScript, tests, all-platform exports and an unpublished Android debug compilation without signing secrets. `mobile-build.yml` is the separate manual signed-build workflow. It needs `EXPO_TOKEN` and either complete `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets, or the existing `ANDROID_DEBUG_KEYSTORE_B64` fallback. The fallback still needs comparison with the installed APK's signer.

Latest local validation: 296 mobile tests, mobile/root TypeScript, focused lint and Android/iOS/web JS exports passed. The main-alignment run also passed 11,463 backend tests with 2,249 existing gated skips. These checks do not establish Android runtime or signed upgrade compatibility.

Weather now uses `expo-location` for opt-in foreground location and Open-Meteo for forecasts/city search. Rebuild development/preview APKs to include the new module. Test Home's chip and More > Account & settings > Weather: city search, allow/deny/revoke location, saved-city fallback, travel, Celsius/Fahrenheit and offline reopening. No background-location permission or service is enabled. Dynamic backgrounds use existing SVG and native animation libraries, so they need only reload. Verify per-tab controls, light/dark contrast, all six weather conditions, daylight changes, Reduce Motion, animation suspension while backgrounded and preserved bespoke health-detail artwork. Palette and intensity tokens are in `src/shared/theme/backgrounds.ts`; shared daylight maths is in `packages/shared/src/background`.

Alerts and calendar now use `expo-notifications`, `expo-calendar/legacy` and `expo-keep-awake`. Test More > Account & settings > Alerts & calendar on a fresh signed APK: permission allow/deny/revoke, rest deadlines, walk/test transitions, prescribed activity completion, pause/resume/finish cancellation, recurring reminder days/time zones, account switching and notification taps from a cold/background app. Verify keep-awake releases after leaving or pausing training. On Android, test timer delivery while locked/idle; Expo uses inexact alarms when exact-alarm access is unavailable, so OS power/timing settings can delay delivery. Calendar entries use a chosen writable device calendar; verify automatic creation for new completions, manual add/view/remove, correction updates and duplicate recovery. Existing Google Calendar cloud OAuth is not used. Local notifications need no push token or APNs/FCM setup; the local-only config plugin preserves iOS signing entitlements. Server-triggered health-anomaly alerts remain deferred.

Prioritize Android Back on detail screens; sheet dismissal; keyboard avoidance; status/navigation-bar and edge-to-edge insets; carousel/Health-tab gestures; haptics; camera/photo/barcode permissions; account export sharing; and long streamed Coach responses. Follow the remaining-work document for module-specific acceptance. Record phone/OS, app package/build, backend revision, reproducible failures and screenshots. Continue deferred feature work after these platform and connected-data checks pass.
