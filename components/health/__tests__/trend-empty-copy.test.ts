/**
 * Issue 2610 — a trend card that vanishes reads as a layout fault, not as an absence.
 *
 * `TrendSparkline` takes an opt-in `emptyText`. This pins that every call site either passes one or is
 * a card whose PARENT already degrades (renders a sparkline only for a metric with data, and one
 * combined line when none has). The sites are discovered from the source, not listed: a list cannot
 * notice a sparkline nobody adds to it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TREND_EMPTY, scoreTrendEmpty } from '../trend-empty-copy'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (!['node_modules', '__tests__', '.next', '__check_fixture__'].includes(e.name)) out.push(...sourceFiles(rel)) }
    else if (e.name.endsWith('.tsx')) out.push(rel)
  }
  return out
}

/** Every `<TrendSparkline …>` opening tag, with brace depth tracked so a `>` in an expression does not end it. */
function sparklineTags(src: string): string[] {
  const tags: string[] = []
  const re = /<TrendSparkline(?=[\s/>])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 0, j = m.index
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(src.slice(m.index, j + 1))
  }
  return tags
}

// Parents that render a sparkline ONLY for a metric that has data, and one line when none does.
// An `emptyText` there would never show, and showing the card regardless would be a layout change.
const PARENT_DEGRADES: Record<string, string> = {
  'components/health/nutrition-activity-trends-card.tsx': 'No nutrition/activity trends yet.',
  'components/health/workout-density-card.tsx': 'No workout density trends yet.',
}

const sites = ['app', 'components'].flatMap(sourceFiles).flatMap(rel => {
  if (rel.endsWith('trend-sparkline.tsx') || rel.endsWith('trend-sparkline-lazy.tsx')) return []
  return sparklineTags(stripComments(readFileSync(join(root, rel), 'utf8'))).map(tag => ({ rel, tag }))
})

describe('every trend sparkline says what is missing, or its parent already does (issue 2610)', () => {
  it('finds the call sites at all — a scan that matches nothing would pass silently', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10)
  })

  it.each(sites.map(s => [`${s.rel}: ${s.tag.replace(/\s+/g, ' ').slice(0, 90)}`, s] as const))('%s', (_name, { rel, tag }) => {
    if (rel in PARENT_DEGRADES) return
    expect(tag, `${rel} draws a TrendSparkline with no emptyText, so the card vanishes when its metric has no data`).toMatch(/\bemptyText=/)
  })

  it('the exempt parents still degrade the way that exemption claims', () => {
    for (const [rel, line] of Object.entries(PARENT_DEGRADES)) {
      expect(readFileSync(join(root, rel), 'utf8'), rel).toContain(line)
      expect(sites.filter(s => s.rel === rel).length, `${rel} no longer draws a sparkline — drop its exemption`).toBeGreaterThan(0)
    }
  })
})

describe('the copy', () => {
  const lines = Object.entries(TREND_EMPTY)

  it('every line says what is missing and what produces it, in two sentences', () => {
    for (const [field, line] of lines) {
      expect(line, field).toMatch(/^No [^.]+ in the last 14 days\. [A-Z][^.]+\.$/)
    }
  })

  it('names no device for the heart-rate-based lines, which cannot know the source', () => {
    for (const field of ['rhrBpm', 'hrvMs'] as const) {
      expect(TREND_EMPTY[field], field).not.toMatch(/\b(ring|strap|Health Connect)\b/i)
    }
  })

  it('names the strap for recovery, which is only ever measured from one', () => {
    expect(TREND_EMPTY.hrr1Bpm).toContain('chest-strap')
  })

  it('builds the score line from the screen title', () => {
    expect(scoreTrendEmpty('Readiness')).toMatch(/^No readiness scores in the last 14 days\. /)
    expect(scoreTrendEmpty('Sleep')).toMatch(/^No sleep scores in the last 14 days\. /)
  })
})
