'use client'

import { memo, useCallback, useState } from 'react'
import { Plus, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import type { MealType, FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { FoodRow } from './food-row'

interface Props {
  mealType: MealType
  logs: FoodLogWithItem[]
  onAdd: (mealTypeId: string) => void
  /** By id, not the log object: the row renders inside `.map()` where a hook cannot memoise an
   *  object literal, and one would defeat `FoodRow`'s `memo` silently (Q-490). */
  onQuickEdit: (logId: string) => void
  /** Drawn as one row of a grouped list rather than as its own card (Q-395b). */
  grouped?: boolean
}

export const MealCard = memo(function MealCard({ mealType, logs, onAdd, onQuickEdit, grouped }: Props) {
  const [expanded, setExpanded] = useState(true)
  const totals = logs.reduce(
    (acc, l) => ({ calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG, carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )

  return (
    // Q-395b: inside the grouped meal list the section owns the border and the dividers, so a card
    // that also draws its own puts a second hairline against the first and re-opens the gaps the
    // grouping closes. Standalone callers keep the card.
    <div className={grouped ? 'bg-muted/60' : 'rounded-2xl bg-muted/60 border border-border overflow-hidden'}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        {/* Header row */}
        <CollapsibleTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className="w-full flex items-center gap-3 px-4 py-4 cursor-pointer active:bg-muted/20 transition-colors"
          >
            <span className="text-2xl leading-none">{mealType.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-base leading-tight">{mealType.name}</p>
              {logs.length > 0 && (
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-muted-foreground tabular-nums">{Math.round(totals.calories)} kcal</span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: MACRO_COLORS.protein }}>P {Math.round(totals.proteinG)}g</span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: MACRO_COLORS.carbs }}>C {Math.round(totals.carbsG)}g</span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: MACRO_COLORS.fat }}>F {Math.round(totals.fatG)}g</span>
                </div>
              )}
            </div>
            <button
              onClick={e => { e.stopPropagation(); onAdd(mealType.id) }}
              className="h-9 w-9 rounded-full border border-border/60 flex items-center justify-center text-muted-foreground hover:border-brand hover:text-brand transition-colors"
              aria-label="Add food"
            >
              <Plus className="w-4 h-4" />
            </button>
            {logs.length > 0 && (
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
            )}
          </div>
        </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t border-border/30">
          {logs.length === 0 ? (
            <button
              onClick={() => onAdd(mealType.id)}
              className="w-full flex items-center gap-2 px-4 py-3.5 text-muted-foreground active:bg-muted/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm">Add food</span>
            </button>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {logs.map((log, i) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`overflow-hidden ${i < logs.length - 1 ? 'border-b border-border/20' : ''}`}
                  >
                    {/* Q-406: the diary row is the shared `FoodRow` — name, a grey line of what and
                        how much, calories right-aligned, chevron. The inline pencil and bin are
                        gone; editing and deleting both live in the sheet a tap opens, which is what
                        lets one row component serve the diary, the library and both search lists.
                        The per-item P/C/F moved into that sheet's live preview; the meal's totals
                        footer still carries the macro split at rest. */}
                    <DiaryRow
                      id={log.id}
                      name={log.foodItem.name}
                      secondary={logAmountLabel(log)}
                      calories={log.calories}
                      onEdit={onQuickEdit}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Totals footer — only shown when there are 2+ items */}
              {logs.length > 1 && (
                <div className="px-4 py-3 bg-muted/20 border-t border-border/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.protein }}>P {Math.round(totals.proteinG)}g</span>
                    <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.carbs }}>C {Math.round(totals.carbsG)}g</span>
                    <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.fat }}>F {Math.round(totals.fatG)}g</span>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{Math.round(totals.calories)} kcal</span>
                </div>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
      </Collapsible>
    </div>
  )
})

/** The grey line under the name: *what and how much*, which is what Q-406's shape asks for there. */
function logAmountLabel(log: FoodLogWithItem): string {
  const servingG = log.foodItem.servingSizeG ?? 0
  const q = Math.round(log.quantityMultiplier * 100) / 100
  const amount = `${q} ${q === 1 ? 'serving' : 'servings'}${servingG > 0 ? ` · ${Math.round(servingG * log.quantityMultiplier)} g` : ''}`
  return log.foodItem.brand ? `${log.foodItem.brand} · ${amount}` : amount
}

/** Wrapper so the memoised row gets a stable `onPress` from inside a `.map()`, where a hook cannot
 *  live and an inline arrow would defeat `React.memo` silently (Q-490). Scalars only. */
const DiaryRow = memo(function DiaryRow(
  { id, name, secondary, calories, onEdit }:
  { id: string; name: string; secondary: string; calories: number; onEdit: (id: string) => void },
) {
  const press = useCallback(() => onEdit(id), [id, onEdit])
  return <FoodRow name={name} secondary={secondary} calories={calories} showChevron onPress={press} />
})
