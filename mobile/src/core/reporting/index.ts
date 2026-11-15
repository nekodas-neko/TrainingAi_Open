import { ErrorReporter, type ReportContext } from './ErrorReporter.ts';
import { failureReason } from './scrub.ts';
import { clock, jsStartedAt } from './start-clock.ts';
import { StartupTimings } from './StartupTimings.ts';

/** The app's one reporter. It stays off in tests and dev builds; `installErrorReporting` enables it. */
export const errorReporter = new ErrorReporter();
/** The app's one start-up timing report (#3774); off like the reporter until installed. */
export const startupTimings = new StartupTimings(jsStartedAt, clock);

/** Record an unexpected error. Safe to call anywhere: it never throws and never waits. */
export function reportError(error: unknown, context?: ReportContext): void {
  errorReporter.report(error, context);
}

/** A notice that keeps a short reason, so a screenshot says what failed; also reports the error. */
export function failureNotice(notice: string, error: unknown, context?: ReportContext): string {
  reportError(error, context);
  return `${notice} (${failureReason(error)})`;
}
