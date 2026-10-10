import { isRunningInExpoGo } from 'expo';
import type { HealthMetric, HealthSnapshot } from '../../features/health/types';
import { coveredMinutes } from '../../features/health/intervals';
import { inspectHealth, inspectionReadTypes } from './inspectHealth.ios';

export async function readHealthSnapshot(): Promise<HealthSnapshot> {
  if (isRunningInExpoGo()) {
    throw new Error('Apple Health is unavailable in Expo Go. Use Explore sample data for this preview.');
  }
  // Load on demand so the sample screens can still open when the native module is unavailable.
  const health = await import('@kingstinct/react-native-healthkit');
  if (!health.isHealthDataAvailable()) { throw new Error('Apple Health is unavailable on this device.'); }
  const completed = await health.requestAuthorization({ toRead: inspectionReadTypes.filter(x => health.isObjectTypeAvailable(x)) });
  if (!completed) { throw new Error('The Apple Health permission request did not complete.'); }
  // Completion does not mean read access was granted. Empty results remain unavailable.
  const end = new Date();
  const start = new Date(end.getTime() - 36 * 60 * 60 * 1000);
  const options = { limit: 1, ascending: false, filter: { date: { startDate: start, endDate: end } } };
  const results = await Promise.allSettled([
    health.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { ...options, limit: 5000 }),
    health.queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', { ...options, unit: 'count/min' }),
    health.queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate', { ...options, unit: 'count/min' }),
    health.queryQuantitySamples('HKQuantityTypeIdentifierStepCount', { ...options, unit: 'count' }),
    health.queryQuantitySamples('HKQuantityTypeIdentifierActiveEnergyBurned', { ...options, unit: 'kcal' }),
  ] as const);
  const metrics: HealthMetric[] = [];
  const sleep = results[0];
  if (sleep.status === 'fulfilled' && sleep.value.length < 5000) {
    // Apple categories: 1 unspecified asleep, 3 core, 4 deep, 5 REM. Exclude in-bed/awake.
    const asleep = sleep.value.filter(x => [1, 3, 4, 5].includes(x.value));
    const minutes = Math.round(coveredMinutes(asleep.map(x => ({ start: x.startDate.getTime(), end: x.endDate.getTime() })), start.getTime(), end.getTime()));
    metrics.push({ key: 'sleep', label: 'Sleep · last 36 hours', value: asleep.length ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : null,
      detail: 'Combined asleep intervals across available sources, including naps. Overlaps counted once; not a sleep score.',
      source: [...new Set(asleep.map(x => x.sourceRevision.source.name))].join(', ') || undefined });
  } else {
    metrics.push({ key: 'sleep', label: 'Sleep · last 36 hours', value: null, detail: sleep.status === 'rejected' ? 'Sleep could not be read. Try again from an unlocked phone.' : 'Too many records for this preview; a complete history query is needed.' });
  }
  const definitions = [
    { key: 'hr', label: 'Latest heart rate', unit: 'bpm', interval: false },
    { key: 'rhr', label: 'Latest resting heart rate', unit: 'bpm', interval: false },
    { key: 'steps', label: 'Latest steps interval', unit: 'steps', interval: true },
    { key: 'energy', label: 'Latest active energy interval', unit: 'kcal', interval: true },
  ];
  for (const [index, definition] of definitions.entries()) {
    const result = results[index + 1];
    const sample = result.status === 'fulfilled' ? result.value[0] : undefined;
    const quantity = sample && 'quantity' in sample ? sample.quantity : undefined;
    metrics.push({ key: definition.key, label: definition.label,
      value: quantity !== undefined ? `${Math.round(quantity)} ${definition.unit}` : null,
      detail: sample ? `${sample.startDate.toLocaleString()} – ${sample.endDate.toLocaleString()}${definition.interval ? ' · One interval, not a daily total.' : ''}` : result.status === 'rejected' ? 'This metric could not be read.' : 'No readable sample in the last 36 hours. Data may be absent or access may be off.',
      source: sample?.sourceRevision.source.name });
  }
  const inspection = await inspectHealth(health, end);
  return { mode: 'device', readAt: end.toISOString(), metrics, inspection };
}
