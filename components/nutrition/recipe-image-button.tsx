'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { downscaleToJpegDataUrl, base64FromDataUrl, SCAN_IMAGE_MAX_DIM } from '@/lib/media/downscale-image'

interface Props {
  importing: boolean
  onPick: (image: string, mimeType: string) => void
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
export function RecipeImageButton({ importing, onPick }: Props) {
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => void handleFile(e)}
      />
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
      {error && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--accent-amber)' }}>{error}</p>
      )}
    </>
  )
}
