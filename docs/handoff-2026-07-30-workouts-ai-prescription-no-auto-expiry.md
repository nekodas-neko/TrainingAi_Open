# Handoff — 2026-07-30 · AI prescription: no auto-expiry, generate before the workout

_Domain: `workouts` · Branch: `claude/workout-dismissal-vfrq3b` · PR: [#955](https://github.com/nekodas-neko/TrainingAI/pull/955) (open, CI pending at time of writing)_

> **Read first:** `projectOverview.md` (Known Issues → `[workouts] AI prescription silent
> auto-dismiss + generation moved to pre-workout`), then `docs/domains/workouts/README.md`, then
> this file. The session journal entry
> ([`docs/overview/overview/history-2026-07-30.md`](overview/history-2026-07-30.md))
> has the full investigation narrative if you need it; this file covers only what to do next.

## Goal

Owner sent a screenshot of the "Upper" pre-workout screen showing
`AI Prescription · Accumulation · Dismissed` and didn't remember dismissing it. Investigate why,
then fix the underlying mechanism per the owner's explicit follow-up asks: no silent auto-expiry
ever, and generate the next prescription right before the workout instead of right after the
previous one.

## Current status

- Build/test: full suite green (2575 passed, 240 skipped) with `DATABASE_URL` unset (the clean
  default state). `tsc --noEmit` clean. `pnpm lint` 0 errors, pre-existing warnings only. Both
  custom-rule scripts pass.
- Device-verified: **no.** This PR only touches server routes + one React card (no
  Capacitor/native/safe-area/gesture surface), so nothing native-specific is at risk, but the real
  on-device render of the updated `AiPeriodizationStatusCard` has not been looked at on the S25.
- PR #955 is open against `main`, branch `claude/workout-dismissal-vfrq3b`. A 3-minute self
  check-in is scheduled (`send_later`) to merge once CI is green — if you're reading this because
  that didn't happen (session ended, check-in never fired, etc.), check PR #955's state first
  before doing anything else. If it's already merged, this handoff is historical — skip to
  "Deliberately NOT done" for anything still open.

## What shipped

- **Root cause, found via real production data** (`POST /api/admin/db-query` against the
  `session_periodization` row for the "Upper" session — see the journal entry for the full query
  trail): a `pending` + `transition_recommended` prescription generated 2026-07-22 had its 7-day
  `prescription_expires_at` lapse 2026-07-29, and the next app open silently flipped it to
  `dismissed` with no prompt. Two identical auto-dismiss-on-expiry blocks did this: `GET
  /api/ai-periodization/session/[sessionId]` (`app/api/ai-periodization/session/[sessionId]/route.ts`)
  and `app/api/workout-data/route.ts` (two branches inside that one file).
- **Fix part 1 — no auto-expiry.** Removed both auto-dismiss blocks, plus the mirroring `expired`
  gates in `app/api/next-session/route.ts` and `app/api/next-session/prescription/route.ts` that
  existed only to agree with `workout-data`'s (now-removed) behavior. `prescriptionExpiresAt` is
  still stored (harmless) — nothing reads it for any gating decision anymore. A `pending`
  prescription now only changes status on an explicit accept/dismiss/transition, full stop.
- **Fix part 2 — generation moved from session-end to session-open.** Deleted
  `regenerateNextPrescription` (`packages/shared/src/ai-periodization/generate-prescription.ts`)
  and its two callers: `app/api/complete-workout/route.ts` and the offline-outbox
  `complete_workout` branch in `lib/data/postgres/adapter.ts` (~line 3866).
  `completeWorkoutFromPayload` (`packages/shared/src/workout/complete-workout.ts`) no longer
  returns a `regeneratePrescription` flag — it just marks the slot `consumed`. The pre-existing
  on-open trigger (`isAiPrescriptionPending`, `prescriptionStatus === 'consumed'` →
  fire-and-forget `POST /prescribe`) is now the sole generation path. **This reverses the
  2026-07-20 decision** ("generate at session end, not session start" — see
  `docs/overview/history-2026-07-20.md` if you need that history) — that decision existed only to
  keep a per-session "Auto" chip from going blank right after finishing; fix part 3 makes that chip
  moot, so the constraint that motivated 2026-07-20 no longer applies.
- **Fix part 3 — `AiPeriodizationStatusCard`.** Owner: "that chip doesn't need to be shown, it's
  either all AI prescription or none... show a more useful stat." Replaced the per-session
  Auto/Ready/New status dot with days-since-last-trained. `GET
  /api/ai-periodization/program-overview` now returns `lastTrainedDaysAgo` per session (computed
  via the existing `repo.getRecentSessionsOfType`, no new repo method).
- Version bumped to **1.247.0**, changelog entry added, `projectOverview.md` Known-Issues row and
  Current-Status version updated, `docs/module-map.md`'s AI-periodization row corrected (it still
  described the old generate-at-completion behavior), `docs/domains/workouts/README.md` Open
  Issues bullet added — all in the same commit as the code.

## Deliberately NOT done

- **No schema change.** `session_periodization.prescription_expires_at` still exists and is still
  written (7 days out) by `storePrescription` — it's just no longer read by anything. Left in place
  rather than migrating it out, since it's harmless and a future feature might still want "how old
  is this plan" as *display* info (distinct from using it to auto-act).
