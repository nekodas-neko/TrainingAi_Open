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
| Development (`development`, `android-development` profiles) | `com.trainingai.app.dev` | the dev key | a local or test server; code from a laptop's Metro | jsboiss, and the Implementer's device pass |
| Side-by-side (still to add; asked on #2836) | `com.trainingai.app.preview` | the dev key | production, signed in as the owner | the owner, next to the current app |
| Release (`android-preview`, `android-production`) | `com.trainingai.app` | the release key | production | everyone, but only from the switch-over |

- **Separate app IDs** let Android treat each build as its own app. A `.dev` or `.preview` build
  installs next to the current app and never touches it, its data or the ring key.
- **⚠ The `preview` profile builds the real ID, `com.trainingai.app`.** Never install it on the
  owner's phone before the switch-over checklist below passes.
- **A development build points at a local server or a test server, not production.** That is
  allowed because it isn't the real app. The rule "never point the real app at a local server" is
  about `com.trainingai.app`.

## Running both apps on one phone

Both apps are signed in as the owner against production, so they share the owner's data. That is
what makes comparing them possible, and it is also why these rules exist:

- **Don't give the new app Health Connect access** until #2836's blockers 1–3 are fixed and
  released. As reviewed, its first sync deletes `body_battery_daily` and `daily_zone_minutes`
  history.
- **Log each workout in one app only.** Both write to the same account, so logging in both
  creates two copies.
- **Expect plan-meal estimates to switch off in the old app** on days the new app records meal
  statuses. The owner approved this, pending its tuning note.
- **Turn reminders off in one of the two**, or they arrive twice.
- **The ring stays with the current app** until the owner moves it to the Oura API (#2808). The
  native app gets no ring Bluetooth.
- **The new app needs its server changes deployed first.** That means the native hotfix, including
  native sign-in.
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
   owner's phone and run it against the machine's local server. Use `.dev` and `.preview` builds
   only. Results go on the device-check issue.
3. **Merge.**
   - Server changes ship at the next release (cadence below).
   - App changes trigger CI to rebuild the side-by-side app and publish it. The owner installs it
     over the previous side-by-side build, which is the same ID and key, so its data is kept.
4. **Compare (owner).** The owner uses both apps. Anything missing or wrong goes to BugFix, which
   files it as its own issue linked from #2849.
5. **Switch-over.** Once #2849 has no blockers, `com.trainingai.app` is replaced. Do it only when
   every item on this checklist holds:
   - The owner's ring is on the Oura API, so there's no ring key to carry over.
   - The release build's signing certificate SHA-256 matches the installed app's, and its version
     code is above the installed one.
   - The backup rules keep the session token out of Google backups. Check with
     `apkanalyzer manifest print` on the release APK.
   - The current app's outbox is empty.
   - A rollback Capacitor build is ready, signed with the same key and carrying an even higher
     version code, because Android won't downgrade without an uninstall.
   - The install uses `adb install -r` only.
6. **Later.**
   - Over-the-air updates, so screen fixes don't need a reinstall.
   - The minimum-version check (#2847).
   - An emulator smoke test in CI, so regressions are caught without a phone.

## Builds and signing (owner, 13 Oct)

- **Builds run on a GitHub runner**, using `eas build --local` with a pinned `eas-cli` version, so
  the signing key never leaves GitHub's secret store.
- **Before publishing any release build**, check its signing certificate's SHA-256 against the
  installed app.
- **Development and side-by-side builds use their own key**, never the release key.
- **Keep an offline copy of the release key** outside GitHub. GitHub never shows a stored secret
  again.
- **At store release, enroll in Play App Signing.** Google then holds the app's key, and builds only
  carry an upload key that Google can reset. From then on, Expo's cloud builds are fine.

## Release cadence during the native move

These rules are temporary, from 13 Oct 2026 until the switch-over settles. They override "releases
are weekly, on Tuesday" in [`CLAUDE.md`](../CLAUDE.md) and [`owner-manual.md`](owner-manual.md).

- **Server releases go out on demand**, up to once a day, on any weekday. Each one still needs the
  owner's "approve".
- **Keep each release small:** one hotfix PR or a few related changes. A migration still ships
  alone, with a verified snapshot first.
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
  blockers.
