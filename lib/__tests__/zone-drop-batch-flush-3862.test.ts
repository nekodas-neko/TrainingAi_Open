// #3862 item 3 follow-up. The batched zone-minute invalidation of one push: a failed flush fails the
// push (so the device sends it again, as each mutation's own failed drop did before batching), the
// push's own error wins when it threw first, and work that outlives the batch writes its own drops.
import { describe, expect, it } from 'vitest'
import { batchZoneMinutesDrops, deleteZoneMinutesForActivityDates } from '@/lib/data/postgres/slices/oura'

const USER = 'u-3862'
const TZ = 'Australia/Brisbane'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())

function fakeDb(fail = false) {
  const writes: unknown[][] = []
  const db = {
    insert: () => ({
      values: (rows: unknown[]) => ({
        onConflictDoUpdate: async () => {
          if (fail) throw new Error('db down')
          writes.push(rows)
        },
      }),
    }),
  }
  return { db: db as never, writes }
}

describe('batchZoneMinutesDrops flush (#3862)', () => {
  it('collects the push\'s drops and writes them once at the end', async () => {
    const { db, writes } = fakeDb()
    await batchZoneMinutesDrops(db, USER, TZ, async () => {
      await deleteZoneMinutesForActivityDates(db, USER, [today()], TZ)
      expect(writes).toHaveLength(0)
    })
    expect(writes).toHaveLength(1)
  })

  it('a failed flush fails a push that succeeded', async () => {
    const { db } = fakeDb(true)
    await expect(batchZoneMinutesDrops(db, USER, TZ, async () => {
      await deleteZoneMinutesForActivityDates(db, USER, [today()], TZ)
      return 'ok'
    })).rejects.toThrow('db down')
  })

  it('when the push threw first, its own error is the one kept', async () => {
    const { db } = fakeDb(true)
    await expect(batchZoneMinutesDrops(db, USER, TZ, async () => {
      await deleteZoneMinutesForActivityDates(db, USER, [today()], TZ)
      throw new Error('push failed')
    })).rejects.toThrow('push failed')
  })

  it('a drop made after the flush, by work started inside the push, is written on its own', async () => {
    const { db, writes } = fakeDb()
    let later!: Promise<void>
    await batchZoneMinutesDrops(db, USER, TZ, async () => {
      // Started inside the push and not awaited, like the post-completion HR pipeline: it keeps
      // the push's async context, so it would otherwise join a batch that has already flushed.
      later = new Promise<void>(resolve => {
        setTimeout(() => { void deleteZoneMinutesForActivityDates(db, USER, [today()], TZ).then(resolve) }, 0)
      })
    })
    expect(writes).toHaveLength(0)
    await later
    expect(writes).toHaveLength(1)
  })
})
