# 2026-08-04 — Q-59: the update banner now tracks the APK, not the app version

**Branch:** `fix/update-banner-native-only` · **Domain:** app-shell · **Version:** 1.256.0

## What was wrong

The owner installed the current APK, three JS-only releases landed within the hour, and More lit up
telling them to reinstall — for changes their device already had. #1040 had unfrozen the APK's
`versionName` (it was pinned at 1.30.0), which was a real bug, but it fixed the wrong half.

`UpdateCheckCard` compared the installed APK's `versionName` against `/api/version`, i.e. the
server's `package.json`. The APK is a WebView loading Railway, so **almost every release reaches the
phone with no reinstall at all**. The comparison was therefore asking "has the app changed?" when the
only useful question is "has the thing you have to install changed?".

## The part that wasn't in the plan

The plan blamed the comparison. The comparison was only half of it.

`.github/workflows/android.yml` is path-gated on `android/**`, `capacitor.config.ts`, `package.json`
and `pnpm-lock.yaml` — and **every release bumps `package.json`'s version field**. So the workflow
rebuilt the APK and republished the rolling `apk-latest` release on *literally every merge*. Checked:
the last six `package.json` commits were all one-line version bumps, none native, and
`pnpm-lock.yaml` had not changed since #962.

That means there genuinely *was* a newer APK every time — functionally identical, built from the same
Kotlin, differing only in `versionName`. The banner was not lying. It was answering a question nobody
asked, about an artifact that was being manufactured for no reason.

Fixing only the comparison would have left it pointing at a target that still moved on every release.

## What changed

**`package.json` came out of the Android path gate.** A version bump is not a native change.
Dependency changes — the real reason it was listed — always rewrite `pnpm-lock.yaml`, which a version
bump never touches, so coverage is unchanged while the noise goes away. The APK is now rebuilt only
when something about it would actually differ, and it stops burning ~6 CI minutes per release.

**The card compares against the newest published APK.** `/api/version` now also returns
`nativeVersion`, read from the `apk-latest` release, alongside the build's commit and publish time
for diagnostics. `lib/github-release.ts` holds the one release lookup, shared with
`/api/download-apk`, which had its own copy of the same fetch.

**Three states, because "could not check" is not "up to date".** The lookup is a network call and can
fail; rendering that as an all-clear is the same class of mistake as the false alarm being removed.
So: amber row with a download link, a green "Up to date — v… is the newest build" row, or a neutral
"Could not check". The middle one is the positive confirmation the card never had — it previously
rendered `null` when there was no update, which is why the owner's install check this morning was
ambiguous.

## Verification

19 tests across the two pure modules. `mapApkRelease` is pinned against the **real** `apk-latest`
payload captured from the GitHub API today, so the parser is tested against the string the workflow
actually publishes rather than one invented to match it. `resolveUpdateState` pins all four
transitions including the JS-only-release case that caused the report. Both routes exercised against
`pnpm dev`: `/api/version` returns the new shape, `/api/download-apk` still 401s unauthenticated.

## Not verified

**The card itself never rendered.** It is `Capacitor.isNativePlatform()`-gated, so all three states
are unreachable in the web sandbox — the decision logic is tested, the markup is not. New rows in a
list that already exists, no new layout or safe-area surface.

**`nativeVersion` reads null in the sandbox** and the tested happy path is the parser, not the live
fetch: the repo is private, so the release lookup needs `GITHUB_RELEASES_TOKEN`, which only
production has. In the sandbox it correctly falls through to "could not check".

**One more install is needed before this goes quiet.** The owner is on ~1.252.x; the newest published
APK is 1.255.1. The banner will correctly say an update is available until that install, and only
then show "up to date". After it, it stays quiet until a genuine native or dependency change.

**Known limitation, deliberate.** A native change that ships *without* a version bump republishes the
APK at the same version, so the card will not notice it. Closing that needs the APK to carry its own
build SHA, which needs a Gradle stamp and therefore a new APK install to bootstrap — more machinery
than the reported bug justifies. Every native change in this repo's history has bumped the version,
per the standing changelog rule. Recorded as a Known Issue rather than left silent.
