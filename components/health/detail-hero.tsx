"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { ChevronLeftIcon } from "lucide-react";
import { useBackOrFallback } from "@/lib/hooks/use-back-or-fallback";

export type HeroTheme = "sleep" | "readiness" | "activity" | "heart-rate";
export type ColorScheme = "dark" | "light";

// The hand-illustrated art below is designed dark-first (the app's reference
// look); light mode is a supported, lighter/desaturated variant of the same
// palette rather than separately-illustrated art. Defaults to "dark" until
// mounted, since next-themes' resolvedTheme is unknown during SSR/first paint.
export function useHeroColorScheme(): ColorScheme {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && resolvedTheme === "light" ? "light" : "dark";
}

const HERO_GRADIENTS: Record<HeroTheme, Record<ColorScheme, string>> = {
  sleep: {
    dark:  "linear-gradient(180deg, #060620 0%, #0d0b3a 30%, #1a0f4e 55%, #0f1533 80%, transparent 100%)",
    light: "linear-gradient(180deg, #e8eafb 0%, #dde1f7 30%, #d2d8f2 55%, #dde3f5 80%, transparent 100%)",
  },
  readiness: {
    dark:  "linear-gradient(180deg, #020a18 0%, #051830 25%, #083560 52%, #1a6090 75%, #e87030 90%, transparent 100%)",
    light: "linear-gradient(180deg, #e3f0ff 0%, #d3e8ff 25%, #bfdcff 52%, #ffdcb0 75%, #ffb877 90%, transparent 100%)",
  },
  activity: {
    dark:  "linear-gradient(180deg, #0d0a2e 0%, #1e1260 28%, #3d1a6e 52%, #7c2d00 76%, transparent 100%)",
    light: "linear-gradient(180deg, #ede8fb 0%, #e0d6f7 28%, #e6cef0 52%, #ffd8b8 76%, transparent 100%)",
  },
  "heart-rate": {
    dark:  "linear-gradient(180deg, #5c1010 0%, #3d0808 30%, #280505 60%, #1a0303 82%, transparent 100%)",
    light: "linear-gradient(180deg, #ffe1e1 0%, #ffcccc 30%, #ffb3b3 60%, #ff9e9e 82%, transparent 100%)",
  },
};

// Called from the consumer pages that paint a full-page background
// (health-score-detail.tsx, heart-rate/page.tsx, end-of-day-review.tsx).
// Returns a CSS variable reference rather than a scheme-branched JS value —
// next-themes stamps the `.dark` class on <html> synchronously before React
// hydrates, so the CSS cascade already resolves the right gradient on first
// paint with no mounted-gated read, unlike useHeroColorScheme() (used for the
// decorations, where a brief default-dark render is tolerated).
export function usePageGradient(theme: HeroTheme): string {
  return `var(--page-gradient-${theme})`;
}

// ── Sleep ────────────────────────────────────────────────────────────────────
function SleepDecoration() {
  const stars: [number, number, number][] = [
    [40, 28, 1.4], [100, 18, 1.0], [155, 44, 1.6], [200, 12, 1.1], [255, 48, 1.3],
    [60, 80, 1.0], [130, 95, 1.5], [230, 75, 1.2], [320, 22, 1.4], [360, 60, 1.0],
    [180, 90, 1.3], [290, 82, 1.6], [340, 38, 1.1], [80, 120, 1.0], [210, 130, 1.4],
  ];
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Crescent carved via mask rather than a bg-colour "cutout" disc, so it
            reads correctly against any sky (not just the dark one it was tuned for). */}
        <mask id="moonCrescentMask">
          <rect width="400" height="260" fill="black" />
          <circle cx="330" cy="54" r="26" fill="white" />
          <circle cx="340" cy="46" r="21" fill="black" />
        </mask>
      </defs>
      <circle cx="330" cy="54" r="26" fill="#e4defb" mask="url(#moonCrescentMask)" />
      <circle cx="330" cy="54" r="26" fill="none" stroke="#c4b5fd" strokeWidth="1.5" opacity="0.5" mask="url(#moonCrescentMask)" />
      {stars.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="white" opacity={0.4 + (i % 3) * 0.2} />
      ))}
    </svg>
  );
}

