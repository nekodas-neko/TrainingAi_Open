import {
  encodeMealLabelToken,
  encodeSharedMeal,
  mealLabelFigures,
} from '@trainingai/shared/nutrition/label-payload';
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients';
import QRCode from 'qrcode';
import {
  centredStackLineBudget,
  DEFAULT_MEAL_LABEL_STYLE,
  MEAL_LABEL_STYLES,
  mealLabelCarriesRecipe,
  mealLabelCodeMetrics,
  mealLabelShareBudget,
  type MealLabelStyle,
  mealLabelStyleSpec,
  SHEET,
  STACK_LINE_H,
} from '@trainingai/shared/nutrition/meal-label-geometry';
import type { SavedMeal } from './models';
import { asSharedMeal } from './recipes';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function labelStyle(value: string): MealLabelStyle {
  return MEAL_LABEL_STYLES.find((s) => s.value === value)?.value ?? DEFAULT_MEAL_LABEL_STYLE;
}
function wrap(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line += (line ? ' ' : '') + word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return { lines: lines.slice(0, maxLines), hidden: lines.length > maxLines };
}
export function mealLabelArtwork(meal: SavedMeal, value: string) {
  const style = labelStyle(value);
  const spec = mealLabelStyleSpec(style);
  const shared = mealLabelCarriesRecipe(style);
  const payload = shared
    ? encodeSharedMeal(asSharedMeal(meal), { maxBytes: mealLabelShareBudget(style).maxBytes })
    : { text: encodeMealLabelToken(meal.id), bytes: 22, named: 0, rolled: 0 };
  const code = QRCode.create(payload.text, {
    errorCorrectionLevel: 'M',
    ...(shared ? {} : { version: 2 }),
  });
  const modules = code.modules.size;
  let path = '';
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (code.modules.get(y, x)) {
        path += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
  }
  const f = mealLabelFigures(asSharedMeal(meal));
  const ingredients = savedMealToIngredients(asSharedMeal(meal))
    .map((i) => `${Math.round(i.weightG)} g ${i.name}`)
    .join(' · ');
  const body: string[] = [];
  const text = (
    content: string,
    x: number,
    y: number,
    size: number,
    options: { anchor?: string; color?: string; weight?: string } = {},
  ) =>
    `<text x="${x}" y="${y}" text-anchor="${options.anchor ?? 'middle'}" fill="${options.color ?? '#000'}" font-family="${spec.fallback}" font-size="${size}" font-weight="${options.weight ?? '400'}">${escape(content)}</text>`;
  let title = spec.uppercaseName ? f.name.toUpperCase() : f.name;
  const titles = wrap(title, Math.floor(165 / (spec.nameSize * 0.56)), 2).lines;
  const titleHeight = titles.length * spec.nameSize + 6;
  if (spec.reversedHeader) {
    body.push(`<rect x="9" y="9" width="171" height="${titleHeight}" fill="#000"/>`);
  }
  titles.forEach((line, i) =>
    body.push(
      text(line, SHEET / 2, 13 + spec.nameSize * (i + 1), spec.nameSize, {
        color: spec.reversedHeader ? '#fff' : '#000',
        weight: '700',
      }),
    ),
  );
  const beside = spec.layout === 'beside';
  let y = 9 + titleHeight + (spec.stackGaps?.[0] ?? 8);
  const codeX = beside ? 180 - spec.codeUnits : (SHEET - spec.codeUnits) / 2;
  const codeY = shared
    ? 180 - spec.codeUnits
    : 180 - (spec.writeOnLine ? 9 : 0) - spec.codeUnits;
  if (!shared) {
    body.push(
      text(
        String(f.calories),
        beside ? 49 : SHEET / 2,
        y + spec.caloriesSize,
        spec.caloriesSize,
        { weight: '700' },
      ),
    );
    body.push(text('kcal', beside ? 49 : SHEET / 2, y + spec.caloriesSize + 9, 7));
    y += spec.caloriesSize + 17;
    body.push(
      text(
        `P ${f.proteinG} · C ${f.carbsG} · F ${f.fatG} g`,
        SHEET / 2,
        beside ? codeY - 10 : y,
        spec.macroSize,
      ),
    );
    y += spec.macroSize + (spec.stackGaps?.[2] ?? 8);
    if (spec.rule !== 'none') {
      body.push(
        `<line x1="12" x2="177" y1="${y}" y2="${y}" stroke="#000" stroke-width="0.6" ${spec.rule === 'dashed' ? 'stroke-dasharray="3 3"' : ''}/>`,
      );
      y += spec.stackGaps?.[3] ?? 7;
    }
    if (spec.ingredients) {
      const room = beside
        ? Math.max(0, Math.floor((codeY - y - 8) / STACK_LINE_H))
        : Math.min(
            centredStackLineBudget(style).maxLines,
            Math.max(0, Math.floor((codeY - y - 5) / STACK_LINE_H)),
          );
      const run = wrap(ingredients, 47, room);
      run.lines.forEach((line, index) =>
        body.push(text(line, SHEET / 2, y + index * STACK_LINE_H, 6)),
      );
      if (run.hidden && room > 0) {
        body.push(text('Scan for full list', SHEET / 2, codeY - 3, 5));
      }
    }
  }
  body.push(
    `<g transform="translate(${codeX} ${codeY}) scale(${spec.codeUnits / (modules + 8)})"><rect width="${modules + 8}" height="${modules + 8}" fill="#fff"/><path d="${path}" fill="#000"/></g>`,
  );
  if (spec.writeOnLine) {
    body.push(`<line x1="40" x2="149" y1="180" y2="180" stroke="#000" stroke-width="0.6"/>`);
  }
  if (spec.rule === 'ring') {
    body.push(
      '<rect x="3" y="3" width="183" height="183" rx="8" fill="none" stroke="#000"/><rect x="5" y="5" width="179" height="179" rx="6" fill="none" stroke="#000" stroke-width="0.5"/>',
    );
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="189" height="189" viewBox="0 0 189 189"><rect width="189" height="189" fill="#fff"/>${body.join('')}</svg>`,
    payload,
    shared,
    style,
    metrics: mealLabelCodeMetrics(style, modules),
  };
}
