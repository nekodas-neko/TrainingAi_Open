/** The cell and track a title-row toggle draws: the current app floors every button at 48 px. */
export function compactToggleLayout(
  sizes: { touchTarget: number },
  spacing: { xxs: number },
  appearance: 'tint' | 'pill',
) {
  return {
    cellMinHeight: sizes.touchTarget,
    trackPadding: appearance === 'pill' ? spacing.xxs : 0,
  };
}
