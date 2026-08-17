# 2026-08-17 — Q-451: the Workout tab's dead primary action on a brand-new account

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Version:** v1.318.2 · **Lane:** Implementation B

## What was wrong

`/workout-select` is the `Workout` bottom-nav destination and the app's primary action. With no
program it rendered the session carousel anyway: a ~1,400 px card showing position-0's palette emoji
(💪) as a stand-in for content that did not exist, under a full-width **Start Workout** button whose
handler was

```tsx
onClick={() => currentSession && handleStart(currentSession)}
```

With no program there is no `currentSession`, so the expression short-circuited to `undefined`. The
button was not `disabled`, produced no navigation, no toast, no console error and no request. The
comparison that makes it a bug rather than a gap: `/program` handles the same account correctly
("No programs yet. Create one to get started.") — the screen a new user is actually dropped on did
not.

Re-verified against `main` before building: the short-circuit, the palette-emoji stand-in and the
missing empty state were all exactly as filed.

## The fix

Three states where there was one. The important part is the middle one — `sessions: []` meant both
"still loading" and "this account has no program", and rendering the second as the first is what
produced the broken card:

| Condition | Renders |
|---|---|
| `N === 0 && !programLoaded` | a skeleton — genuine cold first load |
| `N === 0 && programLoaded` | "No program yet" + a **Create a program** CTA to `/program` |
| otherwise | the carousel, unchanged |

`programLoaded` is set from a cache seed or a settled fetch, and **deliberately not in a `finally`**.
Telling someone who has a program "No program yet" because their network dropped is a worse failure
than holding the skeleton, so a failed first load with no cache keeps the skeleton and the Refresh
button in the header resolves it.

A repeat visit never sees the skeleton: the `useLayoutEffect` seed sets `sessions` synchronously
before paint, so the carousel is already there — the instant-paint rule holds.

The inert button is **removed** in the no-program case rather than disabled. A disabled primary CTA
still says "this is the thing to do here", which is not true; a CTA to the thing that *is* the
prerequisite is.

## The sibling sweep, and its answer

Grepped for the same `onClick={() => x && f(x)}` shape. One syntactic match:
`app/session-select/components/recommendation-card.tsx:281`, which is on **Home** (that file is
`SessionSelectContent`, rendered by `tab-shell.tsx` as the `home` tab — the `/session-select` route
itself just redirects).

**It is not a bug.** That button sits inside the component's `) : displaySession ? (` branch, so
`displaySession` is non-null by construction there — the `&&` is redundant defence, and its sibling
button two lines down calls `onStartWorkout(displaySession)` unguarded, consistent with that. When
there is no session the card renders `null`, so Home shows no dead control. The review that filed
Q-451 rendered 21 zero-data screens and flagged only this one, which agrees.

Everything else the grep found (`!sectionEditMode`, `!future`, `!inert`, `!isEquipped`) is a
deliberate mode guard, not an inert-on-missing-data path.

## Verified by observation, not guarded

**Observed working.** The harness has one seeded account and it has a program, so I inserted an
ad-hoc `fresh@local.dev` row into the local DB and drove a throwaway spec against it. Full screen
text before, from the review: `Workout / Choose a session to start / 💪 / Start Workout / Cardio Hub
/ Run · Walk · Log anything`. After:

```
Workout / Choose a session to start / No program yet / Create one to get a session to start.
Cardio and one-off activities work without a program. / Create a program / Cardio Hub / …
```

No `Start Workout` button present, and **Create a program** navigates to `/program`. The temporary
spec and the temporary row were both removed.

**Not guarded, and that is the honest state.** Nothing committed can reach a first-run state, so
this can regress silently. Filed as **Q-352**: a zero-data account in the seed plus a second
Playwright storage state. It is not free — `scripts/local-db/setup.sh` will not re-seed a non-empty
`users` table, so an existing local DB never gains the account while CI always has it, and a spec
that assumes it would pass in CI and fail locally. That needs deciding rather than bolting on, which
is why it is an entry and not a rider on this PR.

## What was NOT exercised

- **The device.** Web build only; nothing seen on the S25.
- **Safe-area.** The empty state sits inside the existing `flex-1 min-h-0 mx-4` slot the card
  occupied, with no fixed or bottom-anchored element of its own, so there is no floored-utility
  hazard — but that is structural reasoning, not an on-device check.
- **The failed-first-load path** (no cache, fetch fails). Reasoned about and deliberately left
  showing the skeleton; not reproduced.
- **Samsung WebView rendering** of the new state.
- The 16 committed E2E specs pass, but all run as the seeded user *with* a program — they prove no
  regression to the carousel, and say nothing about the new branch.
