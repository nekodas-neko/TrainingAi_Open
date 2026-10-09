// Issue 2381 (part b): the agent key has ONE door. These hold it shut as the code grows:
//
//   · only `lib/agent-actions/guard.ts` reads `AGENT_ACTIONS_SECRET`;
//   · every route that imports the guard calls it first in each handler, and never touches the
//     session path (`@/auth`, `next-auth`, `requireAdmin` with a session id);
//   · the allow-list the schema accepts is exactly `AGENT_JOBS`, and nothing in it touches the ring,
//     the raw archive, users, money or AI generation.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_JOB_IDS, AgentActionRequest } from '../jobs'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const ROOT = path.resolve(__dirname, '../../..')
const SKIP = new Set(['node_modules', '.next', '.git', 'android', 'coverage', 'test-results', 'playwright-report', '.claude', 'docs'])

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      yield* sourceFiles(full)
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name)) {
      yield full
    }
  }
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/')
/** Comments removed, so a doc comment naming the variable is not a read. */
const code = (f: string) => stripComments(fs.readFileSync(f, 'utf8'))

const files = ['app', 'lib', 'packages', 'scripts', 'middleware.ts', 'auth.ts', 'auth.config.ts']
  .map(p => path.join(ROOT, p))
  .filter(p => fs.existsSync(p))
  .flatMap(p => (fs.statSync(p).isDirectory() ? [...sourceFiles(p)] : [p]))

describe('the agent key has one door (issue 2381)', () => {
  it('only the guard reads AGENT_ACTIONS_SECRET', () => {
    const readers = files.filter(f => /AGENT_ACTIONS_SECRET/.test(code(f))).map(rel)
    expect(readers).toEqual(['lib/agent-actions/guard.ts'])
  })

  const agentRoutes = files.filter(f => /\/route\.ts$/.test(rel(f)) && /authorizeAgentRequest/.test(code(f)))

  it('the agent routes are the ones under app/api/agent-actions', () => {
    expect(agentRoutes.map(rel)).toEqual(['app/api/agent-actions/route.ts'])
  })

  it.each(agentRoutes.map(rel))('%s calls the guard first in every handler and never the session path', (file) => {
    const src = code(path.join(ROOT, file))
    expect(src).not.toMatch(/from ['"]@\/auth['"]/)
    expect(src).not.toMatch(/next-auth/)
    expect(src).not.toMatch(/\bauth\(\)/)
    const handlers = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)[^{]*\{\s*([^\n]*)/g)]
    expect(handlers.length).toBeGreaterThan(0)
    for (const [, , firstLine] of handlers) expect(firstLine).toMatch(/authorizeAgentRequest\(req\)/)
  })

  it('the schema accepts exactly the allow-list', () => {
    const accepted = AgentActionRequest.options.map(o => o.shape.job.value).sort()
    expect(accepted).toEqual([...AGENT_JOB_IDS].sort())
  })

  it('nothing on the allow-list reaches the ring, the raw archive, users, money or AI generation', () => {
    for (const id of AGENT_JOB_IDS) {
      expect(id).not.toMatch(/key|rekey|resync|pack|null-|decoded|user|invite|delete|generate|media|feedback|vacuum|units|step/)
    }
    const jobsSrc = code(path.join(ROOT, 'lib/agent-actions/jobs.ts'))
    expect(jobsSrc).not.toMatch(/clearKey|setKey|revealKey|rekey|packSealed|backfillNullDecoded|allowStepsDecrease|deleteAccount|generateObject|generateText/)
  })
})
