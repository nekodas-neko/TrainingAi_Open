import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// react-native-svg rejects ".5": a number string needs a leading zero.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === '__check_fixture__' || name === 'node_modules') return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

test('no <Stop> passes a number string without a leading zero', () => {
  const bare = /\b(offset|stopOpacity)=["']\.\d/;
  const offenders = sourceFiles(fileURLToPath(new URL('../src', import.meta.url))).filter((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .some((line) => bare.test(line)),
  );
  assert.deepEqual(offenders, []);
});
