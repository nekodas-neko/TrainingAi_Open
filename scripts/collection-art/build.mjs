// Writes public/cats/<class>-<tier>.svg from cat.mjs + gear.mjs.
//   node scripts/collection-art/build.mjs           write the files
//   node scripts/collection-art/build.mjs --check   exit 1 if the committed files are stale
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { cat, svg, FURS } from './cat.mjs'
import { GEAR } from './gear.mjs'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/cats')

export function renderAll() {
  const files = {}
  for (const [cls, p] of Object.entries(FURS)) {
    GEAR[cls].forEach((gear, i) => { files[`${cls}-${i + 1}.svg`] = svg(cat(p, gear(p))).replace(/\n\s*/g, '') + '\n' })
  }
  return files
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = renderAll()
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([f, body]) => !fs.existsSync(path.join(OUT, f)) || fs.readFileSync(path.join(OUT, f), 'utf8') !== body)
    if (stale.length) { console.error(`stale cat art: ${stale.map(([f]) => f).join(', ')} — run node scripts/collection-art/build.mjs`); process.exit(1) }
    console.log(`${Object.keys(files).length} cat sprites up to date`)
  } else {
    fs.mkdirSync(OUT, { recursive: true })
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), body)
    console.log(`wrote ${Object.keys(files).length} sprites to public/cats/`)
  }
}
