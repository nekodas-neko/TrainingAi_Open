/**
 * RV-179 / RV-178 — `check-memo-prop-stability` caught an inline arrow or object at the call site and
 * not a function declared in the render body and passed by NAME, which defeats `memo()` exactly the
 * same way: it is a new function on every render. RV-178 found two live; widening the check found a
 * third (`MealBuilderFooter onSave={handleSave}`).
 *
 * These drive the pure `scan` over in-memory sources, one shape at a time.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scan } = require('../check-memo-prop-stability.js') as {
  scan: (s: Array<{ rel: string; content: string }>) => { perFile: Map<string, number>; detail: string[] }
}

const CHILD = `export const Row = memo(function Row({ onToggle }: { onToggle: () => void }) { return null })\n`
const run = (parent: string) => scan([
  { rel: 'components/row.tsx', content: CHILD },
  { rel: 'components/parent.tsx', content: parent },
])

describe('a render-body function passed by name to a memoised component', () => {
  it('is flagged for a function declaration, an arrow and an async arrow', () => {
    for (const decl of [
      `  function toggle() {}`,
      `  const toggle = () => {}`,
      `  const toggle = async (id: string) => { void id }`,
      `  const toggle = function () {}`,
      `  async function toggle() {}`,
    ]) {
      const r = run(`export function Parent() {\n${decl}\n  return <Row onToggle={toggle} />\n}\n`)
      expect(r.perFile.get('components/parent.tsx'), decl).toBe(1)
    }
  })

  it('names the prop and the function so the fix is obvious', () => {
    const r = run(`export function Parent() {\n  const toggle = () => {}\n  return <Row onToggle={toggle} />\n}\n`)
    expect(r.detail[0]).toContain('render-body function passed by name (onToggle={toggle})')
  })

  it('is not flagged once it is wrapped in a hook', () => {
    expect(run(`export function Parent() {\n  const toggle = useCallback(() => {}, [])\n  return <Row onToggle={toggle} />\n}\n`).perFile.size).toBe(0)
    expect(run(`export function Parent() {\n  const toggle = useCallback(async (id: string) => { void id }, [])\n  return <Row onToggle={toggle} />\n}\n`).perFile.size).toBe(0)
  })

  it('is not flagged for a module-level function, which is one identity for the life of the page', () => {
    expect(run(`function toggle() {}\nexport function Parent() {\n  return <Row onToggle={toggle} />\n}\n`).perFile.size).toBe(0)
    expect(run(`const toggle = () => {}\nexport function Parent() {\n  return <Row onToggle={toggle} />\n}\n`).perFile.size).toBe(0)
  })

  it('is not flagged for a component that is not memoised', () => {
    const r = scan([{ rel: 'components/parent.tsx', content: `function Plain() { return null }\nexport function Parent() {\n  const toggle = () => {}\n  return <Plain onToggle={toggle} />\n}\n` }])
    expect(r.perFile.size).toBe(0)
  })

  it('is not flagged for a plain value or a prop that is not a bare name', () => {
    expect(run(`export function Parent() {\n  const toggle = () => {}\n  const label = 'x'\n  return <Row onToggle={label} />\n}\n`).perFile.size).toBe(0)
    expect(run(`export function Parent({ onToggle }: { onToggle: () => void }) {\n  return <Row onToggle={onToggle} />\n}\n`).perFile.size).toBe(0)
  })

  it('ignores a comment that quotes the shape', () => {
    expect(run(`export function Parent() {\n  // const toggle = () => {}  <Row onToggle={toggle} />\n  return null\n}\n`).perFile.size).toBe(0)
  })

  it('still flags the original inline shapes', () => {
    expect(run(`export function Parent() {\n  return <Row onToggle={() => {}} />\n}\n`).perFile.get('components/parent.tsx')).toBe(1)
    expect(run(`export function Parent() {\n  return <Row onToggle={{ a: 1 }} />\n}\n`).perFile.get('components/parent.tsx')).toBe(1)
  })
})
