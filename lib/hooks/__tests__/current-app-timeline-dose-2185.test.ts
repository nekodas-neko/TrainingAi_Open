// #2185: the day timeline route sends dose rows for TrainingAi Preview; the current app has no card
// for them and leaves them out, so its Home and day screen read as they did.
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/hooks/use-cached-value', () => ({ useCachedValue: () => null }))
import { currentAppTimelineEvents } from '../use-day-timeline'
import type { TimelineEvent } from '@/app/api/day-timeline/route'

const e = (type: TimelineEvent['type']) => ({ type, title: type, time: '8:00 am', timeMs: 0, day: 'today' }) as unknown as TimelineEvent

describe('currentAppTimelineEvents (#2185)', () => {
  it('drops dose rows and keeps every other event in order', () => {
    expect(currentAppTimelineEvents([e('wakeup'), e('dose'), e('meal')]).map(x => x.type)).toEqual(['wakeup', 'meal'])
  })
})
