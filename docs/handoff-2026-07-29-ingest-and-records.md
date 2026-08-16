# Handoff — 2026-07-29 · ingest validation and the personal-records rewrite

Written at the end of the session that closed **Q-24**, **Q-25** and **Q-5b**. Read this before
picking up any of the follow-on work; it records what changed, what is deliberately *not* done, and
the two things only the owner can unblock.

---

## 1. What shipped

Seven PRs, all merged to `main` and auto-deployed, in order:

| PR | What | Migration |
|---|---|---|
| #898 | `log-exercise` — an impossible 1RM can no longer become a permanent record | — |
| #900 | The six remaining Q-24 §7 ingest surfaces — **Q-24 closed** | — |
| #902 | Q-25 (a) unknown `activityType`, (b) weigh-in filed on the wrong day — **Q-25 closed** | — |
| #905 | Q-5b — `personal_records` becomes log-derived, drifted rows corrected | **163** |
| #913 | Q-5b follow-up — the cable exercises merged (owner-confirmed) | **164** |

`#901` (Q-21 flake) and several perf PRs landed from other sessions in parallel.

### The one idea behind all of it

Every route involved bounded its fields correctly and none was wrong about any single field. The
defect each time was a **relationship** per-field validation cannot express: a distance against a
duration, a stage total against the night containing it, a timestamp against the session it belongs
to, an RR interval set against the bpm measured off the same heartbeat, a derived 1RM against what
a human body can lift.

Two shared modules now own that:

- **`lib/validation/plausibility.ts`** — every cross-field check. `activityImplausibleReason`,
  `sleepImplausibleReason`, `oneRmImplausible`, `rrContradictsBpm`. Reuse these; do not restate a
  bound. Thresholds are deliberately generous — a rejection means a decode fault or unit mix-up,
  never a hard session.
- **`lib/validation/ingest-clock.ts`** — `resolveMeasuredAt`, clamping a client timestamp to a
  window around server time. Sibling `resolveCompletedAt` lives in
  `lib/workout/complete-workout.ts` because it also reconciles against the session's `startedAt`.

Both are indexed in `docs/module-map.md`.

### The decision that matters most for future ingest work

**What a route does with a bad payload is decided per surface, and getting it wrong wedges the
app.** The pattern established here:

| situation | response | why |
|---|---|---|
| single interactive save (`fitness-tests`) | reject 400 | user is present, tell them |
| re-sent batch (`sync-health`, `hr-ingest`) | skip the record, keep the batch | the sender re-sends the same window forever; a 400 wedges the sync permanently |
| offline outbox replay (`complete-workout`) | reconcile, never reject | a 400 quarantines the mutation and the workout is never marked complete |
| real hardware reading with a bad clock (`scale-ble`) | reject the impossible value, clamp the timestamp | the weight is good data; don't lose it over its timestamp |

---

## 2. `personal_records` — what changed, and the contract now

Migration 159 (previous session) split two meanings the table had been serving. **163 and 164 are
the data half.** The contract is now:

- `personal_records` = **log-derived only**. Every row is exactly what `reconcilePersonalRecord`
  would produce, so a later reconcile is a no-op rather than a silent re-drift.
- `exercise_estimates` = **what the user typed**. `resolveWorkingBasis` (`lib/1rm.ts`) takes the max
  across log / estimate / PR, so nothing regresses when a value moves between them.

**The ordering inside 163 is load-bearing and must be preserved by anything that touches it:**
preserve into `exercise_estimates` *before* correcting `personal_records`. Swap them and the
migration deletes numbers the user typed. There is a test that fails if you do
(`personal-records-reconcile-migration.test.ts`).

### What it did on production

Six of 36 rows changed — Bench 92.75→96.00 and Front Squat 67.50→73.75 *up* (their best logs
predate the PR row, so the IfBetter gate never saw them); Hammer Curl, Straight Arm Pulldown and
Tricep Cable Combo *down* to what their logs support; Lateral Raise's `achieved_at` re-stamped.
Then six duplicate names merged away across the two migrations: 36 → 30 rows.

### Two traps found the hard way

1. **The plan's numbers were stale.** It said Bench 90.8; production said 92.75 — a month of new
   logs had moved it. A migration written from the plan's literals would have matched nothing and
   silently done nothing. **Always re-audit against live data before writing a data migration**, via
   the read-only endpoint (§5).
2. **Two variants mapping onto one survivor breaks a naive rename.** `UPDATE … WHERE NOT EXISTS
   (canonical row)` renames *both* to the same name and violates the `(user_id, exercise_name)`
   unique key, aborting the whole migration. 163 escapes this only by construction. 164 fixes it by
   renaming exactly one row per `(user, canonical)` and running the rename *before* the raise. Any
   future name-merge migration needs the same shape.

---

## 3. Blocked on the owner — nothing else can move these

| item | what is needed |
|---|---|
| **D2 raw-store device run** | Drain the ring on the S25, confirm `rawStats()` per-event counts, force-stop mid-drain, confirm the tail re-drains with no loss or dupes, confirm `rawStoreOpen: true`. **Blocks D2 Tasks 4+.** |
| **Q-3b** | Awakenings-calibrated restfulness needs the owner's own sleep ratings as the reference — the Admin → Day Review calibration card (Q-16) is the tool. No ground truth exists without it. |
| **Q-4** | `respiratory_rate` persisted from an estimator its own docs call uncalibrated. Three options, none a pure bug fix — a product decision. |
| Device-verification backlog | D1 restore proof, guided-walk target check, Q-20 offline check (online once, then offline, Pull-Up must show reps not kg). |

---

## 4. Ready to pick up — recommended order

