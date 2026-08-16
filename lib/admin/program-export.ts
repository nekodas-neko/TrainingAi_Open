// Pure formatter for the admin "export my program" tool — turns the assembled active-program
// structure into a compact, copy-pasteable text block (role + sets×reps@pct + rest + muscles per
// exercise, plus a per-session role tally and estimated-vs-budget duration). The route
// (app/api/admin/program-export) does the DB assembly + duration estimate; this stays pure.

export interface ExportSet { reps: number; pct: number; restSec: number }

export interface ExportExercise {
  name: string
  role: string
  sets: ExportSet[]
  muscles: string[]
  supersetGroup: number | null
}

export interface ExportSession {
  name: string
  budgetMin: number
  estMin: number
  exercises: ExportExercise[]
}

export interface ProgramExport {
  programName: string
  goal: string
  phaseMode: string
  sessions: ExportSession[]
}

const ROLE_ABBR: Record<string, string> = { primary: 'P', secondary: 'S', accessory: 'A' }

// One-line set summary: "4×6 @80% · rest 180s" when every set matches, else per-set reps@pct.
export function summarizeSets(sets: ExportSet[]): string {
  if (sets.length === 0) return 'no style assigned'
  const first = sets[0]
  const uniform = sets.every(s => s.reps === first.reps && s.pct === first.pct && s.restSec === first.restSec)
  if (uniform) return `${sets.length}×${first.reps} @${first.pct}% · rest ${first.restSec}s`
  const perSet = sets.map(s => `${s.reps}@${s.pct}%`).join(', ')
  const restUniform = sets.every(s => s.restSec === first.restSec)
  return `${sets.length} sets: ${perSet}${restUniform ? ` · rest ${first.restSec}s` : ''}`
}

function roleTally(exercises: ExportExercise[]): string {
  const counts: Record<string, number> = {}
  for (const ex of exercises) counts[ex.role] = (counts[ex.role] ?? 0) + 1
  return (['primary', 'secondary', 'accessory'] as const)
    .filter(r => counts[r])
    .map(r => `${counts[r]}${ROLE_ABBR[r]}`)
    .join(' / ') || '—'
}

export function formatProgramExport(p: ProgramExport): string {
  const lines: string[] = [
    `# ${p.programName} · goal: ${p.goal} · mode: ${p.phaseMode}`,
    '',
  ]
  for (const s of p.sessions) {
    const over = s.estMin > s.budgetMin
    lines.push(
      `## ${s.name} — budget ${s.budgetMin} min · est ~${s.estMin} min ${over ? '⚠️ OVER' : '✓ fits'}`,
      `   roles: ${roleTally(s.exercises)}`,
    )
    s.exercises.forEach((ex, i) => {
      const superset = ex.supersetGroup != null ? ` · superset ${ex.supersetGroup}` : ''
      const muscles = ex.muscles.length ? ex.muscles.join(', ') : 'no muscles tagged'
      lines.push(`   ${i + 1}. ${ex.name} · ${ex.role} · ${summarizeSets(ex.sets)} · ${muscles}${superset}`)
    })
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}
