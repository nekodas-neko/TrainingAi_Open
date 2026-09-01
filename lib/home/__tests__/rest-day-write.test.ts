// @vitest-environment jsdom
/**
 * BF-84 — the client half of "a chosen rest day is stored".
 *
 * `chooseRestDay` is the one write for both surfaces, and the thing that has to be true of it is
 * that an offline choice does not evaporate. That means the outbox row, not the POST: the APK makes
 * the choice and reaches the server through `pushMutations`, so a path that only POSTs is a path
 * that loses the choice on the underground.
 *
 * The `localStorage` marker is asserted too, because its role changed rather than ended — it is now
 * the optimistic echo that keeps the card showing rest until the next fetch, and if it stopped
 * being written the card would flicker back to a training prompt on the very next render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getLocalStoreMock, pushMutationsMock, invalidateRestDayChoiceMock } = vi.hoisted(() => ({
  getLocalStoreMock: vi.fn(() => null as unknown),
  pushMutationsMock: vi.fn(() => Promise.resolve()),
  invalidateRestDayChoiceMock: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/local-store', () => ({ getLocalStore: getLocalStoreMock }))
vi.mock('@/lib/local-store/sync-engine', () => ({ pushMutations: pushMutationsMock }))
vi.mock('@/lib/cache-groups', () => ({ invalidateRestDayChoice: invalidateRestDayChoiceMock }))

import { chooseRestDay, isRestDayChosen, withRestDayOverride, REST_DAY_KEY } from '../rest-day'
import { todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
/**
 * Two fixed-offset zones 26 hours apart — UTC+14 and UTC−12. Two instants more than 24 hours apart
 * are on different calendar dates on every clock, so the timezone case below fires on every CI run
 * rather than only during the window where two nearby zones happen to disagree. That is the
 * standing rule for this class: a test that waits for its window is a test that mostly does not run.
 */
const ZONE_AHEAD  = 'Etc/GMT-14'
const ZONE_BEHIND = 'Etc/GMT+12'

/**
 * Whichever of the two is NOT on the same day as `todayInTz()`'s default zone right now — and the
 * other one, which is then guaranteed to differ from it in turn.
 *
 * Picking a fixed far-away zone is not enough, and this was found by mutation rather than reasoned
 * out: dropping `tz` from the marker write left every case green, because Brisbane and UTC+14 are
 * only four hours apart and so agree for twenty hours a day. Since the pair above can never share a
 * date, at least one of them always disagrees with the default — so derive it.
 */
const WRITE_TZ = todayInTz(ZONE_AHEAD) !== todayInTz() ? ZONE_AHEAD : ZONE_BEHIND
const READ_TZ  = WRITE_TZ === ZONE_AHEAD ? ZONE_BEHIND : ZONE_AHEAD

/** Lets the fire-and-forget body of `chooseRestDay` run to completion. */
const settle = () => new Promise(r => setTimeout(r, 0))

function fakeStore() {
  return { queueMutation: vi.fn(() => Promise.resolve()) }
}

