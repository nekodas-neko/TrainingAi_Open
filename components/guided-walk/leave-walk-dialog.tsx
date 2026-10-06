'use client'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MIN_WALK_SEC } from '@/lib/stores/guided-walk-store'

/**
 * The guided walk's one Exit prompt. The Exit button and the Android back gesture both open this
 * same dialog on `WalkActive` (#2134), so what leaving a walk offers is decided here, once.
 *
 * Above `MIN_WALK_SEC` it asks: save the walk, discard it, or keep walking. Under it the walk is too
 * short to record (BF-191), so the only choices are to discard it or keep walking.
 */
type LeaveWalkDialogProps = {
  open: boolean
  /**
   * Seconds walked when Exit was pressed. One reading rather than the live clock, because the
   * dialog quotes it back and decides from it whether a save is offered at all — a clock that
   * crossed the floor while the dialog was up would swap the choices under the user's thumb.
   */
  elapsedSec: number
  onSave: () => void
  onDiscard: () => void
  onStay: () => void
}

function walked(elapsedSec: number): string {
  if (elapsedSec <= 0) return ''
  return `You have walked ${elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)} min`}. `
}

export function LeaveWalkDialog({ open, elapsedSec, onSave, onDiscard, onStay }: LeaveWalkDialogProps) {
  // Three choices do not fit one row at 384 px ("Keep walking" alone is 96 px of text). Stacked,
  // save first: it is the one that keeps data.
  if (elapsedSec >= MIN_WALK_SEC) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onStay() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Exit this walk?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {walked(elapsedSec)}Save it to your history, or discard it.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <Button className="w-full" onClick={onSave}>Save walk</Button>
            <Button variant="destructive" className="w-full" onClick={onDiscard}>Discard</Button>
            <Button variant="ghost" className="w-full" onClick={onStay}>Keep walking</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => { if (!o) onStay() }}
      title="Discard this walk?"
      message={`${walked(elapsedSec)}Exiting here does not record the walk — it will not appear in your history.`}
      confirmLabel="Discard"
      cancelLabel="Keep walking"
      onConfirm={onDiscard}
    />
  )
}
