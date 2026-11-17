// @vitest-environment jsdom
// Issue 3854 item 2: "Use another account" signs out through the fenced path every web sign-out uses, with
// the in-place server action so the page reloads into its own sign-in form, not `/sign-in`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const mocks = vi.hoisted(() => ({ signOutAndClearDevice: vi.fn(), signOutInPlace: vi.fn(), signOut: vi.fn() }))
vi.mock('@/lib/sign-out', () => ({ signOutAndClearDevice: mocks.signOutAndClearDevice }))
vi.mock('@/app/actions', () => ({ signOutInPlace: mocks.signOutInPlace, signOut: mocks.signOut }))
import { NativeConsentForm } from '../consent-form'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
const reload = vi.fn()

beforeEach(() => {
  mocks.signOutAndClearDevice.mockReset().mockResolvedValue(undefined)
  reload.mockReset()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload, assign: vi.fn() } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function tapUseAnotherAccount() {
  await act(async () => { root.render(createElement(NativeConsentForm, { action: async () => null })) })
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Use another account')!
  await act(async () => { button.click() })
}

describe('Issue 3854 consent form sign-out', () => {
  it('goes through signOutAndClearDevice with the in-place action, then reloads', async () => {
    await tapUseAnotherAccount()
    expect(mocks.signOutAndClearDevice).toHaveBeenCalledWith(mocks.signOutInPlace)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a failed sign-out does not reload as if signed out, and says so', async () => {
    mocks.signOutAndClearDevice.mockRejectedValue(new Error('offline'))
    await tapUseAnotherAccount()
    expect(reload).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Could not sign out/)
    expect([...host.querySelectorAll('button')].every(b => !b.disabled)).toBe(true)
  })
})
