# 2026-09-23 — First sitting on the real S25: three shipped fixes verified, one bug reproduced, and the harness works

**Branch:** `device/first-run` · **Agent:** Device Verification (new, local) · **Docs + `scripts/device/**`.**

The owner plugged the S25 into a local Claude session and asked for an agent that tests the APK
alongside the Orchestrator. The Orchestrator had already written the harness (OR-127, PR #1411)
without ever seeing a phone, plus a prompt for the role. This session became that role, ran the
harness for the first time, and worked the `back-gesture-sitting` batch plus BF-111.

**What I was on for every result below:** Samsung SM-S938B, Android 16, WebView Chrome 152, APK
**1.460.4** (debug), web **v1.465.4** (production Railway), portrait, **three-button navigation**,
signed in as the owner. System back sent as `adb shell input keyevent 4`. Route read from
`location.pathname` in the page, never an inspector's address bar.

## Outcomes

| entry | outcome | evidence |
|---|---|---|
| **LA-109** | ✅ VERIFIED ON THE S25 | Home → More tab → *Profile details* (`/more/details`) → back → `/more`, More tab active (`text-brand`); screenshot matched |
| **LB-107** | ✅ VERIFIED ON THE S25 | back from `/health`, `/workout`, `/nutrition`, `/more` → `/` each time; back from `/` → focus on the Samsung launcher; relaunch "brought to the front", same pid 5517, same `performance.timeOrigin` — minimised, not finished |
| **BF-100** | ✅ VERIFIED ON THE S25 | `/more` scrolled, *Profile details*, back: 675→675 and 1075→1075, with the system back **and** the page's own back button; repeated after `am force-stop` (1075→1075). Details opened at the top each time |
| **BF-166** | ✅ VERIFIED, except one part | back closed the sheet and left the route alone on `/nutrition` (*My Foods*, *Add food*), `/` (mood check-in — app **not** minimised) and `/program` (*New Program*, where the first back closes the keyboard the autofocused field raised). **COULD NOT CHECK** the mid-workout leave prompt: it needs a workout started on the production account |
| **BF-165** | ❌ REPRODUCED ON THE S25 | Cardio → *Other activity* → *Treadmill*: `pushState(/activity)` at 1754 ms, the sheet's `back()` at **1761 ms**, `popstate` → `/cardio`. The harness saw a 415–428 ms gap; the device gives 7 ms |
| **BF-111** | ❌ the screenshot it waited on | About: `App v1.465.4` ✓, "Up to date — v1.460.4" ✓, **"built 23 Aug" ✗** — the rolling `apk-latest` release's `published_at`; the APK asset was uploaded 2026-09-20 |

LA-109, LB-107 and BF-100 left the queue. BF-165 stays READY for Lane B with the device trace and a
sibling close-then-push site (`components/cardio/time-picker-sheet.tsx`, unreachable on the owner's
account because it only renders without a running plan). BF-111 lost its owner gate and is Lane A
work now (`lib/github-release.ts:86`). Device checks owed: 104 → 100.

## What the protocol-only harness got wrong

It connected first time; the rest is recorded in `scripts/device/README.md` → *What the first run
corrected*. The ones that change what anyone does next:

- **Playwright's `connectOverCDP` attaches** to the WebView (98 ms, `/json/version` exposes a browser
  websocket). So `e2e/**` could run on the real APK — **but the phone is on the owner's production
  account and those specs write**. That is an owner decision, filed in the baton as blocked.
- **Three-button navigation reads a 48 px inset, not 0**, so "non-zero inset" had been taken as
  proof of gesture nav. `probe.js` now reads `navigation_mode` from Android. The phone is on
  three-button, so **no safe-area check is valid yet**.
- **The capture workflow would have published the owner's data.** The runbook said to push
  screenshots to a `device-captures/*` branch; the repo is public and every capture shows the
  owner's account (the first one showed his email). Changed to text-only; `device-probe/` is
  gitignored; `tour.js` says so when it finishes.

## Two traps I walked into, both caught before they became findings

- **`tap()` centres its target, which pins the scroll offset** — my first BF-100 run measured 825→825
  three times because 825 is where centring put the row. It proved nothing. Shift the scroller after
  centring, then tap without re-scrolling.
- **A focus check read `.stdout` off a helper that returns a string** and reported the app as
  backgrounded while it was on screen — which briefly looked like "back from `/health/readiness`
  both navigates and minimises". It does neither wrongly; the check was broken.

## Also

- Windows could not check out `main` at all: a stray file named `ord.endsWith('ss')||` (added by
  accident in #672) has a `|` in it. PR #1414 deletes it; until then the workaround is in the
  role's prompt.
- New role written into `docs/agents/README.md`, `prompts/device-verification.md` and a baton at
  `state/device-verification.md`, with the `DV-` prefix. It runs locally, so its successor is opened
  by the owner, not by `create_session`.

## The local gate, stated exactly

`pnpm ci:local` on this Windows machine: **lint** 0 errors; **`check:rules` — `Ran 75 of 75`, 4 FAIL**
(steps 27, 30, 50, 68), every one a Windows path or shell problem in files this diff does not touch;
**typecheck** clean; **typecheck:tests** `spawnSync npx ENOENT`; **test** could not start
(`rolldown` needs Node ≥ 22.12, this machine has 22.9). Filed as **DV-1** (Lane O). So the test
gate for this PR is CI, and the doc checks were run individually: `check-backlog-pointers` OK
(416 entries), `check-doc-index-size` OK.

## Not exercised

Gesture navigation (the phone is on three-button), safe-area clearance anywhere, offline/airplane
mode, the local SQLite reads, any write path, the mid-workout back, landscape, `record.js` and
`tour.js` (not run yet), and light theme (everything above is dark).
