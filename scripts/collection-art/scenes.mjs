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


const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('')

// Workouts' own backdrop: a gym at night, racks and plates.
const gym = wrap('gym', `<rect width="${W}" height="${H}" fill="#24262e"/>
  <rect x="0" y="0" width="${W}" height="14" fill="#1b1d23"/>${range(6, i => `<rect x="${i * 64 + 20}" y="2" width="30" height="6" rx="3" fill="#f3ecd2" opacity=".6"/>`)}
  <rect x="24" y="30" width="6" height="74" fill="#5b5f6e"/><rect x="96" y="30" width="6" height="74" fill="#5b5f6e"/><rect x="18" y="52" width="90" height="5" rx="2" fill="#9aa2b2"/>
  <rect x="10" y="44" width="10" height="22" rx="2" fill="#e04848"/><rect x="106" y="44" width="10" height="22" rx="2" fill="#e04848"/>
  <rect x="250" y="40" width="80" height="6" rx="3" fill="#6b4a36"/>${range(4, i => `<circle cx="${262 + i * 18}" cy="${60}" r="${9 - i}" fill="#3a3d48" stroke="#5b5f6e" stroke-width="3"/>`)}
  <rect x="150" y="24" width="60" height="40" rx="3" fill="#1b2544" stroke="#5b5f6e" stroke-width="4"/><path d="M160 54 L172 40 L182 48 L198 32" fill="none" stroke="#4cb85a" stroke-width="3"/>
  <rect x="0" y="104" width="${W}" height="46" fill="#2f3140"/>${range(8, i => `<rect x="${i * 46}" y="104" width="44" height="46" fill="#34364a" opacity="${i % 2 ? 1 : 0}"/>`)}`)

// Steps: a park path at dusk with lamp posts.
const park = wrap('park', `${sky('park', '#1d2140', '#3b3f66')}${STARS}
  ${range(5, i => `<circle cx="${i * 84 + 20}" cy="${80}" r="${26 + (i % 2) * 6}" fill="#243c30"/>`)}
  <path d="M0 100 H${W} V150 H0 Z" fill="#2c4a36"/>
  <path d="M0 132 C90 118 270 118 360 132 L360 150 L0 150 Z" fill="#8b7a62"/>
  ${[60, 300].map(x => `<rect x="${x - 2}" y="56" width="4" height="54" fill="#3b3f4a"/><circle cx="${x}" cy="54" r="14" fill="#f2c14e" opacity=".18"/><circle cx="${x}" cy="54" r="5" fill="#f5e27a"/>`).join('')}
  <rect x="160" y="100" width="44" height="6" rx="2" fill="#6b4a36"/><rect x="164" y="106" width="4" height="10" fill="#4a3428"/><rect x="196" y="106" width="4" height="10" fill="#4a3428"/>`)

// Sleep: a moonlit bedroom.
const bedroom = wrap('bedroom', `<rect width="${W}" height="${H}" fill="#232643"/>
  <rect x="40" y="18" width="70" height="56" rx="4" fill="#141a33" stroke="#4a4f7a" stroke-width="5"/><circle cx="90" cy="36" r="10" fill="#f3ecd2"/>${stars([[56, 30, .9], [70, 56, .8], [98, 62, .8]])}
  <path d="M40 18 C52 40 52 60 44 78 M110 18 C98 40 98 60 106 78" fill="none" stroke="#6d5ae0" stroke-width="6" opacity=".7"/>
  <rect x="200" y="62" width="130" height="36" rx="8" fill="#3b3f73"/><rect x="200" y="54" width="36" height="22" rx="8" fill="#e9e4f5"/><rect x="232" y="68" width="98" height="30" rx="6" fill="#6d5ae0"/>
  ${range(4, i => `<circle cx="${250 + i * 22}" cy="80" r="3" fill="#f2c14e" opacity=".7"/>`)}
  <rect x="0" y="104" width="${W}" height="46" fill="#2e2a4a"/><ellipse cx="150" cy="130" rx="90" ry="12" fill="#4b5fc9" opacity=".45"/>`)

// Nutrition: a warm kitchen.
const kitchen = wrap('kitchen', `<rect width="${W}" height="${H}" fill="#3a2e2a"/>
  ${range(10, r => range(20, c => `<rect x="${c * 18 + (r % 2) * 9}" y="${r * 9 + 20}" width="16" height="7" fill="#43352f"/>`))}
  <rect x="20" y="16" width="120" height="30" rx="3" fill="#6b4a36"/>${range(5, i => `<rect x="${30 + i * 22}" y="22" width="14" height="18" rx="3" fill="${['#e04848', '#4f9d4c', '#f2c14e', '#8d55e0', '#3aa37a'][i]}"/>`)}
  <rect x="210" y="30" width="110" height="44" rx="4" fill="#1b2544" stroke="#6b4a36" stroke-width="5"/><circle cx="290" cy="46" r="8" fill="#f3ecd2"/>
  <rect x="0" y="88" width="${W}" height="16" fill="#8a6848"/><rect x="0" y="86" width="${W}" height="4" fill="#a8845c"/>
  <ellipse cx="80" cy="84" rx="20" ry="5" fill="#e9e4df"/><path d="M68 84 C70 72 90 72 92 84 Z" fill="#f2a043"/>
  <rect x="0" y="104" width="${W}" height="46" fill="#4a3428"/>${range(12, i => `<rect x="${i * 30}" y="104" width="30" height="46" fill="#5a4032" opacity="${i % 2 ? 1 : 0}"/>`)}`)

