// LA-32. Three times on 2026-08-25/26, adding an unrelated test file turned the suite red in a file
// the PR never touched: two files hardcoded the same user UUID and one DELETEd it, so under
// parallel workers on one shared database the cleanup landed inside the other's run.
//
// What is pinned here is mostly the FALSE POSITIVES. The obvious rule — "same UUID literal in two
// files, one mentions DELETE FROM users" — was measured against the real tree first and returned
// 6 hits of which only 1 was real. A check that is 83% noise is one the first person it stops will
// baseline into uselessness, so each way it can cry wolf gets a case.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findCollisions, userUuids } = require('../check-test-user-uuid-collisions.js') as {
  findCollisions: (files: [string, string][]) => { uuid: string; holders: string[]; deleters: string[] }[]
  userUuids: (text: string) => { ins: Set<string>; del: Set<string> }
}

const A = "00000000-0000-4000-8000-00000000cf01"
const seeds = (id: string) => `
  const USER_ID = '${id}'
  await pool.query(\`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'T')
     ON CONFLICT (id) DO NOTHING\`, [USER_ID, 'a@b.c'])
`
const deletes = (id: string) => `
  const OWNER = '${id}'
  await pool.query(\`DELETE FROM users WHERE id = $1\`, [OWNER])
`

describe('test-user UUID collisions', () => {
  it('flags the real shape: two files, same user id, one deletes it', () => {
    const found = findCollisions([['a.test.ts', seeds(A)], ['b.test.ts', deletes(A)]])
    expect(found.map(c => c.uuid)).toEqual([A])
    expect(found[0].deleters).toEqual(['b.test.ts'])
  })

  it('does not flag a uuid only one file uses', () => {
    expect(findCollisions([['a.test.ts', seeds(A) + deletes(A)]])).toEqual([])
  })

  it('does not flag a shared uuid when nobody deletes it', () => {
    expect(findCollisions([['a.test.ts', seeds(A)], ['b.test.ts', seeds(A)]])).toEqual([])
  })

  // FALSE POSITIVE 1, from the real tree: `...d011` is a PROGRAM id in one file, which separately
  // deletes different users. A uuid that never reaches a users statement is not a user.
  it('ignores a uuid used for another table entirely', () => {
    const programFile = `
      const STRANGER_PROGRAM = '${A}'
      const OWNER = '00000000-0000-4000-8000-0000000000a1'
      await pool.query(\`DELETE FROM users WHERE id = $1\`, [OWNER])
      await pool.query(\`DELETE FROM programs WHERE id = $1\`, [STRANGER_PROGRAM])
    `
    expect(findCollisions([['a.test.ts', seeds(A)], ['b.test.ts', programFile]])).toEqual([])
  })

  // FALSE POSITIVE 2, and the one that survived the first narrowing: a DELETE whose call closes on
  // its own line, followed by an unrelated statement carrying a uuid. `db-snapshot-integration`
  // deletes one id and on the NEXT line sets `app.claude_ro_owner` to the canonical owner — which
  // two files are supposed to agree on. A greedy tail read that as a deleted user.
  it('does not absorb a uuid from the statement AFTER the delete', () => {
    const file = `
      const userId = '00000000-0000-4000-8000-0000000000b2'
      await admin.query('DELETE FROM users WHERE id = $1', [userId])
      await admin.query(\`ALTER ROLE claude_readonly SET app.claude_ro_owner = '${A}'\`)
    `
    expect(userUuids(file).del.has(A)).toBe(false)
    expect(findCollisions([['a.test.ts', seeds(A)], ['b.test.ts', file]])).toEqual([])
  })

  it('still sees an id passed positionally on the same line', () => {
    const file = `await pool.query('DELETE FROM users WHERE id = $1', ['${A}'])`
    expect(userUuids(file).del.has(A)).toBe(true)
  })

  it('sees an id inside a multi-line parameter array', () => {
    const file = `
      const OWNER = '${A}'
      await pool.query(
        \`DELETE FROM users WHERE id = ANY($1)\`,
        [[OWNER]])
    `
    expect(userUuids(file).del.has(A)).toBe(true)
  })
})
