# Session-select and the workout screens compute "today" in the user's timezone (Q-477 slice 3)

**Branch:** `fix/session-select-workout-user-timezone` · **Lane B** · v1.362.0

## What shipped

The single largest file in the sweep plus the workout cluster — 23 call sites across five files:

| file | calls |
|---|---|
| `app/session-select/session-select-content.tsx` | 16 |
| `components/workout-screen.tsx` | 4 |
| `components/workout/active-workout-screen.tsx` | 1 |
| `components/workout/done-screen.tsx` | 1 |
| `components/workout/exercise-summary-screen.tsx` | 1 |

Ratchet: **70 calls / 33 files → 47 / 28.** All five files drop to zero and come off the baseline.

`session-select-content` already had `const tz = useUserTimezone()`; the other four gained it.
**Two of the sixteen were in module-scope helpers** — `isMorningCheckinPromptDone` and
`markMorningCheckinPromptDone`, which build the `ta_morning_checkin` localStorage stamp. They can't
call a hook, so they take `tz` as a parameter now, matching `getGreeting(name, tz)` in the same file.

Seven `useEffect`/`useCallback`/`useMemo` dependency arrays in `session-select-content` and three in
the workout files gained `tz`. It's a context value and stable for the session, so this adds no
re-run churn — and it keeps the introduced-lint-warning count at **zero** (verified by linting the
pre-change file and comparing: 6 warnings before, the same 6 after).

## The find: the ratchet has a blind spot

`session-select-content` declared two local `const tz = Intl.DateTimeFormat().resolvedOptions().timeZone`
— the **device's** zone — used to build the early-deload dismiss key
(`ta_early_deload_dismissed_${yyyy-MM}`) and to read the current hour for the "day in review" evening
gate. That is the same Q-477 bug class, but **`check-client-today-timezone.js` cannot see it**: its
`BARE` regex only matches `todayInTz()` / `localDateString()` with empty parens.

It surfaced by accident. One of those locals **shadowed** the component's own `tz` in the same block,
so converting the counted calls produced a TypeScript *use-before-declaration* error rather than
silently compiling. Both now use the component's `tz`.

**So the ratchet's number is a floor, not the whole class.** An `Intl.DateTimeFormat()` sweep is
separate, unmeasured work — worth knowing before anyone reads "47 remaining" as the full picture.

Note on the dismiss key: it's month-granular (`yyyy-MM`) and both the write and the read moved
together, so they stay consistent. A key written under the old device zone could fail to match near a
month boundary for a user whose zone differs — self-healing the next month, and for the owner both
zones are Brisbane.

## Deliberately not in this slice

**`lib/stores/workout-store.ts` (3 calls).** It's a Zustand store, not a component — no hook
available — so its calls need `tz` threaded from every caller, including `applyRehydrateFixups` on
the rehydrate path. Structurally different from the rest of the sweep; left for its own slice.

## Verification

- `pnpm tsc --noEmit` — clean. `eslint` — **zero new warnings** (diffed against the pre-change file).
- Full unit suite: **3945 passed, 0 failed.**
- `pnpm check:rules` — **Ran 55 of 55**; ratchet reports "baseline held" at 47/28.
- Drove a browser as a `Pacific/Kiritimati` user on a **UTC device** (so user-day 08-25 ≠ device-day
  08-24): `/session-select`, `/workout`, and the in-workout screen after tapping **Start Workout**
  all render correctly with **zero page errors**. That exercises the two changed module-helper
  signatures and the mounted components.

## Not exercised — read this before trusting the slice

**I did not drive a save through each of the 23 converted sites.** What this slice verifies directly
is *non-regression*: nothing crashes, nothing lint-regresses, every test still passes, and the
heaviest converted screens mount cleanly under a non-Brisbane user.

The **mechanism** (`useUserTimezone()` → `todayInTz(tz)` producing the user's day rather than
Brisbane's) was proven end-to-end in **slice 2** (#406), where two POST bodies carried the user's
`2026-08-25` and the rows landed on it. This slice applies that identical mechanism more widely.

One thing I checked and will *not* claim: the in-workout header reading "Tuesday 25 August" (the
user's day, on a device showing the 24th) comes from `pre-workout-screen.tsx:127`, which was
**already** correct and is not a file this slice touched. It is evidence the screen works, not
evidence of this change.

Nothing checked on the S25. Remaining sweep: **28 files / 47 calls** —
`node scripts/check-client-today-timezone.js --print` for the live list.
