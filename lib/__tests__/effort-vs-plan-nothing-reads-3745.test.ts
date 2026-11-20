// #3745, NOTHING READS THE ANSWER YET.
//
// The after-the-last-set answer ("easier / as expected / harder than expected", stored as
// exercise_logs.effort_vs_plan and effort_source) is asked, kept on the phone, uploaded, stored and
// pulled. It must not move a prescription, a score or a Coach prompt until the session read (#3889)
// is built in a later batch. This pins that: every source file that names the answer is listed
// here with what it does with it, and each one only carries it. A new file that names it fails this
// test until someone decides, on #3889, that it may read it.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const NAMES = /effortVsPlan|effort_vs_plan|effortSource|effort_source|EffortVsPlan|ExerciseEffort|effort-vs-plan|answerEffort|effortAsk|effortUntil|effortQuestion/

/** Every non-test source file allowed to name the answer, and why that is only carrying it. */
const CARRIERS: Record<string, string> = {
  // Definition and storage.
  'packages/shared/src/workout/effort-vs-plan.ts': 'the values, their schema and labels',
  'lib/data/postgres/migrations/202611200539_exercise_log_effort_vs_plan.sql': 'the columns (#3922)',
  'lib/data/postgres/schema.ts': 'the Drizzle columns',
  'lib/data/postgres/claude-ro-views.sql': 'the read-only view lists every column',
  'packages/shared/src/types/log.ts': 'the write shape of an exercise log',
  // The upload: schema, route helper, upsert, and the sync pull that carries it back down.
  'packages/shared/src/workout/log-payload.ts': 'the upload schema accepts it',
  'packages/shared/src/workout/log-exercise.ts': 'passes it to the write',
  'lib/data/postgres/adapter.ts': 'writes it (insert / keep-on-replay upsert) and selects it into the sync pull',
  // Preview: asks, keeps, uploads; the window offers the same three answers.
  'mobile/src/features/workouts/logging/effort.ts': 'asks, records a tap, builds the upload field',
  'mobile/src/features/workouts/logging/workout.ts': 'journal schema and the upload payload',
  'mobile/src/features/workouts/logging/WorkoutJournalStore.ts': 'the tap action; resets on re-log and swap',
  'mobile/src/features/workouts/components/EffortQuestion.tsx': 'the question on the rest card',
  'mobile/src/features/workouts/components/ExerciseSummary.tsx': 'places the question on the rest card',
  'mobile/src/features/workouts/screens/GuidedWorkoutScreen.tsx': 'wires the tap to the journal',
  'mobile/src/features/workouts/pip/pip.ts': 'the window buttons map to a tap',
  'mobile/src/features/workouts/pip/usePictureInPicture.ts': 'sends the window when to ask; routes the tap',
  'mobile/src/features/workouts/status/workout-status.ts': 'the window payload field, always null there',
  'mobile/src/integrations/workout-status/types.ts': 'the payload type',
  'mobile/modules/picture-in-picture/android/src/main/java/expo/modules/pictureinpicture/PipState.kt': 'which buttons the window shows',
  'mobile/modules/picture-in-picture/android/src/main/java/expo/modules/pictureinpicture/PictureInPictureModule.kt': 'when the buttons go back',
}

const isTest = (path: string) =>
  /(^|\/)(__tests__|tests|test)\//.test(path) || /\.test\.tsx?$/.test(path) || /Test\.kt$/.test(path)
const isDoc = (path: string) => /\.(md|mdx)$/.test(path) || path.startsWith('docs/')

describe('nothing reads the effort answer yet (#3745, until #3889)', () => {
  // Tracked and new files alike, so a reader added in a working tree fails before it is committed.
  const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
    .split('\n')
    .filter(path => /\.(ts|tsx|js|mjs|cjs|kt|sql)$/.test(path) && !isTest(path) && !isDoc(path))
  const naming = files.filter(path => NAMES.test(readFileSync(path, 'utf8')))

  it('only the carriers above name it', () => {
    expect(naming.filter(path => !(path in CARRIERS))).toEqual([])
    // And the list is not stale: each carrier still names it.
    expect(Object.keys(CARRIERS).filter(path => !naming.includes(path))).toEqual([])
  })

  it('no prescription, score, progression or Coach code is among them', () => {
    const readers = /ai-periodization|prescription|progression|scor|coach|prompt|autoreg|expected-rpe|1rm|recovery|readiness/i
    expect(naming.filter(path => readers.test(path))).toEqual([])
  })
})
