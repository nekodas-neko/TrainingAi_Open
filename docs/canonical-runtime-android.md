# Canonical Runtime — Android APK Release & Signing

Moved out of `CLAUDE.md` on 2026-09-02 to keep that file to what every session needs —
this is consulted when touching `android/**`, cutting a release, or debugging an APK
install/signing problem, not on every session. Nothing changed in the move.


**Policy (2026-07-06, see `docs/superpowers/plans/2026-07-06-apk-canonical-target-dual-path-tax.md`):**
the app's single canonical, supported runtime is the APK on the Samsung S25 Ultra. The web build
exists solely as a dev/QA surface (`pnpm dev` pre-merge testing). This section exists so the
question is never re-litigated per change.

> **Amended 2026-08-02 — this is now a *current* target, not a permanent one.** The owner has
> stated two things that bound it: **other people already use the app** (one friend has an account
> today), and the long-term intent is **production and a Play Store listing**. So "the S25 APK is
> the only runtime" stays true for *engineering trade-offs today* — device-first verification, no
> web-only features — but it is no longer safe to treat "single user, sideloaded, no store" as a
> permanent premise when making architectural decisions. In particular: every write stays `user_id`
> scoped, the sync engine is **maintained and extended rather than reduced**, and no user-visible
> surface should assume the owner's own device or wearable. See
> [`docs/device-agnostic-source-architecture.md`](docs/device-agnostic-source-architecture.md).
> A Play Store listing additionally requires a privacy policy, data-safety declarations, and a
> **declared-use-case review for Health Connect access** — that last one gates real multi-user
> support and is not a formality.

- **When behaviour must diverge, the device wins.** Never add product features or affordances that
  only make sense on web; web-only UI work is frozen.
- **The web online-only read fallback exists only so `pnpm dev` renders.** It must stay
  logic-free: a pure fetch → render pass-through. It must never carry defaults, derivations,
  band/threshold math, or write semantics the device path lacks — a fallback that holds no logic
  structurally cannot drift. Reference pattern: the supplements reads in
  `app/nutrition/nutrition-content.tsx`.
- **One write function per domain.** The web API route and the `pushMutations` branch in
  `lib/data/postgres/adapter.ts` must call the same shared function — `logExerciseFromPayload`
  (`packages/shared/src/workout/log-exercise.ts`) is the reference. The push branch may parse/validate the payload,
  but every actual write goes through the shared function.
  CI enforces this: `scripts/check-push-mutations.js` fails the Custom Rules check if
  `pushMutations` touches `this.db` or raw `sql` directly.
- **Do NOT delete the PWA plumbing** (`app/manifest.ts`, the service worker, the install
  affordance). The APK is a WebView loading the Railway URL remotely (`capacitor.config.ts`
  `server.url`), so the SW is what gives the APK offline cold-start AND is the push-notification
  transport. Removing it is a device regression, not a cleanup. Full PWA removal only makes sense
  as part of the unscoped "bundle the shell into the APK + native FCM push" endgame project (noted
  in `docs/implementation-backlog.md`, not yet planned).
- **Green `pnpm dev` is necessary, never sufficient.** For any change touching an offline-first
  domain, a native plugin, safe-area, gestures, or notifications, the merge gate is the on-device
  smoke run (`docs/device-smoke-checklist.md`) — or, when no device is available in-session, an
  explicit Known-Issues row in `projectOverview.md` marking the change NOT verified on device.

### Getting a new APK — CI already built it; a local Gradle build is the fallback

**First: check whether an APK is needed at all.** The APK is a WebView loading the app from
Railway (`capacitor.config.ts` `server.url`), so **JS, TypeScript and server changes reach the
device through a Railway deploy with no rebuild** — including everything under `lib/`, `app/`,
`components/` and `packages/`. Only `android/**` (Kotlin), `capacitor.config.ts`, and dependency
changes need a new APK. A session should say which half its PR touches; if it's the JS half,
merging *is* the delivery.

**When one IS needed, download it — don't build it.** `.github/workflows/android.yml` compiles the
Kotlin, runs the JVM protocol tests, and builds a debug APK on every PR touching native paths. On
merge to `main` it publishes that build to a single rolling release at a stable URL:

```
https://github.com/nekodas-neko/TrainingAi_Open/releases/download/apk-latest/app-debug.apk
```

