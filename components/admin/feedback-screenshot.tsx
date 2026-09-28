'use client'

import { parseImageDataUrl } from '@trainingai/shared/http/request-guards'

/**
 * A feedback screenshot, shown only if it is provably an image.
 *
 * RV-191. The stored value came from any signed-in user, and rows written before the route
 * validated it may hold anything, so it is parsed again here. Anything that does not parse
 * renders as a note, never as a `src`. Opening it builds a blob from the decoded bytes, so the
 * click never navigates to the stored string.
 */
export function FeedbackScreenshot({ data }: { data: string }) {
  const image = parseImageDataUrl(data)
  if (!image) {
    return <p className="text-xs text-muted-foreground">Screenshot withheld: not a PNG, JPEG or WebP image.</p>
  }
  const open = () => {
    const url = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.mime }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- base64 screenshot, variable size
    <img
      src={data}
      alt="Screenshot"
      className="rounded-xl max-w-full border border-border cursor-zoom-in"
      onClick={open}
    />
  )
}
