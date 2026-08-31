// BF-80 — turn a native record of the WebView renderer's death into an `error_events` row.
//
// The owner reported the app returning to a blank page after tabbing away, and production held
// nothing: `app/error.tsx` would have painted a fallback and filed a row for a JS exception, so the
// silence is the evidence. A dead renderer takes the reporter with it, which is precisely why the
// record has to be made natively (`RenderProcessRecovery.java`) and collected afterwards.
//
// Reporting is deliberately separate from recovering. The native side reloads whether or not this
// ever runs; this only decides whether the next occurrence is evidence or another blank screen.

import { reportClientError } from './client-error';

interface RendererBridge {
  consumeRenderProcessGone(): string;
}

interface RenderProcessGoneEvent {
  at: number;
  didCrash: boolean;
  sdk: number;
}

/** Exported for the test — the bridge only exists inside the APK's WebView. */
export function parseRenderProcessGone(raw: string): RenderProcessGoneEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is RenderProcessGoneEvent =>
    typeof e === 'object' && e !== null &&
    typeof (e as RenderProcessGoneEvent).at === 'number' &&
    typeof (e as RenderProcessGoneEvent).didCrash === 'boolean');
}

/**
 * The message for one death. `didCrash` is the only thing that separates the renderer crashing
 * from Android reclaiming it under memory pressure, and the two have different fixes — so it goes
 * in the message rather than being flattened away.
 */
export function renderProcessGoneMessage(event: RenderProcessGoneEvent): string {
  const cause = event.didCrash ? 'renderer crashed' : 'renderer reclaimed by the system';
  return `WebView render process gone (${cause}) — the app was recreated. SDK ${event.sdk}, ${new Date(event.at).toISOString()}`;
}

/**
 * Collect and report anything the native side recorded since the last boot. Safe to call on every
 * mount: consuming clears the native store, so one death is reported once.
 */
export function reportRenderProcessDeaths(): void {
  const bridge = (globalThis as { AndroidRenderer?: RendererBridge }).AndroidRenderer;
  if (!bridge) return;
  let raw: string;
  try {
    raw = bridge.consumeRenderProcessGone();
  } catch {
    return;
  }
  for (const event of parseRenderProcessGone(raw)) {
    reportClientError({ message: renderProcessGoneMessage(event) });
  }
}
