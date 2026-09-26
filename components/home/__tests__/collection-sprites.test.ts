import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { LADDERS } from '@trainingai/shared/collection/ladder'
import { tierArt, classArt, tierGlyph, ART_TIERS, LADDER_CLASS, CAT_CLASSES, CAT_VARIANTS } from '../collection-sprites'
import { penCats } from '../collection-pen-cats'
import { renderAll } from '../../../scripts/collection-art/build.mjs'

const CATS = path.join(__dirname, '../../../public/cats')
type Faucet = keyof typeof LADDERS
const state = (stock: number[]) => ({ stock, duplicateDays: 0, decayEvents: 0 })

describe('the drawn cats (BF-126)', () => {
  it('are the generator output — an edit to the art source without a rebuild fails here', () => {
    const files = renderAll() as Record<string, string>
    // Seven classes × six tiers × (plain + three variants), plus the pen's twelve backdrop scenes.
    expect(Object.keys(files)).toHaveLength(CAT_CLASSES.length * ART_TIERS * (1 + CAT_VARIANTS.length) + 12)
    for (const [name, body] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(CATS, name), 'utf8'), `${name} is stale — run node scripts/collection-art/build.mjs`).toBe(body)
    }
  })

  it('cover every tier of every ladder, plain and shiny, with a file behind each path', () => {
    for (const [faucet, ladder] of Object.entries(LADDERS)) {
      ladder.tiers.forEach((_, i) => {
        for (const variant of [undefined, ...CAT_VARIANTS]) {
          const src = tierArt(faucet as Faucet, i, variant)
          expect(src, `${faucet}[${i}]`).toBeTruthy()
          expect(fs.existsSync(path.join(CATS, path.basename(src!))), src!).toBe(true)
        }
      })
    }
  })

  it('exist for every class, tier and variant in the catalogue, including classes with no ladder yet', () => {
    for (const cls of CAT_CLASSES) {
      for (let t = 0; t < ART_TIERS; t++) {
        for (const variant of [undefined, ...CAT_VARIANTS]) {
          const src = classArt(cls, t, variant)!
          expect(fs.existsSync(path.join(CATS, path.basename(src))), src).toBe(true)
        }
      }
    }
  })

  it('give each ladder its own class, so three ladders never draw the same cat', () => {
    expect(new Set(Object.values(LADDER_CLASS)).size).toBe(Object.keys(LADDERS).length)
  })

  it('return no art past the drawn set, which leaves CatSprite on the glyph', () => {
    expect(tierArt('workout', ART_TIERS)).toBeNull()
    expect(tierArt('workout', -1)).toBeNull()
    expect(tierGlyph('workout', 0)).toBeTruthy()
  })
})

describe('the pen', () => {
  it('draws one cat per held item, biggest tiers first', () => {
    const { shown, total } = penCats({ workout: state([2, 0, 1]), steps: state([0, 1]) })
    expect(total).toBe(4)
    expect(shown.map(c => c.tier)).toEqual([2, 1, 0, 0])
  })

  it('caps what it draws but still counts everything, so the card can say how many more', () => {
    const { shown, total } = penCats({ workout: state([20, 3, 1]) })
    expect(total).toBe(24)
    expect(shown).toHaveLength(12)
    expect(shown[0].tier).toBe(2)
  })

  it('gives every cat a stable identity, so a re-render does not reshuffle the pen', () => {
    const a = penCats({ workout: state([3]) }).shown.map(c => c.id)
    const b = penCats({ workout: state([3]) }).shown.map(c => c.id)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(3)
  })

  it('draws nothing for an empty collection', () => {
    expect(penCats({}).total).toBe(0)
  })
})
