import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  apply: vi.fn(),
  rebuild: vi.fn(),
  report: vi.fn(),
  upsert: vi.fn(),
  tombstone: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    applyHealthConnectBatch: mocks.apply,
    rebuildHealthConnect: mocks.rebuild,
    upsertHealthConnectActivityLog: mocks.upsert,
    tombstoneHealthConnectActivityLogs: mocks.tombstone,
    listActivityTypes: async () => ['walk', 'strength', 'other'].map((id) => ({ id })),
    listActivityLogs: async () => [],
    saveActivityLog: vi.fn(),
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }));
vi.mock('@/lib/observability', () => ({ reportServerError: mocks.report }));
import { POST } from '../route';
const userId = '7c9a06e1-9193-4f5a-9451-cf80666e97a2';
const request = (body: unknown) =>
  new NextRequest('https://example.com/api/health-connect/sync', {
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
  const body = { records: [], deleted: [] };
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

it('defers future records without losing valid uploads and rejects malformed batches', async () => {
  const row = {
    id: 'test',
    type: 'Weight',
    value: 70,
    sourcePackage: 'com.test.scale',
    recordingMethod: 2,
    start: '2099-01-01T00:00:00Z',
    end: '2099-01-01T00:00:00Z',
    modifiedAt: '2099-01-01T00:00:00Z',
  };
  const response = await POST(request({ records: [row], deleted: [] }));
  expect(response.status).toBe(200);
  expect((await response.json()).deferred).toEqual([row.id]);
  expect(mocks.apply).toHaveBeenCalledWith(
    userId,
    { records: [], deleted: [] },
    'Australia/Brisbane',
  );
  mocks.apply.mockClear();
  const past = {
    ...row,
    start: '2026-01-01T00:00:00Z',
    end: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };
  // #2828 N3: a duplicate keeps its first copy and refuses the second, rather than failing both.
  const duplicate = await POST(request({ records: [past, past], deleted: [] }));
  expect(duplicate.status).toBe(200);
  expect((await duplicate.json()).rejected).toEqual([
    { id: past.id, reason: 'Duplicate health record identity' },
  ]);
  expect(mocks.apply).toHaveBeenCalledWith(
    userId,
    { records: [past], deleted: [] },
    'Australia/Brisbane',
  );
  mocks.apply.mockClear();
  expect((await POST(request({ records: [], deleted: ['a', 'a'] }))).status).toBe(400);
  expect((await POST(request({ records: 'nope', deleted: [] }))).status).toBe(400);
  expect((await POST(request({ junk: 'x'.repeat(2 * 1024 * 1024) }))).status).toBe(413);
  expect(mocks.apply).not.toHaveBeenCalled();
});

it('#2828 N3: one out-of-range record is refused with its reason and the good ones still land', async () => {
  const good = {
    id: 'weight-ok',
    type: 'Weight',
    value: 70,
    sourcePackage: 'com.test.scale',
    recordingMethod: 2,
    start: '2026-01-01T00:00:00Z',
    end: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };
  const heavy = { ...good, id: 'weight-bad', value: 900 };
  const noId = { ...good, id: '' };
  mocks.apply.mockResolvedValue({ accepted: 1, deleted: 1 });
  const response = await POST(request({ records: [heavy, good, noId], deleted: ['gone'] }));
  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json).toMatchObject({ accepted: 1, deleted: 1, deferred: [] });
  expect(json.rejected.map((row: { id: string | null }) => row.id)).toEqual(['weight-bad', null]);
  expect(mocks.apply).toHaveBeenCalledWith(
    userId,
    { records: [good], deleted: ['gone'] },
    'Australia/Brisbane',
  );
});

it('#2843: an exercise session becomes an activity log keyed on its record id, and a deletion tombstones it', async () => {
  // Local midday a few days back, so the session's day is never on a window edge.
  const start = new Date(Date.now() - 3 * 86400000);
  start.setUTCHours(2, 0, 0, 0); // 12:00 in Brisbane
  const end = new Date(start.getTime() + 45 * 60000);
  const session = {
    id: 'hc-gym',
    type: 'ExerciseSession',
    exerciseType: 70,
    title: 'Gym',
    sourcePackage: 'com.sec.android.app.shealth',
    recordingMethod: 2,
    start: start.toISOString(),
    end: end.toISOString(),
    modifiedAt: end.toISOString(),
  };
  mocks.apply.mockResolvedValue({ accepted: 1, deleted: 1 });
  const response = await POST(request({ records: [session], deleted: ['hc-old'] }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ accepted: 1, deleted: 1, rejected: [], workoutNotes: [] });
  expect(mocks.upsert).toHaveBeenCalledWith(
    userId,
    'hc-gym',
    expect.objectContaining({ activityType: 'strength', title: 'Gym', startTime: '12:00', endTime: '12:45', durationMin: 45 }),
  );
  expect(mocks.tombstone).toHaveBeenCalledWith(userId, { ids: ['hc-old'] });
});

it('#2843: a session refused as an activity is noted, not counted against the stored batch', async () => {
  const start = new Date(Date.now() - 10 * 86400000);
  start.setUTCHours(2, 0, 0, 0);
  // Inside a record's seven-day limit, and far past any plausible workout.
  const end = new Date(start.getTime() + 6 * 86400000);
  mocks.apply.mockResolvedValue({ accepted: 1, deleted: 0 });
  const response = await POST(
    request({
      records: [{
        id: 'hc-long', type: 'ExerciseSession', exerciseType: 79, sourcePackage: 'com.test', recordingMethod: 2,
        start: start.toISOString(), end: end.toISOString(), modifiedAt: start.toISOString(),
      }],
      deleted: [],
    }),
  );
  const json = await response.json();
  expect(json.rejected).toEqual([]);
  expect(json.workoutNotes).toEqual([expect.stringMatching(/^exercise /)]);
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.tombstone).not.toHaveBeenCalled();
});
