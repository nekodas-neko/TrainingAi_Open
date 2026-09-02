import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * BF-107 — the walk summary shows the calories it was already being told.
 *
 * **The number is derived server-side and cannot move client-side.** `saveActivityLog` computes it
 * because the MET table behind `estWorkoutKcal` is read through `node:path`, so it cannot be
 * imported into a client bundle. That is why the client sends `caloriesBurned: null` and why the
 * value arrives *after* this screen has painted — which is the whole shape of the fix.
 *
 * These are source assertions because the screen needs a canvas, a local SQLite store and a real
 * save to render, and both vitest projects run `environment: 'node'`.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const summary = () => source('components/guided-walk/walk-summary.tsx')

describe('the tile', () => {
  it('renders a dash rather than a zero while the figure is unknown', () => {
    // A zero is a claim about a walk that burned nothing; a dash is not. Offline this is the only
    // state the tile ever reaches, so it is the one that has to be right.
    expect(summary()).toMatch(/label="kcal" value=\{kcal != null \? `\$\{Math\.round\(kcal\)\}` : '—'\}/)
  })

  it('sits in a grid wide enough for it', () => {
    // Four tiles in a three-column grid strands one on a second row. Asserted because the count and
    // the column count have to change together, and nothing else would catch them drifting apart.
    const src = summary()
    expect(src).toContain('grid grid-cols-4 gap-2 text-center')
    expect(src.match(/<StatTile /g), 'four tiles').toHaveLength(4)
  })
})

describe('both write paths feed it', () => {
  it('reads the calories off the web POST response instead of discarding it', () => {
    // `POST /api/activity-logs` has always answered `{ activityLog }` with the derived value on it;
    // the screen checked `res.ok` and threw the body away.
    const src = summary()
    expect(src).toMatch(/body\?\.activityLog\?\.caloriesBurned != null\) setKcal\(body\.activityLog\.caloriesBurned\)/)
  })

  it('forces a pull on the device path, because a push alone never returns the number', () => {
    // `pushMutations` only flips the row to `synced` — the derived value lands on a PULL. Without
    // this the tile is a dash forever on the canonical runtime, which is the reported bug unfixed.
    const src = summary()
    expect(src).toMatch(/await pullDelta\(userId!, true\)/)
    expect(src).toMatch(/if \(mine\?\.caloriesBurned != null\) setKcal\(mine\.caloriesBurned\)/)
  })

  it('keeps the pull inside pushThenRevalidate rather than replacing it', () => {
    // Revalidating around a local write instead of after it is its own bug class, and the callback
    // only runs when something was actually pushed — so a no-op push does not trigger a pull.
    expect(summary()).toMatch(/pushThenRevalidate\(userId!, async \(\) => \{/)
  })
})

describe('the shared tile', () => {
  it('exists as one primitive rather than a third copy of the markup', () => {
    const tile = source('components/ui/stat-tile.tsx')
    expect(tile).toContain('export function StatTile')
    expect(summary()).toContain("import { StatTile } from '@/components/ui/stat-tile'")
    // The local copy has to be gone, or the import is decoration.
    expect(summary(), 'the local Stat must be deleted').not.toMatch(/^function Stat\(/m)
  })
})
