// @vitest-environment jsdom
/**
 * Issue 2338 — the entry card on the Sleep screen (approved mockup
 * `docs/design/2026-10-07-manual-sleep-entry.html`, with Remove).
 *
 * These mount the real `ManualNightCard` against mocked writers and assert what reaches them: the
 * instants (built in the USER's zone, not the test machine's), that an implausible night is refused
 * with the rule's reason before any write, that Edit re-opens the same two fields prefilled and
 * saves the same window again (the engine keeps one row per night, so the same night saved twice is
 * an edit), and that Remove asks first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  saveManualNight: vi.fn(),
  removeManualNight: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}))

vi.mock('@/lib/sleep/save-manual-night', () => ({
  saveManualNight: h.saveManualNight,
  removeManualNight: h.removeManualNight,
}))
vi.mock('sonner', () => ({ toast: h.toast }))
// A zone that is not the test machine's, so a device-clock shortcut would fail here.
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))

import { ManualNightCard } from '../manual-night-card'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const USER = 'user-1'
const WAKE_DATE = '2026-10-08'
// Brisbane is UTC+10 all year: 2026-10-08 07:30 local.
const NOW = new Date('2026-10-07T21:30:00Z')
const BED_ISO = '2026-10-07T13:10:00.000Z' // 23:10 on 10-07 local
const WOKE_ISO = '2026-10-07T20:40:00.000Z' // 06:40 on 10-08 local
const TYPED = { id: '3f2b1c0e-5a4d-4c3b-8a2f-1d0e9c8b7a65', sleepStart: BED_ISO, sleepEnd: WOKE_ISO }

let container: HTMLDivElement
let root: Root | null = null
const onChanged = vi.fn()

async function flush() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function mount(night: typeof TYPED | null) {
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(ManualNightCard, { userId: USER, wakeDate: WAKE_DATE, night, onChanged }))
  })
  await flush()
}

function setInput(id: string, value: string) {
  const el = container.querySelector<HTMLInputElement>(`#${id}`)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('button not found')
  await act(async () => { el.click() })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  container = document.createElement('div')
  document.body.appendChild(container)
  h.saveManualNight.mockReset().mockResolvedValue({ ok: true, date: WAKE_DATE, shadowed: false })
  h.removeManualNight.mockReset().mockResolvedValue({ ok: true })
  Object.values(h.toast).forEach(f => f.mockReset())
  onChanged.mockReset()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('nothing logged for last night', () => {
  it('says so, and offers a bed time, a wake time and Save night', async () => {
    await mount(null)
    expect(container.textContent).toContain('No night recorded')
    expect(container.textContent).toContain('Nothing came in from a ring or Health Connect. Log it by hand and it counts towards readiness.')
    expect(container.querySelector('#manual-night-bed')).not.toBeNull()
    expect(container.querySelector('#manual-night-woke')).not.toBeNull()
    expect(buttonIn(container, 'Save night')).toBeDefined()
    expect(buttonIn(container, 'Edit')).toBeUndefined()
  })

  it('saves the two instants in the user\'s timezone and tells the screen to re-read', async () => {
    await mount(null)
    setInput('manual-night-bed', '23:10')
    setInput('manual-night-woke', '06:40')
    await click(buttonIn(container, 'Save night'))
    expect(h.saveManualNight).toHaveBeenCalledTimes(1)
    expect(h.saveManualNight).toHaveBeenCalledWith({
      userId: USER, tz: 'Australia/Brisbane', sleepStart: BED_ISO, sleepEnd: WOKE_ISO,
    })
    expect(h.toast.success).toHaveBeenCalledWith('Night saved')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('a bed time after midnight is the same calendar day as the wake time', async () => {
    await mount(null)
    setInput('manual-night-bed', '00:30')
    setInput('manual-night-woke', '07:00')
    await click(buttonIn(container, 'Save night'))
    expect(h.saveManualNight).toHaveBeenCalledWith(expect.objectContaining({
      sleepStart: '2026-10-07T14:30:00.000Z', // 00:30 on 10-08 local
      sleepEnd: '2026-10-07T21:00:00.000Z',
    }))
  })

  it('refuses a missing time without calling the writer', async () => {
    await mount(null)
    setInput('manual-night-bed', '23:10')
    await click(buttonIn(container, 'Save night'))
    expect(h.saveManualNight).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enter the time you went to bed')
  })

  it('shows the plausibility rule\'s reason for a night that is too short, and writes nothing', async () => {
    await mount(null)
    setInput('manual-night-bed', '06:00')
    setInput('manual-night-woke', '06:40')
    await click(buttonIn(container, 'Save night'))
    expect(h.saveManualNight).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/shorter than 1 h/)
  })

  it('shows the reason for a night longer than 16 h, and for a wake time that has not happened yet', async () => {
    await mount(null)
    setInput('manual-night-bed', '13:00') // noon or later = the evening before: 13:00 -> 06:40 is 17h40m
    setInput('manual-night-woke', '06:40')
    await click(buttonIn(container, 'Save night'))
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/longer than 16 h/)

    // 07:30 is now; a 09:00 wake has not happened.
    setInput('manual-night-bed', '23:00')
    setInput('manual-night-woke', '09:00')
    await click(buttonIn(container, 'Save night'))
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/wake time is in the future/)
    expect(h.saveManualNight).not.toHaveBeenCalled()
  })

  it('shows the writer\'s own refusal when it has one', async () => {
    h.saveManualNight.mockResolvedValue({ ok: false, reason: 'HTTP 500' })
    await mount(null)
    setInput('manual-night-bed', '23:10')
    setInput('manual-night-woke', '06:40')
    await click(buttonIn(container, 'Save night'))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 500')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('says plainly when a ring or Health Connect night is being used instead', async () => {
    h.saveManualNight.mockResolvedValue({ ok: true, date: WAKE_DATE, shadowed: true })
    await mount(null)
    setInput('manual-night-bed', '23:10')
    setInput('manual-night-woke', '06:40')
    await click(buttonIn(container, 'Save night'))
    expect(h.toast.message).toHaveBeenCalledWith(expect.stringContaining('is being used instead'))
    expect(h.toast.success).not.toHaveBeenCalled()
  })
})

describe('a night logged by hand', () => {
  it('shows the window, the plain note, Edit and Remove night, and no fields', async () => {
    await mount(TYPED)
    expect(container.textContent).toContain('Logged by hand')
    expect(container.textContent).toContain('23:10 – 06:40')
    expect(container.textContent).toContain('7h 30m in bed')
    expect(container.textContent).toContain('No sleep stages or heart rate, because nothing measured this night. A device night for the same date replaces it.')
    expect(buttonIn(container, 'Edit')).toBeDefined()
    expect(buttonIn(container, 'Remove night')).toBeDefined()
    expect(container.querySelector('#manual-night-bed')).toBeNull()
  })

  it('Edit opens the same fields prefilled, and Save night writes the (changed) window', async () => {
    await mount(TYPED)
    await click(buttonIn(container, 'Edit'))
    expect(container.querySelector<HTMLInputElement>('#manual-night-bed')!.value).toBe('23:10')
    expect(container.querySelector<HTMLInputElement>('#manual-night-woke')!.value).toBe('06:40')
    // Saving untouched is the same night again: the engine keeps one row per night, so it is an edit.
    await click(buttonIn(container, 'Save night'))
    expect(h.saveManualNight).toHaveBeenCalledWith({
      userId: USER, tz: 'Australia/Brisbane', sleepStart: BED_ISO, sleepEnd: WOKE_ISO,
    })
    expect(h.toast.success).toHaveBeenCalledWith('Night updated')
    expect(onChanged).toHaveBeenCalled()
  })

  it('Cancel leaves Edit without writing', async () => {
    await mount(TYPED)
    await click(buttonIn(container, 'Edit'))
    await click(buttonIn(container, 'Cancel'))
    expect(h.saveManualNight).not.toHaveBeenCalled()
    expect(buttonIn(container, 'Edit')).toBeDefined()
  })

  it('Remove night asks first; Cancel does nothing', async () => {
    await mount(TYPED)
    await click(buttonIn(container, 'Remove night'))
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain('Remove this night?')
    expect(h.removeManualNight).not.toHaveBeenCalled()
    await click(buttonIn(dialog, 'Cancel'))
    expect(h.removeManualNight).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('confirming removes that night by its id and tells the screen to re-read', async () => {
    await mount(TYPED)
    await click(buttonIn(container, 'Remove night'))
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    await click(buttonIn(dialog, 'Remove night'))
    expect(h.removeManualNight).toHaveBeenCalledTimes(1)
    expect(h.removeManualNight).toHaveBeenCalledWith({ userId: USER, id: TYPED.id })
    expect(h.toast.success).toHaveBeenCalledWith('Night removed')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('reports a removal the writer refused, and does not re-read', async () => {
    h.removeManualNight.mockResolvedValue({ ok: false, reason: 'Only a night you entered can be removed' })
    await mount(TYPED)
    await click(buttonIn(container, 'Remove night'))
    await click(buttonIn(document.body.querySelector('[role="dialog"]') as HTMLElement, 'Remove night'))
    expect(h.toast.error).toHaveBeenCalledWith('Only a night you entered can be removed')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('Android Back closes the confirm only: nothing is removed', async () => {
    await mount(TYPED)
    await click(buttonIn(container, 'Remove night'))
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 50)) })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(h.removeManualNight).not.toHaveBeenCalled()
    // The card itself is still there with its night.
    expect(container.textContent).toContain('23:10 – 06:40')
  })
})
