import { cn } from "@trainingai/shared/utils";

/**
 * The moving part of a progress bar, composited rather than laid out (RV-72).
 *
 * **Why not `width`.** Six bars transitioned `width` directly. Animating width forces layout and
 * paint on every frame **and reflows the bar's siblings** — on `time-summary-card` that is the
 * target tick sitting in the same track, on the macro rows it is the label and the numbers beside
 * them. `transform: scaleX()` composites on the GPU and touches nothing else in the row.
 *
 * **Why this renders only the FILL and not the track.** Every call site's track is already doing
 * work the primitive should not take over: it carries the `role="progressbar"` and its ARIA values,
 * the background colour (often derived from the fill colour at low alpha), a height that varies
 * from 1.5 to 2.5, and in one case an absolutely-positioned target tick. Swallowing all of that
 * would have meant a prop for each; owning the fill alone is the part that is genuinely identical.
 *
 * **The radius belongs to the track, and that is load-bearing.** `scaleX` scales the fill's
 * horizontal radius with it, so a `rounded-full` fill goes visibly oval at low percentages. Every
 * current track already sets `overflow-hidden rounded-full`, which clips the square fill to the
 * same shape at every value. A new caller without those two classes gets square ends.
 */
export function ProgressFill({
  pct,
  color,
  durationMs = 500,
  className,
}: {
  /** 0–100. Values outside are clamped: a bar is a bar, not a report of bad arithmetic. */
  pct: number;
  /** Any CSS colour — these call sites pass hex, `var(--token)` and rgba alike. */
  color: string;
  durationMs?: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  return (
    <div
      className={cn(
        "h-full w-full origin-left transition-transform motion-reduce:transition-none",
        className,
      )}
      style={{
        transform: `scaleX(${clamped / 100})`,
        background: color,
        transitionDuration: `${durationMs}ms`,
      }}
    />
  );
}
