import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * RV-121 — `/collection` had exactly ONE door, and it was behind a preference.
 *
 * The only navigation to it lived in `home-card-widget.tsx`'s `case 'card_collectionWidget'`,
 * which returns `null` unless that widget is enabled — and `DEFAULT_CARD_WIDGETS` is `[]`
 * (`lib/home/home-prefs.ts`). So on a fresh install the route existed and nothing could reach it.
 * The owner chose a permanent More-tab address over turning the Home card on by default, because
 * the second changes what Home shows.
 *
 * **The rule pinned here is "more than one door, and one of them is unconditional" — not the row.**
 * A test that asserted the literal row would pass if someone moved it back inside another
 * preference-gated branch. The E2E spec proves it navigates; this is the half that GATES, since
 * the E2E job is advisory.
 */
describe('RV-121 — /collection is reachable without enabling a widget', () => {
  const WIDGET = 'components/home/home-card-widget.tsx'

  function navigators(): string[] {
    const files = execFileSync('git', ['ls-files', 'app', 'components', '--', '*.tsx'], {
      cwd: ROOT, encoding: 'utf8',
    }).split('\n').filter(Boolean)
    // A navigation, not a mere mention: `/collection` as the target of a push/navigate call.
    return files.filter(f => /(?:push|navigateWithTransition|navigateToTab|href=)[^\n]*['"`]\/collection['"`]/.test(src(f)))
  }

  it('still has the Home card door, so this is about adding one rather than moving it', () => {
    // A guard on the guard: if the widget stops linking, the assertion below goes vacuous.
    expect(navigators()).toContain(WIDGET)
  })

  it('has at least one navigator that is NOT the preference-gated Home widget', () => {
    const others = navigators().filter(f => f !== WIDGET)
    expect(others, '/collection must be reachable from somewhere that does not depend on DEFAULT_CARD_WIDGETS').not.toHaveLength(0)
  })

  it('the More tab is one of them, and its row is not itself behind a flag', () => {
    const tab = 'components/more/profile-tab.tsx'
    expect(navigators()).toContain(tab)
    const line = src(tab).split('\n').find(l => l.includes("'/collection'")) ?? ''
    // `isAdmin &&` wraps the Admin row a few lines below; the same shape here would re-hide it.
    expect(line).not.toMatch(/&&/)
  })

  it('Home stays unchanged — the default card set is still empty', () => {
    // The owner's decision had two halves and this is the one a later "improvement" would undo.
    expect(src('lib/home/home-prefs.ts')).toMatch(/DEFAULT_CARD_WIDGETS:\s*CardWidgetKey\[\]\s*=\s*\[\]/)
  })
})
