'use client'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface LeaveWalkDialogProps {
  open: boolean
  onStay: () => void
  onLeave: () => void
}

export function LeaveWalkDialog({ open, onStay, onLeave }: LeaveWalkDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => { if (!o) onStay() }}
      title="End walk?"
      message="Your interval walk is in progress. Ending now will stop it early."
      confirmLabel="End walk"
      cancelLabel="Keep walking"
      onConfirm={onLeave}
    />
  )
}
