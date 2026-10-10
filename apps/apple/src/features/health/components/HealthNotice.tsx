import { Text, View } from 'react-native';
import type { HealthSnapshot } from '../types';
import type { AppStyles } from '../../../shared/theme/useAppTheme';

export function HealthNotice({
  snapshot,
  reportsAvailable,
  styles: s,
}: {
  snapshot: HealthSnapshot | null;
  reportsAvailable: boolean;
  styles: AppStyles;
}) {
  return (
    <View style={s.notice}>
      <Text style={s.noticeText}>
        {snapshot?.mode === 'sample'
          ? 'Sample data'
          : snapshot?.mode === 'device'
            ? 'Apple Health'
            : 'No health data loaded'}
      </Text>
      <Text style={s.small}>
        {snapshot?.mode === 'sample'
          ? 'Fictional readings for previewing the app.'
          : reportsAvailable
            ? 'Readings stay on this device unless you send a development report to your PC.'
            : 'Readings stay on this device. Nothing is uploaded.'}
      </Text>
    </View>
  );
}
