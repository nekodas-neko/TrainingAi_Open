# 2026-09-23 — RV-82: the second fetch, and the trap in removing it

**Branch:** `lane-a/rv82-program-double-fetch` · **Lane A** · the repository type, the adapter and
three API routes. No migration, no schema change, no client change.

## The measurement held

Both routes called `repo.getActiveProgram(userId)` in the same `Promise.all` as `getNextSession`,
and `getNextSession` calls `getActiveProgram` itself. It is a fixed **5-query composite**, so
`programs`, `program_sessions`, `schedules`, `schedule_days` and `session_exercises` each ran twice
per request — 5 wasted statements of 22 on `/api/next-session/prescription`, and of 19 on
`/api/progress-summary`. Verified at both call sites and in the adapter.

## The entry's two suggested fixes are not equivalent, which it does not say

> *"have `getNextSession` accept an already-fetched program, or have those two routes call
> `getNextSession` alone and read the program off its result."*

**Passing one in would serialise what currently runs in parallel.** Today `getActiveProgram` and
`getNextSession` are both in the routes' `Promise.all`, so the wall-clock cost is the slower of the
two. Fetch the program first and hand it in, and the route pays `getActiveProgram` *then*
`getNextSession` — fewer queries, more latency.

**Reading it off the result keeps the parallelism**, because `getNextSession` already fetched it
inside its own `Promise.all`. That is what shipped.

## What the entry also does not mention, and it would have been a regression

`NextSessionRecommendation` did not carry the program, so the fix means adding a field — and
**`/api/next-session/route.ts` serialises that object WHOLESALE** with
`NextResponse.json(recommendation)`. Left alone, the home card's most-fetched response would have
grown by the entire active program: every session, every exercise, the schedule.

That route now strips it. Checked the other two consumers rather than assuming:
`session-explain/insight` and `lib/ai-chat/tools.ts` both pick named fields and needed no change.
There is also only one repository implementation, `PostgresWorkoutRepository`, so no second copy to
keep in step.

## The trap that nearly shipped

`getNextSession` builds a `rem` object — the reminder pair — spread into most of its returns. The
obvious move was to add `program` to it, rename it `common`, and be done.

**`...common` is also spread into `computeAiDynamicNextSession`'s INPUT**, and that function
destructures named fields and rebuilds its own result:

```ts
const { sessions, …, reminderEnabled, reminderTime, … } = input
const rem = { reminderEnabled, reminderTime }
```

So the program was silently dropped on the **ai_dynamic path** — the live one for a program with
`phaseMode === 'ai_dynamic'`, which is exactly what the prescription route branches on. Both routes
would have read `undefined`, fallen back to `null`, and behaved as though the user had no active
program.

**TypeScript cannot see this**: `program` is optional, so every path compiles. It was found by
reading the scorer, not by the compiler and not by any existing test.

The fix separates the two concerns by name: `reminders` is what the scorer is given (its actual
input), `common = { ...reminders, program }` is what this method's own returns spread, and the one
ai_dynamic return — the scorer's object, not ours — attaches `program` explicitly.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | ai_dynamic return drops `program` (the bug above) | killed |
| 2 | `...common` fed to the scorer instead of `...reminders` | killed |
| 3 | `/api/next-session` stops stripping before serialising | killed |
| 4 | a route re-fetches with `getActiveProgram` | killed |
| C | `common`'s key order swapped | **survived** (correct) |

**The control failed first time, and was right to.** The assertion pinned the literal string
`const common = { ...reminders, program }`, so a reorder that changes nothing — the two share no
keys — failed it. Same slip as TN-60's control earlier today. It now matches the contract:
`common` contains the reminders spread and the program, in any order.

## Not done

- **No per-user memo of `getActiveProgram`.** The entry forbids it explicitly, and the reason is
  good: the same launch reads the program 8 times across 22 warm routes, and collapsing that trades
  against config-save freshness. That is a decision, not a cleanup, and it needs its own entry.
- **No latency figure, still.** The entry could not produce one (dev wall times are flat ~350 ms
  regardless of query count, from compile overhead) and neither can this: the cost against
  Railway's private network is unmeasured. This is filed as shape, not as a speed fix.
- **Failure surfaces not exercised:** the device, and production. The tests are source-level scans
  for the reason stated in the file — the invariant they pin is one the compiler cannot express.
