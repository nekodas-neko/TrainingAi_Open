/** The two score-row styles that draw hairline rules across the screen instead of a circle per score. */
export function isBandStyle(style: string | undefined) {
  return style === 'band' || style === 'underline';
}

/**
 * The label under a score. Only the band styles use the short names ("Move", "Rest HR") in small
 * capitals; every other style prints the full name in mixed case (oura-score-chip-row.tsx).
 */
export function scoreChipLabel(style: string | undefined, label: string, shortLabel?: string) {
  return isBandStyle(style) && shortLabel
    ? { text: shortLabel, capitals: true }
    : { text: label, capitals: false };
}
