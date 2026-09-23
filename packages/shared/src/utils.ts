import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CSSProperties } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Strip parenthetical muscle annotations and cap length for legend display.
 *  "Push A (Chest/Shoulders/Triceps)" → "Push A" */
export function shortSessionName(name: string): string {
  const stripped = name.replace(/\s*\([^)]*\)\s*/g, '').trim()
  return stripped.length > 14 ? stripped.slice(0, 13).trimEnd() + '…' : stripped
}

export function localDateString() {
  const n = new Date();
  return `${n.getFullYear()}/${String(n.getMonth() + 1).padStart(2, "0")}/${String(n.getDate()).padStart(2, "0")}`;
}

export function localDatetimeString() {
  const n = new Date();
  return `${n.getFullYear()}/${String(n.getMonth() + 1).padStart(2, "0")}/${String(n.getDate()).padStart(2, "0")} ${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}

export function extractSheetId(url: string): [string, Error | null] {
  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    // Capture the first capture group (ID in this case)
    if (match && match[1]) {
      return [match[1], null];
    }

    return ["", new Error("Failed to extract Google Sheets ID from URL")];
  } catch (err) {
    return ["", err instanceof Error ? err : new Error("Unknown error")];
  }
}

/** Pick readable foreground text color for a solid background hex, via YIQ luminance. */
export function readableOn(hex: string): 'black' | 'white' {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? 'black' : 'white';
}

export function accentCardStyle(hex: string): CSSProperties {
  // RV-99. A non-hex colour used to fall straight through to the bare muted background, dropping
  // the gradient and the border with no error — and `scoreBand()` now returns `var(--accent-green)`
  // rather than a hex, so the HRV-baseline card would have lost its tint silently. `color-mix`
  // takes any CSS colour, including a `var()`, so the token path gets a real accent.
  // **`transparent` keeps the bail**: it is the picker's "no accent" choice, not a colour, and
  // mixing it would paint a grey wash where the user asked for nothing.
  // The hex branch below is left alone deliberately — `rgba()` from parsed components and
  // `color-mix(in oklch)` are not identical, and ~30 cards render through it today.
  if (hex === 'transparent') {
    return {
      backgroundColor: 'color-mix(in oklch, var(--muted) var(--card-tint-pct, 60%), transparent)',
      willChange: 'transform',
    };
  }
  if (!hex.startsWith('#')) {
    return {
      backgroundColor: 'color-mix(in oklch, var(--muted) var(--card-tint-pct, 60%), transparent)',
      backgroundImage: `linear-gradient(135deg, color-mix(in oklch, ${hex} 30%, transparent), color-mix(in oklch, ${hex} 12%, transparent))`,
      border: `1px solid color-mix(in oklch, ${hex} 40%, transparent)`,
      willChange: 'transform',
    };
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    // Translucent --muted base (matches the Training Load card) keeps the
    // accent gradient readable against the bright dynamic sky background.
    backgroundColor: 'color-mix(in oklch, var(--muted) var(--card-tint-pct, 60%), transparent)',
    backgroundImage: `linear-gradient(135deg, rgba(${r},${g},${b},0.3), rgba(${r},${g},${b},0.12))`,
    border: `1px solid rgba(${r},${g},${b},0.4)`,
    // Force each card onto its own GPU compositor layer so SVG icons inside
    // one card can't cause sibling cards' rgba/gradient backgrounds to disappear
    // on Samsung WebView (known compositor bug).
    willChange: 'transform',
  };
}