// ── Readiness — sunrise, blue sky, clouds ────────────────────────────────────
function ReadinessDecoration() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sunriseGlow" cx="50%" cy="100%" r="70%">
          <stop offset="0%"   stopColor="#ffd080" stopOpacity="0.95" />
          <stop offset="28%"  stopColor="#f5a040" stopOpacity="0.55" />
          <stop offset="62%"  stopColor="#e87030" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#e87030" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sunCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#fff8e0" />
          <stop offset="55%"  stopColor="#ffd060" />
          <stop offset="100%" stopColor="#f5a040" />
        </radialGradient>
      </defs>

      {/* Horizon glow — the sky itself is owned by HERO_GRADIENTS, shown through */}
      <rect width="400" height="260" fill="url(#sunriseGlow)" />

      {/* Faint stars — most have set at sunrise */}
      {[[42,20],[132,13],[308,26],[358,16]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="0.9" fill="white" opacity="0.38" />
      ))}

      {/* Sun disk rising from horizon */}
      <circle cx="200" cy="266" r="64" fill="url(#sunCore)" />
      <circle cx="200" cy="266" r="50" fill="#fff8e0" opacity="0.9" />

      {/* Horizon warm line */}
      <rect x="0" y="249" width="400" height="2.5" fill="#f5a040" opacity="0.65" />

      {/* Clouds — fluffy ellipses layered for depth */}
      <ellipse cx="72"  cy="90"  rx="62" ry="16" fill="white" opacity="0.26" />
      <ellipse cx="50"  cy="82"  rx="38" ry="11" fill="white" opacity="0.20" />
      <ellipse cx="95"  cy="80"  rx="28" ry="10" fill="white" opacity="0.18" />
      <ellipse cx="320" cy="108" rx="68" ry="18" fill="white" opacity="0.24" />
      <ellipse cx="348" cy="100" rx="44" ry="13" fill="white" opacity="0.19" />
      <ellipse cx="298" cy="100" rx="32" ry="11" fill="white" opacity="0.17" />
      <ellipse cx="188" cy="63"  rx="52" ry="13" fill="white" opacity="0.17" />
      <ellipse cx="158" cy="142" rx="40" ry="10" fill="#cce4f5" opacity="0.13" />
      <ellipse cx="285" cy="150" rx="36" ry="9"  fill="#cce4f5" opacity="0.11" />
    </svg>
  );
}

// ── Activity — twilight dusk mountain silhouette ──────────────────────────────
const MTN_NEAR_FILL: Record<ColorScheme, { top: string; bottom: string }> = {
  dark:  { top: "#0a0820", bottom: "#060412" },
  light: { top: "#9089ba", bottom: "#726a9c" },
};

function ActivityDecoration({ scheme }: { scheme: ColorScheme }) {
  const mtnNear = MTN_NEAR_FILL[scheme];
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mtnFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e1260" />
          <stop offset="100%" stopColor="#0d0a2e" />
        </linearGradient>
        <linearGradient id="mtnNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={mtnNear.top} />
          <stop offset="100%" stopColor={mtnNear.bottom} />
        </linearGradient>
      </defs>

      {/* Stars (just a few, early dusk) */}
      {[[40, 30], [120, 18], [280, 24], [360, 42], [195, 14]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.2" fill="white" opacity="0.55" />
      ))}

      {/* Far mountain range */}
      <path d="M-10 215 L32 145 L68 172 L106 116 L148 156 L192 104 L238 144 L276 110 L318 138 L365 106 L420 134 L420 270 L-10 270 Z"
        fill="url(#mtnFar)" opacity="0.6" />

      {/* Near mountain range — darker */}
      <path d="M-10 250 L26 182 L62 208 L98 158 L138 187 L182 136 L222 168 L264 142 L306 172 L348 146 L395 172 L420 270 L-10 270 Z"
        fill="url(#mtnNear)" opacity="0.92" />

      {/* Snow caps */}
      <path d="M98  158 L114 176 L82  176 Z" fill="white" opacity="0.5" />
      <path d="M182 136 L200 156 L164 156 Z" fill="white" opacity="0.6" />
      <path d="M264 142 L282 161 L246 161 Z" fill="white" opacity="0.5" />
      <path d="M348 146 L364 163 L332 163 Z" fill="white" opacity="0.4" />

      {/* Horizon amber glow line */}
      <rect x="0" y="244" width="400" height="3" fill="#f97316" opacity="0.35" />
    </svg>
  );
}

