# Runbook: switching `com.trainingai.app` to the native app, and rolling back

_For #2840 and #2849. Rules come from [`native-testing.md`](../native-testing.md) step 5 and
[`canonical-runtime-android.md`](../canonical-runtime-android.md). The release APK is built by
`native-release.yml` (#3532; how to run it: [`native-testing.md`](../native-testing.md), "Building the
release APK"). Its first clean run was 41603532003 on 3 Nov 2026, a test build with versionCode 1._

## The one rule

**Never uninstall `com.trainingai.app`, never `pm clear` it, never install with `-d`.** Uninstalling
destroys the Oura ring's BLE key, which can't be recovered, and drops any outbox rows not yet
synced. The wrapper below refuses all three. If an install fails (a signature mismatch, "version
downgrade"), **stop and tell the Orchestrator**. Never work around it.

## Before the day (checklist)

- ☐ The ring is on the Oura API (#2808), so there's no ring key to carry over.
- ☐ The owner holds an offline copy of the signing key (`debug-signing.keystore`, kept outside the
  repo on the owner's PC). Never upload or post it.
- ☐ A native release APK exists, signed with the installed app's certificate (SHA-256
  `d390062e…893c`, the `EXPECTED_CERT_SHA256` in `android.yml`) and with a higher `versionCode`
  (see *Version codes* below). Build it within 14 days of the switch: the artifact expires then.
- ☐ The rollback build exists (see *Rollback*), with a code **above** the native app's.
- ☐ The owner has said yes on the switch-over issue.

## Switch-over day, in order

1. **Flush the old app's outbox.** Open the current app on Wi-Fi, go to **More** and wait until the
   **Sync health** card is gone (no unsynced or dead-lettered rows). Anything left there is lost
   in the switch. Retry or discard the dead letters first.
2. **Fresh database backup.** Actions → **Database backup** (`db-backup.yml`) → Run workflow. Wait
   for green: it restores the dump into an empty Postgres to prove it.
3. **Plug the phone in** by USB with debugging on. Exactly one phone should be attached.
4. **Rehearse (dry run).** From the repo root:
   ```
   node scripts/native-switch-over/install.mjs --apk <native-release.apk>
   ```
   It pulls the installed `base.apk` into `native-switch-over-backups/<date>/`, writes
   `record.json` (installed versionCode, certificates, APK hash), then checks: same package, same
   signing certificate, a higher versionCode, and backup rules (`apkanalyzer manifest print`:
   `allowBackup="false"`, or both `fullBackupContent` and `dataExtractionRules` set). It then
   prints the install command and stops. Fix anything it refuses before going on. The tools come
   from the Android SDK (`apksigner`, `apkanalyzer`, `adb`); pass `--apksigner`, `--apkanalyzer`,
   `--adb` or the `APKSIGNER` / `APKANALYZER` variables if they aren't on `PATH`.
5. **Install.** Same command plus the explicit flag:
   ```
   node scripts/native-switch-over/install.mjs --apk <native-release.apk> --i-have-the-owners-yes
   ```
   It runs only `adb install -r`. Keep the backup folder until the native app has run for a week.
6. **Sign in** on the phone with the owner's account.
7. **Smoke checks** (see [`device-smoke-checklist.md`](../device-smoke-checklist.md)): today's
   data shows, a workout log saves and appears on the server, Health Connect sync runs, a
   reminder fires. More → About shows the expected app version and build, the commit it was built
   from, and the live server version. Report results on the switch-over issue, naming what wasn't
   checked.
8. **Re-grant what the new install doesn't inherit.** Settings → Oura → "Open Display over other
   apps", allow it (the owner said yes on #3561), then turn the morning Oura fetch back on.
   Notification permission is asked for on first use.

The wrapper never runs in CI.

## Rollback

Android refuses to install a lower `versionCode`, and a downgrade needs an uninstall, so a
rollback has to carry a code **above** whatever is installed (the native app's).

1. Actions → **Android** → Run workflow, `release_tag` = the last Capacitor release (for example
   `v1.513.0`) and **version_code** = a number above the native app's code. It builds from that
   tag with the same signing key, checks the certificate, and attaches
   `app-<tag>-versioncode-<n>.apk` to the release. The tag's regular APK is never overwritten.
   Leave **version_code** blank for every normal build.
2. Download that APK and run the wrapper on it, dry-run first, then with
   `--i-have-the-owners-yes`. It refuses unless the code is higher than what's installed.
3. A rollback app doesn't undo anything the native app wrote to the server. Tell the Orchestrator
   what you saw.

The code stays above the native app's from then on: a later Capacitor release needs the same
override, so the weekly formula (`major*1e6 + minor*1e3 + patch`) can't be used until it overtakes it.

## Version codes

Android installs only a higher `versionCode` over a lower one. The installed Capacitor app is
**1492000** (1.492.0, read from the phone on 3 Nov 2026).

- **Native release:** `2,000,000 + minor × 1,000 + patch` of the `main` version it is cut at
  (cut at 1.515.0 → `2515000`; a second native build at the same version adds 1). This clears every
  code the Capacitor formula (`major × 1e6 + minor × 1e3 + patch`, all below 2,000,000 for 1.x) can make.
- **Rollback build:** the installed native code **+ 500**, built from the last Capacitor tag.
- The Orchestrator decided this on 3 Nov 2026 (#2849). Change it only with a note there.

## What this does not cover

Device behaviour of the native app itself.