// Beach at sunset.
const beach = wrap('beach', `${sky('beach', '#2a2350', '#b0566a')}
  <circle cx="180" cy="86" r="26" fill="#f7b267" opacity=".9"/>
  <rect x="0" y="86" width="${W}" height="26" fill="#2e4f7a"/>${range(6, i => `<path d="M${i * 64} 96 q16 -4 32 0" stroke="#bfe3ff" stroke-width="2" fill="none" opacity=".5"/>`)}
  <path d="M0 108 C120 100 240 104 360 100 L360 150 L0 150 Z" fill="#d9b98a"/>
  <path d="M40 112 C44 84 52 70 62 62" stroke="#6b4a36" stroke-width="5" fill="none"/>${range(4, i => `<path d="M62 62 q${[-24, -12, 14, 24][i]} ${[4, -10, -10, 4][i]} ${[-34, -20, 20, 34][i]} ${[16, 6, 6, 16][i]}" stroke="#3aa37a" stroke-width="5" fill="none" stroke-linecap="round"/>`)}
  <path d="M290 120 l8 -4 l8 4 l-8 4 Z" fill="#f2a3b3"/>`)

// Snowfield at night.
const snow = wrap('snow', `${sky('snow', '#141b33', '#2a3a5c')}${STARS}
  <path d="M0 96 L60 50 L110 90 L170 40 L240 92 L300 56 L360 90 L360 150 L0 150 Z" fill="#46587e"/>
  <path d="M60 50 L74 62 L48 60 Z M170 40 L186 54 L156 52 Z M300 56 L314 68 L288 66 Z" fill="#e8f1ff"/>
  <path d="M0 112 C100 104 260 108 360 110 L360 150 L0 150 Z" fill="#dfe9f5"/>
  ${range(24, i => `<circle cx="${(i * 53) % 360}" cy="${(i * 37) % 100 + 6}" r="${1 + (i % 3) * .5}" fill="#fff" opacity=".8"/>`)}`)

// Space: for the rarest achievements.
const space = wrap('space', `<rect width="${W}" height="${H}" fill="#0b0a1c"/>
  <ellipse cx="120" cy="50" rx="140" ry="40" fill="#6d5ae0" opacity=".18"/><ellipse cx="260" cy="70" rx="120" ry="30" fill="#e04890" opacity=".12"/>
  ${range(40, i => `<circle cx="${(i * 71) % 360}" cy="${(i * 43) % 110}" r="${.6 + (i % 4) * .4}" fill="#fff" opacity="${.4 + (i % 3) * .2}"/>`)}
  <circle cx="300" cy="34" r="16" fill="#f2a043"/><ellipse cx="300" cy="34" rx="28" ry="6" fill="none" stroke="#f3ecd2" stroke-width="2.5" opacity=".7"/>
  <path d="M0 114 C80 104 280 104 360 114 L360 150 L0 150 Z" fill="#8a8aa0"/>${range(6, i => `<ellipse cx="${30 + i * 60}" cy="${126 + (i % 2) * 8}" rx="${10 + (i % 3) * 4}" ry="4" fill="#6f6f86"/>`)}`)

// Cherry-blossom garden.
const sakura = wrap('sakura', `${sky('sakura', '#241c3a', '#4a3558')}${stars([[40, 14, 1], [200, 20, .9], [330, 12, 1]])}
  <path d="M70 108 C66 80 74 60 90 48 M90 48 C100 40 118 38 128 44 M84 62 C70 58 58 60 50 66" stroke="#4a3428" stroke-width="6" fill="none" stroke-linecap="round"/>
  ${range(9, i => `<circle cx="${[80, 100, 120, 60, 50, 110, 136, 92, 70][i]}" cy="${[40, 32, 40, 58, 70, 52, 48, 58, 46][i]}" r="${14 - (i % 3) * 2}" fill="#f7a8c8" opacity=".85"/>`)}
  <path d="M250 70 H330 M256 70 V108 M324 70 V108 M246 64 H334" stroke="#a32f35" stroke-width="6" stroke-linecap="round"/>
  <path d="M0 106 C120 100 240 102 360 104 L360 150 L0 150 Z" fill="#2f4a3a"/>
  ${range(14, i => `<ellipse cx="${(i * 29) % 360}" cy="${112 + (i % 4) * 8}" rx="3" ry="1.8" fill="#f7a8c8" opacity=".8"/>`)}`)

export const SCENES = { meadow, forest, house, castle, gym, park, bedroom, kitchen, beach, snow, space, sakura }
