# Cat collection — design catalogue

**What this is:** the complete inventory of the collection's designed assets (classes, tiers, skins,
scenes, animation, names) and what each one is for. The designs are **done and committed**. Most
of them are **not yet wired** to anything that awards them; that is deliberate, because the owner
asked for the full set to exist first (2026-09-26: *"as long as all the designs are done … we dont
need to use them all as long as they exist"*).

**See it:** `node scripts/collection-art/preview.mjs` writes an animated gallery of every sprite,
variant and scene to your temp directory and prints the path. **Change it:** edit
`scripts/collection-art/{cat,gear,scenes}.mjs`, then run `node scripts/collection-art/build.mjs`.
The SVGs in `public/cats/` are generated output, and
`components/home/__tests__/collection-sprites.test.ts` fails if they drift from their source.

Rules and numbers (tier costs, decay, rares) live in the plan,
[`2026-09-26-cat-collection-rules-v2.md`](../../superpowers/plans/2026-09-26-cat-collection-rules-v2.md).
This file is only about the designs.

## Classes — one per category

| Class | Tracks | Look (T1 → T6) | Status |
|---|---|---|---|
| **Tank** | workouts | grey cat; helmet → sword & shield → plate → cape & tower shield → crown & aura → gold horned helm | **wired** (workout ladder) |
| **Ranger** | steps | ginger tabby; hood → bow → leather & quiver → cloak & longbow → laurel & aura → antlers & spirit bow | **wired** (steps ladder) |
| **Mage** | sleep | blue-grey cat; wizard hat → moon staff → star robe → night cape & floating moon → gold-band hat & aura → mythic starfield | **wired** (sleep ladder, from this PR) |
| **Rogue** | cardio (runs/walks) | black cat; bandit mask → dagger → twin daggers & vest → purple cape & scarf → circlet & aura → glowing daggers & smoke | art only (PS-49, rate open in PS-48) |
| **Health cat** (Cleric art) | logging: sleep, food, weight | white cat; halo → staff → robe → wings → radiant halo & aura → great wings & star staff | art only (PS-49) |
| **Alchemist** | nutrition | cream cat; goggles → potion flask → apron → potion pack & big flask → gold goggles & aura → crown & philosopher's stone | art only, no ladder planned yet |
| **Monk** | mood & recovery | brown cat; headband → prayer beads & hand wraps → saffron robe → cape & glowing beads → third eye & aura → lotus seat & orbs | art only, no ladder planned yet |

The Health cat and the Mage/Alchemist overlap on purpose. The Health cat rewards *logging anything*
(the owner's definition); the Mage and Alchemist are there if sleep or nutrition later get ladders of
their own. Which categories actually get ladders is an owner decision, filed in PS-53.

## Tiers

Six per class, drawn so **size and gear carry the tier** and **fur, eyes and headgear carry the
class**; the class survives at widget size. In the Home pen, **depth follows tier**: T1 small at the
front, each tier further back and higher, T5–T6 flying.

## Coats (variants) — every class × every tier

| Coat | File suffix | Intended use | Awarded by |
|---|---|---|---|
| base | *(none)* | the default | – |
| **shiny** | `-shiny` | the rare roll on a merge: a recolour plus three white glints | PS-49 (proposed 1 in 12) |
| **frost** | `-frost` | an achievement/seasonal skin: icy coat | nothing yet (PS-53) |
| **ember** | `-ember` | an achievement/seasonal skin: fiery coat | nothing yet (PS-53) |

7 classes × 6 tiers × 4 coats = **168 sprites**.

## Scenes — backdrops for the pen, meant to be trophies

All are wide (360×150), drawn dark and bottom-anchored. **The mapping to trophies is a proposal**,
filed for the owner in PS-51/PS-53.

| Scene | Mood | Proposed trophy |
|---|---|---|
| `meadow` | night meadow, moon | default, always owned |
| `gym` | racks, plates, a progress screen | first Tank T3 (20 sessions) |
| `castle` | stone hall, banners, torches | first Tank T4 (100 sessions) |
| `park` | dusk path, lamp posts | first Ranger T3 |
| `forest` | pines and fireflies | first Ranger T4 |
| `bedroom` | moonlit bedroom | first Mage T3 (sleep) |
| `house` | cosy room, rug, lamp | first Health-cat T3 |
| `kitchen` | shelves of jars, counter | first Alchemist T3 (if nutrition gets a ladder) |
| `beach` | sunset shore | first Rogue T4 (cardio) |
| `snow` | snowfield at night | a 30-day unbroken run on any ladder |
| `sakura` | cherry blossom, torii gate | one cat of every class |
| `space` | planets and stars | first T6 of any class |

## Animation

- **Inside every SVG** (so it plays in a plain `<img>`): tail swish, alternating paws, a breathing
  bob, a blink every ~4.3 s and a left-ear flick every ~5.2 s. Three held poses per loop
  (`step-end`), like a short GIF, which keeps repaints to a few per second per cat. Each file carries
  its own delay so a pen of identical cats does not move in unison. Reduced motion stops all of it.
- **In the pen** (`ta-pen-*` in `app/globals.css`): each cat walks between two seeded points across
  the full width, idles at both ends and turns round (a face flip at the turn). T5–T6 bob in the air
  over a faint shadow; every cat has a ground shadow. The walk pauses off screen, in idle tabs and
  while the app is backgrounded. The in-SVG loops are not host-pausable; Chromium does not paint
  off-screen images, but that is unmeasured on the S25.
- **Checked frame by frame** on 2026-09-26: the tail passes through three positions, the paws
  lift, the ear flicks and the blink closes the eyes.

## Names

Every cat has a stable generated name (`packages/shared/src/collection/names.ts`), shown on a tag in
the pen and listed on `/collection` with its arrival day and parents. A merge blends the parents'
names; a breakdown returns the same named cats. Derived from the replay, never stored.

## Known limits of the designs

- A white cat on the `snow` scene relies on its light rim for contrast.
- Tank T5–T6 fly without wings (it reads as levitation); the Health cat is the only winged class.
- Nothing here has been seen on the S25 (BF-126 `Verify: owner`).
