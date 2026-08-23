# 2026-08-20 — the program-config write surface, and the FKs it took on trust (RV-32, RV-34)

**Branch:** `fix/style-id-ownership-on-create-paths` · **Lane A** · batch `program-write-fk-ownership`
· closes **RV-32** and **RV-34** · Review sweep 40's write-up:
[`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](../../reviews/2026-08-20-non-workout-write-surface-ownership.md)

## RV-32 — a style id belonging to someone else

`progression_styles.user_id` is `NOT NULL` and there is no shared or global style, so an id the
caller does not own is always wrong. One of the four write paths said so; three did not.

| write path | before | after |
|---|---|---|
| `PUT /api/phase-sets/[id]` | 400 ✅ | 400, through the shared guard |
| `POST /api/phase-sets` | **201, persisted** | **400** |
| `POST /api/workout-templates` (`session_exercises.style_id`) | **200, persisted** | **400** |
| `POST /api/log-exercise` (`exercise_logs.style_id`) | **200, persisted** | **id dropped, set still logged** |

**The third one is deliberately different, and the reason is the outbox.** A 4xx on a queued mutation
is a poison pill the push loop quarantines, so refusing there would cost a whole logged workout over
a metadata column. The guard lives in `logExerciseFromPayload`, which is the one function both the
web route and `pushMutations` call, so it covers the APK path as well as the browser.

**The read side mattered as much as the writes.** `listPhaseSets` joined the style name in with no
user scope, so `GET /api/phase-sets` returned another user's style **name** — rendered in
`builder-review.tsx` and interpolated into an LLM prompt in `nutrition-goals/recommend`. That join is
now scoped, which is what turns a reference written before the guards existed into a blank rather
than someone else's words.

## RV-34 — a session id belonging to another program

`saveProgram` uses the client's `sessions[].id` as the new row's primary key, deliberately, so an
edit does not sever `workout_sessions.session_id` from already-logged workouts. Unchecked, an id from
another user's program was a raw `23505` duplicate-key **500** carrying the failed SQL into
`error_events`. It failed closed by accident of a constraint, not by design.

**The entry's suggested fix would have broken the workout builder, and that is the finding.** It says
to *"check the supplied session ids against the program's existing rows"* — but `builder-review.tsx`
mints a fresh `crypto.randomUUID()` for **every** session on save, so that reading refuses every
build. The guard is therefore *exists under a different program*, not *not one of this program's*:

- an id that exists nowhere → an ordinary insert, which is the builder's whole shape;
- an id that exists elsewhere → **409** with a reason;
- an id that is not a UUID → **400**, rather than `22P02` at the driver dressed up as a 500.

All three are `UserFacingError`, so `isRefusal` keeps them out of `error_events` — verified: **0 rows**
after the live run below.

## One consolidation, done because the alternative was a third copy

`progressionStyleIdsOwned` is a narrow existence check, in the `foodLogRefsValid` shape: the log path
runs it on every logged set, where `listProgressionStyles` would be two queries and a full hydrate of
every style's sets to answer one boolean. It needed a UUID guard, and the repo already had two
different UUID regexes. Rather than add a third, `isUuid` moved to
`packages/shared/src/validation/uuid.ts` — `lib/api/route-errors.ts` re-exports it and now imports it,
because that module pulls in `next/server` and the repository layer must not.

## Measured

Live on `pnpm dev` with two real accounts, A signed in and B's rows genuinely B's:

| request | result |
|---|---|
| `POST /api/phase-sets` with B's style id | **400** `Invalid styleId` |
| `POST /api/workout-templates` with B's style id | **400** `Invalid styleId` |
| `POST /api/workout-templates` with B's `program_sessions.id` | **409**, with a reason |
| `error_events` rows written by the three refusals | **0** |
| phase set with A's own style · builder-shape fresh ids · config-shape round-tripped id | **200, 200, 200** |

13 new tests across two DB-backed files. **Every guard mutation-verified** — disabling each one turns
exactly its own case red, six for six.

`tsc` clean · `pnpm lint` **0 errors** · **Ran 50 of 50** Custom Rules steps · `pnpm build` clean ·
full suite **538 files, 4,444 tests, 0 failed**.

## Not exploited, and why that is not the same as safe

Production shows 0 of 46 phase rows, 0 of 82 styled `session_exercises` and 0 of 280 styled
`exercise_logs` pointing outside their owner's styles. `claude_ro` is row-scoped to the owner and the
victim's rows are exactly the ones it cannot show, so that is *no evidence*, not *has not happened*.

## Not exercised

The S25 APK. Server routes and the repository layer — no Capacitor, safe-area or gesture surface. No
version bump: a legitimate client sends only its own ids, so nothing a real user does changes.
