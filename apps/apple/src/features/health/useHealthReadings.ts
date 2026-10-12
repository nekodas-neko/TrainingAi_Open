import { useState } from 'react';
import { readHealthSnapshot } from '../../integrations/apple-health/readHealth';
import { sampleSnapshot } from './sample';
import type { HealthSnapshot } from './types';

export function useHealthReadings() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect(afterRead?: (snapshot: HealthSnapshot | null, error: string | null) => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      const readings = await readHealthSnapshot();
      setSnapshot(readings);
      await afterRead?.(readings, null);
      return readings;
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'Unable to read Apple Health.';
      setError(failure);
      await afterRead?.(null, failure);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function clear() { setSnapshot(null); setError(null); }
  function loadSample() { setSnapshot(sampleSnapshot()); setError(null); }
  return { snapshot, busy, error, connect, clear, loadSample };
}
