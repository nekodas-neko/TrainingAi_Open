import { isDateInput } from './admin-content';

/**
 * The data jobs still live after the owner's calls on #2862 (26 Oct): the four fix jobs (#2357,
 * #2760, the #2601 pair), the two re-scores that were left to a dry run first, and the derived-score
 * backfill (#2860 needs it). Not here, on purpose: the Body Battery re-derive (#2409), the stress
 * backfill (#2236), baseline phase tagging (#2460) and the temperature-baseline re-derive, which the
 * owner dropped; the ring archive and Pack; and the HR snapshot backfills, which have no dry run to
 * show (asked on #3368).
 */
export type JobRange = 'none' | 'required' | 'optional';
export type AdminJob = {
  id: string;
  title: string;
  issue: string;
  path: string;
  range: JobRange;
  /** What it does, in plain words. */
  what: string;
  /** What to read in the dry run before writing, and what to expect. */
  expect: string;
  /** Moves scores already shown to the user: tuning territory, so the owner decides. */
  movesPastScores?: boolean;
};

export const adminJobs: readonly AdminJob[] = [
  {
    id: 'rederive-styleless-one-rm',
    title: 'Re-derive styleless 1RMs',
    issue: '#2357',
    path: '/api/admin/rederive-styleless-one-rm',
    range: 'none',
    what: 'Styleless working sets lose the AMRAP discount. Raises each affected log’s stored 1RM, target 80% and set intensities. Upward only: a log that would go down is listed and left alone. Personal bests are not rewritten.',
    expect: 'wouldWrite should be about 118 logs (about +3% each). A real run writes up to 500 per call; run again while remaining is above 0.',
    movesPastScores: true,
  },
  {
    id: 'reencode-bodyweight-one-rm',
    title: 'Re-encode bodyweight 1RMs',
    issue: '#2760',
    path: '/api/admin/reencode-bodyweight-one-rm',
    range: 'none',
    what: 'Puts stored bodyweight 1RMs onto the smooth AMRAP discount. Upward only; personal bests are not rewritten.',
    expect: 'wouldWrite should be about 25 of the 32 stored bodyweight values. Run it beside the styleless re-derive.',
    movesPastScores: true,
  },
  {
    id: 'backfill-set-hrr1',
    title: 'Backfill set HRR1',
    issue: '#2601',
    path: '/api/admin/backfill-set-hrr1',
    range: 'none',
    what: 'Re-measures every stored set’s HRR1 from dense heart rate and rewrites its rest verdict, null included. Overwrites stored verdicts.',
    expect: 'Read drop60sCleared against the 63 ring sets, and the verdict transitions. Run this one first, then Recompute best HRR1.',
    movesPastScores: true,
  },
  {
    id: 'recompute-hrr1-best',
    title: 'Recompute best HRR1',
    issue: '#2601',
    path: '/api/admin/recompute-hrr1-best',
    range: 'none',
    what: 'Rewrites each workout’s best HRR1 as the highest of its sets’ HRR1, null where there is none.',
    expect: 'toNull should be about 25 ring-only sessions. Run after Backfill set HRR1.',
    movesPastScores: true,
  },
  {
    id: 'backfill-heart-health',
    title: 'Re-score heart-health days',
    issue: '#2093 · #2746',
    path: '/api/admin/backfill-heart-health',
    range: 'required',
    what: 'A pending prescribed day whose activities reached the prescribed minutes at moderate effort or above becomes completed. A completed row is never taken back and a skipped one is never touched.',
    expect: 'wouldComplete is the number of days that move; after a real run, written must equal it. Today is never included.',
    movesPastScores: true,
  },
  {
    id: 'backfill-shadow-readiness',
    title: 'Replay shadow readiness',
    issue: '#2636',
    path: '/api/admin/backfill-shadow-readiness',
    range: 'required',
    what: 'Replays the shadow readiness model over past days and writes only its own table. Nothing a user sees changes. A same-version row for the day is replaced, never another version’s.',
    expect: 'scored, unscored and wouldReplace. Today is never included.',
  },
  {
    id: 'backfill-derived-scores',
    title: 'Backfill sleep and readiness scores',
    issue: '#2860',
    path: '/api/admin/backfill-derived-scores',
    range: 'optional',
    what: 'Persists sleep and readiness scores across history. Leave the dates empty for the latest 31 days.',
    expect: 'Per pillar: written, unchanged, noScore. Each call can run about 370 queries, so keep to one page at a time.',
    movesPastScores: true,
  },
];

