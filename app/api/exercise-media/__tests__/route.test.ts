import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rate: vi.fn(),
  media: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rate }));
vi.mock("@/lib/observability", () => ({ reportServerError: mocks.report }));
vi.mock("@/app/exercise-media/[...key]/route", () => ({ GET: mocks.media }));
import { GET } from "../[...key]/route";

describe("authenticated exercise media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user" } });
    mocks.rate.mockReturnValue(true);
    mocks.media.mockImplementation(
      async () =>
        new Response(new Uint8Array([71, 73, 70]), {
          headers: { "content-type": "image/gif", "cache-control": "public" },
        }),
    );
  });
  const request = () =>
    new Request("https://example.com/api/exercise-media/gifs/male/press.gif");
  it("requires an authenticated account before storage access", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(
      (
        await GET(request(), {
          params: Promise.resolve({ key: ["gifs", "male", "press.gif"] }),
        })
      ).status,
    ).toBe(401);
    expect(mocks.media).not.toHaveBeenCalled();
  });
  it("rejects path traversal and rate-limited requests", async () => {
    expect(
      (
        await GET(request(), {
          params: Promise.resolve({ key: ["..", "private"] }),
        })
      ).status,
    ).toBe(400);
    mocks.rate.mockReturnValue(false);
    expect(
      (
        await GET(request(), {
          params: Promise.resolve({ key: ["gifs", "press.gif"] }),
        })
      ).status,
    ).toBe(429);
    expect(mocks.media).not.toHaveBeenCalled();
  });
  it("preserves the existing media bytes and type with a private API response", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ key: ["gifs", "male", "press.gif"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.arrayBuffer()).byteLength).toBe(3);
  });
});
