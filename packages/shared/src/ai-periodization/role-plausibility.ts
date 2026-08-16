// Role ordering — which movement in a session is allowed to be the hardest-worked.
//
// The rule splits along two axes, and they deliberately behave differently
// (owner decision 2026-07-28, docs/superpowers/plans/2026-07-28-role-ordering-plausibility.md):
//
//   LOAD (this file)  — role order is ABSOLUTE. Nothing out-loads the session's anchor lift.
//                       A lagging muscle needs more volume, never a heavier bar; loading an
//                       isolation movement above the main compound is just a worse main lift.
//   VOLUME (sets)     — role order YIELDS to weekly need. See applyRoleSetPlausibility in
//                       time-budget.ts, which lives there because it needs that module's
//                       weekly-volume model.

// Roles in seniority order. The session's anchor is the highest role actually PRESENT — a
// session may legitimately have no primary (owner-confirmed program design), so this returns
// null rather than defaulting to 'primary': inventing an anchor would cap every exercise
// against a movement the session doesn't contain.
const ROLE_SENIORITY = ['primary', 'secondary', 'accessory']

export function sessionAnchorRole(roles: string[]): string | null {
  return ROLE_SENIORITY.find(r => roles.includes(r)) ?? null
}

// Ceiling on sets an exercise may carry, by role. The AI's own prescription is the intended
// shape of the session; a longer budget should deepen it, not turn an accessory into a main
// lift. Roles differ because the useful marginal set differs: a primary compound tolerates
// more working sets than an isolation movement.
//
// This ceiling is ABSOLUTE — unlike the anchor-set cap, it has no lagging-muscle exception
// ("an accessory may exceed the primary's count, but never its own ceiling"), which is why it
// is safe to enforce on read where weekly-volume data isn't available.
const SET_CEILING: Record<string, number> = { primary: 6, secondary: 5, accessory: 4 }

export function roleCeiling(role: string): number {
  return SET_CEILING[role] ?? SET_CEILING.accessory
}

export interface RolePricedExercise {
  role: string
  pct: number
}

// Cap every non-anchor exercise at the anchor's PRESCRIBED percentage.
//
// The per-role caps in generate-prescription.ts don't achieve this: an accessory is capped at
// a flat 85 and a secondary at the primary's ZONE ceiling, so production shipped an accessory
// at 77.5% against a primary prescribed 76% — both under the 80% zone ceiling, so nothing
// bound. Capping against the anchor's actual prescription is a materially stronger rule.
//
// Takes every exercise's settled pct at once, because it cannot be folded into a per-exercise
// pricing loop: such a loop runs in list order and the anchor is not necessarily first (one
// program's primary sits second in its session), so an in-loop cap would bind on some sessions
// and silently no-op on others.
export function capLoadToAnchor<T extends RolePricedExercise>(exercises: T[]): T[] {
  const anchor = sessionAnchorRole(exercises.map(e => e.role))
  if (!anchor) return exercises
  const anchorPcts = exercises.filter(e => e.role === anchor).map(e => e.pct)
  if (anchorPcts.length === 0) return exercises
  const anchorPct = Math.max(...anchorPcts)
  return exercises.map(e =>
    e.role === anchor || e.pct <= anchorPct ? e : { ...e, pct: anchorPct },
  )
}

export interface StoredRoleCapExercise {
  sessionExerciseId: string
  sets: number
  pct: number
}

// Read-side counterpart to the generation-time role rules, for prescriptions ALREADY stored.
//
// The generation fix cannot correct rows already in the database (CLAUDE.md: "seeds don't fix
// drifted prod rows"), and a prescription lives up to 7 days. On 2026-07-28 the role-ordering
// fix shipped and the live Upper prescription — generated six days earlier — still carried an
// accessory at 5 sets @77.5% against a primary at 4 sets @76%. This is the same class of miss
// as the single-set floor, which needed exactly this treatment one PR earlier.
//
// ONLY the two ABSOLUTE rules are applied here:
//   - the per-role set ceiling, and
//   - the anchor load cap.
// The anchor SET cap is deliberately NOT applied, because its lagging-muscle exception depends
// on weekly-volume data this path doesn't have. Enforcing it here would strip sets that
// generation granted a genuinely under-target muscle on purpose — turning a correction into a
// regression. A stored set count above the anchor's is therefore left alone; only one above the
// role's own hard ceiling is a bug on its face.
//
// Returns the same array when there is nothing to correct, so it is free on the common path.
export function applyStoredRoleCaps<T extends StoredRoleCapExercise>(
  exercises: T[],
  roleById: Map<string, string>,
): T[] {
  const priced = exercises.flatMap(e => {
    const role = roleById.get(e.sessionExerciseId)
    return role ? [{ id: e.sessionExerciseId, role, pct: e.pct }] : []
  })
  const cappedPct = new Map(capLoadToAnchor(priced).map(e => [e.id, e.pct]))

  let changed = false
  const out = exercises.map(e => {
    const role = roleById.get(e.sessionExerciseId)
    if (!role) return e
    const pct = cappedPct.get(e.sessionExerciseId) ?? e.pct
    const sets = Math.min(e.sets, roleCeiling(role))
    if (pct === e.pct && sets === e.sets) return e
    changed = true
    return { ...e, pct, sets }
  })
  return changed ? out : exercises
}
