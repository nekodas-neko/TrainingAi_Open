'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import { Plus, ChevronDown, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import type { MealType, FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { SwipeActions, type SwipeAction } from '@/components/ui/swipe-actions'
import { FoodRow } from './food-row'
import { DiaryMealGroup } from './diary-meal-group'
import { groupDiaryEntries, sumLogs, type DiaryEntry } from './diary-groups'
import type { SavedMealSummary } from '@/lib/hooks/use-saved-meal-summaries'

interface Props {
  mealType: MealType
  logs: FoodLogWithItem[]
  onAdd: (mealTypeId: string) => void
  /** By id, not the log object: the row renders inside `.map()` where a hook cannot memoise an
   *  object literal, and one would defeat `FoodRow`'s `memo` silently (Q-490). */
  onQuickEdit: (logId: string) => void
  /** Asks for the delete. The confirmation is the parent's, the same dialog the edit sheet's bin
   *  raises — a drag must never be the one route that skips it (BF-45 ⑤). */
  onDeleteLog: (logId: string) => void
  /** The user's saved meals by id, for heading a logged meal's rows with its name and photo
   *  (BF-39). A meal missing from here renders its rows loose, which is what pre-BF-39 logs and
   *  deleted meals do. */
  savedMeals: ReadonlyMap<string, SavedMealSummary>
}

