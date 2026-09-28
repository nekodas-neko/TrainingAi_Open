'use client'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type LeaveWalkDialogProps = {
  open: boolean
  /** Seconds walked so far, quoted back when the walk is being discarded. */
  elapsedSec?: number
  onStay: () => void
  /** Leave and keep nothing. For `outcome: 'save'` this is the save-and-leave the End button owns. */
  onLeave: () => void
} & (
  /**
   * What ending here actually does to the walk.
   *
   * It is a REQUIRED prop rather than an inferred default because the call sites genuinely differ
   * and the old shared copy — *"Ending now will stop it early"* — was false at all of them. The
   * End-walk button saves what was walked (BF-190). The back gesture and the tab bar used to call
   * `reset()` and keep nothing at any duration; they now ASK (`'choose'`, the owner's decision on
   * LB-141), and fall back to the same `'discard'` confirm the End button shows under
   * `MIN_WALK_SEC` rather than offering to save a walk too short to record.
   */
  | { outcome: 'save' | 'discard'; onSave?: never }
  // A discriminated union, so a caller cannot offer the choice without wiring the save.
  | { outcome: 'choose'; onSave: () => void }
)

function walked(elapsedSec?: number): string {
  if (elapsedSec == null || elapsedSec <= 0) return ''
  return `You have walked ${elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)} min`}. `
}

function discardMessage(elapsedSec?: number): string {
  return `${walked(elapsedSec)}Ending here does not record the walk — it will not appear in your history.`
}

export function LeaveWalkDialog(props: LeaveWalkDialogProps) {
  const { open, outcome, elapsedSec, onStay, onLeave } = props

  // Three outcomes do not fit two buttons, and they do not fit one row at 384 px either
  // ("Keep walking" alone is 96 px of text). Stacked, save first: it is the one that keeps data.
  if (outcome === 'choose') {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onStay() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Leave this walk?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {walked(elapsedSec)}Save it to your history, or discard it.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <Button className="w-full" onClick={props.onSave}>Save walk</Button>
            <Button variant="destructive" className="w-full" onClick={onLeave}>Discard</Button>
            <Button variant="ghost" className="w-full" onClick={onStay}>Keep walking</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const discarding = outcome === 'discard'
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => { if (!o) onStay() }}
      title={discarding ? 'Discard this walk?' : 'End walk?'}
      message={discarding
        ? discardMessage(elapsedSec)
        : 'Your interval walk is in progress. Ending now records what you have walked so far.'}
      confirmLabel={discarding ? 'Discard' : 'End walk'}
      cancelLabel="Keep walking"
      onConfirm={onLeave}
    />
  )
}
