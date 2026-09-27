// TN-61 and the DV starvation are one defect class: the tool's output is correct and the conclusion
// a reader draws from it is wrong, because what is MISSING is not accounted for.
//
// TN-61: READY caps at 10 and the "… and N more" line was computed from
// `ready.filter(e => !e.batch || shownBatches.has(e.batch))` — every unbatched entry, whether or not
// the cap reached it. So the line fired only when a BATCH collapsed rows and never when the cap hid
// them. Lane A's 31-entry READY printed 10 in silence, and two entries edited minutes earlier
// appeared nowhere, which reads exactly like removed-from-the-queue.
//
// DV: `--lane DV` is correctly near-empty — `Lane:` says who BUILDS a thing, and a check owed on the
// phone sits on the entry that built it. But correctly empty is indistinguishable from "nothing for
// me" unless the tool says otherwise, and it read "nothing startable" against 110 owed checks.
//
// Both are pinned by running the real script against the real backlog: a fixture would prove the
// formatting and not the thing that broke, which was the COUNT being derived from the wrong set.
import { execFileSync } from 'child_process'
import path from 'path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..', '..')
const run = (...args: string[]) =>
  execFileSync('node', [path.join(repoRoot, 'scripts', 'next-item.js'), ...args], {
    cwd: repoRoot, encoding: 'utf8',
  })

// The cap is on ROWS, and a batch is one row carrying several entries — so "READY (12)" can be
// fully printed inside a 10-row cap with nothing withheld. Counting the entries the output actually
// shows is the only way to ask "did the cap hide anything?" without re-encoding a fact about
// today's batches. An entry line is `NN. <id> …` or, inside a batch, an indented `<id> …`; the
// batch header itself carries no id and so is not counted.
const ENTRY = /^\s*(?:\d+\.\s+)?((?:[A-Z]{2}|Q)-\d+[a-z]?)\s/
function printedEntries(out: string): number {
  // The block runs to the next SECTION HEADER, which is the only thing at column 0 — not to the
  // next blank line. `--lane O` and `--lane DV` print a blank line and an indented note about owed
  // device checks between the READY header and the first entry, so stopping at the blank found
  // zero entries in exactly the two lanes most likely to be truncated.
  const lines = out.split('\n')
  const start = lines.findIndex((l) => l.startsWith('READY ('))
  if (start < 0) return 0
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start + 1, end).filter((l) => ENTRY.test(l)).length
}

describe('next-item does not stay silent about what it withheld (TN-61)', () => {
  it('names the withheld count whenever READY is truncated', () => {
    const out = run('--lane', 'A')
    const readyCount = Number(/READY \((\d+)\)/.exec(out)?.[1])
    expect(readyCount).toBeGreaterThan(0)

    if (printedEntries(out) < readyCount) {
      const m = /showing (\d+) of (\d+)/.exec(out)
      expect(m, 'a truncated READY must say so').not.toBeNull()
      // The regression itself: the TOTAL has to be READY's own count. The old line could not be
      // wrong about this because it never printed at all — which is why the assertion is on the
      // number and not merely on the line existing.
      expect(Number(m![2])).toBe(readyCount)
      expect(Number(m![1])).toBeLessThan(readyCount)
      expect(out).toContain('BELOW THE CUT')
    }
  })

  // The truncation line appears IF AND ONLY IF the cap hid something — asserted across every lane,
  // because this case has now broken THREE times for the same reason: it encoded a fact about the
  // DATA rather than the behaviour. First it searched for the bare word "showing" and went red when
  // RV-128 ("does the tab switch drop a frame showing neither panel?") entered the lane; then it
  // hard-wired DV as the everything-fits lane and went red when DV grew past the cap. A test that
  // names a lane is a test that expires.
  //
  // The third was `ready > 10` standing in for "the cap hid something". The cap is on ROWS and a
  // batch is one row holding several entries, so the two part company as soon as enough batches sit
  // near the top: measured 2026-09-25, lane B printed all 12 of its READY entries inside 10 rows —
  // three of them batches — and correctly stayed silent, while this test demanded a truncation line
  // for work that was in front of the reader. It failed on a branch whose diff was a CI comment and
  // a backlog entry, which is the tell that the assertion was about the data. Comparing the entries
  // the output actually PRINTS against READY's own count is the behaviour, and it catches the
  // original TN-61 bug too — there, printed really was less than READY and nothing said so.
  it('claims truncation exactly when the cap hid something, in every lane', () => {
    for (const lane of ['A', 'B', 'O', 'DV']) {
      const out = run('--lane', lane)
      const ready = Number(/READY \((\d+)\)/.exec(out)?.[1])
      const shown = printedEntries(out)
      const line = /showing (\d+) of (\d+)/.exec(out)
      expect(shown, `lane ${lane} printed more READY entries than it counted`).toBeLessThanOrEqual(ready)
      if (shown < ready) {
        expect(line, `lane ${lane} printed ${shown} of ${ready} READY and must say what it withheld`).not.toBeNull()
        expect(Number(line![1])).toBe(shown)
        expect(Number(line![2])).toBe(ready)
      } else {
        expect(line, `lane ${lane} printed all ${ready} READY entries and must not claim truncation`).toBeNull()
      }
    }
  })
})