- **No change to the emergency-deload / reevaluation logic** in `workout-data`'s single-session
  branch (soreness/injury re-derivation against today's signals) — that logic is unrelated to the
  expiry mechanism and was left exactly as-is (only the surrounding `if/else-if` got collapsed to a
  plain `if` since the `else` branch it was paired with was deleted).
- **No re-litigation of the 2026-07-28 P1 fix** (no-op-transition downgrade, pending
  `transition_recommended` driving load) — that fix is untouched and still correct; this PR builds
  on top of it.

## Key decisions (with rationale)

- **Removed the expiry gates rather than just widening the window** (e.g. 30 days instead of 7).
  The owner's ask was explicit: "there should be no auto expiry... should always require a dismiss
  from the user." Any timer-based auto-action reintroduces the same failure mode at a different
  threshold.
- **Deleted `regenerateNextPrescription` entirely rather than leaving it unused.** No remaining
  callers after removing both call sites (`grep`-confirmed before deletion); CLAUDE.md says delete
  confidently-unused code rather than leave it as a landmine.
- **Card replacement chosen via `AskUserQuestion`** rather than assumed — offered "days since last
  trained" / "estimated duration" / "confidence" / "remove entirely"; owner picked days-since-last-
  trained (the recommended option), which is also the stat that would have made this whole bug
  visible sooner (a 9-day-stale "Push" session would have read oddly next to a 2-day-stale "Legs").

## Gotchas / what did NOT work

- **`npx vitest` / a fresh `pnpm vitest` both failed to resolve `@trainingai/shared/*` subpaths**
  ("Cannot find package") — turned out to be a missing `node_modules/@trainingai/shared` workspace
  symlink in this sandbox, unrelated to any code change. Fixed by `pnpm install` (relinks
  workspace packages, doesn't touch the lockfile since nothing changed). If a fresh session hits
  the same "Cannot find package '@trainingai/shared/...'" error, this is the fix — don't chase it
  as a real bug.
- **`lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts` throws "Invalid URL" instead of
  skipping** if you manually `export DATABASE_URL=...` from `.env.local` in your shell before
  running `pnpm test` — that file's `canRun` guard only checks "is DATABASE_URL set and not
  Railway", and the local dev URL's `?host=/tmp&port=5433` unix-socket format isn't parseable by
  `new URL()`, so the guard passes but the URL construction inside the tests throws. With
  `DATABASE_URL` unset (the actual default state after the session-start hook's `unset`), this
  test file correctly skips. **Only export `DATABASE_URL` in-shell for the one test file that
  needs it** (`app/api/oura-ble/live-steps/__tests__/implausible-cadence.test.ts`), not globally
  before a full `pnpm test` run.
- **Playwright isn't a project dependency**, only the browser binaries are pre-installed
  (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). The `playwright` npm package is
  installed **globally** (`npm root -g`) — `require()` it from there by absolute path for one-off
  screenshot scripts, don't try to add it to the project.
- **Curl-exported NextAuth cookies didn't transfer cleanly into a Playwright browser context** (the
  card showed the login screen). Simpler to just drive the actual login form in the browser
  (`test@local.dev` / `testpass123`) than to transplant a Netscape-format cookie jar.
- **The Health page's scroll container isn't `<body>`** — `page.screenshot({ fullPage: true })`
  only captured the viewport. Had to `page.mouse.wheel(0, N)` repeatedly and
  `locator(...).scrollIntoViewIfNeeded()` to reach the AI Periodization card for a screenshot.

## Files to look at

- `app/api/ai-periodization/session/[sessionId]/route.ts` — GET route, the auto-dismiss block that
  used to live at the top (now gone).
- `app/api/workout-data/route.ts` — two `aiDrivesLoad`/`aiPrescription` blocks (one per branch:
  all-sessions tab loop, single-session), both previously had an expiry check.
- `packages/shared/src/workout/complete-workout.ts` — `completeWorkoutFromPayload`, now just marks
  `consumed`, no regen flag.
- `app/api/ai-periodization/program-overview/route.ts` — new `lastTrainedDaysAgo` computation.
- `components/health/ai-periodization-status-card.tsx` — the card itself; `lastTrainedLabel()` is
  the new formatter.
- `docs/overview/entries/2026-07-30-workout-dismissal-vfrq3b.md` — full investigation + fix
  narrative, including the exact production SQL trail that found the bug.

## Open questions / blockers

- None waiting on the owner — this was a fully in-session request/fix/merge cycle. The only open
  item is the on-device APK check noted above (low priority given no native surface changed).
- If a future session wants to also surface "prescription is N days old" as an actual UI badge
  (distinct from the phase-driven `lastTrainedDaysAgo` this PR added), `prescriptionGeneratedAt` is
  already on `SessionPeriodization` and unused for display anywhere — that'd be a small addition,
  not a backlog item, since it's purely informational (no auto-action).

## Pickup prompt

```
Check the state of PR #955 on nekodas-neko/TrainingAI (branch claude/workout-dismissal-vfrq3b) —
it may already be merged. If merged, no further action needed on this line of work; read
docs/handoff-2026-07-30-workouts-ai-prescription-no-auto-expiry.md for context only if something
related comes up. If still open, check CI status and merge it once green (squash merge), following
the CI/CD PR Workflow in CLAUDE.md — this is a standard, tested, non-destructive change and does
not need confirmation to merge.

Read projectOverview.md first (Known Issues → the [workouts] entry dated 2026-07-30 about AI
prescription auto-dismiss), then docs/domains/workouts/README.md, then this handoff if you need
the full investigation trail (docs/overview/entries/2026-07-30-workout-dismissal-vfrq3b.md has the
most detail, including the exact production SQL queries that found the bug).

No code work is expected to be needed on this — it shipped complete. Only pick this back up if:
(a) the PR didn't merge and needs attention, (b) the owner reports the AI Periodization card or a
phase-transition prescription behaving unexpectedly, or (c) you're doing the on-device APK smoke
check and want to eyeball the new "Nd ago" stat on the Health → Training card.
```
