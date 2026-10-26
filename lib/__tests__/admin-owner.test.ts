import { describe, it, expect, vi } from 'vitest'
import { resolveOwnerUserId, sameUserId, isOwnerUserId, judgeProtectedTarget } from '@/lib/admin-owner'

// #3368 — the owner protection must not switch off quietly. A well-formed uuid is not enough: it
// has to name an active admin, otherwise the rule protects nobody and nothing says so.
const OWNER = '00000000-0000-4000-8000-00000336800f'
const env = (v: string) => ({ CLAUDE_RO_OWNER_USER_ID: v }) as unknown as NodeJS.ProcessEnv
const repoWith = (user: { isAdmin?: boolean; isActive?: boolean } | null) => ({ getUserById: vi.fn(async () => user) })

describe('resolveOwnerUserId', () => {
  it('resolves an active admin, lower-cased', async () => {
    expect(await resolveOwnerUserId(repoWith({ isAdmin: true, isActive: true }), env(OWNER.toUpperCase()))).toBe(OWNER)
  })
  it.each([
    ['no such user', null],
    ['a non-admin', { isAdmin: false, isActive: true }],
    ['an inactive admin', { isAdmin: true, isActive: false }],
  ])('is unresolved for %s', async (_n, user) => {
    expect(await resolveOwnerUserId(repoWith(user), env(OWNER))).toBeNull()
  })
  it('is unresolved when the lookup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const repo = { getUserById: vi.fn(async () => { throw new Error('db down') }) }
    expect(await resolveOwnerUserId(repo, env(OWNER))).toBeNull()
  })
  it('does not look anything up for an unset or malformed setting', async () => {
    const repo = repoWith({ isAdmin: true, isActive: true })
    expect(await resolveOwnerUserId(repo, {} as NodeJS.ProcessEnv)).toBeNull()
    expect(await resolveOwnerUserId(repo, env('nope'))).toBeNull()
    expect(repo.getUserById).not.toHaveBeenCalled()
  })
})

describe('id comparison', () => {
  it('ignores case and surrounding space', () => {
    expect(sameUserId(OWNER.toUpperCase(), OWNER)).toBe(true)
    expect(isOwnerUserId(` ${OWNER.toUpperCase()} `, OWNER)).toBe(true)
    expect(sameUserId(OWNER, '00000000-0000-4000-8000-000000000001')).toBe(false)
  })
})

describe('judgeProtectedTarget', () => {
  const OTHER = '00000000-0000-4000-8000-000000000002'
  it('keeps protecting the named owner after they stop qualifying (demoted, so ownerId is null)', () => {
    expect(judgeProtectedTarget(OTHER, OWNER, false, null, env(OWNER))).toBe('owner-protected')
    expect(judgeProtectedTarget(OTHER, OWNER.toUpperCase(), false, null, env(OWNER))).toBe('owner-protected')
  })
  it('lets the verified owner act on their own account', () => {
    expect(judgeProtectedTarget(OWNER, OWNER, true, OWNER, env(OWNER))).toBeNull()
  })
  it('refuses any admin target when nothing is configured, and allows a non-admin', () => {
    expect(judgeProtectedTarget(OTHER, '00000000-0000-4000-8000-000000000003', true, null, {} as NodeJS.ProcessEnv)).toBe('owner-unresolved')
    expect(judgeProtectedTarget(OTHER, '00000000-0000-4000-8000-000000000003', false, null, {} as NodeJS.ProcessEnv)).toBeNull()
  })
})
