import { useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from './providers/AppProvider';
import { LocalStorageProvider } from './providers/LocalStorageProvider';
import { AppStartupGate } from './providers/AppStartupGate';
import { useTheme } from '../shared/theme/ThemeProvider';
import { Screen, Notice } from '../shared/ui';
import { useHealthContext } from '../features/health/HealthProvider';
import type { Tab, DetailScreen, MoreDetail } from './navigation/tabs';
import { TabBar } from './navigation/TabBar';
import { RetainedView } from '../shared/ui/RetainedView';
import { AccountProvider, useAccountContext } from '../features/account/AccountProvider';
import { HomeScreen } from '../features/home/screens/HomeScreen';
import { HealthScreen, type HealthPanel } from '../features/health/screens/HealthScreen';
import {
  HealthDetailScreen,
  type HealthDetail,
} from '../features/health/screens/HealthDetailScreen';
import { WorkoutScreen } from '../features/workouts/screens/WorkoutScreen';
import { SessionScreen } from '../features/workouts/screens/SessionScreen';
import { WorkoutLogScreen } from '../features/workouts/screens/WorkoutLogScreen';
import { useWorkoutContext } from '../features/workouts/WorkoutProvider';
import { NutritionScreen } from '../features/nutrition/screens/NutritionScreen';
import { ProfileGoalsScreen } from '../features/settings/screens/ProfileGoalsScreen';
import { MoreScreen } from '../features/settings/screens/MoreScreen';
import { DataScreen } from '../features/health/screens/DataScreen';
import { SettingsScreen } from '../features/settings/screens/SettingsScreen';
import { ProgramsScreen } from '../features/programs/ProgramsScreen';
import { AIProgramBuilder } from '../features/programs/AIProgramBuilder';
import { ExerciseLibraryScreen } from '../features/workouts/screens/ExerciseLibraryScreen';
import { WorkoutHistoryScreen } from '../features/workouts/screens/WorkoutHistoryScreen';
import { StrengthScreen } from '../features/progress/StrengthScreen';
import { ActiveWorkoutBar } from '../features/workouts/components/ActiveWorkoutBar';
import { ClinicalScreen } from '../features/health/screens/ClinicalScreen';
import { HealthDayScreen } from '../features/health/screens/HealthDayScreen';
import { HealthWeekScreen } from '../features/health/screens/HealthWeekScreen';
import { DataSyncScreen } from '../features/settings/screens/DataSyncScreen';
import { AboutScreen } from '../features/settings/screens/AboutScreen';
import { YearReviewScreen } from '../features/settings/screens/YearReviewScreen';

function AppShell() {
  const health = useHealthContext();
  const { dataReader } = useAccountContext();
  const accountKey = JSON.stringify([dataReader?.origin, dataReader?.userId]);
  const { theme } = useTheme();
  const [tab, setTab] = useState<Tab>('Home');
  const [detail, setDetail] = useState<DetailScreen | MoreDetail | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionFullOverride, setSessionFullOverride] = useState(false);
  const [healthDetail, setHealthDetail] = useState<HealthDetail | null>(null);
  const [healthDate, setHealthDate] = useState('');
  const [healthPanel, setHealthPanel] = useState<HealthPanel>('training');
  const [nutritionReviewRequest, setNutritionReviewRequest] = useState({ scope: '', count: 0 });
  const [nutritionDateRequest, setNutritionDateRequest] = useState({
    scope: '',
    date: '',
    count: 0,
  });
  const [sleepRequest, setSleepRequest] = useState({ scope: '', date: '', count: 0 });
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [workoutReturn, setWorkoutReturn] = useState<{
    detail: DetailScreen | MoreDetail | null;
    tab: Tab;
  } | null>(null);
  const workouts = useWorkoutContext();
  function selectTab(next: Tab) {
    setHealthDetail(null);
    setDetail(null);
    setTab(next);
    if (next === 'Workout') {
      workouts.refreshIfStale();
    }
  }
  function openAppleHealth() {
    selectTab('More');
    setDetail('health-data');
  }
  function openSession(id: string, fullOverride = false) {
    setSessionFullOverride(fullOverride);
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
  const fullScreen =
    !!healthDetail || (detail !== null && !['health-data', 'settings'].includes(detail));
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
      <RetainedView
        key={`home:${accountKey}`}
        active={!healthDetail && !detail && tab === 'Home'}
      >
        <HomeScreen
          openHealthDetail={setHealthDetail}
          openHealthBody={() => {
            selectTab('Health');
            setHealthPanel('body');
          }}
          openDay={(date) => {
            setHealthDate(date);
            setDetail('health-day');
          }}
          openWeek={(week) => {
            setHealthDate(week);
            setDetail('health-week');
          }}
          openNutrition={(review, date) => {
            selectTab('Nutrition');
            if (date) {
              setNutritionDateRequest((value) => ({
                scope: accountKey,
                date,
                count: value.count + 1,
              }));
            }
            if (review) {
              setNutritionReviewRequest((value) => ({
                scope: accountKey,
                count: value.count + 1,
              }));
            }
          }}
          openSleep={(date) => {
            selectTab('Health');
            setHealthPanel('body');
            setSleepRequest((value) => ({ scope: accountKey, date, count: value.count + 1 }));
          }}
          openSession={openSession}
          openWorkout={openWorkout}
          openMore={() => selectTab('More')}
          openPrograms={() => setDetail('programs')}
          openStats={() => {
            selectTab('Health');
            setHealthPanel('training');
          }}
        />
      </RetainedView>
      <RetainedView
        key={`health:${accountKey}`}
        active={!healthDetail && !detail && tab === 'Health'}
      >
        <HealthScreen
          sleepRequest={sleepRequest.scope === accountKey ? sleepRequest : undefined}
          panel={healthPanel}
          onPanelChange={setHealthPanel}
          openDetail={setHealthDetail}
          openPrograms={() => setDetail('programs')}
          openSettings={openSettings}
          openDay={(date) => {
            setHealthDate(date);
            setDetail('health-day');
          }}
          openWeek={(week) => {
            setHealthDate(week);
            setDetail('health-week');
          }}
        />
      </RetainedView>
      <RetainedView
        key={`workout:${accountKey}`}
        active={!healthDetail && !detail && tab === 'Workout'}
      >
        <WorkoutScreen
          openSettings={openSettings}
          openWorkout={openWorkout}
          openSession={openSession}
          openPrograms={() => setDetail('programs')}
        />
      </RetainedView>
      <RetainedView
        key={`nutrition:${accountKey}`}
        active={!healthDetail && !detail && tab === 'Nutrition'}
      >
        <NutritionScreen
          openSettings={openSettings}
          dateRequest={
            nutritionDateRequest.scope === accountKey ? nutritionDateRequest : undefined
          }
          reviewRequest={
            nutritionReviewRequest.scope === accountKey ? nutritionReviewRequest.count : 0
          }
        />
      </RetainedView>
      <RetainedView
        key={`more:${accountKey}`}
        active={!healthDetail && !detail && tab === 'More'}
      >
        <MoreScreen
          openSettings={() => setDetail('settings')}
          openPrograms={() => setDetail('programs')}
          openClinical={() => setDetail('clinical')}
          openGoals={() => setDetail('profile-goals')}
          openAppleHealth={openAppleHealth}
          openData={() => setDetail('more-data')}
          openAbout={() => setDetail('more-about')}
          openYear={() => setDetail('year-review')}
        />
      </RetainedView>
      {detail === 'more-data' ? (
        <DataSyncScreen onBack={() => setDetail(null)} />
      ) : detail === 'more-about' ? (
        <AboutScreen onBack={() => setDetail(null)} />
      ) : detail === 'year-review' ? (
        <YearReviewScreen onBack={() => setDetail(null)} />
      ) : healthDetail ? (
        <HealthDetailScreen
          key={`${healthDetail}:${accountKey}`}
          detail={healthDetail}
          onBack={() => setHealthDetail(null)}
        />
      ) : detail === 'workout-log' ? (
        <WorkoutLogScreen
          workoutId={workoutId}
          openSettings={openSettings}
          closeWorkout={closeWorkout}
        />
      ) : detail === 'workout-session' ? (
        <SessionScreen
          sessionId={sessionId}
          initialFullOverride={sessionFullOverride}
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
      ) : detail === 'profile-goals' ? (
        <ProfileGoalsScreen onBack={() => setDetail(null)} />
      ) : detail === 'clinical' ? (
        <ClinicalScreen key={accountKey} onBack={() => setDetail(null)} />
      ) : detail === 'health-day' ? (
        <HealthDayScreen
          key={`${accountKey}:${healthDate}`}
          initialDate={healthDate}
          onBack={() => setDetail(null)}
        />
      ) : detail === 'health-week' ? (
        <HealthWeekScreen
          key={`${accountKey}:${healthDate}`}
          week={healthDate}
          onBack={() => setDetail(null)}
        />
      ) : !detail &&
        (tab === 'Home' ||
          tab === 'Health' ||
          tab === 'Workout' ||
          tab === 'Nutrition' ||
          tab === 'More') ? null : (
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
          ) : tab === 'Nutrition' ? (
            <NutritionScreen openSettings={openSettings} />
          ) : null}
          {health.error && detail === 'health-data' && (
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
      <AccountProvider>
        <LocalStorageProvider>
          <AppProvider>
            <AppStartupGate>
              <AppShell />
            </AppStartupGate>
          </AppProvider>
        </LocalStorageProvider>
      </AccountProvider>
    </SafeAreaProvider>
  );
}