describe('--sittings shows the BLOCKING device work, not only the optional looks', () => {
  // The priority was inverted. `Gate: device` parks an entry — nothing proceeds until the phone
  // answers. `Verify: device` means it shipped and works; the look is owed and blocks nobody. This
  // view listed only the second kind, so it showed 116 optional looks and hid the 24 that were
  // blocking. Measured 2026-09-23: 44 parked on a device gate, 24 invisible here.
  const out = run('--sittings')

  it('has a blocked section, and prints it before the owed list', () => {
    const blocked = out.indexOf('BLOCKED ON A DEVICE CHECK')
    const owed = out.indexOf('DEVICE CHECKS OWED')
    expect(blocked).toBeGreaterThan(-1)
    expect(owed).toBeGreaterThan(-1)
    expect(blocked).toBeLessThan(owed)
  })

  it('counts entries parked on a device gate', () => {
    const n = Number(/BLOCKED ON A DEVICE CHECK \((\d+)\)/.exec(out)?.[1])
    expect(n).toBeGreaterThan(0)
  })

  // The two lists mean different things and a sitting that merges them spends the owner's attention
  // on the wrong half, so an entry must never appear in both.
  it('keeps the two lists disjoint', () => {
    const ids = (block: string) => new Set(block.match(/\b[A-Z]{1,2}-\d+[a-z]?\b/g) ?? [])
    const cut = out.indexOf('DEVICE CHECKS OWED')
    const blocked = ids(out.slice(0, cut))
    const owed = ids(out.slice(cut))
    const both = [...blocked].filter((id) => owed.has(id))
    expect(both, `an entry cannot be both blocked and merely owed: ${both.join(', ')}`).toEqual([])
  })

  it('says plainly that a gate can mean an APK or hardware, not just a look', () => {
    expect(out).toMatch(/APK or hardware/)
  })
})

describe('an assigned-only lane says where its real work is', () => {
  // `--lane DV` returning nothing is by design; saying nothing about the owed checks is not.
  it('points an empty DV lane at the owed device checks', () => {
    const out = run('--lane', 'DV')
    expect(out).toMatch(/\d+ device check\(s\) are owed/)
    expect(out).toContain('--sittings')
  })

  it('gives the Orchestrator the same line, since other roles hand it device work', () => {
    expect(run('--lane', 'O')).toMatch(/\d+ device check\(s\) are owed/)
  })

  // The count must be the whole queue's, not the lane's — that is the entire point of the line.
  it('counts device checks across every lane, not the selected one', () => {
    const dv = Number(/(\d+) device check\(s\)/.exec(run('--lane', 'DV'))?.[1])
    const o = Number(/(\d+) device check\(s\)/.exec(run('--lane', 'O'))?.[1])
    expect(dv).toBe(o)
    expect(dv).toBeGreaterThan(10)
  })
})
