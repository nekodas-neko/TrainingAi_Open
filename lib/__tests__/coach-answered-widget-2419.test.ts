// #2419. The Coach's "here is the proposal" arrived after the decision. Measured on `pnpm dev`
// (2026-10-11, real Gemini, the swap flow the prompt prescribes): turn 1 renders the swap
// candidates, the user picks one, turn 2 is proposeChange with NO sentence at all (0 of 6), and once
// the user taps Apply, turn 3 opens with "Here is the proposal to swap Bench Press for Dumbbell Bench
// Press…" or "I have proposed…" (6 of 6). That sentence lands under the card the user has just
// applied, so it reads as explaining a choice already made.
//
// Not the `stopWhen: stepCountIs(6)` hypothesis: a widget tool has no `execute`, so the loop ends at
// the widget's step; in the measurement the trailing text was a separate turn, not a later step.
// Fixed in the prompt, the issue's preferred lever over reordering the thread. After the change:
// turn 3 is "Done — Push now has Dumbbell Bench Press." in 6 of 6 and "Nothing was changed." on
// cancel in 3 of 3; turn 2 writes its sentence before the card in 3 of 6 (was 0 of 6).
//
// A prompt cannot be tested behaviourally without an LLM call, so this pins the text — the same
// approach and the same reason as coach-injury-guardrail.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTE = readFileSync(join(process.cwd(), 'app/api/coach/route.ts'), 'utf8')
const SYSTEM = (() => {
  const start = ROUTE.indexOf('const SYSTEM = `')
  return ROUTE.slice(start, ROUTE.indexOf('`', start + 'const SYSTEM = `'.length))
})()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const voice = () => flat(SYSTEM.slice(SYSTEM.indexOf('## Voice')))

describe('the Coach prompt never introduces a widget the user has already answered (#2419)', () => {
  it('extracted a prompt worth asserting against', () => {
    expect(SYSTEM.length).toBeGreaterThan(2000)
    expect(SYSTEM).toMatch(/^## Voice$/m)
  })

  it('keeps the sentence before a widget called straight after another was answered', () => {
    expect(voice()).toMatch(/straight after the user answered another one/i)
  })

  it('treats an answered widget as decided: confirm "applied" or "cancelled", never describe the proposal', () => {
    expect(voice()).toMatch(/came back answered is a decision already made/i)
    expect(voice()).toMatch(/"applied", confirm what changed in one short sentence/i)
    expect(voice()).toMatch(/"cancelled", say nothing was changed/i)
    expect(voice()).toMatch(/Never write "Here is the proposal…"/)
  })
})
