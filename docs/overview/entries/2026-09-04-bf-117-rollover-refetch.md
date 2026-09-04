# 2026-09-04 — the screens follow the day, not just the check-in (BF-117)

**Branch:** `fix/bf-117-rollover-refetch` · Lane B · no engine change, no migration, no APK.

The owner, re-reporting something he had flagged once already: *"when opening the app after a day
has been completed it doesnt reset the screens (I flagged this before) so I need to close and reopen
app to get a fresh view."*

## What was actually wrong

BF-86 fixed the morning check-in on this exact mechanism and deliberately stopped there, writing a
scope line rather than guessing: *"whether any [today-scoped read] is both persistently mounted and
never re-read is the Q-359 question… subscribing all of them blind would be a large diff justified
by a guess."* That caution was right, and the evidence has now arrived, so the guess was unnecessary.

Home reads `useLocalDay()` at two places — the mood read and the check-in prompt. **Everything else
on the screen is gated on `refreshTick`**, which is bumped by `refetchAll`, by a saved check-in, and
by the BLE-drain-settled listener. A day change bumps none of them, and the tab shell never unmounts,
so those payloads are the ones fetched at app launch and they stay until the process is killed. The
owner's screenshot splits exactly along that line: today's greeting and *"Morning check-in saved"*
above a *"Rest Day"* card and a Partial Recovery card that were yesterday's.

## Health and Nutrition had the same gap for a different reason

Both refresh on `tabEpoch`, and reading `tab-shell.tsx` settles what that signal is: the epoch is
bumped when the shell **re-shows** a tab. Navigating back to a tab bumps it; the app resuming onto a
tab the user never left does not. So a phone left open on Health across midnight keeps yesterday's
readiness, trends and training load, and BF-86's note that *"most sit behind the `tabEpoch` re-show
pass"* was true without being sufficient.

Nutrition is the interesting one: it **already knew how to follow midnight**, with a handler that
moves the selected date to today when the user was sitting on "today". It was wired to one of the two
signals. It needed the other, not new logic.

## What shipped

`useDayRolloverRefresh(fn)` in `components/shell/local-day-provider.tsx`, beside the signal it
consumes — the day-rollover counterpart to `useRefreshOnTabShow`, and named to say so.

**The trap it exists to close:** `LocalDayProvider` seeds the date synchronously, so an effect merely
keyed on `useLocalDay()` fires once at mount and refetches on every launch. That is invisible in use
— it reads as an app that is slightly slow to settle — so the guard belongs inside the hook rather
than in a flag each caller has to remember. The ref holds the day the caller last refreshed for,
seeded at mount, which makes the first run a no-op by construction.

Home passes `refetchAll`, the pass pull-to-sync already runs, so nothing new is introduced and
`sleep-sessions` — which is **not** one of the tick-gated reads, per the Q-91 note in that file — is
re-taken with the rest. Nutrition's hand-rolled `if (tabEpoch === 0) return;` guard became the
existing `useRefreshOnTabShow`, so its catch-up now runs from both signals and from one definition.

`getGreeting` moved to `app/session-select/greeting.ts` with an injectable clock. It is the other half
of the reported symptom — the *correct* "Good morning" sitting above yesterday's cards — and the
file it came from is a shrink-only hotspot, so a fix that only added lines could not land at all.

## Verification

**The e2e case is the real one**, added to `day-rollover-checkin.spec.ts` because BF-86 already built
the harness this needs: Playwright's clock is installed just before local midnight and fast-forwarded
past it, so the case fires on every run rather than once a day. It counts requests to
`/api/readiness-score` rather than reading card text — the cards' content depends on seeded data, but
*"were these reads taken again"* is precisely the defect. It asserts both directions: a **same-day**
resume must not refetch (the mount double-fetch trap), and a **cross-midnight** resume must.

Proven by mutation: with the hook call commented out the rollover assertion fails and the same-day
assertion still passes, which is the right shape — a negative case that fails when the fix is removed
would be testing the wrong thing.

`check-e2e-api-stub-sw.js` caught a real defect in the first draft: the spec counts requests with
`page.route`, and the service worker re-issues every `/api/` fetch where Playwright cannot see it, so
the stub would have applied or not depending on whether the worker had claimed the page. `test.use({
serviceWorkers: 'block' })` was the fix. That rule earned its place here.

Unit: `getGreeting` gets 10 cases pinning every period boundary and one proving it reads the user's
zone rather than the runner's. Two mutations kill them — shifting the afternoon boundary (1 failure)
and ignoring the injected clock (8).

Full suite **6,453 passed, 0 failed**; `pnpm check:rules` **Ran 68 of 68**; `tsc`,
`check-test-typecheck` (320 errors across 90 files, none above baseline), lint (0 errors) clean.

**One thing pinned rather than endorsed:** `getGreeting` treats 00:00–11:59 as "morning", so a resume
at 00:30 — the BF-117 window — reads *"Good morning"*. Pre-existing, odd, harmless, and noted in the
test rather than changed under cover of a different fix.

## Not exercised

**The device.** BF-117's own verification is an overnight one: leave the app open on the S25 and
resume after midnight — the scores, the rest-day card and the recovery card all show today, with no
reload, spinner or blank frame; resume again ten minutes later and nothing refetches; an in-progress
workout and a queued outbox both survive untouched. The e2e case drives the same sequence in a
browser, which is real evidence about the mechanism and none about the native resume path.

Also not exercised: Health's and Nutrition's rollover, in any harness. Only Home has the e2e case;
the other two take the identical hook and were read, not run.
