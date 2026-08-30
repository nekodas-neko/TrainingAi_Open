export type LimitedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'too_large' | 'invalid_json' | 'no_body' | 'empty' }

// Size-guarded JSON body read: checks Content-Length first, then streams with
// a hard byte cap so an oversized body is cancelled instead of buffered —
// unlike req.json(), which buffers everything before any check can run.
export async function readJsonLimited(req: Request, maxBytes: number): Promise<LimitedJsonResult> {
  const contentLength = req.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxBytes) return { ok: false, reason: 'too_large' }

  const reader = req.body?.getReader()
  if (!reader) return { ok: false, reason: 'no_body' }

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return { ok: false, reason: 'too_large' }
    }
    chunks.push(value)
  }
  // BF-3 — zero bytes is ABSENT, not malformed, and the two need different answers. A `POST` with
  // no body still has a readable stream (`fetch(url, { method: 'POST' })` and curl's `-X POST` both
  // send `Content-Length: 0`), so `no_body` above does not cover it and `JSON.parse('')` throws —
  // which made an optional-body route 400 the exact request every shipped client sends. Caught on
  // the dev server, not by a test.
  //
  // Additive for every existing caller: they branch on `too_large` and treat everything else as a
  // 400, which is what an empty body already produced through `invalid_json`.
  if (total === 0) return { ok: false, reason: 'empty' }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number]

export function isAllowedImageMime(v: unknown): v is AllowedImageMime {
  return typeof v === 'string' && (ALLOWED_IMAGE_MIME as readonly string[]).includes(v)
}
