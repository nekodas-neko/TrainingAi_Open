/**
 * #4109: the catalogue leak guard fails a run for the rows IT left, and only those.
 *
 * Starts real, separate `vitest` runs (scripts/__fixtures__/leak-guard) against the real database, with the
 * real guard as their global setup, and reads their exit codes and messages. A leaking run is a fixture file
 * written for the case, with its row name written into its own text (as a real test's is), so the guard can
 * name it:
 *  - a test that leaves a row fails its own run and names its file, alone and with a second run alongside;
 *  - a run that leaves nothing passes while another run holds a row of its own for a while (the case that
 *    used to fail the wrong run: 10 of 10 loops on the snapshot version of the guard).
 *
 * Real Postgres only (DATABASE_URL). Each fixture file and row name is fresh per run of this file; the files
 * are removed, and the rows the leaking runs keep are removed by name, in `afterAll`.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

const canRun = !!process.env.DATABASE_URL
const ROOT = path.resolve(__dirname, '../..')
const TAG = randomUUID().slice(0, 8)
const names: string[] = []

const DIR = path.join(ROOT, 'scripts/__fixtures__/leak-guard')
const files: string[] = []

/** A one-test fixture that inserts one library row, holds it `holdMs`, and removes it unless it is to leak. */
function writeFixture(leak: boolean, holdMs: number, ownAppName = false): { file: string; name: string } {
  const name = `Guard Probe ${TAG} ${names.length}`
  names.push(name)
  const file = `leak-${TAG}-${names.length}.fixture.ts`
  fs.writeFileSync(path.join(DIR, file), `import { it, expect } from 'vitest'
import { Client } from 'pg'

it('makes a library row and holds it', async () => {
  ${ownAppName ? "process.env.PGAPPNAME = 'a-test-that-names-its-own-connections'" : ''}
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const { rows } = await c.query("INSERT INTO exercise_library (name, equipment, muscles) VALUES ('${name}', ARRAY['barbell'], '[]'::jsonb) RETURNING id")
    await new Promise(r => setTimeout(r, ${holdMs}))
    ${leak ? '' : "await c.query('DELETE FROM exercise_library WHERE id = $1', [rows[0].id])"}
    expect(rows).toHaveLength(1)
  } finally {
    await c.end()
  }
})
`)
  files.push(file)
  return { file, name }
}

/** One inner `vitest run` of a fixture. The outer run's own vitest variables and run tag are not passed on. */
function run(filter: string, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !k.startsWith('VITEST') && k !== 'PGAPPNAME' && !(k === 'PGOPTIONS' && v?.includes('vitest.run_tag')))) as NodeJS.ProcessEnv
  return new Promise(resolve => {
    const child = spawn('pnpm', ['vitest', 'run', '--config', 'scripts/__fixtures__/leak-guard/vitest.config.ts', filter], {
      cwd: ROOT, env: { ...clean, ...env, GOOGLE_GENERATIVE_AI_API_KEY: '' } as NodeJS.ProcessEnv,
    })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('close', code => resolve({ code: code ?? -1, out }))
  })
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!canRun)('the catalogue leak guard, in real runs (#4109)', () => {
  afterAll(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL })
    await c.connect()
    try { await c.query('DELETE FROM exercise_library WHERE name = ANY($1)', [names]) } finally { await c.end() }
    for (const f of files) fs.rmSync(path.join(DIR, f), { force: true })
  })

  it('a run that leaves nothing passes', async () => {
    const r = await run(writeFixture(false, 300).file)
    expect(r.out).not.toContain('gained')
    expect(r.code).toBe(0)
  }, 60_000)

  it('a test that leaves a row fails its own run and names the file', async () => {
    const leak = writeFixture(true, 300)
    const r = await run(leak.file)
    expect(r.code).toBe(1)
    expect(r.out).toContain(JSON.stringify(leak.name))
    expect(r.out).toContain(leak.file)
  }, 60_000)

  it('a clean run is not failed for the row another run holds beside it', async () => {
    // The clean run starts first and ends while the other run still holds its row.
    const clean = run('idle', { IDLE_MS: '3500' })
    await sleep(1500)
    const other = await run(writeFixture(false, 4000).file)
    const c = await clean
    expect(c.out).not.toContain('gained')
    expect(c.code).toBe(0)
    expect(other.code).toBe(0)
  }, 60_000)

  it('with a second run alongside, the leaking run still fails naming its file, and the clean one passes', async () => {
    const leak = writeFixture(true, 1000)
    const clean = run('idle', { IDLE_MS: '4000' })
    await sleep(1500)
    const leaking = await run(leak.file)
    const c = await clean
    expect(leaking.code).toBe(1)
    expect(leaking.out).toContain(JSON.stringify(leak.name))
    expect(leaking.out).toContain(leak.file)
    expect(c.out).not.toContain('gained')
    expect(c.code).toBe(0)
  }, 60_000)

  it('a test that sets its own application_name (as the #4007 pool test does) is still caught', async () => {
    const leak = writeFixture(true, 300, true)
    const r = await run(leak.file)
    expect(r.code).toBe(1)
    expect(r.out).toContain(JSON.stringify(leak.name))
  }, 60_000)

  it('two leaking runs each name only their own row', async () => {
    const a = writeFixture(true, 3000)
    const b = writeFixture(true, 3000)
    const [ra, rb] = await Promise.all([run(a.file), run(b.file)])
    expect(ra.code).toBe(1)
    expect(rb.code).toBe(1)
    expect(ra.out).toContain(JSON.stringify(a.name))
    expect(ra.out).not.toContain(JSON.stringify(b.name))
    expect(rb.out).toContain(JSON.stringify(b.name))
    expect(rb.out).not.toContain(JSON.stringify(a.name))
  }, 60_000)
})
