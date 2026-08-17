"use client";

import { memo, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTransitionRouter } from "@/lib/view-transition";
import { Zap, Moon, Flame, HeartPulse, TriangleAlert, type LucideIcon } from "lucide-react";
import { scoreBand } from "@trainingai/shared/health/score-band";
import { loadScoreRingStyle, SCORE_RING_STYLE_CHANGE_EVENT, type ScoreRingStyle } from "@/lib/home/home-prefs";
import {
  SolidRingFrame, OpenRingFrame, PerforatedRingFrame, AccentRingFrame, HaloFrame,
} from "@/components/home/score-ring-frames";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";

interface Props {
  readiness: ReadinessScoreResponse;
}

// State cue for a 0–100 score card (Readiness / Sleep / Activity). Only the "accentring" style
// renders it visually (every other style dropped the cue — their colour lives on the icon, where it
// identifies the metric rather than its state); the word always feeds the aria-label so the live
// good/moderate/low read stays available to screen readers regardless of which visual style is
// active.
function scoreCue(value: number | null): { color: string; word: string } | null {
  if (value == null) return null;
  const b = scoreBand(value);
  return { color: b.color, word: b.label };
}

// Resting-HR cue — NOT a 0–100 score, so this is a status tier rather than a fabricated percentage.
function restingHrCue(bpm: number | null, baseline: number | null): { color: string; word: string } | null {
  if (bpm == null) return null;
  if (baseline == null) return { color: "hsl(var(--muted-foreground))", word: "Resting" };
  const delta = bpm - baseline;
  if (delta <= -2) return { color: scoreBand(85).color, word: "Low" };
  if (delta <= 2) return { color: scoreBand(75).color, word: "Steady" };
  if (delta <= 5) return { color: scoreBand(60).color, word: "Elevated" };
  return { color: scoreBand(40).color, word: "High" };
}

// Which layout family a style belongs to. The five original styles and the two frameless ones added
// 2026-08-07 all draw a circle-shaped cell; the rest restructure the row itself, which is why this
// mapping exists rather than the component assuming a circle for every value.
type ScoreLayout = "circle" | "tile" | "pill" | "rail" | "minimal" | "band";
const STYLE_LAYOUT: Record<ScoreRingStyle, ScoreLayout> = {
  default: "circle", openring: "circle", perforated: "circle", accentring: "circle", halo: "circle",
  bare: "circle", watermark: "circle", overlap: "circle",
  squircle: "tile", frosted: "tile",
  pill: "pill",
  rail: "rail", duorail: "rail",
  footnote: "minimal", nolabel: "minimal", accentrule: "minimal", divider: "minimal",
  band: "band", underline: "band",
};

// Each circle style renders at its own tuned size/content treatment — perforated needs a smaller,
// denser ring to read as texture; the plain, open-ring and halo strokes scale identically, so they
// share the larger size. "accentring" reproduces the design shipped just before the 2026-07-23
// round at its original (smaller) size, with a white icon + a coloured dot instead of a coloured
// icon. "bare" and "watermark" have no frame, so they reserve a smaller box — the row gets ~20dp
// shorter, which is most of the point of choosing them.
const RING_GEOMETRY: Record<string, { size: number; iconPx: number; numRem: number; coloredIcon: boolean; showDot: boolean }> = {
  default:    { size: 114, iconPx: 20, numRem: 2.15, coloredIcon: true,  showDot: false },
  openring:   { size: 114, iconPx: 20, numRem: 2.15, coloredIcon: true,  showDot: false },
  perforated: { size: 94,  iconPx: 17, numRem: 1.75, coloredIcon: true,  showDot: false },
  accentring: { size: 80,  iconPx: 14, numRem: 1.7,  coloredIcon: false, showDot: true  },
  halo:       { size: 114, iconPx: 20, numRem: 2.15, coloredIcon: true,  showDot: false },
  bare:       { size: 92,  iconPx: 22, numRem: 2.25, coloredIcon: true,  showDot: false },
  watermark:  { size: 96,  iconPx: 20, numRem: 2.4,  coloredIcon: true,  showDot: false },
  overlap:    { size: 92,  iconPx: 26, numRem: 2.45, coloredIcon: true,  showDot: false },
};

