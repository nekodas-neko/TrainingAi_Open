import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Q-172: `clearLocalStoreData()` was a hand-written list of table names, and it had drifted to
 * **27 of the schema's 37 tables**. Seven of the ten it missed hold real user data —
 * `oura_heartrate`, `oura_daily_summary`, `oura_daily_derived`, `oura_bucket`, `prescribed_runs`,
 * `meal_types`, `sync_outbox` — so even the *correct* sign-out (More → Profile) left the previous
 * account's heart-rate samples and sleep rollups on the device.
 *
 * That is the same drift `RECONCILE_TABLES` was once missing 17 tables to. The fix is to stop
 * maintaining a list: read `sqlite_master` and clear everything except an explicit keep-set, so a
 * table added later is wiped by default. These tests pin that direction, because a regression here
 * is silent — nothing fails, data just stays behind.
 */

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

function clearFn(): string {
  const src = read('lib/local-store/index.ts')
  const start = src.indexOf('export async function clearLocalStoreData')
  expect(start, 'clearLocalStoreData not found').toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n}', start))
}

describe('clearLocalStoreData (Q-172)', () => {
  it('reads the table list from the live schema instead of hardcoding it', () => {
    const fn = clearFn()
    expect(fn).toContain('sqlite_master')
    // The old shape. A single hardcoded name means the list is being maintained by hand again.
    expect(fn).not.toMatch(/DELETE FROM [a-z_]+['"`]/)
  })

  it('clears by default — the keep-set is the only exemption, and it is short', () => {
    const src = read('lib/local-store/index.ts')
    const set = src.slice(src.indexOf('const KEEP_ON_SIGN_OUT'), src.indexOf(']);', src.indexOf('const KEEP_ON_SIGN_OUT')))
    const kept = [...set.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(kept.sort()).toEqual(['api_cache', 'exercise_library'])
  })

  it('keeps nothing that holds user data', () => {
    // The seven tables the hand-written list actually missed. If any of these ever appears in the
    // keep-set, this is the Q-172 leak again under a different name.
    const src = read('lib/local-store/index.ts')
    const keepBlock = src.slice(src.indexOf('const KEEP_ON_SIGN_OUT'), src.indexOf(']);', src.indexOf('const KEEP_ON_SIGN_OUT')))
    for (const table of [
      'oura_heartrate', 'oura_daily_summary', 'oura_daily_derived', 'oura_bucket',
      'prescribed_runs', 'meal_types', 'sync_outbox', 'body_metrics', 'sleep_sessions',
      'workout_sessions', 'food_logs', 'mutations_outbox',
    ]) {
      expect(keepBlock, `${table} must not be kept on sign-out`).not.toContain(`'${table}'`)
    }
  })

  it('every sign-out control goes through the one handler', () => {
    // Asserted here as well as in the CI check, so a `vitest run` alone still catches it.
    // `components/chat.tsx` was the second entry here until Q-189 deleted the unreachable
    // chat surface along with its two sign-out buttons. One control remains, which is the
    // point — Q-172's leak was that the two disagreed.
    for (const file of ['components/more/profile-tab.tsx']) {
      const src = read(file)
      expect(src, file).toContain('signOutAndClearDevice')
      expect(src, file).not.toMatch(/from ['"]@\/app\/actions['"]/)
      expect(src, file).not.toMatch(/<form[^>]*action=\{[^}]*signOut/)
    }
  })

  it('the shared handler clears the store and the cache before the server sign-out', () => {
    const src = read('lib/sign-out.ts')
    const order = ['clearLocalStoreData', 'clearAllCache', 'serverSignOut']
      .map(name => src.indexOf(`${name}(`, src.indexOf('export async function signOutAndClearDevice')))
    expect(order[0]).toBeGreaterThan(-1)
    expect(order[1]).toBeGreaterThan(order[0])
    expect(order[2]).toBeGreaterThan(order[1])
  })
})
