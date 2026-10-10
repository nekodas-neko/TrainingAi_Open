import { useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from './providers/AppProvider';
import { ThemeProvider, useTheme } from '../shared/theme/ThemeProvider';
import { Screen, Notice } from '../shared/ui';
import { useHealthContext } from '../features/health/HealthProvider';
import type { Tab, DetailScreen } from './navigation/tabs';
import { TabBar } from './navigation/TabBar';
import { HomeScreen } from '../features/home/screens/HomeScreen';
import { HealthScreen } from '../features/health/screens/HealthScreen';
import { WorkoutScreen } from '../features/workouts/screens/WorkoutScreen';
import { NutritionScreen } from '../features/nutrition/screens/NutritionScreen';
import { MoreScreen } from '../features/settings/screens/MoreScreen';
import { DataScreen } from '../features/health/screens/DataScreen';
import { SettingsScreen } from '../features/settings/screens/SettingsScreen';

function AppShell() {
  const health = useHealthContext();
  const { theme } = useTheme();
  const [tab, setTab] = useState<Tab>('Home');
  const [detail, setDetail] = useState<DetailScreen | null>(null);
  function selectTab(next: Tab) {
    setDetail(null);
    setTab(next);
  }
  function openHealth() {
    setTab('Health');
    setDetail('health-data');
  }
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Screen
        key={detail ?? tab}
        title={detail === 'health-data' ? 'Apple Health' : detail === 'settings' ? 'Settings' : tab}
        backLabel={detail ? tab : undefined}
        onBack={detail ? () => setDetail(null) : undefined}
      >
        {detail === 'health-data' ? (
          <DataScreen />
        ) : detail === 'settings' ? (
          <SettingsScreen />
        ) : tab === 'Home' ? (
          <HomeScreen openHealth={openHealth} />
        ) : tab === 'Health' ? (
          <HealthScreen openData={openHealth} />
        ) : tab === 'Workout' ? (
          <WorkoutScreen />
        ) : tab === 'Nutrition' ? (
          <NutritionScreen />
        ) : (
          <MoreScreen openSettings={() => setDetail('settings')} />
        )}
        {health.error && (tab === 'Health' || tab === 'Home') && (
          <Notice title="Unable to read Apple Health" message={health.error} error />
        )}
      </Screen>
      <TabBar selected={tab} onSelect={selectTab} />
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppProvider>
          <AppShell />
        </AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
