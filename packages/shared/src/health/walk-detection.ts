// Walks found after the fact from the ring's own MET (#2471, owner direction 2026-10-06).
//
// The live detector could not work: the ring hands its step-gate windows to the phone in hourly
// drains (median 33 min old on arrival), and its "walking" flag reads walking in a third of the
// windows while the wearer sleeps. So detection no longer tries to be live. At each ring sync the
// app asks for the walks in the ring's MET it has not been told about yet, and offers each one:
// "Looks like you walked 9:10–9:32. Save it?"
//
// The rule, measured on the owner's 91 days (7 Jul – 5 Oct) before it was chosen:
//   a minute is ACTIVE when the ring's MET is above WALK_ACTIVE_MET (2.0);
//   a stretch qualifies where WALK_WINDOW_ACTIVE (5) of any WALK_WINDOW_MIN (6) consecutive minutes
//   are active; qualifying stretches less than WALK_MERGE_GAP_MIN (3) minutes apart are one walk;
//   a walk lasts at least WALK_MIN_DURATION_MIN (7) minutes.
// On that history: 1.33 candidates a day, 3 in sleep over 91 days, 9 of 11 GPS-verified outdoor
// walks caught. Precision cannot be stated until the owner labels candidates (#2478's events).
//
// Minutes inside a sleep record, a lifting session or a logged activity are never active, so those
// never produce a candidate — and a walk the user has already saved is a logged activity, which is
// how a saved candidate does not come back on the next sync.

export const WALK_ACTIVE_MET = 2.0
export const WALK_WINDOW_MIN = 6
export const WALK_WINDOW_ACTIVE = 5
export const WALK_MERGE_GAP_MIN = 3
export const WALK_MIN_DURATION_MIN = 7

const MINUTE_MS = 60_000

export interface MetGrid {
  /** The first minute's start, on a whole minute. */
  startTimestampMs: number
  /** `metsPerMinute[i]` is the minute starting `startTimestampMs + i·60 s`; null where the ring has none. */
  metsPerMinute: readonly (number | null)[]
}

export interface DetectedWalk {
  startMs: number
  /** Exclusive: the end of the last active minute. */
  endMs: number
  durationMin: number
  meanMet: number
}

/**
 * The walks in a ring MET grid. `exclusions` are `[startMs, endMs)` spans whose minutes can never be
 * active (sleep, lifting, logged activities). Pure and deterministic.
 */
export function detectWalksFromMet(grid: MetGrid, exclusions: readonly { startMs: number; endMs: number }[] = []): DetectedWalk[] {
  const n = grid.metsPerMinute.length
  const at = (i: number) => grid.startTimestampMs + i * MINUTE_MS
  const excluded = (i: number) => {
    const s = at(i), e = s + MINUTE_MS
    return exclusions.some(x => s < x.endMs && e > x.startMs)
  }
  const active = grid.metsPerMinute.map((v, i) => v != null && v > WALK_ACTIVE_MET && !excluded(i))

  // Every minute that is active AND sits in a qualifying window.
  const inWalk = new Array<boolean>(n).fill(false)
  for (let s = 0; s + WALK_WINDOW_MIN <= n; s++) {
    let count = 0
    for (let k = s; k < s + WALK_WINDOW_MIN; k++) if (active[k]) count++
    if (count < WALK_WINDOW_ACTIVE) continue
    for (let k = s; k < s + WALK_WINDOW_MIN; k++) if (active[k]) inWalk[k] = true
  }

  // Runs of walk minutes, merged across short gaps.
  const spans: { first: number; last: number }[] = []
  for (let i = 0; i < n; i++) {
    if (!inWalk[i]) continue
    const prev = spans[spans.length - 1]
    if (prev && i - prev.last - 1 <= WALK_MERGE_GAP_MIN) prev.last = i
    else spans.push({ first: i, last: i })
  }

  const out: DetectedWalk[] = []
  for (const { first, last } of spans) {
    const durationMin = last - first + 1
    if (durationMin < WALK_MIN_DURATION_MIN) continue
    const mets: number[] = []
    for (let k = first; k <= last; k++) if (active[k]) mets.push(grid.metsPerMinute[k] as number)
    out.push({
      startMs: at(first),
      endMs: at(last + 1),
      durationMin,
      meanMet: Math.round((mets.reduce((a, b) => a + b, 0) / mets.length) * 100) / 100,
    })
  }
  return out
}
