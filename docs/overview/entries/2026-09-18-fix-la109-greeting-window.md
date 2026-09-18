# 2026-09-18 — `la109-back-from-subroute` was red on `main` for three hours a day

**Lane B.** Branch `fix/la109-greeting-window`. Test-only; no app code changed.

## What was wrong

`e2e/la109-back-from-subroute.spec.ts:118` waited for
`getByRole('heading', { name: /Good (morning|afternoon|evening)/ })`.

`getGreeting` (`app/session-select/greeting.ts`) has **four** periods, not three — `night` from
21:00. So the assertion was red between 21:00 and 23:59 in the seed user's Brisbane
(11:00–13:59 UTC) and green the other twenty-one hours. It first bit on a CI run that started at
**12:34 UTC — 22:34 Brisbane**.

This is the hour-dependent trap CLAUDE.md's date-arithmetic rule names, and `greeting.ts`'s own
comment warns about it in the same words: *"a test that reads the real clock can only exercise
whichever period CI happens to run in."*

## How it was established, not assumed

The failure surfaced on an unrelated PR (#1299, RV-57), which touches
`app/session-select/session-select-content.tsx` — the component that renders the greeting. That is
close enough that "not mine" needed proving rather than asserting:

- **Control run on clean `origin/main` (8bf12172b7): the same spec, same failure.** So `main` itself
  was red on E2E, and the PR was not the cause.
- The failure page snapshot shows Home rendered **correctly** — `heading "Good night, Test User."
  [level=1]`, the URL `/`, the full Home tree beneath it. LA-109's behaviour was never wrong; only
  the regex was.
- After the fix, green in the **same night window** that had just failed.

## A red herring, chased and closed

The CI logs also carried a React hydration mismatch on Home — server `Tuesday 10 March`, client
`Friday 18 September`, inside `HeaderMetaRow`. That reads like a live SSR bug and is not one:
`e2e/day-rollover-checkin.spec.ts` installs a fake **client** clock at `2026-03-10 23:55` Brisbane,
deliberately, and the server keeps real time. Expected artifact of `page.clock.install`. Recorded
here so the next reader of those logs does not re-open it.

## The fix

Match the greeting by **shape** (`/^Good \w+, /`) rather than adding `night` to the list. Spelling
the periods out restores the same trap the moment a fifth is added, and pinning one period would
need the seed user's timezone — re-opening it from the other direction. The assertion only has to
prove Home's own tree rendered rather than the stale tab's, which is what the shape says.
