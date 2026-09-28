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
  | { kind: "base" };

/**
 * The one place the label's wording lives. `null` means say nothing — which is the right answer
 * for today's payload, and also for a cached payload carrying no `dataDate` at all (an entry
 * written before the route stamped one): there is no day to name, and naming a guessed one
 * would be worse than the silence.
 */
export function numbersSourceLabel(source: NumbersSource | null | undefined): string | null {
  if (!source) return null;
  return source.kind === "base" ? "Base program" : `From ${formatDayShort(source.date)}`;
}

/** A cached/seeded payload's source, or `null` when it is today's and needs no label. */
export function cachedNumbersSource(
  data: { dataDate?: string } | null | undefined,
  isToday: boolean,
): NumbersSource | null {
  if (isToday || !data?.dataDate) return null;
  return { kind: "cached", date: data.dataDate };
}
