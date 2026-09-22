import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

/**
 * Source with comments removed.
 *
 * The assertions below are about what the file DOES. Written against the raw text, the first draft
 * failed on this file's own comment explaining where the read went — prose naming a symbol is not a
 * call to it, and a test that cannot tell the difference punishes documenting the change.
 */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CHART = 'components/workout/live-hr-chart.tsx'
/** The two screens that render the chart and stay mounted while it comes and goes. */
const OWNERS = [
  'components/workout/active-workout-screen.tsx',
  'components/workout/exercise-summary-screen.tsx',
]

/**
 * RV-64 — the HR profile is read by the screens, not by the chart.
 *
 * `LiveHrChart` read `hr-profile` in a mount-once effect, and `active-workout-screen` renders it on
 * `workoutPhase === "rest"`. So it remounted **once per rest period**: a 5x4 workout paid a ~230 ms
 * route around twenty times *during the workout*, against the same ten-connection pool as
 * `log-exercise` and `complete-workout`, and `/api/hr-profile`'s 20-per-60s limit meant a dense rest
 * cadence could make the chart 429 itself.
 *
 * **This is a structural test, and that is deliberate rather than a shortcut.** The repo has no
 * React render harness — `lib/hooks/__tests__/use-invalidation-refetch.test.ts` is the established
 * shape for "which module is allowed to do this", and the property here is exactly that: the chart
 * must not own the read, and the screens that outlive it must. No spec drives the active workout
 * through a rest period, so counting real requests would mean building that fixture first.
 *
 * **What it therefore cannot see:** the request count on a running app. The claim "one call per
 * workout instead of ~20" follows from the chart not fetching plus the owner outliving it, and the
 * second half is read here off the source rather than observed. The entry keeps a device item.
 */
describe('RV-64 — the hr-profile read is hoisted out of the remounting chart', () => {
  it('the chart does not read hr-profile at all', () => {
    const src = read(CHART)
    // The URL, not the word: the chart still imports `HrProfileResponse` as a TYPE from
    // `@/app/api/hr-profile/route`, which is the prop's shape and not a read. An earlier draft of
    // this assertion matched /hr-profile/ and failed on that import — the test was wrong, the code
    // was right, and the narrower match is the one that means anything.
    expect(src, 'live-hr-chart fetches hr-profile again — it remounts once per rest period')
      .not.toMatch(/['"`]\/api\/hr-profile/)
    // Named separately because the defect could come back as either: the fetch, or a bare read.
    expect(code(CHART), 'live-hr-chart calls the cache directly again')
      .not.toMatch(/cachedFetch|readCacheSync|useHrProfile/)
  })

  it('the chart takes the profile as a prop instead', () => {
    const src = read(CHART)
    expect(src, 'the chart no longer accepts a profile, so nothing can hand it one')
      .toMatch(/profile:\s*HrProfileResponse\s*\|\s*null/)
  })

  it('both screens that render it own the read, and pass it down', () => {
    for (const rel of OWNERS) {
      const src = read(rel)
      expect(src, `${rel} renders LiveHrChart but does not read the profile`)
        .toMatch(/useHrProfile\(\)/)
      // The prop, at the call site — a hook call with the value dropped on the floor would
      // otherwise satisfy the line above while the chart still had nothing to draw zones from.
      expect(src, `${rel} renders LiveHrChart without handing it the profile`)
        .toMatch(/<LiveHrChart[^>]*profile=\{/)
    }
  })

  it('every LiveHrChart call site in the app is one of those two', () => {
    // A third mount added later would reintroduce the defect silently: it would compile, render,
    // and draw no zones, because the prop has no default.
    const found: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx$/.test(e.name)) {
          const rel = path.relative(root, p).replace(/\\/g, '/')
          if (rel !== CHART && /<LiveHrChart\b/.test(fs.readFileSync(p, 'utf8'))) found.push(rel)
        }
      }
    }
    for (const d of ['app', 'components']) walk(path.join(root, d))
    expect(found.sort()).toEqual([...OWNERS].sort())
  })
})
