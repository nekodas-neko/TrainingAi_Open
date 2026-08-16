# Q-5 — make `personal_records` log-derived, and make "starting weights" actually reach the bar

**Status:** planned, not implemented. Backlog entry: Q-5.
**Owner decision (2026-07-27):** personal records are derived from the logs; nothing hand-writes them.
**Scope enlarged 2026-07-28** after tracing every consumer of a seeded PR — see §1.

---

## 1. Why the obvious implementation is wrong

The decision as first stated was "delete `POST /api/personal-records/seed`". Tracing it found three
things that make that a regression rather than a fix.

**(a) The seeded value never reaches the bar.** `lib/workout/session-data.ts:226`:

```ts
estimated1rm: lastLog?.estimated1rm ?? null,
allTimePr1rm: prMap.get(ex.exerciseName) ?? null,   // ← prMap IS available, two lines away
```

`estimated1rm` is what drives the working weight. It never consults `prMap`. So with no prior log,
`computeInitialWeights` (`components/workout-screen.tsx:58-74`) falls through every branch:

```ts
if (ex?.progressionStyle && ex?.estimated1rm) …   // null
if (ex?.target80 != null) …                        // null
if (ex?.estimated1rm) …                            // null
if (ex?.latestWeight != null) …                    // null
return 60;                                         // ← the bar
```

The builder's own copy — *"Enter your 1RM for each main lift to pre-seed working weights"*
(`builder-review.tsx:691`) — is therefore **false today** for every weighted lift it lists.

**(b) Two weight paths disagree.** `/api/next-session/prescription/route.ts:111` computes
`basis = Math.max(lastLog?.estimated1rm ?? 0, prMap.get(name) ?? 0)` and renders real kg at `:122`.
The workout screen uses the last log alone. Whenever a PR exceeds the last log's estimate — or there
is no last log — the done-screen "next workout" preview and the session it previews show **different
weights**. Same metric, two implementations: a One-Formula-One-Place violation in the most visible
place in the app.

**(c) The seed is load-bearing for one flow.**
`app/api/ai-periodization/baseline/complete/route.ts:53-58` returns
`400 { code: 'no_prior_data' }` when `personal_records` yields nothing for the session's exercises.
For a new user on an `ai_dynamic` program the seed route is the only way to populate it before the
first log, so "skip the AMRAP baseline and use my existing numbers" would become unreachable.

**The root cause is a conflation.** One table has been serving two different meanings — *an earned
all-time record* and *a starting estimate the user typed* — and every symptom above follows from it.
Separating them satisfies the owner's decision **and** makes the starting-weights feature work for
the first time.

---

## 2. Target design

| concept | store | written by | read by |
|---|---|---|---|
| earned all-time best | `personal_records` | log writes only (`upsertPersonalRecordIfBetter` / `reconcilePersonalRecord`) | PR badge, achievements, digests, weights-summary, chat tools |
| user-entered starting estimate | **new** `exercise_estimates` | the builder | the shared basis resolver, `baseline/complete` |

Both feed **one** resolver, which is the piece that fixes (a) and (b) together.

### 2.1 New table

```sql
CREATE TABLE exercise_estimates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id   uuid REFERENCES exercise_library(id) ON DELETE SET NULL,
  exercise_name text NOT NULL,
  estimated_1rm double precision NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_name)
);
```

`exercise_name` keeps the unique key (matching how the builder identifies exercises today) but
`exercise_id` is carried from the start so the name→id migration in §2.5 has somewhere to land.

### 2.2 The shared resolver — the heart of the change

In `lib/1rm.ts`, beside the other basis math:

```ts
/** The 1RM a prescription should be computed from. One definition, both weight paths. */
export function resolveWorkingBasis(input: {
  lastLog1rm?: number | null
  seedEstimate?: number | null
}): number | null
```

Returns `max(lastLog1rm, seedEstimate)` or `null` when neither exists — **never a fallback constant**.

