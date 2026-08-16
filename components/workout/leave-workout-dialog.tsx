"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface LeaveWorkoutDialogProps {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}

export function LeaveWorkoutDialog({ open, onStay, onLeave }: LeaveWorkoutDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => { if (!o) onStay(); }}
      title="Leave workout?"
      message="Your workout is in progress. Leaving now will end the session and unsaved sets will be lost."
      confirmLabel="Leave"
      cancelLabel="Stay"
      onConfirm={onLeave}
    />
  );
}
