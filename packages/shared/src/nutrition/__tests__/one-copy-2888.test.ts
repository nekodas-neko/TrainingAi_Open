import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * #2888: weight response, the dose-vitals series and the vial plan each lived twice, once per app,
 * with their own `DEFAULT_BAND_PCT_PER_WEEK`. They live once in this package now. This fails if either
 * app grows its own definition of one of these exports again.
 */
const ROOT = path.resolve(__dirname, '../../../../..')
const SHARED_EXPORTS = [
  'DEFAULT_BAND_PCT_PER_WEEK',
  'weightResponse',
  'recoveryResponse',
  'metricPattern',
  'buildDoseVitalsSeries',
  'planDose',
  'isMilligramDosed',
]
const DEFINES = new RegExp(`\\b(?:const|function|let|var)\\s+(${SHARED_EXPORTS.join('|')})\\b`)

function sources(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '__tests__', '__check_fixture__'].includes(e.name) || e.name.startsWith('.')) return []
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return sources(full)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : []
  })
}

describe('the reta and dose-vitals formulas live once (#2888)', () => {
  it('no app file defines its own copy', () => {
    const offenders = ['components', 'app', 'lib', 'mobile/src']
      .flatMap(d => sources(path.join(ROOT, d)))
      .flatMap(f => {
        const m = readFileSync(f, 'utf8').match(DEFINES)
        return m ? [`${path.relative(ROOT, f)}: ${m[1]}`] : []
      })
    expect(offenders).toEqual([])
  })
})
