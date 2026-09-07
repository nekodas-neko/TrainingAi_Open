/**
 * BF-122b — the sprite layer, isolated so replacing it is one file.
 *
 * **These are glyphs, not the art.** The entry's brief is one cat silhouette with props signalling
 * tier, roughly twelve drawn assets, and it calls that art *"the only unrecoverable spend"*. Nothing
 * here commits it: a glyph per tier ships the mechanic so the owner can see it working and then
 * decide whether the assets are worth drawing, and swapping to images means changing this map and
 * the one component that reads it.
 *
 * Chosen for the constraint the brief names — legible at ~32 px on the S25 — which is the size an
 * emoji is designed for and the size a detailed sprite is not. That is verified on device, not here.
 */
import type { FaucetKey } from './collection-summary'

/** Tier index within its ladder → the glyph shown for it. Bottom rung first. */
const GLYPHS: Record<FaucetKey, string[]> = {
  workout: ['🐱', '🐈', '🛡️'],
  steps: ['🐱', '🐈', '🏹'],
  sleep: ['🐱', '🐈', '🔮'],
}

/**
 * The bottom rung is shared across all three ladders in `LADDERS` — every one spawns a `cat slime` —
 * so its glyph must match everywhere or the same creature would read as three.
 */
export function tierGlyph(faucet: FaucetKey, tier: number): string {
  return GLYPHS[faucet][tier] ?? GLYPHS[faucet][0]
}

export function ladderGlyphs(faucet: FaucetKey): readonly string[] {
  return GLYPHS[faucet]
}