interface CellProps {
  label: string;
  /** Abbreviated name for layouts whose lane is too narrow for the full one. Only the band family
   *  uses it today; the aria-label always carries `label` in full. */
  short: string;
  display: string; // the big value (a score, or a bpm for HR)
  cue: { color: string; word: string } | null;
  /** The card's identity colour — carried by the icon in every style except accentring, whose icon
   *  stays white to match its original look. Never encodes state. */
  accent: string;
  href: string;
  Icon: LucideIcon;
  ringStyle: ScoreRingStyle;
  lowWear?: boolean;
  /** Score computed from fewer than the usual inputs. Marked, not dimmed — the reading itself is
   *  trustworthy, there is just less behind it. */
  limited?: boolean;
}

/** Warm the destination's RSC payload before it's tapped. Without this the fetch starts at tap
 *  time, and the view transition holds the outgoing screen frozen until it lands — which is the
 *  delay these four cards were reported for. `<Link>` does this automatically on viewport entry; a
 *  button calling router.push() gets nothing, and all four are on screen from first paint. */
function useScoreNav(href: string) {
  const router = useTransitionRouter();
  useEffect(() => { router.prefetch(href); }, [router, href]);
  return () => router.push(href);
}

function ariaLabelFor({ label, display, cue, lowWear, limited }: CellProps) {
  return `${label}: ${display}${cue ? `, ${cue.word}` : ""}${lowWear ? " — ring wasn't worn enough hours today for a confident reading" : ""}${limited ? " — based on part of the usual inputs" : ""}`;
}

/** The label line under a cell, plus the warning glyph when the reading is qualified. */
function CellLabel({ label, lowWear, limited, display, className, style }: { label: string; lowWear?: boolean; limited?: boolean; display: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={className ?? "flex items-center gap-0.5 text-[11px] leading-none text-muted-foreground"} style={style}>
      {label}
      {(lowWear || limited) && display !== "—" && <TriangleAlert className="h-2.5 w-2.5" />}
    </span>
  );
}

/** Shared tap target. Every layout is one flat <button> — never a button inside a button, which
 *  Samsung's WebView silently strips. */
function CellButton({ props, className, style, children }: { props: CellProps; className: string; style?: CSSProperties; children: ReactNode }) {
  const go = useScoreNav(props.href);
  return (
    <button
      onClick={go}
      aria-label={ariaLabelFor(props)}
      className={className}
      style={{ opacity: props.lowWear ? 0.6 : 1, willChange: "transform", ...style }}
    >
      {children}
    </button>
  );
}

/** Circle family: default / openring / perforated / accentring / halo / bare / watermark. */
function ScoreCircle(props: CellProps) {
  const { display, accent, Icon, ringStyle } = props;
  const geo = RING_GEOMETRY[ringStyle];

  return (
    <CellButton props={props} className="flex flex-1 min-w-0 flex-col items-center gap-1.5 transition active:scale-95">
      {/* Equal-width flex lane (flex-1, min-w-0) + a max-width cap + the row's gap between siblings
          guarantee the cells can shrink together but never overlap, at any screen width. */}
      <span className="relative aspect-square w-full" style={{ maxWidth: geo.size }}>
        {ringStyle === "perforated" ? <PerforatedRingFrame size={geo.size} />
          : ringStyle === "openring" ? <OpenRingFrame size={geo.size} />
          : ringStyle === "accentring" ? <AccentRingFrame size={geo.size} accent={accent} />
          : ringStyle === "halo" ? <HaloFrame accent={accent} />
          : ringStyle === "watermark" ? (
            <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
              <Icon style={{ width: geo.size * 0.68, height: geo.size * 0.68, color: accent, opacity: 0.16 }} strokeWidth={1.6} />
            </span>
          )
          : ringStyle === "bare" || ringStyle === "overlap" ? null
          : <SolidRingFrame size={geo.size} />}
        {ringStyle === "overlap" ? (
          // The icon deliberately breaks the numerals' bounding box rather than sitting above it,
          // so it is positioned against the centred number instead of stacked in the flex column.
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="font-black leading-none tabular-nums tracking-tight text-foreground" style={{ fontSize: `${geo.numRem}rem` }}>
              {display}
            </span>
            <Icon
              className="absolute"
              style={{ width: geo.iconPx, height: geo.iconPx, color: accent, left: "50%", top: "22%", transform: "translateX(-158%)" }}
            />
          </span>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center">
            {/* The watermark IS the icon, blown up behind the number — drawing it twice would read
                as a mistake, so the small copy is dropped for that style only. */}
            {ringStyle !== "watermark" && (
              <Icon className="mb-0.5" style={{ width: geo.iconPx, height: geo.iconPx, color: geo.coloredIcon ? accent : "var(--foreground)" }} />
            )}
            <span
              className="font-black leading-none tabular-nums tracking-tight text-foreground"
              style={{ fontSize: `${geo.numRem}rem` }}
            >
              {display}
            </span>
            {/* The dot alone carried the band, which is the colour-only-state violation the repo
                rule names (Q-281 audit — the one real instance of it). The word rides beside it so
                the band survives a red/green deficit; it is set small enough that the cue's height
                is unchanged and the row does not grow. */}
            {geo.showDot && props.cue && (
              <span className="mt-1.5 flex items-center gap-[3px]" style={{ color: props.cue.color }} aria-hidden>
                <span className="h-[8px] w-[8px] flex-none rounded-full" style={{ background: props.cue.color }} />
                <span className="text-[7.5px] font-bold uppercase leading-none tracking-[0.08em]">{props.cue.word}</span>
              </span>
            )}
          </span>
        )}
      </span>
      <CellLabel {...props} />
    </CellButton>
  );
}

