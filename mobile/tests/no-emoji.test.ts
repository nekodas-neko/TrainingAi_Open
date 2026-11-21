import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { stripComments } = createRequire(import.meta.url)('../../scripts/lib/strip-comments.js') as {
  stripComments: (source: string) => string;
};

// #3773: TrainingAi Preview draws icons, never emojis. A new emoji in `mobile/src` fails here.
// Each allowlisted file says why it may hold one. Plain typographic marks (arrows, ticks, bullets)
// are not emoji and are not checked.
// Emoji by default presentation, anything followed by the emoji selector, the Miscellaneous Symbols
// block (⚠ ☀ ♥ …) and the few Dingbats emoji. © ® ™ and ✓ are text, so they pass.
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[\u2600-\u26FF\u2705\u2714\u2716\u2728\u274C\u2764]/u;

const ALLOWED: Record<string, string> = {
  'src/features/workouts/components/session-icon-names.ts':
    'Keys of the stored-emoji → icon map: `program_sessions.icon` holds the emoji, shared with the web app.',
  'src/features/nutrition/components/meal-type-icon-names.ts':
    'Keys of the stored-emoji → icon map: `meal_types.emoji` holds the emoji, shared with the web app.',
  'src/features/programs/SessionIconPicker.tsx':
    'Default stored value for a new session icon; the picker draws icons.',
  'src/features/programs/ProgramEditor.tsx': 'Default stored session icon, never drawn as text.',
  'src/features/programs/builder-model.ts': 'Default stored session icon, never drawn as text.',
  'src/features/nutrition/components/NutritionSettings.tsx':
    'Default stored meal-type emoji for a new meal type; the editor draws icons.',
  'src/features/workouts/logging/summary.ts':
    'Share text that leaves the app (system share sheet), kept identical to the web app.',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '__check_fixture__') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const root = join(import.meta.dirname, '..');
const files = sourceFiles(join(root, 'src'));
const rel = (file: string) => relative(root, file).split('\\').join('/');
const holdsEmoji = (file: string) =>
  EMOJI.test(stripComments(readFileSync(join(root, file), 'utf8')));

test('Preview source files are found', () => {
  assert.ok(files.length > 100);
});

test('no emoji in Preview code outside the allowlist', () => {
  const found = files.map(rel).filter((file) => !(file in ALLOWED) && holdsEmoji(file));
  assert.deepEqual(found, []);
});

test('the allowlist holds only files that still have an emoji', () => {
  assert.deepEqual(Object.keys(ALLOWED).filter((file) => !holdsEmoji(file)), []);
});
