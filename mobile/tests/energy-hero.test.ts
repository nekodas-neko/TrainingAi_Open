import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIAL,
  TIDE,
  angleAt,
  arcPath,
  energyHero,
  energyHeroSize,
  notch,
  polar,
} from '../src/features/home/data/energy-hero.ts';

const battery = (over: Partial<Parameters<typeof energyHero>[0] & object> = {}) => ({
  hasData: true,
  current: 46,
  anchor: 76,
  anchorSource: 'sleep' as const,
  anchorProvisional: false,
  series: [
    { t: 1, v: 76 },
    { t: 2, v: 60 },
    { t: 3, v: 46 },
  ],
  ...over,
});

test('the hero shows the live level with the morning mark and how far it has fallen', () => {
  const hero = energyHero(battery());
  assert.ok(hero.hasData);
  assert.equal(hero.level, 46);
  assert.equal(hero.morning, 76);
  assert.equal(hero.drained, 30);
  assert.equal(hero.label, 'Low');
  assert.equal(hero.sub, 'woke at 76 · drained 30');
  assert.equal(hero.origin, 'set from sleep');
});

test('the number never rises: a recharge leaves it at the day\'s low', () => {
  const hero = energyHero(
    battery({
      current: 58,
      series: [
        { t: 1, v: 76 },
        { t: 2, v: 40 },
        { t: 3, v: 58 },
      ],
    }),
  );
  assert.ok(hero.hasData);
  assert.equal(hero.level, 40);
  assert.equal(hero.label, 'Low');
});

test('the number never sits above the morning mark', () => {
  const hero = energyHero(battery({ anchor: 70, current: 82, series: [{ t: 1, v: 82 }] }));
  assert.ok(hero.hasData);
  assert.equal(hero.level, 70);
  assert.equal(hero.drained, 0);
  assert.equal(hero.sub, 'woke at 70');
});

test('the band comes from the number on screen, at its edges', () => {
  const label = (current: number) => {
    const hero = energyHero(battery({ anchor: 100, current, series: [] }));
    return hero.hasData ? hero.label : null;
  };
  assert.equal(label(75), 'Charged');
  assert.equal(label(74), 'Good');
  assert.equal(label(50), 'Good');
  assert.equal(label(49), 'Low');
  assert.equal(label(25), 'Low');
  assert.equal(label(24), 'Drained');
});

test('a provisional morning figure says so, and no data draws nothing', () => {
  const hero = energyHero(battery({ anchorSource: 'readiness', anchorProvisional: true }));
  assert.ok(hero.hasData);
  assert.match(hero.origin, /^set from readiness · provisional/);
  assert.deepEqual(energyHero(battery({ hasData: false })), { hasData: false });
  assert.deepEqual(energyHero(null), { hasData: false });
});

test('limited data is flagged', () => {
  const hero = energyHero(battery({ confidence: { sufficient: false } }));
  assert.ok(hero.hasData);
  assert.equal(hero.limited, true);
});

test('the size setting falls back to Full for anything unknown', () => {
  assert.equal(energyHeroSize(undefined), 'full');
  assert.equal(energyHeroSize('huge'), 'full');
  assert.equal(energyHeroSize('slim'), 'slim');
});

test('the dial matches the approved mockup: 76 of a 240° arc ends where D1 draws it', () => {
  // D1 draws a 244 px dial, r 102.5, centre 122, with the notch from (202.64, 79.84).
  const bar = notch(DIAL, 122, 102.5, 15, 76);
  assert.ok(Math.abs(bar.from.x - 202.64) < 1.2);
  assert.ok(Math.abs(bar.from.y - 79.84) < 1.2);
  assert.equal(angleAt(DIAL, 0), 150);
  assert.equal(angleAt(DIAL, 100), 390);
});

test('arcs run clockwise and an empty span has no path', () => {
  assert.equal(arcPath(DIAL, 122, 100, 40, 40), null);
  const path = arcPath(DIAL, 122, 100, 0, 50);
  assert.ok(path?.startsWith('M '));
  assert.match(path ?? '', / 0 0 1 /);
  // More than half of the 240° dial is a large arc.
  assert.match(arcPath(DIAL, 122, 100, 0, 80) ?? '', / 0 1 1 /);
});

test('a full tide ring is drawn as an arc that stops just short of closing', () => {
  const path = arcPath(TIDE, 108, 94, 0, 100);
  assert.ok(path);
  const top = polar(108, 94, -90);
  assert.ok(path.startsWith(`M ${top.x} ${top.y}`));
});
