// #3748 — the workout recap is a rule over the session's facts, not a model's sentences.
//
// The first half holds one test per branch of the rule. The second half holds what `PROSE_GUARDS`
// used to ask of the model, now as properties of the function, checked over every combination of
// fact patterns rather than a few picked examples.
import { describe, it, expect } from 'vitest'
import type { RecapFacts } from '@trainingai/shared/workout/session-recap'
import {
  recapText, recapStandout,
  RECAP_DURATION_OFF_USUAL_PCT, RECAP_EFFORT_CLIMB_RPE, RECAP_REST_LONG_PCT, RECAP_REST_SHORT_PCT,
} from '@trainingai/shared/workout/recap-text'

// An unremarkable session: every fact present, none past a threshold.
const facts = (over: Partial<RecapFacts> = {}): RecapFacts => ({
  durationMin: 52,
  durationVsMedianPct: 4,
  totalVolumeKg: 8200,
  prCount: 0,
  rpeDrift: 0.5,
  restAdherencePct: 100,
  sessionRpe: 7,
  ...over,
})

describe('what stood out — fixed order, first match wins', () => {
  it('new personal records lead, ahead of everything else', () => {
    const f = facts({ prCount: 2, durationVsMedianPct: 40, rpeDrift: 3, restAdherencePct: 200 })
    expect(recapStandout(f)).toBe('records')
    expect(recapText(f)).toMatch(/^You set 2 new personal records this session\./)
  })

  it('one record is singular', () => {
    expect(recapText(facts({ prCount: 1 }))).toMatch(/^You set 1 new personal record this session\./)
  })

  it('a session well over the usual leads when there are no records', () => {
    const f = facts({ durationMin: 65, durationVsMedianPct: 30, rpeDrift: 3, restAdherencePct: 200 })
    expect(recapStandout(f)).toBe('duration')
    expect(recapText(f)).toMatch(/^This session ran 65 min, 30% longer than your usual for it\./)
  })

  it('a session well under the usual leads the same way', () => {
    const f = facts({ durationMin: 35, durationVsMedianPct: -28 })
    expect(recapText(f)).toMatch(/^This session ran 35 min, 28% shorter than your usual for it\./)
  })

  it('effort climbing across sets leads when the duration is ordinary', () => {
    const f = facts({ rpeDrift: 1.8, restAdherencePct: 200 })
    expect(recapStandout(f)).toBe('effort')
    expect(recapText(f)).toMatch(
      /^Your effort climbed across sets, by 1\.8 RPE on average from the first set of an exercise to the last\./,
    )
  })

  it('long rests lead when nothing above matched', () => {
    const f = facts({ restAdherencePct: 140 })
    expect(recapStandout(f)).toBe('rest')
    expect(recapText(f)).toMatch(/^You rested longer than planned, at 140% of the planned rest time\./)
  })

  it('short rests lead the same way', () => {
    expect(recapText(facts({ restAdherencePct: 60 })))
      .toMatch(/^You rested less than planned, at 60% of the planned rest time\./)
  })

  it('otherwise the recap is the neutral line: duration and volume', () => {
    const f = facts()
    expect(recapStandout(f)).toBe('neutral')
    expect(recapText(f)).toBe('You trained for 52 min and moved 8,200 kg in total, at a session RPE of 7.')
  })
})

