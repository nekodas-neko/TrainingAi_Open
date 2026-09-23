/**
 * The guard on the guard (LB-133).
 *
 * `check-invalidate-after-push.js` reported `no write invalidates around its push` for weeks while
 * **five live sites** carried the defect it names. Its detector was a ±12-line text window around
 * the call, and every one of those five put its invalidation 14 to 53 lines away. Reverting a fixed
 * site and re-running still reported clean. A check that cannot see most of its own class is worse
 * than no check, because the green tick is read as evidence.
 *
 * **Widening the window is the fix that already failed once** — LB-6 looked six lines above each
 * call, missed five written below, and the window became ±12 both ways. So these cases are written
 * as SHAPES, not distances, and the false-positive cases matter as much as the true ones: a
 * detector loose enough to catch every offender by proximity would flag the Sync buttons too.
 *
 * The live offenders are all fixed, so nothing here can point at a file. The shapes below are taken
 * from the real pre-fix sources.
 */
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { offendersIn } = require('../check-invalidate-after-push.js') as { offendersIn: (s: string) => number[] }

const filler = (n: number) => Array.from({ length: n }, (_, i) => `      const pad${i} = ${i}`).join('\n')

describe('check-invalidate-after-push sees every shape of the class', () => {
  it('catches an invalidation far BELOW the push, in the same block', () => {
    // The log-value-sheet shape: 39 lines between them, inside one `try`. The old ±12 window is
    // exactly what this defeats, so the padding here is deliberately wider than any window.
    expect(offendersIn(`
      export function Screen() {
        async function save() {
          try {
            await store.queueMutation({ domain: 'body_metrics' })
            pushMutations(userId!).catch(() => {})
${filler(40)}
            invalidateBodyMetricWrite().catch(() => {})
          } catch {}
        }
      }
    `)).toHaveLength(1)
  })

  it('catches a push and an invalidation in SIBLING async IIFEs', () => {
    // The mood/morning check-in shape. They share no block at all — only the handler — so a
    // detector that brace-matches the immediately-enclosing block still misses this one.
    expect(offendersIn(`
      export function Sheet() {
        async function handleSave() {
          const localWrite = (async () => {
            await store.upsertMoodLog({})
            pushMutations(userId!).catch(() => {})
            return true
          })()
          void (async () => {
            await localWrite
            await invalidateCheckinAffectsPrescription().catch(() => {})
          })()
        }
      }
    `)).toHaveLength(1)
  })

  it('catches a push in a nested try and an invalidation in the parent', () => {
    // The end-of-day-review shape.
    expect(offendersIn(`
      export function Review() {
        async function handleSave() {
          try {
            if (store) {
              try {
                await store.queueMutation({})
                pushMutations(userId!).catch(() => {})
              } catch (e) {}
            }
            invalidateHealthTrends().catch(() => {})
          } catch {}
        }
      }
    `)).toHaveLength(1)
  })

  it('catches one written at module scope, outside any component', () => {
    // The rest-day.ts shape — an exported helper, not a component. It has one enclosing function
    // rather than two, which is the branch that picks the handler scope.
    expect(offendersIn(`
      export function chooseRestDay(userId, opts) {
        void (async () => {
          await store.queueMutation({ domain: 'rest_days' })
          pushMutations(userId!).catch(() => {})
          await invalidateRestDayChoice()
        })()
      }
    `)).toHaveLength(1)
  })

  it('does NOT flag a push and an invalidation in DIFFERENT handlers', () => {
    // The false positive that matters, and the reason the scope is the handler rather than the
    // file or a big window: `more-content.tsx` has a Sync button that flushes the outbox and an
    // unrelated invalidation elsewhere. A looser detector flags it and trains people to ignore
    // this check.
    expect(offendersIn(`
      export function More() {
        async function syncNow() {
          pushMutations(userId!).catch(() => {})
        }
        async function saveSomethingElse() {
          await invalidateHealthTrends()
        }
      }
    `)).toHaveLength(0)
  })

  it('does NOT flag a bare push that owns no cache key', () => {
    // The Sync buttons and the provider's own passes are flushes, not writes.
    expect(offendersIn(`
      export function SyncCard() {
        async function retry() {
          pushMutations(userId!).catch(() => {})
        }
      }
    `)).toHaveLength(0)
  })

  it('does NOT flag an AWAITED push', () => {
    // Whatever follows already runs after the server has the write — the ordering this is about.
    expect(offendersIn(`
      export function Screen() {
        async function save() {
          await pushMutations(userId!)
          await invalidateHealthTrends()
        }
      }
    `)).toHaveLength(0)
  })

  it('does NOT flag a push chained to its own resolution', () => {
    expect(offendersIn(`
      export function Screen() {
        async function save() {
          pushMutations(userId!).then(() => invalidateHealthTrends())
        }
      }
    `)).toHaveLength(0)
  })

  it('does NOT flag the import line', () => {
    expect(offendersIn(`
      import { pushMutations } from '@/lib/local-store/sync-engine'
      export function Screen() {
        async function save() { await invalidateHealthTrends() }
      }
    `)).toHaveLength(0)
  })

  it('reports each offending push separately in a file with several', () => {
    expect(offendersIn(`
      export function Screen() {
        async function saveA() {
          pushMutations(userId!).catch(() => {})
          invalidateHealthTrends().catch(() => {})
        }
        async function saveB() {
          pushMutations(userId!).catch(() => {})
          invalidateBodyMetricWrite().catch(() => {})
        }
      }
    `)).toHaveLength(2)
  })
})
