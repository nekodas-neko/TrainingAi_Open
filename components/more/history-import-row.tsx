"use client"

import { useEffect, useRef, useState } from 'react'
import { History, Loader2, Square } from 'lucide-react'
import { toast } from 'sonner'
import { todayInTz } from '@trainingai/shared/date-utils'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { invalidateActivityWrites, invalidateBiometrics, invalidatePulledDomains } from '@/lib/cache-groups'
import { pullDelta, restoreFromCloud } from '@/lib/local-store/sync-engine'
import {
  fetchHistoryOldest, formatImportedTo, importEndMessage, importMoreHistory,
  HISTORY_WINDOW_DAYS, HISTORY_DECLINED_MESSAGE, RESTORE_SPAN_SLACK_MS, importNeedsRestore,
} from '@/lib/health-connect-history-import'

/**
 * "Import more history" (issue 2169): pulls older Health Connect data in, 30 days a window, each
 * window older than the last, until Health Connect has nothing more or the user taps Stop. A second
 * press continues from the account's stored oldest day. Health Connect exists only in the native app,
 * so on the web build the row does not render.
 *
 * One control, the existing row pattern of Data & Sync: while a run is going the same row becomes
 * "Stop importing" and its second line shows how far back it has reached.
 */
export function HistoryImportRow({ userId }: { userId?: string }) {
  const tz = useUserTimezone()
  const [native, setNative] = useState(false)
  const [oldest, setOldest] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  // Set when the restore pull for an imported span failed: the instant to restart that span from.
  // The next press retries it, even if that press imports nothing new.
  const restoreFromRef = useRef<string | null>(null)
  const [restorePending, setRestorePending] = useState(false)
  // The last press ended because the history permission was declined; cleared by the next press.
  const [declined, setDeclined] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { Capacitor } = await import('@capacitor/core')
      if (cancelled || !Capacitor.isNativePlatform()) return
      setNative(true)
      try {
        const stored = await fetchHistoryOldest()
        if (!cancelled) setOldest(stored)
      } catch { /* the subtitle falls back to the prompt; a press reads it again */ }
    })()
    return () => { cancelled = true }
  }, [])

  async function handlePress() {
    if (running) { stopRef.current = true; return }
    if (!userId) return
    stopRef.current = false
    setDeclined(false)
    setRunning(true)
    const today = todayInTz(tz)
    // The span's lower bound on the server's updated_at axis: rows this run writes are newer.
    const runStartIso = new Date(Date.now() - RESTORE_SPAN_SLACK_MS).toISOString()
    try {
      const outcome = await importMoreHistory({
        tz,
        shouldStop: () => stopRef.current,
        onProgress: setOldest,
      })
      if (outcome === null) {
        toast.error('Import needs the app (Health Connect) - not available on web')
        return
      }
      if (outcome.end === 'permission-declined') {
        // Plain message on the row; nothing was read, so there is nothing to pull or restore.
        setDeclined(true)
        return
      }
      if (outcome.oldest) setOldest(outcome.oldest)
      const message = importEndMessage(outcome, today)
      if (outcome.end === 'failed') toast.error(message, { duration: 15000 })
      else toast.success(message)
      // The rows landed on the server. Drop what derives from them, then pull them to this device
      // the way "Sync now" does - the pull reaches back 90 days.
      const retrying = restoreFromRef.current !== null
      if (outcome.windows > 0 || retrying) {
        await Promise.all([invalidateBiometrics(), invalidateActivityWrites()])
        try {
          const pulled = await pullDelta(userId, true)
          if (pulled) await invalidatePulledDomains(pulled.domains)
        } catch (err) { console.error('[history-import] pull after import failed:', err) }
      }
      // Older than 90 days the ordinary pull cannot reach, so run the restore pull for the imported
      // span only (issue 2713): from where this run (or the failed run before it) started, not the
      // whole history. The local store is the source of truth, so the days must land there.
      if ((outcome.windows > 0 || retrying) && importNeedsRestore(outcome.oldest ?? oldest, today)) {
        const since = restoreFromRef.current && restoreFromRef.current < runStartIso ? restoreFromRef.current : runStartIso
        await restoreImportedSpan(userId, since)
      } else {
        restoreFromRef.current = null
        setRestorePending(false)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[history-import] failed:', err)
      toast.error(`Import failed: ${msg}`, { duration: 15000 })
    } finally {
      setRunning(false)
    }
  }

  /** A failed restore never hides the import result above it and never moves the stored oldest day;
   *  it leaves a retryable message and the span to retry from. */
  async function restoreImportedSpan(uid: string, since: string) {
    let failed = false
    try {
      const res = await restoreFromCloud(uid, undefined, since)
      if (res) await invalidatePulledDomains(res.domains)
      failed = res === null ? false : res.failed
    } catch (err) {
      console.error('[history-import] restore of imported span failed:', err)
      failed = true
    }
    restoreFromRef.current = failed ? since : null
    setRestorePending(failed)
    if (failed) {
      toast.error('Imported, but the older days are not on this device yet - connection issue. Tap to retry.', { duration: 15000 })
    }
  }

  if (!native) return null

  const today = todayInTz(tz)
  const subtitle = declined && !running
    ? HISTORY_DECLINED_MESSAGE
    : restorePending && !running && oldest
    ? `Imported to ${formatImportedTo(oldest, today)}, but the older days are not on this device yet. Tap to retry.`
    : running
    ? (oldest ? `Importing... reached ${formatImportedTo(oldest, today)}` : 'Importing...')
    : (oldest ? `Imported to ${formatImportedTo(oldest, today)}. Tap to go ${HISTORY_WINDOW_DAYS} days further.`
              : `Pull older Health Connect data, ${HISTORY_WINDOW_DAYS} days at a time`)

  return (
    <button
      type="button"
      onClick={handlePress}
      className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/60 transition"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
          {running
            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : <History className="h-4 w-4 text-muted-foreground" />
          }
        </div>
        <div className="text-left">
          <p className="text-sm font-semibold">{running ? 'Stop importing' : 'Import more history'}</p>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {running && <Square className="h-4 w-4 text-muted-foreground" />}
    </button>
  )
}
