'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Download, Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import { mealLabelFigures } from '@trainingai/shared/nutrition/label-payload'
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients'
import { useRovingRadioGroup } from '@/lib/hooks/use-roving-radio-group'
import { saveImageToGallery } from '@/lib/media/save-to-gallery'
import { withPngDensity } from '@trainingai/shared/nutrition/png-density'
import {
  renderMealLabel, MEAL_LABEL_STYLES, DEFAULT_MEAL_LABEL_STYLE, mealLabelStyleSpec, labelPrintDpi,
  type MealLabelStyle,
} from './meal-label-render'

/** One key, no schema — see the note on style persistence below. */
const LABEL_STYLE_KEY = 'ta_meal_label_style'

interface Props {
  meal: SavedMeal | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Preview and share a saved meal's printable label (Q-389).
 *
 * **The style is remembered in `localStorage`, and nowhere else (Q-400).** The owner's read:
 * *"I would make the image very rarely; happy for it to default to the default and I can change it
 * whenever I want … Happy for it to persist if its easy."* So it persists, at the cost of one key —
 * no column, no user setting, no migration. A stored value that is no longer a known style falls
 * back to the default rather than rendering nothing.
 *
 * **The preview is shown at true 50 mm scale**, with the code's measured physical size printed
 * under it, because the whole live risk in this feature is that the code is too fine to scan once
 * ink spreads. A preview that looks fine at screen size would hide exactly that.
 */
export function MealLabelSheet({ meal, open, onOpenChange }: Props) {
  // A *callback* ref held in state, not a useRef. `SheetContent` mounts into a portal, so on the
  // render where `open` flips true the effect below fires before the canvas exists — a plain ref
  // reads null, the effect returns early, and the canvas sits in the DOM forever undrawn. Keying the
  // effect on the element itself makes it run exactly when the element arrives. The E2E spec found
  // this: the sheet opened, the canvas was in the accessibility tree, and nothing was ever painted.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [style, setStyle] = useState<MealLabelStyle>(DEFAULT_MEAL_LABEL_STYLE)
  const [metrics, setMetrics] = useState<{ moduleCount: number; codeMm: number; ingredientLines: number; ingredientOverflow: number } | null>(null)
  const styleClaimsIngredients = mealLabelStyleSpec(style).ingredients === true
  const [busy, setBusy] = useState(false)
  const { groupProps, getRadioProps } = useRovingRadioGroup(true)

  // Seeded in an effect, never in a `useState` initializer — a storage read in an initializer is a
  // hydration mismatch, which is the rule this repo already had to retrofit onto four screens.
  useEffect(() => {
    const stored = localStorage.getItem(LABEL_STYLE_KEY)
    if (stored && MEAL_LABEL_STYLES.some(s => s.value === stored)) setStyle(stored as MealLabelStyle)
  }, [])

  const chooseStyle = useCallback((next: MealLabelStyle) => {
    setStyle(next)
    try { localStorage.setItem(LABEL_STYLE_KEY, next) } catch { /* private mode; the pick still applies */ }
  }, [])

  /**
   * The PNG both actions hand out. `canvas.toBlob` writes no `pHYs` chunk — the canvas API has no
   * way to set one — so the bytes are re-stamped with the density they were drawn at before they
   * leave. Without it a 50 mm label prints at ~312 mm, because a PNG with no declared size falls
   * back to 96 dpi almost everywhere.
   */
  const labelBlob = useCallback(async (): Promise<{ blob: Blob; filename: string }> => {
    if (!canvas || !meal) throw new Error('nothing to render')
    const raw = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
    if (!raw) throw new Error('toBlob returned null')
    const stamped = withPngDensity(new Uint8Array(await raw.arrayBuffer()), labelPrintDpi(canvas.width))
    return {
      blob: new Blob([stamped], { type: 'image/png' }),
      filename: `${meal.name.replace(/[^\w -]/g, '')}-label.png`,
    }
  }, [canvas, meal])

  useEffect(() => {
    if (!open || !meal || !canvas) return
    let cancelled = false
    renderMealLabel(canvas, {
      mealId: meal.id,
      figures: mealLabelFigures(meal),
      // Per SERVING, same as the figures — `savedMealToIngredients` goes through `oneServingItems`
      // too, so "200 g mince" is the amount behind the calories printed next to it. Feeding it the
      // whole recipe here would put a batch ingredient list beside a per-serving calorie count.
      ingredients: savedMealToIngredients(meal),
      style,
    })
      .then(m => { if (!cancelled) setMetrics(m) })
      .catch(err => {
        console.error('Label render failed:', err)
        // A card that silently vanishes is the failure this repo keeps re-finding; say it instead.
        if (!cancelled) toast.error('Could not draw the label')
      })
    return () => { cancelled = true }
  }, [open, meal, style, canvas])

  /**
   * Save to the gallery. **This is the action the owner asked for**, and it is separate from Share
   * on purpose: putting a file in the Photos app and handing it to a print app are different
   * intents, and one button doing whichever happened to be available is what produced Q-400.
   */
  const saveToGallery = useCallback(async () => {
    if (!canvas || !meal) return
    setBusy(true)
    try {
      const { blob, filename } = await labelBlob()
      const outcome = await saveImageToGallery(blob, filename)
      if (!outcome.ok) {
        toast.error(`Could not save the label — ${outcome.reason}`)
      } else {
        toast.success(outcome.where === 'gallery' ? 'Saved to your gallery' : 'Label downloaded')
      }
    } catch (err) {
      console.error('Label save failed:', err)
      toast.error('Could not save the label')
    } finally {
      setBusy(false)
    }
  }, [canvas, meal, labelBlob])

  /**
   * Hand the PNG to the system share sheet, which is where a label-printer app lives.
   *
   * The `canShare` guard stays. Calling `navigator.share` with files where it is unsupported
   * rejects, and the catch below swallows `AbortError` — so removing the guard turns a dead button
   * into a dead button that also lies in the log. What changed is that declining now *says so*
   * and points at Save, instead of falling through to an `<a download>` that does nothing in the
   * WebView.
   */
  const share = useCallback(async () => {
    if (!canvas || !meal) return
    setBusy(true)
    try {
      const { blob, filename } = await labelBlob()
      const file = new File([blob], filename, { type: 'image/png' })
      if (!navigator.canShare?.({ files: [file] })) {
        toast.error('Sharing files is not available here — use Save to gallery')
        return
      }
      await navigator.share({ files: [file], title: `${meal.name} label` })
      toast.success('Label shared')
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return  // the user dismissed the share sheet
      console.error('Label share failed:', err)
      toast.error('Could not share the label')
    } finally {
      setBusy(false)
    }
  }, [canvas, meal, labelBlob])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* SheetContent side="bottom" owns the bottom inset — never add pb-safe* inside one. */}
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{meal ? `${meal.name} label` : 'Label'}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col items-center gap-4 px-4 pb-2">
          {/* White ground, in both themes: this is ink on paper, and a dark-mode preview of a white
              label is the obvious thing to get wrong. */}
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <canvas
              ref={setCanvas}
              // A canvas has no implicit ARIA role, so an aria-label on it alone is not exposed —
              // the element simply does not appear in the accessibility tree. role="img" is what
              // makes the label announceable, and it is also the only way a test can find it.
              role="img"
              // 50 mm at true scale, so what is on screen is the size that gets printed.
              style={{ width: '50mm', height: '50mm', display: 'block' }}
              aria-label={meal ? `Printable label for ${meal.name}` : 'Printable label'}
            />
          </div>

