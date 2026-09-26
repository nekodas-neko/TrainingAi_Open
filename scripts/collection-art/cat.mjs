// BF-126 — the cat collection's drawn art. The one cat every sprite is built on.
//
// Flat vector: bold ink outline, a flat fur fill plus one shade and one light tone, 128x128 viewBox.
// Class identity rides on fur, eye colour and headgear, so it survives at widget size, where the
// finer gear in gear.mjs stops resolving. Run build.mjs after any edit; the committed SVGs in
// public/cats/ are its output and a test fails if they drift.
export const INK = '#2b2530'
export const FURS = {
  tank:   { label: 'Tank · workouts',   fur: '#6f7079', shade: '#5a5b64', light: '#9a9ba3', eye: '#f2a52b', C: '#e04848', D: '#a32f35' },
  ranger: { label: 'Ranger · steps',    fur: '#e3914a', shade: '#c26f2c', light: '#f8e3c8', eye: '#7ccf5a', C: '#4f9d4c', D: '#2f6b33' },
  rogue:  { label: 'Rogue · cardio',    fur: '#4a4558', shade: '#35313f', light: '#76708c', eye: '#f5d547', C: '#8d55e0', D: '#5a3399' },
  cleric: { label: 'Cleric · tracking', fur: '#f3f0ec', shade: '#d9d3cc', light: '#ffffff', eye: '#6ab8f0', C: '#f2c14e', D: '#c28f2a' },
}
// The rare "shiny" recolour of each class: same cat, same gear, different coat and accent.
export const SHINY = {
  tank:   { fur: '#e8c36a', shade: '#c49a3e', light: '#fff1c9', eye: '#5ad1ff', C: '#3a7bd5', D: '#24508f' },
  ranger: { fur: '#dfe6f0', shade: '#b7c2d3', light: '#ffffff', eye: '#ff8fc8', C: '#3fb8c9', D: '#23707d' },
  rogue:  { fur: '#35568c', shade: '#253e66', light: '#6688bf', eye: '#7fffd4', C: '#2fd1c1', D: '#1a7f76' },
  cleric: { fur: '#f6c9dc', shade: '#e0a6c0', light: '#fff0f6', eye: '#b388ff', C: '#bfefff', D: '#7fbad0' },
}
const o = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`

const defaultEyes = p => `<g class="eyes">
  <g ${o}>
    <ellipse cx="50" cy="57" rx="9" ry="9.5" fill="${p.eye}"/>
    <ellipse cx="78" cy="57" rx="9" ry="9.5" fill="${p.eye}"/>
  </g>
  <ellipse cx="50" cy="58" rx="3" ry="6.5" fill="${INK}"/>
  <ellipse cx="78" cy="58" rx="3" ry="6.5" fill="${INK}"/>
  <circle cx="53" cy="53.5" r="2.4" fill="#fff"/><circle cx="81" cy="53.5" r="2.4" fill="#fff"/>
  <circle cx="47.5" cy="61" r="1.1" fill="#fff" opacity=".8"/><circle cx="75.5" cy="61" r="1.1" fill="#fff" opacity=".8"/></g>`

export function cat(p, { gearBack = '', gearFront = '', gearHead = '' } = {}) {
  return `
  ${gearBack}
  <g class="tail">
  <path d="M86 113 C108 116 118 98 110 84 C107 79 101 80 102 86" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
  <path d="M86 113 C108 116 118 98 110 84 C107 79 101 80 102 86" fill="none" stroke="${p.fur}" stroke-width="8" stroke-linecap="round"/>
  </g>
  <path d="M42 74 C31 90 30 110 38 118 L90 118 C98 110 97 90 86 74 Z" fill="${p.fur}" ${o}/>
  <path d="M52 78 C49 92 55 104 64 106 C73 104 79 92 76 78 Z" fill="${p.light}"/>
  <path d="M42 100 C44 108 46 113 50 116" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M86 100 C84 108 82 113 78 116" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
  <g class="pl"><ellipse cx="54" cy="117" rx="9" ry="6" fill="${p.light}" ${o}/><path d="M51 115 v4 M57 115 v4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/></g>
  <g class="pr"><ellipse cx="74" cy="117" rx="9" ry="6" fill="${p.light}" ${o}/><path d="M71 115 v4 M77 115 v4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/></g>
  <g ${o}>
    <path d="M33 48 L35 14 L60 31 Z" fill="${p.fur}"/><path d="M95 48 L93 14 L68 31 Z" fill="${p.fur}"/>
  </g>
  <path d="M39 40 L40 23 L53 32 Z" fill="#f2a3b3"/><path d="M89 40 L88 23 L75 32 Z" fill="#f2a3b3"/>
  <path d="M29 60 C27 38 43 26 64 26 C85 26 101 38 99 60 C99 66 96 71 92 74 L96 78 L86 78 C80 82 72 83 64 83 C56 83 48 82 42 78 L32 78 L36 74 C32 71 29 66 29 60 Z" fill="${p.fur}" ${o}/>
  <path d="M58 30 l1.5 9 M64 29 v10 M70 30 l-1.5 9" stroke="${p.shade}" stroke-width="3" stroke-linecap="round"/>
  ${defaultEyes(p)}
  <ellipse cx="40" cy="69" rx="5.5" ry="3.2" fill="#f2a3b3" opacity=".55"/>
  <ellipse cx="88" cy="69" rx="5.5" ry="3.2" fill="#f2a3b3" opacity=".55"/>
  <path d="M60.5 65.5 h7 l-3.5 4.5 Z" fill="#e8798f" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M64 70 q0 4 -4.5 4.5 M64 70 q0 4 4.5 4.5" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  <g stroke="#e9e4df" stroke-width="1.4" stroke-linecap="round" opacity=".9">
    <path d="M55 68 L37 65 M55 71 L38 73 M73 68 L91 65 M73 71 L90 73"/>
  </g>
  ${gearHead}
  ${gearFront}`
}

// A faint light rim, so the dark outline still separates from the dark card (a sticker edge).
const RIM = `<defs><filter id="cat-rim" x="-8%" y="-8%" width="116%" height="116%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="d"/><feFlood flood-color="#b9b2c8" flood-opacity=".2"/><feComposite in2="d" operator="in" result="r"/><feMerge><feMergeNode in="r"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`
const MOTION = `<style>
.bod{transform-origin:64px 122px;animation:bob 1.8s step-end infinite;animation-delay:var(--d)}
@keyframes bob{0%{transform:none}50%{transform:scaleY(.975)}}
.tail{transform-origin:88px 113px;animation:tail 1.8s step-end infinite;animation-delay:var(--d)}
@keyframes tail{0%{transform:rotate(-8deg)}33%{transform:rotate(2deg)}66%{transform:rotate(11deg)}}
.pl,.pr{animation:paw .9s step-end infinite}
.pr{animation-delay:-.45s}
@keyframes paw{0%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.eyes{transform-origin:64px 58px;animation:blink 4.3s step-end infinite;animation-delay:var(--d)}
@keyframes blink{0%{transform:none}93%{transform:scaleY(.12)}97%{transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`
/** `delay` desyncs the loops between sprites, so a pen of cats does not swish in unison. */
export const svg = (inner, px, delay = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"${px ? ` width="${px}" height="${px}"` : ''} style="--d:${delay}s">${RIM}${MOTION}<g filter="url(#cat-rim)"><g class="bod">${inner}</g></g></svg>`

// ---- Tier-1 class headgear ----
export const T1 = {
  tank: p => ({ gearHead: `
    <path d="M40 37 C40 16 88 16 88 37 Z" fill="#d7dce5" ${o}/>
    <path d="M46 30 C48 23 56 20 62 20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>
    <rect x="36" y="34" width="56" height="8" rx="3" fill="#9aa2b2" ${o}/>
    <path d="M61 41 h6 v7 q-3 3 -6 0 Z" fill="#9aa2b2" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M64 19 C62 9 70 3 78 5 C72 7 70 13 70 19 Z" fill="${p.C}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` }),
  ranger: p => ({ gearHead: `
    <path d="M26 66 C22 34 40 16 64 16 C88 16 106 34 102 66 L95 64 C97 42 85 33 64 33 C43 33 31 42 33 64 Z" fill="${p.C}" ${o}/>
    <path d="M36 30 L30 8 L52 20 Z M92 30 L98 8 L76 20 Z" fill="${p.C}" ${o}/>
    <path d="M40 27 C48 21 56 20 62 20" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".35"/>
    <path d="M64 17 C70 10 80 10 84 14 C78 14 72 16 66 22 Z" fill="#8ccf5e" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` }),
  rogue: p => ({ gearHead: `
    <path d="M33 50 C44 46 84 46 95 50 L96 62 C84 66 44 66 32 62 Z" fill="${p.C}" ${o}/>
    <path d="M95 52 C104 50 110 54 114 50 C112 58 104 60 96 60 Z" fill="${p.D}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <g stroke="${INK}" stroke-width="3"><ellipse cx="50" cy="57" rx="8.5" ry="8" fill="${p.eye}"/><ellipse cx="78" cy="57" rx="8.5" ry="8" fill="${p.eye}"/></g>
    <ellipse cx="50" cy="58" rx="2.6" ry="5.5" fill="${INK}"/><ellipse cx="78" cy="58" rx="2.6" ry="5.5" fill="${INK}"/>
    <circle cx="52.5" cy="54" r="2" fill="#fff"/><circle cx="80.5" cy="54" r="2" fill="#fff"/>` }),
  cleric: p => ({ gearHead: `
    <ellipse cx="64" cy="14" rx="22" ry="6.5" fill="none" stroke="${INK}" stroke-width="9"/>
    <ellipse cx="64" cy="14" rx="22" ry="6.5" fill="none" stroke="${p.C}" stroke-width="4"/>
    <path d="M50 11 C56 9 62 8.5 66 8.6" fill="none" stroke="#fff6cf" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="64" cy="38" r="4" fill="${p.C}" stroke="${INK}" stroke-width="2.5"/>` }),
}
