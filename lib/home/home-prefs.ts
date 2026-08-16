import { Scale, Footprints, Flame, Route, Beef, Wheat, Droplets, type LucideIcon } from "lucide-react";
import type { CardSectionKey } from "@/components/home/home-card-widget";

export type MetaKey = "weightKg" | "steps" | "calories" | "protein" | "carb" | "fat" | "distanceKm" | "waterIntake";
export type CardWidgetKey =
  | "weightSparkline" | "nutritionDonut" | "sleepWidget" | "stepsWidget" | "moodWidget"
  | "acwrWidget" | "muscleStatusWidget" | "hrChartWidget" | "energyBalanceWidget";

export interface WidgetDef {
  key: MetaKey;
  label: string;
  unit: string;
  icon: LucideIcon;
  color: string;
}

export const WIDGET_DEFS: WidgetDef[] = [
  { key: "weightKg",   label: "Body Weight", unit: "kg", icon: Scale,      color: "#00d4ff" },
  { key: "steps",      label: "Steps",       unit: "",   icon: Footprints, color: "#22c55e" },
  { key: "calories",   label: "Calories",    unit: "",   icon: Flame,      color: "#f97316" },
  { key: "distanceKm", label: "Distance",    unit: "km", icon: Route,      color: "#2dd4bf" },
  { key: "protein",    label: "Protein",     unit: "g",  icon: Beef,       color: "#f43f5e" },
  { key: "carb",       label: "Carbs",       unit: "g",  icon: Wheat,      color: "#f59e0b" },
  { key: "fat",        label: "Fat",         unit: "g",  icon: Droplets,   color: "#a78bfa" },
  { key: "waterIntake", label: "Water", unit: "ml", icon: Droplets, color: "#38bdf8" },
];


export const WIDGETS_KEY         = "ta_ss_widgets";
export const CARD_WIDGETS_KEY    = "ta_ss_cards";
export const PILL_COLORS_KEY     = "ta_pill_colors";

export function loadPillColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(PILL_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export const CARD_COLORS_KEY = "ta_card_colors"
export function loadCardColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CARD_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export const STEPS_GOAL_KEY      = "ta_steps_goal";
export const STEPS_GOAL_TYPE_KEY = "ta_steps_goal_type";
export const SLEEP_GOAL_KEY      = "ta_sleep_goal_hours";
export const CALORIE_GOAL_KEY    = "ta_calorie_goal_kcal";
export const CALORIE_TYPE_KEY    = "ta_calorie_goal_type";
export const WATER_GOAL_KEY      = "ta_water_goal_ml";
export const WATER_GOAL_TYPE_KEY = "ta_water_goal_type";
export const TARGET_WEIGHT_KEY   = "ta_target_weight_kg";
export const TARGET_BF_KEY       = "ta_target_bf_pct";
export const WEIGHT_LOOKBACK_KEY = "ta_weight_lookback";

/**
 * The nine goal values that also live in `localStorage`, and the direction that copy flows (Q-241).
 *
 * It used to flow both ways: every editor wrote `localStorage` **and** PATCHed the server, and the
 * Health tab then read three of them (water, target weight, target body fat) from the device copy
 * only. `localStorage` does not sync, so a second device, a re-install or the gap between the web
 * surface and the APK left the server holding the real goals while the app rendered defaults, with
 * nothing to reconcile the two.
 *
 * Now the server payload is the source of truth and this writes the seed *from* it — never the
 * reverse. The seed survives only to make the first paint synchronous, so a goal-driven card does
 * not flash a default before `/api/user/goals` resolves. A null on the server clears the seed
 * rather than leaving a stale device value to be read as current.
 */
export interface GoalSeedValues {
  stepsGoal: number | null;
  stepsGoalType: "daily" | "weekly" | null;
  sleepGoalHours: number | null;
  calorieGoal: number | null;
  calorieGoalType: "daily" | "weekly" | null;
  waterGoalMl: number | null;
  waterGoalType: "daily" | "weekly" | null;
  targetWeightKg: number | null;
  targetBfPct: number | null;
}

export function hydrateGoalSeeds(goals: GoalSeedValues | null | undefined): void {
  if (!goals || typeof window === "undefined") return;
  const write = (key: string, value: number | string | null) => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch { /* private mode / quota — the server payload is still authoritative */ }
  };
  write(STEPS_GOAL_KEY, goals.stepsGoal);
  write(STEPS_GOAL_TYPE_KEY, goals.stepsGoalType);
  write(SLEEP_GOAL_KEY, goals.sleepGoalHours);
  write(CALORIE_GOAL_KEY, goals.calorieGoal);
  write(CALORIE_TYPE_KEY, goals.calorieGoalType);
  write(WATER_GOAL_KEY, goals.waterGoalMl);
  write(WATER_GOAL_TYPE_KEY, goals.waterGoalType);
  write(TARGET_WEIGHT_KEY, goals.targetWeightKg);
  write(TARGET_BF_KEY, goals.targetBfPct);
}
export const DEFAULT_WIDGETS: MetaKey[]      = ["weightKg", "steps", "calories"];
export const DEFAULT_CARD_WIDGETS: CardWidgetKey[] = [];

