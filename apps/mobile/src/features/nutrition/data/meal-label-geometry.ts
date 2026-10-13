import {
  MEAL_SHARE_MAX_BYTES,
  QR_BYTE_CAPACITY_M,
  qrModulesForVersion,
  qrVersionForBytes,
} from '@trainingai/shared/nutrition/label-payload';
export const SHEET = 189;
export const SQUARE_MARGIN = 9;
export const SQUARE_W = SHEET - SQUARE_MARGIN * 2;
export const STACK_LINE_H = 8;
export const DEFAULT_RENDER_SCALE = 6.24;
export const LABEL_SHEET_MM = 50;
export function labelPrintDpi(canvasPx: number): number {
  return canvasPx / (LABEL_SHEET_MM / 25.4);
}
export const USABLE_W = SQUARE_W;
export const USABLE_H = SQUARE_W;
export type MealLabelStyle =
  | 'inlineCentred'
  | 'band'
  | 'editorial'
  | 'ticket'
  | 'plaque'
  | 'square'
  | 'share';
export const MEAL_LABEL_STYLES: {
  value: MealLabelStyle;
  label: string;
  note: string;
}[] = [
  {
    value: 'inlineCentred',
    label: 'Ingredients · centred',
    note: 'The default. Name, calories, macros, as much of the ingredient list as fits, and the code — all centred.',
  },
  {
    value: 'band',
    label: 'Black band',
    note: 'Reversed header. The tightest code of the six — print this one first if you are checking a printer.',
  },
  { value: 'editorial', label: 'Editorial', note: 'The quietest of the six.' },
  { value: 'ticket', label: 'Deli ticket', note: 'Monospaced, dashed rules.' },
  {
    value: 'plaque',
    label: 'Plaque',
    note: 'Double ring, no write-on line — the second-largest code.',
  },
  {
    value: 'square',
    label: 'Big code',
    note: 'The code sits beside the calories rather than under them, so it stays large while the label still prints the ingredient list.',
  },
  {
    value: 'share',
    label: 'Share code',
    note: 'Name and a full-size code, nothing else. The only style whose code carries the whole recipe — send it to someone and they get the meal, not a link.',
  },
];
export function mealLabelCodeMetrics(
  style: MealLabelStyle,
  modules: number = mealLabelCarriesRecipe(style) ? mealLabelShareBudget(style).modules : 25,
): {
  boxMm: number;
  symbolMm: number;
  mmPerModule: number;
} {
  const QUIET = 4;
  const boxMm = (SPECS[style].codeUnits / SHEET) * 50;
  const mmPerModule = boxMm / (modules + QUIET * 2);
  return { boxMm, symbolMm: mmPerModule * modules, mmPerModule };
}
export const MIN_MM_PER_MODULE = 0.49;
const MIN_SHAREABLE_VERSION = 4;
export function mealLabelShareBudget(style: MealLabelStyle): {
  version: number;
  modules: number;
  maxBytes: number;
  mmPerModule: number;
  shareable: boolean;
} {
  const boxMm = (SPECS[style].codeUnits / SHEET) * 50;
  const ceiling = qrVersionForBytes(MEAL_SHARE_MAX_BYTES) ?? 1;
  let version = 1;
  for (let v = ceiling; v >= 1; v--) {
    if (boxMm / (qrModulesForVersion(v) + 8) >= MIN_MM_PER_MODULE) {
      version = v;
      break;
    }
  }
  const modules = qrModulesForVersion(version);
  return {
    version,
    modules,
    maxBytes: QR_BYTE_CAPACITY_M[version],
    mmPerModule: boxMm / (modules + 8),
    shareable: version >= MIN_SHAREABLE_VERSION,
  };
}
export function mealLabelCarriesRecipe(style: MealLabelStyle): boolean {
  return SPECS[style].layout === 'code';
}
export const DEFAULT_MEAL_LABEL_STYLE: MealLabelStyle = 'inlineCentred';
export function mealLabelStyleSpec(style: MealLabelStyle): Readonly<StyleSpec> {
  return SPECS[style];
}
export function centredStackLineBudget(style: MealLabelStyle): {
  headerUnits: number;
  codeTop: number;
  maxLines: number;
} {
  const spec = SPECS[style];
  const L = SQUARE_MARGIN;
  const bottom = SHEET - SQUARE_MARGIN;
  const [afterName, afterCalories, afterMacros, afterRule] = spec.stackGaps ?? [7, 6, 5, 8];
  let y = L + 4;
  y += spec.nameSize + afterName;
  y += spec.caloriesSize + afterCalories;
  y += spec.macroSize + afterMacros;
  y += afterRule;
  const codeTop = bottom - (spec.writeOnLine ? 9 : 0) - spec.codeUnits;
  return {
    headerUnits: y,
    codeTop,
    maxLines: Math.max(0, Math.floor((codeTop - y - 2) / STACK_LINE_H)),
  };
}
export function centredStackOffset({
  contentEnd,
  codeTop,
}: {
  contentEnd: number;
  codeTop: number;
}): number {
  return Math.max(0, (codeTop - contentEnd) / 2);
}
export interface StyleSpec {
  fontVar: string;
  fallback: string;
  codeUnits: number;
  writeOnLine: boolean;
  reversedHeader: boolean;
  rule: 'none' | 'solid' | 'dashed' | 'ring';
  nameSize: number;
  caloriesSize: number;
  macroSize: number;
  nameTracking: number;
  uppercaseName: boolean;
  stackGaps?: [number, number, number, number];
  ingredients?: boolean;
  layout?: 'beside' | 'stack' | 'code';
}
export const SPECS: Record<MealLabelStyle, StyleSpec> = {
  band: {
    fontVar: '--font-archivo',
    fallback: 'sans-serif',
    codeUnits: 62,
    writeOnLine: true,
    reversedHeader: true,
    rule: 'solid',
    nameSize: 11,
    caloriesSize: 25,
    macroSize: 8.5,
    nameTracking: 0.06,
    uppercaseName: true,
  },
  editorial: {
    fontVar: '--font-geist-sans',
    fallback: 'sans-serif',
    codeUnits: 64,
    writeOnLine: true,
    reversedHeader: false,
    rule: 'solid',
    nameSize: 12,
    caloriesSize: 26,
    macroSize: 8.5,
    nameTracking: 0,
    uppercaseName: false,
  },
  ticket: {
    fontVar: '--font-geist-mono',
    fallback: 'monospace',
    codeUnits: 67,
    writeOnLine: true,
    reversedHeader: false,
    rule: 'dashed',
    nameSize: 10.5,
    caloriesSize: 24,
    macroSize: 8,
    nameTracking: 0.04,
    uppercaseName: true,
  },
  plaque: {
    fontVar: '--font-instrument-serif',
    fallback: 'serif',
    codeUnits: 79,
    writeOnLine: false,
    reversedHeader: false,
    rule: 'ring',
    nameSize: 13,
    caloriesSize: 27,
    macroSize: 8.5,
    nameTracking: 0.02,
    uppercaseName: false,
  },
  square: {
    fontVar: '--font-geist-sans',
    fallback: 'sans-serif',
    codeUnits: 76,
    writeOnLine: true,
    reversedHeader: true,
    rule: 'solid',
    nameSize: 12,
    caloriesSize: 24,
    macroSize: 8,
    nameTracking: 0.04,
    uppercaseName: true,
    ingredients: true,
    layout: 'beside',
  },
  inlineCentred: {
    fontVar: '--font-geist-sans',
    fallback: 'sans-serif',
    codeUnits: 70,
    writeOnLine: false,
    reversedHeader: false,
    rule: 'solid',
    nameSize: 12,
    caloriesSize: 18,
    macroSize: 7.5,
    stackGaps: [5, 4, 4, 6],
    nameTracking: 0.02,
    uppercaseName: false,
    ingredients: true,
    layout: 'stack',
  },
  share: {
    fontVar: '--font-geist-sans',
    fallback: 'sans-serif',
    codeUnits: 130,
    writeOnLine: false,
    reversedHeader: false,
    rule: 'none',
    nameSize: 13,
    caloriesSize: 0,
    macroSize: 7,
    nameTracking: 0.02,
    uppercaseName: false,
    layout: 'code',
  },
};
