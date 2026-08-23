import { describe, it, expect } from 'vitest'
import { fitWithin, base64FromDataUrl } from '../downscale-image'

describe('fitWithin (BF-4)', () => {
  /**
   * The bug the shared helper exists to stop repeating. `feedback-sheet`'s local copy scaled by
   * `MAX_WIDTH / img.width`, so a portrait image — which is what a phone camera and this app's own
   * 412 × 915 screenshots produce — kept its full height and most of its bytes.
   */
  it('fits the LONGEST edge, so a portrait photo is bounded by its height', () => {
    expect(fitWithin(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 })
  })

  it('fits a landscape photo by its width', () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 })
  })

  it('keeps the aspect ratio to within a rounded pixel', () => {
    const src = { w: 4032, h: 3024 }
    const out = fitWithin(src.w, src.h, 1024)
    expect(Math.abs(out.width / out.height - src.w / src.h)).toBeLessThan(0.01)
  })

  it('never upscales — a small image comes back its own size', () => {
    // Guards the `Math.min(1, …)`. Without it a 320 px thumbnail would be blown up to 1024 and
    // re-encoded, arriving LARGER than the original on a path whose whole job is bounding bytes.
    expect(fitWithin(320, 240, 1024)).toEqual({ width: 320, height: 240 })
  })

  it('leaves an image already exactly at the bound alone', () => {
    expect(fitWithin(1024, 1024, 1024)).toEqual({ width: 1024, height: 1024 })
  })

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    // 2000 × 3 scaled to fit 1024 gives a height of 1.5 → rounds to 2, and a 0-height canvas
    // throws. The `Math.max(1, …)` is what stops that.
    const out = fitWithin(2000, 3, 1024)
    expect(out.width).toBe(1024)
    expect(out.height).toBeGreaterThanOrEqual(1)
  })
})

describe('base64FromDataUrl', () => {
  it('drops the data-URL prefix and nothing else', () => {
    expect(base64FromDataUrl('data:image/jpeg;base64,AAECAw==')).toBe('AAECAw==')
  })

  it('splits on the FIRST comma, so base64 padding and content survive', () => {
    // `split(',')[1]` — the shape this replaced — would truncate at a comma inside the payload.
    // Base64 has no comma in its alphabet, but the prefix does when a charset is declared.
    expect(base64FromDataUrl('data:image/jpeg;charset=utf-8;base64,QUJD')).toBe('QUJD')
  })
})
