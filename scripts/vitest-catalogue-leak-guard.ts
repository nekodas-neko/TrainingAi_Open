/**
 * Fail a test run that leaves rows behind in the shared `exercise_library` (#4055).
 *
 * #4038 and #4053 each left rows in a table every other DB test reads, and the second one passed the
 * static rule (scripts/check-test-exercise-library-cleanup.js) because the test renamed its rows and
 * then deleted by the old names. Only a look at the table itself catches that.
 *
 * Per RUN, not per file: vitest runs files in parallel workers against one database, so a file
 * cannot be told apart from its neighbours' writes mid-run, and serialising DB files to get that
 * would make the suite meaningfully slower. The check is a global setup: snapshot before, compare
 * after. The comparison is against the snapshot, never a fixed number, so a database that already
 * held leftovers before the run does not fail it. Nothing is deleted: a silent cleanup would hide
 * the bug.
 *
 * Silent (no snapshot, no failure) when DATABASE_URL is unset, the database is unreachable, or the
 * table is absent, and in watch mode, where "after" has no end.
 */
import { Client } from 'pg'
import fs from 'node:fs'
import path from 'node:path'

export type LibraryRow = { id: string; name: string }

/** Rows present now that were not in the snapshot, by id, so a renamed row still counts. */
export function leftoverRows(before: LibraryRow[], after: LibraryRow[]): LibraryRow[] {
  const known = new Set(before.map(r => r.id))
  return after.filter(r => !known.has(r.id)).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Test files that mention a leftover name, as a lead only: a renamed row's name will not be in the
 * file that made it, which is why this is "likely" and the run-level failure is the guarantee.
 */
export function likelyFiles(names: string[], root: string): string[] {
  const hits = new Set<string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!['node_modules', '.next', '.git', 'mobile', 'android', 'ios'].includes(e.name)) walk(path.join(dir, e.name))
      } else if (/\.test\.(ts|tsx)$/.test(e.name)) {
        const text = fs.readFileSync(path.join(dir, e.name), 'utf8')
        if (names.some(n => n.length >= 4 && text.includes(n))) hits.add(path.relative(root, path.join(dir, e.name)))
      }
    }
  }
  try { walk(root) } catch { /* a lead only */ }
  return [...hits].sort()
}

export function describeLeak(leftover: LibraryRow[], files: string[]): string {
  const lines = [
    `exercise_library gained ${leftover.length} row(s) during this test run and kept them (#4055):`,
    ...leftover.slice(0, 50).map(r => `  - ${JSON.stringify(r.name)} (${r.id})`),
    ...(leftover.length > 50 ? [`  ... and ${leftover.length - 50} more`] : []),
    files.length ? `Test files that mention these names: ${files.join(', ')}` : 'No test file mentions these names — the test probably renamed its rows.',
    'Delete by the ids the test created, in an afterAll that runs on failure; the cleanup is not done for you.',
  ]
  return lines.join('\n')
}

async function snapshot(url: string): Promise<LibraryRow[] | null> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 })
  client.on('error', () => {})
  try {
    await client.connect()
    const { rows } = await client.query<LibraryRow>('SELECT id, name FROM exercise_library')
    return rows
  } catch {
    return null
  } finally {
    await client.end().catch(() => {})
  }
}

export default async function setup(project?: { vitest?: { config?: { watch?: boolean } } }) {
  const url = process.env.DATABASE_URL
  if (!url || project?.vitest?.config?.watch) return
  const before = await snapshot(url)
  if (!before) return
  return async () => {
    const after = await snapshot(url)
    if (!after) return
    const leftover = leftoverRows(before, after)
    if (leftover.length === 0) return
    // Not a throw: vitest reports an error from a global teardown as "error during close" and still
    // exits 0 (measured on 4.1.11), which is the one outcome this check exists to prevent.
    process.stderr.write(`\n${describeLeak(leftover, likelyFiles(leftover.map(r => r.name), process.cwd()))}\n\n`)
    process.exitCode = 1
  }
}
