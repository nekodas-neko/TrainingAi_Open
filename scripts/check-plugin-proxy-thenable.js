#!/usr/bin/env node
/**
 * An async function must never resolve to a Capacitor `registerPlugin()` proxy.
 *
 * That proxy's `get` trap (node_modules/@capacitor/core) special-cases only `$$typeof`, `toJSON`,
 * `addListener` and `removeListener`; every other key — **`then` included** — returns a callable
 * wrapper. So resolving a promise with the proxy makes the promise-resolution algorithm read
 * `.then`, find a function, treat the proxy as a thenable and call it across the bridge.
 *
 * **The result is a HANG, not a rejection.** Capacitor's wrapper ignores the `resolve`/`reject` it
 * was handed and returns a rejected promise instead, so the outer promise never settles and the
 * bridge error — `"<Plugin>.then()" is not implemented on <platform>` — escapes as an unhandled
 * rejection. The enclosing `try/catch` cannot see it either way: the body has already returned.
 * `lib/__tests__/capacitor-plugin-thenable.test.ts` pins both halves.
 *
 * `lib/oura-ble/plugin.ts` has documented this since it was written, and all four locally-registered
 * plugins return `{ plugin }` because of it. It did not protect
 * `components/workout/voice-log-button.tsx`, which imports its plugin from a **community package**
 * rather than calling `registerPlugin` itself — so a grep for `registerPlugin` never reached it, and
 * voice logging was dead on the APK until production `error_events` reported the fault verbatim.
 *
 * The hazard is returning a PROXY, not returning a plugin: `@capacitor-community/bluetooth-le`
 * exports `BleClient = new BleClientClass()`, a plain instance whose `.then` is undefined, so
 * `lib/colmi-ble/ble.ts` and `lib/live-hr/chest-strap-source.ts` return it safely and are listed
 * below with that reason.
 */
const { readFileSync, readdirSync } = require('fs')
const path = require('path')
const { findProxyReturns } = require('./lib/plugin-proxy-scan.js')
const { toPosix } = require('./lib/repo-path')

// DV-1: this was a `grep -rl … | grep -v …` shell pipeline, which **cannot run on Windows at all**
// — under `cmd.exe` it dies with "The system cannot find the path specified." The Device
// Verification agent runs on Windows next to the phone, so the one rule here that needed a real
// shell was the one rule it could never execute. A Node walk has no such dependency and is no
// slower at this size: four roots, `.ts`/`.tsx` only.
const ROOTS = ['app', 'components', 'lib', 'packages']
const NEEDLE = "import('@capacitor"

function collect(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out // a root that does not exist is not a failure — `grep` treated it the same way
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue
      collect(full, out)
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
      // The path is a KEY here: it is printed for a human to open, so it must read the way the
      // repo writes one rather than the way this platform joins one.
      if (readFileSync(full, 'utf8').includes(NEEDLE)) out.push(toPosix(full))
    }
  }
  return out
}

const files = ROOTS.reduce((out, r) => collect(r, out), [])

const offenders = findProxyReturns(files.map((file) => ({ file, src: readFileSync(file, 'utf8') })))

if (offenders.length > 0) {
  console.error('An async function returns a Capacitor plugin proxy directly:\n')
  for (const o of offenders) console.error(`  • ${o.file}:${o.line}  return ${o.name}   (from ${o.pkg})`)
  console.error(
    '\nThe proxy answers EVERY property access — `then` included — with a callable, so resolving a' +
    '\npromise with it invokes `plugin.then(...)` across the bridge. The promise then NEVER SETTLES' +
    '\n(Capacitor returns a rejected promise rather than calling the resolve/reject it was handed),' +
    '\nand "<Plugin>.then() is not implemented on android" escapes as an unhandled rejection.' +
    '\nIt only fails on a real device, and the function\'s own try/catch cannot catch it.' +
    '\n\nWrap it: `return { plugin: X }`, as lib/oura-ble/plugin.ts does and explains. If the binding' +
    '\nis not actually a registerPlugin proxy, add it to NOT_A_PROXY in this script with the reason.',
  )
  process.exit(1)
}
console.log(`check-plugin-proxy-thenable: OK — ${files.length} files with a Capacitor dynamic import, none returns a proxy.`)
