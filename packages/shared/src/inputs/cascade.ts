/**
 * The device-agnostic input layer: named inputs, each filled by an ordered cascade of rungs.
 *
 * The rule is `docs/architecture/readiness-tree.md` → *Inputs are device-agnostic* (owner,
 * 2026-10-06). A scorer reads a named input (`steps/min`, `MET/min`, `HR/min`, `HRR60`, …), never a
 * device table. Each input names the routes that can fill it, grouped into rungs:
 *
 *   1 · provided   the device reports it
 *   2 · derived    computed from rawer data we hold
 *   3 · estimated  inferred from a coarser signal
 *   (missing)      nothing filled the slot — the unit drops out, it is never scored as 0
 *
 * Per slot (a minute, a set, a night) the best rung wins, and within a rung the route listed first
 * wins. Every resolved value carries `{source, rung, route}` so a screen can say where the number came
 * from and a baseline never silently mixes a measured normal with an estimated one.
 *
 * **Adding a device means writing an adapter** (`adapters.ts`) that turns its rows into candidates
 * for one of the routes below — never touching a scorer. A new route is a new entry in `INPUTS`.
 *
 * Pure and dependency-light on purpose: it runs on the device (WebView) as well as the server.
 */
import { MAX_STEPS_PER_MIN, MIN_PLAUSIBLE_BPM, MAX_PLAUSIBLE_BPM, MIN_PLAUSIBLE_MET, MAX_PLAUSIBLE_MET } from '@trainingai/shared/validation/plausibility'

export const MINUTE_MS = 60_000

export type Rung = 'provided' | 'derived' | 'estimated'

/** Lower is better. The order the cascade tries rungs in. */
export const RUNG_ORDER: Record<Rung, number> = { provided: 1, derived: 2, estimated: 3 }

/** What a slot is keyed by. A minute input is keyed by the minute's epoch-ms start. */
export type SlotKind = 'minute' | 'event' | 'night'

export type InputName = 'steps/min' | 'MET/min' | 'HR/min' | 'HRR60' | 'HRV/night' | 'RHR/night'

/** One way of filling an input. `id` is what a candidate names; `label` is what a screen can say. */
export interface RouteDef {
  id: string
  rung: Rung
  label: string
}

export interface InputDef {
  name: InputName
  slot: SlotKind
  unit: string
  /** Ordered: rung first, then the order routes are listed within a rung. */
  routes: readonly RouteDef[]
  /** A value outside this is a fault, not a reading, and the candidate is dropped (never clamped). */
  plausible: (value: number) => boolean
  /**
   * True when the input has no rung-2 or rung-3 route — a unit that uses it is device-limited, and
   * the readiness-tree rule requires that to be said plainly rather than discovered.
   */
  deviceLimited?: boolean
}

const inRange = (lo: number, hi: number) => (v: number) => Number.isFinite(v) && v >= lo && v <= hi
const positive = (v: number) => Number.isFinite(v) && v > 0

/**
 * The registry. Route order inside a rung is the tie-break, so it encodes the accuracy hierarchy the
 * codebase already uses — e.g. live-counted accelerometer windows over the step model, exactly as
 * `mergeStepCounterWithLive` (`health/step-estimate.ts`) orders them.
 */
