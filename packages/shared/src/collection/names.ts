/**
 * Cat names for the collection. Pure and deterministic: a cat's name is a function of its identity,
 * so the replay names the same cat the same thing on every read, on every device, forever.
 *
 * A spawned cat draws from `NAMES`. A merged cat's name is a blend of its oldest and newest parts
 * ("Pudding" + "Waffle" → "Puffle"), so the name changes when cats merge and the parts come back
 * with their own names if it ever breaks down again.
 */

const NAMES = [
  'Mochi', 'Biscuit', 'Pudding', 'Waffle', 'Nugget', 'Pip', 'Maple', 'Kiwi', 'Luna', 'Bean',
  'Tofu', 'Noodle', 'Pickle', 'Sesame', 'Toffee', 'Mango', 'Olive', 'Pepper', 'Ginger', 'Clover',
  'Socks', 'Button', 'Pebble', 'Dumpling', 'Sprout', 'Hazel', 'Juniper', 'Marble', 'Muffin', 'Nimbus',
  'Poppy', 'Quill', 'Rolo', 'Saffron', 'Taro', 'Umi', 'Velvet', 'Wasabi', 'Yuzu', 'Ziggy',
  'Acorn', 'Bramble', 'Cocoa', 'Dot', 'Ember', 'Fig', 'Gizmo', 'Honey', 'Inky', 'Jelly',
  'Kuma', 'Lychee', 'Miso', 'Nori', 'Oreo', 'Peanut', 'Quinn', 'Rusty', 'Sushi', 'Tater',
  'Udon', 'Vanilla', 'Whisker', 'Xena', 'Yeti', 'Zuzu', 'Boba', 'Cheddar', 'Doodle', 'Fudge',
  'Gnocchi', 'Hops', 'Jasper', 'Kipper', 'Lentil', 'Moss', 'Nutmeg', 'Onyx', 'Paprika', 'Rascal',
]

/** FNV-1a, so the same id always lands on the same name. */
export function nameHash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

export function spawnName(id: string): string {
  return NAMES[nameHash(id) % NAMES.length]
}

/** Up to and including the first run of vowels: "Pudding" → "Pu", "Bean" → "Bea". */
function head(name: string): string {
  return name.match(/^[^aeiouy]*[aeiouy]+/i)?.[0] ?? name
}

/** Everything after the first run of vowels: "Waffle" → "ffle", "Mochi" → "chi". */
function tail(name: string): string {
  return name.match(/^[^aeiouy]*[aeiouy]+(.+)$/i)?.[1] ?? ''
}

/** The merged cat's name: the oldest part's opening and the newest part's ending. */
export function blendName(oldest: string, newest: string): string {
  let s = head(oldest) + tail(newest).toLowerCase()
  if (s.length < 3) s += 'bo'
  if (s.toLowerCase() === oldest.toLowerCase() || s.toLowerCase() === newest.toLowerCase()) s += 'o'
  return s[0].toUpperCase() + s.slice(1)
}
