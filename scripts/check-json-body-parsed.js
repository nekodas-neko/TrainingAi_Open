#!/usr/bin/env node
/**
 * A route that reads a request body must PARSE that body.
 *
 * `readJsonLimited(req, max)` returns `{ ok: true, body }`, so the guard and the parse are two
 * separate steps and it is possible to write the first and forget the second. Five routes did:
 *
 *   let raw: unknown
 *   const read = await readJsonLimited(req, MAX_BODY_BYTES)
 *   if (!read.ok) { … }
 *   const parsed = Schema.safeParse(raw)   // ← `raw` was never assigned
 *
 * `raw` is `undefined`, every Zod object schema rejects it, and the route answers
 * `400 {"error":"Invalid input: expected object, received undefined"}` to every request — including
 * a perfectly valid one. TypeScript is happy (`unknown` is what `safeParse` takes) and no test
 * caught it, because the whole meal-plan write surface had no route-level test. Found 2026-08-24
 * when a PATCH from a new feature silently did nothing: creating a plan, renaming/activating/
 * deleting one, restructuring it, editing a meal, and saving dietary restrictions were all dead.
 *
 * The check is deliberately shallow — for each `const <name> = await readJsonLimited(…)` it asks
 * only that `<name>.body` appears somewhere in the file. That is enough to catch the whole class and
 * cannot be satisfied accidentally. It reads the binding's own name rather than assuming `read`,
 * because five healthy routes call the result `result`.
 */
const { readFileSync } = require('node:fs')
const { execSync } = require('node:child_process')

const files = execSync("grep -rl 'readJsonLimited' --include=route.ts app/api", { encoding: 'utf8' })
  .split('\n').filter(Boolean)

const BINDING = /const\s+(\w+)\s*=\s*await\s+readJsonLimited\s*\(/g

const offenders = []
let bindings = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const [, name] of src.matchAll(BINDING)) {
    bindings += 1
    if (!src.includes(`${name}.body`)) offenders.push(`${file} (${name})`)
  }
}

if (offenders.length > 0) {
  console.error('These routes guard a request body and then never parse it:\n')
  for (const o of offenders) console.error(`  ${o}`)
  console.error('\nParse the guard result\'s own `.body` — a leftover `raw` variable is `undefined`, so the route 400s on every request.')
  process.exit(1)
}
console.log(`Checked ${bindings} body reads across ${files.length} routes; all parse what they read.`)
