import { getFramework } from './framework'
import { applyRecoveryGate, retarget, type GateAction, type RecoveryGateInputs } from './recovery-gate'
import type { FrameworkContext, Prescription } from './types'

export interface PrescribeResult {
  prescription: Prescription
  gateAction: GateAction
  gateReasons: string[]
}

export function prescribeNextRun(
  ctx: FrameworkContext,
  gateInputs: RecoveryGateInputs,
  frameworkKey: string,
): PrescribeResult {
  const ideal = getFramework(frameworkKey).nextRun(ctx)
  const gated = applyRecoveryGate(ideal, gateInputs)
  const prescription = gated.action === 'proceed' ? ideal : retarget(gated.prescription, ctx.fitness)
  return { prescription, gateAction: gated.action, gateReasons: gated.reasons }
}

// Shared marker so `GET /api/running-plan` can tell a manually-overridden row from an
// auto-generated one (without a schema migration) and stop silently recomputing over it —
// see the override route's `base.rationale` and the GET route's `isManualOverride` check.
export const OVERRIDE_RATIONALE_PREFIX = 'You picked '

/** Same gate/retarget pipeline as prescribeNextRun, but starting from a user-chosen
 *  prescription (a manually picked run type/duration) instead of the framework's own pick.
 *  The recovery gate still applies unconditionally — a user override never bypasses the
 *  interference/readiness/monotony/sleep safety checks. */
export function prescribeOverride(
  ctx: FrameworkContext,
  gateInputs: RecoveryGateInputs,
  base: Prescription,
): PrescribeResult {
  const gated = applyRecoveryGate(base, gateInputs)
  const prescription = gated.action === 'proceed' ? base : retarget(gated.prescription, ctx.fitness)
  return { prescription, gateAction: gated.action, gateReasons: gated.reasons }
}