/** Tile family: squircle (tinted in the metric's colour) and frosted (translucent over the
 *  wallpaper). Both are square-ish surfaces rather than circles. */
function ScoreTile(props: CellProps) {
  const { display, accent, Icon, ringStyle } = props;
  const frosted = ringStyle === "frosted";
  return (
    <CellButton
      props={props}
      className="flex flex-1 min-w-0 flex-col justify-between gap-1 rounded-[22px] border p-2.5 text-left transition active:scale-95"
      style={frosted
        ? {
            background: "color-mix(in oklch, var(--card) 45%, transparent)",
            borderColor: "var(--border)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            minHeight: 96,
          }
        : {
            background: `linear-gradient(160deg, ${accent}26, ${accent}0d)`,
            borderColor: `${accent}3d`,
            minHeight: 96,
          }}
    >
      <Icon style={{ width: 19, height: 19, color: accent }} />
      <span className="flex flex-col gap-0.5">
        <span className="font-black leading-none tabular-nums tracking-tight text-foreground" style={{ fontSize: "1.75rem" }}>
          {display}
        </span>
        <CellLabel {...props} className="flex items-center gap-0.5 text-[10px] leading-none text-muted-foreground" />
      </span>
    </CellButton>
  );
}

/** The minimal family's numerals. Slightly lighter and more tightly tracked than the framed
 *  styles' `font-black tracking-tight` — with no frame, fill or container left, the type is the
 *  only thing carrying the cell, so it is set deliberately rather than inherited. */
function MinimalNumber({ children, rem }: { children: string; rem: number }) {
  return (
    <span
      className="leading-none tabular-nums text-foreground"
      style={{ fontSize: `${rem}rem`, fontWeight: 800, letterSpacing: "-0.045em" }}
    >
      {children}
    </span>
  );
}

/** Minimal family: footnote / nolabel / accentrule / divider. No frame, no fill, no container —
 *  each differs only in stack order, what is deleted, and what mark (if any) closes the cell. */
