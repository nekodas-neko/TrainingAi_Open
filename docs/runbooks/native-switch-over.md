# Runbook: switching `com.trainingai.app` to the native app, and rolling back

_For #2840 and #2849. Rules come from [`native-testing.md`](../native-testing.md) step 5 and
[`canonical-runtime-android.md`](../canonical-runtime-android.md). The release APK is built by
`native-release.yml` (#3532; how to run it: [`native-testing.md`](../native-testing.md), "Building the
release APK"). Its first clean run was 41603532003 on 3 Nov 2026, a test build with versionCode 1.
The gaps found in the 11 Nov review (#3722) are closed here; nothing below depends on memory._

## The one rule

**Never uninstall `com.trainingai.app`, never `pm clear` it, never install with `-d`.** Any of the
three wipes the app's data folder. That folder holds every change the old app has not sent yet (the
five kinds in step 2), and it is what a rollback lands on. The ring's Bluetooth key used to be the
reason; the ring left Bluetooth on 17 Oct (#2808) and has no key on the phone to lose. The wrapper
below refuses all three, and lets only two read-only commands reach the phone's shell. If an
install fails (a signature mismatch, "version downgrade"), **stop and tell the Orchestrator**.
Never work around it.

## Before the day (checklist)

- ☐ The ring is on the Oura API (#2808), so there's no ring key to carry over.
- ☐ The owner holds an offline copy of the signing key (`debug-signing.keystore`, kept outside the
  repo on the owner's PC). Never upload or post it.
- ☐ **Server first.** The server release the APK is cut from is live: `/api/version` on production
  answers with that version. The APK is built from that released `v*` tag (`ref` in
  `native-release.yml`), **never from `main`**: `main` can hold app code whose server half has not
  shipped. The tag must include #3722 and #3728 (the verifier's permission floor and the old
  databases' backup exclusions), or the build fails its own check.
- ☐ **The three builds are a set, rebuilt together** (see *Version codes*): the native release APK,
  its emulator twin, and the rollback APK. A new native build makes the other two stale, because
  the rollback's code must sit above the native one's. Build them within 14 days of the switch: the
  artifacts expire then.
- ☐ The native release APK is signed with the installed app's certificate (SHA-256
  `d390062e…893c`, the `EXPECTED_CERT_SHA256` in `android.yml`) and has a higher `versionCode`
  than the phone reports **today**. Read it with the wrapper's dry run (step 5): `apk-latest` has
  offered newer builds since 3 Nov, so the installed code may no longer be 1492000.
- ☐ The rollback build exists (see *Rollback*), with a code **above** the native app's.
- ☐ The rehearsal passes with that set (see *Rehearsal*).
- ☐ The old web screens are still deployed, and stay deployed while a rollback is possible (see
  *Rollback*).
- ☐ The owner has said yes on the switch-over issue.
- ☐ Preview is still installed, so step 1 can empty its queues and its settings can be read.

## Rehearsal

Run it with the APKs of the day, once the set exists. First build the native app a second time for
the emulator: `native-release.yml` with the same `ref` and `version_code` and **emulator_abi**
ticked. That build is the same code and code number with x86_64 added, under its own artifact name
(`trainingai-release-apk-emulator`). It is **never** installed on the phone: the switch APK is
arm64-only, keeps its libraries stored in the APK, and on the x86_64 emulator React Native's loader
looks there for x86_64 and the app dies on start (`SoLoaderDSONotFoundError`, seen on the first
rehearsal, 6 Nov). Then Actions → **Native switch rehearsal** (`native-switch-rehearsal.yml`) → Run
workflow, with

- **native_run_id**: the `native-release.yml` run of the emulator build (leave **native_artifact**
  on `trainingai-release-apk-emulator`);
- **rollback_tag** and **rollback_version_code**: the release and code of the rollback build;
- **installed_tag**: the release the phone runs today (the default `v1.492.0` is right only if
  the wrapper's dry run still reports 1492000).

On an emulator, offline and never signed in, it installs the phone's build, then the native APK over
it with `adb install -r`, then tries a downgrade (Android must refuse it), then the rollback over the
native app. After each step it checks the versionCode Android reports, that a marker planted in the
app's data folder is still there, and that the app starts and keeps running without a crash. Before
the emulator it runs `verify-android-upgrade.mjs` on each pair (package, the pinned certificate, a
rising code). The job summary lists every check; the artifact holds the screens and logs.

The switch APK itself goes through the same pair checks and installs when it is the one named
(**native_artifact** `trainingai-release-apk`): only its start checks are meaningless on the
emulator. It does not cover the owner's data or signed-in state, One UI, the radios or Health
Connect.

## Switch-over day, in order

1. **Preview: empty its queues and note its settings.** Preview (`com.trainingai.app.preview`) is a
   separate app. The native app installed today as `com.trainingai.app` starts with an empty store
   and can't read what Preview holds.
   - Open Preview on Wi-Fi, go to **More → Data & Sync**, tap **Sync now**, and wait for
     **No changes waiting to upload**.
   - **Note these from Preview first.** They live only on the phone (`platform-settings.v1`) and
     are typed in again at step 9:
     - every fixed-time reminder (up to 12): type, title, time, days, and whether it is on;
     - the calendar workouts are added to, and whether completed workouts are added automatically;
     - guided activity cues, on or off;
     - keep screen awake during training, on or off;
     - health alerts, on or off;
     - the morning Oura fetch, on or off.
     Also note the appearance choices, the Home layout and which widgets are on the home screen,
     and any exercise set to lb instead of kg.
   - Keep Preview installed until the native app has run for a week (step 11 quiets it).
2. **Old app: nothing unsent, of any of the five kinds.** Open the current app on Wi-Fi. Anything
   left is lost to the native app, and only a rollback gets it back.
   1. **Outbox and dead letters.** Go to **More** and wait until the **Sync health** card is gone.
      Retry or discard the dead letters first. That card counts these two only.
   2. **An unfinished workout, activity or walk.** Home shows it. Finish it or discard it.
   3. **Detected walks awaiting review.** Home lists them. Save or dismiss each one.
   4. **Unsent settings** and 5. **the sensor upload queues.** Neither has a screen. The
      Implementer reads them, read-only, with Chrome on the PC (`chrome://inspect` → the app's
      WebView → Console), after the app has sat open on Wi-Fi for a minute:
      ```
      ['ta_prefs_unsynced', 'detection-events-outbox', 'ta-cadence-captures',
       'ta-oura-ble-pending-live-steps', 'ta-oura-ble-pending-live-steps-auto',
       'ta-oura-ble-pending-accel-chunks']
        .map((k) => [k, JSON.parse(localStorage.getItem(k) || '[]').length])
      ```
      Every count must be 0. The keys are the ones a sign-out checks
      (`lib/sign-out-pending.ts`, `lib/sign-out-storage.ts`). If one stays above 0, stop and tell
      the Orchestrator. **Don't use Sign out as the check**: with nothing unsent it signs out at
      once and clears the phone's store, which a rollback needs.
3. **Fresh database backup.** Actions → **Database backup** (`db-backup.yml`) → Run workflow. Wait
   for green: it restores the dump into an empty Postgres to prove it.
4. **Plug the phone in** by USB with debugging on. Exactly one phone should be attached.
5. **Rehearse (dry run).** From the repo root:
   ```
   node scripts/native-switch-over/install.mjs --apk <native-release.apk>
   ```
   It pulls the installed `base.apk` into `native-switch-over-backups/<date>/`, reads the installed
   versionCode and the granted permissions from the phone (`adb shell dumpsys package`, read-only),
   and writes `record.json` (versionCode, certificates, APK hash, and the phone's own report under
   `phone.before`). Then it checks: same package, same signing certificate, a higher versionCode,
   and backup rules (`apkanalyzer manifest print`: `allowBackup="false"`, or both
   `fullBackupContent` and `dataExtractionRules` set). It prints the install command and stops.
   **Post the versionCode it reports on the switch-over issue**; if it isn't the code the set was
   built against, rebuild the set. Fix anything it refuses before going on. The tools come from the
   Android SDK (`apksigner`, `apkanalyzer`, `adb`); pass `--apksigner`, `--apkanalyzer`, `--adb` or
   the `APKSIGNER` / `APKANALYZER` variables if they aren't on `PATH`.
6. **Install.** Same command plus the explicit flag:
   ```
   node scripts/native-switch-over/install.mjs --apk <native-release.apk> --i-have-the-owners-yes
   ```
   It runs only `adb install -r`, then reads the phone again and adds `phone.after` and
   `phone.changes` to `record.json`: the new versionCode, and every permission that was granted
   before and isn't now. It prints that list; step 9 grants them again. If it prints a `WARNING`
   about the versionCode, stop and tell the Orchestrator. Keep the backup folder until the rollback
   window closes.
7. **Sign in** on the phone with the owner's account.
8. **Restore from cloud.** A fresh install downloads no history until this is tapped. **More →
   Data & Sync → How far back to restore: 1 year → Restore from cloud → Restore.** Stay on Wi-Fi.
   It resumes by itself if the app is closed or the connection drops; if it shows **Resume**, tap
   it. Go on to step 9 while it runs.
9. **Set up again.** Nothing carries over from the old app or from Preview. Use the notes from
   step 1 and the wrapper's "no longer granted" list.
   - **Display over other apps:** Settings → Oura → "Open Display over other apps", allow it (the
     owner said yes on #3561), then turn the morning Oura fetch back on.
   - **Notifications:** allow them when asked, or under More → Settings → Notifications.
   - **Fixed-time reminders:** add each one from the notes.
   - **Calendar:** choose the calendar again, and the automatic-add switch.
   - **Guided activity cues, keep-awake, health alerts:** set each as noted.
   - **Appearance and Home layout:** set as noted.
   - **Widgets:** the old app's widgets are gone from the home screen. Add the native ones again.
   - **kg / lb:** set each exercise that was in lb.
   - **More → Devices & connections:** pair the heart-rate strap and the scale again.
   - **More → Health Connect:** turn on **Sync Health Connect**, and allow the permissions it asks
     for. It starts switched off on a fresh install.
   - **Battery:** Android Settings → Apps → TrainingAi → Battery → **Unrestricted**. The old
     app's setting does not always survive, and without it reminders and recordings are held back.
10. **Smoke checks, native app.** Tick each, on the phone:
    - ☐ More → About shows the expected app version and build, the commit it was built from, and
      the live server version.
    - ☐ Home shows today's data, and yesterday's after the restore has passed it.
    - ☐ Log one set in a workout; it shows on the server (Preview or the web shows it after a sync).
    - ☐ Log one food and one glass of water; More → Data & Sync returns to **No changes waiting to
      upload**.
    - ☐ The rest timer's alert arrives with the screen off.
    - ☐ A fixed-time reminder set two minutes ahead fires once.
    - ☐ The strap's heart rate shows during a workout and is saved with it.
    - ☐ One weigh-in from the scale files.
    - ☐ Health Connect sync runs and reports a time.
    - ☐ A walk records its route with the screen locked.
    - ☐ A widget shows today's numbers.
    - ☐ Android Settings → Apps → TrainingAi → Notifications lists only the native app's
      categories: the old app's are deleted on the first start (#3728).
    Report the results on the switch-over issue, naming what wasn't checked.
    [`device-smoke-checklist.md`](../device-smoke-checklist.md) is for the Capacitor app and
    applies again only after a rollback.
11. **Quiet Preview for its week.** It stays installed and plans the same reminders, so each would
    arrive twice. In Preview: switch every reminder off (don't delete them: they are the notes),
    and turn **Sync Health Connect** off so two apps don't import the same records. Stop logging in
    Preview.

The wrapper never runs in CI.

## Rollback

**The rule (the owner accepted it on #3721 item 4, 11 Nov 2026):**

- **Who decides:** the owner, and nobody else.
- **Deadline:** 7 days from the switch. After that the window is closed: the old files may be
  deleted (with the owner's yes, #3728) and the old screens retired.
- **Triggers:** the owner can't log a workout or food; records go missing; or sign-in breaks and
  isn't fixed within a day.
- **Until the window closes** the old web screens stay deployed, the rollback APK and the backup
  folder are kept, and nothing deletes the old app's files on the phone.

Android refuses to install a lower `versionCode`, and a downgrade needs an uninstall, so a
rollback has to carry a code **above** whatever is installed (the native app's).

1. **Empty the native app's queues first.** The rollback app can't read the native store. On
   Wi-Fi: **More → Data & Sync → Sync now**, and wait for **No changes waiting to upload**. Finish
   or discard any workout or activity in progress. If sign-in is what broke and it can't sync,
   say so on the issue before going on: those changes stay on the phone, unread, until a native
   build is installed again.
2. **Check the old web screens are still deployed** (the server version in production still serves
   them). The rollback app is a WebView onto them; without them it opens to nothing.
3. Actions → **Android** → Run workflow, `release_tag` = the last Capacitor release (for example
   `v1.513.0`) and **version_code** = a number above the native app's code. It builds from that
   tag with the same signing key, checks the certificate, and attaches
   `app-<tag>-versioncode-<n>.apk` to the release. The tag's regular APK is never overwritten.
   Leave **version_code** blank for every normal build. Normally this build already exists: it is
   part of the set.
4. Download that APK and run the wrapper on it, dry-run first, then with
   `--i-have-the-owners-yes`. It refuses unless the code is higher than what's installed.
5. The old app opens on the files it left at the switch, as they were that day. It syncs forward
   from the server. Its notification categories come back the first time each is used, with
   Android's default settings.
6. A rollback app doesn't undo anything the native app wrote to the server. Tell the Orchestrator
   what you saw.

**After a rollback the codes stay high.** The phone now holds the rollback's code (native + 500):

- the **next native build** needs a code above it. The formula below won't clear it until the
  version moves on, so give `native-release.yml` the higher of the formula's value and the
  rollback's code + 500, and rebuild the whole set;
- a later Capacitor release needs the same override, so the weekly formula
  (`major*1e6 + minor*1e3 + patch`) can't be used until it overtakes it.

## Version codes

Android installs only a higher `versionCode` over a lower one. The installed Capacitor app was
**1492000** (1.492.0) when read from the phone on 3 Nov 2026. `apk-latest` has offered newer
builds since, so trust the wrapper's dry run, not this number.

- **Native release:** `2,000,000 + minor × 1,000 + patch` of the released version it is cut from
  (cut at 1.515.0 → `2515000`; a second native build at the same version adds 1). This clears every
  code the Capacitor formula (`major × 1e6 + minor × 1e3 + patch`, all below 2,000,000 for 1.x) can make.
- **Rollback build:** the native code of the same set **+ 500**, built from the last Capacitor tag.
- **Always rebuilt as a set.** Native, its emulator twin and the rollback are built together and
  rehearsed together. The 6 Nov set shows why: native 2519000 fell behind `main`, and a rebuild at
  1.520.0 is 2520000, which is above that set's rollback (2519500). A rollback from an older set
  would be refused by Android as a downgrade.
- The Orchestrator decided this on 3 Nov 2026 (#2849). Change it only with a note there.

## What the release build's own check covers

`mobile/scripts/verify-release-apk.mjs`, run by `native-release.yml` on the signed APK. The job
fails and keeps no APK unless: the package, certificate and version code are right; the backup
rules exclude the session, the native health database and the old app's leftover databases
(`trainingaiSQLite.db` and `oura_raw.db` in `databases/`, #3728); every permission pinned in the
workflow is declared, "Display over other apps" among them, and background location is not; and
both foreground services are declared with their types.

## What this does not cover

Device behaviour of the native app itself, and the old app's files on the phone: they stay until
the rollback window closes and are deleted only with the owner's yes (#3728).
