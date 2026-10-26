'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from 'sonner'
import { UserCheck, UserX, ShieldCheck, ShieldOff, Trash2, Plus, Loader2, ArrowLeft, Bluetooth, ClipboardList, Eraser } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import type { User } from '@trainingai/shared/types'
import { invalidateAdminPendingCount } from '@/lib/cache-groups'
import ExerciseManager from '@/components/admin/exercise-manager'
import ActivityTypeManager from '@/components/admin/activity-type-manager'
import { MoreRow, MoreRowGroup } from '@/components/more/more-row'
import { useTransitionRouter } from "@/lib/view-transition";
import { initialsOf } from '@/lib/initials';

type Tab = 'users' | 'invites' | 'exercises' | 'activities' | 'feedback' | 'devices'

/** `currentUserId` is the signed-in admin, so their own row offers no deactivate (issue 2383 item 3). */
export default function AdminContent({ currentUserId }: { currentUserId: string }) {
  const router = useTransitionRouter()
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<string[]>([])
  const [inviteInput, setInviteInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // RV-191. The screenshot used to zoom by `window.open(storedValue)` — navigating the browser to
  // a value a signed-in user supplied. It zooms in place instead; nothing navigates to it.
  const [zoomedShot, setZoomedShot] = useState<string | null>(null)
  const [feedbackSubmissions, setFeedbackSubmissions] = useState<{
    id: string; type: string; title: string; description: string | null;
    screenshotData: string | null; createdAt: string; userEmail: string; userName: string | null
  }[]>([])
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null)
  const [confirmDeleteFeedback, setConfirmDeleteFeedback] = useState<string | null>(null)
  // issue 2383 item 3: deactivating signs that user out to `/pending`, so it asks first. Activation does not.
  const [confirmDeactivate, setConfirmDeactivate] = useState<User | null>(null)
  // issue 2651: deleting a user runs the whole account deletion, and removing an invite un-approves an
  // email, so each asks first. Both name what the row already shows, so no new detail is exposed.
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const [confirmRemoveInvite, setConfirmRemoveInvite] = useState<string | null>(null)
  // #3369: both ask for the target's email, which the server checks again. `confirmErase` deletes an
  // account that holds data (the plain `confirmDelete` above is still the signup that never got in).
  const [confirmReset, setConfirmReset] = useState<User | null>(null)
  const [confirmErase, setConfirmErase] = useState<User | null>(null)
  // #3368: granting or removing admin is auth, so both ask first.
  const [confirmAdmin, setConfirmAdmin] = useState<{ user: User; grant: boolean } | null>(null)

  async function loadAll() {
    setLoading(true)
    try {
      const [uRes, iRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/invites'),
      ])
      const uData = await uRes.json()
      const iData = await iRes.json()
      setUsers(uData.users ?? [])
      setInvites(iData.emails ?? [])
    } catch {
      toast.error('Failed to load admin data')
    } finally {
      setLoading(false)
    }

    setFeedbackLoading(true)
    fetch('/api/admin/feedback')
      .then(r => r.ok ? r.json() : [])
      .then(d => { setFeedbackSubmissions(Array.isArray(d) ? d : []) })
      .catch(() => {})
      .finally(() => setFeedbackLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  async function toggleUser(userId: string, action: 'activate' | 'deactivate') {
    setActionLoading(userId)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: unknown } | null
        throw new Error(typeof data?.error === 'string' ? data.error : 'Action failed')
      }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isActive: action === 'activate' } : u))
      invalidateAdminPendingCount().catch(() => {})
      toast.success(action === 'activate' ? 'User activated' : 'User deactivated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  async function setAdmin(userId: string, grant: boolean) {
    setActionLoading(`admin-${userId}`)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: grant ? 'grant-admin' : 'revoke-admin' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: unknown } | null
        throw new Error(typeof data?.error === 'string' ? data.error : 'Action failed')
      }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isAdmin: grant } : u))
      toast.success(grant ? 'Admin granted' : 'Admin removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  async function addInvite() {
    const email = inviteInput.trim().toLowerCase()
    if (!email) return
    setActionLoading('invite-add')
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error()
      setInvites(prev => [...prev, email])
      setInviteInput('')
      toast.success(`${email} added to invite list`)
    } catch {
      toast.error('Failed to add invite')
    } finally {
      setActionLoading(null)
    }
  }

  async function deleteUser(userId: string) {
    setActionLoading(`delete-${userId}`)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (res.status === 409) {
        // issue 2695: the account gained data after the list loaded. The server's refusal is the plain-words reason.
        const body = await res.json().catch(() => null) as { error?: string } | null
        toast.error(body?.error ?? 'This account has data under it, so it cannot be deleted.')
        return
      }
      if (!res.ok) throw new Error()
      setUsers(prev => prev.filter(u => u.id !== userId))
      toast.success('User deleted')
    } catch {
      toast.error('Failed to delete user')
    } finally {
      setActionLoading(null)
    }
  }

  /** Reads the server's plain-words reason from a refusal, or says what we know. */
  async function reasonOf(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => null) as { error?: unknown } | null
    return typeof body?.error === 'string' ? body.error : fallback
  }

  // #3369. Both send what the admin typed, not the row's email, so the server's check is the real one.
  async function resetUserData(u: User, typedEmail: string) {
    setActionLoading(`reset-${u.id}`)
    try {
      const res = await fetch('/api/admin/users/reset-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, confirmEmail: typedEmail }),
      })
      if (!res.ok) {
        toast.error(await reasonOf(res, `The data could not be reset (HTTP ${res.status}). Nothing was removed.`))
        return
      }
      const body = await res.json().catch(() => null) as { signedOut?: boolean; defaultsSeeded?: boolean } | null
      if (body?.signedOut) {
        // Their own account: the reset ended this session too, and the server has expired the cookie.
        // Go to the sign-in page. This phone still holds the old rows; the data-epoch check wipes
        // them on the next sign-in, before anything is pushed (`lib/local-store/data-epoch.ts`).
        toast.success('Your data was reset. Sign in again to start fresh.')
        window.location.replace('/sign-in')
        return
      }
      toast.success(body?.defaultsSeeded === false
        ? `${userLabel(u)}'s data was reset, but the built-in styles could not be put back. Reset again to add them.`
        : `${userLabel(u)}'s data was reset. They are signed out on every device.`)
    } catch {
      toast.error('No connection. Nothing was removed.')
    } finally {
      setActionLoading(null)
    }
  }

  async function eraseUser(u: User, typedEmail: string) {
    setActionLoading(`delete-${u.id}`)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, confirmEmail: typedEmail }),
      })
      if (!res.ok) {
        toast.error(await reasonOf(res, `The account could not be deleted (HTTP ${res.status}). Nothing was removed.`))
        return
      }
      setUsers(prev => prev.filter(x => x.id !== u.id))
      toast.success(`${userLabel(u)} and their data were deleted.`)
    } catch {
      toast.error('No connection. Nothing was removed.')
    } finally {
      setActionLoading(null)
    }
  }

  async function removeInvite(email: string) {
    setActionLoading(`invite-${email}`)
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error()
      setInvites(prev => prev.filter(e => e !== email))
      toast.success('Removed from invite list')
    } catch {
      toast.error('Failed to remove invite')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // issue 2695: an inactive user with no data under the account is a signup that never got in
  // (Pending: Activate or Delete); one with data was in and was deactivated (Deactivated: Activate
  // only). `hasData` missing is read as "has data", so an unknown never offers the trash.
  const inactive = users.filter(u => !u.isActive)
  const pending = inactive.filter(u => u.hasData === false)
  const deactivated = inactive.filter(u => u.hasData !== false)
  const active = users.filter(u => u.isActive)

  return (
    <div className="min-h-screen bg-page px-6 pt-safe pb-nav-safe">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Go back" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Admin Console</h1>
            <p className="text-sm text-muted-foreground">{users.length} users · {invites.length} invites</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg bg-muted p-1 overflow-x-auto scrollbar-hide">
          {(['users', 'invites', 'exercises', 'activities', 'feedback', 'devices'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'shrink-0 rounded-md py-2 px-3 text-xs font-medium transition-colors capitalize relative',
                tab === t ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t === 'users'
                ? `Users${inactive.length > 0 ? ` (${inactive.length})` : ''}`
                : t === 'feedback' && feedbackSubmissions.length > 0
                    ? <><span>Feedback</span> <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold w-4 h-4">{feedbackSubmissions.length}</span></>
                    : t}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div className="space-y-4">
            {pending.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending approval</p>
                {pending.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === currentUserId}
                    onToggle={toggleUser}
                    onDelete={() => setConfirmDelete(u)}
                    loadingId={actionLoading}
                  />
                ))}
              </div>
            )}
            {deactivated.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deactivated</p>
                {deactivated.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === currentUserId}
                    onToggle={toggleUser}
                    onReset={() => setConfirmReset(u)}
                    onErase={() => setConfirmErase(u)}
                    loadingId={actionLoading}
                  />
                ))}
              </div>
            )}
            {active.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</p>
                {active.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === currentUserId}
                    onToggle={(id, action) => action === 'deactivate' ? setConfirmDeactivate(u) : toggleUser(id, action)}
                    onReset={() => setConfirmReset(u)}
                    onErase={() => setConfirmErase(u)}
                    onToggleAdmin={() => setConfirmAdmin({ user: u, grant: !u.isAdmin })}
                    loadingId={actionLoading}
                  />
                ))}
              </div>
            )}
            {users.length === 0 && <p className="text-center text-muted-foreground py-8">No users yet.</p>}
            <ConfirmDialog
              open={!!confirmDelete}
              onOpenChange={o => { if (!o) setConfirmDelete(null) }}
              title="Delete user?"
              message={confirmDelete
                ? `Delete ${userLabel(confirmDelete)}? This permanently deletes their account and everything under it. It cannot be undone.`
                : ''}
              confirmLabel="Delete"
              onConfirm={() => {
                const u = confirmDelete
                setConfirmDelete(null)
                if (u) deleteUser(u.id)
              }}
            />
            <ConfirmDialog
              open={!!confirmReset}
              onOpenChange={o => { if (!o) setConfirmReset(null) }}
              title="Reset data?"
              message={confirmReset
                ? `This permanently deletes everything ${userLabel(confirmReset)} has recorded: workouts, food, sleep, body metrics, goals, settings, friendships and connected devices, and their Oura connection is revoked. Their account, email, sign-in and ${confirmReset.isAdmin ? 'admin and ' : ''}active status stay. Every device they use is signed out and wiped, and they sign in again to start fresh.${confirmReset.id === currentUserId ? ' This is your own account, so you will be signed out now.' : ''} It cannot be undone. Type their email, ${confirmReset.email}, to confirm.`
                : ''}
              confirmLabel="Reset data"
              confirmPhrase={confirmReset?.email}
              confirmPhraseKind="email"
              onConfirm={typed => {
                const u = confirmReset
                setConfirmReset(null)
                if (u) resetUserData(u, typed)
              }}
            />
            <ConfirmDialog
              open={!!confirmErase}
              onOpenChange={o => { if (!o) setConfirmErase(null) }}
              title="Delete account and data?"
              message={confirmErase
                ? `This permanently deletes ${userLabel(confirmErase)}'s account and everything under it, and revokes their Oura connection. Their friendships are removed too. Their invite is removed as well, so they will need a new invite to sign up again. It cannot be undone. Type their email, ${confirmErase.email}, to confirm.`
                : ''}
              confirmLabel="Delete account"
              confirmPhrase={confirmErase?.email}
              confirmPhraseKind="email"
              onConfirm={typed => {
                const u = confirmErase
                setConfirmErase(null)
                if (u) eraseUser(u, typed)
              }}
            />
            <ConfirmDialog
              open={!!confirmAdmin}
              onOpenChange={o => { if (!o) setConfirmAdmin(null) }}
              title={confirmAdmin?.grant ? 'Make admin?' : 'Remove admin?'}
              message={confirmAdmin
                ? confirmAdmin.grant
                  ? `${userLabel(confirmAdmin.user)} will be able to manage users, invites and data from the admin console.`
                  : `${userLabel(confirmAdmin.user)} will lose access to the admin console.`
                : ''}
              confirmLabel={confirmAdmin?.grant ? 'Make admin' : 'Remove admin'}
              onConfirm={() => {
                const c = confirmAdmin
                setConfirmAdmin(null)
                if (c) setAdmin(c.user.id, c.grant)
              }}
            />
            <ConfirmDialog
              open={!!confirmDeactivate}
              onOpenChange={o => { if (!o) setConfirmDeactivate(null) }}
              title="Deactivate user?"
              message={confirmDeactivate
                ? `${userLabel(confirmDeactivate)} will be signed out to the pending screen until you activate them again.`
                : ''}
              confirmLabel="Deactivate"
              onConfirm={() => {
                const u = confirmDeactivate
                setConfirmDeactivate(null)
                if (u) toggleUser(u.id, 'deactivate')
              }}
            />
          </div>
        )}

        {tab === 'invites' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={inviteInput}
                onChange={e => setInviteInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addInvite()}
                placeholder="email@example.com"
                type="email"
              />
              <Button onClick={addInvite} disabled={actionLoading === 'invite-add' || !inviteInput.trim()}>
                {actionLoading === 'invite-add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
            <div className="space-y-2">
              {invites.map(email => (
                <div key={email} className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <span className="text-sm">{email}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRemoveInvite(email)}
                    aria-label={`Remove ${email}`}
                    disabled={actionLoading === `invite-${email}`}
                  >
                    {actionLoading === `invite-${email}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                  </Button>
                </div>
              ))}
              <ConfirmDialog
                open={!!confirmRemoveInvite}
                onOpenChange={o => { if (!o) setConfirmRemoveInvite(null) }}
                title="Remove invite?"
                message={confirmRemoveInvite
                  ? `${confirmRemoveInvite} will no longer be pre-approved. If they sign up afterwards they wait for approval.`
                  : ''}
                confirmLabel="Remove"
                onConfirm={() => {
                  const e = confirmRemoveInvite
                  setConfirmRemoveInvite(null)
                  if (e) removeInvite(e)
                }}
              />
              {invites.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  No invites yet. Add an email above to pre-approve a user.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Q-531. The three device consoles were already routed under `/admin` and already
            `isAdminUser`-gated — what Q-234 moved was the LINKS, out to Settings → Developer, which
            is where the owner went looking and did not find them: *"it was moved away from the admin
            section = bad"*. They are listed here now, in the order the operations runbook uses. */}
        {tab === 'devices' && (
          <MoreRowGroup label="Ring, strap & capture">
            <MoreRow icon={Bluetooth} label="Oura BLE — drain and verify" onClick={() => router.push('/admin/oura-ble')} />
            <MoreRow icon={ClipboardList} label="Device data capture" onClick={() => router.push('/admin/data-capture')} />
          </MoreRowGroup>
        )}

        {tab === 'exercises' && (
          <ExerciseManager />
        )}

        {tab === 'activities' && (
          <ActivityTypeManager />
        )}

        {tab === 'feedback' && (
          <div className="space-y-3">
            {feedbackLoading && (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
              </div>
            )}
            {!feedbackLoading && feedbackSubmissions.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No feedback submissions.</p>
            )}
            {feedbackSubmissions.map(sub => {
              const typeColor = sub.type === 'bug' ? 'bg-red-500/15 text-red-400' : sub.type === 'feature' ? 'bg-blue-500/15 text-blue-400' : 'bg-muted text-muted-foreground'
              const isExpanded = expandedFeedback === sub.id
              const isConfirming = confirmDeleteFeedback === sub.id
              return (
                <div key={sub.id} className="rounded-xl border border-border bg-muted/40 overflow-hidden">
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3 flex items-start gap-3"
                    onClick={() => setExpandedFeedback(isExpanded ? null : sub.id)}
                  >
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeColor}`}>
                      {sub.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{sub.title}</p>
                      <p className="text-[10px] text-muted-foreground">{sub.userEmail} · {new Date(sub.createdAt).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}</p>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                      {sub.description && (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{sub.description}</p>
                      )}
                      {sub.screenshotData && (
                        <button
                          type="button"
                          aria-pressed={zoomedShot === sub.id}
                          aria-label={zoomedShot === sub.id ? 'Shrink screenshot' : 'Enlarge screenshot'}
                          onClick={() => setZoomedShot(zoomedShot === sub.id ? null : sub.id)}
                          className="block w-full text-left"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- base64 screenshot, variable size */}
                          <img
                            src={sub.screenshotData}
                            alt="Screenshot"
                            className={cn(
                              'rounded-xl border border-border',
                              zoomedShot === sub.id ? 'w-full cursor-zoom-out' : 'max-w-full cursor-zoom-in',
                            )}
                          />
                        </button>
                      )}
                      <div className="flex justify-end">
                        {isConfirming ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFeedback(null)}
                              className="text-xs text-muted-foreground px-3 py-1.5 rounded-lg border border-border"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await fetch(`/api/admin/feedback/${sub.id}`, { method: 'DELETE' })
                                setFeedbackSubmissions(prev => prev.filter(s => s.id !== sub.id))
                                setConfirmDeleteFeedback(null)
                                setExpandedFeedback(null)
                              }}
                              className="text-xs bg-destructive text-destructive-foreground px-3 py-1.5 rounded-lg"
                            >
                              Confirm delete
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFeedback(sub.id)}
                            className="text-xs text-destructive px-3 py-1.5 rounded-lg border border-destructive/30"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** How the row names a user, so a confirm says exactly what the admin tapped on. */
function userLabel(u: User): string {
  return u.displayName || u.name || u.email
}

/** `hasData` is sent by `GET /api/admin/users` for inactive users (issue 2695). */
type AdminUser = User & { hasData?: boolean }

function UserRow({
  user,
  isSelf = false,
  onToggle,
  onDelete,
  onReset,
  onErase,
  onToggleAdmin,
  loadingId,
}: {
  user: AdminUser
  /** The signed-in admin's own row: no deactivate, no delete. The server refuses both too; this only hides them. */
  isSelf?: boolean
  onToggle: (id: string, action: 'activate' | 'deactivate') => void
  onDelete?: (id: string) => void
  /** #3369: reset this user's data and keep the account. Offered for yourself or a non-admin, never another admin. */
  onReset?: (id: string) => void
  /** #3369: delete an account that holds data. Offered for a non-admin who is not you. */
  onErase?: (id: string) => void
  /** Active rows only. Absent on your own row: the server refuses removing your own admin. */
  onToggleAdmin?: () => void
  loadingId: string | null
}) {
  const isToggleLoading = loadingId === user.id
  const isDeleteLoading = loadingId === `delete-${user.id}`
  const isResetLoading = loadingId === `reset-${user.id}`
  // The server refuses another admin's account whatever the screen shows; this only hides the buttons.
  // `hasData` is only computed for inactive users (the server sends `false` for every active one), so
  // it means "nothing to reset" only on an inactive row: a signup that never got in.
  const neverGotIn = !user.isActive && user.hasData === false
  const canReset = onReset && !neverGotIn && (!user.isAdmin || isSelf)
  const canErase = onErase && !neverGotIn && !user.isAdmin && !isSelf
  const isAdminLoading = loadingId === `admin-${user.id}`
  const initials = initialsOf(user.displayName || user.name || user.email)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3">
      {user.avatar ? (
        <Image src={user.avatar} alt="" width={32} height={32}
          unoptimized={user.avatar.startsWith('data:')} className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initials}
        </div>
      )}
      {/* min-w keeps the name readable at 384 px: with three icons the actions wrap to a second line instead of squeezing it away (#3369). */}
      <div className="min-w-[9rem] flex-1">
        <p className="truncate text-sm font-medium">{user.displayName || user.name || '—'}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
      <span className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
        user.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'
      )}>
        {user.isActive ? 'Active' : user.hasData === false ? 'Pending' : 'Deactivated'}
      </span>
      {user.isAdmin && (
        <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">Admin</span>
      )}
      {onToggleAdmin && user.isActive && !(isSelf && user.isAdmin) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleAdmin}
          disabled={isAdminLoading}
          title={user.isAdmin ? 'Remove admin' : 'Make admin'}
          aria-label={user.isAdmin ? 'Remove admin' : 'Make admin'}
        >
          {isAdminLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : user.isAdmin
              ? <ShieldOff className="h-4 w-4 text-destructive" />
              : <ShieldCheck className="h-4 w-4 text-blue-400" />}
        </Button>
      )}
      {onDelete && !user.isActive && user.hasData === false && !isSelf && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(user.id)}
          disabled={isDeleteLoading}
          title="Delete user"
          aria-label="Delete user"
        >
          {isDeleteLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Trash2 className="h-4 w-4 text-destructive" />}
        </Button>
      )}
      {canReset && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onReset(user.id)}
          disabled={isResetLoading}
          title="Reset data"
          aria-label="Reset data"
        >
          {isResetLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Eraser className="h-4 w-4 text-destructive" />}
        </Button>
      )}
      {canErase && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onErase(user.id)}
          disabled={isDeleteLoading}
          title="Delete account and data"
          aria-label="Delete account and data"
        >
          {isDeleteLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Trash2 className="h-4 w-4 text-destructive" />}
        </Button>
      )}
      {!(isSelf && user.isActive) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggle(user.id, user.isActive ? 'deactivate' : 'activate')}
          disabled={isToggleLoading}
          title={user.isActive ? 'Deactivate' : 'Activate'}
          aria-label={user.isActive ? 'Deactivate' : 'Activate'}
        >
          {isToggleLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : user.isActive
              ? <UserX className="h-4 w-4 text-destructive" />
              : <UserCheck className="h-4 w-4 text-green-500" />}
        </Button>
      )}
    </div>
  )
}