Call sites, both of which must use it and nothing else:
- `lib/workout/session-data.ts` — populate `estimated1rm` from the resolver, not from `lastLog` alone.
- `app/api/next-session/prescription/route.ts:111` — replace the inline `Math.max`.

Then delete `return 60` from `computeInitialWeights`. With the resolver in place it is unreachable
for any exercise that has either a log or an estimate; for one with **neither**, the honest outcome
is an empty weight field the user fills in, not a fabricated 60 kg. Confirm the input renders
sensibly with no value before removing it.

Note `session-data.ts:218` already passes `Math.max(lastLog, PR)` as the bodyweight rep `basis` —
that is a third copy of the same idea and should route through the resolver too.

### 2.3 Seed route

Keep the endpoint (the builder needs it) but repoint it:
- writes `exercise_estimates`, never `personal_records`;
- Zod-validate the body (currently unvalidated — `estimated1rm` is only `Number.isFinite`-checked);
- rename to `POST /api/exercise-estimates` and update the single caller, so nothing reads as a "PR
  seed" any more.

`repo.upsertPersonalRecord` (the unconditional variant) then has **no callers** — delete it, so the
unguarded path cannot be reintroduced. Verify with a grep before removing.

### 2.4 `baseline/complete`

Read both stores: `personal_records` first, then `exercise_estimates` for anything missing, tagging
`source: 'existing' | 'estimate'` so the AI prompt can distinguish an earned number from a typed one.
The `no_prior_data` 400 then only fires when the user genuinely has neither.

### 2.5 Reconcile migration

1. Re-derive the 5 drifted rows from the logs using the real `reconcilePersonalRecord` path — never
   restated SQL. (Migration 148's pattern: generate values with the real module, emit literals.)
   Known: Barbell Bench Press 90.8 → 96.0, Barbell Front Squat 67.5 → 73.8, plus three rows whose
   values appear in no log and must be re-derived or dropped.
2. Copy the pre-existing PR values into `exercise_estimates` **before** correcting them, so a number
   the user typed in the past is not simply lost.
3. Merge the five name-duplicate pairs (`Dumbell`/`Dumbbell Preacher Curl`,
   `Dumbell`/`Dumbbell Shoulder Press`, `DB lateral Raises`/`Dumbbell Lateral Raise`,
   `Cable Pulldown`/`Cable Lat Pulldown`, `Cable Crunch`/`Cable Crunch Abs`), keeping the higher
   value and the canonical `exercise_library` spelling, and backfill `exercise_id` on all 36 rows
   (3 are NULL today).

Idempotent and predicate-driven where possible; the drifted-row corrections are id-driven and need
the "inert on a database without these rows" test that migrations 148/152 use.

### 2.6 Offline

`exercise_estimates` is written from the builder, which is an online program-creation flow, but the
**resolver reads it on every workout screen** — so it must be available locally or the APK falls back
to the old behaviour offline. Add the local table + pull-delta hydration in the same PR, per the
offline-first checklist. This overlaps Q-20 (which adds a local `exercise_library`); if Q-20 ships
first, reuse its hydration path.

---

## 3. Verification

- `pnpm dev`: create a program with a starting 1RM for an exercise with no history, start the
  session, and confirm the bar shows a weight derived from that 1RM — **not 60 kg**. This is the
  assertion that proves the feature's own copy true, and it is the one that must not be skipped.
- Confirm the done-screen "next workout" card and the workout screen show the **same** weight for the
  same exercise, in both the has-log and no-log cases.
- Confirm `baseline/complete` succeeds for a user with only an estimate.
- DB-backed tests on the reconcile migration: corrects the drifted rows, inert without them,
  idempotent, duplicates merged to the higher value.
- Unit tests on `resolveWorkingBasis` — including that it returns `null` rather than any constant.
- **On-device:** the local-store addition and the offline read path. Not verifiable in the sandbox.

## 4. Sequencing

Independent of the Oura chain. Overlaps Q-20 on the local-store hydration path — if both are queued,
run Q-20 first and reuse its work.
