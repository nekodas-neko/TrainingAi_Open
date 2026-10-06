'use client'

import { signOutAndClearDevice } from '@/lib/sign-out'

export type AccountDeletionOutcome = { ok: true } | { ok: false; error: string }

/**
 * #2120 — delete the signed-in account, then leave this device holding nothing of it.
 *
 * **Server first, device second, and the device only on success.** Wiping first would throw away
 * unsynced changes for an account that still exists whenever the delete then failed (offline, a
 * server error), and those changes exist nowhere else.
 *
 * The device half is `signOutAndClearDevice`, not a second wipe: it clears the local store — every
 * table read from `sqlite_master`, the sync outbox included, so nothing queued re-pushes for a
 * deleted account — then the cache, then signs out server-side and lands on /sign-in.
 *
 * **It never reaches the Oura plugin.** The ring's BLE key lives in native SharedPreferences, which
 * none of this touches, and the owner's decision (2026-09-24) is that it stays: it belongs to the
 * phone, not the account, and clearing it cannot be undone without a factory reset and re-pair.
 *
 * `onDeleted` runs between the two halves, so the screen can say the account is gone before the
 * sign-out navigates away.
 */
export async function deleteAccountAndSignOut(
  confirm: string,
  onDeleted?: () => void,
): Promise<AccountDeletionOutcome> {
  let res: Response
  try {
    res = await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    })
  } catch {
    return { ok: false, error: 'No connection. Deleting your account needs the server, and nothing was deleted.' }
  }
  if (!res.ok) {
    if (res.status === 429) return { ok: false, error: 'Too many attempts. Try again in an hour. Nothing was deleted.' }
    if (res.status === 401) return { ok: false, error: 'Your session has ended. Sign in again, then delete. Nothing was deleted.' }
    const body = await res.json().catch(() => null) as { error?: unknown } | null
    const error = typeof body?.error === 'string' ? body.error : `Deletion failed (HTTP ${res.status}). Nothing was deleted.`
    return { ok: false, error }
  }
  onDeleted?.()
  await signOutAndClearDevice()
  return { ok: true }
}
