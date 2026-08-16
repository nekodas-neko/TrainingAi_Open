// Default progression styles (set shapes + prompt descriptions) and the
// goal → style-role assignment rules. Shared by program generation and
// builder chat — previously duplicated in both routes.

export const KNOWN_STYLES: { name: string; sets: { reps: number; restSec: number }[]; description: string }[] = [
  {
    name: 'Hypertrophy',
    sets: Array(4).fill({ reps: 10, restSec: 60 }),
    description: '4 × 10 @ 65% · 60s rest — volume work, muscle building',
  },
  {
    name: 'Hypertrophy 3-set',
    sets: Array(3).fill({ reps: 10, restSec: 60 }),
    description: '3 × 10 @ 65% · 60s rest — lighter volume, accessories',
  },
  {
    name: 'Strength',
    sets: Array(5).fill({ reps: 5, restSec: 120 }),
    description: '5 × 5 @ 80% · 120s rest — heavy compound strength',
  },
  {
    name: 'Strength 3-set',
    sets: Array(3).fill({ reps: 5, restSec: 120 }),
    description: '3 × 5 @ 80% · 120s rest — strength work, lighter secondary compounds',
  },
  {
    name: 'Strength 4-set',
    sets: Array(4).fill({ reps: 5, restSec: 120 }),
    description: '4 × 5 @ 80% · 120s rest — strength work, heavier secondary compounds',
  },
  {
    name: 'Peak',
    sets: Array(3).fill({ reps: 3, restSec: 180 }),
    description: '3 × 3 @ 90% · 180s rest — near-maximal, peak phase',
  },
  {
    name: 'Peak 4-set',
    sets: Array(4).fill({ reps: 3, restSec: 180 }),
    description: '4 × 3 @ 90% · 180s rest — near-maximal, peak phase main lifts',
  },
  {
    name: 'General',
    sets: Array(3).fill({ reps: 12, restSec: 60 }),
    description: '3 × 12 @ 60% · 60s rest — general fitness, high rep accessories',
  },
  {
    name: 'General 4-set',
    sets: Array(4).fill({ reps: 12, restSec: 60 }),
    description: '4 × 12 @ 60% · 60s rest — higher volume general work',
  },
  {
    name: 'Powerbuilding',
    sets: Array(4).fill({ reps: 6, restSec: 120 }),
    description: '4 × 6 @ 80% · 120s rest — strength+hypertrophy crossover, max volume at strength threshold',
  },
  {
    name: 'Hypertrophy Plus',
    sets: Array(4).fill({ reps: 8, restSec: 75 }),
    description: '4 × 8 @ 70% · 75s rest — intensified hypertrophy, increased load vs standard',
  },
  {
    name: 'Heavy Strength',
    sets: Array(5).fill({ reps: 5, restSec: 180 }),
    description: '5 × 5 @ 85% · 180s rest — heavy strength intensification',
  },
  {
    name: 'Strength Plus',
    sets: Array(4).fill({ reps: 3, restSec: 180 }),
    description: '4 × 3 @ 87% · 180s rest — high-intensity strength intensification',
  },
  {
    name: 'Max Strength',
    sets: Array(3).fill({ reps: 3, restSec: 240 }),
    description: '3 × 3 @ 92% · 240s rest — near-maximal peak strength',
  },
]

// Server-side style enforcement: overrides the model's choices based on exercise role + goal.
// Styles reflect the accumulation phase style for each goal so the builder-review display is accurate.
// Gemini Flash Lite regularly ignores style assignment rules, so we correct it here.
export const GOAL_STYLE_RULES: Record<string, { primary: string; secondary: string; accessory: string }> = {
  hypertrophy:            { primary: 'General 4-set',  secondary: 'General 4-set',    accessory: 'General' },
  'strength+hypertrophy': { primary: 'Hypertrophy',    secondary: 'Hypertrophy 3-set', accessory: 'General' },
  // Powerbuilding: ONE heavy anchor per session (primary = 4×6 @80%), the rest built as moderate
  // hypertrophy volume. Secondary is deliberately a moderate 4×8 @70% ('Hypertrophy Plus'), NOT the
  // heavy 'Powerbuilding' style — assigning heavy 4×6 to secondaries too stacked 3 near-max
  // compounds into every session, blowing past the time budget (3 warm-up ramps + long rests) and
  // over-taxing recovery. Strength keeps heavy secondaries by design; powerbuilding does not.
  powerbuilding:          { primary: 'Powerbuilding',  secondary: 'Hypertrophy Plus',  accessory: 'Hypertrophy 3-set' },
  strength:               { primary: 'Strength',       secondary: 'Strength 4-set',    accessory: 'Strength 3-set' },
}
