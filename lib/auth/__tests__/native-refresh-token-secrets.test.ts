// #2076. The refresh-token table can hold a hash and nothing else secret, and the data layer cannot
// be handed a raw token by mistake. Static and type-level, so it runs everywhere, database or not;
// `native-refresh-tokens.test.ts` proves the same against a real Postgres.
import { describe, it, expect, expectTypeOf } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { getTableColumns } from 'drizzle-orm'
import { nativeRefreshTokens } from '@/lib/data/postgres/schema'
import type { RefreshTokenHash } from '@/lib/auth/refresh-token-hash'
import type {
  CreateNativeRefreshTokenInput, RotateNativeRefreshTokenInput, NativeRefreshToken,
} from '@/lib/data/postgres/slices/native-refresh-tokens'
import type { WorkoutRepository } from '@/lib/data/repository'
import { EXCLUDED, EXPORTED } from '@/lib/export/export-map'

const root = path.resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

describe('native refresh tokens hold a hash, never a token (#2076)', () => {
  it('the only token-like column is token_hash', () => {
    const names = Object.values(getTableColumns(nativeRefreshTokens)).map(c => c.name)
    expect(names.filter(n => /token|secret|raw|refresh/i.test(n))).toEqual(['token_hash'])
  })

  it('the migration stores a 64-hex digest and nothing that could be the token', () => {
    const sql = read('lib/data/postgres/migrations/202610071636_native_refresh_tokens.sql')
    expect(sql).toMatch(/token_hash\s+text NOT NULL/)
    expect(sql).toContain(`CHECK (token_hash ~ '^[0-9a-f]{64}$')`)
    // No column other than token_hash names a token (comments aside).
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    const table = code.slice(code.indexOf('CREATE TABLE'), code.indexOf(');', code.indexOf('CREATE TABLE')))
    const columns = [...table.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|timestamptz)/gm)].map(m => m[1])
    expect(columns.filter(c => /token/.test(c))).toEqual(['token_hash'])
  })

  it('the data layer takes the branded hash type, so a plain string (a raw token) does not compile', () => {
    expectTypeOf<CreateNativeRefreshTokenInput['tokenHash']>().toEqualTypeOf<RefreshTokenHash>()
    expectTypeOf<RotateNativeRefreshTokenInput['newTokenHash']>().toEqualTypeOf<RefreshTokenHash>()
    expectTypeOf<Parameters<WorkoutRepository['findNativeRefreshTokenByHash']>[0]>().toEqualTypeOf<RefreshTokenHash>()
    // @ts-expect-error a plain string is not a RefreshTokenHash
    const notAHash: RefreshTokenHash = 'raw-token-value'
    expect(notAHash).toBeTypeOf('string')
  })

  it('no row the data layer returns has a hash field', () => {
    expectTypeOf<NativeRefreshToken>().not.toHaveProperty('tokenHash')
    const slice = read('lib/data/postgres/slices/native-refresh-tokens.ts')
    const columns = slice.slice(slice.indexOf('const COLUMNS = {'), slice.indexOf('}', slice.indexOf('const COLUMNS = {')))
    expect(columns).not.toMatch(/tokenHash/)
    // Every read and every RETURNING goes through COLUMNS or names its columns; none selects the row.
    expect(slice).not.toMatch(/\.select\(\)/)
    expect(slice).not.toMatch(/\.returning\(\)/)
  })

  it('claude_ro withholds the hash and the export excludes the table', () => {
    const views = read('lib/data/postgres/claude-ro-views.sql')
    const view = views.slice(views.indexOf('CREATE VIEW claude_ro.native_refresh_tokens'), views.indexOf('FROM public.native_refresh_tokens'))
    expect(view).toContain('t.family_id')
    expect(view).not.toContain('token_hash')
    expect(views).toContain(`('native_refresh_tokens', 'token_hash')`)
    expect(EXPORTED).not.toHaveProperty('native_refresh_tokens')
    expect(EXCLUDED.native_refresh_tokens?.category).toBe('credentials')
  })
})
