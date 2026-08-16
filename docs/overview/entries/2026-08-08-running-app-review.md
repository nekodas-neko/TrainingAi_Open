# 2026-08-08 — The first review that ran the app, and what that immediately found

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domains:** `app-shell`, `platform`

## What this was

The owner asked for a prompt for the deepest review yet, then asked for it to be run in the same
session. This is **Step 0 (production reads) and part of Step 1 (running the app)** of
[`2026-08-09-deep-review-prompt.md`](../../reviews/2026-08-09-deep-review-prompt.md) — **not** the
full twelve lenses. Lenses 2–12 are untouched and the prompt still stands for a session with the
budget for them.

The distinguishing method: **`pnpm dev` plus a headless browser at 390×844.** Every prior review of
this app was read-only; the 2026-08-07 sweep says so in its own §8. Two of the findings below had
survived 25 read-only reviews.

Playwright was used from the **global** install (`/opt/node22/lib/node_modules`) with the
pre-installed Chromium — **no project dependency was added**, which matters for a docs-only PR. ESM
`import` ignores `NODE_PATH`, so the script imports by absolute path; that is the whole trick.

## Findings

**Q-150 — the signed-out sign-in page fires 12 authenticated API calls, all 401, one of them a
POST.** `components/sync-provider.tsx` guards its sync operations on `userId` correctly
(`:123`, `:128`, `:174-175`) but **not** its cache-warm phases (`:115`, `:159`) and **not**
`maybeSyncOura` (`:194`, called `:225` and on every app `resume` `:232`), which issues
`POST /api/oura/sync` — an expensive external sync — before anyone has logged in. `SyncProvider` is
in the root layout, so this happens on every signed-out route. On the APK that is latency and battery
on the cold-start path.

**Q-151 — a second React #418 hydration mismatch, on `/sign-in`, still live.** #418 is the
highest-count production error (153 in 30 days). Q-73 fixed the **home** screen instance and its
Known-Issues row reads as though the class is closed. It is not — this is a different route that was
never touched. Not root-caused; the reproduction is written down, which is the hard part.

**Q-152 — `ensureSchema` prints a real migration failure in the same format as benign noise.**
`foreign key constraint "cardio_sessions_user_id_fkey" cannot be implemented`, sitting among four
`already exists` idempotency notices, then `0 migration(s) applied`. Low severity, but the SQLite
side of this exact class broke the app on Android twice.

## Two results that are deliberately negative

**Production has 98 `Failed query` rows and *zero* carrying a Postgres code.** The prompt's
highest-value question was whether the new cause-capture had produced anything yet. The last fault
was 03:26Z; #1150 deployed 04:44Z. **No fault since.** So **Q-107's batching decision still cannot be
made** — and the next session should re-run that query first rather than assume the codes are there.

**The DB fault has hit write paths — and did not lose data.** Two failed writes exist
(`log-exercise` INSERT 2026-07-27, `complete-workout` UPDATE 2026-07-20). Both workouts are intact,
and the timing says why: each session completed **27 and 82 seconds before** its failing statement,
so both were trailing retries after the data was already durable. Recorded in both directions — it
stops the next reader escalating this to "the DB fault can drop a workout", and stops anyone assuming
writes are immune.

## A method warning worth more than any single finding

`/activity` returns **11 characters of body text**, which reads exactly like a blank screen. It is
not — it is a legitimately sparse "start an activity" form, which the screenshot settles in one look.
I nearly filed it. **Text length is not a render check.** The equivalent trap in the other direction
is a page that renders plenty of text while showing the wrong thing entirely.

## Also clean

All 14 real pages return HTTP 200 with **zero** `pageerror` and zero non-401 console errors,
including the four redirects (`/stats` → `/health?tab=training`, `/session-select` → `/workout`,
`/config` → `/more?tab=config`, `/profile` → `/more`). Login with the seeded credentials works and
the home screen paints real content.

## Not done, and it is a lot

No device, no APK, no native SQLite — `getLocalStore` returns null in the web sandbox, so the entire
offline-first *device* path is untested and every finding here is web-surface only. Step 1's
adversarial-value, boundary-date, empty-state, offline and rapid-tap items were **not** run. No
second user was driven. Lenses 2–12 — CLAUDE.md accuracy, mobile standards, test-suite mutation
checks, multi-user scale — were not started. Production reads covered `error_events` and
`workout_sessions` only.

The `/activity` screenshot also shows a large unlabelled circular control and a very sparse layout.
Those look like real UI findings, but the mobile-standards lens was not run, so they are recorded as
unreviewed observations rather than filed as findings.
