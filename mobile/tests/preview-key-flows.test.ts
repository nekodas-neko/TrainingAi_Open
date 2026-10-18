import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/features/account/api/client.ts';
import { AI_PAUSED_CODE, AI_PAUSED_MESSAGE } from '@trainingai/shared/ai-paused-notice';
import {
  barcodeError,
  ingredientEntries,
  lookupBarcodeScan,
  photoRetryAllowed,
  savedBarcodeFood,
  savedSource,
  scanBasis,
  scanSource,
} from '../src/features/nutrition/data/scan-response.ts';
import { scanSchema } from '../src/features/nutrition/data/models.ts';
import { readinessSpec } from '../src/features/health/data/models.ts';

const scan = scanSchema.parse({
  name: 'Toast',
  servingSizeG: 100,
  calories: 250,
  proteinG: 8,
  carbsG: 40,
  fatG: 5,
  origin: 'photo',
});

test('a barcode lookup sends the code under the name the route reads', async () => {
  const calls: [string, Record<string, string> | undefined][] = [];
  const result = await lookupBarcodeScan(
    {
      get: async (path, query) => {
        calls.push([path, query]);
        return { ...scan, origin: 'barcode', barcode: '9300000000001' };
      },
    },
    '9300000000001',
  );
  assert.deepEqual(calls, [['/api/nutrition/barcode', { code: '9300000000001' }]]);
  assert.equal(result.barcode, '9300000000001');
});

test('barcode failures tell a missing product from a database outage and from the network', () => {
  assert.match(barcodeError(new ApiError(404)), /^No match found/);
  assert.match(barcodeError(new ApiError(503)), /^Food database unavailable/);
  assert.match(barcodeError(new TypeError('Network request failed')), /^Network error/);
});

test('a re-scanned barcode is answered from the saved foods first', () => {
  const foods = [
    { id: 'a', barcode: null },
    { id: 'b', barcode: '123' },
  ];
  assert.equal(savedBarcodeFood(foods, '123')?.id, 'b');
  assert.equal(savedBarcodeFood(foods, '999'), null);
  assert.equal(savedBarcodeFood([{ id: 'c', barcode: '' }], ''), null);
});

test('scans are stored under the same source as the current app', () => {
  assert.equal(scanSource(scan), 'ai');
  assert.equal(scanSource({ ...scan, origin: 'text' }), 'ai');
  assert.equal(scanSource({ ...scan, origin: 'url' }), 'ai');
  assert.equal(scanSource({ ...scan, origin: 'barcode' }), 'barcode');
  assert.equal(scanSource({ ...scan, origin: 'search' }), 'text');
  // A database hit with calories and no macros keeps its calories (#2925).
  assert.equal(
    scanSource({ ...scan, origin: 'search', proteinG: 0, carbsG: 0, fatG: 0 }),
    'manual',
  );
});

test('an edited scan saves as hand-entered and an untouched one keeps its source (#2925)', () => {
  const basis = scanBasis(scan);
  assert.equal(savedSource('ai', basis, { ...basis }, 'ai'), 'ai');
  assert.equal(savedSource('ai', basis, { ...basis, calories: 300 }, 'ai'), 'manual');
  assert.equal(
    savedSource('barcode', basis, { ...basis, proteinG: 9 }, 'barcode'),
    'manual',
  );
  // No scan behind the form: a picked library food or a hand entry keeps what it had.
  assert.equal(savedSource(null, null, basis, 'manual'), 'manual');
  assert.equal(savedSource(null, null, basis, 'text'), 'text');
});

test('a multi-ingredient scan logs through the shared split', () => {
  const entries = ingredientEntries(
    [
      {
        name: 'Rice',
        weightG: 150,
        caloriesPer100g: 130,
        proteinPer100g: 2.7,
        carbsPer100g: 28,
        fatPer100g: 0.3,
      },
    ],
    2,
    'ai',
  );
  assert.deepEqual(entries, [
    {
      name: 'Rice',
      servingSizeG: 150,
      calories: 195,
      proteinG: 4.1,
      carbsG: 42,
      fatG: 0.5,
      source: 'ai',
      quantityMultiplier: 2,
    },
  ]);
});

test('the photo retry is not offered while the AI is paused', () => {
  assert.equal(
    photoRetryAllowed(new ApiError(503, AI_PAUSED_CODE, AI_PAUSED_MESSAGE)),
    false,
  );
  assert.equal(photoRetryAllowed(new ApiError(502)), true);
  assert.equal(photoRetryAllowed(new TypeError('Network request failed')), true);
});

test('a readiness payload with per-device normals still parses (#2991)', () => {
  const contributor = (extra: object) => ({
    score: 50,
    provisional: true,
    input: null,
    ...extra,
  });
  const parsed = readinessSpec('2026-10-18').schema.safeParse({
    score: 61,
    label: 'Fair',
    source: 'custom',
    ouraScore: null,
    readinessDisplayScore: 61,
    readinessContributors: null,
    readinessCompositeContributors: {
      restingHeartRate: contributor({ gap: 'awaiting_baseline', source: 'oura_cloud' }),
      hrvBalance: contributor({ gap: 'awaiting_baseline', source: 'oura_cloud' }),
      temperature: contributor({ gap: 'no_input' }),
      recoveryIndex: {
        score: 80,
        provisional: true,
        input: 80,
        gap: null,
        scale: 'oura_contributor',
      },
      activityBalance: { score: 60, provisional: false, input: 60, gap: null },
    },
    availability: [
      { metric: 'readiness', state: 'degraded', gap: null },
      { metric: 'sleep', state: 'absent', gap: 'awaiting_baseline' },
    ],
    temperatureDeviationSource: 'cloud',
    aFieldAddedLater: { kept: true },
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.readinessCompositeContributors?.hrvBalance?.provisional, true);
});
