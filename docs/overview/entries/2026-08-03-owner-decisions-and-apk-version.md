# 2026-08-03 — five owner decisions, and the update button that could never say "up to date"

_Branch `fix/apk-version-from-package-json` · v1.252.7 · domains `app-shell` / `platform`_

Five questions were put to the owner in plain English with recommendations. All five came back. This
records them and fixes the one that turned out to be a live bug.

## The bug: the APK's version was frozen at 1.30.0

The owner's answer on update delivery was:

> *"I wanted app updates through the github releases so we just press the update button in the more
> section to download the new apk."*

**That is already built, end to end** — which makes the review finding it answers (F2, *"no
update-delivery path exists"*) wrong. F2 went looking for a live-update plugin, found none, and
concluded there was no path. The path is a sideload chain nobody had traced:

```
push to main → android.yml builds the APK → republishes the rolling `apk-latest` release
UpdateCheckCard (More) → compares installed versionName vs /api/version → links /api/download-apk
/api/download-apk → GitHub Releases API → redirect to the release asset
```

**But it was broken, in a way that could never self-correct.** `android/app/build.gradle` hardcoded

```gradle
versionCode 3
versionName "1.30.0"
```

while the app shipped **1.252.x**. CI reads `package.json` for the release *title and notes* — and
never stamps it into the build. So `isUpdateAvailable("1.30.0", "1.252.6")` compares 1 vs 1, then
**30 vs 252**, and returns true. Forever. Including the moment after installing the newest APK.

The card is designed to hide itself when you are current (`if (!latestVersion) return null`). It
could never reach that state.

### The fix

`build.gradle` derives both fields from `package.json` at configure time:

```gradle
def appVersionName = new groovy.json.JsonSlurper()
        .parseText(file("$rootDir/../package.json").text)
        .version
def appVersionCode = { -> major·1_000_000 + minor·1_000 + patch }()
```

Read at configure time rather than patched by CI, so a **local** Gradle build gets the same number —
a CI-only patch would leave local builds still lying. `versionCode` goes 3 → 1,252,006 and only ever
increases, so installs over the existing APK still work (Android refuses a lower code). The scheme
leaves room for 999 minors and 999 patches against a 2.1-billion ceiling.

`parseText(file.text)` rather than `parse(File)` — the `File` overload is newer-Groovy-only and
there is no way to find that out from here.

## The four other answers

**Play Store and other users are in the plan.** *"yes part of the plan. I want other people to be
able to use this app as its really good."* Recorded on F3. The consequences are architectural, not
cosmetic: every write stays `user_id`-scoped, the sync engine is **maintained and extended rather
than reduced**, and no surface may assume the owner's own phone or ring. The **Health Connect
declared-use-case review is the long pole** — an external approval with a lead time nobody controls,
so it wants starting well before anything else on the launch list.

**Q-1 is split.** *"I dont see an issue in splitting it. go for it."* **Q-1a** (client bearer auth +
`apiUrl()`) is now its own entry with **no Gate A — startable now**. **Q-1b** (workspace split +
static export) keeps the deferral and the second-Railway-service block. The point of the split: a
native client needs bearer auth permanently, whichever way the shell ships, while the export bundle
is throwaway the moment Compose replaces a screen. Fused, the durable half inherited the throwaway
half's blocker.

**The two orphaned BDI model files stay.** *"yes lets keep then."* They move to the bucket with the
other eight under Q-49 A1 rather than being deleted — as a **separate, non-required list**, so the
boot check does not start demanding files no loader reads. Q-50's *other* item (`inference/dhrv`) is
untouched and still deferred to D7.

**Q-1b now has a gate it did not have this morning.** The owner asked for a checklist to run the
cold-start profile, so
[`docs/device-perf-profiling-checklist.md`](../../device-perf-profiling-checklist.md) exists:
`chrome://inspect` setup, three recordings (cold start ×3, tab switching, 30 seconds idle), exactly
what to send back, and the thresholds that decide the outcome. Two of the three recordings can
surface bugs rather than trade-offs — a slow return to an already-opened tab would mean the
v1.251.2 prefetch is not working, and a repeating idle spike would be a timer re-rendering the
screen every second.

That measurement is the single highest-leverage item outstanding: it decides whether Q-1b is worth
building at all, and the responsiveness investigation already retracted the navigation half of its
case (*"tab switches are already local … it will not make navigation faster"*).

## Verification

- Version arithmetic checked directly: `1.252.6 → 1,252,006`, and `> 3`, so the install path holds.
- `$rootDir/../package.json` resolves to the repo root from `android/`.
- Grepped for other references to the frozen `1.30.0` — none outside the new comment.
- Typecheck, lint and the doc-link check are unaffected by a Gradle change but were run anyway.

## Not verified

**The Gradle file itself does not parse here.** No Android SDK in the sandbox and the Gradle download
is proxy-blocked, so CI's Android job is the only compiler that sees it — and that job is **not a
required check**, so it was watched explicitly rather than left to the merge gate.

**The fix cannot take effect until the next APK is installed**, because it lives in the file that
builds the APK. The currently-installed build still reports `1.30.0`, so the update card will keep
claiming an update until then. That is the bug still showing, not a new one.