          {metrics && (
            <p className="text-center text-[11px] leading-snug text-muted-foreground">
              Code is <span className="font-semibold text-foreground">{metrics.codeMm.toFixed(1)} mm</span> at{' '}
              {metrics.moduleCount}×{metrics.moduleCount} modules
              {' — '}
              <span className="font-semibold text-foreground">
                {(metrics.codeMm / (metrics.moduleCount + 8)).toFixed(2)} mm per module
              </span>.
              {/* Divided by modules + the 8 module-widths of quiet zone, because the renderer draws
                  the quiet zone INSIDE that box — so this is the pitch actually printed. Dividing by
                  the module count alone (which the backlog's figures do) overstates it by ~24%. */}
              <span className="block">Test-print and scan before relying on it; ink spread merges fine modules.</span>
            </p>
          )}

          {/* Gated on the STYLE claiming a breakdown, not on the count being above zero (Q-399).
              The old `ingredientLines > 0` gate meant the one state worth reporting — a style that
              promises the list and draws none — removed the line that would have said so, and the
              default shipped that way for a release. Zero is now the loudest reading, not a silent
              one. */}
          {metrics && styleClaimsIngredients && (
            <p
              className={`text-center text-[11px] leading-snug ${metrics.ingredientLines === 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}
              role={metrics.ingredientLines === 0 ? 'status' : undefined}
            >
              {metrics.ingredientLines === 0
                ? <>No ingredients fit on this label — the layout has no room for the breakdown it promises. Pick another style, or report it.</>
                : <>
                    Printing <span className="font-semibold text-foreground">{metrics.ingredientLines} ingredient{metrics.ingredientLines === 1 ? '' : 's'}</span>
                    {metrics.ingredientOverflow > 0
                      ? <> — {metrics.ingredientOverflow} more {metrics.ingredientOverflow === 1 ? 'is' : 'are'} summarised on the label as “scan for the full list”.</>
                      : <> — the whole breakdown fits.</>}
                  </>}
            </p>
          )}

          {/* The "Square dies only" warning that used to sit here is gone with Q-411: every style
              draws square now, so there is no longer a layout that a round die would crop
              differently from the others. Where the round die matters is at the printer. */}

          {/* The shared roving-tabindex hook, not a hand-rolled group — Q-350 put all eight of the
              app's radiogroups on it, and a ninth that behaves differently is the drift it fixed. */}
          <div {...groupProps} aria-label="Label style" className="grid w-full grid-cols-2 gap-2">
            {MEAL_LABEL_STYLES.map((s, i) => {
              const on = s.value === style
              return (
                <button
                  key={s.value}
                  {...getRadioProps(on, i)}
                  onClick={() => chooseStyle(s.value)}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-left transition ${
                    on ? 'border-[var(--color-brand)] bg-[var(--brand-card-bg)]' : 'border-border bg-muted/30'
                  }`}
                >
                  <span className="block text-[12px] font-semibold">{s.label}</span>
                  <span className="block text-[10px] leading-snug text-muted-foreground">{s.note}</span>
                </button>
              )
            })}
          </div>

          <div className="grid w-full grid-cols-2 gap-2">
            <Button onClick={saveToGallery} disabled={busy || !meal} className="min-h-[48px] gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Save to gallery
            </Button>
            <Button onClick={share} disabled={busy || !meal} variant="outline" className="min-h-[48px] gap-2">
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
