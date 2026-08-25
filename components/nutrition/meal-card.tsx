'use client'

import { memo, useState } from 'react'
import { Plus, Trash2, Pencil, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import type { MealType, FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'

interface Props {
  mealType: MealType
  logs: FoodLogWithItem[]
  onAdd: (mealTypeId: string) => void
  onDeleteLog: (logId: string) => void
  onQuickEdit: (log: FoodLogWithItem) => void
  /** Drawn as one row of a grouped list rather than as its own card (Q-395b). */
  grouped?: boolean
}

export const MealCard = memo(function MealCard({ mealType, logs, onAdd, onDeleteLog, onQuickEdit, grouped }: Props) {
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
                    className={`flex items-start gap-3 px-4 py-3.5 overflow-hidden ${i < logs.length - 1 ? 'border-b border-border/20' : ''}`}
                  >
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-sm font-medium leading-snug truncate">{log.foodItem.name}</p>
                      {log.foodItem.brand && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{log.foodItem.brand}</p>
                      )}
                      <div className="flex items-center gap-2.5 mt-1.5">
                        <span className="text-[11px] font-semibold" style={{ color: MACRO_COLORS.protein }}>P {Math.round(log.proteinG)}g</span>
                        <span className="text-[11px] font-semibold" style={{ color: MACRO_COLORS.carbs }}>C {Math.round(log.carbsG)}g</span>
                        <span className="text-[11px] font-semibold" style={{ color: MACRO_COLORS.fat }}>F {Math.round(log.fatG)}g</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                      <span className="text-sm font-semibold tabular-nums w-16 text-right mr-1">
                        {Math.round(log.calories)} kcal
                      </span>
                      <button
                        onClick={() => onQuickEdit(log)}
                        aria-label="Edit log"
                        className="p-4 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/40 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteLog(log.id)}
                        aria-label="Delete log"
                        className="p-4 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
