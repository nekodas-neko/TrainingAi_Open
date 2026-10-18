import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  apply: vi.fn(),
  rebuild: vi.fn(),
  report: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    applyAppleHealthBatch: mocks.apply,
    rebuildAppleHealth: mocks.rebuild,
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }));
vi.mock('@/lib/observability', () => ({ reportServerError: mocks.report }));
import { POST } from '../route';
const userId = '7c9a06e1-9193-4f5a-9451-cf80666e97a2';
const request = (body: unknown) =>
  new NextRequest('https://example.com/api/apple-health/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: userId, timezone: 'Australia/Brisbane' } });
  mocks.apply.mockResolvedValue({ accepted: 0, deleted: 0 });
  mocks.rebuild.mockResolvedValue({ nights: 0 });
});
it('requires authentication and never accepts an account ID supplied in the body', async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await POST(request({ rebuild: true }))).status).toBe(401);
  expect(mocks.rebuild).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue({ user: { id: userId } });
  expect((await POST(request({ rebuild: true, userId: 'other' }))).status).toBe(400);
  expect(mocks.rebuild).not.toHaveBeenCalled();
});
it('dispatches validated records using the authenticated account and source type', async () => {
  const body = { type: 'HKCategoryTypeIdentifierSleepAnalysis', samples: [], deleted: [] };
  expect((await POST(request(body))).status).toBe(200);
  expect(mocks.apply).toHaveBeenCalledWith(userId, body, 'Australia/Brisbane');
  expect((await POST(request({ type: 'unknown', samples: [], deleted: [] }))).status).toBe(400);
});
it('projects with the account timezone and keeps database failure details out of responses', async () => {
  expect((await POST(request({ rebuild: true }))).status).toBe(200);
  expect(mocks.rebuild).toHaveBeenCalledWith(userId, 'Australia/Brisbane');
  mocks.rebuild.mockRejectedValue(new Error('private connection details'));
  const response = await POST(request({ rebuild: true }));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private connection');
  expect(mocks.report).toHaveBeenCalledOnce();
});

// #3045: one bad sample is refused with its reason and the good ones still land; only a body that is
// not a batch at all is a 400.
it('#3045: one out-of-range sample is refused with its reason and the good ones still land', async () => {
  const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const good = {
    id: id(1),
    start: '2026-01-01T00:00:00Z',
    end: '2026-01-01T01:00:00Z',
    value: 4000,
    sourceName: 'Watch',
    sourceBundleId: 'com.apple.health',
  };
  const tooMany = { ...good, id: id(2), value: 250_000 };
  const overCap = { ...good, id: id(3), value: 900 }; // a valid sample, over a weight's 500 kg ceiling
  const noId = { ...good, id: 'not-a-uuid' };
  mocks.apply.mockResolvedValue({ accepted: 1, deleted: 1 });
  const response = await POST(
    request({
      type: 'HKQuantityTypeIdentifierStepCount',
      samples: [tooMany, good, noId, good],
      deleted: [id(9)],
    }),
  );
  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json).toMatchObject({ accepted: 1, deleted: 1, deferred: [] });
  expect(json.rejected.map((row: { id: string | null }) => row.id)).toEqual([id(2), null, id(1)]);
  expect(json.rejected[2].reason).toBe('Duplicate record identity');
  expect(mocks.apply).toHaveBeenCalledWith(
    userId,
    { type: 'HKQuantityTypeIdentifierStepCount', samples: [good], deleted: [id(9)] },
    'Australia/Brisbane',
  );
  mocks.apply.mockClear();

  // The per-type ceiling, which lived in the batch refinement, is now judged per sample.
  const weight = await POST(
    request({ type: 'HKQuantityTypeIdentifierBodyMass', samples: [overCap], deleted: [] }),
  );
  expect((await weight.json()).rejected).toEqual([
    { id: id(3), reason: 'Invalid measurement value' },
  ]);
  const sleep = await POST(
    request({
      type: 'HKCategoryTypeIdentifierSleepAnalysis',
      samples: [{ ...good, value: 2.5 }],
      deleted: [],
    }),
  );
  expect((await sleep.json()).rejected).toEqual([
    { id: id(1), reason: 'Invalid measurement value' },
  ]);
});

it('#3045: a body that is not a batch is still a 400', async () => {
  for (const body of [
    { type: 'HKQuantityTypeIdentifierStepCount', samples: 'x', deleted: [] },
    { type: 'HKQuantityTypeIdentifierStepCount', samples: [], deleted: ['nope'] },
    { type: 'HKQuantityTypeIdentifierStepCount', samples: [], deleted: [], extra: 1 },
  ]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  const twice = '50000000-0000-4000-8000-000000000009';
  expect(
    (await POST(request({ type: 'HKQuantityTypeIdentifierStepCount', samples: [], deleted: [twice, twice] })))
      .status,
  ).toBe(400);
  expect(mocks.apply).not.toHaveBeenCalled();
});
