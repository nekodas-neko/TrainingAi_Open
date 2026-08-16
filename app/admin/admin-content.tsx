'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { UserCheck, UserX, Trash2, Plus, Loader2, ArrowLeft } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import type { User } from '@trainingai/shared/types'
import { invalidateAdminPendingCount } from '@/lib/cache-groups'
import ExerciseManager from '@/components/admin/exercise-manager'
import ActivityTypeManager from '@/components/admin/activity-type-manager'
import { useTransitionRouter } from "@/lib/view-transition";

type Tab = 'users' | 'invites' | 'exercises' | 'activities' | 'feedback'

export default function AdminContent() {
  const router = useTransitionRouter()
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [invites, setInvites] = useState<string[]>([])
  const [inviteInput, setInviteInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [feedbackSubmissions, setFeedbackSubmissions] = useState<{
    id: string; type: string; title: string; description: string | null;
    screenshotData: string | null; createdAt: string; userEmail: string; userName: string | null
  }[]>([])
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null)
  const [confirmDeleteFeedback, setConfirmDeleteFeedback] = useState<string | null>(null)

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
      if (!res.ok) throw new Error()
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isActive: action === 'activate' } : u))
      invalidateAdminPendingCount().catch(() => {})
      toast.success(action === 'activate' ? 'User activated' : 'User deactivated')
    } catch {
      toast.error('Action failed')
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
      if (!res.ok) throw new Error()
      setUsers(prev => prev.filter(u => u.id !== userId))
      toast.success('User deleted')
    } catch {
      toast.error('Failed to delete user')
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

  const pending = users.filter(u => !u.isActive)
  const active = users.filter(u => u.isActive)

  return (
    <div className="min-h-screen bg-page px-6 pt-safe pb-nav-safe">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Admin Console</h1>
            <p className="text-sm text-muted-foreground">{users.length} users · {invites.length} invites</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg bg-muted p-1 overflow-x-auto scrollbar-hide">
          {(['users', 'invites', 'exercises', 'activities', 'feedback'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'shrink-0 rounded-md py-2 px-3 text-xs font-medium transition-colors capitalize relative',
                tab === t ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t === 'users'
                ? `Users${pending.length > 0 ? ` (${pending.length})` : ''}`
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
                {pending.map(u => <UserRow key={u.id} user={u} onToggle={toggleUser} onDelete={deleteUser} loadingId={actionLoading} />)}
              </div>
            )}
            {active.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</p>
                {active.map(u => <UserRow key={u.id} user={u} onToggle={toggleUser} loadingId={actionLoading} />)}
              </div>
            )}
            {users.length === 0 && <p className="text-center text-muted-foreground py-8">No users yet.</p>}
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
                    onClick={() => removeInvite(email)}
                    disabled={actionLoading === `invite-${email}`}
                  >
                    {actionLoading === `invite-${email}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                  </Button>
                </div>
              ))}
              {invites.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  No invites yet. Add an email above to pre-approve a user.
                </p>
              )}
            </div>
          </div>
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
                        // eslint-disable-next-line @next/next/no-img-element -- base64 screenshot, variable size
                        <img
                          src={sub.screenshotData}
                          alt="Screenshot"
                          className="rounded-xl max-w-full border border-border cursor-zoom-in"
                          onClick={() => window.open(sub.screenshotData!, '_blank')}
                        />
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

function UserRow({
  user,
  onToggle,
  onDelete,
  loadingId,
}: {
  user: User
  onToggle: (id: string, action: 'activate' | 'deactivate') => void
  onDelete?: (id: string) => void
  loadingId: string | null
}) {
  const isToggleLoading = loadingId === user.id
  const isDeleteLoading = loadingId === `delete-${user.id}`
  const initials = (user.displayName || user.name || user.email).slice(0, 2).toUpperCase()

  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      {user.avatar ? (
        <Image src={user.avatar} alt="" width={32} height={32}
          unoptimized={user.avatar.startsWith('data:')} className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.displayName || user.name || '—'}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
      <span className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
        user.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'
      )}>
        {user.isActive ? 'Active' : 'Pending'}
      </span>
      {onDelete && !user.isActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(user.id)}
          disabled={isDeleteLoading}
          title="Delete user"
        >
          {isDeleteLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Trash2 className="h-4 w-4 text-destructive" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onToggle(user.id, user.isActive ? 'deactivate' : 'activate')}
        disabled={isToggleLoading}
        title={user.isActive ? 'Deactivate' : 'Activate'}
      >
        {isToggleLoading
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : user.isActive
            ? <UserX className="h-4 w-4 text-destructive" />
            : <UserCheck className="h-4 w-4 text-green-500" />}
      </Button>
    </div>
  )
}
