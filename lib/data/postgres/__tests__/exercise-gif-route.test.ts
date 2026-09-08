// PS-39 — `GET /api/exercise-gif`, tested against real rows because its logic IS its SQL.
//
// The route picks between two tables and then writes back to one of them, and every decision lives
// in a query: a case-insensitive name match, a preference for generated media over the legacy
// cache, a cached row **skipped when both its URLs are null**, and a COALESCE upsert so a later
// null can never clobber a URL already stored. A stub answering `db.select` would assert that a
// builder was called.
//
// So these are the cases a mock is structurally blind to:
//
//   · generated media wins over a legacy cache row for the same exercise;
//   · the proxy URLs are derived from the NAME, not from the stored URL, which may be a stale
//     absolute S3 address;
//   · a cached row with both URLs null is ignored rather than served — null gets cached when the
//     dataset is unreachable on first lookup, and serving it would make that outage permanent;
//   · the name match is case-insensitive;
//   · the write-back is COALESCE, so a later miss leaves an earlier hit intact.
//
// Runs only against a real local dev Postgres — skips in CI, like its siblings here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const OWNER = '00000000-0000-4000-8000-0000000000e3'
const GENERATED = 'Gif Test Generated Lift'
const CACHED = 'Gif Test Cached Lift'
const UNKNOWN = 'Gif Test Unknown Lift'
// A name the LOCAL override map resolves, so a fresh lookup finds something without any
// network call — which is the only thing that can tell a re-lookup from a served null.
const DIRECT = 'Hip Thrust'

let sessionUser: { id: string } | null = { id: OWNER }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