function ScoreMinimal({ props, first }: { props: CellProps; first: boolean }) {
  const { display, accent, Icon, ringStyle } = props;
  const qualified = (props.lowWear || props.limited) && display !== "—";

  if (ringStyle === "footnote") {
    return (
      <CellButton props={props} className="flex flex-1 min-w-0 flex-col items-center gap-[7px] pt-[18px] pb-1 transition active:scale-95">
        <MinimalNumber rem={2.4}>{display}</MinimalNumber>
        <span className="flex items-center gap-1">
          <Icon style={{ width: 12, height: 12, color: accent }} strokeWidth={2.6} />
          <CellLabel {...props} />
        </span>
      </CellButton>
    );
  }

  if (ringStyle === "nolabel") {
    return (
      <CellButton props={props} className="flex flex-1 min-w-0 flex-col items-center gap-[7px] py-5 transition active:scale-95">
        <Icon style={{ width: 20, height: 20, color: accent }} strokeWidth={2.3} />
        <span className="flex items-center gap-1">
          <MinimalNumber rem={2.3}>{display}</MinimalNumber>
          {qualified && <TriangleAlert className="h-2.5 w-2.5 text-muted-foreground" />}
        </span>
      </CellButton>
    );
  }

  if (ringStyle === "accentrule") {
    return (
      <CellButton props={props} className="flex flex-1 min-w-0 flex-col items-center gap-[7px] pt-3.5 transition active:scale-95">
        <Icon style={{ width: 17, height: 17, color: accent }} strokeWidth={2.3} />
        <MinimalNumber rem={2.25}>{display}</MinimalNumber>
        <CellLabel {...props} />
        <span className="mt-1.5 h-[1.5px] w-full rounded-full" style={{ background: accent, opacity: 0.8 }} aria-hidden />
      </CellButton>
    );
  }

  // divider — the rule sits between the lanes rather than under them, so it belongs to the sibling
  // boundary and the first cell carries none.
  return (
    <CellButton
      props={props}
      className="flex flex-1 min-w-0 flex-col items-center gap-[7px] pt-3 pb-1 transition active:scale-95"
      style={first ? undefined : { borderLeft: "1px solid var(--border)" }}
    >
      <Icon style={{ width: 17, height: 17, color: accent }} strokeWidth={2.3} />
      <MinimalNumber rem={2.2}>{display}</MinimalNumber>
      <CellLabel {...props} />
    </CellButton>
  );
}

/** Band family: band / underline. The hairlines run edge to edge past the page gutters, so this is
 *  the one layout whose wrapper is full-bleed and whose cells carry the horizontal padding
 *  themselves — the point is a rule that spans the screen, not one inset to match the cards. */
function ScoreBandCell(props: CellProps) {
  const { display, short, accent, Icon } = props;
  return (
    <CellButton props={props} className="flex flex-1 min-w-0 flex-col items-center gap-2 transition active:scale-95">
      <Icon style={{ width: 15, height: 15, color: accent }} strokeWidth={2.2} />
      <span className="leading-none tabular-nums text-foreground" style={{ fontSize: "2.1rem", fontWeight: 700, letterSpacing: "-0.045em" }}>
        {display}
      </span>
      <CellLabel
        {...props}
        label={short}
        className="flex items-center gap-1 uppercase leading-none text-muted-foreground"
        style={{ fontSize: "8.5px", letterSpacing: "0.16em" }}
      />
    </CellButton>
  );
}

function BandRule() {
  return <span className="block h-px w-full bg-border" aria-hidden />;
}

/** Pill family: icon and number side by side in a short capsule. The row drops from ~140dp to
 *  ~52dp, which is the whole reason to pick it — so the label is carried by the aria-label only. */
function ScorePill(props: CellProps) {
  const { display, accent, Icon } = props;
  return (
    <CellButton
      props={props}
      className="flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-2xl border transition active:scale-95"
      // minHeight is inline, not a Tailwind arbitrary class: this is the 48dp tap-target floor and
      // it must not depend on a JIT-generated class surviving a class-order or purge change.
      style={{ background: `${accent}1a`, borderColor: `${accent}33`, minHeight: 52 }}
    >
      <Icon style={{ width: 17, height: 17, color: accent }} />
      <span className="font-black leading-none tabular-nums tracking-tight text-foreground" style={{ fontSize: "1.2rem" }}>
        {display}
      </span>
      {(props.lowWear || props.limited) && display !== "—" && <TriangleAlert className="h-2.5 w-2.5 text-muted-foreground" />}
    </CellButton>
  );
}

/** Rail family: one divided bar. The container is a plain div holding four buttons — the divider is
 *  a border on the sibling, never a wrapper button, so no interactive element is nested. */
