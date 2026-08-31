import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const sources = ['app', 'components', 'lib'].flatMap(d => walk(path.join(root, d))).map(abs => ({
  rel: path.relative(root, abs).replace(/\\/g, '/'),
  src: fs.readFileSync(abs, 'utf8'),
}))

/** Files that are client-side callers — i.e. not the route handlers themselves. */
const clientSources = sources.filter(({ rel }) => !rel.startsWith('app/api/'))

/**
 * A write route with no caller stores nothing, and nothing fails while it does (BF-71).
 *
 * `/api/measured-rmr` and `/api/dexa-scans` both shipped complete — schema, repository methods, and
 * a `nutrition-goals/recommend` path that already read `getLatestMeasuredRmr`. No client code ever
 * called either one, so both tables were empty in production for four days and every resting rate
 * the app quoted stayed predicted. **No test could fail for that**: the routes were correct, the
 * reads were correct, and an empty table is a valid state.
 *
 * This is the guard for the class rather than the instance. It is deliberately about reachability
 * and not about markup, because the defect was never in the markup.
 */
describe('clinical entry is reachable', () => {
  it.each([
    ['/api/measured-rmr', 'the resting rate the calorie target uses'],
    ['/api/dexa-scans', "the scan the scale's body-fat reading is calibrated against"],
  ])('%s has at least one client caller', route => {
    // The terminator is load-bearing. Without it this matched `/api/dexa-scans-DISABLED` and the
    // guard passed while the form posted nowhere — caught by mutating the URL rather than by
    // reading the regex, which is the only way that class of hole shows itself.
    const callers = clientSources
      .filter(({ src }) => new RegExp(`fetch\\(\\s*['"\`]${route}(?=['"\`?])`).test(src))
      .map(({ rel }) => rel)

    expect(callers.length, `nothing in the app posts to ${route}, so its table cannot fill`).toBeGreaterThan(0)
  })

  it('the entry screen is reachable from the More menu', () => {
    const more = sources.find(s => s.rel === 'components/more/profile-tab.tsx')
    expect(more, 'profile-tab.tsx moved — this guard needs re-pointing').toBeTruthy()
    // A screen that exists and is routed to from nowhere is the same defect one level up: the
    // forms would be as unreachable as the routes were.
    expect(more!.src).toContain('/more/clinical')
  })

  it('the DEXA form sends source: manual, so an extraction can be told apart later', () => {
    // The route accepts `manual | extracted` and its comment is explicit that `extracted` means a
    // model read it AND a human confirmed it. A hand-typed row that arrives unlabelled would be
    // indistinguishable from one BF-41 extracted, which is the provenance the column exists for.
    const form = sources.find(s => s.rel === 'components/more/clinical/dexa-scan-form.tsx')
    expect(form).toBeTruthy()
    expect(form!.src).toMatch(/source:\s*'manual'/)
  })
})
