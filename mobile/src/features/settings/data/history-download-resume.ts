import { onResume } from '../../../core/sync/resume';
import type { HistoryDownload } from '../../../core/sync/HistoryDownload';

/**
 * Carries an interrupted history download on now, on a return to the foreground and when the
 * connection comes back (#3923 review: a drop left it paused until the next foreground). Changes
 * waiting on this phone upload first, so it reads days that already hold them.
 */
export function followHistoryDownload(
  download: Pick<HistoryDownload, 'resumeIfInterrupted'> | null,
  uploads: () => (Promise<unknown> | undefined)[],
) {
  const resume = async () => {
    await Promise.allSettled(uploads());
    await download?.resumeIfInterrupted();
  };
  void resume();
  return onResume(() => void resume());
}
