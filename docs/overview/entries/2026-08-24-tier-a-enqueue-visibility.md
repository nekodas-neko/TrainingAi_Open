# The last line of defence stopped failing silently (Q-486)

**Branch:** `fix/tier-a-enqueue-visibility` · **Lane B** · v1.345.0

## What was wrong

`components/workout-screen.tsx` has four `queueMutation` calls — two for `workout_log`, two for
`complete_workout` — and all four ended `.catch(() => {})`. They were the only `queueMutation` calls
in the app that swallowed; the other ~26 `await`, so a throw reaches a `try` and suppresses their
success toast.

The path around them is good, and reading it as sloppy would be the wrong lesson.
`logWorkoutLocally` writes to the local store first **and warns on its own failure**; the primary
send is a direct `POST /api/log-exercise`, deliberately independent of the outbox. The enqueue is
the *fallback*. So losing a set needs two failures at once: the POST fails (offline — exactly what
the fallback exists for) **and** the local SQLite store is unavailable, which `CLAUDE.md` records as
having happened twice on Android, plus the partial-migration and `disk_full` cases.

When both fail the set is not sent, not queued, not recoverable, and **nothing is logged** — while
`hapticLight()` and `setLoggedCount(c => c + 1)` have already told the user it saved. In the same
function, the *less* consequential failure was warned and the more consequential one was not, which
is what makes it read as an oversight rather than a decision.

## What shipped

`reportEnqueueFailure(domain, err)` in `lib/local-store/dead-letter-signal.ts`, and the four
`.catch(() => {})` now call it. It warns — matching the line already above them — and for a Tier-A
domain fires a toast naming what was lost, distinguishing a set from a finished workout.

Control flow is untouched and the calls are still fire-and-forget. Converting them to `await` would
put a SQLite write in front of the haptic, which is the instant-feedback rule this screen is the
reference for.

## The one thing the entry got wrong

Q-486 said to *"signal the user through the existing dead-letter badge"*. That would have been
wrong, and noticing why is most of the work in this change.

The badge counts dead-lettered outbox **rows**, and the Data & Sync card lists them so each can be
retried or discarded. A thrown enqueue leaves **no row** — that is the entire defect. A badge lit
from here would show a number that card cannot explain, act on, or clear, and it would sit there
permanently. The toast is right for the opposite reason: it fires at the moment of loss, the only
moment the user can do anything about it — re-log the set while they still remember it.

## Verification

- `lib/local-store/__tests__/dead-letter-signal.test.ts` — four new cases (7 in the file): warns and
  toasts for Tier-A; names a finished workout differently from a set; warns without interrupting for
  Tier-B; and **leaves the badge alone**, which is the decision above pinned by test.
- `pnpm check:rules` — Ran 55 of 55.
- Typecheck and lint clean.

## Not exercised

**The failure itself cannot be induced in this sandbox and was not.** It needs a broken local SQLite
on a device; here `getLocalStore` returns null, so `store_?.` short-circuits and the enqueue never
runs at all. That `queueMutation` throws on a dead local DB is read from source, not observed — as
true after this change as before it. **The Q-486 Known-Issues row in `projectOverview.md` therefore
stays**, carrying `Gate: device`, and the backlog entry keeps a `Keep:` line for the same reason.
Nothing here was seen on the S25.
