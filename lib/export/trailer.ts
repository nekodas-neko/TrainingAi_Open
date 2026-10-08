/**
 * The last line of a `/api/export` file (#2427).
 *
 * The export is a streamed `200` attachment, so by the time anything can fail the status and headers
 * are already on the wire. Before this, a throw mid-stream closed the response cleanly and the user
 * kept a short file that looked whole. The file now ends with exactly one of these two lines, and
 * the rule for a reader is the simple one:
 *
 *   - last line `{"_complete":true}` → the file is complete;
 *   - last line `{"_error":{…}}`     → the server stopped part-way; the file is incomplete;
 *   - anything else (no trailer)     → the connection dropped or the request was killed part-way;
 *                                      the file is incomplete.
 *
 * Trailers carry top-level `_complete` / `_error` keys rather than the `{ domain, row }` shape so no
 * row-reading consumer can mistake one for a record: a reader that keys on `domain` skips them.
 *
 * `_error` is deliberately generic — a stable code and a fixed sentence, never the thrown message or
 * a stack. The thrown message can name tables, SQL and ids; it goes to `reportServerError`, where
 * the owner can read it, not into a file the user may forward.
 */

export const EXPORT_COMPLETE_TRAILER = { _complete: true } as const

export const EXPORT_FAILED_CODE = 'export_failed'

export const EXPORT_ERROR_TRAILER = {
  _error: {
    code: EXPORT_FAILED_CODE,
    message: 'The export stopped before it finished. This file is incomplete — try the export again.',
  },
} as const

export type ExportTrailer = typeof EXPORT_COMPLETE_TRAILER | typeof EXPORT_ERROR_TRAILER

