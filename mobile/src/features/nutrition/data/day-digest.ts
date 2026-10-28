// What End of Day's "Your day" card says when it has no summary to draw (#3504). The server answers
// a day with nothing logged with `digest: null`. That is an answer, not a wait, so it must not keep
// reading "Preparing…" as if the summary were still on its way.
export const DIGEST_TODAY_ONLY = 'The daily digest is available for today.';
export const DIGEST_PREPARING = 'Preparing your day’s summary…';
export const DIGEST_NOTHING_YET =
  'Nothing to summarise yet. Your summary appears once you log a meal or a workout.';

/** The card's line, or null when there is a summary to show instead. */
export function digestCardText(input: {
  isToday: boolean;
  /** An answer is known: the cached copy or the server's reply has arrived. */
  answered: boolean;
  digest: string | null;
  error: string | null;
}): string | null {
  if (!input.isToday) return DIGEST_TODAY_ONLY;
  if (input.digest) return null;
  if (input.error) return input.error;
  return input.answered ? DIGEST_NOTHING_YET : DIGEST_PREPARING;
}
