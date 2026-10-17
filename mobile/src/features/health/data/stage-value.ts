import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { metricValue } from './models';

// Sleep stages are stored in hours but read as "1h 05m", as in the current app.
export function stageValue(value: unknown, unit: string) {
  return unit === 'h' && typeof value === 'number' && Number.isFinite(value)
    ? formatHoursMinutes(value * 60)
    : metricValue(value, unit, 1);
}
