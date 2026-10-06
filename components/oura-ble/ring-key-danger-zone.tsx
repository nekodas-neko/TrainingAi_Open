'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * The ring key's delete control, kept last on the BLE console and in its own box (#2382). It used
 * to be a one-tap ghost button one row under Redecode. The key exists only on this phone and
 * nothing can restore it, so deleting it takes a typed phrase here and then the plugin's own
 * native tap (RV-196).
 */
export function RingKeyDangerZone({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <section className="space-y-2 rounded-md border border-destructive/40 p-4">
        <h2 className="text-sm font-medium text-destructive">Danger zone</h2>
        <p className="text-xs text-muted-foreground">
          Deleting the ring key cannot be undone. Back it up with “Show key for backup” first.
        </p>
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpen(true)}>Delete ring key</Button>
      </section>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete the ring key?"
        message="This deletes the ring's only key. It cannot be recovered from the app, the server or any log, and without it the ring cannot be read. Type DELETE to confirm."
        confirmLabel="Delete ring key"
        confirmPhrase="DELETE"
        onConfirm={() => { setOpen(false); onDelete() }}
      />
    </>
  )
}
