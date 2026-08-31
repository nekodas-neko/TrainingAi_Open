'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { downscaleToJpegDataUrl, base64FromDataUrl, SCAN_IMAGE_MAX_DIM } from '@/lib/media/downscale-image'

interface Props {
  importing: boolean
  onPick: (image: string, mimeType: string) => void
  /**
   * `'tile'` draws it as one third of the builder's source row (BF-52) instead of a full-width
   * descriptive button.
   *
   * A prop rather than a second component, because everything worth having here is the *picking* —
   * the Capacitor `CameraSource.Prompt` branch, the downscale, and the named file input that stops
   * the meal-photo picker swallowing the pick. Re-implementing that chrome-first would re-implement
   * all of it.
   *
   * The tile is labelled **Recipe photo**, never just "Photo". BF-40's own note is that *"a
   * screenshot of a recipe and a photograph of your dinner are different acts with different
   * outputs, and one tile that guesses between them will guess wrong"* — in a row of three tiles the
   * label is the only thing left carrying that distinction.
   */
  variant?: 'row' | 'tile'
}

/**
 * Hand the builder a recipe as a picture (BF-40).
 *
 * The owner's case is a Google AI overview — the ingredients are rendered into Google's own results
 * page with the source behind a chip — so there is **no recipe URL to paste** and the image is the
 * only handle on that content. It sits beside the URL path, in the builder, because the owner asked
 * for "the meal creator": a screenshot of a recipe and a photograph of your dinner are different
 * acts with different outputs (a saved meal versus a logged food), and one tile that guesses between
 * them will guess wrong.
 *
 * **No `capture` attribute, and `CameraSource.Prompt` on device.** `capture="environment"` forces the
 * camera, and a screenshot lives in the gallery — it would have made the owner's own example
 * unreachable. Prompt covers both things people mean by an image of ingredients: a written list, and
 * the raw ingredients laid out.
 */
export function RecipeImageButton({ importing, onPick, variant = 'row' }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      // Downscaled before it becomes a payload, not after (BF-4) — the same path the photo scan
      // takes, through the same helper, so the two cannot disagree about what the model can read.
      const dataUrl = await downscaleToJpegDataUrl(file, { maxDim: SCAN_IMAGE_MAX_DIM })
      setError(null)
      onPick(base64FromDataUrl(dataUrl), 'image/jpeg')
    } catch {
      setError('That image could not be read. Try another one.')
    }
  }

  async function pick() {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) {
      fileInputRef.current?.click()
      return
    }
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        // Prompt, not Camera: a recipe screenshot is in the gallery.
        source: CameraSource.Prompt,
        quality: 80,
        // `width`/`height`, NOT `targetWidth`/`targetHeight` — the wrong pair type-checks and is
        // silently ignored at runtime (verified against the pinned @capacitor/camera source, per
        // CLAUDE.md's external-field-names rule). Same note as `capture-actions.tsx`.
        width: SCAN_IMAGE_MAX_DIM,
        height: SCAN_IMAGE_MAX_DIM,
      })
      if (!photo.base64String) return
      setError(null)
      onPick(photo.base64String, photo.format === 'png' ? 'image/png' : 'image/jpeg')
    } catch {
      // A cancelled picker throws here too, so this must not read as a failure.
      setError(null)
    }
  }

  return (
    <>
      {/* **Named, because it is no longer the only file input on this screen.** BF-46 ①a put the
          meal's photo picker at the top of the builder, so a selector as broad as
          `input[type="file"]` now reaches that one first — and a recipe picture fed to the photo
          picker fails silently, which is what it did. `meal-photo-tile.tsx` carries the same note
          and the matching name. */}
      <input
        ref={fileInputRef}
        name="recipe-picture"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => void handleFile(e)}
      />
      {variant === 'tile' ? (
        // Wrapped in its own column, because the parent is a `flex` row of three tiles and a bare
        // error paragraph would become a fourth item in it.
        <div className="flex flex-1 flex-col gap-1">
        <button
          onClick={() => void pick()}
          disabled={importing}
          // Padding-driven height, matching the Log Food capture tiles BF-73 measured at 79 px. No
          // `min-h-[Npx]`: it is inert on a button here, because `globals.css` sets a bare
          // element-selector floor that beats the utility.
          className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border/60 bg-background/50 px-1 py-3.5 active:bg-muted/40 disabled:opacity-50"
        >
          {importing
            ? <Loader2 className="h-7 w-7 animate-spin text-brand" />
            : <ImagePlus className="h-7 w-7 text-muted-foreground" />}
          <span className="text-xs font-medium">Recipe photo</span>
        </button>
        {error && <p className="text-[11px] leading-snug" style={{ color: 'var(--accent-amber)' }}>{error}</p>}
        </div>
      ) : (
        <button
          onClick={() => void pick()}
          disabled={importing}
          className="w-full min-h-[48px] flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-left active:bg-muted/30 disabled:opacity-50"
        >
          {importing
            ? <Loader2 className="h-4 w-4 animate-spin flex-none text-brand" />
            : <ImagePlus className="h-4 w-4 flex-none text-muted-foreground" />}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {importing ? 'Reading that recipe…' : 'Build from a recipe picture'}
            </span>
            <span className="block text-[11px] leading-snug text-muted-foreground">
              A screenshot of an ingredient list, or the ingredients laid out. Every one is added at its
              own weight.
            </span>
          </span>
        </button>
      )}
      {variant === 'row' && error && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--accent-amber)' }}>{error}</p>
      )}
    </>
  )
}
