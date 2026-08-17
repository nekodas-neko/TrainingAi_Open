# Q-389 — printable food labels for saved meals

**Status:** plan · **Date:** 2026-08-17 · **Author:** Implementation Lane B (planning PR)
**Backlog entry:** Q-389 · **Branch when built:** `feat/saved-meal-printable-label`
**Lane:** B for everything below except the one Lane A item called out in §7.

The owner has already settled the design questions (50 × 50 mm, square-and-circular dies, name +
calories + P/C/F + code, blank made-on line, no per-serving line). This plan does **not** re-open
them. It covers what the intake entry could not: what the trace found, which of its assumptions are
wrong, and the build order.

---

## 1. Three things the trace changed

### 1.1 A 21×21 QR cannot hold a meal id. The entry's module-pitch numbers are ~16% optimistic.

Q-389 says *"all fine for a 21×21-module code holding just a meal id"* and derives 0.58–0.76 mm per
module from it. Version 1 (21×21) holds **17 bytes** at EC level L. A saved-meal id is a UUID:

| encoding | chars | fits v1 (21×21, L=17)? | fits v2 (25×25, L=32 / M=26)? |
|---|---|---|---|
| canonical UUID `fe481797-…` | 36 | ✗ | ✗ at L |
| hex, dashes stripped | 32 | ✗ | ✓ at L only (exactly 32) |
| **base64url of the 16 raw bytes** | **22** | ✗ | **✓ at both L and M** |

So the floor is **version 2, 25×25 modules**, and the real pitch on the owner's circle-safe layouts
is **12.2 mm / 25 = 0.49 mm** to **15.9 mm / 25 = 0.64 mm** per module — not 0.58–0.76. The entry
already calls that margin thin and names printer ink-spread as the expected failure; this makes it
thinner than it thought.

Three consequences, and none of them is optional:

- **Encode the id as base64url of the 16 raw bytes (22 chars), not the canonical UUID string.** It is
  the only encoding that fits version 2 at EC level **M**, and M is what survives ink spread — L is
  the level you pick when you have room to spare, and this design does not.
- **Do not add a prefix, a URL, a scheme, or a version tag inside the QR.** `ta:` or
  `https://…/m/<id>` pushes it to version 3 (29×29) and the pitch to ~0.42 mm. Namespacing belongs in
  the *decode* branch (§4), which can distinguish a 22-char base64url token from an EAN by shape.
- **The test-print gate the entry asks for is now a hard gate, not a nicety.** Print at the chosen
  size, scan with the S25, and do it before any layout is frozen. If it fails, the entry's own lever
  list applies (drop the MADE line ≈ 3.7 mm, then macros).

*Method note: these capacities are the QR spec's byte-mode tables, cross-checked by deriving them
from codeword counts (v1: 26 total − 7 EC = 19 data = 152 bits; 152 − 4 mode − 8 length = 140 → 17
chars. v2 L: 44 − 10 = 34 data = 272 bits → 32 chars. v2 M: 44 − 16 = 28 = 224 bits → 26 chars).
**No encoder was run** — there is none in the tree (§2) — so the implementer must re-confirm against
whichever library they add, before the print test.*

### 1.2 The "log one serving, never infer" requirement is already satisfied — by code that exists

The entry flags this as the ambiguity the label can no longer carry, to be settled when the scan-back
is built. It is already settled. `packages/shared/src/nutrition/saved-meal-ingredients.ts`:

```ts
export function oneServingItems(meal: SavedMeal): SavedMealItem[] {
  const servings = Number(meal.servings)
  if (!(servings > 0) || servings === 1) return items
  return items.map(i => ({ ...i, quantityMultiplier: i.quantityMultiplier / servings }))
}
```

`logMealItems` (`packages/shared/src/nutrition/log-meal.ts:39`) iterates `oneServingItems(meal)` on
**both** its local-store and web-fallback branches. So a scan branch that calls `logMealItems` logs
exactly one serving, offline-first, with the outbox, for free. **Do not write a new logging path.**

### 1.3 …which exposes the actual bug this feature can ship: the label would print the batch

