'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Camera as CameraIcon, Hash, MessageSquare, PenLine, Loader2, Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BarcodeScanner } from './barcode-scanner'
import type { NutritionScanResult, FoodItem } from '@trainingai/shared/types/nutrition'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import { decodeMealLabelToken } from '@trainingai/shared/nutrition/label-payload'
import { downscaleToJpegDataUrl, base64FromDataUrl } from '@/lib/media/downscale-image'

/**
 * Longest edge of an uploaded food photo, in pixels (BF-4).
 *
 * **Chosen from the token budget, not from taste.** Every image scan in a month of production
 * reports 1,275–1,298 input tokens regardless of the photo's size, because Gemini normalises an
 * image to a fixed tile budget before the model sees it. A 4 MB photo and a 400 KB photo therefore
 * do the same model work — the extra bytes buy no accuracy and are pure upload latency. 1024 sits
 * comfortably above the tiles that budget covers while bounding an S25's 12 MP capture, which is
 * otherwise ~4000 px wide plus base64's ~33%.
 */
const SCAN_IMAGE_MAX_DIM = 1024

interface Props {
  onScanResult: (result: NutritionScanResult) => void
  onManual: () => void
  onMyFoods: () => void
  preselectedMealTypeId?: string | null
  onLibrarySelect?: (item: FoodItem) => void
  userId?: string
  /** A scanned saved-meal label (Q-389). The parent owns the logging, since it already holds the
   *  date, the meal-type bucket and the onLogged callback. */
  onScannedSavedMeal?: (mealId: string) => void
}

export function CaptureStep({ onScanResult, onManual, onMyFoods, preselectedMealTypeId, onLibrarySelect, userId, onScannedSavedMeal }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [describeText, setDescribeText] = useState('')
  const [showDescribe, setShowDescribe] = useState(false)
  const [showBarcode, setShowBarcode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two different outcomes, deliberately two states: 'missing' means OFF answered and does not have
  // this product; 'unavailable' means OFF did not answer. Telling the user their food is unknown
  // when the database is down sends them off to type it in by hand for no reason.
  const [barcodeOutcome, setBarcodeOutcome] = useState<null | 'missing' | 'unavailable'>(null)
  const [recentItems, setRecentItems] = useState<FoodItem[]>([])
  const [pendingPhoto, setPendingPhoto] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null)
  const [photoNote, setPhotoNote] = useState('')

  useLayoutEffect(() => {
    if (!preselectedMealTypeId) return
    const seeded = readCacheSync<FoodItem[]>(`nutrition-recent-for-meal:${preselectedMealTypeId}`)
    if (seeded) setRecentItems(Array.isArray(seeded) ? seeded.slice(0, 3) : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!preselectedMealTypeId || !onLibrarySelect) return
    let cancelled = false
    // Local-first: recent foods for this meal from previously-logged entries (offline).
    const store = userId ? getLocalStore(userId) : null
    if (store) {
      store.getRecentFoodItemsForMeal(preselectedMealTypeId, 3)
        .then(items => { if (!cancelled && items.length > 0) setRecentItems(items) })
        .catch(() => {})
    }
    // Revalidate from the server when online; keep local results on failure/offline.
    cachedFetch<FoodItem[]>(
      `nutrition-recent-for-meal:${preselectedMealTypeId}`,
      `/api/nutrition/recent-for-meal?mealTypeId=${preselectedMealTypeId}`,
      TTL_MEDIUM,
      (items) => { if (!cancelled && Array.isArray(items)) setRecentItems(items.slice(0, 3)) },
    ).catch(() => {})
    return () => { cancelled = true }
  }, [preselectedMealTypeId, onLibrarySelect, userId])

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
        source: CameraSource.Prompt,
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
              : 'This product isn\u2019t in the database. Try scanning a photo of the item to let AI identify it.'}
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
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
      </div>
    )
  }

  const tiles = [
    {
      icon: <CameraIcon className="w-6 h-6" />, label: 'Scan Photo',
      action: handleCapturePhoto,
    },
    {
      icon: <Hash className="w-6 h-6" />, label: 'Barcode',
      action: () => setShowBarcode(true),
    },
    {
      icon: <MessageSquare className="w-6 h-6" />, label: 'Describe it',
      action: () => setShowDescribe(true),
    },
    {
      icon: <PenLine className="w-6 h-6" />, label: 'Manual Entry',
      action: onManual,
    },
    {
      // One tile, because it is now one list (Q-395c). Two tiles for two lists is what made the
      // owner ask what the difference was, and there was none.
      icon: <Bookmark className="w-6 h-6" />, label: 'My Foods',
      action: onMyFoods,
    },
  ]

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-base font-semibold">How would you like to log food?</p>

      {recentItems.length > 0 && onLibrarySelect && !loading && !showDescribe && !pendingPhoto && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Recently logged here</p>
          <div className="flex flex-col rounded-xl border border-border/50 overflow-hidden">
            {recentItems.map(item => (
              <button
                key={item.id}
                onClick={() => onLibrarySelect(item)}
                className="flex items-center gap-3 px-4 min-h-[48px] hover:bg-muted/50 transition-colors text-left border-b border-border/30 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.name}</p>
                  {item.brand && <p className="text-[10px] text-muted-foreground truncate">{item.brand}</p>}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{item.calories} kcal</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Analysing…</p>
        </div>
      ) : showDescribe ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Describe the food and portion size</p>
          <textarea
            className="w-full rounded-xl border bg-background px-4 py-3 text-sm resize-none min-h-[80px]"
            placeholder="e.g. 200g chicken breast with white rice and broccoli"
            value={describeText}
            onChange={e => setDescribeText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowDescribe(false)}>Back</Button>
            <Button className="flex-1" onClick={handleDescribe} disabled={!describeText.trim()}>Analyse</Button>
          </div>
        </div>
      ) : pendingPhoto ? (
        <div className="flex flex-col gap-3">
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
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {tiles.map(tile => (
              <button
                key={tile.label}
                onClick={tile.action}
                className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-background/50 hover:bg-background/30 transition-colors p-4"
              >
                <span className="text-muted-foreground">{tile.icon}</span>
                <span className="text-sm font-medium">{tile.label}</span>
              </button>
            ))}
          </div>
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhoto}
      />
    </div>
  )
}
