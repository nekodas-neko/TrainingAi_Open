// @vitest-environment jsdom
/**
 * #3369 — the admin Users screen gets "Reset data" and "Delete account and data", each behind a
 * dialog that asks for the user's email. These mount the real `AdminContent` and count the requests
 * that reach the network: none until the right email is typed and the button pressed.
 *
 * Which buttons show is a convenience; the routes refuse another admin's account whatever the
 * screen offers (`app/api/admin/users/__tests__/wipe-user-data.test.ts`).
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
// The shape `GET /api/admin/users` sends: `hasData` is computed for inactive users only, so every
// active user carries `hasData: false`, which must not read as "nothing to reset".
const USERS = [
  { id: ME, email: 'me@example.com', name: 'Owner', displayName: 'Owner', isActive: true, isAdmin: true, hasData: false },
  { id: 'other-admin', email: 'boss@example.com', name: 'Boss', displayName: 'Boss', isActive: true, isAdmin: true, hasData: false },
  { id: 'person', email: 'Person@Example.com', name: 'Person', displayName: 'Person', isActive: true, isAdmin: false, hasData: false },
  { id: 'pending', email: 'pending@example.com', name: null, displayName: 'Pending Tester', isActive: false, isAdmin: false, hasData: false },
  { id: 'away', email: 'away@example.com', name: null, displayName: 'Away', isActive: false, isAdmin: false, hasData: true },
]

let container: HTMLDivElement
let root: Root | null = null
let fetchMock: ReturnType<typeof vi.fn>
let resetResponse: () => Response
const replace = vi.fn()

const callsTo = (path: string, method: string) =>
  fetchMock.mock.calls.filter(([url, init]) => url === path && (init as RequestInit | undefined)?.method === method)

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
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
const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label) as HTMLButtonElement | undefined
async function click(el: HTMLElement) { await act(async () => { el.click() }); await flush() }
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null
async function type(into: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value)
    into.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  resetResponse = () => new Response(JSON.stringify({ ok: true, reset: true, signedOut: false, defaultsSeeded: true }), { status: 200 })
  vi.clearAllMocks()
  replace.mockClear()
  Object.defineProperty(window, 'location', { configurable: true, value: { replace } })
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/users/reset-data') return resetResponse()
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ ok: true }), { status: 200 })
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

describe('which rows offer the two actions', () => {
  it('another admin\'s row offers neither; your own offers reset only; a non-admin offers both', async () => {
    await mount()
    const boss = rowOf('boss@example.com')
    expect(buttonIn(boss, 'Reset data')).toBeUndefined()
    expect(buttonIn(boss, 'Delete account and data')).toBeUndefined()
    const me = rowOf('me@example.com')
    expect(buttonIn(me, 'Reset data')).toBeDefined()
    expect(buttonIn(me, 'Delete account and data')).toBeUndefined()
    const person = rowOf('Person@Example.com')
    expect(buttonIn(person, 'Reset data')).toBeDefined()
    expect(buttonIn(person, 'Delete account and data')).toBeDefined()
  })

  it('a pending signup with no data keeps its plain trash and gets neither new action', async () => {
    await mount()
    const row = rowOf('pending@example.com')
    expect(buttonIn(row, 'Delete user')).toBeDefined()
    expect(buttonIn(row, 'Reset data')).toBeUndefined()
    expect(buttonIn(row, 'Delete account and data')).toBeUndefined()
  })

  it('a deactivated user with data can now be reset or deleted', async () => {
    await mount()
    const row = rowOf('away@example.com')
    expect(buttonIn(row, 'Reset data')).toBeDefined()
    expect(buttonIn(row, 'Delete account and data')).toBeDefined()
  })
})

describe('Reset data', () => {
  it('asks for the email: nothing is sent until it is typed, and the confirm stays locked on a wrong one', async () => {
    await mount()
    await click(buttonIn(rowOf('Person@Example.com'), 'Reset data')!)
    const d = dialog()!
    expect(d.textContent).toContain('Person@Example.com')
    expect(d.textContent).toContain('cannot be undone')
    const confirm = buttonIn(d, 'Reset data')!
    expect(confirm.disabled).toBe(true)
    await type(d.querySelector('input')!, 'someone@else.com')
    expect(confirm.disabled).toBe(true)
    await click(confirm)
    expect(callsTo('/api/admin/users/reset-data', 'POST')).toHaveLength(0)
  })

  it('sends what was typed, matched without case, and says the user is signed out', async () => {
    const { toast } = await import('sonner')
    await mount()
    await click(buttonIn(rowOf('Person@Example.com'), 'Reset data')!)
    const d = dialog()!
    await type(d.querySelector('input')!, '  person@example.COM ')
    await click(buttonIn(d, 'Reset data')!)
    const [call] = callsTo('/api/admin/users/reset-data', 'POST')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ userId: 'person', confirmEmail: 'person@example.COM' })
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('signed out on every device'))
    expect(replace).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it('Cancel sends nothing', async () => {
    await mount()
    await click(buttonIn(rowOf('Person@Example.com'), 'Reset data')!)
    await click(buttonIn(dialog()!, 'Cancel')!)
    expect(callsTo('/api/admin/users/reset-data', 'POST')).toHaveLength(0)
  })

  it('shows the server\'s refusal and does not claim success', async () => {
    const { toast } = await import('sonner')
    resetResponse = () => new Response(JSON.stringify({ error: "Another admin's account cannot be reset or deleted." }), { status: 403 })
    await mount()
    await click(buttonIn(rowOf('Person@Example.com'), 'Reset data')!)
    const d = dialog()!
    await type(d.querySelector('input')!, 'person@example.com')
    await click(buttonIn(d, 'Reset data')!)
    expect(toast.error).toHaveBeenCalledWith("Another admin's account cannot be reset or deleted.")
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('resetting yourself warns you will be signed out, and goes to the sign-in page', async () => {
    resetResponse = () => new Response(JSON.stringify({ ok: true, reset: true, signedOut: true, defaultsSeeded: true }), { status: 200 })
    await mount()
    await click(buttonIn(rowOf('me@example.com'), 'Reset data')!)
    const d = dialog()!
    expect(d.textContent).toContain('your own account')
    expect(d.textContent).toContain('admin and active status stay')
    await type(d.querySelector('input')!, 'me@example.com')
    await click(buttonIn(d, 'Reset data')!)
    expect(replace).toHaveBeenCalledWith('/sign-in')
  })

  it('says so when the built-in styles could not be put back', async () => {
    const { toast } = await import('sonner')
    resetResponse = () => new Response(JSON.stringify({ ok: true, reset: true, signedOut: false, defaultsSeeded: false }), { status: 200 })
    await mount()
    await click(buttonIn(rowOf('Person@Example.com'), 'Reset data')!)
    const d = dialog()!
    await type(d.querySelector('input')!, 'person@example.com')
    await click(buttonIn(d, 'Reset data')!)
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Reset again to add them'))
  })
})

describe('Delete account and data', () => {
  it('sends the typed email with the id, removes the row, and only after the email matches', async () => {
    await mount()
    await click(buttonIn(rowOf('Person@Example.com'), 'Delete account and data')!)
    const d = dialog()!
    const confirm = buttonIn(d, 'Delete account')!
    expect(confirm.disabled).toBe(true)
    expect(callsTo('/api/admin/users', 'DELETE')).toHaveLength(0)
    await type(d.querySelector('input')!, 'person@example.com')
    expect(confirm.disabled).toBe(false)
    await click(confirm)
    const [call] = callsTo('/api/admin/users', 'DELETE')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ userId: 'person', confirmEmail: 'person@example.com' })
    expect(container.textContent).not.toContain('Person@Example.com')
  })

  it('keeps the row and shows the reason when the server refuses', async () => {
    const { toast } = await import('sonner')
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ error: 'That email does not match this account. Nothing was changed.' }), { status: 400 })
      if (url === '/api/admin/users') return new Response(JSON.stringify({ users: USERS }), { status: 200 })
      return new Response(JSON.stringify({ emails: [] }), { status: 200 })
    })
    await mount()
    await click(buttonIn(rowOf('away@example.com'), 'Delete account and data')!)
    const d = dialog()!
    await type(d.querySelector('input')!, 'away@example.com')
    await click(buttonIn(d, 'Delete account')!)
    expect(toast.error).toHaveBeenCalledWith('That email does not match this account. Nothing was changed.')
    expect(rowOf('away@example.com')).toBeDefined()
  })
})
