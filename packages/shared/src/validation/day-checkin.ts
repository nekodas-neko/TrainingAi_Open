import { z } from 'zod'

const scale = () => z.number().int().min(1).max(5).nullable().optional()

// The 10 evening/morning wellness scales — shared by the web route
// (app/api/day-checkin/route.ts) and pushMutations so an out-of-range
// outbox payload can never write through unvalidated.
export const DayCheckinScalesSchema = z.object({
  physicalTiredness: scale(),
  mentalDrain:        scale(),
  barelyMoved:         scale(),
  hydration:           scale(),
  lateHeavyMeal:       scale(),
  wakeMood:            scale(),
  perceivedRecovery:   scale(),
  motivation:          scale(),
  sleepQualityFeel:    scale(),
  restingSoreness:     scale(),
})

// journal/soreMuscles bounds — shared by the web route and pushMutations
// (SYNC-P4) so an outbox payload can't write an unbounded journal string or
// non-string soreMuscles entries straight through unvalidated.
export const DayCheckinExtrasSchema = z.object({
  soreMuscles: z.array(z.string()).default([]),
  journal: z.string().max(2000).nullable().optional(),
  // Q-113: replaces `motivation`; touched flags distinguish a genuine self-report from an
  // accepted score-derived prefill on perceivedRecovery/sleepQualityFeel.
  illnessContext: z.enum(['sick', 'alcohol', 'poor_sleep']).nullable().optional(),
  perceivedRecoveryTouched: z.boolean().optional(),
  sleepQualityFeelTouched: z.boolean().optional(),
})
