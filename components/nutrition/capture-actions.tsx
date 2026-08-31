'use client'

import { useRef, useState } from 'react'
import { Camera as CameraIcon, Hash, PenLine, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BarcodeScanner } from './barcode-scanner'
import type { NutritionScanResult } from '@trainingai/shared/types/nutrition'
import { decodeMealLabelToken } from '@trainingai/shared/nutrition/label-payload'
import { downscaleToJpegDataUrl, base64FromDataUrl, SCAN_IMAGE_MAX_DIM } from '@/lib/media/downscale-image'

interface Props {
  onScanResult: (result: NutritionScanResult) => void
  onManual: () => void
  /** A scanned saved-meal label (Q-389). The parent owns the logging, since it already holds the
   *  date, the meal-type bucket and the onLogged callback. */
  onScannedSavedMeal?: (mealId: string) => void
  /**
   * What the screen shows when no capture is in progress — the search, the tabs and the list.
   *
   * Composed as children rather than coordinated through a `busy` callback because there is then
   * exactly one source of truth for "am I mid-capture". A boolean lifted to the parent would be a
   * second copy of the state below, and the failure it invites is the tabs still showing behind a
   * half-open camera.
   */
  children: React.ReactNode
}

/**
 * The three ways to capture a food, and every mode one of them opens (LB-16).
 *
 * **This replaced a five-tile grid** — `Scan Photo` · `Barcode` · `Describe it` · `Manual Entry` ·
 * `My Foods` — which asked "how would you like to log food?" before showing any food. The list is
 * now the screen and these are the alternates, which is the shape artboard 2 draws.
 *
 * **Describe and manual entry are one panel, both fields visible.** They were two tiles leading to
 * two screens, and the difference between them — whether you type a sentence or type the macros —
 * is not a decision anyone can make before seeing the fields. The owner's decided action row calls
 * the pair `Describe or enter` for the same reason.
 */
