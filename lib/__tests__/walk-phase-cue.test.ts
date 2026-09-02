import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { shouldCuePhaseChange, phaseCueHaptic } from '@/lib/walk/walk-phase-cue'
import { buildIntervalPlan, segmentAt, DEFAULT_WALK_CONFIG } from '@/lib/walk/interval-plan'

/**
 * BF-105 — the interval-walk phase change had no in-app cue at all.
 *
 * The two decisions are pure and are driven directly. The wiring is asserted against source,
 * because the screen needs a canvas, a live-HR manager and a GPS watcher to render and both
 * vitest projects run `environment: 'node'`.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const stripped = (rel: string) => source(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('when a cue fires', () => {
  it('stays silent on the first resolve, so opening the screen is not a phase change', () => {
    // Including a walk already in progress that is resumed after the app is reopened — the
    // screen mounts with an active segment, and buzzing there announces a change that did
    // not happen.
    expect(shouldCuePhaseChange(null, 0)).toBe(false)
    expect(shouldCuePhaseChange(null, 4)).toBe(false)
  })

  it('fires once per boundary, not once per render', () => {
    expect(shouldCuePhaseChange(0, 1)).toBe(true)
    expect(shouldCuePhaseChange(1, 1)).toBe(false)
  })

  it('stays silent once the plan has run out', () => {
    expect(shouldCuePhaseChange(6, null)).toBe(false)
  })
})

describe('which haptic', () => {
  it('gives fast the stronger pattern and everything else the light one', () => {
    // Through a pocket the pattern is the whole signal: the notification's text is unreadable
    // and both directions post to one channel with one sound.
    expect(phaseCueHaptic('fast')).toBe('strong')
    expect(phaseCueHaptic('slow')).toBe('light')
    expect(phaseCueHaptic('warmup')).toBe('light')
    expect(phaseCueHaptic('cooldown')).toBe('light')
  })

  it('alternates across a real plan, so consecutive boundaries never feel the same', () => {
    const plan = buildIntervalPlan({ ...DEFAULT_WALK_CONFIG, sets: 3, fastSec: 60, slowSec: 60 })
    const felt = plan.segments.map(seg => phaseCueHaptic(seg.kind))
    expect(felt.length).toBeGreaterThan(1)
    for (let i = 1; i < felt.length; i++) expect(felt[i]).not.toBe(felt[i - 1])
  })

  it('resolves the kind from the segment the screen is showing, not from a set counter', () => {
    // A set is slow-then-fast (`buildIntervalPlan`), so a walk OPENS on the light cue.
    const plan = buildIntervalPlan({ ...DEFAULT_WALK_CONFIG, sets: 2, fastSec: 60, slowSec: 30 })
    const at = (sec: number) => phaseCueHaptic(segmentAt(plan, sec)!.segment.kind)
    expect(at(0)).toBe('light')
    expect(at(29)).toBe('light')
    expect(at(30)).toBe('strong')
    expect(at(89)).toBe('strong')
    expect(at(90)).toBe('light')
  })
})

describe('the screen wires both halves in', () => {
  const walkActive = () => stripped('components/guided-walk/walk-active.tsx')

  it('drives the haptic off the segment index, and picks it with phaseCueHaptic', () => {
    // Pinned as one pattern: a split assertion passes against a disabled branch, because the
    // strings survive the condition being turned off.
    expect(walkActive()).toMatch(
      /shouldCuePhaseChange\(cuedIndexRef\.current, segmentIndex\)\)\s*\{\s*if \(phaseCueHaptic\(kind\) === 'strong'\) hapticSuccess\(\); else hapticLight\(\)/,
    )
  })

  it('advances the last-cued index on every resolve, not only when it fired', () => {
    // Advancing inside the `if` leaves the ref null forever, so the first change is silent and
    // every one after it fires against a stale index.
    expect(walkActive()).toMatch(/\}\s*cuedIndexRef\.current = segmentIndex\s*\}, \[segmentIndex/)
  })

  it('renders the flash keyed on the cued segment, inside a positioned container', () => {
    const src = walkActive()
    expect(src).toMatch(/<PhaseChangeFlash cueKey=\{cue\?\.index \?\? null\} color=\{cue\?\.color/)
    // `absolute inset-0` resolves against the nearest positioned ancestor; without `relative`
    // here the wash escapes to the viewport and paints over the tab bar.
    expect(src).toMatch(/<div className="relative flex h-full flex-col/)
  })

  it('scales the phase word in on a change rather than swapping it', () => {
    expect(walkActive()).toMatch(
      /<motion\.p\s+key=\{segmentIndex \?\? 'none'\}[\s\S]{0,240}?initial=\{reducedMotion \? false : \{ scale: 0\.72, opacity: 0 \}\}/,
    )
  })
})

describe('the flash', () => {
  const flash = () => stripped('components/guided-walk/phase-change-flash.tsx')

  it('renders nothing until a change has actually been cued', () => {
    expect(flash()).toMatch(/if \(cueKey === null\) return null/)
  })

  it('keeps the centre clear, so the wash never dims the readout it is pointing at', () => {
    expect(flash()).toMatch(/radial-gradient\(circle at 50% 45%, transparent 25%/)
  })

  it('still fires under reduced motion, longer rather than not at all', () => {
    // A functional indicator keeps its state and loses its motion — and this one IS the state.
    const src = flash()
    expect(src).toMatch(/duration: reduced \? 1\.1 : 0\.8/)
    expect(src).not.toMatch(/if \(reduced\) return null/)
  })
})

describe('the corrected comment', () => {
  it('no longer claims an in-app timer covers a failed schedule', () => {
    // It sent a reader looking for a path that did not exist, which is how BF-105 read as handled.
    expect(source('lib/walk/walk-cues.ts')).not.toContain('the in-app timer still drives cues when foregrounded')
  })
})
