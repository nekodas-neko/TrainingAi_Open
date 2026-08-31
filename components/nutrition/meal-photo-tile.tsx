'use client'

import { useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, Trash2, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@trainingai/shared/utils'
import { dataUrlToBlob, downscaleToDataUrl } from '@/lib/media/downscale-image'
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

/**
 * `@capacitor/camera` reports a cancelled picker by throwing, with no code to test — only a message.
 * Matched loosely on purpose: a message this does not recognise becomes a visible error, which is
 * the safe direction. The reverse default is what hid BF-46 ①.
 */
function isPickerCancellation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /cancel/i.test(message) || /no image (picked|selected)/i.test(message)
}

interface Props {
  /** `null` means no photo. `undefined` from the parent means "not loaded yet" and renders empty. */
  value: string | null | undefined
  /** `null` removes a stored photo; a data URI sets one. */
  onChange: (dataUri: string | null) => void
  disabled?: boolean
  /**
   * `hero` is the full-width band a meal's own screen already draws (BF-46 ①a) — the same control
   * at the size the artboard gives a meal's photo, not a second component. `tile` is the 64 px box.
   *
   * **One component rather than a `MealPhotoHero`, deliberately.** A previous attempt built a
   * separate hero with its own acquisition hook and could not make a picked image reach the
   * component at all; this one's `<input>` path is what `meal-photo-picker.spec.ts` exercises on
   * every run. Growing a size is a smaller change than growing a second implementation.
   */
  variant?: 'tile' | 'hero'
  /** Names the meal in the control's label, so two on one screen are distinguishable to a reader. */
  label?: string
}

