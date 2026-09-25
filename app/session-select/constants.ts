import type { CardWidgetKey } from "@/lib/home/home-prefs";

/** The one default-colour table. `components/more/home-widgets-section.tsx` used to keep a private
 *  copy of the ten widget keys — the picker's swatches came from that copy while the cards rendered
 *  from this one, so an edit to either showed a swatch the card did not honour (RV-102).
 *
 *  Typed over `CardWidgetKey` so adding a widget fails HERE rather than falling through to
 *  `undefined` at a call site; the three extra keys are cards that are not widgets and have no
 *  entry in the picker. The `CardWidgetKey` import is type-only on purpose — a value import would
 *  close a real cycle, since `home-prefs` reaches back to this file through `home-card-widget`. */
export const CARD_DEFAULT_COLORS: Record<CardWidgetKey | "streakLeft" | "streakRight" | "recommendedToday", string> = {
  weightSparkline:    "#00d4ff",
  nutritionDonut:     "#bf5fff",
  sleepWidget:        "#8b5cf6",
  stepsWidget:        "#2dd4bf",
  moodWidget:         "#fbbf24",
  streakLeft:         "#f97316",
  streakRight:        "#22c55e",
  recommendedToday:   "#06b6d4",
  acwrWidget:         "#f59e0b",
  muscleStatusWidget: "#22c55e",
  hrChartWidget:      "transparent",
  energyBalanceWidget: "#22c55e",
  collectionWidget: "#fb923c",
};