describe('chooseRestDay', () => {
  beforeEach(() => {
    localStorage.clear()
    getLocalStoreMock.mockReturnValue(null)
    pushMutationsMock.mockClear()
    invalidateRestDayChoiceMock.mockClear()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('queues an outbox mutation rather than posting, when the local store is there', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = fakeStore()
    getLocalStoreMock.mockReturnValue(store)

    // WRITE_TZ rather than the owner's zone, so an outbox row dated from `todayInTz()`'s default
    // is a failure here instead of a coincidence.
    chooseRestDay('u1', { tz: WRITE_TZ })
    await settle()

    expect(store.queueMutation).toHaveBeenCalledWith({
      userId: 'u1', domain: 'rest_days', date: todayInTz(WRITE_TZ), payload: { resting: true },
    })
    expect(pushMutationsMock).toHaveBeenCalledWith('u1')
    // The POST is the fallback, not a belt-and-braces second write.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(invalidateRestDayChoiceMock).toHaveBeenCalled()
  })

  it('carries `resting: false` through the same outbox path', async () => {
    const store = fakeStore()
    getLocalStoreMock.mockReturnValue(store)

    chooseRestDay('u1', { tz: TZ, resting: false })
    await settle()

    expect(store.queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'rest_days', payload: { resting: false } }))
  })

  it('falls back to the API when there is no local store (the web/dev surface)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    chooseRestDay(undefined, { tz: WRITE_TZ })
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/log-rest-day')
    expect(JSON.parse(init.body as string)).toEqual({ date: todayInTz(WRITE_TZ), resting: true })
    expect(invalidateRestDayChoiceMock).toHaveBeenCalled()
  })

  it('still records the choice locally when the outbox write throws', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getLocalStoreMock.mockReturnValue({ queueMutation: vi.fn(() => Promise.reject(new Error('sqlite'))) })

    chooseRestDay('u1', { tz: TZ })
    await settle()

    // The marker was set synchronously, before anything could fail...
    expect(isRestDayChosen(TZ)).toBe(true)
    // ...and the API fallback still ran, so the choice is not stranded on this device.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * The caller flips the card in the same turn and `withRestDayOverride` re-applies from the marker
   * on every render after that — so a marker written behind an `await` means a render landing in
   * the gap reverts the card to a training prompt. That flicker IS the bug being fixed.
   *
   * Pinned with a store whose write never settles, so "synchronously" means before any promise
   * resolves rather than merely soon.
   */
  it('sets the marker synchronously, so the card can flip in the same turn', () => {
    getLocalStoreMock.mockReturnValue({ queueMutation: vi.fn(() => new Promise<void>(() => {})) })
    chooseRestDay('u1', { tz: WRITE_TZ })
    expect(localStorage.getItem(REST_DAY_KEY)).toBe(todayInTz(WRITE_TZ))
    expect(isRestDayChosen(WRITE_TZ)).toBe(true)
  })

  it('un-choosing clears the marker', async () => {
    getLocalStoreMock.mockReturnValue(fakeStore())
    chooseRestDay('u1', { tz: TZ })
    expect(isRestDayChosen(TZ)).toBe(true)

    chooseRestDay('u1', { tz: TZ, resting: false })
    await settle()
    expect(localStorage.getItem(REST_DAY_KEY)).toBeNull()
    expect(withRestDayOverride({ isRestDay: false, reason: 'Next up: Upper' }, TZ)?.isRestDay).toBe(false)
  })

  /**
   * The timezone the marker is stamped with must be the one it is read back with. It used to be
   * neither — every function here took the `todayInTz` default, which is the owner's zone, while
   * the seed path beside them stamped its cache with `todayInTz(tz)`. For a user ten hours away
   * the two disagreed about which day it was for most of the day.
   */
  it('stamps and reads the marker in the timezone it is given', () => {
    // The premises, asserted rather than assumed: the pair is never on the same day, and the write
    // zone is never on the same day as `todayInTz()`'s default.
    expect(todayInTz(ZONE_AHEAD)).not.toBe(todayInTz(ZONE_BEHIND))
    expect(todayInTz(WRITE_TZ)).not.toBe(todayInTz())

    getLocalStoreMock.mockReturnValue(fakeStore())
    chooseRestDay('u1', { tz: WRITE_TZ })
    expect(localStorage.getItem(REST_DAY_KEY)).toBe(todayInTz(WRITE_TZ))
    expect(isRestDayChosen(WRITE_TZ)).toBe(true)
    expect(isRestDayChosen(READ_TZ)).toBe(false)
  })

  it('withRestDayOverride leaves a recommendation alone when nothing was chosen', () => {
    const rec = { isRestDay: false, reason: 'Next up: Upper', deloadOrRestRecommended: true }
    expect(withRestDayOverride(rec, TZ)).toBe(rec)
    expect(withRestDayOverride(null, TZ)).toBeNull()
  })
})
