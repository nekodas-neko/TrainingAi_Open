// Q-291 — one AI surface contradicting another on the same day. The properties pinned here are the
// ones that make the fix safe rather than the ones that make it work: the empty case must not
// disturb a caller's cache, and the read graph must stay acyclic.
import { describe, it, expect } from 'vitest'
import { readSameDayInsights, SAME_DAY_GUIDANCE } from '../same-day-context'

const repoWith = (rows: { section: string; insight: string }[]) => ({
  listAiHealthInsightsForDate: async () => rows,
})

describe('readSameDayInsights', () => {
  // The load-bearing case. The caller appends this to the text it hashes, so a non-empty return on
  // a day with no insights would change every existing digest's context hash and regenerate a
  // cached, correct digest — a model call per user per day, bought for nothing.
  it('returns the empty string when the day holds no insight', async () => {
    expect(await readSameDayInsights(repoWith([]), 'u1', '2026-08-06')).toBe('')
  })

  it('formats what it finds under a header the prompt guidance names', async () => {
    const out = await readSameDayInsights(repoWith([
      { section: 'readiness', insight: 'Keep your planned exercise intensity low.' },
    ]), 'u1', '2026-08-06')
    expect(out).toBe('Already told the user today:\n- readiness: Keep your planned exercise intensity low.')
    // The instruction is worthless if it names a header the block does not carry.
    expect(SAME_DAY_GUIDANCE).toContain('Already told the user today')
  })

  // THE CYCLE GUARD. The digest writes its own row to this table under section 'daily-digest'. If
  // it could read that row back, its own output would enter its own context hash: regenerating
  // would change the hash, which would regenerate. Model output is not deterministic, so that does
  // not settle — it bills per iteration.
  it('excludes the digest\'s own section, so a surface cannot read itself', async () => {
    const out = await readSameDayInsights(repoWith([
      { section: 'daily-digest', insight: 'Crushing three PRs — keep that same energy tomorrow!' },
    ]), 'u1', '2026-08-06')
    expect(out).toBe('')
  })

  it('ignores a section it does not know', async () => {
    const out = await readSameDayInsights(repoWith([
      { section: 'weekly-digest', insight: 'no' },
      { section: 'sleep', insight: 'yes' },
    ]), 'u1', '2026-08-06')
    expect(out).toBe('Already told the user today:\n- sleep: yes')
  })

  // Row order reaches the caller's hash, so an unstable order regenerates an unchanged digest. The
  // adapter orders by section; this pins that the helper does not then reorder it.
  it('preserves the order it is given', async () => {
    const out = await readSameDayInsights(repoWith([
      { section: 'activity', insight: 'a' },
      { section: 'heart-rate', insight: 'b' },
      { section: 'readiness', insight: 'c' },
      { section: 'sleep', insight: 'd' },
    ]), 'u1', '2026-08-06')
    expect(out.split('\n').slice(1)).toEqual([
      '- activity: a', '- heart-rate: b', '- readiness: c', '- sleep: d',
    ])
  })

  it('trims, so a stored trailing newline cannot change the hash', async () => {
    const out = await readSameDayInsights(repoWith([
      { section: 'sleep', insight: '  slept well  \n' },
    ]), 'u1', '2026-08-06')
    expect(out).toBe('Already told the user today:\n- sleep: slept well')
  })
})

describe('SAME_DAY_GUIDANCE', () => {
  // It must permit disagreement. The later surface knows things the morning one did not, and an
  // instruction never to contradict would make it endorse advice the day has since disproved.
  it('forbids contradicting silently, not contradicting', () => {
    expect(SAME_DAY_GUIDANCE).toMatch(/without saying so/i)
    expect(SAME_DAY_GUIDANCE).not.toMatch(/never contradict|do not contradict them\./i)
  })
})