export function loadWidgets(): MetaKey[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WIDGETS_KEY) : null;
    return raw ? JSON.parse(raw) : DEFAULT_WIDGETS;
  } catch { return DEFAULT_WIDGETS; }
}

export function loadCardWidgets(): CardWidgetKey[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CARD_WIDGETS_KEY) : null;
    return raw ? JSON.parse(raw) : DEFAULT_CARD_WIDGETS;
  } catch { return DEFAULT_CARD_WIDGETS; }
}

export function loadCalorieGoal(): number | null {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CALORIE_GOAL_KEY) : null;
    return raw ? Number(raw) : null;
  } catch { return null; }
}

export function loadCalorieType(): "daily" | "weekly" {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CALORIE_TYPE_KEY) : null;
    return raw === "weekly" ? "weekly" : "daily";
  } catch { return "daily"; }
}

export function loadWeightLookback(): 7 | 30 {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WEIGHT_LOOKBACK_KEY) : null;
    return raw === "30" ? 30 : 7;
  } catch { return 7; }
}

// Home score-circle frame style (owner-directed, 2026-07-23/26 rounds 4-5) — a user preference, not a
// single app-wide design choice, per the owner's "let the user pick" idea. "default" is a plain closed
// circle (the calmest option); "openring" has a deliberate gap; "perforated" traces the circle in dots;
// "accentring" reproduces the design shipped just before round 4 (a fixed accent arc + a dot), kept
// selectable so switching to the new look is reversible; "halo" drops the stroke entirely for a soft
// blurred glow behind the icon. Each style renders at its own tuned size — perforated needs denser dots
// at a smaller diameter to read as texture; accentring keeps its original (smaller) size rather than
// being stretched to match the newer styles.
// The 2026-08-07 round added six owner-picked styles. Three of them ("pill", "rail", and the two
// tiles) change the row's *layout*, not just the frame around each circle — so this preference is
// no longer strictly a "ring" choice, and the component maps each value to a layout family rather
// than assuming every style draws a circle.
export type ScoreRingStyle =
  | "default" | "openring" | "perforated" | "accentring" | "halo"
  | "bare" | "watermark" | "squircle" | "frosted" | "pill" | "rail"
  | "overlap" | "duorail"
  | "footnote" | "nolabel" | "accentrule" | "divider"
  | "band" | "underline";
export const SCORE_RING_STYLE_KEY = "ta_score_ring_style";
export const DEFAULT_SCORE_RING_STYLE: ScoreRingStyle = "default";
export const SCORE_RING_STYLES: { value: ScoreRingStyle; label: string; description: string }[] = [
  { value: "default",    label: "Default",    description: "A plain circle outline." },
  { value: "openring",   label: "Open ring",  description: "A circle with a deliberate gap." },
  { value: "perforated", label: "Perforated", description: "Small dots trace the circle." },
  { value: "accentring", label: "Accent ring", description: "Coloured arc + dot — how it looked before this update." },
  { value: "halo",       label: "Halo",        description: "No stroke — a soft glow behind the icon instead." },
  { value: "bare",       label: "Bare",        description: "No frame at all — just the icon and the number." },
  { value: "watermark",  label: "Watermark",   description: "The icon blown up behind the number as a faint field." },
  { value: "squircle",   label: "Squircle",    description: "A rounded tile tinted with the metric's colour." },
  { value: "frosted",    label: "Frosted",     description: "A translucent panel that catches the wallpaper behind it." },
  { value: "pill",       label: "Pill row",    description: "Compact — icon and number side by side. Frees ~90dp." },
  { value: "rail",       label: "Rail",        description: "One divided bar instead of four separate buttons." },
  { value: "overlap",    label: "Overlap",     description: "The icon sits on the corner of the number, breaking its edge." },
  { value: "duorail",    label: "Duotone rail", description: "The rail, with each glyph doubled — one faint and large, one small and solid." },
  { value: "footnote",   label: "Footnote",    description: "Number first; the icon and name sit underneath it as a footnote." },
  { value: "nolabel",    label: "No label",    description: "Icon and number only — the glyph is the name." },
  { value: "accentrule", label: "Accent rule", description: "A hairline in the metric's colour under each cell." },
  { value: "divider",    label: "Divider",     description: "Hairlines between the four and nothing else." },
  { value: "band",       label: "Band",        description: "One hairline above and below, edge to edge." },
  { value: "underline",  label: "Underline",   description: "A single edge-to-edge hairline under the row." },
];

