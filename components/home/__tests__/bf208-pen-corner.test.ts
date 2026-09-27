import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

/**
 * BF-208 — nothing in a pen backdrop may look like a control.
 *
 * The owner, pointing at the Home collection card: *"there is that button on the widget the white
 * circle"* — and then, after a wrong first trace, *"No not the ai coach white button; its the one
 * on the collection widget."* It was **the moon**: a 28 px near-white disc at full opacity, in the
 * upper-right corner of a night sky, which is the one screen position that means "control".
 *
 * Four things converged and the fix breaks two — the disc is softened AND moved off the corner.
 * This holds the corner empty for the next scene somebody draws, which is the half a one-file fix
 * would have left open: `public/cats/` holds twelve backdrops and three had this shape.
 */
const SCENES = join(__dirname, '..', '..', '..', 'public', 'cats')
/** The pen's viewBox is 360×150 and it renders near 1:1 into a ~348 px card. */
const CORNER_X = 240
const CORNER_Y = 60
/** Below this a disc is scenery, not a target: the app's icon buttons are 40–56 px across. */
const BUTTON_R = 6
/** Full-strength fill is what made the moon the brightest thing on the card, text included. */
const LOUD = 0.9

const circles = (svg: string) =>
  [...svg.matchAll(/<circle[^>]*\/>/g)].map(m => {
    const attr = (name: string) => {
      const hit = new RegExp(`\\b${name}="([-\\d.]+)"`).exec(m[0])
      return hit ? Number(hit[1]) : null
    }
    return { raw: m[0], cx: attr('cx'), cy: attr('cy'), r: attr('r'), opacity: attr('opacity') ?? 1 }
  })

describe('BF-208 — the pen backdrops', () => {
  const files = readdirSync(SCENES).filter(f => f.startsWith('scene-') && f.endsWith('.svg'))

  it('finds the scenes, or this guard is checking nothing', () => {
    expect(files.length).toBeGreaterThanOrEqual(12)
  })

  it.each(files)('%s has no bright, hard-edged disc in the top-right corner', file => {
    const svg = stripComments(readFileSync(join(SCENES, file), 'utf8')) as string
    const offenders = circles(svg).filter(c =>
      c.cx != null && c.cy != null && c.r != null &&
      c.r >= BUTTON_R && c.cx > CORNER_X && c.cy < CORNER_Y && Number(c.opacity) >= LOUD)
    expect(offenders.map(o => o.raw), `${file} draws something that reads as a button`).toEqual([])
  })
})
