// Issue 2684 — a scan that matches a saved duplicate must not lose its fresh picture and barcode.
//
// The saved copy can be a pre-fix row with neither. Both server paths that hand the duplicate back
// (the interactive `reuseExisting` create, and the outbox push, whose insert is ON CONFLICT DO
// NOTHING) now fill the gaps, add-only: a stored value is never overwritten and nothing is nulled.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000026840001'
const OTHER = '00000000-0000-4000-8000-000026840002'
const PIC = 'data:image/webp;base64,AAAA'
const PIC2 = 'data:image/webp;base64,BBBB'

describe.skipIf(!canRun)('food_items gap fill on a duplicate (issue 2684)', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepositoryAsync>>

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `gap-fill-${id}@example.com`],
      )
    }
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM food_items WHERE user_id = ANY($1)`, [[USER, OTHER]])
  })

  const food = {
    name: 'Protein Bar', brand: 'Acme', servingSizeG: 40, calories: 150, proteinG: 20, carbsG: 10, fatG: 5,
    source: 'barcode' as const, region: 'AU',
  }
  const row = async (id: string) =>
    (await pool.query(`SELECT user_id, image_data_uri, barcode FROM food_items WHERE id = $1`, [id])).rows[0]
  const count = async (userId: string) =>
    (await pool.query(`SELECT count(*)::int n FROM food_items WHERE user_id = $1`, [userId])).rows[0].n as number

  it('reuseExisting: an imageless, code-less duplicate gains the fresh picture and barcode', async () => {
    const saved = await repo.createFoodItem(USER, food, { reuseExisting: true })
    const got = await repo.createFoodItem(USER, { ...food, imageDataUri: PIC, barcode: '9300000000017' }, { reuseExisting: true })
    expect(got.id).toBe(saved.id)
    expect(got.imageDataUri).toBe(PIC)
    expect(got.barcode).toBe('9300000000017')
    const r = await row(saved.id)
    expect(r.image_data_uri).toBe(PIC)
    expect(r.barcode).toBe('9300000000017')
    expect(await count(USER)).toBe(1)
  })

  it('reuseExisting: an existing picture and a different barcode are never overwritten', async () => {
    const saved = await repo.createFoodItem(USER, { ...food, imageDataUri: PIC, barcode: '111' }, { reuseExisting: true })
    const got = await repo.createFoodItem(USER, { ...food, imageDataUri: PIC2, barcode: '222' }, { reuseExisting: true })
    expect(got.id).toBe(saved.id)
    expect(got.imageDataUri).toBe(PIC)
    expect(got.barcode).toBe('111')
    expect(await row(saved.id)).toMatchObject({ image_data_uri: PIC, barcode: '111' })
  })

  it('a null offered value never nulls or changes the stored one', async () => {
    const saved = await repo.createFoodItem(USER, { ...food, imageDataUri: PIC, barcode: '111' }, { reuseExisting: true })
    await repo.createFoodItem(USER, { ...food, imageDataUri: null, barcode: undefined }, { reuseExisting: true })
    expect(await row(saved.id)).toMatchObject({ image_data_uri: PIC, barcode: '111' })
  })

  it('fills only the missing half: a saved picture stays, the barcode arrives', async () => {
    const saved = await repo.createFoodItem(USER, { ...food, imageDataUri: PIC }, { reuseExisting: true })
    await repo.createFoodItem(USER, { ...food, imageDataUri: PIC2, barcode: '333' }, { reuseExisting: true })
    expect(await row(saved.id)).toMatchObject({ image_data_uri: PIC, barcode: '333' })
  })

  it('a barcode another of the user\'s items carries still fills (no unique index), and the picture fills too', async () => {
    await repo.createFoodItem(USER, { ...food, name: 'Other product', calories: 99, barcode: '444' }, { reuseExisting: true })
    const saved = await repo.createFoodItem(USER, food, { reuseExisting: true })
    const got = await repo.createFoodItem(USER, { ...food, imageDataUri: PIC, barcode: '444' }, { reuseExisting: true })
    expect(got.id).toBe(saved.id)
    expect(await row(saved.id)).toMatchObject({ image_data_uri: PIC, barcode: '444' })
    expect(await count(USER)).toBe(2)
  })

  it('outbox push: the same id fills the gap, is idempotent on replay, and never overwrites', async () => {
    const saved = await repo.createFoodItem(USER, food)
    const push = { ...food, id: saved.id, imageDataUri: PIC, barcode: '555' }
    const a = await repo.createFoodItem(USER, push)
    expect(a).toMatchObject({ id: saved.id, imageDataUri: PIC, barcode: '555' })
    const b = await repo.createFoodItem(USER, push)
    expect(b).toMatchObject({ id: saved.id, imageDataUri: PIC, barcode: '555' })
    await repo.createFoodItem(USER, { ...push, imageDataUri: PIC2, barcode: '666' })
    expect(await row(saved.id)).toMatchObject({ image_data_uri: PIC, barcode: '555' })
  })

  it('another user\'s item (same name, same id) is untouched and not disclosed', async () => {
    const theirs = await repo.createFoodItem(OTHER, food)
    await expect(repo.createFoodItem(USER, { ...food, id: theirs.id, imageDataUri: PIC, barcode: '777' })).rejects.toThrow()
    expect(await row(theirs.id)).toMatchObject({ user_id: OTHER, image_data_uri: null, barcode: null })
    // The same food by name for USER does not reach OTHER's row either.
    const mine = await repo.createFoodItem(USER, { ...food, imageDataUri: PIC, barcode: '777' }, { reuseExisting: true })
    expect(mine.id).not.toBe(theirs.id)
    expect(await row(theirs.id)).toMatchObject({ image_data_uri: null, barcode: null })
  })
})