const SCORE_RING_STYLE_VALUES = new Set<string>(SCORE_RING_STYLES.map(s => s.value));

export function loadScoreRingStyle(): ScoreRingStyle {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SCORE_RING_STYLE_KEY) : null;
    return raw && SCORE_RING_STYLE_VALUES.has(raw) ? (raw as ScoreRingStyle) : DEFAULT_SCORE_RING_STYLE;
  } catch { return DEFAULT_SCORE_RING_STYLE; }
}

// Dispatched after writing SCORE_RING_STYLE_KEY so any already-mounted reader (e.g. the home screen,
// which the Next.js router cache can keep alive across a tab switch without remounting) updates live
// instead of only picking up the change on a full app restart.
export const SCORE_RING_STYLE_CHANGE_EVENT = "ta:score-ring-style-change";

export function loadStepsGoal(): number {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STEPS_GOAL_KEY) : null;
    const n = raw ? parseInt(raw, 10) : NaN;
    return isNaN(n) ? 10000 : n;
  } catch { return 10000; }
}

export function loadStepsGoalType(): "daily" | "weekly" {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STEPS_GOAL_TYPE_KEY) : null;
    return raw === "weekly" ? "weekly" : "daily";
  } catch { return "daily"; }
}

export function loadSleepGoal(): number {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SLEEP_GOAL_KEY) : null;
    const n = raw ? parseFloat(raw) : NaN;
    return isNaN(n) ? 8 : n;
  } catch { return 8; }
}

export function loadWaterGoal(): number | null {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WATER_GOAL_KEY) : null;
    const n = raw ? parseInt(raw, 10) : NaN;
    return isNaN(n) ? null : n;
  } catch { return null; }
}

export function loadWaterGoalType(): "daily" | "weekly" {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WATER_GOAL_TYPE_KEY) : null;
    return raw === "weekly" ? "weekly" : "daily";
  } catch { return "daily"; }
}

export type SectionKey = "recommendation" | "streak" | "weekStrip" | "metricTiles" | CardSectionKey;
export const NON_CARD_SECTIONS: SectionKey[] = ["recommendation", "streak", "weekStrip", "metricTiles"];
export const SECTION_ORDER_KEY   = "ta_home_section_order";
export const HIDDEN_SECTIONS_KEY = "ta_home_hidden_sections";

export function loadHiddenSections(): Set<SectionKey> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(HIDDEN_SECTIONS_KEY) : null;
    return raw ? new Set(JSON.parse(raw) as SectionKey[]) : new Set();
  } catch { return new Set(); }
}

export function buildDefaultOrder(activeCards: CardWidgetKey[]): SectionKey[] {
  const order: SectionKey[] = ["recommendation", "streak", "weekStrip"];
  activeCards.forEach(k => order.push(`card_${k}` as CardSectionKey));
  order.push("metricTiles");
  return order;
}

export function loadSectionOrder(activeCards: CardWidgetKey[]): SectionKey[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SECTION_ORDER_KEY) : null;
    if (!raw) return buildDefaultOrder(activeCards);
    let parsed: string[] = JSON.parse(raw);
    // Migrate old "cardWidgets" block → individual card keys at the same position
    if (parsed.includes("cardWidgets")) {
      const idx = parsed.indexOf("cardWidgets");
      const cardKeys = activeCards.map(k => `card_${k}`);
      parsed = [...parsed.slice(0, idx), ...cardKeys, ...parsed.slice(idx + 1)];
      parsed = parsed.filter(k => k !== "cardWidgets");
    }
    // Filter out any stale/unknown keys (e.g. moodCheckin from a previous migration)
    const knownKeys = new Set<string>([...NON_CARD_SECTIONS, ...activeCards.map(k => `card_${k}`)]);
    const filtered = parsed.filter(k => knownKeys.has(k));
    const missing = NON_CARD_SECTIONS.filter(k => !filtered.includes(k));
    return [...filtered, ...missing] as SectionKey[];
  } catch { return buildDefaultOrder(activeCards); }
}
