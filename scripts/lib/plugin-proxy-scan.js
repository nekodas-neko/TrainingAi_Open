/**
 * The pure half of `check-plugin-proxy-thenable.js`: given file sources, which async functions
 * resolve to a Capacitor `registerPlugin()` proxy.
 *
 * Separated so the rule can be tested against fixtures rather than only against whatever the tree
 * happens to contain — the same reason `scripts/lib/reference.js` exists. A check whose only
 * evidence is "it passes today" cannot show that it would have caught the bug it was written for.
 */

/**
 * Bindings that come from a Capacitor package and are NOT registerPlugin proxies.
 *
 * This list is the rule's precision: `lib/colmi-ble/ble.ts` and `lib/live-hr/chest-strap-source.ts`
 * both `return BleClient` from an async function and are correct, because
 * `@capacitor-community/bluetooth-le` exports `new BleClientClass()` — a plain instance whose
 * `.then` is undefined. A rule that banned "returning a plugin" would flag two working call sites.
 */
const NOT_A_PROXY = new Map([
  ['BleClient', '@capacitor-community/bluetooth-le exports `new BleClientClass()` — a plain instance, not a proxy'],
  ['Capacitor', 'the platform helper object, not a plugin'],
])

/**
 * @param {{file: string, src: string}[]} sources
 * @returns {{file: string, line: number, name: string, pkg: string}[]}
 */
function findProxyReturns(sources) {
  const offenders = []
  for (const { file, src } of sources) {
    /** name -> the @capacitor package it was destructured from */
    const bound = new Map()
    for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=\s*await import\('(@capacitor[^']+)'\)/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(':').pop().trim()
        if (name) bound.set(name, m[2])
      }
    }
    if (bound.size === 0) continue
    for (const m of src.matchAll(/\n[ \t]*return[ \t]+([A-Za-z_$][\w$]*)[ \t]*\n/g)) {
      const name = m[1]
      if (!bound.has(name) || NOT_A_PROXY.has(name)) continue
      // +1 skips the leading \n the pattern anchors on, so the line reported is the RETURN
      // rather than the line above it. A check that points one line off sends the reader to
      // the import, which is not where the fix goes.
      offenders.push({ file, line: src.slice(0, m.index + 1).split('\n').length, name, pkg: bound.get(name) })
    }
  }
  return offenders
}

module.exports = { findProxyReturns, NOT_A_PROXY }
