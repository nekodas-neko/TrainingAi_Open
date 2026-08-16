## 2026-07-28 — Q-20: the exercise catalogue, mirrored on-device

**Branch:** `fix/local-store-exercise-type` · v1.230.3 · backlog Q-20 cleared

### The gap

`lib/local-store/` carried no `exercise_library`, so `program-assembler.ts` hardcoded
`exerciseType: 'weighted'` for every exercise it assembled and `health-content.tsx`'s
strength-trend seed did the same — both with comments admitting it.

On the APK (the canonical runtime) that meant a bodyweight exercise opened offline rendered a kg
working weight instead of a rep target, the Q-12 rep-max display fell back to kilograms until the
server response landed, and `formatSetLoad`'s bodyweight branch never fired. It is the offline-first
rule that a local table must hold enough to *render* the row, and the missing reference table is the
same class of gap as `food_logs` holding no `food_items` — the bug that caused the original
food-disappearing reports.

### What shipped

- **Local `exercise_library`** (migration v20, registered in `RECONCILE_TABLES` in the same commit
  per the partial-upgrade rule). Keyed on the **lower-cased name** — deliberately the identity the
  server's own `libByName` lookup already uses (`lib/workout/session-data.ts`), so the two cannot
  disagree about which entry an exercise resolves to. `id` is carried for the eventual move to id
  identity, which is Q-5's territory.
- **`upsertExerciseLibrary` / `getExerciseLibrary`** on `LocalStore`.
- **`exerciseLibraryRowsFrom`** — a pure mapper from a server `WorkoutExercise[]` to local rows.
- **Hydration from `/api/workout-data`**, which already carries `exerciseType`, `mainMuscles`,
  `secondaryMuscles` and `equipment` for every exercise it returns. Deliberately *not* a new sync
  domain: the catalogue is global rather than user-scoped, and the existing response is already a
  sanctioned hydration source ("server responses fetched by the page hydrate the local store"). The
  write is fire-and-forget — a failed mirror write must never affect the painted screen.
- **Both hardcodes now read the mirror**, falling back to `'weighted'` only for an exercise it has
  not yet seen — the pre-Q-20 behaviour demoted from "the only answer" to "the fallback".

### Verification

Full suite **2,509 passing**, `tsc` + lint clean, `check-reconcile` (35 tables) and
`check-push-mutations` OK.

The version-pin test in `lib/sqlite/__tests__/migrations.test.ts` failed on the bump, which is the
guard doing its job — updated to v20 and given an assertion that v20 actually creates the table.

Live `pnpm dev` against local Postgres, authenticated: `/api/workout-data?tab=<id>`, `/health` and
`/workout` all 200, no dev-log errors. The real payload was then run through the mapper in a
throwaway test to prove the field mapping against actual server output rather than a fixture —
`Barbell Bench Press → weighted` with `{muscle: 'chest', role: 'main'}`, and `Tricep Pushdown`'s
two equipment values joined correctly.

A test-authoring slip worth noting: my first assembler test asserted against
`baseRows().exercises[0]`, but the assembler sorts by `position`, so the first *rendered* exercise
is a different one. The test was wrong, not the code.

### Not exercised — and this is the whole point of the change

**On-device.** `getLocalStore` returns null in the web sandbox, so neither the migration, the
accessors, the hydration write, nor the offline read ran natively. Everything verified here is the
pure logic and the server half. Q-20's own entry says "verify on the APK" for exactly this reason.

Owner check after an APK rebuild: open the app once online so the mirror populates, then go offline
and open a session containing a bodyweight exercise (e.g. Pull-Up) — it should show a rep target,
not a kg weight. Known-Issues row added.

### Note for whoever takes Q-5

Q-5's entry says to run Q-20 first because they overlap on this hydration path — that is now done.
Q-5 will want to move `personal_records` identity from name to `exercise_id`; this table already
carries an `id` column for that, currently unpopulated because `/api/workout-data` does not return
the library row id.
