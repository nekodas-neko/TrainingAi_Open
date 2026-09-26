// A review gallery of every sprite, variant and scene, written to the OS temp directory (never the repo).
//   node scripts/collection-art/preview.mjs     then open the printed path in a browser
// The sprites animate in the gallery exactly as they do in the app, because the motion lives in each SVG.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { FURS } from './cat.mjs'
import { SCENES } from './scenes.mjs'

const CATS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/cats')
const src = f => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(CATS, f)).toString('base64')
const variants = ['', 'shiny', 'frost', 'ember']

const classes = Object.entries(FURS).map(([cls, p]) => `<section><h2>${p.label}</h2>${variants.map(v =>
  `<div class="row"><span class="tag">${v || 'base'}</span>${[1, 2, 3, 4, 5, 6].map(t =>
    `<figure><img src="${src(`${cls}-${t}${v ? '-' + v : ''}.svg`)}" width="96" height="96"><figcaption>T${t}</figcaption></figure>`).join('')}</div>`).join('')}</section>`).join('')

const scenes = Object.keys(SCENES).map(s =>
  `<figure class="scene"><div style="background-image:url(${src(`scene-${s}.svg`)})"><img src="${src('tank-2.svg')}" width="44"><img src="${src('mage-3.svg')}" width="52"><img src="${src('ranger-5.svg')}" width="64"></div><figcaption>${s}</figcaption></figure>`).join('')

const out = path.join(os.tmpdir(), 'cat-collection-gallery.html')
fs.writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Cat collection gallery</title><style>
body{background:#0b0a10;color:#cfd0da;font:13px system-ui;margin:16px}h1{font-size:18px}h2{font-size:14px;margin:4px 0}
section{background:#17151f;border:1px solid #2a2735;border-radius:12px;padding:8px 12px;margin-bottom:10px}
.row{display:flex;align-items:center;gap:4px}.tag{width:48px;opacity:.6;font-size:11px}figure{margin:0;text-align:center}figcaption{opacity:.55;font-size:11px}
.scenes{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.scene div{height:140px;border-radius:12px;background-size:cover;background-position:bottom;display:flex;align-items:flex-end;justify-content:space-around;padding-bottom:10px}
</style><h1>Cat collection — every sprite, variant and scene</h1>${classes}<h2>Scenes</h2><div class="scenes">${scenes}</div>`)
console.log(out)
