'use client'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface LeaveWalkDialogProps {
  open: boolean
  /**
   * What ending here actually does to the walk.
   *
   * It is a REQUIRED prop rather than an inferred default because the three call sites genuinely
   * differ and the old shared copy — *"Ending now will stop it early"* — was false at all of them.
   * The End-walk button saves what was walked (BF-190); the back gesture and the tab bar call
   * `reset()` and keep nothing, at any duration. Naming the outcome is what stops a fourth caller
   * inheriting whichever sentence happened to be the default.
   */
  outcome: 'save' | 'discard'
  /** Seconds walked so far, quoted back when the walk is being discarded. */
  elapsedSec?: number
  onStay: () => void
  onLeave: () => void
}

function discardMessage(elapsedSec?: number): string {
  const walked = elapsedSec != null && elapsedSec > 0
    ? `You have walked ${elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)} min`}. `
    : ''
  return `${walked}Ending here does not record the walk — it will not appear in your history.`
}

export function LeaveWalkDialog({ open, outcome, elapsedSec, onStay, onLeave }: LeaveWalkDialogProps) {
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
