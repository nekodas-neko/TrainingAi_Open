// LA-33 — the size baselines are one file per tracked doc, not one shared map.
//
// The map was the repository's most frequent merge conflict *by construction*: every PR that raises
// a number edits the same two lines, so two open PRs conflict whether or not they are about the same
// document. Measured 2026-08-26, one PR was outrun by main four times in 35 minutes and every
// conflict was in that ledger, the backlog, or the changelog — never in code.
//
// The property worth pinning is the one that makes the split worth doing at all: **two different
// docs' baselines live in two different files**. Everything else here guards the loader against
// failing quietly, because a baseline that silently fails to load is a ratchet that silently stops
// ratcheting — the file becomes unbounded and nothing says so.
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadBaselines, parseBaseline, baselinePathFor, BASELINE_DIR } =
  require('../lib/doc-size-baselines') as typeof import('../lib/doc-size-baselines')

const repoRoot = path.join(__dirname, '..', '..')

function tmpTree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-size-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body)
  }
  return dir
}

describe('baselinePathFor', () => {
  // One place decides the spelling, so the failure message and the loader can never disagree about
  // which file the author is being told to edit.
  it('mirrors the tracked path and appends .size', () => {
    expect(baselinePathFor('projectOverview.md')).toBe('docs/doc-size/projectOverview.md.size')
    expect(baselinePathFor('docs/agents/state/tuning.md'))
      .toBe('docs/doc-size/docs/agents/state/tuning.md.size')
  })

  // The whole point of the split.
  it('gives two different docs two different files', () => {
    expect(baselinePathFor('projectOverview.md')).not.toBe(baselinePathFor('docs/implementation-backlog.md'))
  })
})

describe('parseBaseline', () => {
  it('reads a plain integer, ignoring surrounding whitespace', () => {
    expect(parseBaseline('8105\n', 'x.md')).toBe(8105)
    expect(parseBaseline('  42  ', 'x.md')).toBe(42)
  })

  // Each of these would otherwise load as NaN/0 and quietly disable the ratchet for that file.
  it('throws rather than skipping on anything that is not a positive integer', () => {
    for (const bad of ['', '   ', 'notanumber', '0', '-5', '12.5', '1e3x', '1 2']) {
      expect(() => parseBaseline(bad, 'x.md'), `should reject ${JSON.stringify(bad)}`).toThrow()
    }
  })

  it('names the file it is complaining about', () => {
    expect(() => parseBaseline('nope', 'docs/implementation-backlog.md'))
      .toThrow(/docs\/doc-size\/docs\/implementation-backlog\.md\.size/)
  })
})

describe('loadBaselines', () => {
  it('maps a nested .size file back to the path it mirrors', () => {
    const dir = tmpTree({
      'projectOverview.md.size': '10\n',
      'docs/agents/state/tuning.md.size': '20\n',
    })
    expect(loadBaselines(dir)).toEqual({
      'projectOverview.md': 10,
      'docs/agents/state/tuning.md': 20,
    })
  })

  it('ignores files that are not .size', () => {
    const dir = tmpTree({ 'a.md.size': '5\n', 'README.md': 'notes', '.gitkeep': '' })
    expect(loadBaselines(dir)).toEqual({ 'a.md': 5 })
  })

  it('throws when the directory is missing rather than tracking nothing', () => {
    expect(() => loadBaselines(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now())))
      .toThrow(/is missing/)
  })

  it('is empty for an empty directory, not an error', () => {
    expect(loadBaselines(tmpTree({}))).toEqual({})
  })

  // Order-independence: a directory walk must not let filesystem ordering change the result.
  it('produces the same map regardless of read order', () => {
    const a = tmpTree({ 'z.md.size': '1\n', 'a.md.size': '2\n', 'm/n.md.size': '3\n' })
    const b = tmpTree({ 'm/n.md.size': '3\n', 'a.md.size': '2\n', 'z.md.size': '1\n' })
    expect(loadBaselines(a)).toEqual(loadBaselines(b))
  })
})

describe('the baselines actually committed', () => {
  const baselines = loadBaselines(path.join(repoRoot, BASELINE_DIR))

  it('tracks at least the orientation docs every session reads', () => {
    for (const rel of ['projectOverview.md', 'docs/implementation-backlog.md', 'CLAUDE.md']) {
      expect(Object.keys(baselines), `${rel} must stay tracked`).toContain(rel)
    }
  })

  // A baseline for a file that does not exist is a ratchet guarding nothing, and the check script
  // fails on it — this catches it at the unit level, where the message is clearer.
  it('every tracked path exists', () => {
    for (const rel of Object.keys(baselines)) {
      expect(fs.existsSync(path.join(repoRoot, rel)), `${rel} is baselined but missing`).toBe(true)
    }
  })

  it('every baseline is a positive integer', () => {
    for (const [rel, n] of Object.entries(baselines)) {
      expect(Number.isInteger(n) && n > 0, `${rel} = ${n}`).toBe(true)
    }
  })
})
