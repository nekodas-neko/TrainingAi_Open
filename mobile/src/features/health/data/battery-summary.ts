import { BODY_BATTERY_TREND_LABEL } from '@trainingai/shared/health/body-battery-copy';
import { metricValue } from './models.ts';

type Battery = {
  hasData?: boolean | null;
  current?: number | null;
  label: string;
  trend: keyof typeof BODY_BATTERY_TREND_LABEL;
};

/** Body Battery's headline, as Home's card shows it: "64" and "Good · Charging". */
export function batterySummary(data: Battery | null | undefined) {
  return {
    value: data?.hasData ? metricValue(data.current) : undefined,
    subtitle: data?.hasData
      ? `${data.label} · ${BODY_BATTERY_TREND_LABEL[data.trend]}`
      : data
        ? 'No data yet'
        : 'Waiting for readings',
  };
}
