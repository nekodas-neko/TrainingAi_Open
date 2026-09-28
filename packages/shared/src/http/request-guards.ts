export type LimitedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'too_large' | 'invalid_json' | 'no_body' | 'empty' | 'aborted' }

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
    // LB-14 — a client that hangs up mid-post is not a server fault, and it was being recorded as
    // one. `reader.read()` rejects when the inbound stream is cancelled (the native BLE service
    // being backgrounded mid-post is the real cause), nothing caught it, so it reached Next's
    // `onRequestError` and was written to BOTH `error_events` and Sentry — 100 rows in the 30-day
    // window, and `error_events` is the table every session reads to orient.
    //
    // **Caught HERE rather than filtered at the reporting layer, and the difference was measured.**
    // The reproduction (a chunked POST whose socket is destroyed mid-body) throws
    // `Error{ name: 'Error', code: 'ECONNRESET', message: 'aborted' }` — **not** a `DOMException`,
    // so the obvious `err.name === 'AbortError'` guard does not match it. A filter in
    // `recordRequestError` would therefore have to key on `ECONNRESET`, which an OUTBOUND fetch to
    // a third party also raises and which IS a server fault worth recording — or on the message
    // text, which is the fragile thing. Catching at the read is the only place that knows the reset
    // came from the inbound body.
    //
    // Every rejection here means the client's body did not arrive, so they all answer the same way.
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      return { ok: false, reason: 'aborted' }
    }
    const { done, value } = chunk
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

/**
 * The real type of an image, read from its leading bytes, or null when it is not one we accept.
 *
 * `isAllowedImageMime` above validates a DECLARED type, which is a different question and not one
 * that helps when nothing declares it honestly: `/api/admin/reference-figure` stored every upload
 * as `image/png` whatever arrived, and the phone that uploads to it shoots HEIC and JPEG (DV-18).
 * A wrong type is invisible at the upload and shows up much later as a picture that will not
 * decode, so the bytes are the only thing worth asking.
 *
 * Signatures: PNG's 8-byte header, JPEG's `FF D8 FF` start-of-image, and WebP's RIFF container
 * with a `WEBP` form type at offset 8. Deliberately not a general sniffer — three formats, which
 * are exactly `ALLOWED_IMAGE_MIME`, and anything else is a rejection rather than a guess.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  const at = (i: number, ...want: number[]) => want.every((w, k) => bytes[i + k] === w)
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

export type ImageDataUriRejection =
  | 'not_a_string'
  | 'not_a_data_uri'
  | 'declared_type_not_allowed'
  | 'not_base64'
  | 'too_large'
  | 'bytes_are_not_an_image'
  | 'declared_type_does_not_match_bytes'

export type ParsedImageDataUri =
  | { ok: true; mime: AllowedImageMime; bytes: number }
  | { ok: false; reason: ImageDataUriRejection }

/**
 * Validate a `data:image/…;base64,…` string as an image, by its BYTES (RV-191).
 *
 * **Why the declared type is not enough, and this is the whole point of the function.** The MIME in
 * a data URI is written by whoever sends it. `data:image/png;base64,<SVG>` declares PNG and carries
 * SVG, so a check on the declaration alone passes it — which is what `/api/user/avatar` did, and
 * what `/api/feedback` did not check at all. `sniffImageMime` reads the leading bytes, and this
 * requires the two to AGREE: a file that lies about itself is rejected even when both halves are
 * individually allowed (a JPEG declared as PNG is still a lie, and the admin UI renders the
 * declared type).
 *
 * **What it is not.** It does not make a stored data URI safe to navigate to — nothing here can,
 * because that is the reader's decision. Measured 2026-09-25 on Chromium: `window.open` to a
 * `data:` URI does not navigate, and SVG inside `<img>` is script-inert, so RV-191's stated
 * admin-RCE path did not reproduce. This is the boundary doing its own job: what reaches the
 * column is an image, rather than 500 KB of anything at all.
 */
export function parseImageDataUri(value: unknown, maxDecodedBytes: number): ParsedImageDataUri {
  if (typeof value !== 'string') return { ok: false, reason: 'not_a_string' }
  // `[\s\S]*` rather than `.` with the `s` flag: the shared package targets a lower ES level and
  // the flag does not compile there. A base64 payload can contain newlines.
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value)
  if (!m) return { ok: false, reason: 'not_a_data_uri' }
  const [, declared, b64] = m
  if (!isAllowedImageMime(declared)) return { ok: false, reason: 'declared_type_not_allowed' }

  // Cheap reject before decoding, so an oversized payload is not materialised to be measured.
  if (Math.ceil(b64.length * 0.75) > maxDecodedBytes) return { ok: false, reason: 'too_large' }

  let bytes: Buffer
  try {
    bytes = Buffer.from(b64, 'base64')
  } catch {
    return { ok: false, reason: 'not_base64' }
  }
  // `Buffer.from(…, 'base64')` does not throw on junk — it skips what it cannot decode and can
  // return an empty buffer, so emptiness is the real signal that nothing decodable arrived.
  if (bytes.length === 0) return { ok: false, reason: 'not_base64' }
  if (bytes.length > maxDecodedBytes) return { ok: false, reason: 'too_large' }

  const sniffed = sniffImageMime(bytes)
  if (!sniffed) return { ok: false, reason: 'bytes_are_not_an_image' }
  if (sniffed !== declared) return { ok: false, reason: 'declared_type_does_not_match_bytes' }
  return { ok: true, mime: sniffed, bytes: bytes.length }
}
