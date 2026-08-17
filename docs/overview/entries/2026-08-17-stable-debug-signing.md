## 2026-08-17 — every published APK was signed with a different key

**Branch:** `claude/docs-review-agent-setup-3ocl7m` · **Domain:** `platform`, `devices` ·
Build config + CI, no application code.

### The report

The owner tried to install the current APK and got Play Protect's "unknown developer" warning,
then **`App not installed`**. It read like a device problem. It was not.

### What it actually was

`android/app/build.gradle` declared no `signingConfig`, and no keystore is committed — correctly,
since a keystore is a credential. So `assembleDebug` fell back to Gradle's auto-generated
`~/.android/debug.keystore`.

That file is generated **per machine**, and a GitHub runner is a fresh machine every run. So every
APK the Android workflow has ever published carried a **newly generated signing key**. Android
refuses to install an APK over an existing app signed with a different key, so no published APK
could ever install over the previous one. The only way through was to uninstall first.

**That is not an inconvenience on this app, it is a data-loss hazard.** The app is offline-first:
an uninstall wipes the local SQLite store, and any outbox mutation that has not yet reached the
server goes with it. The documented APK delivery path — "download `apk-latest`, install it" —
therefore had an unwritten step that could silently lose writes, every single time.

### The fix

A stable debug key, supplied at build time and never committed:

- `android/app/build.gradle` gains a `debugStable` signing config used by the `debug` build type,
  **both guarded on the keystore file existing**. Absent, nothing applies and Gradle's per-machine
  default is used exactly as before — so a local build with no key still works, and a fork is
  unaffected.
- `.github/workflows/android.yml` restores it from the `ANDROID_DEBUG_KEYSTORE_B64` repository
  secret before assembling, and **emits a CI warning when the secret is missing** rather than
  silently producing an APK that cannot upgrade.
- `android/.gitignore` excludes `debug-signing.keystore`; verified with `git check-ignore`.
- `CLAUDE.md`'s "Getting a new APK" section carries the `keytool` recipe and the warning that
  rotating the key costs one more uninstall.

The secret is read through `env:` rather than interpolated into `run:` with `${{ }}` — inline
interpolation substitutes raw text, which breaks on shell metacharacters and is a script-injection
surface. `secrets` is also unavailable in a step-level `if`, so the absent case is handled inside
the script rather than as a step condition.

### Not exercised

**The Gradle change has not been built.** The sandbox has no Android SDK and the Gradle download is
proxy-blocked, so the syntax is unverified locally — the Android CI job on this PR is the first
real evaluation, and it runs because this PR touches `android/**`.

**The in-place upgrade itself is unverified and cannot be verified from here.** It needs two
successive CI-built APKs signed by the same key, installed one over the other on the device. Until
the owner sets the secret and installs twice, this is a fix by construction rather than by
observation — and the *first* install after the secret is set still requires an uninstall, because
what is currently on the phone was signed by a now-lost per-runner key.

### Worth noting for whoever reads this next

The diagnosis came from a screenshot, and the tell was in what the screenshot did **not** say — no
storage error, no corrupt-package error, just `App not installed` after a successful 32.5 MB
download. Checking `android/` for a committed keystore took one grep and settled it. The report
"I think I have a device issue" was a reasonable read of the symptom and was wrong; the device was
behaving exactly as designed.
