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

describe('next-item does not stay silent about what it withheld (TN-61)', () => {
  it('names the withheld count whenever READY is truncated', () => {
    const out = run('--lane', 'A')
    const readyCount = Number(/READY \((\d+)\)/.exec(out)?.[1])
    expect(readyCount).toBeGreaterThan(0)

    if (readyCount > 10) {
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

  // Asserted on the truncation LINE, not the bare word: this originally searched for "showing"
  // anywhere in the output and went red the day the DV lane gained entries, because RV-128 is titled
  // "does the tab switch drop a frame showing neither panel?". A substring assertion over a report
  // that prints user-written titles is a false positive waiting for someone to write the word.
  it('does not claim truncation when everything fits', () => {
    const out = run('--lane', 'DV')
    const ready = Number(/READY \((\d+)\)/.exec(out)?.[1])
    expect(ready).toBeLessThanOrEqual(10)
    expect(out).not.toMatch(/showing \d+ of \d+/)
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
