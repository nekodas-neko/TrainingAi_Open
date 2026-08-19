/**
 * Save an image into the device gallery (Q-400).
 *
 * The one button the label sheet shipped with did nothing on the APK: `navigator.canShare({ files })`
 * is not reliably available in the Samsung WebView so the guard correctly declined, and the
 * `<a download>` fallback behind it is a silent no-op there. The feature had only ever worked in
 * `pnpm dev`. This is the native path; the browser download stays as the `pnpm dev` fallback and
 * nothing else.
 */

interface MediaSavePlugin {
  saveImage(opts: { base64: string; filename: string; mimeType: string }): Promise<{ uri: string }>
  isAvailable(): Promise<{ available: boolean }>
}

/**
 * Returns the native MediaSave plugin, or null when unavailable: a plain browser, or an APK built
 * before this plugin existed. The WebView's JS ships from Railway independently of the APK, so the
 * two are routinely out of step and "the plugin is missing" is a normal state, not an error.
 *
 * Returns `{ plugin }` rather than the bare proxy, for the same thenable reason as the BLE wrappers:
 * a Capacitor plugin proxy answers `then` with a function, so returning it directly from an async
 * function makes it await itself forever.
 */
async function getMediaSave(): Promise<
  { kind: 'plugin'; plugin: MediaSavePlugin } | { kind: 'native-without-plugin' } | { kind: 'browser' }
> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return { kind: 'browser' }
    if (!Capacitor.isPluginAvailable('MediaSave')) return { kind: 'native-without-plugin' }
    return { kind: 'plugin', plugin: registerPlugin<MediaSavePlugin>('MediaSave') }
  } catch {
    return { kind: 'browser' }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    // `result` is a data: URL; the plugin takes the raw payload so it never has to guess a MIME
    // type it was also handed.
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

export type SaveOutcome =
  | { ok: true; where: 'gallery' | 'download' }
  | { ok: false; reason: string }

/**
 * Write `blob` to the gallery on the device, or trigger a browser download off it.
 *
 * Never throws. Every caller of this ends in a toast, and a silent path is what made the original
 * defect invisible for a release — so the failure reason comes back as a value rather than being
 * swallowed here.
 */
export async function saveImageToGallery(blob: Blob, filename: string): Promise<SaveOutcome> {
  const target = await getMediaSave()

  // **On the device, never fall through to the download branch.** `<a download>` is a silent no-op
  // inside the Samsung WebView — that IS the bug — so a fall-through would report success and do
  // nothing, which is worse than the dead button this replaced. Every native branch that cannot
  // save says why instead.
  if (target.kind === 'native-without-plugin') {
    return { ok: false, reason: 'this app build cannot save images — update the APK' }
  }

  if (target.kind === 'plugin') {
    try {
      const { available } = await target.plugin.isAvailable()
      if (!available) return { ok: false, reason: 'saving to the gallery needs Android 10 or newer' }
      await target.plugin.saveImage({
        base64: await blobToBase64(blob),
        filename,
        mimeType: blob.type || 'image/png',
      })
      return { ok: true, where: 'gallery' }
    } catch (err) {
      return { ok: false, reason: (err as Error)?.message || 'the gallery refused the file' }
    }
  }

  // Browser only, so the label is reachable in `pnpm dev`.
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true, where: 'download' }
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message || 'the download could not start' }
  }
}
