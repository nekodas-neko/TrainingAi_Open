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
import { describe, it, expect, afterAll, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import guardSetup, { mayInstallHook } from '../vitest-catalogue-leak-guard'

const canRun = !!process.env.DATABASE_URL
const ROOT = path.resolve(__dirname, '../..')
const TAG = randomUUID().slice(0, 8)
const names: string[] = []

const DIR = path.join(ROOT, 'scripts/__fixtures__/leak-guard')
const files: string[] = []

/** A one-test fixture that inserts one library row, holds it `holdMs`, and removes it unless it is to leak. */
function writeFixture(leak: boolean, holdMs: number, ownAppName = false, resetTags = false): { file: string; name: string } {
  const name = `Guard Probe ${TAG} ${names.length}`
  names.push(name)
  const file = `leak-${TAG}-${names.length}.fixture.ts`
  fs.writeFileSync(path.join(DIR, file), `import { it, expect } from 'vitest'
import { Client } from 'pg'

it('makes a library row and holds it', async () => {
  ${ownAppName ? "process.env.PGAPPNAME = 'a-test-that-names-its-own-connections'" : ''}
  const c = new Client({ connectionString: process.env.DATABASE_URL${resetTags ? ", application_name: 'resets-its-own-tags', options: '-c vitest.run_tag=somebody-else'" : ''} })
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

// File level, not inside one describe: the cases in the later blocks leave rows too, and a hook in the first
// block ran before them, so the outer run's own guard found their rows at its end (shard 4 of #4157).
afterAll(async () => {
  if (!canRun) return
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try { await c.query('DELETE FROM exercise_library WHERE name = ANY($1)', [names]) } finally { await c.end() }
  for (const f of files) fs.rmSync(path.join(DIR, f), { force: true })
})

describe.skipIf(!canRun)('the catalogue leak guard, in real runs (#4109)', () => {
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

describe.skipIf(!canRun)('a leak by a connection that carries no run tag (#4157)', () => {
  // Registered runs here are the alone-vs-beside cases; the outer `pnpm test` run may be live too, so each case
  // starts its inner runs and reads only their own output.
  it('is caught when it is the only run registered (a clean-env child, or a connection that resets its tags)', async () => {
    const leak = writeFixture(true, 300, false, true)
    // Its own scope: the outer test run is registered under the shared keys, and this case needs a run that is alone.
    const r = await run(leak.file, { LEAK_GUARD_SCOPE: `alone${TAG}` })
    expect(r.code).toBe(1)
    expect(r.out).toContain(JSON.stringify(leak.name))
    expect(r.out).toContain(leak.file)
  }, 60_000)

  it('beside another run it is nobody\'s, and the run that ends alone still reports it', async () => {
    const scope = { LEAK_GUARD_SCOPE: `beside${TAG}` }
    const other = run('idle', { IDLE_MS: '4000', ...scope })
    await sleep(1500)
    const leak = writeFixture(true, 300, false, true)
    const leaking = await run(leak.file, scope)
    const last = await other
    expect(leaking.code).toBe(0) // two runs alive: attribution applies, and an untagged row is nobody's (the documented gap)
    expect(last.code).toBe(1) // ...but it is not lost: the run that ends alone flags every surviving new row
    expect(last.out).toContain(JSON.stringify(leak.name))
  }, 60_000)
})

describe('mayInstallHook: the guard runs DDL only on a local or test database (#4157)', () => {
  const yes = [
    'postgresql://u:p@localhost:5432/app',
    'postgresql://u:p@127.0.0.1:5433/app',
    'postgresql://u:p@[::1]:5432/app',
    'postgresql://u:p@/app?host=/tmp&port=5433',
    'postgresql://u:p@db.example.invalid:5432/app_test',
    'postgresql://u:p@db.example.invalid:5432/TestDb',
  ]
  const no = [
    'postgresql://u:p@db.example.invalid:5432/app',
    'postgresql://u:p@10.0.0.5:5432/app',
    'postgresql://u:p@localhost.example.invalid:5432/app',
    'postgresql://u:p@db.example.invalid/app?host=db.example.invalid',
    'not a url',
    'mysql://u:p@localhost/app',
  ]
  it.each(yes)('installs on %s', url => { expect(mayInstallHook(url)).toBe(true) })
  it.each(no)('does not install on %s', url => { expect(mayInstallHook(url)).toBe(false) })
})

describe.skipIf(!canRun)('the guard on a database that is not local or test: nothing is installed (#4157)', () => {
  it('sends no DDL, takes no lock, warns, tags nothing, and still compares by snapshot', async () => {
    const real = new URL(process.env.DATABASE_URL as string)
    if (/test/i.test(decodeURIComponent(real.pathname.slice(1)))) return // a test-named database counts as safe; the case needs a non-test name
    const port = real.searchParams.get('port') ?? (real.port || '5432')
    // 0.0.0.0 reaches the local server on Linux but is none of the hosts the guard trusts.
    const url = `postgresql://${real.username}:${real.password}@0.0.0.0:${port}${real.pathname}`
    expect(mayInstallHook(url)).toBe(false)

    // The outer run has its own hook on this database, so absence cannot be read from the catalogue: read what the
    // guard SENDS instead.
    const sent: string[] = []
    const origQuery = Client.prototype.query as (...a: unknown[]) => unknown
    const spy = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client, ...args: unknown[]) {
      const q = args[0]
      sent.push(typeof q === 'string' ? q : (q as { text?: string })?.text ?? '')
      return origQuery.apply(this, args)
    } as never)
    const saved = { url: process.env.DATABASE_URL, app: process.env.PGAPPNAME, opts: process.env.PGOPTIONS }
    const writes: string[] = []
    const realWrite = process.stderr.write.bind(process.stderr)
    process.env.DATABASE_URL = url
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true }) as typeof process.stderr.write
    try {
      const teardown = await guardSetup()
      expect(typeof teardown).toBe('function')
      expect(process.env.PGAPPNAME).toBe(saved.app) // nothing to tag: no hook
      expect(process.env.PGOPTIONS).toBe(saved.opts)
      await (teardown as () => Promise<void>)()
    } finally {
      process.stderr.write = realWrite
      process.env.DATABASE_URL = saved.url
      spy.mockRestore()
    }
    expect(writes.join('')).toContain('not a local or test database')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.filter(q => !/^\s*SELECT\s/i.test(q))).toEqual([]) // reads only
    expect(sent.some(q => /advisory|LISTEN|CREATE|DROP/i.test(q))).toBe(false)
  }, 30_000)
})
