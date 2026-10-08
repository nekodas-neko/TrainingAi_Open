// `pnpm ci:local` — the local mirror of CI (issue 2144).
//
// Runs lint, check:rules, typecheck, typecheck:tests and the vitest suite, in that order, stopping
// at the first failure. The one difference from a plain `vitest run` is the two role-provisioning
// test files, which run last against a throwaway Postgres container of their own.
//
// Why: `claude_readonly` is a CLUSTER-GLOBAL role, not a per-database one. A scratch database does
// not isolate it, and a long-lived dev cluster holds grants to it in every sibling database, so
// those tests' `DROP ROLE claude_readonly` fails there ("role cannot be dropped because some
// objects depend on it"). CI gets a fresh cluster per job; this gives a local run the same.
//
// The container never touches the shared dev cluster or any database on it, and is removed in
// `finally` and on SIGINT/SIGTERM. The main suite runs against whatever DATABASE_URL is already set
// (unchanged behaviour); only the two role files get the container URL.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const ROLE_TESTS = [
  'lib/data/postgres/__tests__/claude-ro-owner-bootstrap.test.ts',
  'lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts',
]
const PORT = process.env.CI_LOCAL_PG_PORT || '5439'
const IMAGE = 'postgres:16' // same image as CI and the dev container
const NAME = `trainingai-ci-local-${randomBytes(3).toString('hex')}`

function run(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env })
  return r.status ?? 1
}
const docker = (args) => spawnSync('docker', args, { encoding: 'utf8' })

let started = false
function teardown() {
  if (!started) return
  started = false
  docker(['rm', '-f', '-v', NAME])
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { teardown(); process.exit(130) })
}

function startContainer() {
  const r = docker([
    'run', '-d', '--name', NAME, '-p', `127.0.0.1:${PORT}:5432`,
    '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=trainingai_ci',
    '--tmpfs', '/var/lib/postgresql/data', IMAGE,
  ])
  if (r.status !== 0) throw new Error(`could not start ${IMAGE} on port ${PORT}: ${r.stderr || r.error}`)
  started = true
  for (let i = 0; i < 60; i++) {
    // Probe over TCP: the image's init phase answers on the socket before the real server is up.
    if (docker(['exec', NAME, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) return
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)'])
  }
  throw new Error('throwaway Postgres never became ready')
}

function main() {
  // `node scripts/ci-local.mjs --role-tests-only` runs just the container phase, for re-checking
  // the role tests without paying for the whole suite.
  if (!process.argv.includes('--role-tests-only')) {
    for (const step of ['lint', 'check:rules', 'typecheck', 'typecheck:tests']) {
      const c = run('pnpm', [step])
      if (c) return c
    }
    const excludes = ROLE_TESTS.flatMap(f => ['--exclude', f])
    const suite = run('pnpm', ['exec', 'vitest', 'run', ...excludes])
    if (suite) return suite
  }

  console.log(`\n[ci:local] role tests: starting throwaway ${IMAGE} "${NAME}" on port ${PORT}`)
  startContainer()
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:postgres@localhost:${PORT}/trainingai_ci`,
    DATABASE_SSL: 'false',
  }
  const migrated = run('node', ['scripts/local-db/migrate.js'], env)
  if (migrated) return migrated
  return run('pnpm', ['exec', 'vitest', 'run', '--no-file-parallelism', ...ROLE_TESTS], env)
}

let code = 1
try {
  code = main()
} catch (e) {
  console.error(`[ci:local] ${e instanceof Error ? e.message : e}`)
} finally {
  teardown()
}
process.exit(code)