function ScoreRailCell({ props, first }: { props: CellProps; first: boolean }) {
  const { display, accent, Icon, ringStyle } = props;
  const duotone = ringStyle === "duorail";
  return (
    <CellButton
      props={props}
      className="relative flex flex-1 min-w-0 flex-col items-center gap-1 overflow-hidden px-1 py-2.5 transition active:scale-95"
      style={first ? undefined : { borderLeft: "1px solid var(--border)" }}
    >
      {/* Duotone: the same glyph twice at two scales. At rail density a 16px icon nearly vanishes
          against the wallpaper, so the large faint copy is what actually carries the metric's
          colour — the small solid one keeps it legible as a shape. */}
      {duotone && (
        <span className="absolute inset-0 grid place-items-center" aria-hidden>
          <Icon style={{ width: 58, height: 58, color: accent, opacity: 0.2 }} strokeWidth={1.5} />
        </span>
      )}
      <Icon className="relative" style={{ width: 16, height: 16, color: accent }} />
      <span className="relative font-black leading-none tabular-nums tracking-tight text-foreground" style={{ fontSize: "1.3rem" }}>
        {display}
      </span>
      <CellLabel {...props} className="relative flex items-center gap-0.5 text-[9.5px] leading-none text-muted-foreground" />
    </CellButton>
  );
}

export const OuraScoreChipRow = memo(function OuraScoreChipRow({ readiness }: Props) {
  const [ringStyle, setRingStyle] = useState<ScoreRingStyle>("default");
  useEffect(() => {
    setRingStyle(loadScoreRingStyle());
    const onChange = () => setRingStyle(loadScoreRingStyle());
    window.addEventListener(SCORE_RING_STYLE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SCORE_RING_STYLE_CHANGE_EVENT, onChange);
  }, []);

  if (
    readiness.readinessDisplayScore == null &&
    readiness.restingHr == null &&
    readiness.hrCurrent == null &&
    readiness.sleepScore == null &&
    readiness.activityScore == null
  ) {
    return null;
  }

  const hr = readiness.restingHr ?? readiness.hrCurrent;

  const cells: CellProps[] = [
    {
      label: "Readiness",
      short: "Ready",
      display: readiness.readinessDisplayScore != null ? String(readiness.readinessDisplayScore) : "—",
      cue: scoreCue(readiness.readinessDisplayScore),
      accent: "#60a5fa",
      href: "/health/readiness",
      Icon: Zap,
      ringStyle,
      lowWear: readiness.isLowWearToday,
      limited: readiness.limited,
    },
    {
      label: "Heart Rate",
      short: "HR",
      display: hr != null ? String(hr) : "—",
      cue: restingHrCue(hr, readiness.restingHrBaseline),
      accent: "#f87171",
      href: "/health/heart-rate",
      Icon: HeartPulse,
      ringStyle,
    },
    {
      label: "Sleep",
      short: "Sleep",
      display: readiness.sleepScore != null ? String(readiness.sleepScore) : "—",
      cue: scoreCue(readiness.sleepScore),
      accent: "#a78bfa",
      href: "/health/sleep",
      Icon: Moon,
      ringStyle,
    },
    {
      label: "Activity",
      short: "Move",
      display: readiness.activityScore != null ? String(readiness.activityScore) : "—",
      cue: scoreCue(readiness.activityScore),
      accent: "#f97316",
      href: "/health/activity",
      Icon: Flame,
      ringStyle,
    },
  ];

  const layout = STYLE_LAYOUT[ringStyle];

  if (layout === "rail") {
    return (
      <div
        className="mx-4 mb-3 flex overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05]"
        style={{ willChange: "transform" }}
      >
        {cells.map((c, i) => <ScoreRailCell key={c.label} props={c} first={i === 0} />)}
      </div>
    );
  }

  if (layout === "band") {
    return (
      <div className="mb-3" style={{ willChange: "transform" }}>
        {ringStyle === "band" && <BandRule />}
        <div className="flex px-4 pb-3.5 pt-4">
          {cells.map(c => <ScoreBandCell key={c.label} {...c} />)}
        </div>
        <BandRule />
      </div>
    );
  }

  if (layout === "minimal") {
    // "divider" draws its rules on the lane boundaries, so the lanes must sit flush — a gap would
    // leave each hairline floating in the middle of empty space instead of separating two cells.
    return (
      <div className={`mx-4 mb-3 flex justify-between ${ringStyle === "divider" ? "" : "gap-2"}`} style={{ willChange: "transform" }}>
        {cells.map((c, i) => <ScoreMinimal key={c.label} props={c} first={i === 0} />)}
      </div>
    );
  }

  const Cell = layout === "tile" ? ScoreTile : layout === "pill" ? ScorePill : ScoreCircle;

  return (
    <div className="mx-4 mb-3 flex justify-between gap-2" style={{ willChange: "transform" }}>
      {cells.map(c => <Cell key={c.label} {...c} />)}
    </div>
  );
});
