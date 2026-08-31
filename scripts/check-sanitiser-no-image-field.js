#!/usr/bin/env node
// BF-70. `sanitiseNutrition` spreads its input, so `RawNutrition` declaring `imageDataUri` was
// enough to make `create-food-item.ts`'s `imageDataUri: s.imageDataUri ?? null` TYPECHECK — while
// every caller builds that argument from numeric fields alone, so it resolved to `undefined` on
// every call. The barcode thumbnail was fetched, stored nowhere, and the line that dropped it read
// as the implementation. It survived because there is nothing wrong with it to see.
//
// A `@ts-expect-error` in a test cannot hold this: `tsconfig.json` excludes `**/__tests__/**`, so
// test files are not typechecked at all and such an assertion is inert.
//
// The picture belongs on `NutritionScanResult` and is passed explicitly to `createFoodItem`.
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const TARGETS = [
  {
    file: 'packages/shared/src/nutrition/scan-totals.ts',
    type: 'RawNutrition',
    field: 'imageDataUri',
    why: 'the nutrition sanitiser is numeric; an image on it makes a dead read compile',
  },
]

const failures = []

for (const t of TARGETS) {
  const abs = path.join(ROOT, t.file)
  if (!fs.existsSync(abs)) {
    failures.push(`${t.file} is gone — update or remove this check rather than letting it pass silently.`)
    continue
  }
  const src = fs.readFileSync(abs, 'utf8')
  const decl = new RegExp(`(export\\s+)?interface\\s+${t.type}\\s*\\{`)
  const m = decl.exec(src)
  if (!m) {
    failures.push(`${t.file} no longer declares \`${t.type}\` — update or remove this check.`)
    continue
  }
  // Walk braces from the declaration so a field in a LATER interface is not mistaken for this one.
  let depth = 0
  let end = -1
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  const body = src.slice(m.index, end === -1 ? src.length : end)
  // Comments name the field on purpose — strip them before looking for a declaration.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
  if (new RegExp(`\\b${t.field}\\s*\\??\\s*:`).test(code)) {
    failures.push(
      `${t.file}: \`${t.type}\` declares \`${t.field}\` — ${t.why}.\n` +
      `      Pass the image explicitly instead (see \`NewFoodItem.imageDataUri\`), or remove this\n` +
      `      check with a written reason if the contract genuinely changed.`)
  }
}

if (failures.length) {
  console.error('check-sanitiser-no-image-field FAILED\n')
  for (const f of failures) console.error(`  • ${f}\n`)
  process.exit(1)
}

console.log(`check-sanitiser-no-image-field: OK — ${TARGETS.length} sanitiser contract(s) carry no image field.`)
