# 2026-09-01 — the app notices the day changed, without restarting

**Branch:** `fix/bf-86-local-day-rollover` · **Entry:** BF-86 · **Lane:** B

## The report

Owner: *"when the app is opened first thing in the morning or after 12 at night, I'd like it to
close/do a full reset so I open the fresh app… when I open the app in the morning and it just
resumes, it doesn't give me the morning check-in."*

**The cause is structural, not specific to the check-in.** The tab shell is persistent — it does not
unmount — so an effect keyed on `[userId, tz]`, neither of which changes while the app runs, executes
**once per app launch**. Leave the app open overnight, resume at 6 am, and nothing re-asks what day
it is. That is the `check-fetch-once-effects` class CLAUDE.md already names.

## What shipped

`LocalDayProvider` (`components/shell/local-day-provider.tsx`) holds the current local date and
re-evaluates it on mount and `visibilitychange`. `useLocalDay()` returns it, and subscribers use it
as an **effect dependency** — so they re-run on the first resume of a new day and at no other time.

**It is a value, not an event.** React already knows how to act on a changed dependency, where an
event bus needs every consumer to remember to unsubscribe. And `setState` with an unchanged string is
a no-op, so a same-day resume costs nothing and wakes nobody.

**Three subscribers, all of them existing day-scoped state:**
- `WorkoutDayRollover` — which is where this mechanism came from. It already ran exactly this
  listener for the workout store's `todayLogged`; rather than write a second copy, the listener moved
  up and that component became its first subscriber. **One listener in the app, not two.**
- The **morning check-in prompt** — the reported bug. Re-running was already safe:
  `isMorningCheckinPromptDone` compares a date-stamped marker against `todayInTz(tz)`, so it prompts
  once on a new day and no-ops on the same one. The state was right; only the trigger was missing.
- The **today-mood read**, which re-derives the date itself and had the same never-re-runs shape.

## The "close / full reset" half is answered rather than built

The entry argued against implementing it literally and the argument holds: **BF-80 forbids fixing a
resume problem with a reload** (it would give a blank screen two candidate causes while that entry is
still being diagnosed), instant paint exists so a repeat open shows data rather than a spinner, and
an unsynced outbox and an in-progress workout both survive today without being tested on a schedule.
**The signal delivers the ask without the reset**: on the first resume of a new day the app
re-prompts and re-reads; on any other resume it does nothing.

## The test drives the boundary, and the first version of it was worthless

A rollover fault is invisible except across local midnight, so the spec installs Playwright's clock
at **23:55 Brisbane**, closes the prompt (asserting the date-stamped marker is written), then
fast-forwards ten minutes and dispatches `visibilitychange`. A second test fast-forwards **two**
minutes and asserts nothing re-prompts — because "prompt on every resume" would be a worse bug than
the one being fixed.

**The first version passed with the fix reverted.** It used `isVisible()`, which is a point-in-time
check and not a wait: the sheet is a `dynamic(ssr:false)` import behind an async lookup, so it had
not rendered when the setup asked, the close branch never ran, and the final assertion was simply
waiting for that first appearance. **Mutation found it; reading did not** — and this is the second
time in two sessions that a guard which could not fail was caught only by breaking the code under it.

Both mutations now fail the spec: removing `localDay` from the check-in's deps, and deleting the
provider's `visibilitychange` listener.

## The size ratchet made this better

Adding the fix pushed `session-select-content.tsx` past its 1458-line baseline, and its rule is
**extract, do not append**. Rather than trimming comments to squeeze under, the check-in's marker
helpers moved to `app/session-select/morning-checkin-marker.ts` — a real unit, and the reason the
effect is safe to re-run. The file came out at **1449**, so the baseline shrank rather than held.

## Verification

- **The boundary test passes and both mutations fail it.** 4 tests green locally.
- `pnpm check:rules` — **Ran 67 of 67**, including the component-size gate that caught the append.
  `tsc`, `pnpm lint`, backlog-pointers and doc-links all exit 0, each read by exit code.

**Not exercised: the device.** A real overnight resume on the S25 is the verification the owner's
report describes — Playwright's clock proves the logic, not Android's process lifecycle, and a
WebView that was evicted and restored is a different path from a resume.

**Deliberately not swept: the today-scoped reads.** ~30 `cachedFetchToday` sites and 59
`readTodayCacheSync` sites exist. Both already treat a past-dated entry as a miss, so they are correct
**whenever they run**, and most sit behind the `tabEpoch` re-show pass. Whether any is both
persistently mounted and never re-read is Q-359's question; subscribing them all blind would be a
large diff justified by a guess. `useLocalDay()` is the mechanism if one turns out to need it.
