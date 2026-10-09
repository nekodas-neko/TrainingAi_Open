// @vitest-environment jsdom
/**
 * issue 2693 - the trash icon on an activity type row ran `DELETE /api/admin/activity-types` on one
 * tap and had no accessible name. It now opens the shared ConfirmDialog first. Mounts the real
 * manager and counts the DELETE requests that reach the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/lib/cache-groups', () => ({ invalidateActivityTypes: vi.fn(async () => {}) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import ActivityTypeManager from '@/components/admin/activity-type-manager'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TYPES = [
  { id: 'rowing', label: 'Rowing', icon: 'Boat', isDistanceBased: true, sortOrder: 1 },
  { id: 'other', label: 'Other', icon: 'DotsThreeCircle', isDistanceBased: false, sortOrder: 99 },
]

let container: HTMLDivElement
let root: Root | null = null
let fetchMock: ReturnType<typeof vi.fn>

const deletes = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null
const btn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label) as HTMLButtonElement | undefined
async function click(el: HTMLElement) { await act(async () => { el.click() }); await flush() }

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'DELETE'
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ activityTypes: TYPES }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(ActivityTypeManager)) })
  await flush()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('activity type delete confirm (issue 2693)', () => {
  it('names the trash icon after the type', () => {
    expect(btn(container, 'Delete Rowing')).toBeDefined()
  })

  it('sends no DELETE on the tap, only after confirm, and the dialog names the type', async () => {
    await click(btn(container, 'Delete Rowing')!)
    expect(deletes()).toHaveLength(0)
    expect(dialog()?.textContent).toContain('Delete Rowing?')
    await click(btn(dialog()!, 'Delete')!)
    expect(deletes()).toHaveLength(1)
    expect(deletes()[0][0]).toBe('/api/admin/activity-types?id=rowing')
  })

  it('Cancel sends nothing', async () => {
    await click(btn(container, 'Delete Rowing')!)
    await click(btn(dialog()!, 'Cancel')!)
    expect(deletes()).toHaveLength(0)
    expect(dialog()).toBeNull()
  })
})
