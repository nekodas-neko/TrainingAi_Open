// The rule behind `check-save-preference-in-effect.js`, driven against fixtures rather than the
// tree — a check whose only evidence is "it passes today" cannot show it would have caught the
// defect it was written for, and this one's defect is already fixed.
//
// The shape that shipped is BROKEN below: `goals-progress-card.tsx` mirrored its view mode into a
// preference from a mount effect, which is a PATCH on every mount. Inside Health's launch burst
// that PATCH and a GET behind it stayed pending past sixty seconds and failed nine e2e specs, none
// of which mentions preferences.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findSavePreferenceInEffects } = require('../lib/save-preference-in-effect.js') as {
  findSavePreferenceInEffects: (s: { file: string; src: string }[]) => { file: string; line: number; helper: string }[]
}

const scan = (src: string, file = 'components/x.tsx') => findSavePreferenceInEffects([{ file, src }])

const BROKEN = `
export function GoalsProgressCard() {
  const [view, setView] = useState('rings')
  useEffect(() => {
    savePreference('goalsProgressView', view)
  }, [view])
  return null
}
`

const FIXED = `
export function GoalsProgressCard() {
  const [view, setView] = useState('rings')
  usePersistedPreference('goalsProgressView', view)
  return null
}
`

describe('savePreference inside a useEffect', () => {
  it('catches the shape that shipped', () => {
    expect(scan(BROKEN)).toEqual([{ file: 'components/x.tsx', line: 5, helper: 'savePreference' }])
  })

  it('passes the fix that replaced it', () => {
    expect(scan(FIXED)).toEqual([])
  })

  // A concise arrow has no body braces, so a scanner that looks for `{ … }` misses it entirely
  // while it is the same defect.
  it('catches a concise effect body', () => {
    expect(scan(`useEffect(() => savePreference('a', v), [v])`)).toHaveLength(1)
  })

  it('catches savePreferences, the paired-write helper', () => {
    expect(scan(`useEffect(() => { savePreferences({ brandHue: h, brandTheme: null }) }, [h])`))
      .toEqual([{ file: 'components/x.tsx', line: 1, helper: 'savePreferences' }])
  })

  // The rule is about effects, not about the helper. Calling it from a handler is the correct shape
  // and must never be flagged — that is most of this codebase's real call sites.
  it('leaves handlers alone', () => {
    expect(scan(`const onPick = (r) => { setRegion(r); savePreference('foodRegion', r) }`)).toEqual([])
  })

  it('leaves a handler declared beside an effect alone', () => {
    expect(scan([
      `useEffect(() => { setReady(true) }, [])`,
      `const onPick = (r) => savePreference('foodRegion', r)`,
    ].join('\n'))).toEqual([])
  })

  // The span of a `useEffect(…)` is found by counting parentheses. An unbalanced paren inside a
  // comment or a string would move the closing one and silently extend the span across the rest of
  // the file, reporting call sites nowhere near an effect.
  it('does not let a comment extend an effect past its close', () => {
    expect(scan([
      `useEffect(() => { setReady(true) }, []) // closes here :(`,
      `const onPick = (r) => savePreference('foodRegion', r)`,
    ].join('\n'))).toEqual([])
  })

  it('does not let a string literal extend an effect past its close', () => {
    expect(scan([
      `useEffect(() => { toast.error('lost (one') }, [])`,
      `const onPick = (r) => savePreference('foodRegion', r)`,
    ].join('\n'))).toEqual([])
  })

  it('reports the line in the ORIGINAL source, not the blanked copy', () => {
    const src = ['// a', '/* b', '   c */', `useEffect(() => { savePreference('x', v) }, [v])`].join('\n')
    expect(scan(src)[0].line).toBe(4)
  })

  it('finds every offending effect in one file', () => {
    expect(scan([
      `useEffect(() => { savePreference('a', x) }, [x])`,
      `useEffect(() => { savePreference('b', y) }, [y])`,
    ].join('\n'))).toHaveLength(2)
  })
})
