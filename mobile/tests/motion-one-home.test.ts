import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { MOTION } from '../src/shared/ui/motion.ts';

// #3758. Every animation duration and spring speed is set in src/shared/ui/motion.ts. A literal
// anywhere else puts a second home for the app's pace back, as it was when the sheet, the undo
// notice and the layout changes each kept their own.

const src = resolve(import.meta.dirname, '..', 'src');
const HOME = join(src, 'shared', 'ui', 'motion.ts');
// One-off celebration pacing outside the shell's motion (a badge unlocking, XP counting up). Not
// moved by #3758; listed on that PR so the owner can call it in or leave it.
const CELEBRATIONS = new Set([
  join(src, 'features', 'rewards', 'components', 'AchievementBadge.tsx'),
  join(src, 'features', 'rewards', 'components', 'WorkoutXp.tsx'),
]);

async function files(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

test('no duration or spring speed is a number written outside the motion file', async () => {
  const offenders: string[] = [];
  for (const path of await files(src)) {
    if (path === HOME || CELEBRATIONS.has(path)) continue;
    const lines = (await readFile(path, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      if (/\b(duration|speed)\s*:\s*(?:[^,}]*:\s*)?\d/.test(line)) {
        offenders.push(`${relative(src, path)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('the pace the owner asked for is what the file holds', () => {
  assert.equal(MOTION.screen.duration, 220);
  assert.equal(MOTION.tabFade.duration, 120);
});

test('the values that moved here are the ones they had', () => {
  assert.deepEqual(
    [MOTION.sheet.open.duration, MOTION.sheet.close.duration, MOTION.undoNotice.duration],
    [240, 180, 180],
  );
  assert.deepEqual(
    [MOTION.layout.duration, MOTION.disclosureIcon.duration, MOTION.progressFill.duration],
    [180, 180, 240],
  );
  assert.equal(MOTION.backdropFade.duration, 800);
  assert.deepEqual(Object.values(MOTION.springs).sort(), [25, 25, 25, 25, 32, 35]);
  // Easing.out(Easing.cubic), which the sheet used, is 1 - (1 - t)^3.
  for (const t of [0, 0.25, 0.5, 1]) {
    assert.equal(MOTION.sheet.open.easing(t), 1 - Math.pow(1 - t, 3));
  }
});

test('the guard that releases a lost animation callback is in the motion file, and outlasts every motion', async () => {
  assert.ok(MOTION.navGuard.duration > MOTION.screen.duration * 2);
  assert.ok(MOTION.navGuard.duration > MOTION.tabFade.duration * 2);
  const offenders: string[] = [];
  for (const dir of ['app', 'shared']) {
    for (const path of await files(join(src, dir))) {
      if (path === HOME) continue;
      (await readFile(path, 'utf8')).split('\n').forEach((line, index) => {
        if (/\b[A-Za-z_]*_MS\s*=\s*\d/.test(line)) {
          offenders.push(`${relative(src, path)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(offenders, []);
});
