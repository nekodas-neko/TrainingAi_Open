/**
 * Q-541 — the blob codec for packed raw BLE frames.
 *
 * The database spends ~328 bytes per row to store a ~12-byte ring frame, and that overhead — not the
 * data — is 93% of the largest table we have. It is also what caused the 2026-08-17 `disk_full`
 * outage: a full `measured_at` re-stamp rewrote 681,005 rows with zero HOT updates. Packing a
 * bucket's frames into one sealed blob replaces ~1,135 rows with 1, and a sealed blob is never
 * updated, so it cannot bloat.
 *
 * **This module is pure and dependency-free on purpose.** It is the one piece the archival guarantee
 * rests on — `CLAUDE.md` makes `body_hex` the server-side source of truth, and packing is only
 * legitimate because it is byte-for-byte reversible. Anything that needs a hash, a database, or a
 * clock belongs in the packer, not here, so that this can be property-tested in isolation.
 *
 * Format, per the plan's §5:
 *
 * ```
 * byte 0        format version (0x01)
 * varint        frame count
 * varint        base_ds            the bucket's lowest ring_timestamp_ds
 * per frame, ds ascending:
 *   varint      ds delta from the previous frame (the first is a delta from base_ds)
 *   varint      body length in bytes
 *   bytes       body
 * ```
 *
 * Deltas rather than absolute ds because a bucket is one day of one tag: the gaps are small and the
 * absolute values are ~37 million, so varint deltas cost 1–2 bytes where an absolute would cost 5.
 */

export const FRAME_PACK_VERSION = 0x01

export interface RawFrame {
  /** `oura_raw_samples.ring_timestamp_ds` — a monotonic decisecond counter since the ring's epoch. */
  ds: number
  /** The decoded-from-hex bytes of `body_hex`. Stored as bytes, which is where the `text` → `bytea`
   *  halving of Q-540 is absorbed. */
  body: Uint8Array
}

/** LEB128, unsigned. Safe-integer domain only — `ds` is ~10^7 and body lengths are ≤ 1,024. */
function writeVarint(out: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`frame-pack: varint out of range: ${value}`)
  }
  let v = value
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
}

function readVarint(buf: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0
  let shift = 1
  let i = pos
  for (;;) {
    if (i >= buf.length) throw new RangeError('frame-pack: truncated varint')
    const byte = buf[i++]
    value += (byte & 0x7f) * shift
    if ((byte & 0x80) === 0) break
    shift *= 128
    if (!Number.isSafeInteger(value)) throw new RangeError('frame-pack: varint exceeds safe integer')
  }
  return { value, next: i }
}

/**
 * Pack a bucket's frames into one blob.
 *
 * Sorts by `ds` rather than trusting the caller: the delta encoding requires ascending order, and a
 * caller that passed an unsorted list would otherwise produce a blob that unpacks to different data
 * instead of failing. Two frames may share a `ds` — the dedup key is
 * `(user_id, ds, tag, body_hex)`, so a zero delta is legal and must round-trip.
 */
export function packFrames(frames: readonly RawFrame[]): Uint8Array {
  const sorted = [...frames].sort((a, b) => a.ds - b.ds)
  const out: number[] = [FRAME_PACK_VERSION]
  writeVarint(out, sorted.length)
  const baseDs = sorted.length > 0 ? sorted[0].ds : 0
  writeVarint(out, baseDs)

  let prev = baseDs
  for (const f of sorted) {
    if (!Number.isSafeInteger(f.ds) || f.ds < 0) {
      throw new RangeError(`frame-pack: ds out of range: ${f.ds}`)
    }
    writeVarint(out, f.ds - prev)
    writeVarint(out, f.body.length)
    for (const b of f.body) out.push(b)
    prev = f.ds
  }
  return Uint8Array.from(out)
}

/**
 * Unpack a blob back to its frames, in ascending `ds` order.
 *
 * Throws rather than returning partial data. Unlike the event decoders — which are deliberately
 * infallible, returning `null` for an unknown body so the raw row still stores — a malformed blob
 * means the archive itself is wrong, and the packer's verify step (plan §6 phase 2) must see that as
 * a failure and delete nothing.
 */
export function unpackFrames(blob: Uint8Array): RawFrame[] {
  if (blob.length < 1) throw new RangeError('frame-pack: empty blob')
  const version = blob[0]
  if (version !== FRAME_PACK_VERSION) {
    throw new RangeError(`frame-pack: unsupported format version 0x${version.toString(16)}`)
  }

  let pos = 1
  const count = readVarint(blob, pos); pos = count.next
  const base = readVarint(blob, pos); pos = base.next

  const frames: RawFrame[] = []
  let prev = base.value
  for (let i = 0; i < count.value; i++) {
    const delta = readVarint(blob, pos); pos = delta.next
    const len = readVarint(blob, pos); pos = len.next
    if (pos + len.value > blob.length) throw new RangeError('frame-pack: truncated body')
    const ds = prev + delta.value
    frames.push({ ds, body: blob.slice(pos, pos + len.value) })
    pos += len.value
    prev = ds
  }
  if (pos !== blob.length) {
    throw new RangeError(`frame-pack: ${blob.length - pos} trailing bytes after ${count.value} frames`)
  }
  return frames
}

/** Hex → bytes, for packing rows that still carry `body_hex`. Rejects a malformed string rather
 *  than silently dropping a nibble, since the result is what the archive becomes. */
export function hexToBody(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new RangeError(`frame-pack: odd-length hex (${hex.length})`)
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new RangeError('frame-pack: non-hex character in body_hex')
    out[i] = byte
  }
  return out
}

/** Bytes → lowercase hex, the inverse of `hexToBody`, for proving a round trip against stored rows. */
export function bodyToHex(body: Uint8Array): string {
  let s = ''
  for (const b of body) s += b.toString(16).padStart(2, '0')
  return s
}
