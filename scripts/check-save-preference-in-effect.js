#!/usr/bin/env node
/**
 * `savePreference` must not be called from a `useEffect`.
 *
 * The footgun is that the call site does not look like a network call.
 * `useEffect(() => localStorage.setItem(K, v), [v])` is a free write, and the same line calling
 * `savePreference` is a **PATCH on every mount**. One such site — a card mirroring its view mode —
 * left that PATCH and a `GET` behind it **pending past sixty seconds** inside Health's launch
 * burst, and failed nine e2e specs, none of which mentions preferences. The screen a failure like
 * that names is never the screen that caused it, which is what makes the rule worth enforcing
 * rather than remembering.
 *
 * `usePersistedPreference` (`lib/user/preferences-sync.ts`) is the shape a mirror wants: it writes
 * locally on the first settled value and PATCHes only on a genuine change. **Its guard compares the
 * VALUE, not a run count** — StrictMode invokes an effect twice on mount, so a `firstRun` ref is
 * already spent by the second invocation.
 *
 * **Deliberately narrow.** This is about one helper whose cost is invisible in its name, not about
 * fetching in effects, which is most of this codebase.
 *
 * **The entry that asked for this said there were no call sites to exempt. There are two**, and
 * both are listed below with the reason. That is worth knowing before writing the next rule from a
 * grep: the grep behind that claim was for `savePreference` on the same line as `useEffect`, which
 * is a shape nobody writes.
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { findSavePreferenceInEffects } = require('./lib/save-preference-in-effect.js')

const root = path.join(__dirname, '..')
const DIRS = ['app', 'components', 'lib']

/**
 * Sites where the call is inside an effect and is correct anyway. Keyed by `file:line` so a moved
 * or newly added call in the same file is still caught.
 *
 * An exemption is not a debt row — it is a statement that the rule's shape and this site's shape
 * happen to coincide. Adding one means writing why here, in the diff.
 */
const EXEMPT = new Map([
  [
    'lib/user/preferences-sync.ts',
    'This IS `usePersistedPreference`, the sanctioned wrapper — the effect is the mechanism, and ' +
    'its value-comparing guard is what makes the PATCH conditional rather than per-mount.',
  ],
  [
    'app/session-select/session-select-content.tsx',
    'Home reconciling `homeSectionOrder` after a card widget is toggled in Profile. It returns ' +
    'early unless the order genuinely changed, so it is not the per-mount PATCH this rule is ' +
    'about; the write is the point of the effect rather than a mirror of state. (It can still ' +
    'write during the window before hydration settles — that is LB-29, and is not this rule.)',
  ],
])

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const sources = DIRS.filter(d => fs.existsSync(path.join(root, d)))
  .flatMap(d => walk(path.join(root, d), []))
  .map(abs => ({ file: path.relative(root, abs).replace(/\\/g, '/'), src: fs.readFileSync(abs, 'utf8') }))

const found = findSavePreferenceInEffects(sources)
const offenders = found.filter(o => !EXEMPT.has(o.file))
const covered = new Set(found.filter(o => EXEMPT.has(o.file)).map(o => o.file))

for (const file of EXEMPT.keys()) {
  if (!covered.has(file)) {
    offenders.push({ file, line: 0, helper: null, stale: true })
  }
}

if (offenders.length) {
  console.error('check-save-preference-in-effect: FAILED\n')
  for (const o of offenders) {
    if (o.stale) {
      console.error(`  ${o.file}: exempted here but no longer calls savePreference in an effect — delete its row.`)
      continue
    }
    console.error(`  ${o.file}:${o.line} — ${o.helper}() inside a useEffect.`)
  }
  console.error(`
A PATCH on every mount is what this looks like at runtime, and it does not fail on the screen that
causes it. Mirroring a state value into a preference? Use \`usePersistedPreference\` from
\`lib/user/preferences-sync.ts\`. Writing because the user did something? Call it from the handler,
not from an effect that reacts to the handler's state change. If the effect really is the right
place, add the file to EXEMPT above with the reason.`)
  process.exit(1)
}

console.log(`check-save-preference-in-effect: OK — ${sources.length} files scanned, ${EXEMPT.size} exempt sites accounted for.`)