`SavedMeal.totals` is the **whole recipe** — its own type comment says so
(`packages/shared/src/types/nutrition.ts:73`, *"`totals` is the WHOLE recipe; divide by this for one
portion"*). The obvious label renderer reads `meal.totals` and prints it.

That gives a label reading **624 kcal** on a tub whose QR logs **312 kcal** when scanned. The two
halves of one feature would disagree, silently, on a physical object stuck to real food — and the
owner has removed the per-serving line that would have made it visible.

**The label MUST render `totals` divided by `servings`.** This is the single highest-value assertion
in the whole feature and §6 makes it the first test. Reuse `oneServingItems` (or divide `totals` by
`servings` once, in the same shared module) rather than doing the arithmetic in the renderer — this
repo's One Formula, One Place rule, and the divergence it exists to stop is exactly this one.

---

## 2. What has to be added, and what must not be

**A QR *encoder* is a new dependency.** The tree has only decoders — `@zxing/browser` (web fallback)
and `@capacitor-community/barcode-scanner` (native). Nothing can generate a code today. Add a small
encoder (`qrcode` or equivalent) with `pnpm`, committing `package.json` and `pnpm-lock.yaml`
together.

**Do not use `lib/exercise-image-gen.ts` or any image model** — the entry is right and the reason is
worth restating: a label is exact typography and exact numbers, and this one now carries macros that
must match what the scan logs. Render deterministically.

**The typeface must be embedded.** The owner's spec says so and the trace agrees for a second reason:
the renderer runs in a WebView, and a face assumed present on a desktop is not present there. A
substituted fallback changes the metrics and this layout has no slack.

---

## 3. Where it hangs in the UI (Lane B)

`components/nutrition/saved-meals-sheet.tsx` already lists meals and renders each through
`components/nutrition/saved-meal-card.tsx`, with edit/delete/quick-log actions. The label action goes
**on the card's existing action set**, not on a new screen.

Two `CLAUDE.md` constraints that bite here specifically:

- **`saved-meals-sheet.tsx` is a known component-size hotspot.** Put the renderer and the preview in
  new files under `components/nutrition/` and import them; do not append.
- **The card is a tappable container with controls inside it.** Any new control follows the
  container-div + separate-`<button>` pattern — never a `<button>` inside a `<button>`, which
  Samsung's WebView silently strips.

**The preview sheet is where print gets decided, and it is not a normal screen.** Q-389's decision 2
is right: this artwork is ink on white paper and must be legible with **no colour at all**. It
therefore does **not** use `--accent-*` or any theme token — it is the one deliberate exception to
the token rule in this codebase, and it needs a comment saying so, or a later sweep will "fix" it.
The preview must render the label on a white ground in **both** app themes, since a dark-mode preview
of a white label is the obvious thing to get wrong.

**Delivery is a real constraint, not a detail.** The canonical runtime is a WebView in an APK. A
`<a download>` is not a reliable path there, and neither is `window.print()`. Decide explicitly:
render to a PNG data URL and hand it to the platform share sheet (Capacitor Share / Filesystem), or
open it full-screen for a long-press save. Whichever is chosen, **it is device-only verification** —
the web sandbox will happily download a file the phone cannot.

---

## 4. The scan-back branch (Lane B)

`components/nutrition/capture-step.tsx:138` `handleBarcode(code)` already receives the decoded string
from both scanner paths and posts it to `/api/nutrition/barcode`. The saved-meal branch is a
conditional at the top of that function, before the fetch.

Recognition must be **shape-based, not prefix-based** (§1.1 forbids a prefix): a 22-character
base64url token that decodes to 16 bytes is a meal id; anything else falls through to the existing
barcode lookup. An EAN-13 is 13 digits and cannot collide.

On a match: resolve the meal from the local store first (`store.getSavedMeals()`), fall back to
`/api/nutrition/saved-meals`, then call `logMealItems` — §1.2. **This must work offline**, which
resolving locally-first is what buys.

Three failure states the branch owes the user, because a physical label outlives the data behind it:

1. **The meal was deleted.** The label is on a real tub. Say "that saved meal no longer exists",
   don't fail silently or fall through to a barcode "not found" that names the wrong thing.
2. **The meal belongs to another user.** Ownership is checked server-side as usual; the client must
   not assume a scanned id is the scanner's own.
3. **The recipe changed since printing.** The owner has not chosen between versioning and
   show-current (entry decision 3 is still open on this point). **Build show-current** — it needs no
   payload bytes, which §1.1 says the design cannot spare — and log a follow-up if the owner later
   wants a staleness warning.

---

## 5. Build order

Each step is independently mergeable and the first three need no device.

1. **`packages/shared/src/nutrition/label-payload.ts`** — `encodeMealId(uuid) → string` and
   `decodeMealId(s) → uuid | null`, plus the shape test that distinguishes it from a barcode. Pure,
   fully unit-testable, and the thing everything else depends on.
2. **Add the QR encoder dependency** and confirm §1.1's version/EC arithmetic against it.
3. **`components/nutrition/meal-label.tsx`** — the deterministic renderer. Per-serving macros (§1.3),
   embedded face, circle-safe composition inside the centred 130 × 137 px box, blank ruled MADE line.
4. **The preview + delivery sheet** (§3), including the both-themes white-ground check.
5. **The scan branch** in `capture-step.tsx` (§4), reusing `logMealItems`.
6. **The print test** (§7) — and note the layout is not frozen until this passes.

---

## 6. Tests, and what can actually be guarded

**Unit (vitest, node) — these are the ones that matter and they are all reachable:**

- `encodeMealId`/`decodeMealId` round-trip every UUID shape; `decodeMealId` returns `null` for an
  EAN-13, an empty string, a 22-char string that is not valid base64url, and a token decoding to
  something other than 16 bytes.
- **The per-serving assertion (§1.3):** a saved meal with `servings: 2` and `totals.calories: 624`
  produces label figures of **312**, and `logMealItems` on the same meal logs quantities summing to
  the same 312. *One test asserting both halves against each other* — that is what stops them
  drifting, and asserting them separately does not.
- The payload for a UUID is 22 chars, i.e. inside version 2's byte capacity at EC M. A guard on the
  number, so a later "let's also put the name in the QR" is caught by CI rather than by a print run.

**E2E (Playwright):** can drive open-meal → preview and assert the rendered figures, since the
renderer is deterministic. It **cannot** exercise the native scanner — the Capacitor plugin is inert
in the sandbox.

**No component-test route exists** (both vitest projects are `environment: 'node'`,
`@testing-library/react` absent), so the renderer's *output* must be assertable without React —
another reason to compute the figures in a pure shared function and pass them in.

---

## 7. What only the owner can do

- **The print test.** Print at 50 mm, on the actual printer, on both die shapes, and scan with the
  S25. §1.1 says the margin is thinner than the entry assumed; this is the gate.
- **Pick the aesthetic.** Four mockups exist in a design canvas outside this repo; none is chosen.
  Ask for the link, or redraw from the spec in Q-389, which carries what they encode.
- **The staleness decision** (§4.3) if show-current turns out not to be enough in use.

**One item is Lane A's, and only if it is wanted:** nothing here needs a schema change —
`saved_meals.id` is the payload and it already exists. A label *revision* column, if the owner ever
chooses versioning over show-current, is a migration and therefore Lane A's. Do not add it
speculatively; §1.1 is a standing argument against spending payload bytes on it.