export const INPUTS: Record<InputName, InputDef> = {
  'steps/min': {
    name: 'steps/min', slot: 'minute', unit: 'steps',
    routes: [
      { id: 'device_steps', rung: 'provided', label: 'counted by the device' },
      // Both of these run our own code over raw ring data, so they are rung 2, not "provided".
      { id: 'accel_live_count', rung: 'derived', label: 'counted from raw accelerometer' },
      { id: 'ring_step_model', rung: 'derived', label: 'counted from the ring\'s gait features' },
    ],
    plausible: inRange(0, MAX_STEPS_PER_MIN),
  },
  'MET/min': {
    name: 'MET/min', slot: 'minute', unit: 'MET',
    routes: [
      { id: 'device_met', rung: 'provided', label: 'reported by the ring' },
      { id: 'accel_met', rung: 'derived', label: 'derived from raw accelerometer' },
      { id: 'hr_reserve_met', rung: 'estimated', label: 'estimated from heart rate' },
      { id: 'compendium_met', rung: 'estimated', label: 'estimated from the logged activity' },
    ],
    plausible: inRange(MIN_PLAUSIBLE_MET, MAX_PLAUSIBLE_MET),
  },
  'HR/min': {
    name: 'HR/min', slot: 'minute', unit: 'bpm',
    // Strap first: it is the more accurate sensor under load, and the ring reads ~10 bpm under it
    // (#2448, owner, from #2162). Both are rung 1 — HR is always provided — so this is a tie-break.
    routes: [
      { id: 'chest_strap', rung: 'provided', label: 'from the chest strap' },
      { id: 'ring_hr', rung: 'provided', label: 'from the ring' },
      { id: 'health_connect_hr', rung: 'provided', label: 'from Health Connect' },
    ],
    plausible: inRange(MIN_PLAUSIBLE_BPM, MAX_PLAUSIBLE_BPM),
    deviceLimited: true,
  },
  HRR60: {
    name: 'HRR60', slot: 'event', unit: 'bpm',
    routes: [
      // No device reports it; it is always derived from dense HR around the set.
      { id: 'dense_hr_drop60', rung: 'derived', label: 'from heart rate after the set' },
    ],
    // A drop can be negative (HR still rising after the set), so only finiteness and a sane span.
    plausible: inRange(-MAX_PLAUSIBLE_BPM, MAX_PLAUSIBLE_BPM),
  },
  'HRV/night': {
    name: 'HRV/night', slot: 'night', unit: 'ms',
    routes: [
      { id: 'night_hrv', rung: 'provided', label: 'measured overnight' },
      // #2162 (d): the ring's own IBI stream (tag 0x80) may become a rung-2 RMSSD route once its
      // adjacency and density are measured. Not registered until then.
    ],
    plausible: positive,
    deviceLimited: true,
  },
  'RHR/night': {
    name: 'RHR/night', slot: 'night', unit: 'bpm',
    routes: [{ id: 'night_rhr', rung: 'provided', label: 'measured overnight' }],
    plausible: positive,
    deviceLimited: true,
  },
}

/** Where a value came from. `lowWear` marks a slot taken while the device was barely worn. */
export interface Provenance {
  route: string
  rung: Rung
  /** The device or store that supplied it: `oura_ble`, `chest_strap`, `health_connect`, `manual`, … */
  source: string
  lowWear?: boolean
}

/** One offered value for one slot. Adapters produce these; the resolver picks among them. */
export interface Candidate {
  slot: number | string
  value: number
  route: string
  source: string
  lowWear?: boolean
}

export type Resolved =
  | { slot: number | string; missing: false; value: number; provenance: Provenance }
  /** Nothing filled the slot. `value` is null — never 0 — so a sum or mean cannot absorb it. */
  | { slot: number | string; missing: true; value: null; provenance: null }

/** Rank of a route within an input: rung first, then listed order. Unknown routes rank nowhere. */
function routeRank(def: InputDef, routeId: string): number | null {
  const idx = def.routes.findIndex((r) => r.id === routeId)
  if (idx < 0) return null
  return RUNG_ORDER[def.routes[idx].rung] * 1000 + idx
}

/**
 * Pick the best candidate per slot.
 *
 * A candidate is dropped when its route is not registered for this input (an adapter bug must not
 * leak into a score) or its value is implausible. Among the rest the best route wins; two candidates
 * on the same route and slot keep the first offered, so the result is deterministic for a given
 * input order.
 */
