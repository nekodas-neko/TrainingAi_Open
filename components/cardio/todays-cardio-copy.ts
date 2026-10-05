/**
 * RV-166. What today's cardio prescription says, and how much of it is done.
 *
 * Pure so the wording and the arithmetic can be tested without the hub's live payload — the card
 * itself renders this and decides nothing.
 */

export interface CardioCriterion {
  /** "25 min in Zone 2", or "Easy 25 min" when the prescription has no zone target. */
  headline: string
  /** "107–134 bpm · a run or a walk both count" — never the only place the rule is stated. */
  detail: string
}

const BOTH_COUNT = 'a run or a walk both count'

/** "Zone 2" · "Zones 2–3" · "Zones 1, 3 and 4" — ranges only when the ids are contiguous. */
export function zoneLabel(zoneIds: number[]): string | null {
  const ids = [...new Set(zoneIds)].filter((z) => Number.isFinite(z)).sort((a, b) => a - b)
  if (ids.length === 0) return null
  if (ids.length === 1) return `Zone ${ids[0]}`
  const contiguous = ids.every((z, i) => i === 0 || z === ids[i - 1] + 1)
  if (contiguous) return `Zones ${ids[0]}–${ids[ids.length - 1]}`
  return `Zones ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

/** The prescription's own run-type word, capitalised for a heading. */
function runTypeWord(runType: string): string {
  const t = runType.trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Cardio'
}

export function cardioCriterion(p: {
  runType: string
  durationMin: number | null
  targetZoneIds: number[]
  targetHrLow: number | null
  targetHrHigh: number | null
}): CardioCriterion {
  const zone = zoneLabel(p.targetZoneIds)
  const mins = p.durationMin != null && p.durationMin > 0 ? `${p.durationMin} min` : null

  // Zone wording is only reachable because TN-78 moved the moderate floor to 40% of heart-rate
  // reserve (#1774). At the old 60% floor the target was 134 bpm, which a treadmill walk never
  // reached, so a zone-stated criterion would have been unmeetable on foot.
  const headline = zone && mins ? `${mins} in ${zone}` : `${runTypeWord(p.runType)}${mins ? ` ${mins}` : ''}`

  const bpm = p.targetHrLow != null && p.targetHrHigh != null
    ? `${p.targetHrLow}–${p.targetHrHigh} bpm`
    : null
  return { headline, detail: bpm ? `${bpm} · ${BOTH_COUNT}` : BOTH_COUNT }
}

export type CardioCardStatus = 'todo' | 'in-progress' | 'done' | 'skipped'

export function cardioStatus(runStatus: string, countedMin: number): CardioCardStatus {
  if (runStatus === 'completed') return 'done'
  if (runStatus === 'skipped') return 'skipped'
  return countedMin > 0 ? 'in-progress' : 'todo'
}

export const STATUS_LABEL: Record<CardioCardStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  skipped: 'Skipped',
}

/**
 * How many minutes count toward the target, and whether that number was measured.
 *
 * A treadmill walk with no heart rate DOES count (owner, 2026-09-27): refusing to complete a walk
 * he actually did is the worse failure. Its minutes are the logged ones and the day reads
 * `estimated` — the discriminator `observed-hr.ts` already uses for exactly this distinction, so a
 * third source can be added later without rewriting every reader.
 */
export interface CountedProgress {
  min: number
  source: 'observed' | 'estimated'
}

export function countedProgress(
  zoneDoneMin: number,
  walkWithoutHr: { durationMin: number | null } | null,
): CountedProgress {
  if (zoneDoneMin > 0) return { min: zoneDoneMin, source: 'observed' }
  const logged = walkWithoutHr?.durationMin
  if (logged != null && logged > 0) return { min: logged, source: 'estimated' }
  return { min: 0, source: 'observed' }
}

/** "Completed as a walk · 28 min" — the actual activity when it is known, the word alone when not. */
export function completedLine(
  completedAs: 'run' | 'walk' | null,
  activity: { durationMin: number | null } | null,
): string {
  // `completedAs` is null on rows finished before LB-179 tracked it, and every one of those was a run.
  const word = completedAs === 'walk' ? 'a walk' : 'a run'
  const mins = activity?.durationMin
  return mins != null && mins > 0 ? `Completed as ${word} · ${mins} min` : `Completed as ${word}`
}
