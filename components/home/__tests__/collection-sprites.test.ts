import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { LADDERS } from '@trainingai/shared/collection/ladder'
import { tierArt, tierGlyph, ART_TIERS, LADDER_CLASS } from '../collection-sprites'
import { renderAll } from '../../../scripts/collection-art/build.mjs'

const CATS = path.join(__dirname, '../../../public/cats')
type Faucet = keyof typeof LADDERS

describe('the drawn cats (BF-126)', () => {
  it('are the generator output — an edit to the art source without a rebuild fails here', () => {
    const files = renderAll() as Record<string, string>
    expect(Object.keys(files)).toHaveLength(4 * ART_TIERS)
    for (const [name, body] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(CATS, name), 'utf8'), `${name} is stale — run node scripts/collection-art/build.mjs`).toBe(body)
    }
  })

  it('cover every tier of every ladder, with a file behind each path', () => {
    for (const [faucet, ladder] of Object.entries(LADDERS)) {
      ladder.tiers.forEach((_, i) => {
        const src = tierArt(faucet as Faucet, i)
        expect(src, `${faucet}[${i}]`).toBeTruthy()
        expect(fs.existsSync(path.join(CATS, path.basename(src!))), src!).toBe(true)
      })
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
