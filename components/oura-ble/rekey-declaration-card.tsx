'use client'
import { useCallback, useEffect, useState } from 'react'
import { KeyRound, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * Q-317 — declare that the ring was deliberately re-keyed.
 *
 * A re-key restarts the ring's own clock, and the server cannot tell that apart from a history
 * re-drain by counter shape alone. Inferring it re-timed the owner's entire sleep history twice,
 * which is why Q-314 made it a declaration. A declaration nobody can make in the app is one that
 * gets forgotten at exactly the moment it is needed — right after a re-key, on a laptop,
 * mid-`open_oura`.
 *
 * It lives OUTSIDE `OuraBleDebug` deliberately: that component returns the native-unavailable
 * banner and renders nothing after it whenever the plugin is absent, which is precisely the
 * situation a laptop is in. The declaration needs no ring present — only the server.
 */
interface Pending {
  id: number
  declaredAt: string
}

export function RekeyDeclarationCard() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/oura-ble/rekey')
      const data = await res.json()
      if (!res.ok) { setError(data?.error ?? `HTTP ${res.status}`); return }
      setError(null)
      setPending(data.pending ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function declare() {
    setConfirmOpen(false)
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/oura-ble/rekey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      })
      const data = await res.json()
      if (!res.ok) setError(data?.error ?? `HTTP ${res.status}`)
      else { setError(null); setMessage(data.note ?? null); setNote('') }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  async function cancel() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/oura-ble/rekey', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) setError(data?.error ?? `HTTP ${res.status}`)
      else { setError(null); setMessage(data.note ?? null) }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  return (
    <section className="rounded-lg border border-border p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4" /> Ring re-key
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Declare this after re-keying the ring with <code>open_oura</code>. A re-key restarts the
        ring&rsquo;s own clock, which looks identical to a history re-drain — telling the server
        outright is what stops it re-timing your sleep history.
      </p>

      {/* The whole point of the deferred effect is that it is stated up front: a control that looks
          like it acted immediately invites a second press, and a second declaration is a second
          epoch. */}
      <p className="mb-3 rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
        Nothing happens at the moment you press this. The new clock value is not knowable until the
        ring reports, so the declaration waits and the <strong>next drain from the ring</strong>
        {' '}consumes it.
      </p>

      {error && <p className="mb-2 text-xs text-destructive">Error: {error}</p>}

      {loaded && pending ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="text-muted-foreground">
              A declaration is <strong>waiting</strong> (made {new Date(pending.declaredAt).toLocaleString()}).
              It is consumed by the next drain. Cancel it only if it was a mistake.
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>
            {busy ? 'Working…' : 'Cancel declaration'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
            placeholder="Optional note (e.g. why it was re-keyed)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)} disabled={busy || !loaded}>
            {busy ? 'Working…' : 'Declare a re-key'}
          </Button>
        </div>
      )}

      {message && <p className="mt-2 text-xs">{message}</p>}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Declare that the ring was re-keyed?"
        message="Only do this if you have just re-keyed the ring with open_oura. The next drain opens a new clock epoch, and once it has been consumed it cannot be cancelled — every timestamp derived from that epoch depends on the row."
        confirmLabel="Declare"
        onConfirm={declare}
      />
    </section>
  )
}