describe('the thresholds are the named constants, inclusive', () => {
  it('duration', () => {
    const at = RECAP_DURATION_OFF_USUAL_PCT
    expect(recapStandout(facts({ durationVsMedianPct: at - 1 }))).toBe('neutral')
    expect(recapStandout(facts({ durationVsMedianPct: at }))).toBe('duration')
    expect(recapStandout(facts({ durationVsMedianPct: -at }))).toBe('duration')
  })

  it('effort', () => {
    expect(recapStandout(facts({ rpeDrift: RECAP_EFFORT_CLIMB_RPE - 0.1 }))).toBe('neutral')
    expect(recapStandout(facts({ rpeDrift: RECAP_EFFORT_CLIMB_RPE }))).toBe('effort')
    // Effort that FELL across sets is not the thing this branch is about.
    expect(recapStandout(facts({ rpeDrift: -RECAP_EFFORT_CLIMB_RPE }))).toBe('neutral')
  })

  it('rest', () => {
    expect(recapStandout(facts({ restAdherencePct: RECAP_REST_LONG_PCT - 1 }))).toBe('neutral')
    expect(recapStandout(facts({ restAdherencePct: RECAP_REST_LONG_PCT }))).toBe('rest')
    expect(recapStandout(facts({ restAdherencePct: RECAP_REST_SHORT_PCT + 1 }))).toBe('neutral')
    expect(recapStandout(facts({ restAdherencePct: RECAP_REST_SHORT_PCT }))).toBe('rest')
  })
})

describe('the figures sentence', () => {
  it('follows a standout that is not the neutral line', () => {
    expect(recapText(facts({ prCount: 1 }))).toBe(
      'You set 1 new personal record this session. You trained for 52 min and moved 8,200 kg in total, at a session RPE of 7.',
    )
  })

  it('does not repeat the duration after the duration sentence', () => {
    expect(recapText(facts({ durationMin: 35, durationVsMedianPct: -28 }))).toBe(
      'This session ran 35 min, 28% shorter than your usual for it. You moved 8,200 kg in total, at a session RPE of 7.',
    )
  })

  it('leaves out a duration the session does not have', () => {
    expect(recapText(facts({ durationMin: null, durationVsMedianPct: null, sessionRpe: null })))
      .toBe('You moved 8,200 kg in total.')
  })

  it('leaves out a volume of zero rather than writing "0 kg"', () => {
    expect(recapText(facts({ totalVolumeKg: 0, sessionRpe: null }))).toBe('You trained for 52 min.')
  })

  it('still says something when only the effort rating exists', () => {
    expect(recapText(facts({ durationMin: null, durationVsMedianPct: null, totalVolumeKg: 0 })))
      .toBe('You rated the session at RPE 7.')
  })

  it('is never empty, even with no facts at all', () => {
    const none: RecapFacts = {
      durationMin: null, durationVsMedianPct: null, totalVolumeKg: 0, prCount: 0,
      rpeDrift: null, restAdherencePct: null, sessionRpe: null,
    }
    expect(recapText(none)).toBe('This session has no duration or volume recorded.')
  })
})

describe('one thing to watch next session', () => {
  it('is absent when nothing is past a threshold', () => {
    expect(recapText(facts())).not.toContain('Next session')
    expect(recapText(facts({ prCount: 3 }))).not.toContain('Next session')
  })

  it('is absent for a short session: there is nothing in the facts to watch', () => {
    expect(recapText(facts({ durationMin: 35, durationVsMedianPct: -28 }))).not.toContain('Next session')
  })

  it('names climbing effort, with its number, when something else led', () => {
    expect(recapText(facts({ prCount: 1, rpeDrift: 2 }))).toMatch(
      / Next session, watch your effort across sets: it climbed by 2 RPE on average from the first set of an exercise to the last\.$/,
    )
  })

  it('does not repeat the number when effort already led', () => {
    expect(recapText(facts({ rpeDrift: 2 })))
      .toMatch(/ Next session, watch whether the last sets still feel that much harder than the first\.$/)
  })

  it('names rest off the plan when effort is steady', () => {
    expect(recapText(facts({ prCount: 1, restAdherencePct: 140 })))
      .toMatch(/ Next session, watch the rest timer: your rests ran at 140% of the planned time\.$/)
    expect(recapText(facts({ restAdherencePct: 60 })))
      .toMatch(/ Next session, watch the rest timer between sets\.$/)
  })

  it('names a long session last', () => {
    expect(recapText(facts({ prCount: 1, durationMin: 65, durationVsMedianPct: 30 })))
      .toMatch(/ Next session, watch the clock: this one ran 30% longer than your usual for it\.$/)
    expect(recapText(facts({ durationMin: 65, durationVsMedianPct: 30 })))
      .toMatch(/ Next session, watch where the extra time goes\.$/)
  })

  it('picks effort over rest over duration when several apply', () => {
    const all = facts({ prCount: 1, durationMin: 65, durationVsMedianPct: 30, rpeDrift: 2, restAdherencePct: 140 })
    expect(recapText(all)).toContain('watch your effort across sets')
    expect(recapText({ ...all, rpeDrift: 0 })).toContain('watch the rest timer')
  })
})