export const MealCard = memo(function MealCard({ mealType, logs, onAdd, onQuickEdit, onDeleteLog, savedMeals }: Props) {
  const [expanded, setExpanded] = useState(true)
  // BF-39: a logged meal is ONE entry that opens to its ingredients, not N siblings. The rule and
  // its edge cases live in `diary-groups.ts`, where they can be tested in node.
  const entries = useMemo(
    () => groupDiaryEntries(logs, new Set(savedMeals.keys())),
    [logs, savedMeals],
  )
  const totals = logs.reduce(
    (acc, l) => ({ calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG, carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )

  return (
    // BF-24 ④: the meal name is a label ABOVE the card, and the card groups the food rows — the
    // inversion of Q-395b, which grouped meals within one container and put each name inside it.
    // Both are "grouped", which is why ② passed its checklist and still did not look like the
    // drawing. `grouped` now means "the parent spaces these", not "the parent owns the border".
    <div className="space-y-1.5">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        {/* BF-24 ⑤: artboard 1's header line is the name and one calorie number, nothing else. The
            emoji and the P/C/F chips are gone from here — the macros already have a home in the
            totals footer, and the per-meal split at two sizes was the noisiest part of the row.
            The ⊕ and the chevron stay: the drawing depicts a state, not the controls that reach it,
            and per-meal add is the only way to log to a meal that is not the current hour's. */}
        <CollapsibleTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className="flex w-full cursor-pointer items-center gap-2 px-1 py-1 text-muted-foreground transition-colors active:opacity-70"
          >
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.05em]">
              {mealType.name}
            </span>
            {logs.length > 0 && (
              <span className="text-[11px] tabular-nums">{Math.round(totals.calories)}</span>
            )}
            <button
              onClick={e => { e.stopPropagation(); onAdd(mealType.id) }}
              className="-my-2 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:text-brand"
              aria-label={`Add food to ${mealType.name}`}
            >
              <Plus className="h-4 w-4" />
            </button>
            {logs.length > 0 && (
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            )}
          </div>
        </CollapsibleTrigger>

      {/* BF-45 ②, as the owner corrected it on the device (N6): *"when the food list is minimized;
          it should still show the total calories and total macros below it"* — both numbers, and
          BELOW the header rather than crammed into it. Collapsing exists to skip the rows and keep
          the summary, and the totals footer lives inside `CollapsibleContent`, so it left with
          them and the header kept only a calorie number.

          Shown from ONE log, unlike the expanded footer's two: with the card open a single row
          already states its own macros, so a footer would repeat it — collapsed, nothing does. */}
      {!expanded && logs.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-muted/60">
          <MealTotals totals={totals} />
        </div>
      )}

      <CollapsibleContent>
        <div className="overflow-hidden rounded-2xl border border-border bg-muted/60">
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
                {entries.map((entry, i) => (
                  <motion.div
                    key={entry.key}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`overflow-hidden ${i < entries.length - 1 ? 'border-b border-border/20' : ''}`}
                  >
                    {/* Q-406: the diary row is the shared `FoodRow` — name, a grey line of what and
                        how much, calories right-aligned, chevron. The inline pencil and bin are
                        gone; editing and deleting both live in the sheet a tap opens, which is what
                        lets one row component serve the diary, the library and both search lists.
                        The per-item P/C/F moved into that sheet's live preview; the meal's totals
                        footer still carries the macro split at rest. */}
                    {entry.kind === 'log' ? (
                      <DiaryRow
                        id={entry.log.id}
                        name={entry.log.foodItem.name}
                        secondary={logAmountLabel(entry.log)}
                        calories={entry.log.calories}
                        onEdit={onQuickEdit}
                        onDelete={onDeleteLog}
                      />
                    ) : (
                      <MealGroupEntry
                        entry={entry}
                        summary={savedMeals.get(entry.savedMealId)!}
                        onQuickEdit={onQuickEdit}
                        onDeleteLog={onDeleteLog}
                      />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Totals footer — only shown when there are 2+ items */}
              {logs.length > 1 && <MealTotals totals={totals} bordered />}
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

/**
 * One logged meal's rows, under the meal's own header (BF-39).
 *
 * A component rather than JSX inside the `.map()` above, so `DiaryMealGroup`'s scalar props are
 * computed once per group instead of on every render of the card — and so the totals sum lives
 * beside the rows it sums.
 */
const MealGroupEntry = memo(function MealGroupEntry(
  { entry, summary, onQuickEdit, onDeleteLog }: {
    entry: Extract<DiaryEntry, { kind: 'meal' }>
    summary: SavedMealSummary
    onQuickEdit: (id: string) => void
    onDeleteLog: (id: string) => void
  },
) {
  const totals = sumLogs(entry.logs)
  return (
    <DiaryMealGroup
      name={summary.name}
      imageDataUri={summary.imageDataUri}
      itemCount={entry.logs.length}
      calories={totals.calories}
      proteinG={totals.proteinG}
      carbsG={totals.carbsG}
      fatG={totals.fatG}
    >
      {entry.logs.map(log => (
        <DiaryRow
          key={log.id}
          id={log.id}
          name={log.foodItem.name}
          secondary={logAmountLabel(log)}
          calories={log.calories}
          onEdit={onQuickEdit}
          onDelete={onDeleteLog}
        />
      ))}
    </DiaryMealGroup>
  )
})

/** Wrapper so the memoised row gets a stable `onPress` from inside a `.map()`, where a hook cannot
 *  live and an inline arrow would defeat `React.memo` silently (Q-490). Scalars only. */
const DiaryRow = memo(function DiaryRow(
  { id, name, secondary, calories, onEdit, onDelete }:
  {
    id: string; name: string; secondary: string; calories: number
    onEdit: (id: string) => void; onDelete: (id: string) => void
  },
) {
  const press = useCallback(() => onEdit(id), [id, onEdit])
  const actions = useMemo<SwipeAction[]>(() => [
    { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onPress: () => onDelete(id), destructive: true },
  ], [id, onDelete])
  // Artboard 1 draws the tile on every diary row. `food_items` carries no image column, so today
  // this is always the placeholder — which is the state the drawing shows, and the box is what stops
  // the list reading as ragged once any row does have a photo.
  const row = <FoodRow name={name} secondary={secondary} calories={calories} showChevron showThumb thumbSrc={null} onPress={press} />
  // BF-45 ⑤. One action, not the meal list's three: label and edit belong to a saved meal, and a
  // logged row's edit is the tap it already has. `bg-muted` because the meal card is `bg-muted/60`
  // — `bg-card` is two steps darker and would draw a band around the rows.
  return <SwipeActions actions={actions} itemLabel={name} surfaceClassName="bg-muted">{row}</SwipeActions>
})

/**
 * A meal's totals — the same line whether the card is open or collapsed (BF-45 ②).
 *
 * One component rather than two copies, because the collapsed summary and the expanded footer say
 * exactly the same thing and drifting them is how a screen ends up reporting two different numbers
 * for one meal. `bordered` is the only difference: inside the card the line needs a rule above it,
 * and standing alone it does not.
 */
function MealTotals(
  { totals, bordered }: { totals: { calories: number; proteinG: number; carbsG: number; fatG: number }; bordered?: boolean },
) {
  return (
    <div className={`flex items-center justify-between bg-muted/20 px-4 py-3 ${bordered ? 'border-t border-border/20' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.protein }}>P {Math.round(totals.proteinG)}g</span>
        <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.carbs }}>C {Math.round(totals.carbsG)}g</span>
        <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.fat }}>F {Math.round(totals.fatG)}g</span>
      </div>
      <span className="text-sm font-bold tabular-nums">{Math.round(totals.calories)} kcal</span>
    </div>
  )
}
