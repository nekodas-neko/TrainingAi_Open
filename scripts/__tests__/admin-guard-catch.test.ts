/**
 * The guard on the guard (Q-548).
 *
 * `check-admin-guard-catch.js` passed clean for weeks while **twelve live sites** carried the exact
 * defect it names. Its detector was one regex requiring the try's closing brace on the line right
 * after the call, and two ordinary shapes slipped through it — between them, every offender left in
 * the codebase. A check that cannot see most of its own class is worse than no check, because the
 * green tick is read as evidence.
 *
 * So the blind spots are pinned here as cases. If the detector is ever narrowed back toward a
 * pattern match, these fail.
 */
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { offendersIn } = require('../check-admin-guard-catch.js') as { offendersIn: (s: string) => number[] }

describe('check-admin-guard-catch detects every shape of a reason-swallowing catch', () => {
  it('catches the plain one it always caught', () => {
    expect(offendersIn(`
      try {
        await requireAdmin(id, claim)
      } catch {
        return json({ error: 'Forbidden' }, { status: 403 })
      }
    `)).toHaveLength(1)
  })

  it('catches one whose call ends in a SEMICOLON', () => {
    // Blind spot 1. `await requireAdmin(a, b);` puts a `;` between `)` and the newline, which the
    // old `\\s*` could not cross — purely stylistic, and it disabled the check for nine sites.
    expect(offendersIn(`
      try {
        await requireAdmin(id, claim);
      } catch {
        return json({ error: 'Forbidden' }, { status: 403 });
      }
    `)).toHaveLength(1)
  })

  it('catches one whose try holds the real work as well', () => {
    // Blind spot 2, and the more dangerous of the two: the catch swallows a failed QUERY into 403,
    // so a database problem reads as a revoked credential on the very screens used to diagnose it.
    expect(offendersIn(`
      try {
        await requireAdmin(id, claim)
        const repo = await getRepository()
        return json(await repo.listErrorEvents(100))
      } catch {
        return json({ error: 'Forbidden' }, { status: 403 })
      }
    `)).toHaveLength(1)
  })

  it('catches one that BINDS the error and then ignores it', () => {
    // Binding is not forwarding. This shape reads as handled and is not.
    expect(offendersIn(`
      try {
        await requireAdmin(id, claim)
      } catch (err) {
        console.error(err)
        return json({ error: 'Forbidden' }, { status: 403 })
      }
    `)).toHaveLength(1)
  })

  it('accepts the fixed shape, through any of the helpers', () => {
    for (const helper of ['adminErrorResponse(err)', 'adminFailureOutcome(err)', 'adminFailureStatus(err)']) {
      expect(offendersIn(`
        try {
          await requireAdmin(id, claim);
        } catch (err) {
          return ${helper}
        }
      `), helper).toHaveLength(0)
    }
  })

  it('ignores a try that never calls requireAdmin', () => {
    // The audit-log write in `admin/db-snapshot` is a legitimate swallow — a logging failure must
    // not fail the request. A detector that flagged it would train people to ignore this check.
    expect(offendersIn(`
      try {
        await pool.query('INSERT INTO audit ...')
      } catch (err) {
        console.error('audit log write failed:', err)
      }
    `)).toHaveLength(0)
  })

  it('reports each offending try separately in a file with several', () => {
    expect(offendersIn(`
      export async function GET() {
        try { await requireAdmin(id); } catch { return forbidden() }
      }
      export async function POST() {
        try { await requireAdmin(id); } catch { return forbidden() }
      }
    `)).toHaveLength(2)
  })
})
