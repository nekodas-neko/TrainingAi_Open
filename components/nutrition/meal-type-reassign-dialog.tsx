'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRovingRadioGroup } from '@/lib/hooks/use-roving-radio-group'
import type { MealType } from '@trainingai/shared/types/nutrition'

export interface ReassignTarget {
  source: MealType
  logCount: number
  /** The remaining live meal types, source excluded. May be empty. */
  options: MealType[]
}

/**
 * Where a meal type's entries go when it is deleted (Q-326).
 *
 * **This exists because the delete button could previously only fail.** `DELETE
 * /api/nutrition/meal-types/[id]` refuses with a 409 when logs reference the type, and the manager
 * turned that into a toast — naming an action ("move them") the app had never implemented, so the
 * only escape a user could find was deleting every food log by hand (Q-412). The server half now
 * takes `?reassignTo=<uuid>` and does the move and the delete in one transaction; this is the half
 * that lets someone ask for it.
 *
 * **It says that the move rewrites history**, because that is the surprising part. A 3 pm snack moved
 * to Lunch reads as Lunch on every past day, not merely from today — which is exactly what "I want
 * three meals a day" means, and is not what "move" implies on its own.
 *
 * **There is no "delete them instead".** Q-326 asked for one as a secondary action; nothing on the
 * server can do it. `reassignAndDeleteMealType` is the only escape the repository offers, and a
 * bulk food-log delete would be a new repository method plus a route parameter — Lane A's, and worth
 * a decision on its own before a destructive bulk action gets a button.
 */
export function MealTypeReassignDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: ReassignTarget | null
  onClose: () => void
  onConfirm: (toId: string) => Promise<void>
}) {
  const [toId, setToId] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const group = useRovingRadioGroup(toId != null)

  const open = target != null
  const entries = target ? `${target.logCount} ${target.logCount === 1 ? 'entry' : 'entries'}` : ''
  const chosen = target?.options.find(o => o.id === toId) ?? null

  function close() {
    if (moving) return
    setToId(null)
    onClose()
  }

  async function confirm() {
    if (!toId || moving) return
    setMoving(true)
    try {
      await onConfirm(toId)
      setToId(null)
    } finally {
      setMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) close() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Move {target?.source.name}&rsquo;s entries?</DialogTitle>
        </DialogHeader>

        {target && target.options.length === 0 ? (
          // Deleting the last meal type would leave its entries with nowhere to go. Say that rather
          // than showing an empty picker above a button that cannot do anything.
          <p className="text-sm text-muted-foreground">
            {target.source.name} has {entries}, and it is your only meal type — there is nowhere to
            move them. Add another meal type first.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {target?.source.name} has {entries}. Choose where they go, then {target?.source.name} is
              deleted.
            </p>

            <div {...group.groupProps} aria-label="Move entries to" className="space-y-1.5 mt-1">
              {target?.options.map((o, i) => {
                const active = o.id === toId
                return (
                  <button
                    key={o.id}
                    {...group.getRadioProps(active, i)}
                    onClick={() => setToId(o.id)}
                    className={`w-full min-h-12 flex items-center gap-2.5 rounded-xl border px-3 text-left text-sm transition ${
                      active
                        ? 'border-brand bg-brand/10 font-semibold'
                        : 'border-border/60 bg-muted/20'
                    }`}
                  >
                    <span className="text-base">{o.emoji}</span>
                    <span className="flex-1">{o.name}</span>
                  </button>
                )
              })}
            </div>

            {/* The part that is genuinely surprising, so it is stated before the button rather than
                in a toast afterwards. */}
            <p className="text-xs text-muted-foreground">
              {/* No indefinite article before the meal-type name: it is user-chosen text, so "a
                  Afternoon Snack" is one rename away at any time and reads as a typo. */}
              {chosen
                ? `Every past entry moves too — anything logged as ${target?.source.name} on an earlier day will read as ${chosen.name}.`
                : 'Every past entry moves too, not just from today.'}
            </p>
          </>
        )}

        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={close} disabled={moving}>
            Cancel
          </Button>
          {target && target.options.length > 0 && (
            <Button className="flex-1" onClick={confirm} disabled={!toId || moving}>
              {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Move & delete'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