### 4.1 Q-26 — merged-away exercise names still appear in the picker *(small, do first)*

163/164 merged six names and moved all history, but left `exercise_library` alone — it is **global,
not per-user**, so deleting a catalogue row has a different blast radius (other accounts,
`exercise_id` FKs from historical rows).

Consequence: `Cable Lat Pulldown`, `Straight Arm Pulldown` and `Cable Crunch` are still selectable,
and picking one re-opens the split. The three free-text misspellings never had library rows and
cannot come back.

**Recommended shape:** add `merged_into UUID REFERENCES exercise_library(id)` (nullable) to
`exercise_library`. The picker filters out rows where it is set, and can render "use Cable Pulldown
instead" when something historical references one. This keeps every FK valid, is reversible, and
gives the UI something useful to say. A hard delete does not.

Not urgent — the active program references only surviving names, so it takes a deliberate pick.

### 4.2 `return 60` in `computeInitialWeights` *(deferred from Q-5b on purpose)*

`components/workout-screen.tsx:74`. The resolver makes it unreachable for any exercise with a log,
PR or estimate; what remains is the genuinely-nothing case, where an empty field the user fills in
is the honest outcome. The prescription route already returns `weightKg: null` in exactly this case,
so the shape is proven server-side.

**Why it was not folded into #905:** it is a typed change through the hot workout path (`number[]`
would have to admit an empty value, rippling into the weight dial, set cards and the store) with a
different risk profile from a data migration — and it changes what the weight input renders, which
the backlog itself says wants a look on-device. Do it as its own PR with a device check.

### 4.3 Q-24 §7's neighbours

The §7 sweep hardened seven surfaces. Two adjacent things were noticed and are **not** covered:

- `sanitiseNutrition` (`lib/nutrition/scan-totals.ts`) implements an Atwater cross-check but is
  applied **only on the AI-scan path** — the manual food-entry path bypasses it.
- The `pushMutations` offline branches remain systematically weaker than the web routes they mirror
  in places the §1–7 sweep did not enumerate. The structural fix is one shared write function per
  domain (`logExerciseFromPayload` is the reference); `scripts/check-push-mutations.js` enforces the
  boundary but not parity of validation.

---

## 5. Tools and gotchas this session proved out

### Read production, read-only

```bash
curl -s -X POST "https://trainingai-production.up.railway.app/api/admin/db-query" \
  -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT count(*) FROM personal_records"}'
```

`CLAUDE_DB_QUERY_SECRET` is already in this environment. `GET` the same URL for schema discovery —
**start there**, the `claude_ro` views do not always match the base table columns (`exercise_logs`
has no `top_set_weight`; `session_exercises` joins on `session_id`, not `program_session_id`).

This is how every number in 163/164 was derived. Use it before writing any data migration.

### Testing a data migration

The pattern that worked, in order:

1. Audit production read-only; write down the expected before/after per row.
2. Build a **local fixture** reproducing the production shapes (`psql -f`), run the migration file
   directly, diff against the expectation.
3. Run it **twice** — a data migration that is not idempotent will be re-applied, because
   `ensureSchema` only records a filename *after* the file succeeds.
4. Write DB-backed tests in `lib/data/postgres/__tests__/`, then **deliberately break the migration
   and confirm they go red.** Three of 163's tests and three of 164's were verified this way. A test
   that passes either way proves nothing — one of 164's did exactly that until it was rewritten
   (the raise step is only load-bearing when the survivor has no logs to re-derive from).

### Migration file mechanics

- Applied by `pool.query(wholeFile)` → **one implicit transaction**. Under `psql -f` it is
  statement-at-a-time. **Do not use `CREATE TEMP TABLE … ON COMMIT DROP`** — it behaves differently
  under the two, and cost an hour here. Repeat an inline `(VALUES …) AS p(…)` instead; verbose beats
  environment-dependent.
- Migration numbers must be claimed against the directory **and open PRs**. `161` collided this
  session (`161_activity_log_walk_segments.sql` landed alongside `161_clock_anchor_epochs.sql`).
  They are independent so apply order is harmless, but **do not rename an applied migration** —
  `schema_migrations` tracks by filename, so a rename re-applies it.

### The local test DB

`DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'` — DB-backed tests skip
silently without it, and CI *does* set it. Full suite ran clean at **2,772 passing** at the end of
this session. The historically flaky Oura rollup files were fixed by #901 and were stable in every
run here.

---

## 6. Process notes worth keeping

- **A backlog entry is a hypothesis, not a spec.** Both Q-5b and Q-25 were materially wrong by the
  time they were implemented — stale numbers in one, an understated blast radius in the other (the
  scale bug was in *two* routes, and the unnamed one was the worse). Re-derive before building.
- **The sibling-surface sweep earns its keep.** It found the second scale route in Q-25 and the
  second cable pulldown variant in Q-5b. Grep for every surface handling the domain before calling a
  fix done.
- **When a plan says to delete user data, check what the user actually uses.** Q-5b's plan would
  have kept `Cable Lat Pulldown` (2 logs, abandoned in June) and deleted the record for
  `Cable Pulldown` (11 logs, current), because it reasoned from spelling. Log counts settled it.

---

## 7. State at handoff

- `main` @ `298bed6` + #913 pending merge. All CI green.
- Backlog: Q-24, Q-25, Q-21, Q-5b closed. Q-26 filed. Q-1, Q-2, Q-3b, Q-4, Q-7b, Q-10, Q-11, Q-22,
  Q-23 open.
- No uncommitted work. No unpushed branches.
- Version not bumped for any of this — none of it is user-visible except the corrected PR numbers,
  which are a data change rather than a feature.
