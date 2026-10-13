import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  imageResize,
  imageSizeWithinPixels,
} from '../src/integrations/nutrition/image-size.ts';
import {
  encodeWithinBudget,
  SCAN_IMAGE_MAX_PIXELS,
  base64ImageBytes,
} from '../src/integrations/nutrition/image-encoding.ts';
import { photoDraftSchema } from '../src/features/nutrition/data/photo-draft.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import { foodScanError, readFoodScan } from '../src/features/nutrition/data/scan-response.ts';
import {
  foodValidationMessage,
  normaliseFood,
} from '../src/features/nutrition/data/food-values.ts';
import { FoodItemPushSchema } from '../src/features/nutrition/data/models.ts';

test('phone photos fit the longest edge and small photos are never enlarged', () => {
  assert.deepEqual(imageResize(3024, 4032, 1024), [{ resize: { height: 1024 } }]);
  assert.deepEqual(imageResize(4032, 3024, 1024), [{ resize: { width: 1024 } }]);
  assert.deepEqual(imageResize(300, 600, 1024), []);
  assert.deepEqual(imageResize(1024, 1024, 128), [{ resize: { width: 128 } }]);
  assert.throws(() => imageResize(0, 4032, 1024));
});

test('portrait and landscape scan images retain detail within the two-megapixel budget', () => {
  for (const [width, height] of [
    [3024, 4032],
    [4032, 3024],
    [9000, 12000],
    [1600, 1600],
  ]) {
    const result = imageSizeWithinPixels(width, height, SCAN_IMAGE_MAX_PIXELS);
    assert.ok(result.width * result.height <= SCAN_IMAGE_MAX_PIXELS);
    assert.ok(result.width <= width && result.height <= height);
    assert.ok(Math.abs(result.width / result.height - width / height) < 0.002);
  }
  assert.deepEqual(imageSizeWithinPixels(300, 600, SCAN_IMAGE_MAX_PIXELS), {
    width: 300,
    height: 600,
  });
});

test('compression retries oversized files without reading them into JavaScript and cleans every file', async () => {
  const qualities: number[] = [];
  const disposed: number[] = [];
  const read: number[] = [];
  const result = await encodeWithinBudget(async (quality) => {
    const index = qualities.length;
    qualities.push(quality);
    return {
      bytes: index === 0 ? 8 : 3,
      read: async () => {
        read.push(index);
        return 'AQID';
      },
      dispose: () => {
        disposed.push(index);
      },
    };
  }, 4);
  assert.deepEqual(qualities, [0.8, 0.65]);
  assert.deepEqual(read, [1]);
  assert.deepEqual(disposed, [0, 1]);
  assert.deepEqual(result, { base64: 'AQID', bytes: 3 });
});

test('unreadable and oversized outputs cannot be posted, and retries are bounded', async () => {
  let attempts = 0;
  let disposed = 0;
  await assert.rejects(
    encodeWithinBudget(async () => {
      attempts++;
      return {
        bytes: 100,
        read: async () => {
          assert.fail('Oversized data must stay native.');
        },
        dispose: () => {
          disposed++;
        },
      };
    }, 4),
    /upload limit/,
  );
  assert.equal(attempts, 4);
  assert.equal(disposed, 4);
  await assert.rejects(
    encodeWithinBudget(
      async () => ({
        bytes: 4,
        read: async () => 'AQID',
        dispose: () => {
          disposed++;
        },
      }),
      8,
    ),
    /completely/,
  );
  assert.equal(disposed, 5);
  assert.equal(base64ImageBytes('AQ=='), 1);
  assert.equal(base64ImageBytes('AQI='), 2);
});

test('a compressed photo survives reopening the scoped local draft and is removed after use', async () => {
  const disk = new Map<string, string>();
  const storage = {
    get: async (key: string) => disk.get(key) ?? null,
    set: async (key: string, value: string) => {
      disk.set(key, value);
    },
    remove: async (key: string) => {
      disk.delete(key);
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-a',
    timezone: 'Australia/Brisbane',
    post: async () => {
      throw new Error('offline');
    },
    get: async () => {
      throw new Error('offline');
    },
  };
  const photo = {
    base64: 'AQID',
    bytes: 3,
    width: 1200,
    height: 1600,
    mimeType: 'image/webp',
    thumbnail: 'data:image/webp;base64,AQID',
  };
  const key = 'food-photo:2026-10-12:log';
  await new WorkoutResources(storage, connection).saveDraft(key, photoDraftSchema.parse(photo));
  const reopened = new WorkoutResources(storage, connection);
  assert.deepEqual(await reopened.draft(key, photoDraftSchema), photo);
  assert.equal(photoDraftSchema.safeParse({ ...photo, bytes: 4 }).success, false);
  assert.equal(
    photoDraftSchema.safeParse({ ...photo, width: 4000, height: 3000 }).success,
    false,
  );
  await reopened.clearDraft(key);
  assert.equal(await reopened.draft(key, photoDraftSchema), null);
});

test('food scans accept the deployed single and multiple candidate contracts', () => {
  const meal = {
    name: 'Rice',
    servingSizeG: 100,
    calories: 130,
    proteinG: 2,
    carbsG: 29,
    fatG: 1,
  };
  assert.equal(readFoodScan(meal)[0].name, 'Rice');
  assert.equal(readFoodScan({ ...meal, candidates: [meal] }).length, 1);
  assert.equal(
    readFoodScan({ ...meal, candidates: [meal, { ...meal, name: 'Lunch' }] })[1].name,
    'Lunch',
  );
});

test('analysis explains failures without exposing request contents or losing the distinction', () => {
  assert.match(foodScanError(new ApiError(502)), /service failed \(502\)/);
  assert.match(foodScanError(new ApiError(401)), /sign-in/);
  assert.match(foodScanError(new ApiError(429)), /Wait a minute/);
  assert.match(foodScanError(new DOMException('private payload', 'AbortError')), /timed out/);
  assert.match(foodScanError(new TypeError('private payload')), /connection/);
  try {
    readFoodScan({ error: 'Could not identify food' });
    assert.fail('An unidentified photo must not become a food entry.');
  } catch (error) {
    assert.match(foodScanError(error), /No food was identified/);
  }
  try {
    readFoodScan({ name: 'Missing nutrients' });
    assert.fail('An incomplete estimate must not become a food entry.');
  } catch (error) {
    assert.match(foodScanError(error), /unreadable food estimate/);
  }
});

test('manual food validation accepts zero calories and identifies invalid nutrient amounts', () => {
  const food = { id: 'manual', name: 'Cereal and banana', servingSizeG: 100, calories: NaN };
  const missing = FoodItemPushSchema.safeParse(food);
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.match(foodValidationMessage(missing.error), /valid calorie amount/);
  }
  assert.equal(FoodItemPushSchema.safeParse({ ...food, calories: 0 }).success, true);
  const invalid = FoodItemPushSchema.safeParse({ ...food, calories: 350, proteinG: -1 });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.match(foodValidationMessage(invalid.error), /protein amount/);
  }
});

test('manual calorie and portion values are preserved rather than rewritten as AI estimates', () => {
  const result = normaliseFood(
    {
      name: 'Cereal and banana',
      source: 'manual',
      servingSizeG: 100.5,
      calories: 350,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      quantityMultiplier: 1,
    },
    'manual',
  );
  assert.equal(result.calories, 350);
  assert.equal(result.servingSizeG, 100.5);
});
