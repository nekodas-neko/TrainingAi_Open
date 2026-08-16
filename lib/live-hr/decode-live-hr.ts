// lib/live-hr/decode-live-hr.ts
// Pure extraction of a robust current live BPM from ring history-event frames.
// Each ring frame carries a BATCH of beats (0x80/0x60 hr_bpm[], 0x86 bpm[]); we
// median the recent fresh beats rather than surface any single "newest" beat, so a
// lone motion/decode artifact can never become the displayed value. Reuses the
// byte-exact decoder in @/lib/oura-ble/decode and the shared median() (One Formula).
import { historyEventFromHex } from '@/lib/oura-ble/decode'
import { median } from '@trainingai/shared/health/hr-smoothing'

const MIN_BPM = 30
const MAX_BPM = 220

// Median over at most this many of the most-recent fresh beats. Bounds the first
// post-connect history drain so a large backlog can't blend minutes into one value,
// while still smoothing beat-to-beat HRV. ~10 beats ≈ a 6–10 s window at rest.
export const HR_AVG_WINDOW_BEATS = 10

function validBpms(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM,
  )
}

// A frame decodes either an aohr `bpm[]` (0x86) or an IBI/HRV `hr_bpm[]` (0x80/0x60/0x5d).
function bpmsFromDecoded(decoded: Record<string, unknown>): number[] {
  const fromBpm = validBpms(decoded.bpm)
  return fromBpm.length ? fromBpm : validBpms(decoded.hr_bpm)
}

/**
 * Every valid beat carried by the given frames, regardless of timestamp — for the
 * diagnostics/test console to show the raw within-batch spread the median smooths over
 * (min/max/median of these vs the single value we surface). Not used on the live path.
 */
export function allBeatsFromFrames(frameHexes: string[]): number[] {
  const beats: number[] = []
  for (const hex of frameHexes) {
    const ev = historyEventFromHex(hex)
    if (!ev || !ev.decoded) continue
    beats.push(...bpmsFromDecoded(ev.decoded as Record<string, unknown>))
  }
  return beats
}

/**
 * Given a batch of raw frame hex strings (as delivered by the native service's
 * `ouraFrames`/`ouraFrame` events), return a robust current BPM and the greatest
 * contributing ring timestamp — or null if no frame newer than `afterRingTs`
 * carries a usable beat.
 *
 * The BPM is the median of the most-recent `HR_AVG_WINDOW_BEATS` valid beats across
 * all fresh frames (frames with ring timestamp > `afterRingTs`), ordered by ring
 * timestamp. Never the single newest beat — that is the point: a one-off artifact
 * cannot move the readout.
 */
export function smoothedBpmFromFrames(
  frameHexes: string[],
  afterRingTs: number,
  windowBeats: number = HR_AVG_WINDOW_BEATS,
): { bpm: number; ringTs: number } | null {
  const fresh: { ts: number; bpms: number[] }[] = []
  let maxRingTs = afterRingTs
  for (const hex of frameHexes) {
    const ev = historyEventFromHex(hex)
    if (!ev || !ev.decoded) continue
    if (ev.timestampDs <= afterRingTs) continue // already surfaced — skip re-drained tails
    const bpms = bpmsFromDecoded(ev.decoded as Record<string, unknown>)
    if (bpms.length === 0) continue
    fresh.push({ ts: ev.timestampDs, bpms })
    if (ev.timestampDs > maxRingTs) maxRingTs = ev.timestampDs
  }
  if (fresh.length === 0) return null
  fresh.sort((a, b) => a.ts - b.ts)
  const beats = fresh.flatMap(f => f.bpms)
  const window = beats.slice(-windowBeats)
  return { bpm: median(window), ringTs: maxRingTs }
}
