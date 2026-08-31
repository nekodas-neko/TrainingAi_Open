/**
 * The pure half of `check-save-preference-in-effect.js`: given file sources, which `useEffect`
 * bodies call `savePreference`/`savePreferences`.
 *
 * Separated so the rule can be driven against fixtures rather than only against whatever the tree
 * happens to contain — the same reason `scripts/lib/plugin-proxy-scan.js` exists. A check whose
 * only evidence is "it passes today" cannot show it would have caught the defect it was written
 * for, and this one was written for a defect that has already been fixed.
 */

const HELPERS = /\bsavePreferences?\s*\(/

/**
 * Blank out comments and string/template literals, preserving every character position.
 *
 * The span of a `useEffect(…)` is found by counting parentheses, and an apostrophe in a comment or
 * a `(` inside a string would otherwise move the closing paren — silently extending the span into
 * the rest of the file, which is how a scanner of this shape reports offenders that are nowhere
 * near an effect. Positions are preserved so reported line numbers stay true to the original.
 *
 * @param {string} src
 * @returns {string}
 */
function blankNonCode(src) {
  const out = src.split('')
  let i = 0
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      blank(i, stop)
      i = stop
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      blank(i, stop)
      i = stop
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const quote = src[i]
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === quote) break
        j++
      }
      blank(i + 1, j)
      i = j + 1
    } else {
      i++
    }
  }
  return out.join('')
}

/**
 * Every `useEffect(` call's full span, closing paren included.
 *
 * The whole call is taken rather than only a braced body, because a concise effect —
 * `useEffect(() => savePreference('x', v), [v])` — has no body braces at all and is the same
 * defect. Taking the call also sweeps the dependency array, which cannot contain a call to these
 * helpers in any code that compiles.
 *
 * @param {string} code source with comments and literals already blanked
 * @returns {{start: number, end: number}[]}
 */
function effectSpans(code) {
  const spans = []
  for (const m of code.matchAll(/\buseEffect\s*\(/g)) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let j = open
    for (; j < code.length; j++) {
      if (code[j] === '(') depth++
      else if (code[j] === ')' && --depth === 0) break
    }
    if (j < code.length) spans.push({ start: open, end: j })
  }
  return spans
}

/**
 * @param {{file: string, src: string}[]} sources
 * @returns {{file: string, line: number, helper: string}[]}
 */
function findSavePreferenceInEffects(sources) {
  const offenders = []
  for (const { file, src } of sources) {
    if (!HELPERS.test(src) || !src.includes('useEffect')) continue
    const code = blankNonCode(src)
    for (const { start, end } of effectSpans(code)) {
      for (const hit of code.slice(start, end).matchAll(/\bsavePreferences?\s*\(/g)) {
        const at = start + hit.index
        offenders.push({
          file,
          line: code.slice(0, at).split('\n').length,
          helper: hit[0].replace(/\s*\($/, ''),
        })
      }
    }
  }
  return offenders
}

module.exports = { findSavePreferenceInEffects, blankNonCode, effectSpans }