export const MAX_RANGE_DAYS = 31;
/** The word that unlocks a write. */
export const WRITE_PHRASE = 'WRITE';

const DAY = 86_400_000;
const dayNumber = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
const dateOk = (s: string) =>
  isDateInput(s) && new Date(dayNumber(s) * DAY).toISOString().slice(0, 10) === s;

export type JobParams = { from: string; to: string };
/** Why the dates cannot be sent, or null. The server checks again; this only saves a round trip. */
export function rangeProblem(job: Pick<AdminJob, 'range'>, p: JobParams): string | null {
  if (job.range === 'none') return null;
  if (job.range === 'optional' && !p.from && !p.to) return null;
  if (!dateOk(p.from) || !dateOk(p.to)) return 'Enter both dates as YYYY-MM-DD.';
  if (p.to < p.from) return '“To” must not be before “from”.';
  if (dayNumber(p.to) - dayNumber(p.from) + 1 > MAX_RANGE_DAYS)
    return `At most ${MAX_RANGE_DAYS} days per run.`;
  return null;
}
/** The query string. Only an explicit `dryRun=false` commits; every other path is a dry run. */
export function jobQuery(job: Pick<AdminJob, 'range'>, p: JobParams, write: boolean): Record<string, string> {
  const q: Record<string, string> = { dryRun: write ? 'false' : 'true' };
  if (job.range !== 'none' && (p.from || p.to)) {
    q.from = p.from;
    q.to = p.to;
  }
  return q;
}
export const sameParams = (a: JobParams, b: JobParams) => a.from === b.from && a.to === b.to;

export type JobReport = { dryRun?: boolean; summary?: unknown } & Record<string, unknown>;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** The summary as label / value rows, one level of nesting flattened (`sleep.written`). */
export function summaryRows(report: JobReport | null): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, v: unknown) => {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null)
      rows.push({ label, value: String(v) });
  };
  const summary = report?.summary;
  if (!isRecord(summary)) return rows;
  for (const [k, v] of Object.entries(summary)) {
    if (isRecord(v)) for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
    else add(k, v);
  }
  return rows;
}
/** `summary.remaining`, when the job pages its writes. */
export function remainingOf(report: JobReport | null): number {
  const s = report?.summary;
  return isRecord(s) && typeof s.remaining === 'number' ? s.remaining : 0;
}

/**
 * A write is offered only for a dry run the server confirmed as one, run with the same dates that
 * would be written, after the admin has said a verified snapshot exists and typed the word.
 */
export function canWrite(state: {
  dry: JobReport | null;
  dryParams: JobParams | null;
  params: JobParams;
  snapshot: boolean;
  typed: string;
}): boolean {
  return (
    state.dry?.dryRun === true &&
    state.dryParams !== null &&
    sameParams(state.dryParams, state.params) &&
    state.snapshot &&
    state.typed.trim() === WRITE_PHRASE
  );
}

/** The request client keeps only the status, so the plain-words reason is chosen from it here. */
export function jobFailure(failure: unknown): string {
  const status = (failure as { status?: unknown } | null)?.status;
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  if (status === 409) return 'The server refused this run. Nothing was written.';
  if (status === 400) return 'The server rejected those dates. Nothing was written.';
  if (status === 403) return 'You are not an admin.';
  return 'The run failed. Nothing is known to have been written, so run the dry run again to see where it stands.';
}
