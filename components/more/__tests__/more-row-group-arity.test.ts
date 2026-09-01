import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** BF-82. The More tab accumulated SEVEN `MoreRowGroup`s wrapping one `MoreRow` each, plus one
 *  more on the Settings sub-screen — an uppercase heading and a bordered container to present a
 *  single tappable line. The plan's §5 asks for this to be asserted rather than read, because the
 *  count was wrong by one when it was read by eye.
 *
 *  A LABELLED group must hold at least two rows. An UNLABELLED one is a plain card and is the
 *  supported way to draw a single row, so it is exempt by construction rather than by exception. */

const ROOT = path.resolve(__dirname, '../../..')

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'app', 'components', '--', '*.tsx'], {
    cwd: ROOT, encoding: 'utf8',
  })
  return out.split('\n').filter(Boolean)
}

/** Spans of `<MoreRowGroup …>…</MoreRowGroup>`, with the opening tag kept so `label` is visible. */
function groupSpans(src: string): string[] {
  const spans: string[] = []
  let from = 0
  for (;;) {
    const open = src.indexOf('<MoreRowGroup', from)
    if (open === -1) break
    const close = src.indexOf('</MoreRowGroup>', open)
    if (close === -1) break
    spans.push(src.slice(open, close))
    from = close + 1
  }
  return spans
}

describe('MoreRowGroup arity', () => {
  const files = sourceFiles().filter(f => f !== 'components/more/more-row.tsx')

  it('finds the groups it is meant to be guarding', () => {
    const total = files.reduce(
      (n, f) => n + groupSpans(readFileSync(path.join(ROOT, f), 'utf8')).length, 0)
    // Guards that match nothing pass forever. This session shipped four of them before noticing.
    expect(total).toBeGreaterThanOrEqual(4)
  })

  it('never gives a heading to fewer than two rows', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const span of groupSpans(readFileSync(path.join(ROOT, file), 'utf8'))) {
        const head = span.slice(0, span.indexOf('>') + 1)
        if (!/\blabel=/.test(head)) continue
        const rows = span.match(/<MoreRow[\s\n]/g)?.length ?? 0
        if (rows < 2) offenders.push(`${file}: ${head.trim().replace(/\s+/g, ' ')} wraps ${rows} row(s)`)
      }
    }
    expect(offenders).toEqual([])
  })
})
