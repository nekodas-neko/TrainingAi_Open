import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from './providers/AppProvider';
import { useHealthContext } from '../features/health/HealthProvider';
import type { Tab } from './navigation/tabs';
import { TabBar } from './navigation/TabBar';
import { useAppTheme } from '../shared/theme/useAppTheme';
import { HealthNotice } from '../features/health/components/HealthNotice';
import { diagnosticsAvailable } from '../development/diagnostics/client';
import { TodayScreen } from '../features/home/screens/TodayScreen';
import { DataScreen } from '../features/health/screens/DataScreen';
import { SettingsScreen } from '../features/settings/screens/SettingsScreen';

function AppShell() {
  const health = useHealthContext();
  const [tab, setTab] = useState<Tab>('Today');
  const { styles: s, dark, colors } = useAppTheme();
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.brand}>TrainingAi</Text>
        <Text style={s.title}>{tab}</Text>
        <HealthNotice
          snapshot={health.snapshot}
          reportsAvailable={diagnosticsAvailable}
          styles={s}
        />
        {tab === 'Today' && <TodayScreen styles={s} />}
        {tab === 'Data' && <DataScreen styles={s} />}
        {tab === 'Settings' && <SettingsScreen styles={s} dark={dark} />}
        {health.error && (
          <View accessibilityRole="alert" style={s.error}>
            <Text style={s.errorText}>{health.error}</Text>
          </View>
        )}
      </ScrollView>
      <TabBar selected={tab} onSelect={setTab} styles={s} tint={colors.blue} />
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
