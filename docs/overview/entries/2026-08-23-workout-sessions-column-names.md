# 2026-08-23 — The dead column owned the name the live one was used under (Q-474)

**Branch:** `chore/workout-sessions-dead-program-session-id` · **Lane A** · no behaviour change

`workout_sessions` has **two** foreign keys to `program_sessions`:

| column | state |
|---|---|
| `session_id` | **live** — every read and the only write use it |
| `program_session_id` | **dead** — added by `079_ai_dynamic_periodization.sql` "for prescription trigger linkage", never written, never read |

Confirmed again on the local database, which matches what production showed: 3 of 9 rows have
`session_id`, **0 have `program_session_id`**.

Nothing was broken. The hazard was the naming: the Drizzle property `programSessionId` pointed at
the **dead** column, so anyone reaching for the obvious identifier got the inert one, while the live
link was called `sessionId` — a name that also means "the workout session's own id" three lines
away in the same function signature.

**It had already cost a session.** A Q-473 repro fixture populated `program_session_id`, the
periodization block took its `null` branch, the counter never moved, and the honest reading of that
run was "the race does not exist". It does.

## What changed

Property names only — the SQL column names are untouched, so there is no migration:

```ts
programSessionId:       uuid('session_id')           // the live link; the property now says what it holds
unusedProgramSessionId: uuid('program_session_id')   // dead; a name nobody reaches for by accident
```

Reaching for `workoutSessions.programSessionId` now gets the column that actually stores a
program-session id. TypeScript found all twelve call sites; each was corrected to the live column,
and the outward-facing `sessionId` field on returned objects is left alone — that is the
repository's own API name, not the column's, and renaming it is a wider change than this entry.

Two parameters were crossed in the same way and are renamed too:
`ensureWorkoutSession(userId, workoutSessionId, programSessionId, …)` — its first id is the workout
session's own — and `createWorkoutSession(userId, programSessionId, …)`, whose second argument was
called `sessionId` and is a program-session id.

## What this deliberately does not do

**Drop the column.** That is a data-losing migration, needs owner confirmation under `CLAUDE.md`,
and is not obviously worth it on its own — it would ride better alongside other schema work. The
rename removes the trap without it, which is what the entry asked for.

## Verification

Full suite **545 files / 4,496 tests** green · `pnpm check:rules` → **51 of 51** · typecheck and
lint 0 errors. Migration Check is unaffected by construction: it applies SQL, and no SQL changed.

`pnpm dev` against the local DB, signed in — every path the rename touches:

| | |
|---|---|
| `workout-data`, `day-timeline`, `calendar-data`, `next-session`, `weekly-stats` | 200 |
| `POST /api/log-exercise` | 200, and the new row has `session_id` set, `program_session_id` NULL |
| `POST /api/complete-workout` | 200 — this is the path that reads `getWorkoutSessionProgramSessionId` |
| `POST /api/workout-templates` (ids round-tripped) | 200, 4 sessions still linked, 0 orphans |
| `POST /api/workout-templates` (**ids stripped**) | 200 — the program-session id changed and all 4 workout sessions were re-pointed to the new one, 0 orphans |

That last row is the one worth having: it forces `saveProgram`'s orphan re-link, which is the
riskiest of the renamed sites, and shows it re-linking rather than orphaning.

**Not exercised:** on device — nothing here is device-dependent. Not exercised against drifted
production data; the local database happens to show the same 0-of-N shape the production read did.
