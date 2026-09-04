# 2026-09-04 — the emulator job's two candidates, settled in five runs (Q-250)

**Branch:** `ci/emulator-reachability-assert` · **Lane:** A · **Domain:** platform / devices

## What was open

Q-250's emulator job passed steps 1–14 and failed at its assertion with *"Sign in with email" is not
visible*. Two candidates survived four runs and were indistinguishable from a timed-out UI wait:
Maestro cannot read inside the WebView, or the emulator cannot reach the host at all.

The check meant to separate them was advisory — `WARN: could not confirm host reachability …
continuing` — and had never once confirmed the hop. Its silence read as success, so every failure
kept presenting as a UI-automation problem.

## The answer

Three axes now agree, and (b) is eliminated:

| axis | answer |
|---|---|
| reachability | **OK** — no `net::` error after launch; the WebView loaded from the host |
| view hierarchy | **present, carrying no sign-in text** — not empty, so the driver sees the app |
| server access log | **it served `/sign-in`** — the page was requested and delivered |

The page rendered and the driver cannot read inside the WebView. The fix Q-250 proposed for that
case, `setWebContentsDebuggingEnabled(true)` in the debug build, shipped here and **did not change
the result**. It stays — it costs nothing, is gated on the manifest's own `FLAG_DEBUGGABLE` so no
release build can take the branch, and web-view tooling wants it anyway — but it is not the answer.

## The mistake I made and caught one run later

The reachability assertion greps logcat for `net::ERR_`. A 500, a redirect, or an app-level error
page produces none, so "reachability OK" was carrying more weight than it earned, and a textless
hierarchy is equally consistent with an opaque WebView and with a page that never drew the form. The
server-log axis exists because of that, and it is what makes the conclusion above safe to state.

## Reading a verdict out of this job

Four log pulls of 100+ lines each failed to reach a verdict that was being printed correctly. The
runner appends its own blocks after every step — artifact upload, git cleanup, the Postgres container
dump — so **nothing a job prints is ever last**. "Put it at the end of the log" is not a place a job
can reach.

The verdict is now carried by mutually exclusive step **names** (`VERDICT …`, `TREE …`, `PAGE …`).
`list_workflow_jobs` returns them with no log fetch, so the diagnosis costs one call. It answered on
its first run.

Fixed on the way, because it was half the noise: the Postgres service healthcheck ran `pg_isready`
as root, which has no role, and logged `FATAL: role "root" does not exist` every ten seconds — about
190 lines per run, now roughly 65 with `-U postgres`.

## What to do next, and what not to

**Not more Maestro tuning.** The UI flow was only ever a means to get a signed-in user, because
`getLocalStore(userId)` requires one before any local SQLite database exists. The job already owns
`AUTH_SECRET` and seeds the user, so it can mint the session cookie directly and hand it to the
WebView, skipping the form. That asserts exactly what this job exists to assert — that the local
migrations apply on real Android SQLite — without depending on whether a WebView's DOM is legible to
a UI driver, which is a question this repo has no other reason to care about.

## Deliberately not done

The `pull_request` trigger stays commented out; the assertion still has not passed. Five emulator
runs is where this session stopped, not where the problem ends.

## Not exercised

Nothing about the shipped app changes — the Java edit is debug-gated and this job builds its own APK.
No device, no production data, no Samsung WebView (the emulator is stock Chromium, which this job's
own header already says it cannot speak for).

## Gates

`bash -n` clean, workflow YAML parses, `pnpm check:rules` 67 of 67, five real emulator runs.
