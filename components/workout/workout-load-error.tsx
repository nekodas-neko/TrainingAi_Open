/**
 * K2: the primary load failed with nothing to show — a terminal error-with-retry instead of an
 * infinite skeleton. The caller's `onError` is online-gated, so reaching this means a server
 * failure, not offline (offline paints the pill plus whatever the local mirror seeded).
 *
 * Extracted from `workout-screen.tsx` per Q-138's proposed split for that file — it is a known
 * size hotspot, so anything added to it should be paid for by taking something out.
 */
export function WorkoutLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 pt-safe pb-safe text-center">
      <p className="text-base font-semibold">Couldn&apos;t load this session</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Something went wrong loading your workout. Your logged data is safe.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex h-12 items-center justify-center rounded-xl bg-brand px-6 text-base font-semibold text-brand-foreground"
      >
        Retry
      </button>
    </div>
  );
}
