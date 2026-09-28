// Writes public/cats/<class>-<tier>.svg, <class>-<tier>-<shiny|skin>.svg and scene-<name>.svg
// from cat.mjs + gear.mjs + scenes.mjs.
//   node scripts/collection-art/build.mjs           write the files
//   node scripts/collection-art/build.mjs --check   exit 1 if the committed files are stale
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { cat, svg, FURS, SHINY, SKINS } from './cat.mjs'
import { GEAR } from './gear.mjs'
import { SCENES } from './scenes.mjs'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/cats')

const flat = s => s.replace(/\n\s*/g, '') + '\n'
// Three white glints mark a shiny even at widget size, where the recolour alone could read as a theme.
const glint = (x, y, r) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="#fff"/>`
const SPARKLES = glint(104, 44, 7) + glint(22, 58, 5) + glint(96, 104, 4)

export function renderAll() {
  const files = {}
  for (const [cls, p] of Object.entries(FURS)) {
    const shiny = { ...p, ...SHINY[cls] }
    GEAR[cls].forEach((gear, i) => {
      const delay = -((Object.keys(FURS).indexOf(cls) * 7 + i * 3) % 10) / 10
      files[`${cls}-${i + 1}.svg`] = flat(svg(cat(p, gear(p)), undefined, delay))
      const g = gear(shiny)
      files[`${cls}-${i + 1}-shiny.svg`] = flat(svg(cat(shiny, { ...g, gearFront: (g.gearFront ?? '') + SPARKLES }), undefined, delay - 0.5))
      for (const [skin, coat] of Object.entries(SKINS)) {
        const q = { ...p, ...coat }
        files[`${cls}-${i + 1}-${skin}.svg`] = flat(svg(cat(q, gear(q)), undefined, delay - 0.25))
      }
    })
  }
  for (const [name, body] of Object.entries(SCENES)) files[`scene-${name}.svg`] = flat(body)
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
