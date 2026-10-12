import { ProfileDetailsScreen } from '../features/settings/screens/ProfileDetailsScreen';
import { SessionExplainScreen } from '../features/workouts/screens/SessionExplainScreen';
import { CoachProvider } from '../features/coach/CoachProvider';
import { CoachScreen } from '../features/coach/screens/CoachScreen';
import type { CoachScope } from '../features/coach/data/models';
import type { Destination } from '../features/coach/components/CoachWidget';
import { FriendProfileScreen } from '../features/social/screens/FriendProfileScreen';
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

import { RunningScreen } from '../features/activities/screens/RunningScreen';
import { WalkScreen } from '../features/activities/screens/WalkScreen';
import { BaselinesScreen } from '../features/activities/screens/BaselinesScreen';
import { CardioScreen } from '../features/activities/screens/CardioScreen';
import { ActivityScreen } from '../features/activities/screens/ActivityScreen';

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
  const [profileReturn, setProfileReturn] = useState(false);
  const [friendId, setFriendId] = useState('');
  const [coachScope, setCoachScope] = useState<CoachScope>('general');
  const [coachReturn, setCoachReturn] = useState<{
    detail: DetailScreen | MoreDetail | null;
    tab: Tab;
  }>({ detail: null, tab: 'Workout' });
  function openCoach(scope: CoachScope = 'general') {
    setCoachHandoff(false);
    setCoachReturn({ detail, tab });
    setCoachScope(scope);
    setDetail('coach');
  }
  const [coachHandoff, setCoachHandoff] = useState(false);
  function closeDetail() {
    if (coachHandoff) {
      setCoachHandoff(false);
      setDetail('coach');
    } else {
      setDetail(null);
    }
  }
  function coachDestination(destination: Destination) {
    setCoachHandoff(destination === 'program_builder' || destination === 'log_activity');
    if (destination === 'program_builder') setDetail('programs');
    if (destination === 'log_activity') setDetail('activity-recording');
    if (destination === 'profile') {
      selectTab('More');
    }
    if (destination === 'nutrition') {
      selectTab('Nutrition');
    }
  }
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
          openExplanation={(id) => {
            setSessionId(id);
            setDetail('session-explain');
          }}
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
          openCoach={() => openCoach()}
          openCardio={() => setDetail('cardio')}
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
          openCoach={() => openCoach('nutrition')}
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
          openFriendProfile={(id) => {
            setFriendId(id);
            setDetail('friend-profile');
          }}
          openSettings={() => setDetail('settings')}
          openPrograms={() => setDetail('programs')}
          openClinical={() => {
            setProfileReturn(false);
            setDetail('clinical');
          }}
          openGoals={() => setDetail('profile-goals')}
          openProfile={() => setDetail('profile-details')}
          openAppleHealth={openAppleHealth}
          openData={() => setDetail('more-data')}
          openAbout={() => setDetail('more-about')}
          openYear={() => setDetail('year-review')}
        />
      </RetainedView>
      {(['general', 'nutrition'] as const).map((scope) => (
        <RetainedView
          key={`coach:${accountKey}:${scope}`}
          active={detail === 'coach' && coachScope === scope}
        >
          <CoachScreen
            scope={scope}
            onBack={() => {
              setDetail(coachReturn.detail);
              setTab(coachReturn.tab);
            }}
            onNavigate={coachDestination}
          />
        </RetainedView>
      ))}
      {detail === 'coach' ? null : detail === 'friend-profile' ? (
        <FriendProfileScreen
          key={`${accountKey}:${friendId}`}
          userId={friendId}
          onBack={() => setDetail(null)}
        />
      ) : detail === 'running' ? (
        <RunningScreen
          key={accountKey}
          onBack={() => setDetail('cardio')}
          openActivity={() => setDetail('activity-recording')}
        />
      ) : detail === 'guided-walk' ? (
        <WalkScreen
          key={accountKey}
          onBack={() => setDetail('cardio')}
          openActivity={() => setDetail('activity-recording')}
        />
      ) : detail === 'fitness-baselines' ? (
        <BaselinesScreen
          key={accountKey}
          onBack={() => {
            setDetail(profileReturn ? 'profile-details' : 'cardio');
            setProfileReturn(false);
          }}
          openActivity={() => setDetail('activity-recording')}
        />
      ) : detail === 'cardio' ? (
        <CardioScreen
          key={accountKey}
          onBack={() => setDetail(null)}
          openRunning={() => setDetail('running')}
          openWalk={() => setDetail('guided-walk')}
          openBaselines={() => {
            setProfileReturn(false);
            setDetail('fitness-baselines');
          }}
          openActivity={() => setDetail('activity-recording')}
          openSettings={openSettings}
        />
      ) : detail === 'activity-recording' ? (
        <ActivityScreen
          key={accountKey}
          onBack={coachHandoff ? closeDetail : () => setDetail('cardio')}
          onSaved={coachHandoff ? closeDetail : () => setDetail('cardio')}
        />
      ) : detail === 'more-data' ? (
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
          openCoach={() => openCoach()}
          workoutId={workoutId}
          openSettings={openSettings}
          closeWorkout={closeWorkout}
        />
      ) : detail === 'session-explain' ? (
        <SessionExplainScreen
          key={`${accountKey}:${sessionId}`}
          sessionId={sessionId ?? ''}
          onBack={() => setDetail(null)}
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
        <ProgramsScreen onBack={closeDetail} openBuilder={() => setDetail('program-builder')} />
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
        <ProfileGoalsScreen
          onBack={() => setDetail(null)}
          openProfile={() => setDetail('profile-details')}
        />
      ) : detail === 'profile-details' ? (
        <ProfileDetailsScreen
          onBack={() => setDetail(null)}
          openClinical={() => {
            setProfileReturn(true);
            setDetail('clinical');
          }}
          openBaselines={() => {
            setProfileReturn(true);
            setDetail('fitness-baselines');
          }}
        />
      ) : detail === 'clinical' ? (
        <ClinicalScreen
          key={accountKey}
          onBack={() => {
            setDetail(profileReturn ? 'profile-details' : null);
            setProfileReturn(false);
          }}
        />
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
              <CoachProvider>
                <AppShell />
              </CoachProvider>
            </AppStartupGate>
          </AppProvider>
        </LocalStorageProvider>
      </AccountProvider>
    </SafeAreaProvider>
  );
}
