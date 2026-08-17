# 2026-08-17 — Q-450: `/activity` with no type recorded an activity and threw it away

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.1 · **Lane:** Implementation B

## What was wrong

`components/activity/activity-screen.tsx` fell through to `<PreActivityScreen />` whenever
`mode === 'pre'`, with no check on `activityType`. A typeless store is not exotic — it is the
initial state, and `resetSession()` restores it after **every** save and on the Pre screen's own
back button, so it is where the store sits between activities. Four ways in: the AI Coach's
"Log an activity" handoff, the guided-walk summary's Done button, a cold open, and a refresh.

What the user got was a blank-looking but fully working recorder: unlabelled title, working Start,
working timer, working Finish, a real summary — and then `handleSave`'s first line
(`if (!activityType || …) return`) discarded the whole thing before the local write, the outbox and
the API fallback alike. No toast, no error, no navigation, no network request. Discard was the only
control on that screen that did what it said.

Re-verified every claim in the backlog entry against `main` before building; all held, including
both offending navigations and the fact that the two legitimate `startActivity` callers set the type
correctly.

## The fix

**The entry guard is the real fix.** `activity-screen.tsx` now renders a new
`SelectActivityTypeScreen` when `mode === 'pre'` and no type is set, so a typeless recording is
unreachable rather than merely unsaveable.

The guard is deliberately **only** on `'pre'`. An in-flight `'active'` session with a missing type
keeps its own screen — throwing it back to a picker would destroy the session, which is the failure
mode the fix exists to prevent, in a new shape.

**The picker grid was extracted rather than copied.** `components/activity/activity-type-grid.tsx`
now serves both the new screen and `components/workout/log-activity-sheet.tsx`, which had the same
fetch-and-grid inline. Two sites, identical markup, both feeding `startActivity` — the repo's
"extract before a third copy" rule, and the thing that stops the two offering different type lists.
It takes an `enabled` prop because the sheet stays mounted while closed and already, correctly,
declined to fetch a list nobody is looking at.

**And `handleSave` now speaks.** The bail-out is still there as defence in depth — the entry
mandated it stop being silent — and it toasts instead of returning bare. That is not dead code: the
app is a WebView loading from Railway, so a user mid-session when this JS lands still arrives at
that guard, and silently discarding what they just did is never the right answer for them.

## The spec found a second bug

`e2e/activity-untyped-entry.spec.ts`, two tests: the typeless entry shows a picker, and a recorded
activity actually saves. The second one **failed on the first run**, and the cause was not my change.

`POST /api/activity-logs` returned **400**. `durationMin` is
`Math.round((activeMs / 60000) * 10) / 10`, so a sub-3-second activity rounds to exactly `0`, and
`ActivityLogBody.durationMin` is `.positive()` — the row is rejected and the user sees a bare
"Failed to save activity". Measured both directions: 2 s → `400` with `activity_logs` empty; 5 s →
`201` with `duration_min = 0.1`.

Q-450's bail-out was *masking* this — the review that filed Q-450 observed "zero network requests"
precisely because the save never got as far as the POST. Fixing the first defect exposed the second.

Filed as **Q-351** and **not fixed here**: the schema is `packages/shared/**` and the route is
`app/api/**`, both Lane A. The entry carries the measurement, the mechanism and a note that the
outbox path parses with the same schema, so it is a poison-pill candidate rather than only a failed
web POST.

## Mutation-checked

Per the Q-259 rule that a guard which cannot fail is not a guard: reverting `activity-screen.tsx` to
`return <PreActivityScreen />` fails assertion 1 — "element(s) not found" for the picker heading —
and the save test still passes. So the assertion dies with the fix it covers, and the two tests are
independent.

## What was NOT exercised

- **The device path.** `getLocalStore` returns null outside the APK, so the save here took the
  `/api/activity-logs` web fallback, not the SQLite write plus outbox a real tap takes. The `:167`
  guard sits above the local-store branch, so the old bail-out was if anything *earlier* on device —
  but that is reasoning, not an observation.
- **Safe-area on the new screen.** It reuses `PreActivityScreen`'s `pt-safe` header and has no
  bottom-anchored control, so there is no floored-utility hazard to get wrong — but it has not been
  seen on the S25.
- **The two offending navigations end to end.** The Coach handoff needs a live AI response and the
  guided-walk summary needs a completed walk; neither was driven. The fix is at the destination
  rather than at those call sites, which is what makes that acceptable — every entry path lands on
  the same guard, including the ones nobody has enumerated.
- **Samsung WebView rendering** of the new grid.
