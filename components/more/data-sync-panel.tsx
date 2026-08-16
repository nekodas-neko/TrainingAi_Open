"use client"

import { useState } from 'react'
import { CloudDownload, FileDown, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { clearAllCache } from '@/lib/sqlite/cache'
import { pullDelta, restoreFromCloud } from '@/lib/local-store/sync-engine'
import { LAST_SYNC_KEY } from '@/lib/health-connect-sync'

/** Sync now · Restore from cloud · Export my data. These three used to sit under an "About"
 *  heading beside the version string (Q-232) — data operations filed under a version number. */
export function DataSyncPanel({ userId }: { userId?: string }) {
  const [syncing, setSyncing] = useState(false)
  const [restoring, setRestoring] = useState(false)

  async function handleSyncNow() {
    if (!userId || syncing) return
    setSyncing(true)
    try {
      localStorage.removeItem(LAST_SYNC_KEY)
      const result = await pullDelta(userId, true)
      if (result === null) {
        // On web (no native SQLite), fall back to clearing the API cache so the
        // next navigation picks up fresh data from the server.
        await clearAllCache()
        toast.success('Cache cleared — data will refresh automatically')
      } else {
        toast.success(`Synced ${result.synced} record${result.synced !== 1 ? 's' : ''}`)
      }
    } catch (err) {
      // Surface the real cause — a silent generic toast hid an on-device applyDelta
      // failure that stranded every sync (no-silent-fallback rule).
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[sync-now] failed:', err)
      toast.error(`Sync failed: ${msg}`, { duration: 15000 })
    } finally {
      setSyncing(false)
    }
  }

  async function handleRestore() {
    if (!userId || restoring || syncing) return
    setRestoring(true)
    try {
      // Full-history restore: drains the ?mode=restore pull (no 90-day floor) until the
      // server reports nothing more, rebuilding the local store after a wipe / on a new device.
      const result = await restoreFromCloud(userId)
      if (result === null) {
        toast.error('Restore needs the app (native storage) — not available on web')
      } else if (result.failed) {
        toast.error(
          result.synced > 0
            ? `Restore paused after ${result.synced} record${result.synced !== 1 ? 's' : ''} — connection issue. Tap Restore again to continue.`
            : 'Restore failed — check your connection and try again.',
          { duration: 15000 },
        )
      } else {
        toast.success(`Restored ${result.synced} record${result.synced !== 1 ? 's' : ''} from cloud`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[restore] failed:', err)
      toast.error(`Restore failed: ${msg}`, { duration: 15000 })
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
      <button
        type="button"
        onClick={handleSyncNow}
        disabled={syncing}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/60 transition disabled:opacity-50"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
            {syncing
              ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              : <RefreshCw className="h-4 w-4 text-muted-foreground" />
            }
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold">Sync now</p>
            <p className="text-[10px] text-muted-foreground">Pull latest data from server</p>
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={handleRestore}
        disabled={restoring || syncing}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/60 transition disabled:opacity-50"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
            {restoring
              ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              : <CloudDownload className="h-4 w-4 text-muted-foreground" />
            }
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold">Restore from cloud</p>
            <p className="text-[10px] text-muted-foreground">Rebuild full history after a wipe / on a new device</p>
          </div>
        </div>
      </button>
      <a
        href="/api/export"
        className="flex items-center justify-between px-4 py-3 hover:bg-muted/60 transition"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
            <FileDown className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">Export my data</p>
            <p className="text-[10px] text-muted-foreground">Download everything as a single file</p>
          </div>
        </div>
      </a>
    </div>
  )
}
