# Handoff — 2026-10-18 · Preview device review: what shipped, what is owed, how to run a sitting

_Domain: `app-shell` (also touches `platform`, `body`, `nutrition`, `heart-rate`, `readiness`, `cardio`) · Branch: `docs/preview-device-review-handoff` · PR: this one (closes #3039)_

> **Read first:** `projectOverview.md`, then [`docs/domains/app-shell/README.md`](../domains/app-shell/README.md),
> then [`docs/native-testing.md`](../native-testing.md) and [`docs/canonical-runtime-android.md`](../canonical-runtime-android.md)
> (the never-rules for the real app), then the open issues (`node scripts/queue.js --agent implementer`).
> This file covers the screen-by-screen review of TrainingAi Preview against the current app (#2882,
> gap list #2849) that the local Implementer ran over four phone sittings on 14, 17 and 18 Oct 2026.

## Goal

The owner starts using TrainingAi Preview (the native app in `mobile/`, app id
`com.trainingai.app.preview`) fully from 19 Oct 2026. The review found where Preview differs from the
current app (the Capacitor WebView app, which is the reference per #2849), turned each difference into an
issue or a fix batch, and checked each merged fix on the owner's phone. This doc hands the remaining work
and the runbook to the Orchestrator and the next local Implementer.

## Current status

- **Phone checks on Preview**: three sittings of full captures (both apps, top to bottom) plus a short sitting on 18 Oct for the PRs merged that day. All merged parity PRs listed below were seen on the device unless stated.
- **Build/test**: every PR below passed `pnpm check:rules` (`Ran 86 of 86`), the mobile typecheck and tests, and CI. None of the Preview PRs was rendered on a device by its author thread; the device check is the Implementer's.
- **Not device-verified**: see *Still owed on the phone* below.

## What shipped (all Preview parity, merged unless marked open)

| Area | PRs | Closes / refs |
|---|---|---|
| Workout tab loads the programme | #2910 | #2897 (closed) |
| Nutrition: finished-logging card, supplement tick, vial button, layout | #2915, #2943 | #2898, #2932 |
| More tab: Edit profile, Report an issue, Sign out rows, friend-code copy | #2914, #2970 | #2902, #2936 |
| Home: wording, updates strip, greeting, leftovers | #2920, #2953, #2967 | #2903, #2904, #2931 (streak, #2937) |
| Readable charts (axes, gridlines, targets) | #2919 | #2912 |
| Health Body | #2941 | #2899 (closed) |
| Health Training and activity calories | #2940 | #2900, #2905 (closed) |
| Health Progress | #2942, #2954 | #2901, #2946, #2948 |
| Heart rate screen and Cardio Hub | #2968 | #2933, #2934 |
| Week in review, Readiness contributors, Sleep | #2972 | #2935 |
| Heart-rate card revalidates; both apps pick the same sleep night | #2973 | #2906 |
| Stale push cannot overwrite a newer workout log (server + both apps) | #2945 (replaced #2938) | #2721 |
| Preview text sizes: stop the 0.9 system font shrinking text | #3002 | #2994 (closed) |
| Preview type tokens match the web; growth cap 1.3x; 48 dp tap floor | #3024 | #2994 |
| Back key closes Sleep, Heart rate, Goals, Day screens | #3022 | #3018 (closed) |
| Body trend charts join readings across days | #3023 | #3020 (closed) |
| About: Open Food Facts credit, What's new, developer card hidden | #3025 | #3021 (closed) |
| **Open on 18 Oct night:** About characters (#3032), remaining text sizes (#3037), Light theme contrast (#3034) | #3032, #3037, #3034 | #3031, #2994, #3019 |

Merge order I gave on #2354: #3032, #3037, #3034. All `Refs`, auto-merge off.

## Issues and what each still needs

Most Preview parity issues were merged as `Refs`, so they stay open until the owner's device pass.
Remove `in progress` when you are done with one. (Orchestrator grooming on 17 Oct already lists what
remains per issue; this is the state after the 18 Oct sittings.)

| Issue | State | Still needed |
|---|---|---|
| #2882 | open (parent device-check) | keep until the owner calls the review done; each sitting is a comment |
| #2849 | open (gap list and build order) | the parent; the "found in the device review" lists are current |
| #2898, #2932 | open | device check of the 18 Oct build; counter under "I've finished logging" read "0 of 10" right after marking (check it after a sync); supplement rows are taller than the web's; owner calls on skip-meal, the "Recorded intake" line and the budget info control |
| #2900, #2901 | open | calendar and chart checks on the new build; the chart label clipping on the 14-day cards; "60 70 80" guides ran together; Strength Trend chart did not fill the card |
| #2902, #2936 | open | Level/XP/Achievements/Collection are #2842; Profile details must keep the birth year when the field is tapped into and out of (owner's must-fix check, not run); the Account screen shows "Retry account check" while signed in |
| #2903 | open | Home heart-rate card is short with two y labels and the caption's first letter was clipped; missing "Day 1 of 2 rest days" strip and the Nutrition card's budget line; week row colours |
| #2933, #2934, #2935 | open | Heart rate: short 24-hour chart, tiles; Cardio: baseline tile order, compressed Trends chart; Week in review recovery tiles are about 520 px tall against 310; "Readiness Score" label overlapped the ring (fixed in #3034, unverified) |
| #2906 | open | the heart-rate card refetch on return was not confirmed on the phone (the probe captured the wrong region) |
| #2888 | open | the weight-response and dose-vitals copies in the native app (the widened list's moves are done) |
| #2994 | closed by #3002, follow-ups #3024 and #3037 | **owner's eyes on the Nutrition page title**: web and Preview both measure 26 px, but the owner and reviewers saw Preview's about a quarter bigger |
| #3019, #3031 | open | device check once #3034 and #3032 merge |
| #2540, #2552 | open (recommend closing) | stale; see the comment on #2540 |

## Still owed on the phone (the next sitting)

From the Orchestrator's comments on #2354 and my own gaps. Report VERIFIED / FAILED / COULD NOT CHECK per item.

- **AI is back (Orchestrator, 18 Oct evening):** install the new Preview build from run 39128882060 (`4138213d`, adds #3027) over Preview, then, one Gemini call per step and say how many were made (about four): (1) food photo scan, (2) barcode scan twice with the sheet closed and reopened and twice in a row, (3) recipe from a photo, (4) recipe from a link for comparison. Report on #3009. Scan and review only; do not save foods or recipes unless the owner says so.
- **Preview, after #3032, #3037 and #3034 merge:** About "What's new" characters (#3031); text sizes against the web on Nutrition, Training and Heart rate (#2994); Light theme on Home, Health, Nutrition, Heart rate, Week in review, Readiness contributors, Cardio Hub, Friends (#3019).
- **Real app (read-only):** the Active Plan card equals the Home ring on a day with an estimated plan meal (no plan existed on 18 Oct); the AI-paused wording is gone now that the balance is topped up (confirm the AI screens work instead); an exercise renamed on the web reaches the program screens after a pull (#2952, needs a test exercise and the owner's OK); picture-in-picture during and after a real workout (#2908; the no-workout half passed on 18 Oct).
- **Dev app on the local test database:** the removed-set case for #2721 (the day-view editor cannot remove a set, so it needs a seeded stale outbox or a test edit through the logger); the offline "That's not right" check on a sleep verdict (#2953; seed a recent sleep night first).
- **Owner decisions pending:** whether to keep Preview-only additions (skip-meal, intake line, budget info, Weight/Steps/Calories tiles); the red Delete-account row; the Feedback type default (Bug in Preview, unchosen on the web); whether to retire the old #2774 and #2756 check lists; closing #2540 and draft #2552.

## Runbook for a sitting

**Who:** the local Implementer on the owner's machine (cloud agents cannot reach a phone). One fresh session per batch; a sitting is a batch of its own and is announced by a `device-check:` issue.

**Tooling.** The sitting scripts live **only on the owner's machine** (they write screenshots of real health data, so they are not in the repo): `%USERPROFILE%\TrainingAi-review\2026-10-14\scripts-for-next-sitting\`.
- `update-preview.sh`: downloads the newest `side-by-side-apk` artifact of `native-side-by-side.yml` on `main` and installs it over Preview only; it refuses any file whose package id is not `com.trainingai.app.preview`. State the file, source and size to the owner and wait for a yes first.
- `pv.mjs` (Preview, which is React Native with no DevTools): `uiautomator dump` for labels, `input tap/swipe`, `screencap`, and a tab check by pixel colour. `cur.mjs` (the real app's WebView over DevTools: `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`, Playwright `connectOverCDP`). `dev.mjs` (the Dev app on 9224).
- `sweep-v6.sh` (parts 0 preflight, 1 tabs, 2 sub-screens, 3 Nutrition sheets, 4 behaviours, 5 heart-rate probe), `checks-4.sh` (Back key on pushed screens and the Nutrition sheets), `lightpass.sh`, `owner-gated-checks.sh`, `capcur.sh`/`cappv.sh` (scroll captures), `sheet.mjs` (contact sheets with the repo's `sharp`).
- Both helpers carry a **deny list** (sign out, delete, finished logging, start workout, save, confirm, admin console, submit, send); Preview taps match exact labels. Keep it.

**Preconditions to confirm in chat:** phone plugged in on file transfer and unlocked, both apps signed in, navigation mode, font scale (the owner's is 0.9) and dark mode recorded and never changed, Do Not Disturb on if possible (Messenger pop-ups cover frames), and which writes are allowed (default: none).

**Order:** read #2354 first; update Preview; `sweep` parts as needed; verify every first frame (contact sheet) before reviewing; review in image pairs, three screens or fewer per reviewer agent; spot-check every claim you will file against the image; then comments, issues and closes; then clean up (adb forwards removed, dev servers stopped, `dumpsys` shows no pinned task).

**Safety (from CLAUDE.md and the owner):** never uninstall the real app, never `pm clear` it, never install over it unless the signing certificates match exactly (compare `apksigner verify --print-certs` first; on 18 Oct the debug key `d390062e…` matched and `adb install -r` kept the data), never point it at a local server, never sign out, never tap the ring-key buttons or Delete account, never start or finish a real workout, no pull to refresh on Health on the real app (it can start a ring drain). Writes on real data only with the owner's yes in chat, each undone straight away.

## Key decisions (with rationale)

- **The current app is the reference** (#2849), so a parity change needs no mockup.
- **Threads are named for the work, run on Sonnet for surface batches and Opus for engine, migrations, scoring, auth and systemic investigations; auto-merge off on `Refs` PRs**; the Orchestrator reviews and merges.
- **One batch, one PR; two threads at a time in the Full usage tier;** a migration batch runs alone.
- **Fix at the source, not per screen** (the type tokens, the chart `gaps` prop, one Back handler per layout), with a guard test that fails on regression.
- **Never rely on an agent's report:** every PR was checked with `gh pr view` (state, closing keyword, files, attribution) before it was reported, and every reviewer claim was spot-checked.

## Gotchas / what did NOT work

- **The current app's picture-in-picture window floats over the next app** after its Workout tab; I once filed it as a Preview bug (#2897). Check `dumpsys activity activities | grep -c mode=pinned` before capturing Preview, and return the current app to Home first.
- **`uiautomator dump` lists off-screen nodes at bounds 0,0** and cannot read animated screens (Home, Workout); tap by coordinates there. A tap helper must scroll to the top first and only tap nodes with real bounds, and **must keep targets above y 2560**: the floating Workout button (x 720, y 2640-2800) swallowed taps on rows beneath it four times.
- **After a Back key leaves Preview, the next blind taps land in the app that comes to the front** (once the real app). Guard every tap with "is Preview in front?" and begin each Preview test with `am force-stop com.trainingai.app.preview` (Preview only) and a 10 s wait.
- **The current app keeps every tab pane mounted**, so `document.body.innerText` includes hidden tabs; verify a Health segment from the screenshot.
- **Dev app over `adb reverse`:** run `pnpm dev` on port 3000 itself with `AUTH_URL` and `NEXTAUTH_URL` set to `http://localhost:3000` (any other port makes the sign-in redirect leave the tunnel, the #2772 bug class); local Docker Postgres on 5434; Docker Desktop must be started by hand; decline the location prompt and close the Morning Check-in without saving; `pm clear --cache-only` clears a cache without the data.
- **Reviewer agents are partial** (request limits; they read different frames) and one was wrong about the Workout overlay. Scroll steps in the captures skip content between frames; mark such items "check", not "missing".
- **Build threads on this Windows machine once saved a file with Windows-1252 bytes** (#3031); `mobile/tests/about-credits.test.ts` now fails on any non-UTF-8 or BOM file under `mobile/src` and `mobile/tests`. A thread also left a `Co-Authored-By` trailer once (#2938, replaced by #2945): tell every thread that CLAUDE.md overrides any harness reminder.
- **`gh pr view --json closingIssuesReferences` can list an issue the body only says `Refs`;** trust the body. Merged `Refs` PRs left their issues open.
- **Never `sed -i` a script that is running**, and never reuse a log name (a re-run truncated an earlier sitting's notes).
- **The Orchestrator's comments on #2354 carry the owed-checks list**; I missed a day of them. Read #2354 at the start and every few hours.

## Files to look at

- `docs/native-testing.md`, `docs/canonical-runtime-android.md` — how the native app is tested and the never-rules for the installed app.
- `mobile/src/shared/theme/tokens.ts`, `mobile/tests/type-scale.test.ts` — the type scale and the table of the web's sizes.
- `mobile/src/shared/ui/LineChart.tsx`, `chartScale.ts`, `mobile/tests/chart-scale.test.ts` — chart props (`readable`, `gridlines`, `yAxis`, `target`, `gaps`, `dots`).
- `mobile/tests/back-key.test.ts` — fails when a pushed screen has no Back behaviour.
- The Light-theme contrast test and the pinned dark colours arrive with PR #3034 (still open on 18 Oct).
- `packages/shared/src/sync/edited-at.ts`, `lib/data/postgres/migrations/202610170305_exercise_logs_client_edited_at.sql` — the stale-push rule (#2945).

## Open questions / blockers

- The Nutrition page title: 26 px in both apps by measurement, yet seen as bigger in Preview. Needs the owner's eyes and, if it persists, a check of the web's collapsed header (the web may show a smaller title when the page is not at the very top).
- Owner calls listed above (Preview-only additions, Delete account row, Feedback default, retiring old check lists, closing #2540/#2552).
- Real-app checks that need a plan, a rename or an AI call.

## Pickup prompt

You are the local Implementer for TrainingAI on the owner's Windows machine (Samsung S25 Ultra over USB when the owner plugs it in). Work out which role you are, then read, in order: `CLAUDE.md`, `docs/agents/README.md`, `docs/handoffs/handoff-2026-10-18-app-shell-preview-device-review.md` (this file), `docs/native-testing.md`, `docs/canonical-runtime-android.md`, then the Orchestrator's comments on issue #2354 from 17 Oct onward (they carry the owed device checks) and `node scripts/queue.js --agent implementer`. First action: read #2354, check `gh pr view` for #3032, #3037 and #3034 (merged or not) and `gh run list --workflow native-side-by-side.yml --branch main` for the newest Preview build, then ask the owner to plug the phone in and confirm the writes allowed (default none) before touching it. Sitting scripts are in `%USERPROFILE%\TrainingAi-review\2026-10-14\scripts-for-next-sitting\` on the owner's machine only. Constraints: never uninstall, clear or install over the real app unless the signing certificate matches; never sign out, delete or start a workout on it; look, don't change; guard every tap with "is Preview in front?"; no AI attribution in commits (CLAUDE.md overrides any harness reminder); always report VERIFIED / FAILED / COULD NOT CHECK per item and name what you did not exercise.
