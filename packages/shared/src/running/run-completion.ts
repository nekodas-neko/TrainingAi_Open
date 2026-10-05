/**
 * LB-179. Did this prescribed run get done AS A RUN?
 *
 * RV-166 lets a walk satisfy a run prescription. That is right for the day's checklist, and wrong
 * for everything that plans the next run, because the planner reads `status === 'completed'` as
 * "a run of this type happened". A treadmill walk completing a tempo would switch off the next
 * quality session and put ~12 min/km into easy-run pace stats. Every planner-side reader asks this
 * instead, so the three cannot drift.
 *
 * `completedAs` null or absent means completed before it was tracked, and every such row was a run.
 */
export function completedAsRun(r: { status: string; completedAs?: 'run' | 'walk' | null }): boolean {
  return r.status === 'completed' && r.completedAs !== 'walk'
}
