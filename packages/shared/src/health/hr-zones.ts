// Heart-rate training zones — One Formula, One Place. The Karvonen (heart-rate
// reserve) max-HR + reserve math was previously inlined in
// app/api/body-battery/route.ts; both now import from here. The zone palette is
// the canonical HR-zone colour set (semantic blue→green→yellow→orange→red),
// defined once and imported wherever HR is coloured by zone.

/** Age-predicted maximal heart rate (classic 220 − age). Falls back to 190 when
 *  age is unknown — matching the body-battery baseline. */
export function hrMaxFromAge(age: number | null | undefined): number {
  return age != null ? 220 - age : 190
}

/** Heart-rate reserve (max − rest), floored at 30 so a bad/low resting value can't
 *  collapse the reserve and make every reading read as max effort. */
export function hrReserve(maxHr: number, restingHr: number): number {
  return Math.max(30, maxHr - restingHr)
}

/** HR-reserve fraction at/under which a reading counts as "at rest" — the single threshold that
 *  distinguishes rest from any movement. Originally a private constant in the Body Battery route
 *  (charge below this, drain above it); shared here so the Activity Score's "moved this hour" signal
 *  uses the exact same rest/active boundary rather than a second invented threshold. */
export const HR_REST_THRESHOLD = 0.05

export interface HrZone {
  id: 1 | 2 | 3 | 4 | 5
  name: string
  /** Inclusive lower bpm bound. */
  minBpm: number
  /** Exclusive upper bpm bound (Infinity for the top zone). */
  maxBpm: number
  /** Semantic zone colour — safe in both light and dark themes. */
  color: string
}

// Fraction-of-reserve lower bounds for each zone (Karvonen). Zone 1 starts at the
// resting HR itself so the whole plausible range is covered.
const ZONE_DEFS: { id: HrZone['id']; name: string; lowerFrac: number; color: string }[] = [
  { id: 1, name: 'Recovery', lowerFrac: 0.0, color: '#3b82f6' },
  { id: 2, name: 'Light',    lowerFrac: 0.6, color: '#22c55e' },
  { id: 3, name: 'Aerobic',  lowerFrac: 0.7, color: '#eab308' },
  { id: 4, name: 'Hard',     lowerFrac: 0.8, color: '#f97316' },
  { id: 5, name: 'Peak',     lowerFrac: 0.9, color: '#ef4444' },
]

// Zone id → name + colour, independent of any profile (for legends / zone-target bars
// that don't have a bpm context). Same source as the band builder — no second palette.
export const HR_ZONE_META: { id: HrZone['id']; name: string; color: string }[] =
  ZONE_DEFS.map((z) => ({ id: z.id, name: z.name, color: z.color }))

/** Build the five HR zones as absolute bpm bands for a given profile. */
export function computeHrZones({ maxHr, restingHr }: { maxHr: number; restingHr: number }): HrZone[] {
  const reserve = hrReserve(maxHr, restingHr)
  return ZONE_DEFS.map((z, i) => {
    const next = ZONE_DEFS[i + 1]
    return {
      id: z.id,
      name: z.name,
      minBpm: Math.round(restingHr + z.lowerFrac * reserve),
      maxBpm: next ? Math.round(restingHr + next.lowerFrac * reserve) : Infinity,
      color: z.color,
    }
  })
}

/** Which zone a bpm falls into. Clamps below Zone 1 → Zone 1, above → Zone 5, so a
 *  reading is always classified (never null for a plausible bpm). */
export function zoneForBpm(bpm: number, zones: HrZone[]): HrZone {
  for (const z of zones) {
    if (bpm >= z.minBpm && bpm < z.maxBpm) return z
  }
  return bpm < zones[0].minBpm ? zones[0] : zones[zones.length - 1]
}

// ── Interval-walk effort targets (guided interval walking) ─────────────────────
// A fast/slow block has a single reserve-fraction target rather than the five-band
// zone map above: hit ≥ the fast target on fast blocks, stay ≤ the slow target on
// slow blocks. Built on the same Karvonen reserve so there's no second formula.

export type ZoneSegmentKind = 'fast' | 'slow'
export type ZoneVerdict = 'in' | 'push' | 'ease'
export interface ZoneTargets { fast: number; slow: number }

// `estimateHrMax({age, observed})` used to live here. It returned ANY positive `observed`
// verbatim — no plausibility band, no corroboration — and its callers fed it a bare
// `Math.max` over raw readings, so one artefact became a permanent ceiling. Max-HR
// resolution now happens in exactly one place: `resolveHrProfile` (lib/health/hr-profile.ts),
// which corroborates every observed value through `computeObservedHr` and returns both the
// effort ceiling (`maxHr`) and the reachable-target anchor (`targetAnchorMax`).

/** Karvonen target bpm for a reserve fraction: resting + pct·reserve, rounded. */
export function hrReserveTarget(pct: number, restingHr: number, hrMax: number): number {
  return Math.round(restingHr + pct * hrReserve(hrMax, restingHr))
}

/** Verdict for a live bpm on a fast/slow block: 'in' when meeting the block's target,
 *  else 'push' (fast, too low) or 'ease' (slow, too high). */
export function classifyZone(bpm: number, kind: ZoneSegmentKind, targets: ZoneTargets): ZoneVerdict {
  if (kind === 'fast') return bpm >= targets.fast ? 'in' : 'push'
  return bpm <= targets.slow ? 'in' : 'ease'
}
