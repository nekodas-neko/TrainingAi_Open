import { formatDayShort } from "@trainingai/shared/date-utils";

/**
 * Where the numbers under "Recommended workout" came from, when that is NOT a server payload
 * built today (RV-202 ③). The screen has three paint sources and only one of them is today's
 * answer, so two of them used to present yesterday's — or the program's un-prescribed — sets
 * under a heading that says "Recommended" and nothing else.
 *
 * The global offline pill ("Offline — showing saved data") is a different fact and does not
 * cover this: it says the connection is down, not which day's numbers are on screen, and the
 * misleading case also happens ONLINE, while a cache seed paints ahead of revalidation.
 */
export type NumbersSource =
  /** A cached payload stamped with an earlier day — offline, or a seed painted before its fetch lands. */
  | { kind: "cached"; date: string }
  /** The on-device program mirror: the program's own per-set style, with no prescription applied. */
  | { kind: "base" }
  /**
   * Today's payload, but its prescription is a rules plan (#2110): the model could not be reached,
   * so the numbers are the program's own sets fitted to today's time budget. Unlabelled, they sat
   * under "Recommended workout" looking exactly like a coached plan.
   */
  | { kind: "rules" };

/**
 * The one place the label's wording lives. `null` means say nothing — which is the right answer
 * for today's payload, and also for a cached payload carrying no `dataDate` at all (an entry
 * written before the route stamped one): there is no day to name, and naming a guessed one
 * would be worse than the silence.
 */
export function numbersSourceLabel(source: NumbersSource | null | undefined): string | null {
  if (!source) return null;
  switch (source.kind) {
    case "base": return "Base program";
    case "rules": return "From your program";
    case "cached": return `From ${formatDayShort(source.date)}`;
  }
}

/**
 * A payload's source, or `null` when it is today's coached plan and needs no label.
 *
 * An earlier day wins over a rules plan: "these are not today's numbers" is the fact that can
 * mislead more, and a stale payload's rules plan may already have been replaced by a model one.
 */
export function payloadNumbersSource(
  data: { dataDate?: string; prescriptionSource?: string } | null | undefined,
  isToday: boolean,
): NumbersSource | null {
  if (!isToday) return data?.dataDate ? { kind: "cached", date: data.dataDate } : null;
  return data?.prescriptionSource === "rules" ? { kind: "rules" } : null;
}
