#!/usr/bin/env node
/**
 * BF-129: every selectable `exercise_library` row must declare its equipment.
 *
 * Both equipment filters read an empty list as an unconditional pass —
 * `ex.equipment.length === 0 || ex.equipment.some(...)` in `app/api/generate-program/route.ts`
 * and `components/workout-builder/builder-review.tsx` — so an unlabelled row clears EVERY
 * equipment selection anyone can make. Migration 269 filled in the 22 that had drifted; this is
 * what stops the 23rd. An unlabelled row is also budgeted as a four-minute barbell lift, because
 * `transitionSecForEquipment([])` returns `TRANSITION_SEC_DEFAULT` (= `TRANSITION_SEC_BARBELL`).
 *
 * **This runs in Migration Check, not Tests, and that is deliberate.** It needs a database where
 * only the migrations have run. The Tests job shares one dev database across the suite, and
 * `set-log-planned-snapshot.test.ts` inserts an `exercise_library` fixture (`Snapshot Chin`) with
 * no equipment — so the same assertion there passes or fails on test ORDER, which is a flake, not
 * a guard.
 *
 * Merged rows are exempt: `listExerciseLibrary` filters them out, so they reach no picker and no
 * generation.
 *
 * **What this check CANNOT see, stated so it is not mistaken for full coverage.** `exercise_library`
 * is only partly seeded: production held 151 rows against a freshly-migrated 141, because
 * `POST /api/exercises` writes to the same shared catalogue at runtime. All 22 drifted rows came in
 * that way, so this check would have passed throughout — a fresh migrated database was already
 * clean. The guard that actually closes that path is the `equipment` requirement on the create
 * branch of `app/api/exercises/route.ts`; this one only holds the seeded rows.
 */
const { Pool } = require('pg')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('check-catalogue-equipment: DATABASE_URL is not set')
    process.exit(1)
  }
  const pool = new Pool({ connectionString })
  try {
    const { rows } = await pool.query(`
      SELECT name, exercise_type
      FROM exercise_library
      WHERE merged_into IS NULL
        AND coalesce(array_length(equipment, 1), 0) = 0
      ORDER BY name
    `)
    if (rows.length > 0) {
      console.error(
        `check-catalogue-equipment: ${rows.length} selectable exercise_library row(s) declare no equipment.\n` +
        'An empty list passes EVERY equipment filter, so these are offered to a lifter who owns none of\n' +
        'the kit, and each is budgeted as a 240 s barbell transition. Give each one its equipment in a\n' +
        'migration (see 269), or set merged_into if it is a duplicate:\n' +
        rows.map(r => `  ${r.name} (exercise_type=${r.exercise_type})`).join('\n'),
      )
      process.exit(1)
    }
    const { rows: total } = await pool.query(
      'SELECT count(*)::int AS n FROM exercise_library WHERE merged_into IS NULL',
    )
    console.log(`check-catalogue-equipment: OK — all ${total[0].n} selectable rows declare equipment.`)
  } finally {
    await pool.end()
  }
}

main().catch(err => {
  console.error('check-catalogue-equipment: failed —', err.message)
  process.exit(1)
})
