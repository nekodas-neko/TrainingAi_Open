// #3077: walk offers and the home screen's refetch listened only for a Bluetooth drain settling, so
// once the ring reached us through the Oura API they ran only at app launch. A sync pull carrying
// Oura-fed rows is how the app learns of new Oura data now, and it announces it the same way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sqlite/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sqlite/cache')>()),
  invalidateCache: () => Promise.resolve(),
}))

import { invalidatePulledDomains } from '@/lib/cache-groups'
import { OURA_DATA_CHANGED_EVENT } from '@/lib/oura-data-changed'
import type { SyncedDomains } from '@/lib/local-store/sync-engine'

const none: SyncedDomains = {
  biometrics: false, programs: false, workouts: false, nutrition: false, supplements: false, activity: false,
  fitnessTests: false, running: false, injuries: false, ouraDaily: false, dayCheckins: false, mealPlans: false,
}

describe('invalidatePulledDomains announces new Oura data', () => {
  let fired = 0
  beforeEach(() => {
    fired = 0
    const target = new EventTarget()
    target.addEventListener(OURA_DATA_CHANGED_EVENT, () => { fired++ })
    vi.stubGlobal('window', target)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the event every existing listener and the Bluetooth path use', () => {
    expect(OURA_DATA_CHANGED_EVENT).toBe('ta:oura-ble-synced')
  })

  it('fires after a pull that carried Oura daily rows or biometrics', async () => {
    await invalidatePulledDomains({ ...none, ouraDaily: true })
    await invalidatePulledDomains({ ...none, biometrics: true })
    expect(fired).toBe(2)
  })

  it('stays quiet for a pull that carried nothing Oura feeds', async () => {
    await invalidatePulledDomains({ ...none, nutrition: true, supplements: true })
    await invalidatePulledDomains(none)
    expect(fired).toBe(0)
  })
})
