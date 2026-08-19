'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import { mealLabelFigures } from '@trainingai/shared/nutrition/label-payload'
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients'
import { useRovingRadioGroup } from '@/lib/hooks/use-roving-radio-group'
import {
  renderMealLabel, MEAL_LABEL_STYLES, DEFAULT_MEAL_LABEL_STYLE, mealLabelStyleSpec, type MealLabelStyle,
} from './meal-label-render'

interface Props {
  meal: SavedMeal | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Preview and share a saved meal's printable label (Q-389).
 *
 * **The style is picked here and not stored.** The spec left this open with three options: a
 * per-meal column (a migration, and therefore Lane A's), a global user setting, or picked at print
 * time. Picked-at-print-time is the only one that needs neither a schema change nor a settings
 * surface, and the renderer takes the style as a parameter either way — so persisting it later is
 * an addition rather than a rewrite. Cycling is the point anyway: the owner asked for all four.
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

  const share = useCallback(async () => {
    if (!canvas || !meal) return
    setBusy(true)
    try {
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('toBlob returned null')
      const file = new File([blob], `${meal.name.replace(/[^\w -]/g, '')}-label.png`, { type: 'image/png' })

      // Web Share with a File reaches the system sheet — which is where a print app lives — and
      // needs no Capacitor plugin, so no new APK. `canShare` is checked because share-with-files is
      // narrower than share-with-text and refusing loudly beats a rejected promise.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${meal.name} label` })
        return
      }

      // Browser fallback so the label is reachable in `pnpm dev`. The plan flags `<a download>` as
      // unreliable inside the WebView, which is why it is the fallback and not the path.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return  // the user dismissed the share sheet
      console.error('Label share failed:', err)
      toast.error('Could not share the label')
    } finally {
      setBusy(false)
    }
  }, [meal, canvas])

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
                  onClick={() => setStyle(s.value)}
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

          <Button onClick={share} disabled={busy || !meal} className="min-h-[48px] w-full gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            Share or save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
