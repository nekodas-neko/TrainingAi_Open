/**
 * The guard on the guard (DV-11).
 *
 * Device Verification found one unnamed switch on the supplements sheet. The sweep that followed
 * found **17 of 25** across eleven files — so the interesting question was never "is that one
 * fixed" but "can the detector see the shapes the app actually writes".
 *
 * It nearly could not. The first pass over this class matched `<Switch` a line at a time and
 * **over-counted by nine**, reporting every multi-line switch as unnamed because its `aria-label`
 * sat on the next line. A detector that cannot read its own class is worse than none, because the
 * green tick gets believed. Each shape is pinned here.
 */
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { switchOffendersIn } = require('../check-icon-button-names.js') as {
  switchOffendersIn: (s: string) => number[]
}

describe('check-icon-button-names sees every shape of an unnamed Switch', () => {
  it('flags the self-closing one', () => {
    expect(switchOffendersIn(`<Switch checked={a} onCheckedChange={setA} />`)).toEqual([1])
  })

  it('accepts one named on the SAME line', () => {
    expect(switchOffendersIn(`<Switch checked={a} onCheckedChange={setA} aria-label="Sync" />`)).toEqual([])
  })

  it('accepts one named on a LATER line — the shape that over-counted the sweep by nine', () => {
    expect(switchOffendersIn(`
      <Switch
        checked={a}
        onCheckedChange={setA}
        aria-label="Save to my meals"
      />
    `)).toEqual([])
  })

  it('flags a multi-line one that is genuinely unnamed', () => {
    expect(switchOffendersIn(`
      <Switch
        checked={a}
        onCheckedChange={setA}
      />
    `)).toEqual([2])
  })

  it('reads past an inline arrow, which is how most handlers are written here', () => {
    // PS-34's lesson on the button half: a `[^>]*` class ends the tag at the `>` of `=>`, so the
    // attributes get truncated and the naming attribute after it is never seen.
    expect(switchOffendersIn(`<Switch onCheckedChange={() => toggle(s)} aria-label={s.name} />`)).toEqual([])
    expect(switchOffendersIn(`<Switch onCheckedChange={() => toggle(s)} />`)).toEqual([1])
  })

  it('reads past a `>` inside a quoted attribute', () => {
    expect(switchOffendersIn(`<Switch aria-label="a > b" checked={a} />`)).toEqual([])
  })

  it('accepts aria-labelledby and title as names', () => {
    expect(switchOffendersIn(`<Switch aria-labelledby="x" />`)).toEqual([])
    expect(switchOffendersIn(`<Switch title="x" />`)).toEqual([])
  })

  it('does not confuse a longer component name for Switch', () => {
    // `<SwitchGroup>` is not the primitive; the lookahead is what keeps it out.
    expect(switchOffendersIn(`<SwitchGroup checked={a} />`)).toEqual([])
  })

  it('finds several in one file, at their own lines', () => {
    expect(switchOffendersIn(`<Switch a />\n<Switch aria-label="x" />\n<Switch b />`)).toEqual([1, 3])
  })
})
