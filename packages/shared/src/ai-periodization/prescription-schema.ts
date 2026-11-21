import { z } from 'zod'

export const PrescriptionSchema = z.object({
  phase: z.enum(['accumulation', 'intensification', 'realisation', 'deload']),
  // No rest-day answer (#3718): whether to rest today is the app's own daily check
  // (`computeAiDynamicNextSession`), worked out on every open. A stored plan only ever describes training.
  phase_action: z.enum(['stay', 'transition_recommended', 'deload_recommended', 'session_swap_recommended']),
  exercises: z.array(z.object({
    session_exercise_id: z.string(),
    name: z.string(),
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(30),
    // 0-100 here (not 30-100): the model occasionally returns pct as a 0-1 fraction (e.g. 0.74
    // for 74%) instead of a percentage — normalized back to 30-100 right after parsing, in
    // reconcile-prescription.ts. A hard 30-100 bound here would reject that response outright
    // and 502 the whole prescription.
    pct: z.number().min(0).max(100),
    rest_sec: z.number().int().min(30).max(600),
    // An empty response is schema-valid without this — and can auto-apply (see
    // docs/superpowers/plans/2026-07-05-ai-prescription-response-reconciliation.md).
  })).min(1),
  deload: z.boolean(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
})
