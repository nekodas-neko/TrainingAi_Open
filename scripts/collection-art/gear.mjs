// Tier gear, cumulative: T2 weapon · T3 body armour · T4 back piece + upgraded head · T5 crown + aura.
import { INK, T1 } from './cat.mjs'

const o = (w = 3.5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`
// A coloured line with an ink outline: ink drawn wider underneath.
const line = (d, color, w) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 4}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
const paw = (p, cx, cy) => `<ellipse cx="${cx}" cy="${cy}" rx="7" ry="6" fill="${p.light}" ${o(3)}/>`
const mirror = inner => `<g transform="translate(128 0) scale(-1 1)">${inner}</g>`
const star = (x, y, r, fill) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${fill}"/>`
const STEEL = '#d7dce5', STEEL_D = '#9aa2b2', GOLD = '#f2c14e', GOLD_D = '#c28f2a', WOOD = '#9a6437', LEATHER = '#8a5a32', LEATHER_D = '#5e3b1f'

const aura = (id, color) => `
  <defs><radialGradient id="aura-${id}" cx="50%" cy="55%" r="50%">
    <stop offset="0" stop-color="${color}" stop-opacity=".6"/><stop offset=".6" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
  </radialGradient></defs>
  <circle cx="64" cy="72" r="62" fill="url(#aura-${id})"/>
  ${star(14, 30, 6, color)}${star(114, 22, 5, color)}${star(10, 96, 4, color)}${star(120, 66, 4, '#fff')}`

// ---------- Tank · workouts ----------
const tankHelmet = `
  <path d="M40 37 C40 16 88 16 88 37 Z" fill="${STEEL}" ${o()}/>
  <path d="M46 30 C48 23 56 20 62 20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>
  <rect x="36" y="34" width="56" height="8" rx="3" fill="${STEEL_D}" ${o()}/>
  <path d="M61 41 h6 v7 q-3 3 -6 0 Z" fill="${STEEL_D}" ${o(3)}/>`
const tankPlume = p => `<path d="M64 19 C62 9 70 3 78 5 C72 7 70 13 70 19 Z" fill="${p.C}" ${o(3)}/>`
const tankCrest = p => `<path d="M62 20 C56 4 84 -1 98 14 C86 10 76 12 70 20 Z" fill="${p.C}" ${o(3)}/><path d="M70 10 C78 7 86 8 92 12" fill="none" stroke="#fff" stroke-width="2" opacity=".5" stroke-linecap="round"/>`
const tankCrown = p => `
  <path d="M44 24 L42 6 L53 15 L64 3 L75 15 L86 6 L84 24 Z" fill="${GOLD}" ${o(3)}/>
  <rect x="42" y="20" width="44" height="6" rx="2" fill="${GOLD_D}" ${o(3)}/>
  <circle cx="64" cy="15" r="3.5" fill="${p.C}" ${o(2)}/><circle cx="50" cy="17" r="2" fill="#fff" opacity=".8"/>`
const sword = p => `
  <path d="M100 92 L100 40 L104 32 L108 40 L108 92 Z" fill="${STEEL}" ${o(3)}/>
  <path d="M104 38 L104 88" stroke="#fff" stroke-width="1.6" opacity=".7"/>
  <rect x="93" y="91" width="22" height="6" rx="2" fill="${GOLD}" ${o(3)}/>
  <rect x="101" y="97" width="6" height="12" fill="${p.D}" ${o(3)}/>
  <circle cx="104" cy="112" r="4" fill="${GOLD}" ${o(3)}/>
  ${paw(p, 104, 101)}`
const roundShield = p => `
  <circle cx="34" cy="100" r="17" fill="${p.C}" ${o()}/>
  <circle cx="34" cy="100" r="10.5" fill="${STEEL}" ${o(3)}/>
  <circle cx="34" cy="100" r="4" fill="${GOLD}" ${o(2.5)}/>
  <path d="M24 90 C27 87 30 86 33 86" fill="none" stroke="#fff" stroke-width="2" opacity=".6" stroke-linecap="round"/>`
const towerShield = (p, gold) => `
  <path d="M12 70 Q31 62 50 70 L50 104 Q50 117 31 124 Q12 117 12 104 Z" fill="${p.C}" ${o()}/>
  <path d="M18 74 Q31 69 44 74 L44 103 Q44 112 31 117 Q18 112 18 103 Z" fill="${gold ? GOLD : STEEL}" ${o(2.5)}/>
  <path d="M31 78 V112 M22 92 H40" stroke="${p.C}" stroke-width="5" stroke-linecap="round"/>
  <path d="M20 76 Q26 72 32 72" fill="none" stroke="#fff" stroke-width="2" opacity=".7" stroke-linecap="round"/>`
const breastplate = (p, gold) => `
  <path d="M44 84 C52 81 76 81 84 84 L86 106 C78 113 50 113 42 106 Z" fill="${gold ? GOLD : STEEL}" ${o()}/>
  <path d="M64 86 L72 90 L70 100 L64 104 L58 100 L56 90 Z" fill="${p.C}" ${o(2.5)}/>
  <path d="M48 88 C48 96 49 101 51 105" fill="none" stroke="#fff" stroke-width="2" opacity=".6" stroke-linecap="round"/>
  <ellipse cx="42" cy="85" rx="9" ry="5.5" fill="${gold ? GOLD_D : STEEL_D}" ${o()}/>
  <ellipse cx="86" cy="85" rx="9" ry="5.5" fill="${gold ? GOLD_D : STEEL_D}" ${o()}/>`
const cape = color => `<path d="M40 76 C18 92 6 108 2 124 L126 124 C122 108 110 92 88 76 Z" fill="${color}" ${o()}/>
  <path d="M18 104 L12 124 M110 104 L116 124" stroke="${INK}" stroke-width="2" opacity=".35"/>`

// ---------- Ranger · steps ----------
const rangerHood = p => T1.ranger(p).gearHead
const bow = (p, long) => {
  const [t, b] = long ? [30, 124] : [46, 120]
  return `${line(`M28 ${t} C${long ? -2 : 4} ${t + 22} ${long ? -2 : 4} ${b - 22} 28 ${b}`, WOOD, 5)}
  <path d="M28 ${t} L28 ${b}" stroke="#efe6d6" stroke-width="1.6"/>
  ${line(`M28 ${(t + b) / 2 - 1} L50 ${(t + b) / 2 - 1}`, '#c9a26b', 2.5)}
  <path d="M48 ${(t + b) / 2 - 6} L56 ${(t + b) / 2 - 1} L48 ${(t + b) / 2 + 4} Z" fill="${STEEL}" ${o(2)}/>
  ${paw(p, 20, (t + b) / 2)}`
}
const quiver = p => `
  <path d="M90 34 L106 40 L96 90 L80 84 Z" fill="${LEATHER_D}" ${o()}/>
  ${line('M95 38 L101 18', '#d8c3a0', 2)}${line('M100 40 L108 21', '#d8c3a0', 2)}
  <path d="M101 18 l-5 -2 l3 7 Z M108 21 l-5 -3 l3 7 Z" fill="${p.C}" ${o(2)}/>`
const jerkin = p => `
  <path d="M44 84 C52 81 76 81 84 84 L86 106 C78 113 50 113 42 106 Z" fill="${LEATHER}" ${o()}/>
  <path d="M64 84 V108" stroke="${LEATHER_D}" stroke-width="2.5"/>
  <rect x="43" y="99" width="42" height="6" rx="2" fill="${LEATHER_D}" ${o(2.5)}/>
  <rect x="60" y="97.5" width="8" height="9" rx="1.5" fill="${GOLD}" ${o(2)}/>
  <path d="M52 84 L60 96 M76 84 L68 96" stroke="${p.C}" stroke-width="4" stroke-linecap="round"/>`
const feather = `<path d="M96 40 C108 30 116 20 118 10 C108 16 100 26 94 38 Z" fill="#f4f1ea" ${o(2.5)}/><path d="M95 39 L114 15" stroke="#e04848" stroke-width="2"/>`
const laurel = () => {
  const leaves = [[42, 24, -50], [48, 18, -35], [55, 14, -20], [73, 14, 20], [80, 18, 35], [86, 24, 50]]
    .map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="3.5" transform="rotate(${r} ${x} ${y})" fill="${GOLD}" ${o(2)}/>`).join('')
  return `${leaves}<circle cx="64" cy="12" r="4.5" fill="#8ccf5e" ${o(2.5)}/>`
}

// ---------- Rogue · cardio ----------
const rogueMask = p => T1.rogue(p).gearHead
const dagger = (p, x) => `
  <path d="M${x - 3} 94 L${x - 3} 70 L${x} 60 L${x + 3} 70 L${x + 3} 94 Z" fill="${STEEL}" ${o(3)}/>
  <path d="M${x} 66 V90" stroke="#fff" stroke-width="1.4" opacity=".7"/>
  <rect x="${x - 9}" y="93" width="18" height="5" rx="2" fill="${p.C}" ${o(2.5)}/>
  <rect x="${x - 2.5}" y="98" width="5" height="9" fill="${LEATHER_D}" ${o(2.5)}/>
  ${paw(p, x, 101)}`
const vest = p => `
  <path d="M44 84 C52 81 76 81 84 84 L86 106 C78 113 50 113 42 106 Z" fill="#2a2634" ${o()}/>
  <path d="M48 84 L80 108 M80 84 L48 108" stroke="${p.D}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="96" r="4" fill="${STEEL}" ${o(2)}/>
  <rect x="74" y="100" width="10" height="8" rx="2" fill="${LEATHER}" ${o(2)}/>`
const scarf = p => `
  <path d="M60 80 C80 84 102 74 124 56 C120 72 112 86 96 94 C84 98 70 94 60 88 Z" fill="${p.C}" ${o()}/>
  <path d="M86 86 C98 82 108 74 116 66" fill="none" stroke="${p.D}" stroke-width="2.5" stroke-linecap="round"/>`
const circlet = p => `
  <path d="M34 42 C48 36 80 36 94 42" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
  <path d="M34 42 C48 36 80 36 94 42" fill="none" stroke="${GOLD}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M64 30 A7 7 0 1 0 70 41 A5.5 5.5 0 1 1 64 30 Z" fill="#eaf2ff" ${o(2.5)}/>`

// ---------- Cleric · tracking ----------
const clericHalo = p => T1.cleric(p).gearHead
const staff = (p, tall) => `
  ${line(`M106 ${tall ? 30 : 42} L106 122`, WOOD, 5)}
  <path d="M98 ${tall ? 34 : 46} C98 ${tall ? 22 : 34} 114 ${tall ? 22 : 34} 114 ${tall ? 34 : 46}" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
  <path d="M98 ${tall ? 34 : 46} C98 ${tall ? 22 : 34} 114 ${tall ? 22 : 34} 114 ${tall ? 34 : 46}" fill="none" stroke="${GOLD}" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="106" cy="${tall ? 26 : 38}" r="${tall ? 8 : 6.5}" fill="${p.M ?? '#7fd8ff'}" ${o(3)}/>
  <circle cx="103" cy="${tall ? 23 : 35.5}" r="2.2" fill="#fff"/>
  ${paw(p, 106, 98)}`
const robe = p => `
  <path d="M44 84 C52 81 76 81 84 84 L86 106 C78 113 50 113 42 106 Z" fill="#ffffff" ${o()}/>
  <path d="M58 82 L58 110 M70 82 L70 110" stroke="${GOLD}" stroke-width="3"/>
  <path d="M64 88 V102 M57 94 H71" stroke="${GOLD_D}" stroke-width="4" stroke-linecap="round"/>
  <path d="M44 104 C52 110 76 110 84 104" fill="none" stroke="${GOLD}" stroke-width="3"/>`
const wing = `
  <path d="M42 78 C22 56 4 62 2 80 C8 80 10 86 6 92 C12 92 16 98 12 104 C22 102 28 108 30 112 C36 104 40 92 42 78 Z" fill="#ffffff" ${o()}/>
  <path d="M14 78 C22 80 30 84 36 90 M16 92 C24 94 30 98 34 104" fill="none" stroke="#d8dbe6" stroke-width="2.5" stroke-linecap="round"/>`
const radiantHalo = p => `
  <g stroke="${GOLD}" stroke-width="3" stroke-linecap="round" opacity=".9">
    <path d="M64 -2 V4 M40 2 L44 7 M88 2 L84 7 M30 12 L36 13 M98 12 L92 13"/>
  </g>
  <ellipse cx="64" cy="14" rx="26" ry="7.5" fill="none" stroke="${INK}" stroke-width="10"/>
  <ellipse cx="64" cy="14" rx="26" ry="7.5" fill="none" stroke="${GOLD}" stroke-width="5"/>
  <path d="M46 10 C54 8 62 7 68 7" fill="none" stroke="#fff6cf" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="64" cy="38" r="4" fill="${GOLD}" ${o(2.5)}/>`

// ---------- Tier 6 · mythic ----------
// Everything T5 has, plus a two-ring aura, more stars, and one signature piece per class.
const mythicAura = (id, a, b) => `
  <defs><radialGradient id="myth-${id}" cx="50%" cy="55%" r="50%">
    <stop offset="0" stop-color="${a}" stop-opacity=".75"/><stop offset=".45" stop-color="${b}" stop-opacity=".35"/><stop offset="1" stop-color="${b}" stop-opacity="0"/>
  </radialGradient></defs>
  <circle cx="64" cy="70" r="64" fill="url(#myth-${id})"/>
  <circle cx="64" cy="70" r="56" fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-dasharray="2 7" opacity=".7"/>
  ${star(12, 26, 7, a)}${star(116, 18, 6, GOLD)}${star(8, 92, 5, '#fff')}${star(122, 58, 5, a)}${star(20, 60, 3.5, GOLD)}${star(112, 100, 4, '#fff')}`
const tankHelmetGold = tankHelmet.split(STEEL).join(GOLD).split(STEEL_D).join(GOLD_D)
const horns = `<path d="M42 30 C28 26 20 14 24 3 C30 14 38 19 48 22 Z" fill="#f4ecd8" ${o(3)}/>` +
  `<path d="M86 30 C100 26 108 14 104 3 C98 14 90 19 80 22 Z" fill="#f4ecd8" ${o(3)}/>`
const spiritBow = p => `<path d="M28 26 C-6 50 -6 102 28 126" fill="none" stroke="#7fe3ff" stroke-width="12" stroke-linecap="round" opacity=".28"/>` +
  bow(p, true).split(WOOD).join('#7fe3ff')
const antlers = `${line('M44 22 C38 12 38 6 42 2 M41 12 L34 8', WOOD, 3)}${line('M84 22 C90 12 90 6 86 2 M87 12 L94 8', WOOD, 3)}`
const glowDagger = (p, x) => `<ellipse cx="${x}" cy="78" rx="8" ry="20" fill="${p.C}" opacity=".35"/>` + dagger(p, x)
const smoke = p => `<g fill="${p.C}" opacity=".35"><ellipse cx="30" cy="120" rx="16" ry="5"/><ellipse cx="98" cy="121" rx="18" ry="5"/><ellipse cx="64" cy="124" rx="26" ry="4"/></g>`
const bigWing = `<g transform="translate(-4 -8) scale(1.07)">${wing}</g>`
const starOrbStaff = p => staff(p, true) + star(106, 26, 13, GOLD) + `<circle cx="106" cy="26" r="5" fill="#fff"/>`


// ---------- Mage · sleep ----------
const wizardHat = (p, gold) => `
  <path d="M40 38 C48 20 60 6 86 2 C76 12 80 26 88 38 Z" fill="${p.C}" ${o()}/>
  <ellipse cx="64" cy="38" rx="34" ry="7" fill="${p.D}" ${o()}/>
  ${gold ? `<path d="M42 33 C56 29 74 29 86 33" fill="none" stroke="${GOLD}" stroke-width="4"/>` : ''}
  ${star(62, 22, 5, GOLD)}${star(74, 12, 3, '#fff')}${star(52, 30, 2.5, '#fff')}`
const moonStaff = (p, tall) => {
  const top = tall ? 26 : 40
  return `${line(`M106 ${top + 8} L106 122`, WOOD, 5)}
  <path d="M106 ${top - 12} A12 12 0 1 0 116 ${top + 4} A9 9 0 1 1 106 ${top - 12} Z" fill="#f3ecd2" ${o(2.5)}/>
  ${paw(p, 106, 98)}`
}
const starRobe = p => `
  <path d="M44 84 C52 81 76 81 84 84 L86 106 C78 113 50 113 42 106 Z" fill="${p.C}" ${o()}/>
  ${star(54, 92, 3, GOLD)}${star(72, 98, 2.5, GOLD)}${star(64, 88, 2, '#fff')}${star(58, 104, 2, '#fff')}
  <path d="M44 104 C52 110 76 110 84 104" fill="none" stroke="${GOLD}" stroke-width="2.5"/>`
const floatingMoon = `<circle cx="20" cy="34" r="14" fill="#f3ecd2" opacity=".15"/><path d="M20 22 A12 12 0 1 0 30 38 A9 9 0 1 1 20 22 Z" fill="#f3ecd2" ${o(2.5)}/>`
const nightCape = p => cape(p.D) + `${star(20, 108, 3, '#fff')}${star(108, 112, 3, GOLD)}${star(14, 120, 2, GOLD)}${star(116, 98, 2, '#fff')}`

// ---------- Alchemist · nutrition ----------
const goggles = gold => `
  <path d="M30 38 C44 32 84 32 98 38" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
  <path d="M30 38 C44 32 84 32 98 38" fill="none" stroke="${LEATHER}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="52" cy="35" r="8" fill="#9fe3ff" stroke="${gold ? GOLD : '#b08a4a'}" stroke-width="3.5"/>
  <circle cx="76" cy="35" r="8" fill="#9fe3ff" stroke="${gold ? GOLD : '#b08a4a'}" stroke-width="3.5"/>
  <circle cx="49" cy="32" r="2.2" fill="#fff"/><circle cx="73" cy="32" r="2.2" fill="#fff"/>`
const flask = (p, big) => {
  const r = big ? 13 : 10, cy = big ? 96 : 100
  return `<rect x="101" y="${cy - r - 14}" width="8" height="14" fill="#dff4ff" ${o(2.5)}/>
  <rect x="100" y="${cy - r - 19}" width="10" height="6" rx="2" fill="${WOOD}" ${o(2)}/>
  <circle cx="105" cy="${cy}" r="${r}" fill="#dff4ff" ${o(3)}/>
  <path d="M${105 - r + 2} ${cy + 2} A${r - 2} ${r - 2} 0 0 0 ${105 + r - 2} ${cy + 2} Z" fill="${p.C}"/>
  <circle cx="101" cy="${cy - 3}" r="2" fill="#fff" opacity=".8"/>
  ${big ? `<circle cx="105" cy="${cy}" r="${r + 7}" fill="${p.C}" opacity=".2"/>` : ''}
  ${paw(p, 92, 104)}`
}
const apron = p => `
  <path d="M46 84 C54 81 74 81 82 84 L84 108 C76 113 52 113 44 108 Z" fill="#ece5d2" ${o()}/>
  <rect x="54" y="94" width="20" height="10" rx="2" fill="#d8ceb4" ${o(2)}/>
  <rect x="58" y="88" width="4" height="9" rx="1" fill="${p.C}" ${o(1.5)}/><rect x="65" y="90" width="4" height="7" rx="1" fill="#e04848" ${o(1.5)}/>
  <path d="M46 86 L40 80 M82 86 L88 80" stroke="${p.D}" stroke-width="3" stroke-linecap="round"/>`
const potionPack = `
  <rect x="84" y="46" width="30" height="36" rx="5" fill="${LEATHER}" ${o()}/>
  ${[[90, '#e04848'], [99, '#4f9d4c'], [108, '#8d55e0']].map(([x, c]) => `<rect x="${x - 3}" y="34" width="7" height="14" rx="2" fill="${c}" ${o(2)}/>`).join('')}`
const philosopherStone = `<circle cx="22" cy="40" r="15" fill="#ff5a6e" opacity=".18"/><path d="M22 28 L32 40 L22 52 L12 40 Z" fill="#ff5a6e" ${o(2.5)}/><path d="M18 36 L22 31" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`

// ---------- Monk · mood & recovery ----------
const headband = p => `
  <path d="M30 44 C44 38 84 38 98 44 L98 51 C84 45 44 45 30 51 Z" fill="${p.C}" ${o(3)}/>
  <path d="M31 47 C20 50 14 58 12 66 C20 62 26 58 32 52 Z" fill="${p.C}" ${o(2.5)}/>
  <path d="M33 49 C24 56 22 66 24 74 C30 68 32 60 35 53 Z" fill="${p.D}" ${o(2.5)}/>`
const beads = (p, glow) => `<g>${Array.from({ length: 9 }, (_, i) => {
  const t = i / 8, x = 46 + t * 36, y = 84 + Math.sin(t * Math.PI) * 13
  return `${glow ? `<circle cx="${x}" cy="${y}" r="5.5" fill="${p.C}" opacity=".3"/>` : ''}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.3" fill="${i === 4 ? p.C : WOOD}" ${o(1.8)}/>`
}).join('')}</g>`
const handWraps = `<path d="M47 114 h14 M47 118 h14 M67 114 h14 M67 118 h14" stroke="#f4f1ea" stroke-width="2.5" stroke-linecap="round"/>`
const monkRobe = p => `
  <path d="M44 84 C52 81 76 81 84 84 L86 106 C78 113 50 113 42 106 Z" fill="${p.C}" ${o()}/>
  <path d="M46 84 L82 108" stroke="${p.D}" stroke-width="7" stroke-linecap="round"/>`
const thirdEye = p => `<circle cx="64" cy="37" r="4.5" fill="${p.C}" ${o(2)}/><circle cx="64" cy="37" r="8" fill="${p.C}" opacity=".25"/>`
const lotus = `<g ${o(2.5)}>
  <path d="M64 124 C44 124 26 116 20 106 C34 108 46 114 64 124 Z" fill="#f7a8c8"/>
  <path d="M64 124 C84 124 102 116 108 106 C94 108 82 114 64 124 Z" fill="#f7a8c8"/>
  <path d="M64 124 C50 116 42 104 44 94 C54 102 60 112 64 124 Z" fill="#fbc6dc"/>
  <path d="M64 124 C78 116 86 104 84 94 C74 102 68 112 64 124 Z" fill="#fbc6dc"/></g>`
const orbs = p => `${[[18, 60], [110, 50], [24, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${p.C}" opacity=".25"/><circle cx="${x}" cy="${y}" r="3.5" fill="#fff4e0"/>`).join('')}`

// tier -> { gearBack, gearHead, gearFront }
export const GEAR = {
  tank: [
    p => ({ gearHead: tankHelmet + tankPlume(p) }),
    p => ({ gearHead: tankHelmet + tankPlume(p), gearFront: sword(p) + roundShield(p) }),
    p => ({ gearHead: tankHelmet + tankPlume(p), gearFront: breastplate(p) + sword(p) + roundShield(p) }),
    p => ({ gearBack: cape(p.D), gearHead: tankHelmet + tankCrest(p), gearFront: breastplate(p) + sword(p) + towerShield(p) }),
    p => ({ gearBack: aura('tank', '#ff7a6a') + cape(p.D), gearHead: tankHelmet + tankCrown(p), gearFront: breastplate(p, true) + sword(p) + towerShield(p, true) }),
    p => ({ gearBack: mythicAura('tank', '#ff9a7a', '#f2c14e') + cape(p.C), gearHead: tankHelmetGold + horns + tankCrown(p), gearFront: breastplate(p, true) + sword(p) + towerShield(p, true) }),
  ],
  ranger: [
    p => ({ gearHead: rangerHood(p) }),
    p => ({ gearHead: rangerHood(p), gearFront: bow(p) }),
    p => ({ gearBack: quiver(p), gearHead: rangerHood(p), gearFront: jerkin(p) + bow(p) }),
    p => ({ gearBack: cape(p.D) + quiver(p), gearHead: rangerHood(p) + feather, gearFront: jerkin(p) + bow(p, true) }),
    p => ({ gearBack: aura('ranger', '#8ef09a') + cape(p.D) + quiver(p), gearHead: rangerHood(p) + feather + laurel(), gearFront: jerkin(p) + bow(p, true) }),
    p => ({ gearBack: mythicAura('ranger', '#9dfbb0', '#7fe3ff') + cape(p.D) + quiver(p), gearHead: rangerHood(p) + antlers + laurel(), gearFront: jerkin(p) + spiritBow(p) }),
  ],
  rogue: [
    p => ({ gearHead: rogueMask(p) }),
    p => ({ gearHead: rogueMask(p), gearFront: dagger(p, 106) }),
    p => ({ gearHead: rogueMask(p), gearFront: vest(p) + dagger(p, 106) + dagger(p, 22) }),
    p => ({ gearBack: cape('#4b2f86') + scarf(p), gearHead: rogueMask(p), gearFront: vest(p) + dagger(p, 106) + dagger(p, 22) }),
    p => ({ gearBack: aura('rogue', '#b98cff') + cape('#4b2f86') + scarf(p), gearHead: rogueMask(p) + circlet(p), gearFront: vest(p) + dagger(p, 106) + dagger(p, 22) }),
    p => ({ gearBack: mythicAura('rogue', '#c9a3ff', '#5a3399') + cape('#4b2f86') + scarf(p) + smoke(p), gearHead: rogueMask(p) + circlet(p), gearFront: vest(p) + glowDagger(p, 106) + glowDagger(p, 22) }),
  ],
  cleric: [
    p => ({ gearHead: clericHalo(p) }),
    p => ({ gearHead: clericHalo(p), gearFront: staff(p) }),
    p => ({ gearHead: clericHalo(p), gearFront: robe(p) + staff(p) }),
    p => ({ gearBack: wing + mirror(wing), gearHead: clericHalo(p), gearFront: robe(p) + staff(p, true) }),
    p => ({ gearBack: aura('cleric', '#ffd86a') + wing + mirror(wing), gearHead: radiantHalo(p), gearFront: robe(p) + staff(p, true) }),
    p => ({ gearBack: mythicAura('cleric', '#fff1b0', '#ffd86a') + bigWing + mirror(bigWing), gearHead: radiantHalo(p), gearFront: robe(p) + starOrbStaff(p) }),
  ],
  mage: [
    p => ({ gearHead: wizardHat(p) }),
    p => ({ gearHead: wizardHat(p), gearFront: moonStaff(p) }),
    p => ({ gearHead: wizardHat(p), gearFront: starRobe(p) + moonStaff(p) }),
    p => ({ gearBack: nightCape(p) + floatingMoon, gearHead: wizardHat(p), gearFront: starRobe(p) + moonStaff(p, true) }),
    p => ({ gearBack: aura('mage', '#9fb4ff') + nightCape(p) + floatingMoon, gearHead: wizardHat(p, true), gearFront: starRobe(p) + moonStaff(p, true) }),
    p => ({ gearBack: mythicAura('mage', '#c3ccff', '#6d5ae0') + nightCape(p) + floatingMoon, gearHead: wizardHat(p, true) + star(96, 20, 6, GOLD) + star(30, 18, 5, GOLD), gearFront: starRobe(p) + moonStaff(p, true) }),
  ],
  alchemist: [
    p => ({ gearHead: goggles() }),
    p => ({ gearHead: goggles(), gearFront: flask(p) }),
    p => ({ gearHead: goggles(), gearFront: apron(p) + flask(p) }),
    p => ({ gearBack: cape(p.D) + potionPack, gearHead: goggles(), gearFront: apron(p) + flask(p, true) }),
    p => ({ gearBack: aura('alchemist', '#8ef0c0') + cape(p.D) + potionPack, gearHead: goggles(true), gearFront: apron(p) + flask(p, true) }),
    p => ({ gearBack: mythicAura('alchemist', '#b4ffd9', '#f2c14e') + cape(p.D) + potionPack + philosopherStone, gearHead: goggles(true) + tankCrown(p), gearFront: apron(p) + flask(p, true) }),
  ],
  monk: [
    p => ({ gearHead: headband(p) }),
    p => ({ gearHead: headband(p), gearFront: beads(p) + handWraps }),
    p => ({ gearHead: headband(p), gearFront: monkRobe(p) + beads(p) + handWraps }),
    p => ({ gearBack: cape(p.D), gearHead: headband(p), gearFront: monkRobe(p) + beads(p, true) + handWraps }),
    p => ({ gearBack: aura('monk', '#ffc27a') + cape(p.D), gearHead: headband(p) + thirdEye(p), gearFront: monkRobe(p) + beads(p, true) + handWraps }),
    p => ({ gearBack: mythicAura('monk', '#ffd9a0', '#f28c28') + orbs(p), gearHead: headband(p) + thirdEye(p), gearFront: monkRobe(p) + beads(p, true) + handWraps + lotus }),
  ],
}
