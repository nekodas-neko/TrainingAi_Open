// %1RM → training-intensity zone, for display only. The prescription card shows each exercise's
// working % (e.g. "@ 65kg (76%)"); this labels which classic strength zone that % sits in so the
// number reads as "hypertrophy load", not an opaque percentage. Non-overlapping bands, %1RM-based.
//
// This is a *display band* keyed off the prescribed %1RM — distinct from goal-ranges.ts, which is
// the goal/role-configured RANGE the AI can move within. Kept separate on purpose: this one needs
// no program context (just a %), so it can annotate any exercise row that shows a %.

export interface IntensityZone {
  label: string
  // Inclusive-exclusive %1RM band this zone spans, for the "measured against" line.
  range: string
  // Typical rep feel, plain English.
  reps: string
}

const ZONES: Array<{ min: number; zone: IntensityZone }> = [
  { min: 87.5, zone: { label: 'Max strength', range: '≥ 87.5%', reps: '1–4 reps' } },
  { min: 75,   zone: { label: 'Strength',     range: '75–87.5%', reps: '4–6 reps' } },
  { min: 65,   zone: { label: 'Hypertrophy',  range: '65–75%',   reps: '8–12 reps' } },
  { min: 55,   zone: { label: 'Endurance',    range: '55–65%',   reps: '12–20 reps' } },
  { min: -Infinity, zone: { label: 'Light / pump', range: '< 55%', reps: '15+ reps' } },
]

export function intensityZoneForPct(pct: number): IntensityZone {
  return ZONES.find(z => pct >= z.min)!.zone
}

// Engine role → human category shown on the workout pills.
export function roleLabel(role: string | undefined | null): string | null {
  switch (role) {
    case 'primary':
      return 'Main'
    case 'secondary':
      return 'Secondary'
    case 'accessory':
      return 'Accessory'
    default:
      return null
  }
}

// Distinct colour per role so the category reads at a glance without parsing the label:
// Main = emerald (the heavy anchor), Secondary = sky, Accessory = violet. These are the deeper
// (-600) shades so the chip can be a SOLID fill with white text at readable contrast.
export function roleColor(role: string | undefined | null): string | null {
  switch (role) {
    case 'primary':
      return '#059669'
    case 'secondary':
      return '#0284c7'
    case 'accessory':
      return '#7c3aed'
    default:
      return null
  }
}
