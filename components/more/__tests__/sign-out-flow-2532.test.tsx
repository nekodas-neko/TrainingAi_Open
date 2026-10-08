// @vitest-environment jsdom
/**
 * Issue 2532 (surface half): Sign Out syncs first, then warns. Nothing is discarded silently.
 * The engine (`prepareSignOut`) is mocked: its own tests cover counting; these cover the dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const signOutAndClearDevice = vi.fn(async () => {})
const prepareSignOut = vi.fn()
vi.mock('@/lib/sign-out', () => ({ signOutAndClearDevice: () => signOutAndClearDevice() }))
vi.mock('@/lib/sign-out-pending', () => ({ prepareSignOut: (...a: unknown[]) => prepareSignOut(...a) }))
vi.mock('@/lib/account/delete-account', () => ({
  prepareAccountDeletion: (...a: unknown[]) => prepareSignOut(...a),
  deleteAccountAndSignOut: vi.fn(async () => ({ ok: true })),
}))

import { useSignOutFlow } from '../sign-out-flow'
import { DeleteAccountSheet } from '../delete-account-sheet'
import { deleteAccountAndSignOut } from '@/lib/account/delete-account'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CLEAN = { outcome: 'synced', remaining: { total: 0 }, lost: [] }
const UNSENT = (outcome = 'offline') => ({
  outcome,
  remaining: { total: 5 },
  lost: [
    { kind: 'workout-sets', count: 3, label: '3 workout sets in progress' },
    { kind: 'settings', count: 2, label: '2 setting changes' },
  ],
})

function Harness() {
  const f = useSignOutFlow('u1')
  return createElement('div', null,
    createElement('button', { id: 'go', disabled: f.busy, onClick: f.start }, f.busy ? 'Syncing…' : 'Sign Out'),
    f.dialog)
}

let container: HTMLDivElement
let root: Root
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const text = () => document.body.textContent ?? ''
const button = (label: string) =>
  Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes(label)) as HTMLButtonElement | undefined
const click = async (el: Element | undefined | null) => { await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }); await flush() }

beforeEach(() => {
  signOutAndClearDevice.mockClear()
  prepareSignOut.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('issue 2532 sign-out flow', () => {
  it('signs out at once, with no dialog, when nothing is unsent', async () => {
    prepareSignOut.mockResolvedValue(CLEAN)
    act(() => root.render(createElement(Harness)))
    await click(container.querySelector('#go'))
    expect(prepareSignOut).toHaveBeenCalledWith('u1')
    expect(signOutAndClearDevice).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows the total and the lost labels, and clears nothing, when changes are unsent', async () => {
    prepareSignOut.mockResolvedValue(UNSENT())
    act(() => root.render(createElement(Harness)))
    await click(container.querySelector('#go'))
    expect(signOutAndClearDevice).not.toHaveBeenCalled()
    expect(text()).toContain("5 changes haven't synced")
    expect(text()).toContain('3 workout sets in progress')
    expect(text()).toContain('2 setting changes')
    expect(text()).toContain('discards these')
    expect(text()).toContain("You're offline")
  })

  it('uses the timeout wording', async () => {
    prepareSignOut.mockResolvedValue(UNSENT('timeout'))
    act(() => root.render(createElement(Harness)))
    await click(container.querySelector('#go'))
    expect(text()).toContain('took too long')
  })

  it('"Sync now" drains and signs out', async () => {
    prepareSignOut.mockResolvedValueOnce(UNSENT('partial')).mockResolvedValueOnce(CLEAN)
    act(() => root.render(createElement(Harness)))
    await click(container.querySelector('#go'))
    await click(button('Sync now'))
    expect(prepareSignOut).toHaveBeenCalledTimes(2)
    expect(signOutAndClearDevice).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('"Sync now" that leaves changes keeps the dialog and does not sign out', async () => {
    prepareSignOut.mockResolvedValueOnce(UNSENT('offline')).mockResolvedValueOnce(UNSENT('offline'))
    act(() => root.render(createElement(Harness)))
    await click(container.querySelector('#go'))
    await click(button('Sync now'))
    expect(signOutAndClearDevice).not.toHaveBeenCalled()
    expect(text()).toContain("5 changes haven't synced")
  })

  it('"Sign out anyway" calls signOutAndClearDevice once', async () => {
    prepareSignOut.mockResolvedValue(UNSENT())
    act(() => root.render(createElement(Harness)))
    await click(container.querySelector('#go'))
    await click(button('Sign out anyway'))
    expect(signOutAndClearDevice).toHaveBeenCalledTimes(1)
  })

  it('Cancel keeps the session and clears nothing', async () => {
    prepareSignOut.mockResolvedValue(UNSENT())
    act(() => root.render(createElement(Harness)))
    await click(container.querySelector('#go'))
    await click(button('Cancel'))
    expect(signOutAndClearDevice).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect((container.querySelector('#go') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('issue 2532 account deletion', () => {
  async function typePhrase() {
    const input = document.body.querySelector('#delete-account-phrase') as HTMLInputElement
    const phrase = input.placeholder
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, phrase)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('lists the unsent changes in the same sheet and deletes only on the second tap', async () => {
    prepareSignOut.mockResolvedValue(UNSENT())
    vi.mocked(deleteAccountAndSignOut).mockClear()
    act(() => root.render(createElement(DeleteAccountSheet, { userId: 'u1' })))
    await click(container.querySelector('button'))
    await typePhrase()
    await click(button('Delete my account'))
    expect(deleteAccountAndSignOut).not.toHaveBeenCalled()
    expect(text()).toContain("5 changes haven't synced")
    expect(text()).toContain('3 workout sets in progress')
    await click(button('Delete anyway'))
    expect(deleteAccountAndSignOut).toHaveBeenCalledTimes(1)
  })

  it('deletes on the first tap when nothing is unsent', async () => {
    prepareSignOut.mockResolvedValue(CLEAN)
    vi.mocked(deleteAccountAndSignOut).mockClear()
    act(() => root.render(createElement(DeleteAccountSheet, { userId: 'u1' })))
    await click(container.querySelector('button'))
    await typePhrase()
    await click(button('Delete my account'))
    expect(deleteAccountAndSignOut).toHaveBeenCalledTimes(1)
  })
})