// ── Heart Rate ────────────────────────────────────────────────────────────────
function HeartRateDecoration() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <polyline
        points="0,140 80,140 100,140 115,80 130,195 145,55 165,165 185,140 400,140"
        fill="none" stroke="#ef4444" strokeWidth="2" opacity="0.25"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

const DECORATIONS: Record<HeroTheme, React.FC<{ scheme: ColorScheme }>> = {
  sleep:        SleepDecoration,
  readiness:    ReadinessDecoration,
  activity:     ActivityDecoration,
  "heart-rate": HeartRateDecoration,
};

interface DetailHeroProps {
  theme: HeroTheme;
  title: string;
  children: React.ReactNode;
}

export function DetailHero({ theme, title, children }: DetailHeroProps) {
  const Decoration = DECORATIONS[theme];
  // Home, not /health: these screens are opened from the Home score circles, and
  // two of the four (readiness, activity) have no entry point on the Health screen
  // at all. This only applies when there is no in-app history to pop — a normal
  // open still returns wherever it was opened from.
  const goBack = useBackOrFallback("/");
  const scheme = useHeroColorScheme();
  const isLight = scheme === "light";

  // Decorations (stars, sun, mountains) are dark-first illustrations — most
  // read as white/pale shapes designed to pop against a night sky. Dimmed
  // rather than recolored in light mode, so a pale sky doesn't look broken.
  const scrim = isLight
    ? "linear-gradient(to top, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.82) 20%, rgba(255,255,255,0.60) 40%, rgba(255,255,255,0.22) 60%, transparent 78%)"
    : "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.82) 20%, rgba(0,0,0,0.60) 40%, rgba(0,0,0,0.22) 60%, transparent 78%)";
  const iconTextClass = isLight ? "text-neutral-900/90" : "text-white/90";
  const titleTextClass = isLight ? "text-neutral-900/80" : "text-white/80";
  const backHoverClass = isLight ? "hover:bg-black/5" : "hover:bg-white/10";

  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: 260 }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: HERO_GRADIENTS[theme][scheme] }} />
      {/* pointer-events-none so the full-cover decoration SVG can't swallow the back-button tap. */}
      <div className="pointer-events-none" style={{ opacity: isLight ? 0.4 : 1 }}>
        <Decoration scheme={scheme} />
      </div>
      {/* Strong linear gradient from bottom — score zone needs a readable backdrop */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: scrim }}
      />

      {/* z-20, above the children well below: that well is `relative z-10` spanning the
          full hero height, so at an equal z-index it painted later and silently swallowed
          every tap on this button — visible, correctly placed, and completely dead. */}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-1 px-3 pt-safe-or-4 pb-2 z-20">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className={`flex h-10 w-10 items-center justify-center rounded-full ${backHoverClass} transition-colors`}
          // Solid translucent chip so the chevron stays clearly visible (and tappable) over
          // any hero art in both light and dark themes — a bare chevron read as "no back button".
          style={{ background: isLight ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
        >
          <ChevronLeftIcon className={`h-6 w-6 ${iconTextClass}`} />
        </button>
        <h1 className={`text-sm font-semibold ${titleTextClass} ml-1`}>{title}</h1>
      </div>

      <div className="relative flex flex-col items-center justify-end pb-8 pt-16 z-10" style={{ minHeight: 260 }}>
        {children}
      </div>
    </div>
  );
}
