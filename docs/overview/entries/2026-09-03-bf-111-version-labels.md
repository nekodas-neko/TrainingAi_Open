# BF-111 — About stops looking like it contradicts itself

**Branch:** `fix/bf-111-version-labels` · **Lane:** B · **Domain:** `[app-shell]`

The About screen showed the app as **v1.436.2** and, two rows below, a green tick reading **"Up to
date — v1.414.1 is the newest build."** Both numbers were right, which is what made it a bug: the
first is the web app, advanced by every Railway deploy; the second is the newest published APK, and
"up to date" was a true statement about it. Nothing on the screen said either of those things, so a
green tick appeared to vouch for the smaller number.

## The date was already in the payload

`/api/version` has returned `nativeBuiltAt` — the release's publish time — alongside `nativeVersion`
and `nativeBuildSha` all along. The card read `nativeVersion` and dropped the rest.

**That is the third entry today with this exact shape**: a value computed and served, and no screen
reading it (Q-529's per-night `provisional` flag, Q-516's `informativeShare`, now this). Worth noting
as a class rather than three coincidences — the server half tends to ship with its consumer assumed.

## What shipped

**Every state now names the INSTALLED build**, which is the half that answers the question the card
exists for. Previously the update state named the *newest* version — a build the phone does not
have — and said nothing about the one it does, so a user on an old APK could not tell what they were
running. `App.getInfo().version` was already being fetched for the comparison and then discarded.

- up to date → `Up to date — v1.414.1, built 31 Aug`
- update available → `New Android build — v1.414.1 (31 Aug)` over `You have v1.400.0 — tap to download`
- lookup failed → `Could not check for a newer build — you have v1.400.0`

The section header is **Android build**, not "App build" — that name is what let the tick read as a
claim about the chip above it. The chip is labelled `App v1.436.2` with one line saying the app
updates itself, which is the reason the two numbers differ at all.

**The three-state shape is unchanged and deliberate.** "Could not check" is still not "up to date":
a false all-clear is the same class of mistake as a false alarm.

## The date has a timezone trap, so it is a helper

`formatBuildDate` (`components/more/build-label.ts`) goes through `toAestDay` + `formatDayShort`
rather than `toLocaleDateString`. A bare locale format renders in the *device's* zone, which is the
repo's recurring date bug wearing a different hat — invisible while the phone sits where the data
came from. A release published at 15:30 UTC on 31 August is **1 Sept** in Brisbane and **31 Aug** in
London, and the test asserts both.

It also returns `null` rather than a label for a missing or unparseable timestamp — the same path
that produces "could not check" — so the card never renders `built Invalid Date`.

## Verification

9 unit tests, **seven mutations killing them**: a device-local date, an unguarded `NaN`, an
unguarded null, the header reverting to "App build", each of the three states dropping the installed
version, and the chip losing its label.

**One mutation reported `applied=yes` and changed nothing that mattered** — it replaced the first
occurrence of "Android build", which is inside a comment the test strips before matching. Re-run
against the JSX, it failed correctly. That is the "verify the mutation applied" rule needing its
sharper form: verify it changed *the thing under test*, not merely that the file differs.

Full unit suite green; `pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint
clean.

## Not exercised

**The whole card, on a device.** `UpdateCheckCard` returns early unless `Capacitor.isNativePlatform()`,
so on web and in every e2e harness it renders nothing at all — none of the three states has been on a
screen. The assertions are over source and over the pure date helper. The device check is the one in
the entry: on a phone whose APK is behind the web app, About names both numbers, says which is which,
and the tick refers unambiguously to the Android build.
