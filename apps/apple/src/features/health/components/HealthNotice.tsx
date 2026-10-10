import { Notice } from '../../../shared/ui';
import type { HealthSnapshot } from '../types';

export function HealthNotice({
  snapshot,
  reportsAvailable,
}: {
  snapshot: HealthSnapshot | null;
  reportsAvailable: boolean;
}) {
  return (
    <Notice
      title={
        snapshot?.mode === 'sample'
          ? 'Sample data'
          : snapshot?.mode === 'device'
            ? 'Apple Health'
            : 'No health data loaded'
      }
      message={
        snapshot?.mode === 'sample'
          ? 'Fictional readings for previewing the app.'
          : reportsAvailable
            ? 'Readings stay on this device unless you send a development report to your PC.'
            : 'Readings stay on this device. Nothing is uploaded.'
      }
    />
  );
}