export function CaptureActions({ onScanResult, onManual, onScannedSavedMeal, children }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [describeText, setDescribeText] = useState('')
  const [showDescribe, setShowDescribe] = useState(false)
  const [showBarcode, setShowBarcode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two different outcomes, deliberately two states: 'missing' means OFF answered and does not have
  // this product; 'unavailable' means OFF did not answer. Telling the user their food is unknown
  // when the database is down sends them off to type it in by hand for no reason.
  const [barcodeOutcome, setBarcodeOutcome] = useState<null | 'missing' | 'unavailable'>(null)
  const [pendingPhoto, setPendingPhoto] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null)
  const [photoNote, setPhotoNote] = useState('')

  async function callScan(body: object) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error ?? 'Could not identify food. Try describing it manually.')
        return
      }
      onScanResult(data as NutritionScanResult)
    } catch {
      setError('Network error. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      // Downscaled before it becomes a payload, not after (BF-4). This used to `FileReader` the raw
      // File, so a phone photo went up at full resolution plus base64's ~33%.
      const dataUrl = await downscaleToJpegDataUrl(file, { maxDim: SCAN_IMAGE_MAX_DIM })
      setError(null)
      setPendingPhoto({ base64: base64FromDataUrl(dataUrl), mimeType: 'image/jpeg', previewUrl: dataUrl })
      setPhotoNote('')
    } catch {
      setError('That image could not be read. Try another photo.')
    }
  }

  /**
   * Taking a photo (BF-50 ③).
   *
   * `CameraSource.Camera`, not `Prompt`. Owner: *"the photo option first opens the screen for /From
   * photos/Take pictures - could we make it auto open the camera then have the 'from photos' button
   * within the camera? usually its just take picture."* `Prompt` is the chooser they are describing,
   * and it stood between the tile and the camera on every single use.
   *
   * **The gallery is kept, as its own control, because it cannot go where they pictured it.** The
   * camera that opens is Android's, and nothing here can add a button to it — so "from photos"
   * became `pickFromGallery` below rather than being dropped, which the entry asked for explicitly.
   */
  async function handleCapturePhoto() {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) {
      fileInputRef.current?.click()
      return
    }
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        quality: 80,
        // `width`/`height`, NOT `targetWidth`/`targetHeight` — those belong to the sibling
        // `takePhoto(TakePhotoOptions)`. Both pairs are optional, so the wrong one type-checks and is
        // ignored at runtime: a downscale that silently never happens (verified against the pinned
        // @capacitor/camera 8.2.0 source, per CLAUDE.md's external-field-names rule).
        // These are maxima with the aspect ratio respected, so a landscape photo comes back
        // 1024 × 768 rather than being squashed to a square.
        width: SCAN_IMAGE_MAX_DIM,
        height: SCAN_IMAGE_MAX_DIM,
      })
      if (!photo.base64String) return
      const mimeType = `image/${photo.format}`
      setError(null)
      setPendingPhoto({ base64: photo.base64String, mimeType, previewUrl: `data:${mimeType};base64,${photo.base64String}` })
      setPhotoNote('')
    } catch {
      // User cancelled the camera/gallery picker
    }
  }

  /** The other half of BF-50 ③: the gallery, now reached deliberately rather than through a
   *  chooser nobody wanted on the common path. Web uses a second input without `capture`, since
   *  `capture="environment"` on the shared one is what forces the camera there. */
  async function pickFromGallery() {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) {
      galleryInputRef.current?.click()
      return
    }
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
        quality: 80,
        width: SCAN_IMAGE_MAX_DIM,
        height: SCAN_IMAGE_MAX_DIM,
      })
      if (!photo.base64String) return
      const mimeType = `image/${photo.format}`
      setError(null)
      setPendingPhoto({ base64: photo.base64String, mimeType, previewUrl: `data:${mimeType};base64,${photo.base64String}` })
      setPhotoNote('')
    } catch {
      // User cancelled the gallery picker
    }
  }

  async function handlePhotoSubmit() {
    if (!pendingPhoto) return
    const region = localStorage.getItem('ta_food_region') ?? 'AU'
    const body: Record<string, unknown> = { image: pendingPhoto.base64, mimeType: pendingPhoto.mimeType, region }
    if (photoNote.trim()) body.text = photoNote.trim()
    await callScan(body)
  }

  async function handleDescribe() {
    if (!describeText.trim()) return
    const region = localStorage.getItem('ta_food_region') ?? 'AU'
    await callScan({ text: describeText.trim(), region })
  }

  async function handleBarcode(code: string) {
    setShowBarcode(false)

    // A printed saved-meal label (Q-389), recognised by SHAPE rather than a prefix: the QR payload
    // is 22 base64url characters and cannot afford one, because anything longer pushes the code from
    // 25×25 to 29×29 and the printed modules below the size a phone reads. An EAN-13 is 13 digits
    // and cannot collide, so a non-match falls straight through to the barcode lookup below.
    const scannedMealId = decodeMealLabelToken(code)
    if (scannedMealId && onScannedSavedMeal) {
      onScannedSavedMeal(scannedMealId)
      return
    }

    setLoading(true)
    setError(null)
    setBarcodeOutcome(null)
    try {
      const res = await fetch(`/api/nutrition/barcode?code=${encodeURIComponent(code)}`)
      const data = await res.json()
      if (data.unavailable) { setLoading(false); setBarcodeOutcome('unavailable'); return }
      if (!res.ok) { setError('Barcode lookup failed.'); return }
      if (data.notFound) { setLoading(false); setBarcodeOutcome('missing'); return }
      onScanResult(data as NutritionScanResult)
    } catch {
      setError('Network error looking up barcode.')
    } finally {
      setLoading(false)
    }
  }

  const photoInput = (
    <>
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
      {/* No `capture`: that attribute is what makes the browser open the camera, so the gallery
          route needs an input without it. */}
      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
    </>
  )

  if (showBarcode) {
    return <BarcodeScanner onResult={handleBarcode} onClose={() => setShowBarcode(false)} />
  }

  if (barcodeOutcome) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-base font-semibold">
            {barcodeOutcome === 'unavailable' ? 'Food database unavailable' : 'No match found'}
          </p>
          <p className="text-sm text-muted-foreground">
            {barcodeOutcome === 'unavailable'
              ? 'Open Food Facts is not responding right now, so we could not check this barcode. Scanning a photo still works, and so does entering it manually.'
              : 'This product isn’t in the database. Try scanning a photo of the item to let AI identify it.'}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => { setBarcodeOutcome(null); handleCapturePhoto() }}>
            <CameraIcon className="w-4 h-4 mr-2" /> Scan photo instead
          </Button>
          <Button variant="outline" onClick={() => { setBarcodeOutcome(null); onManual() }}>
            Enter manually
          </Button>
          <Button variant="ghost" onClick={() => setBarcodeOutcome(null)}>
            Back
          </Button>
        </div>
        {photoInput}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Analysing…</p>
      </div>
    )
  }

  if (pendingPhoto) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pendingPhoto.previewUrl} alt="Food photo" className="w-full rounded-xl object-cover max-h-52" />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add context (optional)</label>
          <textarea
            className="w-full rounded-xl border bg-background px-4 py-3 text-sm resize-none min-h-[72px]"
            placeholder="e.g. it's protein pasta, 200g portion"
            value={photoNote}
            onChange={e => setPhotoNote(e.target.value)}
            autoFocus
          />
        </div>
        {error && <p className="text-xs text-destructive text-center">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => { setPendingPhoto(null); setPhotoNote(''); setError(null) }}>Retake</Button>
          <Button className="flex-1" onClick={handlePhotoSubmit}>Analyse</Button>
        </div>
        {photoInput}
      </div>
    )
  }

  if (showDescribe) {
    return (
      // BF-50 ②: *"There is a lot of free room; so this UI section could be expanded"*. This pane is
      // a direct child of the sheet's flex column and had no `flex-1`, so an 80 px box sat at the
      // top of a 90vh sheet with the rest empty. `min-h-0` is required beside it — without it the
      // flex item refuses to shrink below its content and the textarea cannot scroll.
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <label htmlFor="capture-describe" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Describe it
          </label>
          <textarea
            id="capture-describe"
            className="w-full flex-1 rounded-xl border bg-background px-4 py-3 text-sm resize-none min-h-[80px]"
            placeholder="e.g. 200g chicken breast with white rice and broccoli"
            value={describeText}
            onChange={e => setDescribeText(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">Include the portion size — it is what the estimate hangs on.</p>
        </div>
        {error && <p className="text-xs text-destructive text-center">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => { setShowDescribe(false); setError(null) }}>Back</Button>
          <Button className="flex-1" onClick={handleDescribe} disabled={!describeText.trim()}>Analyse</Button>
        </div>
        {/* The manual form, offered here rather than behind a fifth tile. It is the same destination
            the description reaches once analysed, so it belongs beside it — and knowing the macros
            already is not a different intent, just a shorter road. */}
        <button
          type="button"
          onClick={onManual}
          className="min-h-12 rounded-xl border border-border/60 px-4 text-sm text-muted-foreground transition-colors active:bg-muted/40"
        >
          Know the numbers? Enter them yourself
        </button>
        {photoInput}
      </div>
    )
  }

  const actions = [
    { icon: <CameraIcon className="h-7 w-7" />, label: 'Photo', action: handleCapturePhoto },
    { icon: <Hash className="h-7 w-7" />, label: 'Barcode', action: () => setShowBarcode(true) },
    { icon: <PenLine className="h-7 w-7" />, label: 'Describe or enter', action: () => setShowDescribe(true) },
  ]

  return (
    <>
      {/* BF-73 ①. An **owner override of the artboard, not a parity fix** — record it as such so
          the next parity sweep does not "correct" it back. BF-50 ① aimed at 62 because that is what
          artboard 2 draws; the owner has now seen it on the phone and asked for bigger (*"the
          icons/sections for photo/barcode/describe should be larger"*), and BF-28 rule 2 is that a
          later owner decision beats the drawing.

          **The height comes from padding and the icon, and it has to, because `min-h-[Npx]` does
          nothing on a `<button>` here.** `globals.css` sets a bare `button, [role="button"]
          { min-height: 48px }`, and it beats the utility: measured in the browser, a button with
          `min-h-[84px]` computes `min-height: 48px` while the same class on a `<div>` computes
          84px. So BF-50 ①'s `min-h-[62px]` never applied either — that tile measured **60 px**, the
          content's own height, not the 62 its comment claimed. Filed as LB-32.

          Measured here, same method: **60 px → 79 px**. `py-2.5` → `py-3.5` and `h-5` → `h-7` are
          what moved it; the label went to `text-xs` so the glyph did not outgrow its caption. A
          bigger box around the same small icon reads as empty rather than prominent, which would
          have answered the letter of the request and not the point of it.

          **Still no fixed height**, for BF-50's reason, which is unchanged and is the thing that
          would break: "Describe or enter" wraps to two lines in a third of 412 dp, and `h-[Npx]`
          clips the second one. */}
      <div className="flex shrink-0 gap-2 px-4">
        {actions.map(a => (
          <button
            key={a.label}
            type="button"
            onClick={a.action}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border/60 bg-background/50 px-1 py-3.5 transition-colors active:bg-muted/40"
          >
            <span className="text-muted-foreground">{a.icon}</span>
            <span className="text-center text-xs font-medium leading-tight">{a.label}</span>
          </button>
        ))}
      </div>
      {/* BF-50 ③'s other half. Text-weight rather than a fourth tile: taking a photo is the common
          act and the tiles are what BF-50 ① just made bigger — a same-sized gallery tile would say
          the two are equally likely, which is the balance `CameraSource.Prompt` had wrong. */}
      <button
        type="button"
        onClick={() => void pickFromGallery()}
        className="min-h-11 shrink-0 self-center px-4 text-xs font-medium text-muted-foreground transition-colors active:text-foreground"
      >
        Or choose a photo from your gallery
      </button>
      {error && <p className="shrink-0 px-4 text-xs text-destructive text-center">{error}</p>}
      {children}
      {photoInput}
    </>
  )
}
