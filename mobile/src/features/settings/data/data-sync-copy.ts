// Data & Sync wording, word for word as the current app's Data & Sync panel writes it
// (`components/more/data-sync-panel.tsx`, `components/more/history-import-row.tsx`).
/** The current app's import window (`HISTORY_WINDOW_DAYS` in `lib/health-connect-history-import.ts`). */
export const HISTORY_WINDOW_DAYS = 30;

export const dataSyncCopy = {
  sync: { title: 'Sync now', caption: 'Pull latest data from server' },
  restore: {
    title: 'Restore from cloud',
    caption: 'Rebuild full history after a wipe / on a new device',
    // Preview picks how far back to save, which the current app does not, so it says what that does.
    detail:
      'Saves your history to this phone so it opens offline. Your unsent changes and unfinished workouts are kept.',
  },
  exportData: { title: 'Export my data', caption: 'Download everything as a single file' },
} as const;

export function importCaption(deviceHealthName: string) {
  return `Pull older ${deviceHealthName} data, ${HISTORY_WINDOW_DAYS} days at a time`;
}
