// #2601 (owner 2026-10-07): `workout_hr_stats.hrr1_best` from HRR60. Pure — `recomputeHrr1Best`
// (lib/workout/recompute-hrr1-best.ts) reads, this decides, the same module writes.
//
// The session's best one-minute recovery was the max of the nearest-reading hrr1, which a ring-only
// session fills with noise (25 such sessions in production, median 23). It is now the max of the
// session's stored `set_hr_stats.hrr1_bpm` — the dense HRR60 — and null when no set has one, so
// those 25 sessions lose the value, as the owner approved. New sessions get it this way already
// (`withHrr60Recovery` feeds `summariseWorkoutHr`); this moves the stored history.
//
// Run `backfill-set-hrr1` first: this reads `hrr1_bpm`, and that is what fills it for old rows.

export interface StoredHrr1Best {
  workoutSessionId: string
  startedAt: Date
  hrr1Best: number | null
  /** The max `hrr1_bpm` over the session's live set rows; null when none has one. */
  maxSetHrr60: number | null
}

export interface Hrr1BestChange {
  workoutSessionId: string
  startedAt: Date
  before: number | null
  after: number | null
}

export function planHrr1BestRecompute(rows: readonly StoredHrr1Best[]): Hrr1BestChange[] {
  return rows
    .filter(r => r.hrr1Best !== r.maxSetHrr60)
    .map(r => ({ workoutSessionId: r.workoutSessionId, startedAt: r.startedAt, before: r.hrr1Best, after: r.maxSetHrr60 }))
}

export function summariseHrr1BestChanges(changes: readonly Hrr1BestChange[]) {
  return {
    sessionsChanged: changes.length,
    toNull: changes.filter(c => c.before != null && c.after == null).length,
    fromNull: changes.filter(c => c.before == null && c.after != null).length,
    valueChanged: changes.filter(c => c.before != null && c.after != null).length,
  }
}
