// Shared client → /api/client-error reporter. Mirrors the report block the root
// error boundary uses (app/error.tsx), so K1 (workout boundary) and K4 (dead
// local store) write the same `error_events` shape instead of re-inlining it.
//
// Only call while online — an offline report fetch fails anyway, and offline is
// not an error worth recording. Fire-and-forget: never throws.
export function reportClientError(info: { message: string; stack?: string; url?: string }): void {
  if (typeof navigator === 'undefined' || !navigator.onLine) return;
  const body = JSON.stringify({
    message: info.message,
    stack: info.stack,
    url: info.url ?? (typeof window !== 'undefined' ? window.location.href : undefined),
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* reporting is best-effort */
  }
}
