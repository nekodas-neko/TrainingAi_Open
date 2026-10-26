import { AppText, Notice, Stack } from '../../../shared/ui';
import { adminJobs } from '../data/admin-jobs';
import { AdminJobCard } from './AdminJobCard';

export function AdminJobsPanel() {
  return (
    <Stack>
      <Notice
        title="Data jobs change stored history"
        message="Each job shows a dry run first. A write needs the dry run for the same dates, a verified snapshot, and the word typed. Rows that move are the owner’s call before they run."
      />
      {adminJobs.map((job) => (
        <AdminJobCard key={job.id} job={job} />
      ))}
      <AppText variant="caption" tone="muted">
        Jobs the owner retired on #2862, the ring archive and the Bluetooth console are not here.
      </AppText>
    </Stack>
  );
}
