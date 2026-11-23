import { customAccent } from '../../../shared/theme/custom-accent.ts';
import { scoreColors } from '../../../shared/theme/tokens.ts';
import { palettes, type Brand } from '../../../shared/theme/palettes.ts';

/**
 * The app's accent for the picture-in-picture window (#3734), which is always dark: the dark
 * palette's brand, or the custom hue's dark step, whichever mode the app itself is in.
 */
export function pipAccent(brand: Brand, customHue: number | null): string | null {
  const color = customHue !== null ? customAccent(customHue, 'dark').brand : palettes[brand]?.dark?.brand;
  return typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : null;
}

/** The heart-rate red for the always-dark window: the dark theme's heart token, as the health screens use. */
export const pipHeartColor: string = scoreColors.dark.heart;