export function resolveSlots(name: InputName, candidates: readonly Candidate[]): Map<number | string, Resolved> {
  const def = INPUTS[name]
  const best = new Map<number | string, { rank: number; c: Candidate }>()
  for (const c of candidates) {
    const rank = routeRank(def, c.route)
    if (rank == null || !def.plausible(c.value)) continue
    const prev = best.get(c.slot)
    if (prev == null || rank < prev.rank) best.set(c.slot, { rank, c })
  }
  const out = new Map<number | string, Resolved>()
  for (const [slot, { c }] of best) {
    const route = def.routes.find((r) => r.id === c.route)!
    out.set(slot, {
      slot, missing: false, value: c.value,
      provenance: { route: c.route, rung: route.rung, source: c.source, ...(c.lowWear ? { lowWear: true } : {}) },
    })
  }
  return out
}

/** Floor an epoch-ms instant to its minute — the key every minute input uses. */
export function minuteOf(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

/**
 * Resolve a minute input over `[fromMs, toMs)`, returning **every** minute in order — the ones no
 * rung filled come back `missing`, so a caller can see coverage instead of mistaking a gap for rest.
 */
export function resolveMinutes(
  name: InputName, candidates: readonly Candidate[], fromMs: number, toMs: number,
): Resolved[] {
  if (INPUTS[name].slot !== 'minute') throw new Error(`${name} is not a minute input`)
  const resolved = resolveSlots(name, candidates)
  const out: Resolved[] = []
  for (let m = minuteOf(fromMs); m < toMs; m += MINUTE_MS) {
    out.push(resolved.get(m) ?? { slot: m, missing: true, value: null, provenance: null })
  }
  return out
}

/** How a resolved series was filled — per rung and per source — for "estimated from heart rate". */
export interface Coverage {
  total: number
  filled: number
  missing: number
  byRung: Record<Rung, number>
  bySource: Record<string, number>
}

export function coverage(series: readonly Resolved[]): Coverage {
  const c: Coverage = { total: series.length, filled: 0, missing: 0, byRung: { provided: 0, derived: 0, estimated: 0 }, bySource: {} }
  for (const r of series) {
    if (r.missing) { c.missing++; continue }
    c.filled++
    c.byRung[r.provenance.rung]++
    c.bySource[r.provenance.source] = (c.bySource[r.provenance.source] ?? 0) + 1
  }
  return c
}

/**
 * Sum of the filled slots, or **null when none were filled** — a day with no data is not a day of
 * zero steps. A partly filled series sums what it has; read `coverage()` to judge whether that is
 * enough for the unit at hand.
 */
export function sumFilled(series: readonly Resolved[]): number | null {
  let sum = 0, any = false
  for (const r of series) if (!r.missing) { sum += r.value; any = true }
  return any ? sum : null
}

/**
 * The values a baseline may be built from.
 *
 * - **Low-wear slots are excluded from every window** (readiness-tree; #2448 comment folding in
 *   #2098). This is the same exclusion `excludeLowWearDays` applies to the readiness HRV and RHR
 *   baselines today, carried as provenance so it survives the switch to named inputs.
 * - **Baselines stay per source** (edge case #11, #2162 (e)): the ring reads ~10 bpm under the strap,
 *   so a normal built from one must never absorb the other. Pass `source` to select one; omit it only
 *   when the input has a single source by construction.
 * - Missing slots contribute nothing.
 */
export function baselineValues(
  series: Iterable<Resolved>, opts: { source?: string; rungs?: readonly Rung[] } = {},
): number[] {
  const out: number[] = []
  for (const r of series) {
    if (r.missing || r.provenance.lowWear) continue
    if (opts.source != null && r.provenance.source !== opts.source) continue
    if (opts.rungs != null && !opts.rungs.includes(r.provenance.rung)) continue
    out.push(r.value)
  }
  return out
}

/** The plain-language label for a provenance — "estimated from heart rate". */
export function provenanceLabel(name: InputName, p: Provenance): string {
  return INPUTS[name].routes.find((r) => r.id === p.route)?.label ?? p.route
}
