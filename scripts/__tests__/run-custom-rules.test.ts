import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

/**
 * Q-206: the local gate under-ran the Custom Rules job and reported clean. The failure that
 * matters is silent under-coverage — a runner that executes a subset and says "pass" is worse
 * than one that runs nothing. These tests pin the runner's step list to the workflow's, so
 * dropping or filtering steps fails here instead of on someone's next PR.
 */
const repoRoot = path.resolve(__dirname, '..', '..')

function workflowStepNames(): string[] {
  const doc = load(
    readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
  ) as { jobs: Record<string, { name?: string; steps?: { name?: string; run?: string }[] }> }
  const job = Object.values(doc.jobs).find((j) => j.name === 'Custom Rules')
  if (!job) throw new Error('no job named "Custom Rules" in ci.yml')
  return (job.steps ?? []).filter((s) => typeof s.run === 'string').map((s, i) => s.name ?? `step ${i + 1}`)
}

describe('scripts/run-custom-rules.js', () => {
  it('enumerates every run-step of the Custom Rules job, in order', () => {
    const listed = execFileSync('node', ['scripts/run-custom-rules.js', '--list'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')

    const expected = workflowStepNames()
    expect(expected.length).toBeGreaterThan(20)
    expect(listed).toEqual(expected)
  })

  it('is the gate `pnpm ci:local` runs, not a subset of check scripts', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.scripts['check:rules']).toContain('scripts/run-custom-rules.js')
    expect(pkg.scripts['ci:local']).toContain('check:rules')
  })
})
