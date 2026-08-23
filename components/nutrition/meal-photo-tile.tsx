'use client'

import { useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { downscaleToDataUrl } from '@/lib/media/downscale-image'
import { mealImageBytes, rejectMealImage, mealImageRejectionMessage } from '@trainingai/shared/nutrition/meal-image'

/**
 * The meal photo, picked and previewed in one 64 px tile (Q-327).
 *
 * The storage half shipped with Q-396 and nothing could reach it: `saved_meals.image_data_uri`
 * round-trips through both routes, the outbox replay and the local mirror, but no screen offered a
 * way to choose a picture. This is that screen — beside the meal-name field in Edit Meal, so the
 * photo rides the save that is already there rather than needing a write of its own.
 *
 * **The downscale is the feature, not a nicety.** The server rejects anything over
 * `SAVED_MEAL_IMAGE_MAX_BYTES`, and a phone photo is two orders of magnitude past that — without
 * this every pick would be a 400 and the feature would read as broken. 128 px WebP lands around
 * 6 KB, which is the number that cap was sized against.
 *
 * **The byte figure is deliberate.** Nothing fails loudly when the cap slips: an oversized image is
 * rejected by the server and the outbox simply carries a heavier row. A number on the tile is the
 * cheapest tripwire, and it is `mealImageBytes` — the same arithmetic the server rejects on.
 */
const THUMB_MAX_DIM = 128
const THUMB_QUALITY = 0.8

interface Props {
  /** `null` means no photo. `undefined` from the parent means "not loaded yet" and renders empty. */
  value: string | null | undefined
  /** `null` removes a stored photo; a data URI sets one. */
  onChange: (dataUri: string | null) => void
  disabled?: boolean
}

export function MealPhotoTile({ value, onChange, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function accept(dataUri: string) {
    const reject = rejectMealImage(dataUri)
    if (reject) {
      // Checked here as well as on the server so the user hears about it while the picker is still
      // in mind, rather than as a failed save several taps later.
      toast.error(mealImageRejectionMessage(reject))
      return
    }
    onChange(dataUri)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await accept(await downscaleToDataUrl(file, { maxDim: THUMB_MAX_DIM, quality: THUMB_QUALITY, mimeType: 'image/webp' }))
    } catch {
      toast.error('That image could not be read. Try another photo.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePick() {
    if (disabled || busy) return
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) {
      fileInputRef.current?.click()
      return
    }
    setBusy(true)
    try {
      const { Camera: CapCamera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await CapCamera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
        quality: 80,
        // `width`/`height`, NOT `targetWidth`/`targetHeight` — the latter belong to the sibling
        // `takePhoto(TakePhotoOptions)` and are silently ignored here (capture-step.tsx carries the
        // same note against the same pinned @capacitor/camera). This is a first pass only: the
        // plugin returns JPEG, so the canvas re-encode below is what actually reaches the cap.
        width: THUMB_MAX_DIM * 4,
        height: THUMB_MAX_DIM * 4,
      })
      if (!photo.dataUrl) return
      const blob = await (await fetch(photo.dataUrl)).blob()
      await accept(await downscaleToDataUrl(blob, { maxDim: THUMB_MAX_DIM, quality: THUMB_QUALITY, mimeType: 'image/webp' }))
    } catch {
      // Cancelling the picker throws, and a cancel is not an error worth a toast.
    } finally {
      setBusy(false)
    }
  }

  const bytes = mealImageBytes(value)

  return (
    <div className="flex-none">
      {/* A tile containing a second control is a div with role=button, never a nested <button> —
          Samsung's WebView strips the inner one. */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={value ? 'Change meal photo' : 'Add a meal photo'}
        aria-busy={busy}
        onClick={handlePick}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handlePick() }
        }}
        className="relative h-16 w-16 grid place-items-center overflow-hidden rounded-xl border border-border bg-muted/50 active:bg-muted/20 transition-colors"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : value ? (
          // A data: URI, so next/image has nothing to fetch or optimise and would need a loader
          // exemption to accept it at all.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <Camera className="h-5 w-5 text-muted-foreground" />
        )}

        {value && !busy && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange(null) }}
            aria-label="Remove meal photo"
            className="absolute right-0 top-0 grid h-6 w-6 place-items-center rounded-bl-xl bg-background/85 text-muted-foreground active:bg-background"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <p className="mt-1 w-16 text-center text-[9px] leading-tight tabular-nums text-muted-foreground">
        {value
          ? `${(bytes / 1024).toFixed(1)} KB`
          : <span className="inline-flex items-center gap-0.5"><ImagePlus className="h-2.5 w-2.5" /> Photo</span>}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}
