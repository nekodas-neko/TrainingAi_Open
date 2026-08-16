import type { PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'

/**
 * The prescription status a completed phase transition leaves behind.
 *
 * `'consumed'` — not `'none'` — because `isAiPrescriptionPending` keys on exactly this value, and
 * it is what drives the pre-workout "Preparing your AI workout…" state, the bounded regeneration
 * poll, and the client-side /prescribe trigger. `'none'` matched none of them, so accepting a
 * transition emptied the card with nothing left to refill it (owner report, 2026-08-02).
 *
 * `advancePhase` writes `'none'` itself as part of clearing the slot; this is written immediately
 * after, so it is the status that actually survives the transition.
 */
export const POST_TRANSITION_STATUS: PrescriptionStatus = 'consumed'