// ── The properties, over every combination of fact patterns ────────────────────────────────────

const GRID: RecapFacts[] = []
for (const durationMin of [null, 38, 71]) {
  for (const durationVsMedianPct of durationMin == null ? [null] : [null, -35, -20, 3, 20, 46]) {
    for (const totalVolumeKg of [0, 940, 12450]) {
      for (const prCount of [0, 1, 4]) {
        for (const rpeDrift of [null, -2, 0.3, 1.5, 2.7]) {
          for (const restAdherencePct of [null, 55, 75, 98, 125, 180]) {
            for (const sessionRpe of [null, 6, 9.5]) {
              GRID.push({ durationMin, durationVsMedianPct, totalVolumeKg, prCount, rpeDrift, restAdherencePct, sessionRpe })
            }
          }
        }
      }
    }
  }
}

const numbersIn = (text: string) =>
  (text.replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number)

describe('properties that hold for every recap', () => {
  it('covers every branch of the rule', () => {
    expect(new Set(GRID.map(recapStandout))).toEqual(new Set(['records', 'duration', 'effort', 'rest', 'neutral']))
  })

  it('states no number that is not in the facts', () => {
    for (const f of GRID) {
      const allowed = new Set(
        Object.values(f).filter((v): v is number => typeof v === 'number').map(v => Math.abs(v)),
      )
      for (const n of numbersIn(recapText(f))) {
        expect(allowed.has(n), `${n} in "${recapText(f)}" for ${JSON.stringify(f)}`).toBe(true)
      }
    }
  })

  it('gives the same text for the same facts', () => {
    for (const f of GRID) expect(recapText({ ...f })).toBe(recapText(f))
  })

  it('is one to three sentences', () => {
    for (const f of GRID) {
      // A full stop that ends a sentence is followed by a space or the end; "1.5" is neither.
      const count = (recapText(f).match(/\.(?= |$)/g) ?? []).length
      expect(count, recapText(f)).toBeGreaterThanOrEqual(1)
      expect(count, recapText(f)).toBeLessThanOrEqual(3)
    }
  })

  it('speaks to the reader, in the second person', () => {
    for (const f of GRID) {
      const text = recapText(f)
      if (text !== 'This session has no duration or volume recorded.') expect(text).toMatch(/\b[Yy]ou(r)?\b/)
      expect(text).not.toMatch(/\b(I|we|the user|the athlete)\b/)
    }
  })

  it('uses no superlatives', () => {
    for (const f of GRID) {
      expect(recapText(f)).not.toMatch(
        /\b(best|worst|perfect|record-breaking|great|amazing|excellent|incredible|outstanding|impressive|fantastic|awesome|superb|optimal)\b/i,
      )
    }
  })

  it('uses metric units only', () => {
    for (const f of GRID) expect(recapText(f)).not.toMatch(/\b(lbs?|pounds?|miles?|feet|ft|inch(es)?|oz)\b/i)
  })

  it('uses no medical or diagnostic language', () => {
    for (const f of GRID) {
      expect(recapText(f)).not.toMatch(
        /\b(injur\w*|pain|strain\w*|overtrain\w*|fatigue\w*|exhaust\w*|ill(ness)?|sick|infect\w*|symptom\w*|diagnos\w*|recover\w*|risk\w*|danger\w*|doctor|medical)\b/i,
      )
    }
  })
})
