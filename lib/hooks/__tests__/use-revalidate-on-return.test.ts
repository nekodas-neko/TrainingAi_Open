import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { subscribeToAppResume, type ResumeSource } from '../use-revalidate-on-return'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const root = path.resolve(__dirname, '../../..')
const src = (rel: string) => stripComments(fs.readFileSync(path.join(root, rel), 'utf8'))

function fakeDoc(): ResumeSource & { fire(state: string): void; listeners: number } {
  const set = new Set<() => void>()
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_t: 'visibilitychange', cb: () => void) => { set.add(cb) },
    removeEventListener: (_t: 'visibilitychange', cb: () => void) => { set.delete(cb) },
    fire(state: string) { doc.visibilityState = state; for (const cb of [...set]) cb() },
    get listeners() { return set.size },
  }
  return doc
}

describe('subscribeToAppResume (issue 2906: the HR card revalidates when the app comes back)', () => {
  it('fires on each return to the foreground and not on going to the background', () => {
    const doc = fakeDoc()
    let n = 0
    subscribeToAppResume(doc, () => { n++ })
    doc.fire('hidden')
    expect(n).toBe(0)
    doc.fire('visible')
    doc.fire('hidden')
    doc.fire('visible')
    expect(n).toBe(2)
  })

  it('stops firing once unsubscribed', () => {
    const doc = fakeDoc()
    let n = 0
    const off = subscribeToAppResume(doc, () => { n++ })
    off()
    doc.fire('visible')
    expect(n).toBe(0)
    expect(doc.listeners).toBe(0)
  })
})

describe('the heart-rate card wiring', () => {
  const card = src('components/health/hr-day-card.tsx')

  it('reads through useCachedValue and revalidates on return, behind the cached value', () => {
    expect(card).toMatch(/useRevalidateOnReturn\(\)/)
    expect(card).toMatch(/reloadToken/)
    // Seeded from the cache by the hook; no bare fetch and no skeleton state of its own.
    expect(card).not.toMatch(/\bcachedFetch\b/)
    expect(card).not.toMatch(/animate-pulse|Skeleton/)
  })

  it('takes "today" from the local-day provider and keys the body by it, so a rollover refetches', () => {
    expect(card).toMatch(/useLocalDay\(\)/)
    expect(card).toMatch(/<HrDayCardBody key=\{today\}/)
  })

  it('the revalidation signal follows the app resume and the shell re-showing the tab', () => {
    const hook = src('lib/hooks/use-revalidate-on-return.ts')
    expect(hook).toMatch(/useTabVisibility\(\)/)
    expect(hook).toMatch(/subscribeToAppResume\(document/)
    expect(hook).toMatch(/return epoch \+ resumes/)
  })
})
