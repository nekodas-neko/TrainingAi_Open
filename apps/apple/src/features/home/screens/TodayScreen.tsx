import { Button, Text, View } from 'react-native';
import { useHealthContext } from '../../health/HealthProvider';
import type { AppStyles } from '../../../shared/theme/useAppTheme';

export function TodayScreen({ styles: s }: { styles: AppStyles }) {
  const health = useHealthContext();
  const { snapshot, busy } = health;
  return (
    <>
      {snapshot ? (
        snapshot.metrics.map((metric) => (
          <View key={metric.key} style={s.card}>
            <View style={s.row}>
              <Text style={s.label}>{metric.label}</Text>
              <Text style={s.value}>{metric.value ?? 'Unavailable'}</Text>
            </View>
            <Text style={s.muted}>{metric.detail}</Text>
            {metric.source && <Text style={s.small}>Source: {metric.source}</Text>}
          </View>
        ))
      ) : (
        <View style={s.card}>
          <Text style={s.heading}>No readings loaded</Text>
          <Text style={s.muted}>
            Open the Data tab to connect Apple Health and load your readings.
          </Text>
        </View>
      )}
      <View style={s.actions}>
        <Button
          title="Explore sample data"
          disabled={busy}
          onPress={() => {
            health.loadSample();
          }}
        />
      </View>
    </>
  );
}
