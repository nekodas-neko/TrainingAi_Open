import { useState } from 'react';
import { sendDiagnosticReport } from './client';

export function useReports() {
  const [reportAutomatically, setReportAutomatically] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  async function report(...args: Parameters<typeof sendDiagnosticReport>) {
    setReportBusy(true);
    setReportStatus(null);
    try {
      await sendDiagnosticReport(...args);
      setReportStatus('Report sent to your PC.');
    } catch (error) {
      setReportStatus(error instanceof Error ? error.message : 'Could not send the report.');
    } finally {
      setReportBusy(false);
    }
  }
  return { reportAutomatically, setReportAutomatically, reportBusy, reportStatus, setReportStatus, report };
}