export function MealPhotoTile({ value, onChange, disabled, variant = 'tile', label }: Props) {
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
        // **`Base64`, not `DataUrl`, and that is the bug this branch shipped with.** The old code
        // took a data URL and did `await fetch(photo.dataUrl)` to get a Blob — and a `fetch()` of a
        // `data:` URL is governed by `connect-src`, which this app's CSP does not open to `data:`.
        // So it rejected, the catch below read that as a cancelled picker, and choosing a meal
        // photo on the phone did nothing and said nothing (BF-46 ①, three owner reports). Web never
        // hit it: that branch gets a `File` from an `<input>` and fetches nothing, which is why
        // `meal-photo-picker.spec.ts` passes. `capture-actions.tsx` already asks for `Base64`.
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        quality: 80,
        // `width`/`height`, NOT `targetWidth`/`targetHeight` — the latter belong to the sibling
        // `takePhoto(TakePhotoOptions)` and are silently ignored here (capture-step.tsx carries the
        // same note against the same pinned @capacitor/camera). This is a first pass only: the
        // plugin returns JPEG, so the canvas re-encode below is what actually reaches the cap.
        width: THUMB_MAX_DIM * 4,
        height: THUMB_MAX_DIM * 4,
      })
      if (!photo.base64String) return
      const blob = dataUrlToBlob(`data:image/${photo.format || 'jpeg'};base64,${photo.base64String}`)
      await accept(await downscaleToDataUrl(blob, { maxDim: THUMB_MAX_DIM, quality: THUMB_QUALITY, mimeType: 'image/webp' }))
    } catch (err) {
      // A cancel is not an error worth a toast — but everything else is, and swallowing both is how
      // this stayed broken through three reports. The plugin's cancel messages are the only thing
      // that distinguishes them; anything else the user needs to be told about.
      if (!isPickerCancellation(err)) {
        console.error('Meal photo pick failed:', err)
        toast.error('That photo could not be used. Try another one.')
      }
    } finally {
      setBusy(false)
    }
  }

  const bytes = mealImageBytes(value)
  // Named where a name is given. There are two of these — the meal's own screen and the builder —
  // and although a user only ever sees one, both are momentarily in the DOM while the first sheet
  // closes and the second opens. An unnamed label made that window indistinguishable to a test,
  // which fed a picked photo to the screen it was leaving (measured, BF-46 ①a).
  const pickLabel = label
    ? (value ? `Change the photo on ${label}` : `Add a photo to ${label}`)
    : (value ? 'Change meal photo' : 'Add a meal photo')

  // BF-74. Three things were wrong here and only one of them was size.
  //
  // **The position meant the wrong thing.** `meal-detail-sheet` passes `hideCloseButton`, so this
  // was the ONLY ✕ on the screen and it sat `right-0 top-0` — the one corner a user reads as
  // "close this". A reach for dismiss deleted the photo. Moving it to the bottom-right is the fix
  // that matters; making a mislabelled control bigger would only have made it easier to hit by
  // accident. The size badge is bottom-LEFT, so nothing overlaps.
  //
  // **The glyph meant the wrong thing too.** An ✕ is dismissal; a bin is removal. Changing it is
  // half of why the control now reads as what it does, and it costs nothing.
  //
  // **And it was unrecoverable.** The parent saves immediately, so a mis-tap lost the photo. A
  // confirm dialog is the crude answer; undo is the better one, because re-picking is already one
  // tap — the tile is a real picker — so the toast just spares the gallery round-trip.
  const removeButton = value && !busy && (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        const previous = value
        onChange(null)
        toast('Photo removed', { action: { label: 'Undo', onClick: () => onChange(previous) } })
      }}
      aria-label={label ? `Remove the photo from ${label}` : 'Remove meal photo'}
      className={cn(
        'absolute bottom-0 right-0 grid place-items-center rounded-tl-xl bg-background/85 text-muted-foreground active:bg-background',
        // 44 dp on the hero, which is the only variant with call sites. The compact size is kept
        // for `tile` because a 44 dp control on a 64 px thumbnail would cover most of it.
        variant === 'hero' ? 'h-11 w-11' : 'h-8 w-8',
      )}
    >
      <Trash2 className={variant === 'hero' ? 'h-[18px] w-[18px]' : 'h-4 w-4'} />
    </button>
  )

  // A control containing a second control is a div with role=button, never a nested <button> —
  // Samsung's WebView strips the inner one.
  const pickProps = {
    role: 'button' as const,
    tabIndex: disabled ? -1 : 0,
    'aria-label': pickLabel,
    'aria-busy': busy,
    onClick: handlePick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handlePick() }
    },
  }

  // **Named, because this is no longer the only file input on the screens it appears on.** Since
  // BF-46 ①a the builder carries this AND the recipe-picture button's, and a selector as broad as
  // `input[type="file"]` reaches whichever comes first in the DOM — a recipe picture fed to the
  // photo picker fails silently, which is what it did. `recipe-image-button.tsx` is named to match.
  const fileInput = (
    <input
      ref={fileInputRef}
      name="meal-photo"
      type="file"
      accept="image/*"
      capture="environment"
      onChange={handleFile}
      className="hidden"
    />
  )

  if (variant === 'hero') {
    return (
      <div {...pickProps} className="relative mb-4 block h-40 w-full overflow-hidden rounded-2xl active:opacity-90">
        {value ? (
          // A data: URI, so next/image has nothing to fetch or optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          // The row placeholder's band, grown — artboard 4's hero is the tile at scale, not a
          // second design. The gradient is an inline style because it is two CSS variables.
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-2"
            style={{ backgroundImage: 'linear-gradient(140deg, var(--meal-tile-from), var(--meal-tile-to))' }}
          >
            {busy
              ? <Loader2 className="h-6 w-6 animate-spin text-white/70" />
              : <Utensils className="h-8 w-8 text-white/45" strokeWidth={1.6} />}
            <span className="text-xs font-semibold text-white/70">{busy ? 'Reading…' : 'Add a photo'}</span>
          </div>
        )}
        {/* The stored size, the same tripwire the tile carries — nothing else fails loudly when the
            cap slips. Over the image rather than under it, because the hero has no caption row. */}
        {value && !busy && (
          <span className="absolute bottom-0 left-0 rounded-tr-xl bg-background/80 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
            {(bytes / 1024).toFixed(1)} KB
          </span>
        )}
        {removeButton}
        {fileInput}
      </div>
    )
  }

  return (
    <div className="flex-none">
      <div
        {...pickProps}
        className="relative h-16 w-16 grid place-items-center overflow-hidden rounded-xl border border-border bg-muted/50 active:bg-muted/20 transition-colors"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <Camera className="h-5 w-5 text-muted-foreground" />
        )}
        {removeButton}
      </div>

      <p className="mt-1 w-16 text-center text-[9px] leading-tight tabular-nums text-muted-foreground">
        {value
          ? `${(bytes / 1024).toFixed(1)} KB`
          : <span className="inline-flex items-center gap-0.5"><ImagePlus className="h-2.5 w-2.5" /> Photo</span>}
      </p>

      {fileInput}
    </div>
  )
}
