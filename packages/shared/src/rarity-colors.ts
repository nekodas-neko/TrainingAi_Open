export interface RarityColor {
  name: string
  hex: string
}

// MMO item-rarity inspired accent palette, used as quick-pick presets for
// widget/card colour customisation across the app.
export const RARITY_COLORS: RarityColor[] = [
  { name: 'Clear', hex: 'transparent' },
  { name: 'Common', hex: '#94a3b8' },
  { name: 'Uncommon', hex: '#22c55e' },
  { name: 'Rare', hex: '#00d4ff' },
  { name: 'Epic', hex: '#ec4899' },
  { name: 'Arcane', hex: '#8b5cf6' },
  { name: 'Legendary', hex: '#fbbf24' },
  { name: 'Mythic', hex: '#ef4444' },
  { name: 'Primal', hex: '#2dd4bf' },
]
