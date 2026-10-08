// @vitest-environment jsdom
/**
 * issue 2651 — the trash icon on a pending user's row on the admin Users screen ran the full
 * account deletion (`DELETE /api/admin/users`) on one tap, and the invite trash did the same for an
 * invite. Both now open the same ConfirmDialog the deactivate icon uses (issue 2383 item 3).
 *
 * These mount the real `AdminContent` and count the DELETE requests that reach the network: none
 * until the confirm is pressed, none on cancel, and no delete control on the signed-in admin's own row.
 * The server refuses deleting yourself as well (`deactivate-self-guard.test.ts`); hiding is the
 * convenience, the route is the guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/lib/view-transition', () => ({ useTransitionRouter: () => ({ prefetch: () => {}, push: () => {}, back: () => {} }) }))
vi.mock('@/lib/cache-groups', () => ({ invalidateAdminPendingCount: vi.fn(async () => {}) }))
vi.mock('@/components/admin/exercise-manager', () => ({ default: () => null }))
vi.mock('@/components/admin/activity-type-manager', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import AdminContent from '../admin-content'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ME = 'admin-self'
const THEM = 'pending-user'
const USERS = [
  { id: ME, email: 'me@example.com', name: 'Owner', displayName: 'Owner', isActive: true, isAdmin: true },
  { id: THEM, email: 'pending@example.com', name: null, displayName: 'Pending Tester', isActive: false, isAdmin: false, hasData: false },
]

let container: HTMLDivElement
let root: Root | null = null
let fetchMock: ReturnType<typeof vi.fn>
let users: typeof USERS

const deletes = (path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === path && (init as RequestInit | undefined)?.method === 'DELETE')

async function flush() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function mount() {
  root = createRoot(container)
  await act(async () => { root!.render(createElement(AdminContent, { currentUserId: ME })) })
  await flush()
}

function rowOf(email: string): HTMLElement {
  const p = [...container.querySelectorAll('p')].find(el => el.textContent === email)
  if (!p) throw new Error(`no row for ${email}`)
  return p.closest('div.rounded-lg') as HTMLElement
}

function buttonIn(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
}

async function click(el: HTMLElement) {
  await act(async () => { el.click() })
  await flush()
}

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  users = USERS
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }), { status: 200 })
    if (url === '/api/admin/users') return new Response(JSON.stringify({ users }), { status: 200 })
    if (url === '/api/admin/invites') return new Response(JSON.stringify({ emails: ['invitee@example.com'] }), { status: 200 })
    return new Response('[]', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('deleting a pending user from the admin Users screen (issue 2651)', () => {
  it('the trash icon opens a confirm naming the user; nothing is sent until Delete is pressed', async () => {
    await mount()
    await click(buttonIn(rowOf('pending@example.com'), 'Delete user')!)
    expect(deletes('/api/admin/users')).toHaveLength(0)

    const d = dialog()!
    expect(d).not.toBeNull()
    expect(d.textContent).toContain('Pending Tester')
    expect(d.textContent).toContain('permanently deletes their account')
    expect(d.textContent).not.toContain('pending@example.com')

    await click(buttonIn(d, 'Delete')!)
    expect(deletes('/api/admin/users')).toHaveLength(1)
    expect(JSON.parse(deletes('/api/admin/users')[0][1].body as string)).toEqual({ userId: THEM })
    expect(dialog()).toBeNull()
  })

  it('Cancel closes the confirm and sends nothing', async () => {
    await mount()
    await click(buttonIn(rowOf('pending@example.com'), 'Delete user')!)
    await click(buttonIn(dialog()!, 'Cancel')!)
    expect(dialog()).toBeNull()
    expect(deletes('/api/admin/users')).toHaveLength(0)
  })

  it('the signed-in admin\'s own row never offers delete, even if it were pending', async () => {
    users = [{ ...USERS[0], isActive: false }, USERS[1]]
    await mount()
    expect(buttonIn(rowOf('me@example.com'), 'Delete user')).toBeUndefined()
    expect(buttonIn(rowOf('pending@example.com'), 'Delete user')).toBeDefined()
  })
})

describe('only a signup that never got in can be deleted (issue 2695)', () => {
  const GONE = { id: 'deactivated-user', email: 'gone@example.com', name: null, displayName: 'Was In', isActive: false, isAdmin: false, hasData: true }

  it('a deactivated user with data sits under Deactivated and has Activate but no delete', async () => {
    users = [...USERS, GONE]
    await mount()
    const row = rowOf('gone@example.com')
    expect(buttonIn(row, 'Delete user')).toBeUndefined()
    expect(buttonIn(row, 'Activate')).toBeDefined()
    expect(row.textContent).toContain('Deactivated')
    const pendingRow = rowOf('pending@example.com')
    expect(buttonIn(pendingRow, 'Delete user')).toBeDefined()
    expect(pendingRow.textContent).toContain('Pending')
  })

  it('an inactive user whose hasData is unknown is treated as having data: no delete', async () => {
    const unknown = { id: GONE.id, email: GONE.email, name: null, displayName: GONE.displayName, isActive: false, isAdmin: false }
    users = [USERS[0], unknown as typeof GONE]
    await mount()
    expect(buttonIn(rowOf('gone@example.com'), 'Delete user')).toBeUndefined()
  })

  it('a 409 from the server keeps the row and shows its plain reason', async () => {
    const { toast } = await import('sonner')
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ error: 'has data' }), { status: 409 })
      if (url === '/api/admin/users') return new Response(JSON.stringify({ users }), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    await mount()
    await click(buttonIn(rowOf('pending@example.com'), 'Delete user')!)
    await click(buttonIn(dialog()!, 'Delete')!)
    expect(toast.error).toHaveBeenCalledWith('has data')
    expect(rowOf('pending@example.com')).toBeDefined()
  })
})

describe('removing an invite from the admin Invites tab (issue 2651)', () => {
  async function openInvites() {
    await mount()
    const tab = [...container.querySelectorAll('button')].find(b => b.textContent === 'invites')!
    await click(tab)
  }

  it('the trash opens a confirm naming the email; the DELETE goes only on confirm', async () => {
    await openInvites()
    await click(buttonIn(container, 'Remove invitee@example.com')!)
    expect(deletes('/api/admin/invites')).toHaveLength(0)

    const d = dialog()!
    expect(d.textContent).toContain('invitee@example.com')
    await click(buttonIn(d, 'Remove')!)
    expect(deletes('/api/admin/invites')).toHaveLength(1)
    expect(JSON.parse(deletes('/api/admin/invites')[0][1].body as string)).toEqual({ email: 'invitee@example.com' })
  })

  it('Cancel sends nothing', async () => {
    await openInvites()
    await click(buttonIn(container, 'Remove invitee@example.com')!)
    await click(buttonIn(dialog()!, 'Cancel')!)
    expect(dialog()).toBeNull()
    expect(deletes('/api/admin/invites')).toHaveLength(0)
  })
})
