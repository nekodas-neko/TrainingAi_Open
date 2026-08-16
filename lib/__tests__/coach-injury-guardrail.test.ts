// Q-227. The owner asked Coach a diagnostic question — "Im getting lower back pain from some of my
// excercises what donyou think it is?" — and got back nothing but a "Log Lower Back Injury" card with
// Severity: mild. No prose, no questions, and a severity they had never mentioned.
//
// Two separate faults. The prompt had a "propose only when asked" guardrail for `early_deload` and
// another for `program_phase`, and none for `injury`, so a bare mention of pain was enough to fire a
// write proposal. And `severity` is a free-choice field in ChangePreviewSchema, so the model filled
// it from nothing — which the prompt's own "## Honesty" rule forbids, since it is neither a tool
// result nor something the user said.
//
// A prompt is not unit-testable behaviourally without spending an LLM call, so this pins the text.
// That is worth doing precisely because it is easy to delete: the guardrail is prose in a template
// literal, and nothing else in the build would notice it going missing. The behavioural half of the
// fix — the confirmation screen naming the severity it will assume — is tested against the domain in
// lib/data/postgres/__tests__/coach-domains.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTE = readFileSync(join(process.cwd(), 'app/api/coach/route.ts'), 'utf8')

// Only the prompt, so a stray mention of "injury" elsewhere in the file cannot satisfy these.
const SYSTEM = (() => {
  const start = ROUTE.indexOf('const SYSTEM = `')
  const end = ROUTE.indexOf('`', start + 'const SYSTEM = `'.length)
  return ROUTE.slice(start, end)
})()

// The prompt is hard-wrapped prose, so a phrase can straddle a line break. Matching against the raw
// text would make these assertions depend on where the wrap happens to fall — a reflow would fail
// them while the instruction was still there, which is a worse test than none.
const flat = (s: string) => s.replace(/\s+/g, ' ')
const painSection = () => flat(SYSTEM.slice(SYSTEM.indexOf('## Pain and injuries')))

describe('the Coach system prompt guards the injury domain (Q-227)', () => {
  it('extracted a prompt worth asserting against', () => {
    // Without this the slice could silently be empty and every case below would pass on absence.
    expect(SYSTEM.length).toBeGreaterThan(2000)
    expect(SYSTEM).toContain('## Deloads')
  })

  it('has a pain/injury section at all', () => {
    expect(SYSTEM).toMatch(/^## Pain and injuries$/m)
  })

  it('tells the model that reporting pain is not a request to log an injury', () => {
    expect(painSection()).toMatch(/not asking you to log an injury/i)
  })

  it('tells it to ask which exercise and what the pain is like before proposing', () => {
    expect(painSection()).toMatch(/which exercise/i)
    expect(painSection()).toMatch(/sharp or dull/i)
  })

  // The exact failure the owner saw: the card arrived in the same turn as the first mention of pain.
  it('forbids proposing in the same turn as the first mention of pain', () => {
    expect(painSection()).toMatch(/same turn as the first mention of pain/i)
  })

  it('forbids inventing a severity, and says to omit the field instead', () => {
    expect(painSection()).toMatch(/never invent a severity/i)
    expect(painSection()).toMatch(/leave the field out/i)
  })

  // The deload guardrail is the pattern this one copies. If that one is ever removed, this test
  // should fail too rather than leave the injury rule looking like a one-off.
  it('still carries the deload guardrail it was modelled on', () => {
    expect(flat(SYSTEM)).toMatch(/Propose it only when they ask for it or clearly describe needing one/)
  })
})
