// LA-166: editing or deleting logged work goes through the outbox, like the activity delete.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const HOOK = 'lib/hooks/use-day-entry-mutations.ts'

/**
 * One named handler's body, from its declaration to the start of the NEXT `useCallback`.
 * Same helper as `activity-delete-outbox.test.ts`, for the same reason: without the bound, an
 * assertion here is satisfiable by a sibling handler further down the file — and all four
 * handlers in this hook now contain the same call names.
 */
function handlerBody(src: string, name: string): string {
  const decl = `const ${name} = useCallback(`
  const i = src.indexOf(decl)
  expect(i, `${name} not found — was it renamed?`).toBeGreaterThan(-1)
  const after = src.slice(i + decl.length)
  const j = after.indexOf('= useCallback(')
  return j === -1 ? after : after.slice(0, j)
}

/**
 * Each handler's local write, its outbox domain, and the payload key the server's Zod schema
 * requires. A wrong key is rejected at push time and dead-letters after the client's bounded
 * retries — offline, with no screen to report it on.
 */
const CASES = [
  {
    handler: 'handleEditSave',
    localWrite: /store\.updateExerciseLogLocally\([^)]*\{\s*pending:\s*true\s*\}\s*\)/,
    domain: 'exercise_log_edit',
    payloadKeys: ['exerciseLogId', 'weights', 'reps'],
  },
  {
    handler: 'handleDeleteExercise',
    localWrite: /store\.deleteExerciseLogLocally\([^)]*\{\s*pending:\s*true\s*\}\s*\)/,
    domain: 'exercise_log_delete',
    payloadKeys: ['exerciseLogId'],
  },
  {
    handler: 'handleDeleteSession',
    localWrite: /store\.deleteWorkoutSessionLocally\([^)]*\{\s*pending:\s*true\s*\}\s*\)/,
    domain: 'workout_session_delete',
    payloadKeys: ['workoutSessionId'],
  },
] as const

describe('LA-166 — logged-work edits and deletes survive being offline', () => {
  const src = read(HOOK)

  for (const c of CASES) {
    describe(c.handler, () => {
      const body = () => stripComments(handlerBody(src, c.handler))

      /**
       * `pending`, not the default `synced`. A row left synced is one a pull may clobber before
       * the push lands; `applyDelta` also reaps a synced tombstone, so the delete would undo
       * itself. Asserted as a CALL with the flag, because the name alone appears in prose above it.
       */
      it('writes locally in pending mode', () => {
        expect(body()).toMatch(c.localWrite)
      })

      it(`queues ${c.domain} with the keys its schema requires`, () => {
        const code = body()
        expect(code).toMatch(new RegExp(`domain:\\s*'${c.domain}'`))
        for (const key of c.payloadKeys) {
          expect(code, `${c.domain} payload needs ${key}`).toMatch(new RegExp(`${key}\\s*[:,}]`))
        }
      })

      /**
       * The defect itself: all three used to `fetch` first and mirror only after a 2xx, so offline
       * they toasted "Updated"/"Deleted", then "Failed to …", and queued nothing.
       */
      it('does not reach the network before reporting success', () => {
        const b = handlerBody(src, c.handler)
        const cut = b.indexOf('Web fallback')
        expect(cut, 'the local path must be fenced off by the web fallback comment').toBeGreaterThan(-1)
        const local = stripComments(b.slice(0, cut))
        expect(local, 'the local path must not fetch').not.toContain('fetch(')
        expect(local).toContain('toast.success')
      })

      // Without this the queued row sits until something else triggers a push, so the edit does
      // not reach the server on reconnect — which is half of what this entry is for.
      it('pushes and revalidates once the write is local', () => {
        expect(body()).toMatch(/pushThenRevalidate\(/)
      })
    })
  }

  it('the payload keys match the schemas the push handler parses', () => {
    // Pinned against the source of truth rather than restated: these schemas are `.strict()`, so
    // an extra or renamed key is a push-time rejection, not a silent no-op.
    const edits = read('lib/workout/exercise-log-edits.ts')
    expect(edits).toMatch(/ExerciseLogEditSchema = z\.object\(\{[^}]*exerciseLogId[^}]*weights[^}]*reps/s)
    expect(edits).toMatch(/ExerciseLogDeleteSchema = z\.object\(\{\s*exerciseLogId/)
    expect(read('lib/workout/delete-session-reconcile.ts'))
      .toMatch(/WorkoutSessionDeleteSchema = z\.object\(\{\s*workoutSessionId/)
  })
})
