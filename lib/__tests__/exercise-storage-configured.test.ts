import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * LA-87 — `isStorageConfigured()` and the client builder must answer the same question.
 *
 * They did not. `getS3()` resolved each variable with `??` and `isStorageConfigured()` with `||`,
 * and those differ on exactly one value: the **empty string**. With `AWS_ENDPOINT_URL=""` set
 * beside a real `STORAGE_ENDPOINT`, `??` kept the empty string and returned null while `||` fell
 * through to the real value and answered true — so a caller was told storage was ready by a helper
 * the uploader itself disagreed with.
 *
 * That divergence is what made "configured, and yet the upload returned null" reachable, and it is
 * not confined to the two routes LA-87 named. `admin/reference-figure` gates a POST on
 * `isStorageConfigured()` and then returns `{ url }` unguarded — so with an empty-string variable it
 * answered **200 `{ url: null }`** and dropped the uploaded file entirely, with no base64 fallback.
 *
 * An empty-string variable is not hypothetical here: that is what a platform writes for a variable
 * defined-but-blank, which is what a half-finished storage setup leaves behind.
 *
 * The uploader is the observable, since the client builder is private: a non-null return proves it
 * built a client from the same values the predicate approved.
 */
const send = vi.fn(async () => ({}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = send },
  PutObjectCommand: class {},
  GetObjectCommand: class {},
  HeadObjectCommand: class {},
  ListObjectsV2Command: class {},
}))

const VARS = [
  'AWS_ENDPOINT_URL', 'STORAGE_ENDPOINT',
  'AWS_ACCESS_KEY_ID', 'STORAGE_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'STORAGE_SECRET_ACCESS_KEY',
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v] } })
afterEach(() => { for (const v of VARS) { if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v] } })

async function load() {
  vi.resetModules()
  return import('@/lib/exercise-storage')
}

describe('storage configuration is one predicate (LA-87)', () => {
  it('agrees when an AWS_* variable is present but EMPTY and STORAGE_* carries the real value', async () => {
    // THE regression. Before the fix: isStorageConfigured() true, uploader null.
    process.env.AWS_ENDPOINT_URL = ''
    process.env.AWS_ACCESS_KEY_ID = ''
    process.env.AWS_SECRET_ACCESS_KEY = ''
    process.env.STORAGE_ENDPOINT = 'https://storage.example'
    process.env.STORAGE_ACCESS_KEY_ID = 'key'
    process.env.STORAGE_SECRET_ACCESS_KEY = 'secret'

    const { isStorageConfigured, uploadExerciseMedia } = await load()
    expect(isStorageConfigured()).toBe(true)
    // Non-null ⇒ a client was built from the same values the predicate approved.
    expect(await uploadExerciseMedia('exercise-media/x.png', Buffer.from('x'), 'image/png')).not.toBeNull()
  })

  it('agrees when nothing is set — unconfigured, and the uploader declines', async () => {
    const { isStorageConfigured, uploadExerciseMedia } = await load()
    expect(isStorageConfigured()).toBe(false)
    expect(await uploadExerciseMedia('exercise-media/x.png', Buffer.from('x'), 'image/png')).toBeNull()
  })

  it('agrees when only the AWS_* names carry real values', async () => {
    process.env.AWS_ENDPOINT_URL = 'https://aws.example'
    process.env.AWS_ACCESS_KEY_ID = 'key'
    process.env.AWS_SECRET_ACCESS_KEY = 'secret'
    const { isStorageConfigured, uploadExerciseMedia } = await load()
    expect(isStorageConfigured()).toBe(true)
    expect(await uploadExerciseMedia('exercise-media/x.png', Buffer.from('x'), 'image/png')).not.toBeNull()
  })

  it('agrees that a partial configuration is not configured', async () => {
    // Endpoint and key but no secret: neither half may call this ready.
    process.env.STORAGE_ENDPOINT = 'https://storage.example'
    process.env.STORAGE_ACCESS_KEY_ID = 'key'
    const { isStorageConfigured, uploadExerciseMedia } = await load()
    expect(isStorageConfigured()).toBe(false)
    expect(await uploadExerciseMedia('exercise-media/x.png', Buffer.from('x'), 'image/png')).toBeNull()
  })

  it('treats an all-empty configuration as unconfigured rather than half-ready', async () => {
    for (const v of VARS) process.env[v] = ''
    const { isStorageConfigured, uploadExerciseMedia } = await load()
    expect(isStorageConfigured()).toBe(false)
    expect(await uploadExerciseMedia('exercise-media/x.png', Buffer.from('x'), 'image/png')).toBeNull()
  })
})