Always the newest `main` build, non-expiring, and genuinely no login required — verified in a
logged-out browser on 2026-08-17, which is the entire point of the public-repo migration (Q-49). For an unmerged PR the APK is a
workflow artifact (`app-debug-apk`) on that PR's Android run, kept 14 days.

> ### ⛔ Before telling anyone to uninstall the app, read this
>
> **An uninstall destroys the Oura ring key, and it is not recoverable from this repository, the
> server, or any log.** `OuraBlePlugin.kt` keeps it in Android SharedPreferences and says so in its
> own comment — *"the key never leaves SharedPreferences; never logged"*. That is deliberate and
> correct, and it means an uninstall leaves the BLE service logging `no key stored` and the ring
> unreachable. The only copy is the `key.hex` produced by the original `open_oura` re-key, on
> whoever's machine ran it.
>
> **The obvious recovery is the one that must not be taken.** Re-onboarding the official Oura app
> re-keys the ring — and can force a firmware update that changes the BLE event encoding, which is
> what the frozen firmware exists to prevent. That converts a lost-credential problem into a full
> protocol re-validation.
>
> So: **confirm the owner has `key.hex` in hand before any uninstall**, and say so explicitly rather
> than assuming. This cost a live session on 2026-08-17. The uninstall was correct and necessary
> (see the signing note below); the omission was enumerating only the JS local store as "what you
> lose" and never checking the native side. An uninstall also wipes the 14-day local raw window
> (harmless — the server holds the archive) and any unsynced outbox mutation (**not** harmless —
> flush it first with pull-to-refresh on More, which pushes; the "Sync now" button in Data & Sync
> only pulls and will not flush anything).
>
> **Owner confirmed holding `key.hex` on 2026-08-25** — so the ring is recoverable, and an uninstall
> is a decision rather than a gamble. Still ask: one file on one machine goes stale silently, and
> this line would never know.

**These APKs upgrade in place only while the `ANDROID_DEBUG_KEYSTORE_B64` repository secret is
set.** Gradle's fallback debug keystore is generated per machine, and a GitHub runner is a fresh
machine every run — so before that secret existed, every published APK carried a **different**
signing key, Android refused to install each one over the last (`App not installed`), and the only
way through was to uninstall. On an offline-first app **an uninstall drops every outbox mutation
that has not yet reached the server**, which made routine APK delivery a data-loss hazard rather
than an inconvenience. The Android job warns loudly when the secret is missing. To (re)create it:

```bash
keytool -genkeypair -v -keystore debug-signing.keystore \
  -storepass android -keypass android -alias androiddebugkey \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=TrainingAI Debug, OU=Dev, O=TrainingAI, C=AU"
base64 -w0 debug-signing.keystore    # macOS: base64 -i debug-signing.keystore
```

Paste the output into **Settings → Secrets and variables → Actions → New repository secret**, named
`ANDROID_DEBUG_KEYSTORE_B64`. It is a credential: never commit it (`android/.gitignore` excludes
it), and never reuse it as a release/Play Store key. **Changing it invalidates in-place upgrades
once more**, so a device carrying an APK signed by the old key has to uninstall one final time.

Note the workflow is **path-gated** on `android/**`, `capacitor.config.ts`, `pnpm-lock.yaml` and its
own file — **not** `package.json` (this line claimed it until 2026-08-31): a version bump must not
mint an APK the WebView already has. A JS-only PR produces no Android run, which is correct and not
a failure, and it is deliberately **not** a required check, so a filtered-out run leaves none pending.

**Local build — only if CI is unavailable or you need an unpushed working tree.** Sessions can't
do this (no Android SDK in the sandbox; the Gradle download is proxy-blocked), so it is yours to
run. It jumps to the repo root itself, so it is safe to re-run from inside `android/` after a
failed attempt:

```bash
cd "$(git rev-parse --show-toplevel)" && \
git checkout main && git pull origin main && \
npx cap sync android && \
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" && \
cd android && ./gradlew assembleDebug && cd ..
```

Install the result (`android/app/build/outputs/apk/debug/app-debug.apk`) with `adb install -r`, or
transfer it over. If `pnpm`-managed deps changed, run `pnpm install` before `npx cap sync android`.

The `JAVA_HOME` export points Gradle at the JDK bundled inside Android Studio (git-bash/Windows
path — adjust if Android Studio is installed elsewhere, or drop the line entirely once `JAVA_HOME`
is set permanently via Windows Environment Variables).

---

