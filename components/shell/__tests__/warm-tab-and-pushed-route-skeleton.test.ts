import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tabKeyForHref } from '../tabs'

/**
 * #2442 and #2441: a skeleton on a repeat visit.
 *
 * The repo has no jsdom component harness (see `sync-provider-auth-gate.test.ts`), so these pin the
 * two structural facts the fixes rest on. The timing itself was measured in `pnpm dev` and is
 * recorded on the PR; it needs the device to confirm.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('#2442: a warm tab renders its screen, not a pulse', () => {
  const shell = read('components/shell/tab-shell.tsx')

  it('does not code-split the tabs through next/dynamic, which suspends on a settled import', () => {
    expect(shell).not.toMatch(/from\s+["']next\/dynamic["']/)
  })

  it('warms each tab through the same preload the tab is rendered with', () => {
    for (const tab of ['Health', 'Workout', 'Nutrition', 'More']) {
      expect(shell).toContain(`${tab}.preload()`)
      expect(shell).toContain(`${tab}.Tab`)
    }
    // A second, separate `import()` of the same module is what Turbopack names as another chunk.
    expect(shell.match(/import\(["']@\/app\//g)?.length).toBe(4)
  })
})

describe('#2441: a pushed route has no bottom nav in its loading state', () => {
  const loading = read('components/shell/tab-loading.tsx')

  it('draws the bottom nav only for a tab route', () => {
    expect(loading).toMatch(/\{isTab && <BottomNav/)
    expect(loading).not.toMatch(/^\s*<BottomNav/m)
  })

  it('tells a tab from a pushed route the way the shell does', () => {
    expect(tabKeyForHref('/health')).toBe('health')
    expect(tabKeyForHref('/workout')).toBe('workout')
    expect(tabKeyForHref('/health/day')).toBeNull()
    expect(tabKeyForHref('/more/settings')).toBeNull()
    expect(tabKeyForHref('/workout?session=push')).toBeNull()
  })

  it('/workout reads its query, because the tab and the full-screen workout share a path', () => {
    expect(read('app/workout/loading.tsx')).toContain('useSearchParams()')
  })
})
