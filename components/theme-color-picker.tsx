"use client";

import { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import {
  BRAND_THEMES,
  BRAND_THEME_STORAGE_KEY,
  CUSTOM_HUE_STORAGE_KEY,
  type BrandThemeKey,
} from "@trainingai/shared/brand-themes";

export { BRAND_THEMES, type BrandThemeKey };

// OKLCH → linear sRGB → gamma-corrected sRGB (0–255)
function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l3 = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lr =  4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
  const gamma = (x: number) =>
    x >= 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x;
  return [
    Math.round(Math.max(0, Math.min(255, gamma(lr) * 255))),
    Math.round(Math.max(0, Math.min(255, gamma(lg) * 255))),
    Math.round(Math.max(0, Math.min(255, gamma(lb) * 255))),
  ];
}

export function applyCustomHue(hue: number) {
  const [r, g, b] = oklchToRgb(0.7, 0.2, hue);
  const html = document.documentElement;
  delete html.dataset.brand;
  html.style.setProperty("--brand", `oklch(0.7 0.2 ${hue})`);
  html.style.setProperty("--color-brand", `oklch(0.7 0.2 ${hue})`);
  // Lightness is pinned at 0.7 for every hue, so black is always the higher-contrast
  // foreground here (measured 7.04:1 worst case across the hue circle, vs 2.23:1 for white).
  html.style.setProperty("--brand-foreground", "oklch(0 0 0)");
  html.style.setProperty("--brand-card-bg", `rgba(${r},${g},${b},0.07)`);
  html.style.setProperty("--brand-card-border", `rgba(${r},${g},${b},0.18)`);
  html.style.setProperty("--brand-glow", `rgba(${r},${g},${b},0.25)`);
  localStorage.setItem(CUSTOM_HUE_STORAGE_KEY, String(hue));
  localStorage.removeItem(BRAND_THEME_STORAGE_KEY);
}

export function applyBrandTheme(key: BrandThemeKey) {
  const html = document.documentElement;
  html.style.removeProperty("--brand");
  html.style.removeProperty("--color-brand");
  html.style.removeProperty("--brand-foreground");
  html.style.removeProperty("--brand-card-bg");
  html.style.removeProperty("--brand-card-border");
  html.style.removeProperty("--brand-glow");
  if (key === "green") {
    delete html.dataset.brand;
  } else {
    html.dataset.brand = key;
  }
  localStorage.setItem(BRAND_THEME_STORAGE_KEY, key);
  localStorage.removeItem(CUSTOM_HUE_STORAGE_KEY);
}

export function ThemeColorPicker() {
  const [activePreset, setActivePreset] = useState<BrandThemeKey | null>("green");
  const [hue, setHue] = useState<number | null>(null);

  useEffect(() => {
    const savedHue = localStorage.getItem(CUSTOM_HUE_STORAGE_KEY);
    if (savedHue !== null) {
      const h = Number(savedHue);
      setHue(h);
      setActivePreset(null);
      applyCustomHue(h);
      return;
    }
    const savedTheme = localStorage.getItem(BRAND_THEME_STORAGE_KEY) as BrandThemeKey | null;
    if (savedTheme && BRAND_THEMES.some((t) => t.key === savedTheme)) {
      setActivePreset(savedTheme);
      applyBrandTheme(savedTheme);
    }
  }, []);

  function handlePreset(key: BrandThemeKey) {
    setActivePreset(key);
    setHue(null);
    applyBrandTheme(key);
  }

  function handleHueChange(h: number) {
    setHue(h);
    setActivePreset(null);
    applyCustomHue(h);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Accent colour
      </p>

      {/* Hue slider */}
      <div className="space-y-1.5">
        <div
          className="relative h-7 rounded-full overflow-hidden"
          style={{
            background:
              "linear-gradient(to right," +
              "hsl(0,80%,60%),hsl(30,80%,60%),hsl(60,80%,60%),hsl(90,80%,60%)," +
              "hsl(120,80%,60%),hsl(150,80%,60%),hsl(180,80%,60%),hsl(210,80%,60%)," +
              "hsl(240,80%,60%),hsl(270,80%,60%),hsl(300,80%,60%),hsl(330,80%,60%),hsl(360,80%,60%))",
          }}
        >
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={hue ?? 149}
            onChange={(e) => handleHueChange(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label="Colour hue"
          />
          {hue !== null && (
            <div
              className="absolute top-1 bottom-1 w-5 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `calc(${(hue / 360) * 100}% - 10px)`,
                background: `oklch(0.7 0.2 ${hue})`,
              }}
            />
          )}
        </div>
      </div>

      {/* Preset swatches */}
      <div className="flex gap-3 flex-wrap">
        {BRAND_THEMES.map(({ key, label, hex }) => (
          <button
            key={key}
            title={label}
            onClick={() => handlePreset(key)}
            className="relative h-8 w-8 rounded-full transition-transform active:scale-90"
            style={{ background: hex }}
          >
            {activePreset === key && (
              <CheckIcon className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
