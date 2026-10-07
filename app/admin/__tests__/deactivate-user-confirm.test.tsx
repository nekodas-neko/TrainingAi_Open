// @vitest-environment jsdom
/**
 * #2383 item 3 — the admin Users screen deactivated on a single tap of an unlabelled icon, and the
 * signed-in admin's own row offered it too. Deactivation sends that user to `/pending` until an
 * admin activates them again, so for the admin's own row it was a lock-out.
 *
 * These mount the real `AdminContent` and count the PATCH requests that reach the network: no
 * request until the confirm is pressed, none on cancel, and no deactivate control on your own row.
 * The server refuses self as well (`app/api/admin/users/__tests__/deactivate-self-guard.test.ts`);
 * hiding the control is the convenience, the route is the guard.
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

const ME = '00000000-0000-4000-8000-0000000000a1'
const THEM = '00000000-0000-4000-8000-0000000000b2'
const USERS = [
  { id: ME, email: 'me@example.com', name: 'Owner', displayName: 'Owner', isActive: true, isAdmin: true },
  { id: THEM, email: 'them@example.com', name: null, displayName: 'Throwaway Tester', isActive: true, isAdmin: false },
]

let container: HTMLDivElement
let root: Root | null = null
let fetchMock: ReturnType<typeof vi.fn>

const patches = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')

async function flush() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function mount() {
  root = createRoot(container)
  await act(async () => { root!.render(createElement(AdminContent, { currentUserId: ME })) })
  await flush()
}

/** The row's container: the bordered div that holds the user's email. */
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

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Response(JSON.stringify({ ok: true }), { status: 200 })
    if (url === '/api/admin/users') return new Response(JSON.stringify({ users: USERS }), { status: 200 })
    if (url === '/api/admin/invites') return new Response(JSON.stringify({ emails: [] }), { status: 200 })
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

describe('deactivating a user from the admin Users screen (#2383 item 3)', () => {
  it('the signed-in admin\'s own row has no deactivate control; another user\'s row does', async () => {
    await mount()
    expect(buttonIn(rowOf('me@example.com'), 'Deactivate')).toBeUndefined()
    expect(buttonIn(rowOf('them@example.com'), 'Deactivate')).toBeDefined()
  })

  it('the icon opens a confirm naming the user, and nothing is sent until Deactivate is pressed', async () => {
    await mount()
    await click(buttonIn(rowOf('them@example.com'), 'Deactivate')!)
    expect(patches()).toHaveLength(0)

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain('Throwaway Tester')

    await click(buttonIn(dialog, 'Deactivate')!)
    expect(patches()).toHaveLength(1)
    expect(JSON.parse(patches()[0][1].body as string)).toEqual({ userId: THEM, action: 'deactivate' })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('Cancel closes the confirm and sends nothing', async () => {
    await mount()
    await click(buttonIn(rowOf('them@example.com'), 'Deactivate')!)
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    await click(buttonIn(dialog, 'Cancel')!)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(patches()).toHaveLength(0)
  })
})
