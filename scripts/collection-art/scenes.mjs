// Backdrops for the collection pen. Wide (360x150), drawn dark so the cats stay the brightest thing
// on the card, and anchored to the bottom so any card width crops the sky, never the floor.
// Titles are meant to unlock them (PS-51); until then the pen uses `meadow`.

const W = 360, H = 150
const wrap = (id, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">${inner}</svg>`
const sky = (id, top, bottom) =>
  `<defs><linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sky-${id})"/>`
const stars = pts => pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#dfe6ff" opacity=".7"/>`).join('')
const STARS = stars([[22, 14, 1.2], [70, 30, .9], [118, 10, 1.1], [168, 26, .8], [214, 12, 1.3], [262, 34, .9], [300, 16, 1], [340, 28, 1.2], [44, 44, .7], [236, 48, .7]])

const meadow = wrap('meadow', `${sky('meadow', '#16203a', '#2a3a5c')}${STARS}
  <circle cx="300" cy="36" r="14" fill="#f3ecd2"/>
  <path d="M0 96 C60 78 120 82 180 94 C240 106 300 84 360 90 L360 150 L0 150 Z" fill="#26402f"/>
  <path d="M0 112 C70 100 150 104 210 112 C270 120 320 106 360 110 L360 150 L0 150 Z" fill="#2f4d38"/>
  <path d="M0 128 C90 120 200 124 360 126 L360 150 L0 150 Z" fill="#355640"/>
  ${[[30, 120], [96, 116], [150, 124], [214, 118], [270, 126], [330, 118]].map(([x, y]) => `<path d="M${x} ${y} l-3 -7 M${x} ${y} l0 -8 M${x} ${y} l3 -7" stroke="#4d7a52" stroke-width="2" stroke-linecap="round"/>`).join('')}
  ${[[60, 124, '#f2a3b3'], [182, 128, '#f2c14e'], [246, 122, '#bfefff'], [312, 130, '#f2a3b3']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${c}"/>`).join('')}`)

const pine = (x, base, h, c) => `<path d="M${x} ${base - h} L${x - h * .32} ${base} L${x + h * .32} ${base} Z" fill="${c}"/>`
const forest = wrap('forest', `${sky('forest', '#101d20', '#1d3230')}${stars([[40, 12, 1], [150, 20, .9], [250, 10, 1.1], [330, 22, .8]])}
  ${[20, 62, 104, 146, 188, 230, 272, 314, 356].map((x, i) => pine(x, 112, 70 + (i % 3) * 12, '#1a3028')).join('')}
  ${[0, 48, 96, 150, 204, 252, 306, 354].map((x, i) => pine(x, 132, 84 + (i % 2) * 14, '#22402f')).join('')}
  <path d="M0 126 C120 118 240 122 360 120 L360 150 L0 150 Z" fill="#2a3f2c"/>
  ${[[70, 96], [132, 74], [196, 102], [258, 80], [318, 98], [30, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#f5e27a" opacity=".25"/><circle cx="${x}" cy="${y}" r="1.4" fill="#f5e27a"/>`).join('')}`)

const house = wrap('house', `<rect width="${W}" height="${H}" fill="#2e2533"/>
  ${Array.from({ length: 18 }, (_, i) => `<rect x="${i * 20 + 8}" y="0" width="4" height="104" fill="#352b3b"/>`).join('')}
  <rect x="134" y="16" width="92" height="64" rx="4" fill="#1b2544" stroke="#6b4a36" stroke-width="6"/>
  <circle cx="200" cy="36" r="9" fill="#f3ecd2"/>${stars([[150, 30, .9], [170, 58, .8], [214, 64, .8]])}
  <path d="M180 16 V80 M134 48 H226" stroke="#6b4a36" stroke-width="4"/>
  <rect x="24" y="44" width="70" height="6" rx="2" fill="#6b4a36"/>
  <rect x="30" y="30" width="10" height="14" fill="#8d55e0"/><rect x="44" y="26" width="8" height="18" fill="#4f9d4c"/><rect x="56" y="32" width="12" height="12" fill="#e04848"/>
  <circle cx="310" cy="46" r="26" fill="#f2c14e" opacity=".12"/><path d="M300 60 L320 60 L314 40 L306 40 Z" fill="#f2c14e" opacity=".85"/><rect x="308" y="60" width="4" height="36" fill="#6b4a36"/>
  <rect x="0" y="104" width="${W}" height="46" fill="#4a3428"/>
  ${Array.from({ length: 9 }, (_, i) => `<path d="M${i * 44} 104 V150" stroke="#3b291f" stroke-width="2"/>`).join('')}
  <ellipse cx="180" cy="132" rx="118" ry="14" fill="#6e3446" opacity=".85"/><ellipse cx="180" cy="132" rx="100" ry="10" fill="none" stroke="#f2c14e" stroke-width="1.5" opacity=".5"/>`)

const castle = wrap('castle', `<rect width="${W}" height="${H}" fill="#2b2b38"/>
  ${Array.from({ length: 6 }, (_, r) => Array.from({ length: 10 }, (_, c) => `<rect x="${c * 40 + (r % 2) * 20 - 20}" y="${r * 18}" width="38" height="16" rx="2" fill="#34343f"/>`).join('')).join('')}
  ${[70, 290].map(x => `<path d="M${x - 16} 8 H${x + 16} V62 L${x} 52 L${x - 16} 62 Z" fill="#a32f35"/><path d="M${x} 20 L${x + 6} 30 L${x} 40 L${x - 6} 30 Z" fill="#f2c14e"/>`).join('')}
  ${[140, 220].map(x => `<circle cx="${x}" cy="44" r="22" fill="#f2a043" opacity=".13"/><path d="M${x - 4} 50 H${x + 4} L${x + 2} 64 H${x - 2} Z" fill="#6b4a36"/><path d="M${x} 32 C${x + 7} 40 ${x + 5} 48 ${x} 50 C${x - 5} 48 ${x - 7} 40 ${x} 32 Z" fill="#f2a043"/>`).join('')}
  <rect x="0" y="108" width="${W}" height="42" fill="#3d3d4a"/>
  ${Array.from({ length: 9 }, (_, i) => `<path d="M${i * 44 + 10} 108 L${i * 44 - 6} 150" stroke="#2f2f3a" stroke-width="2"/>`).join('')}
  <path d="M110 150 L140 110 H220 L250 150 Z" fill="#8f2a2a" opacity=".85"/>`)

export const SCENES = { meadow, forest, house, castle }
