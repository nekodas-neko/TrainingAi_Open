/**
 * Scale an image down to fit a box, and hand back a JPEG data URL.
 *
 * **Extracted rather than copied (BF-4).** Two hand-rolled versions of this already existed — the
 * avatar crop in `more/profile-tab.tsx` and the screenshot compressor in `more/feedback-sheet.tsx` —
 * and the nutrition scan needed a third. `CLAUDE.md`: any pattern at ≥2 sites is extracted before a
 * third copy.
 *
 * **It fits within BOTH dimensions, which the copies did not.** `feedback-sheet` scaled by width
 * alone (`MAX_WIDTH / img.width`), so a tall portrait photo — the shape a phone camera produces —
 * kept its full height and most of its bytes. Fitting the longest edge is the behaviour every caller
 * actually wanted.
 *
 * **It never upscales.** `Math.min(1, …)` means an image already inside the box is re-encoded at the
 * requested quality and not stretched, so a small photo cannot come back larger than it went in.
 *
 * **It revokes the object URL.** Both copies leaked one per call.
 */
/**
 * Longest edge for an image posted to `/api/nutrition/scan`, in pixels (BF-4).
 *
 * **Chosen from the token budget, not from taste.** Every image scan in a month of production
 * reports 1,275–1,298 input tokens regardless of the photo's size, because Gemini normalises an
 * image to a fixed tile budget before the model sees it. A 4 MB photo and a 400 KB photo therefore
 * do the same model work — the extra bytes buy no accuracy and are pure upload latency. 1024 sits
 * comfortably above the tiles that budget covers while bounding an S25's 12 MP capture, which is
 * otherwise ~4000 px wide plus base64's ~33%.
 *
 * **Shared since BF-40 gave that route a second caller** — the meal builder's recipe-picture import,
 * beside the Log Food photo scan. Two constants would let the paths disagree about how much of a
 * photo survives, which is a silent difference in what the model can read rather than a visible one.
 */
export const SCAN_IMAGE_MAX_DIM = 1024

export interface DownscaleOptions {
  /** Longest edge of the result, in pixels. The aspect ratio is kept. */
  maxDim: number
  /** Encoder quality, 0–1. Defaults to 0.8. */
  quality?: number
  /**
   * Output format. Defaults to JPEG.
   *
   * WebP is roughly half the bytes at the same visible quality, which is what makes a meal
   * thumbnail fit inside `SAVED_MEAL_IMAGE_MAX_BYTES` (Q-327). It is **requested, not guaranteed**:
   * a browser that cannot encode it returns a PNG from `toDataURL` **without erroring**, and a PNG
   * of the same picture is several times larger than the JPEG would have been — so an unnoticed
   * fallback is how a thumbnail sails past the cap. `downscaleToDataUrl` checks what actually came
   * back and re-encodes as JPEG when the request was ignored.
   */
  mimeType?: 'image/jpeg' | 'image/webp'
}

/**
 * Target pixel size for an image of `width` × `height` fitted inside a `maxDim` box.
 *
 * Split out from the canvas work so it can be tested at all: both vitest projects run in `node`,
 * where `Image` and `canvas` do not exist. It is also where the bug was — the copy this replaced
 * divided by `img.width` alone, so the arithmetic is the part worth pinning.
 */
export function fitWithin(width: number, height: number, maxDim: number): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Fit an image inside `maxDim` and return a JPEG data URL. */
export function downscaleToJpegDataUrl(source: Blob, opts: DownscaleOptions): Promise<string> {
  return downscaleToDataUrl(source, { ...opts, mimeType: 'image/jpeg' })
}

export function downscaleToDataUrl(source: Blob, { maxDim, quality = 0.8, mimeType = 'image/jpeg' }: DownscaleOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(source)
    const img = new Image()
    const done = (fn: () => void) => { URL.revokeObjectURL(objectUrl); fn() }

    img.onload = () => {
      try {
        const size = fitWithin(img.width, img.height, maxDim)
        const canvas = document.createElement('canvas')
        canvas.width = size.width
        canvas.height = size.height
        const ctx = canvas.getContext('2d')
        // Null when the browser refuses a context — out of memory on a very large decode, or a
        // hardened profile. Rejecting is honest; `!` would throw one line later with a worse message.
        if (!ctx) { done(() => reject(new Error('canvas 2d context unavailable'))); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        let dataUrl = canvas.toDataURL(mimeType, quality)
        // `toDataURL` answers an unsupported type with a PNG rather than an error, and a PNG here is
        // several times the bytes a caller sized its cap against.
        if (!dataUrl.startsWith(`data:${mimeType}`)) dataUrl = canvas.toDataURL('image/jpeg', quality)
        done(() => resolve(dataUrl))
      } catch (err) {
        done(() => reject(err))
      }
    }
    img.onerror = () => done(() => reject(new Error('image could not be decoded')))
    img.src = objectUrl
  })
}

/** Base64 payload of a `data:` URL, without the `data:…;base64,` prefix. */
export function base64FromDataUrl(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}
