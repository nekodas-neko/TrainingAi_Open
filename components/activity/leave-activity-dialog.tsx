'use client'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface LeaveActivityDialogProps {
  open: boolean
  onStay: () => void
  onLeave: () => void
}

export function LeaveActivityDialog({ open, onStay, onLeave }: LeaveActivityDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => { if (!o) onStay() }}
      title="Leave activity?"
      message="Your activity is still recording. Leaving now will discard it."
      confirmLabel="Discard"
      cancelLabel="Keep recording"
      onConfirm={onLeave}
    />
  )
}
