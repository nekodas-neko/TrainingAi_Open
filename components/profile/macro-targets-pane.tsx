'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { NutritionTargets } from '@trainingai/shared/types/nutrition'
import { invalidateGoalRecommendations } from '@/lib/cache-groups'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'
import {
  carbsFromRemainder, caloriesFromMacros, MACRO_GOAL_TOLERANCE_KCAL,
  type BaselineResult,
} from '@trainingai/shared/nutrition/goal-recommendation'
import { RecommendedValue } from './recommended-value'

interface MacroTargetsPaneProps {
  // Bumped after an AI recommendation is applied so the form re-fetches the
  // newly-written targets instead of showing stale values.
  refreshKey?: number
  /** BF-101: the deterministic per-field recommendation, or `null` on an incomplete profile. */
  baseline: BaselineResult | null
}

// `why` is absent for fiber deliberately: `BaselineResult` carries no fiber figure, and inventing
// one would put an unsourced number beside four sourced ones (BF-101). Same rule as Sleep.
const FIELDS: {
  label: string
  key: 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG'
  unit: string
  baselineKey?: 'calories' | 'proteinG' | 'carbsG' | 'fatG'
  why?: string
}[] = [
  { label: 'Calories', key: 'calories', unit: 'kcal', baselineKey: 'calories', why: "your resting rate on a rest day, adjusted for your fitness goal" },
  { label: 'Protein', key: 'proteinG', unit: 'g', baselineKey: 'proteinG', why: 'dosed per kg of lean mass for your goal' },
  { label: 'Carbohydrates', key: 'carbsG', unit: 'g', baselineKey: 'carbsG', why: 'whatever is left of the calorie target after protein and fat' },
  { label: 'Fat', key: 'fatG', unit: 'g', baselineKey: 'fatG', why: '25% of the calorie target' },
  { label: 'Fiber', key: 'fiberG', unit: 'g' },
]

function targetsToForm(t: NutritionTargets) {
  return {
    calories: t.calories != null ? String(t.calories) : '',
    proteinG: t.proteinG != null ? String(t.proteinG) : '',
    carbsG: t.carbsG != null ? String(t.carbsG) : '',
    fatG: t.fatG != null ? String(t.fatG) : '',
    fiberG: t.fiberG != null ? String(t.fiberG) : '',
  }
}

export function MacroTargetsPane({ refreshKey, baseline }: MacroTargetsPaneProps) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState({ calories: '', proteinG: '', carbsG: '', fatG: '', fiberG: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const seeded = readCacheSync<NutritionTargets>('nutrition-targets')
    if (seeded) setForm(targetsToForm(seeded))
    setLoading(seeded === null)
    cachedFetch<NutritionTargets>('nutrition-targets', '/api/nutrition/targets', TTL_LONG, (t) => {
      setForm(targetsToForm(t))
    }).catch(() => {}).finally(() => setLoading(false))
  }, [refreshKey])

  /**
   * What the four numbers currently in the form actually come to, against the calorie goal.
   *
   * These are four independent fields and nothing ever made them agree, so the seeded account holds
   * 150P/180C/60F beside a 1,750 kcal goal — 1,860 by Atwater, a 110 kcal disagreement the user had
   * no way to see. Anything planning against both is solving an unsatisfiable problem: every meal
   * plan built from it read "over by 110 kcal" for reasons that had nothing to do with the food.
   *
   * Shown, not enforced. A saved row is never silently rewritten — `reconcileDailyMacros` still
   * guards the read path for rows that already drifted — and the fix here is one tap the user
   * chooses to take.
   */
  const goal = parseFloat(form.calories)
  const macros = {
    proteinG: parseFloat(form.proteinG) || 0,
    carbsG: parseFloat(form.carbsG) || 0,
    fatG: parseFloat(form.fatG) || 0,
  }
  const impliedKcal = caloriesFromMacros(macros)
  const gap = Number.isFinite(goal) && goal > 0 && impliedKcal > 0 ? impliedKcal - goal : 0
  const mismatched = Math.abs(gap) > MACRO_GOAL_TOLERANCE_KCAL

  function fitCarbs() {
    setForm(prev => ({ ...prev, carbsG: String(carbsFromRemainder(goal, macros.proteinG, macros.fatG)) }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        calories: form.calories ? parseInt(form.calories) : null,
        proteinG: form.proteinG ? parseFloat(form.proteinG) : null,
        carbsG: form.carbsG ? parseFloat(form.carbsG) : null,
        fatG: form.fatG ? parseFloat(form.fatG) : null,
        fiberG: form.fiberG ? parseFloat(form.fiberG) : null,
      }
      const res = await fetch('/api/nutrition/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      await invalidateGoalRecommendations()
      toast.success('Targets saved')
    } catch {
      toast.error('Failed to save targets')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="text-left">
          <p className="text-sm font-medium">Macro Targets</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Calories, protein, carbs, fat &amp; fiber</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
          ) : (
            <>
              {FIELDS.map(f => (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground flex-1">{f.label}</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        value={form[f.key]}
                        onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder="—"
                        className="w-24 rounded-xl border bg-background px-3 py-2 text-sm text-right tabular-nums"
                      />
                      <span className="text-xs text-muted-foreground w-8">{f.unit}</span>
                    </div>
                  </div>
                  {f.baselineKey && f.why && (
                    <RecommendedValue
                      recommended={baseline?.[f.baselineKey] ?? null}
                      current={parseFloat(form[f.key]) || null}
                      unit={f.unit}
                      why={f.why}
                      onApply={v => setForm(prev => ({ ...prev, [f.key]: String(v) }))}
                    />
                  )}
                </div>
              ))}
              {mismatched && (
                <div className="rounded-xl border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-3">
                  <p className="text-xs font-medium">
                    Your macros come to {Math.round(impliedKcal).toLocaleString()} kcal —{' '}
                    {Math.abs(Math.round(gap)).toLocaleString()}{' '}
                    {gap > 0 ? 'more' : 'less'} than your {Math.round(goal).toLocaleString()} kcal goal.
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    Anything that plans against both — a meal plan, the calorie ring — has to pick
                    one, so it will look off by this much whatever you eat.
                  </p>
                  <button
                    onClick={fitCarbs}
                    className="mt-2 w-full min-h-[44px] rounded-xl bg-foreground text-background text-xs font-semibold"
                  >
                    Fit carbs to {Math.round(goal).toLocaleString()} kcal
                    {' '}({carbsFromRemainder(goal, macros.proteinG, macros.fatG)} g)
                  </button>
                </div>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full rounded-xl bg-foreground text-background py-2.5 text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : 'Save Targets'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
