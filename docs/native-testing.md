# Testing the native app, and releasing while it lands

_Owner decisions of 13 Oct 2026, recorded on #2836, #2808 and #2849. This guide applies while the
native app in `mobile/` (PR #2836) replaces the Capacitor app. Read it together with
[`canonical-runtime-android.md`](canonical-runtime-android.md). Its never-rules still hold for the
installed app._

## What changes

| | Capacitor app (today) | Native app |
|---|---|---|
| Where the screens live | On the server. The APK is a WebView onto Railway. | Inside the app on the phone. |
| How a fix reaches the phone | A release deploys the server, and the app shows the change on its next open. No reinstall. | Server fixes still ship by release. A screen fix needs a new app build installed, since there are no over-the-air updates yet. |
| Testing a screen | `pnpm dev` in a browser at 384 px, then the device check. | A development build on a phone, loading code from a laptop's bundler (Metro): an edit shows within a second or two. `pnpm --dir mobile web` gives a rough browser preview. The phone is the truth. |
| Old versions | None: every phone always ran the latest screens. | A phone can run an older app build against a newer server. |
| Cloud agents | Could run and check most screens in a browser. | Can type-check, run tests and use the browser preview, but can't reach a phone. |

The server and the app now ship separately:

- **The server** (Railway) holds the API routes, data and scoring. It ships by release, as before: a
  `v*` tag, deployed after the owner says "approve".
- **The app** (`mobile/`) holds every screen. It ships as a new build installed on the phone. A
  server release no longer changes any screen.

Two consequences:

- Until the minimum-version check exists (#2847), every server change has to keep working for app
  builds already installed. Add fields and routes; don't rename or remove them.
- "The device wins" still holds. The old app's web build is no longer the dev surface for native
  screens.

## The app builds

| Build | App ID | Signed with | Gets its data from | Who uses it |
|---|---|---|---|---|
| TrainingAi Dev, the current app's dev flavour (exists) | `com.trainingai.app.dev` | the stable key | the laptop's `pnpm dev` over `adb reverse` | the Implementer's device passes on the current app ([`canonical-runtime-android.md`](canonical-runtime-android.md)) |
| Native development (`development`, `android-development` profiles; shares the Dev ID, see below) | `com.trainingai.app.dev` | the stable key | a local or test server; code from a laptop's Metro | jsboiss, and the Implementer's device pass |
| TrainingAi Preview, the side-by-side build (#2878; `native-side-by-side.yml`) | `com.trainingai.app.preview` | its own key (see *Installing TrainingAi Preview*) | production, signed in as the owner | the owner, next to the current app |
| Release (`native-release.yml`, the `android-preview` profile as an APK) | `com.trainingai.app` | the stable release key | production | everyone, but only from the switch-over |

- **Separate app IDs** let Android treat each build as its own app. A `.dev` or `.preview`
  build installs next to the current app and never touches it, its data or the ring key. All four
  can sit on one phone.
- **⚠ The native development profiles still build `com.trainingai.app.dev` with the release key.**
  That's the same ID and signature as TrainingAi Dev, so installing one quietly replaces the other.
  Changing it has been asked for on #2836. Until it changes, don't install a native development
  build on the owner's phone.
- **Each native app ID needs its own sign-in callback** (`NATIVE_CALLBACKS` in
  `lib/auth/mobile/native-transaction.ts`, `MOBILE_CALLBACKS` in
  `mobile/src/features/account/session.ts`). The callback for a development ID is accepted only
  outside production. `android-preview` is accepted in production, because the side-by-side
  build signs in to production.
- **⚠ The `preview` profile builds the real ID, `com.trainingai.app`.** Never install it on the
  owner's phone before the switch-over checklist below passes.
- **A development build points at a local server or a test server, not production.** That is
  allowed because it isn't the real app. The rule "never point the real app at a local server" is
  about `com.trainingai.app`.

## Running both apps on one phone

Both apps are signed in as the owner against production, so they share the owner's data. That is
what makes comparing them possible, and it is also why these rules exist:

- **Health Connect access is fine.** #2836's blockers 1–3, including the first sync deleting
  `body_battery_daily` and `daily_zone_minutes` history, were fixed before it merged and shipped
  in 1.490.0.
- **Log each workout in one app only.** Both write to the same account, so logging in both
  creates two copies.
- **Expect plan-meal estimates to switch off in the old app** on days the new app records meal
  statuses. The owner approved this, pending its tuning note.
- **Turn reminders off in one of the two**, or they arrive twice.
- **The ring stays with the current app** until the owner moves it to the Oura API (#2808). The
  native app gets no ring Bluetooth.
- **The new app needs its server changes deployed first.** Native sign-in shipped in 1.490.0. The
  `android-preview` callback (#2878) ships at the release after it merges. Until then, TrainingAi
  Preview can't sign in.
- **Never uninstall `com.trainingai.app`, and never `adb install` a `com.trainingai.app` build**
  before the switch-over. See [`canonical-runtime-android.md`](canonical-runtime-android.md).

## The loop

1. **Build (jsboiss and agents).**
   - Work happens on a branch, and CI runs the mobile type-check and tests, the server tests and
     Custom Rules.
   - jsboiss checks on his test phones with a development build fed by Metro, against a local
     `pnpm dev` or a test server.
   - Cloud agents use `pnpm --dir mobile web` for a rough preview and `pnpm dev` for the API.
2. **Device check (Implementer, on the owner's machine).** Install the development build on the
   owner's phone and run it against the machine's local server. Use `.preview` builds, and
   `.dev` builds only on a phone where TrainingAi Dev is not installed. Results go on the device-check issue.
3. **Merge.**
   - Server changes ship at the next release (cadence below).
   - App changes (`mobile/**`, `packages/shared/**`) rebuild TrainingAi Preview and publish it.
     The owner installs it over the previous one, which has the same ID and key, so its data is
     kept.
4. **Compare (owner).** The owner uses both apps. Anything missing or wrong goes to BugFix, which
   files it as its own issue linked from #2849.
5. **Switch-over.** Once #2849 has no blockers, `com.trainingai.app` is replaced. Do it only when
   every item on this checklist holds:
   - The owner's ring is on the Oura API, so there's no ring key to carry over.
   - The server release the app needs is live (`/api/version`), and the release build is cut from
     that released tag, never from `main`.
   - The release build's signing certificate SHA-256 matches the installed app's, and its version
     code is above the one the phone reports that day (the wrapper's dry run reads it).
   - The native build, its emulator twin and the rollback build were built together, as a set, and
     the rehearsal passed with that set.
   - The backup rules keep the session token, the health database and the old app's leftover
     databases out of Google backups, and the APK declares every pinned permission and both
     foreground services. `native-release.yml` checks both on the signed APK
     (`mobile/scripts/verify-release-apk.mjs`).
   - The current app has nothing unsent, of any of the five kinds: the outbox and dead letters,
     unsent settings, the sensor upload queues, an unfinished workout, activity or walk, and
     detected walks awaiting review.
   - Preview's queues are empty and its phone-only settings are noted down.
   - A rollback Capacitor build is ready, signed with the same key and carrying an even higher
     version code, because Android won't downgrade without an uninstall. The old web screens stay
     deployed while a rollback is possible.
   - The install uses `adb install -r` only.
   - After the install: sign in, restore from cloud, set up again, run the native smoke checks,
     then quiet Preview for its week.
   - The day itself, in order, and the rollback (the rule the owner accepted on #3721):
     [`runbooks/native-switch-over.md`](runbooks/native-switch-over.md).
     Use its wrapper (`scripts/native-switch-over/install.mjs`) for the install.
6. **Later.**
   - Over-the-air updates, so screen fixes don't need a reinstall.
   - The minimum-version check (#2847).
   - An emulator smoke test in CI, so regressions are caught without a phone.

## Installing TrainingAi Preview

**On the phone:**
1. Open https://github.com/nekodas-neko/TrainingAi_Open/releases/tag/native-preview-latest.
2. Download `TrainingAi-Preview.apk` and open it.
3. Allow "install unknown apps" for the browser the first time.
4. It appears as **TrainingAi Preview**, next to TrainingAi. Sign in with the same account.

A new build is the same three steps: it installs over the old one and keeps its data. The release
notes give the commit and build date.

**How it's built** (`.github/workflows/native-side-by-side.yml`):
- It's `expo prebuild` then Gradle `assembleRelease`, with `APP_VARIANT=side-by-side`. That's the
  same path as the CI compile check, so no Expo account or cloud build is involved.
- It's arm64 only, with the JavaScript embedded, so no laptop is needed.
- **Its own signing key, never the real app's.** The keystore is stored on that release as
  `side-by-side-key.p12.gpg`, locked with the repository secret `SIDE_BY_SIDE_KEY_PASSWORD`. The
  owner sets the secret once, in Settings → Secrets and variables → Actions. The first build on
  `main` after that creates the key, and every later build reuses it.
- The build refuses to publish an APK whose ID isn't `com.trainingai.app.preview`, or that is
  signed with the real app's certificate.
- Pull requests build it with a throwaway key and publish nothing.
- **If the password or the key is ever lost:** delete `side-by-side-key.p12.gpg` from the
  release, set a new password, and re-run the workflow. That makes a new key. The new build won't
  install over the old one, so uninstall TrainingAi Preview first. That's safe: it's not the real
  app and holds no ring key. Then sign in again.

## Builds and signing (owner, 13 Oct)

- **Builds run on a GitHub runner**, so the signing key never leaves GitHub's secret store (owner,
  2 Nov, #3526). The release build is `.github/workflows/native-release.yml`, below. `mobile-build.yml`
  (Expo's cloud build) is **not used for the switch-over**.
- **Before publishing any release build**, check its signing certificate's SHA-256 against the
  installed app.
- **Development and side-by-side builds use their own key**, never the release key. TrainingAi
  Preview's is described under *Installing TrainingAi Preview*. It's built with `expo prebuild`
  and Gradle, as the release build is, with no Expo login.
- **Keep an offline copy of the release key** outside GitHub. GitHub never shows a stored secret
  again.
- **At store release, enroll in Play App Signing.** Google then holds the app's key, and builds only
  carry an upload key that Google can reset. From then on, Expo's cloud builds are fine.

## Building the release APK (`native-release.yml`)

The APK that replaces the current app: ID `com.trainingai.app`, the `android-preview` profile as an
APK (not the AAB), arm64 only, JavaScript embedded, talking to production. It is the same path as
TrainingAi Preview: `expo prebuild`, Gradle `assembleRelease`, then `apksigner`.

**Running it** (the Orchestrator, after review; never an agent on its own):
1. Read the installed app's version code from the phone (the Implementer does this with
   `apkanalyzer` or `adb shell dumpsys package com.trainingai.app`). Use a number above it.
2. Actions → **Native release build** → Run workflow, from `main`. Give `version_code` and, if
   not `main`, the `ref` to build. The workflow file itself must come from `main`.
3. The APK is the `trainingai-release-apk` artifact on the run, kept 14 days.

**What it does**
- Signs with the **stable key the installed app uses**: the `ANDROID_DEBUG_KEYSTORE_B64` repository
  secret (the legacy name for that key), decoded the way `android.yml` decodes it. The key is read
  only by the signing step, after the build, and deleted straight after.
- Fails the job, and keeps no APK, unless all of these hold:
  - the package is `com.trainingai.app`;
  - the certificate SHA-256 equals `android.yml`'s `EXPECTED_CERT_SHA256`;
  - the version code equals the input;
  - the merged manifest has `android:fullBackupContent` and `android:dataExtractionRules`, and the
    packaged XML (all three lists) excludes everything in `private-backups.cjs`: SecureStore, the
    widget and workout-status preferences, the WebView, the health database
    (`fitnessai.sqlite`, kept in `filesDir/SQLite`), and the two databases the Capacitor app
    leaves in `databases/` (`trainingaiSQLite.db` and `oura_raw.db`, with their side files; #3728);
  - the merged manifest declares every permission pinned in the workflow (`REQUIRED_PERMISSIONS`,
    "Display over other apps" among them), none of `FORBIDDEN_PERMISSIONS`, and both foreground
    services with their types (`REQUIRED_FOREGROUND_SERVICES`). These are floors: the APK may
    declare more, and the job's output lists all of it.
  The check is `mobile/scripts/verify-release-apk.mjs`.
- **Publishes nothing by default.** The build job is read-only and keeps the APK as a 14-day
  workflow artifact. It never touches `apk-latest` (which `lib/github-release.ts` offers to the
  installed Capacitor app as an update). Publishing is the next section, and is off until the switch.
- Installing it is the owner's switch-over step (checklist above), with `adb install -r` only.

### Getting a release build to the phone after the switch (#3723)

**Publishing is off until switch day is done and has held.** Before that, a published APK would be
a trap: it has the real app's ID and key and a higher version code, so opening it installs over the
Capacitor app and skips the runbook (emptying the queues, the backup, the rollback build).

After the switch:
1. Run **Native release build** as above, and also tick **publish** and **confirm_switch_done**.
   `publish` alone is refused before anything is built, and so is `publish` with `emulator_abi`.
2. Once every check has passed, a separate `publish` job (the only one with a write token; it
   builds and signs nothing) attaches `TrainingAi.apk` to the rolling release
   **`native-release-latest`**: a prerelease, never marked "latest". The 14-day artifact is kept
   as well.
3. `/api/version` reports that build as `nativeReleaseBuild` (version name, version code and the
   release page), read by `lib/github-release.ts` with the same five-minute cache as `apk-latest`.
   It is null before the first publish or when GitHub can't be read.
4. On the phone, the release app's More → About shows **A newer build is available** when the
   published version code is above the installed one. Tapping it opens the release page in the
   browser; download `TrainingAi.apk` and open it. It installs over the app and keeps its data and
   sign-in. Preview and development builds never show it.

Left for once the switch has held (#3723), not done yet: `release.yml` stops calling `android.yml`,
and `apk-latest` stops being offered.

**If it fails on the certificate:** the secret isn't the installed app's key. Don't work around it
and never uninstall. Compare with `mobile/scripts/verify-android-upgrade.mjs --existing <the
installed APK>`.

## Release cadence during the native move

These rules are temporary, from 13 Oct 2026 until the switch-over settles. They override "releases
are weekly, on Tuesday" in [`CLAUDE.md`](../CLAUDE.md) and [`owner-manual.md`](owner-manual.md).

- **Server releases go out on demand**, up to once a day, on any weekday. Each one still needs the
  owner's yes, recorded on its release issue.
- **jsboiss may run the Release workflow too** (owner, 13 Oct: "Jsboiss can approve for now if we
  said its all good"). He may run it once the release issue shows two things: the owner's yes, and
  the Orchestrator's release test with nothing open against it. Until then, nobody runs it. The
  Orchestrator says so plainly on each release issue, and checks production within the hour,
  whoever deployed.
- **Keep each release small:** one hotfix PR or a few related changes. A migration still ships
  alone. Every release takes an encrypted, restore-checked backup before it deploys
  (`db-backup.yml`, #2867).
- **Label native backend changes the app needs right away `hotfix`.** The Orchestrator ships them
  the same day they merge. #2773's Android sign-in fix goes in the first one.
- **After each deploy**, the Orchestrator checks `/api/status`, `error_events` and Railway's 5xx
  responses within the hour. Rollback means redeploying the previous Railway deployment. The native
  migrations only add tables, so going back is safe.
- **The first release on this cadence** ships the changes already merged since v1.489.0, on their
  own, before any native hotfix. If something breaks, that keeps the cause clear. #2794's device
  check still gates it.
- **App builds don't need a release.** The side-by-side app is published on merge.
- **The weekly Tuesday release returns** once the owner is on the native app and #2849 has no
  blockers. At the same point, merging to `main` moves to needing both approvers, the owner and
  jsboiss (#2871).
