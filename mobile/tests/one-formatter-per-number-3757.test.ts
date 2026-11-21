import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { stripComments } = createRequire(import.meta.url)('../../scripts/lib/strip-comments.js') as {
  stripComments: (source: string) => string;
};

// #3757: each kind of number has one formatter in `packages/shared/src/format/number.ts` (counts,
// XP, volume, water, lifetime distance), `time-ago.ts` ("5 minutes ago") and `date-utils.ts` (the
// long date). A hand-written copy of one in `mobile/src` fails here. Allowlisted files say why.
const PATTERNS: Record<string, RegExp> = {
  'thousands separators by hand (use formatCount)': /\.toLocaleString\(|Intl\.NumberFormat/,
  'a litre or tonne figure built by hand (use formatWaterMl / formatLifetimeVolume)':
    /toFixed\(1\)\}\s?(?:L|t|T|kt|kT)\b/,
  'a millilitre figure written without its space (use formatWaterMl)': /\}ml\b/,
  'a long date built by hand (use formatDateDisplay(day, "long"))': /weekday:\s*'long'/,
  'a private "N min ago" (use timeAgo)': /\bmin ago|\bh ago/,
};

const ALLOWED: Record<string, { pattern: string; why: string }> = {
  'src/integrations/apple-health/readHealth.ios.ts': {
    pattern: 'thousands separators by hand (use formatCount)',
    why: 'A raw sample interval as a Date string in a diagnostic row; not a number.',
  },
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
const rel = (file: string) => relative(root, file).split('\\').join('/');
const code = new Map(
  sourceFiles(join(root, 'src')).map((file) => [rel(file), stripComments(readFileSync(file, 'utf8'))]),
);

function offenders(name: string) {
  return [...code]
    .filter(([file, text]) => PATTERNS[name].test(text) && ALLOWED[file]?.pattern !== name)
    .map(([file]) => file);
}

for (const name of Object.keys(PATTERNS)) {
  test(`no hand-written copy in Preview: ${name}`, () => {
    assert.deepEqual(offenders(name), []);
  });
}

test('the allowlist holds only files that still match its pattern', () => {
  const stale = Object.entries(ALLOWED).filter(([file, { pattern }]) => !PATTERNS[pattern].test(code.get(file) ?? ''));
  assert.deepEqual(stale, []);
});

test('the guard catches the known ad-hoc patterns', () => {
  assert.match('x.toLocaleString()', PATTERNS['thousands separators by hand (use formatCount)']);
  assert.match('`${(ml / 1000).toFixed(1)}L`', PATTERNS['a litre or tonne figure built by hand (use formatWaterMl / formatLifetimeVolume)']);
  assert.match('`${ml}ml`', PATTERNS['a millilitre figure written without its space (use formatWaterMl)']);
  assert.match("{ weekday: 'long' }", PATTERNS['a long date built by hand (use formatDateDisplay(day, "long"))']);
  assert.match("'3 h ago'", PATTERNS['a private "N min ago" (use timeAgo)']);
});
