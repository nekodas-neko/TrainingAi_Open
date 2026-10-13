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
    applyHealthConnectBatch: mocks.apply,
    rebuildHealthConnect: mocks.rebuild,
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
  expect(mocks.apply).toHaveBeenCalledWith(userId, body);
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

it('rejects future records, duplicate IDs, and oversized bodies before repository writes', async () => {
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
  expect((await POST(request({ records: [row], deleted: [] }))).status).toBe(400);
  const past = {
    ...row,
    start: '2026-01-01T00:00:00Z',
    end: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };
  expect((await POST(request({ records: [past, past], deleted: [] }))).status).toBe(400);
  expect((await POST(request({ junk: 'x'.repeat(2 * 1024 * 1024) }))).status).toBe(413);
  expect(mocks.apply).not.toHaveBeenCalled();
});