describe.skipIf(!canRun)('exercise-gif — the media it picks and what it writes back', () => {
  let pool: import('pg').Pool
  let GET: typeof import('@/app/api/exercise-gif/route').GET

  const names = [GENERATED, CACHED, UNKNOWN, DIRECT]

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ;({ GET } = await import('@/app/api/exercise-gif/route'))
    // Email derived FROM the id, so changing an id later cannot leave a stale one behind.
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [OWNER, `gif-${OWNER}@example.com`])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM exercise_media WHERE exercise_name = ANY($1)`, [names])
    await pool.query(`DELETE FROM exercise_gif_cache WHERE exercise_name = ANY($1)`, [names])
    await pool.query(`DELETE FROM users WHERE id = $1`, [OWNER])
  })

  beforeEach(async () => {
    sessionUser = { id: OWNER }
    await pool.query(`DELETE FROM exercise_media WHERE exercise_name = ANY($1)`, [names])
    await pool.query(`DELETE FROM exercise_gif_cache WHERE exercise_name = ANY($1)`, [names])
  })

  const gif = (name: string) =>
    GET(new Request(`http://localhost/api/exercise-gif?name=${encodeURIComponent(name)}`))
  const body = async (name: string) => (await gif(name)).json()

  const cachedRow = async (name: string) => (await pool.query(
    `SELECT gif_url, image_url FROM exercise_gif_cache WHERE exercise_name = $1`, [name])).rows[0]

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await gif(GENERATED)).status).toBe(401)
  })

  // Not a 400: the caller is a render path, and an empty answer is what it can draw.
  it('answers empty rather than erroring for a name it will not look up', async () => {
    expect(await body('')).toEqual({ gifUrl: null, imageUrl: null })
    expect(await body('x'.repeat(101))).toEqual({ gifUrl: null, imageUrl: null })
  })

  // The stored URL may be an old absolute S3 address, so the proxy path is derived from the NAME.
  it('prefers generated media and derives its URLs from the name', async () => {
    await pool.query(
      `INSERT INTO exercise_media (exercise_name, gender, gif_url, start_url)
       VALUES ($1, 'male', 'https://old-bucket.s3.amazonaws.com/stale.gif', 'https://old-bucket.s3.amazonaws.com/stale.png')`,
      [GENERATED])
    // …and a legacy cache row for the SAME exercise, so the preference is what decides rather than
    // the absence of an alternative.
    await pool.query(
      `INSERT INTO exercise_gif_cache (exercise_name, gif_url, image_url) VALUES ($1, 'legacy.gif', 'legacy.png')`,
      [GENERATED])

    const res = await body(GENERATED)
    expect(res.source).toBe('generated')
    expect(res.gifUrl).toBe('/exercise-media/gifs/male/gif-test-generated-lift.gif')
    expect(res.imageUrl).toBe('/exercise-media/frames/male/gif-test-generated-lift-start.png')
    expect(res.gifUrl).not.toContain('s3')
  })

  it('answers no still frame when the generated row has none', async () => {
    await pool.query(
      `INSERT INTO exercise_media (exercise_name, gender, gif_url, start_url) VALUES ($1, 'male', 'x.gif', NULL)`,
      [GENERATED])
    const res = await body(GENERATED)
    expect(res.gifUrl).toContain('/exercise-media/gifs/male/')
    expect(res.imageUrl).toBeNull()
  })

  it('falls back to the legacy cache when there is no generated row', async () => {
    await pool.query(
      `INSERT INTO exercise_gif_cache (exercise_name, gif_url, image_url) VALUES ($1, 'legacy.gif', 'legacy.png')`,
      [CACHED])
    expect(await body(CACHED)).toEqual({ gifUrl: 'legacy.gif', imageUrl: 'legacy.png' })
  })

  /**
   * A null pair gets cached when the dataset is unreachable on the first lookup, and serving it
   * would make a transient outage permanent for that exercise.
   *
   * The first draft of this case cached nulls under a name nothing could resolve — so the answer
   * was `{null, null}` whether the route skipped the row or served it, and the case proved nothing.
   * It uses a name the local override map resolves instead: skipping the row returns a real URL,
   * serving it returns null, and the two are finally distinguishable.
   */
  it('ignores a cached row whose URLs are both null and looks again', async () => {
    await pool.query(
      `INSERT INTO exercise_gif_cache (exercise_name, gif_url, image_url) VALUES ($1, NULL, NULL)`,
      [DIRECT])

    const res = await body(DIRECT)
    expect(res.gifUrl).toContain('hip-thrust')
    expect(res.gifUrl).not.toBeNull()
  })

  it('replaces the cached nulls with what it found', async () => {
    await pool.query(
      `INSERT INTO exercise_gif_cache (exercise_name, gif_url, image_url) VALUES ($1, NULL, NULL)`,
      [DIRECT])
    await gif(DIRECT)
    expect((await cachedRow(DIRECT)).gif_url).toContain('hip-thrust')
  })

  it('does serve a cached row that has only one of the two URLs', async () => {
    await pool.query(
      `INSERT INTO exercise_gif_cache (exercise_name, gif_url, image_url) VALUES ($1, 'half.gif', NULL)`,
      [CACHED])
    expect(await body(CACHED)).toEqual({ gifUrl: 'half.gif', imageUrl: null })
  })

  it('matches the name case-insensitively', async () => {
    await pool.query(
      `INSERT INTO exercise_gif_cache (exercise_name, gif_url, image_url) VALUES ($1, 'legacy.gif', 'legacy.png')`,
      [CACHED])
    expect((await body(CACHED.toUpperCase())).gifUrl).toBe('legacy.gif')
  })

  it('writes its answer back to the cache for next time', async () => {
    await gif(UNKNOWN)
    expect(await cachedRow(UNKNOWN)).toBeDefined()
  })

  /**
   * A populated cache row is served without a fresh lookup, so nothing overwrites it.
   *
   * This case is named for what it actually proves. It was first written as "COALESCE stops a later
   * null clobbering an earlier hit" — but that is unreachable, and the mutation pass is what showed
   * it: deleting the `COALESCE` from the write-back changed no answer. The route returns early for
   * any cached row carrying a URL, so the upsert only ever runs when the existing row is absent or
   * null-on-both — and `COALESCE(new, NULL)` is `new`. The guard is defensive against a path the
   * branch above it forecloses. Left in place (it costs nothing and a future reordering would need
   * it), recorded here so the next reader does not mistake it for tested behaviour.
   */
  it('serves a populated cache row without looking again, so nothing can overwrite it', async () => {
    await pool.query(
      `INSERT INTO exercise_gif_cache (exercise_name, gif_url, image_url) VALUES ($1, 'kept.gif', 'kept.png')`,
      [UNKNOWN])
    expect(await body(UNKNOWN)).toEqual({ gifUrl: 'kept.gif', imageUrl: 'kept.png' })
    expect(await cachedRow(UNKNOWN)).toMatchObject({ gif_url: 'kept.gif', image_url: 'kept.png' })
  })
})
