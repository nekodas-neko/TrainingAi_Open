import { useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from './providers/AppProvider';
import { LocalStorageProvider } from './providers/LocalStorageProvider';
import { useTheme } from '../shared/theme/ThemeProvider';
import { Screen, Notice } from '../shared/ui';
import { useHealthContext } from '../features/health/HealthProvider';
import type { Tab, DetailScreen } from './navigation/tabs';
import { TabBar } from './navigation/TabBar';
import { HomeScreen } from '../features/home/screens/HomeScreen';
import { HealthScreen } from '../features/health/screens/HealthScreen';
import { WorkoutScreen } from '../features/workouts/screens/WorkoutScreen';
import { SessionScreen } from '../features/workouts/screens/SessionScreen';
import { WorkoutLogScreen } from '../features/workouts/screens/WorkoutLogScreen';
import { useWorkoutContext } from '../features/workouts/WorkoutProvider';
import { NutritionScreen } from '../features/nutrition/screens/NutritionScreen';
import { MoreScreen } from '../features/settings/screens/MoreScreen';
import { DataScreen } from '../features/health/screens/DataScreen';
import { SettingsScreen } from '../features/settings/screens/SettingsScreen';
import { ProgramsScreen } from '../features/programs/ProgramsScreen';
import { AIProgramBuilder } from '../features/programs/AIProgramBuilder';
import { ExerciseLibraryScreen } from '../features/workouts/screens/ExerciseLibraryScreen';
import { WorkoutHistoryScreen } from '../features/workouts/screens/WorkoutHistoryScreen';
import { StrengthScreen } from '../features/progress/StrengthScreen';
import { ActiveWorkoutBar } from '../features/workouts/components/ActiveWorkoutBar';

function AppShell() {
  const health = useHealthContext();
  const { theme } = useTheme();
  const [tab, setTab] = useState<Tab>('Home');
  const [detail, setDetail] = useState<DetailScreen | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [workoutReturn, setWorkoutReturn] = useState<{
    detail: DetailScreen | null;
    tab: Tab;
  } | null>(null);
  const workouts = useWorkoutContext();
  function selectTab(next: Tab) {
    setDetail(null);
    setTab(next);
    if (next === 'Workout') {
      workouts.refreshIfStale();
    }
  }
  function openHealth() {
    setTab('Health');
    setDetail('health-data');
  }
  function openSession(id: string) {
    setTab('Workout');
    setSessionId(id);
    setDetail('workout-session');
  }
  function openSettings() {
    setTab('More');
    setDetail('settings');
  }
  function openWorkout(id: string) {
    setWorkoutReturn(detail === 'workout-history' ? { detail, tab } : null);
    setTab('Workout');
    setWorkoutId(id);
    setDetail('workout-log');
  }
  const fullScreen = detail !== null && !['health-data', 'settings'].includes(detail);
  function closeWorkout() {
    setDetail(workoutReturn?.detail ?? null);
    if (workoutReturn) {
      setTab(workoutReturn.tab);
    }
    setWorkoutReturn(null);
  }
  return (
    <SafeAreaView
      edges={fullScreen ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      {detail === 'workout-log' ? (
        <WorkoutLogScreen
          workoutId={workoutId}
          openSettings={openSettings}
          closeWorkout={closeWorkout}
        />
      ) : detail === 'workout-session' ? (
        <SessionScreen
          sessionId={sessionId}
          openSettings={openSettings}
          openWorkout={openWorkout}
          closeSession={() => setDetail(null)}
        />
      ) : detail === 'programs' ? (
        <ProgramsScreen
          onBack={() => setDetail(null)}
          openBuilder={() => setDetail('program-builder')}
        />
      ) : detail === 'program-builder' ? (
        <AIProgramBuilder
          onBack={() => setDetail('programs')}
          onSaved={() => setDetail('programs')}
        />
      ) : detail === 'exercise-library' ? (
        <ExerciseLibraryScreen onBack={() => setDetail(null)} />
      ) : detail === 'workout-history' ? (
        <WorkoutHistoryScreen onBack={() => setDetail(null)} openWorkout={openWorkout} />
      ) : detail === 'strength-progress' ? (
        <StrengthScreen onBack={() => setDetail(null)} />
      ) : !detail && tab === 'Workout' ? (
        <WorkoutScreen
          openSettings={openSettings}
          openWorkout={openWorkout}
          openSession={openSession}
          openPrograms={() => setDetail('programs')}
        />
      ) : (
        <Screen
          key={detail ?? tab}
          title={
            detail === 'health-data' ? 'Apple Health' : detail === 'settings' ? 'Settings' : tab
          }
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
          ) : tab === 'Nutrition' ? (
            <NutritionScreen />
          ) : (
            <MoreScreen
              openSettings={() => setDetail('settings')}
              openPrograms={() => setDetail('programs')}
              openLibrary={() => setDetail('exercise-library')}
              openHistory={() => setDetail('workout-history')}
              openStrength={() => setDetail('strength-progress')}
            />
          )}
          {health.error && (tab === 'Health' || tab === 'Home') && (
            <Notice title="Unable to read Apple Health" message={health.error} error />
          )}
        </Screen>
      )}
      {!fullScreen && tab !== 'Workout' && <ActiveWorkoutBar onResume={openWorkout} />}
      {!fullScreen && <TabBar selected={tab} onSelect={selectTab} />}
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <LocalStorageProvider>
        <AppProvider>
          <AppShell />
        </AppProvider>
      </LocalStorageProvider>
    </SafeAreaProvider>
  );
}
