import { BODY_BATTERY_TREND_LABEL } from '@trainingai/shared/health/body-battery-copy';
import { metricValue } from './models.ts';

type Battery = {
  hasData?: boolean | null;
  current?: number | null;
  label: string;
  trend: keyof typeof BODY_BATTERY_TREND_LABEL;
};

/**
 * Body Battery's headline as Home's card shows it: the level ("64"), its label ("Good", or why
 * there is none) and the trend ("Charging"). The card and the widget snapshot both read this.
 */
export function batterySummary(data: Battery | null | undefined) {
  const trend = data?.hasData ? data.trend : null;
  return {
    value: data?.hasData ? metricValue(data.current) : undefined,
    levelLabel: data?.hasData ? data.label : data ? 'No data yet' : 'Waiting for readings',
    trend,
    trendLabel: trend ? BODY_BATTERY_TREND_LABEL[trend] : null,
  };
}
