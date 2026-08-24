// Q-328: the activity delete goes through the outbox, and the two halves must stay together.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const HOOK = 'lib/hooks/use-day-entry-mutations.ts'

/**
 * One named handler's body, from its declaration to the start of the NEXT `useCallback` — so an
 * assertion here cannot accidentally be satisfied by a sibling handler further down the file.
 * (The first cut of this searched from the declaration index and matched the declaration's own
 * `useCallback(`, returning a two-word slice that failed every assertion.)
 */
function handlerBody(src: string, name: string): string {
  const decl = `const ${name} = useCallback(`
  const i = src.indexOf(decl)
  expect(i, `${name} not found — was it renamed?`).toBeGreaterThan(-1)
  const after = src.slice(i + decl.length)
  const j = after.indexOf('= useCallback(')
  return j === -1 ? after : after.slice(0, j)
}

/** Line and block comments removed, so an assertion cannot be satisfied by prose about the code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the activity delete is offline-capable', () => {
  const body = handlerBody(read(HOOK), 'handleDeleteActivity')

  // Asserted as a CALL, not a mention. The first cut of this used `toContain('softDeleteActivity…')`
  // and mutation-checking showed it passing with the call deleted — the name still appeared in the
  // comment two lines above it. A guard satisfied by its own documentation guards nothing.
  it('writes the local tombstone as PENDING, not synced', () => {
    expect(stripComments(body)).toMatch(/store\.softDeleteActivityLogPending\(/)
  })

  // The invariant, and the reason it is worth a test rather than a comment: `applyDelta` reaps a
  // tombstone with `DELETE … WHERE id = ? AND sync_status='synced'`, so a row left 'pending' with
  // no mutation behind it is never pruned and never pushed — it is stuck, invisibly, forever.
  // The two calls are only correct as a pair.
  it('queues the mutation that will move that row to synced', () => {
    const code = stripComments(body)
    expect(code).toMatch(/store\.queueMutation\(/)
    expect(code).toMatch(/domain:\s*'activity_logs'/)
    expect(code).toMatch(/deleted:\s*true/)
  })

  // CLAUDE.md: "every user-visible write needs an outbox domain — any POST reachable offline must
  // queue a mutation or visibly fail". Before Q-328 this handler reached the network first and
  // simply failed with none, which is what the local write above replaces.
  it('does not depend on the network reaching the server first', () => {
    const beforeFallback = stripComments(body.slice(0, body.indexOf('Web fallback')))
    expect(beforeFallback, 'the local path must not fetch').not.toContain('fetch(')
    expect(beforeFallback).toContain('toast.success')
  })

  // The removed method wrote sync_status='synced', which was right only for a delete the server had
  // already accepted. Nothing may reach for it again.
  it('the synced-writing local delete is gone from the store interface', () => {
    expect(read('lib/local-store/index.ts')).not.toContain('deleteActivityLog(')
    expect(read('lib/local-store/sqlite-backend.ts')).not.toContain('async deleteActivityLog')
  })
})
