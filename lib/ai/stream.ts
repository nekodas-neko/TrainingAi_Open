// Terminal marker appended when a text stream dies mid-flight (e.g. a 429 or
// provider error after tokens have already been sent). Clients strip it and
// surface an error state instead of showing a silent half-sentence.
export const AI_STREAM_ERROR_MARKER = '\n[[AI_STREAM_ERROR]]'

export function splitStreamError(text: string): { text: string; errored: boolean } {
  const idx = text.indexOf(AI_STREAM_ERROR_MARKER)
  if (idx === -1) return { text, errored: false }
  return { text: text.slice(0, idx).trimEnd(), errored: true }
}

// Wraps an AI SDK textStream into a plain-text Response. On mid-stream error the
// marker is emitted and the stream closed cleanly (HTTP status is already 200 by
// then — the marker is the only way to signal failure). onComplete runs inside
// the stream (before close) only on full success, so DB cache writes are
// guaranteed to finish before the response ends.
export function textStreamResponse(
  textStream: AsyncIterable<string>,
  opts: { onComplete?: (fullText: string) => Promise<void> } = {},
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = ''
      try {
        for await (const chunk of textStream) {
          full += chunk
          controller.enqueue(encoder.encode(chunk))
        }
        if (opts.onComplete) {
          try { await opts.onComplete(full) } catch (err) {
            console.error('[ai-stream] onComplete failed:', String(err).slice(0, 200))
          }
        }
      } catch (err) {
        console.error('[ai-stream] mid-stream error:', String(err).slice(0, 200))
        controller.enqueue(encoder.encode(AI_STREAM_ERROR_MARKER))
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
