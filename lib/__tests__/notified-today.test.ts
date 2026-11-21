import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifiedTodayStore } from '../notified-today'

function stubStorage(overrides: Partial<Storage> = {}) {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    ...overrides,
  })
  return data
}

describe('notifiedTodayStore', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads an empty map when nothing is stored', () => {
    stubStorage()
    expect(notifiedTodayStore('k').read()).toEqual({})
  })

  it('round-trips a map under its own key', () => {
    const data = stubStorage()
    const store = notifiedTodayStore('ta_x')
    store.write({ a: '2026-11-21' })
    expect(data.get('ta_x')).toBe('{"a":"2026-11-21"}')
    expect(store.read()).toEqual({ a: '2026-11-21' })
    expect(notifiedTodayStore('ta_y').read()).toEqual({})
  })

  it('reads an empty map for corrupt JSON and swallows storage errors on write', () => {
    stubStorage({
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota')
      },
    })
    const store = notifiedTodayStore('k')
    expect(store.read()).toEqual({})
    expect(() => store.write({ a: 'b' })).not.toThrow()
  })
})
