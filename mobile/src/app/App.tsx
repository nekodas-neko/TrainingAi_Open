import { deviceHealthName } from '../integrations/device-health/platform';
import { UndoProvider } from '../shared/ui/undo/UndoProvider';
import { ProfileDetailsScreen } from '../features/settings/screens/ProfileDetailsScreen';
import { SessionExplainScreen } from '../features/workouts/screens/SessionExplainScreen';
import { CoachProvider } from '../features/coach/CoachProvider';
import { CoachScreen } from '../features/coach/screens/CoachScreen';
import type { CoachScope } from '../features/coach/data/models';
import type { Destination } from '../features/coach/components/CoachWidget';
import { FriendProfileScreen } from '../features/social/screens/FriendProfileScreen';
import { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from './providers/AppProvider';
import { LocalStorageProvider } from './providers/LocalStorageProvider';
import { AppStartupGate } from './providers/AppStartupGate';
import { useTheme } from '../shared/theme/ThemeProvider';
import { useGeistFonts } from '../shared/theme/font-loading';
import { Screen, Notice } from '../shared/ui';
import { useHealthContext } from '../features/health/HealthProvider';
import { useHealthData } from '../features/health/data/HealthDataProvider';
import { useHome } from '../features/home/data/HomeProvider';
import type { Tab } from './navigation/tabs';
import * as stack from './navigation/stack';
import type { Entry, Route } from './navigation/stack';
import { TabBar } from './navigation/TabBar';
import { RetainedView } from '../shared/ui/RetainedView';
import { ScrollToTop } from '../shared/ui/ScrollToTop';
import { useAndroidBack } from '../shared/ui/useAndroidBack';
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
import { ActiveWorkoutBar } from '../features/workouts/components/ActiveWorkoutBar';
import { ClinicalScreen } from '../features/health/screens/ClinicalScreen';
import { HealthDayScreen } from '../features/health/screens/HealthDayScreen';
import { HealthWeekScreen } from '../features/health/screens/HealthWeekScreen';
import { DataSyncScreen } from '../features/settings/screens/DataSyncScreen';
import { AccountScreen } from '../features/settings/screens/AccountScreen';
import { AboutScreen } from '../features/settings/screens/AboutScreen';
import { AdminConsoleScreen } from '../features/admin/screens/AdminConsoleScreen';
import { OuraScreen, takeInitialOuraReturn } from '../features/devices/screens/OuraScreen';
import { SignedInDevicesScreen } from '../features/devices/screens/SignedInDevicesScreen';
import { YearReviewScreen } from '../features/settings/screens/YearReviewScreen';
import { CollectionScreen } from '../features/collection/screens/CollectionScreen';

import { RunningScreen } from '../features/activities/screens/RunningScreen';
import { WalkScreen } from '../features/activities/screens/WalkScreen';
import { BaselinesScreen } from '../features/activities/screens/BaselinesScreen';
import { CardioScreen } from '../features/activities/screens/CardioScreen';
import { ActivityScreen } from '../features/activities/screens/ActivityScreen';
import { WeighInBanner } from '../features/devices/components/WeighInBanner';
import { AlertNavigation } from '../features/platform/components/AlertNavigation';
import { TooOldScreen, useTooOldNotice } from '../features/platform/components/TooOldNotice';
import type { EstimateRequest } from '../features/meal-plans/data/estimated-meals';
import {
  WorkoutStatusAccountGuard,
  WorkoutStatusSync,
} from '../features/workouts/status/WorkoutStatusSync';
import { DynamicBackground } from '../features/weather/components/DynamicBackground';
import type { BackgroundSection } from '../features/weather/data/background';
import { useWidgetLaunch } from '../features/widgets/useWidgetLaunch';
import { errorReporter } from '../core/reporting/index.ts';
import { installErrorReporting } from '../core/reporting/install';

installErrorReporting();

function AppShell() {
  const health = useHealthContext();
  const home = useHome();
  const { today } = useHealthData();
  const { dataReader } = useAccountContext();
  const accountKey = JSON.stringify([dataReader?.origin, dataReader?.userId]);
  const { theme } = useTheme();
  // #3754. The tab and the screens open over it. Opening pushes, Back pops, a tab clears.
  const [nav, setNav] = useState(stack.initialNavigation);
  const { tab } = nav;
  const current = stack.top(nav);
  const healthDetail = current?.screen === 'health-detail' ? current.detail : null;
  const detail = current && current.screen !== 'health-detail' ? current.screen : null;
  const open = (route: Route) => setNav((value) => stack.push(value, route));
  const openOn = (next: Tab, route: Route) => setNav((value) => stack.openOnTab(value, next, route));
  const back = () => setNav(stack.pop);
  const [healthPanel, setHealthPanel] = useState<HealthPanel>('training');
  const [nutritionReviewRequest, setNutritionReviewRequest] = useState({
    scope: '',
    count: 0,
  });
  const [mealEstimateRequest, setMealEstimateRequest] = useState<
    (EstimateRequest & { date: string; scope: string }) | null
  >(null);
  const [nutritionDateRequest, setNutritionDateRequest] = useState({
    scope: '',
    date: '',
    count: 0,
  });
  const [sleepRequest, setSleepRequest] = useState({ scope: '', date: '', count: 0 });
  const openCoach = (scope: CoachScope = 'general') => open({ screen: 'coach', scope });
  // The Coach stays under what it opens, so Back from Programs or the recorder returns to it.
  function coachDestination(destination: Destination) {
    if (destination === 'program_builder') open({ screen: 'programs' });
    if (destination === 'log_activity') open({ screen: 'activity-recording' });
    if (destination === 'profile') {
      selectTab('More');
    }
    if (destination === 'nutrition') {
      selectTab('Nutrition');
    }
  }
  const workouts = useWorkoutContext();
  function selectTab(next: Tab) {
    setNav((value) => stack.selectTab(value, next));
    if (next === 'Workout') {
      workouts.refreshIfStale();
    }
  }
  // Tapping the tab you are on scrolls it to the top.
  const [scrollTop, setScrollTop] = useState<Partial<Record<Tab, number>>>({});
  function pressTab(next: Tab) {
    if (next === tab && !current) {
      setScrollTop((value) => ({ ...value, [next]: (value[next] ?? 0) + 1 }));
    } else selectTab(next);
  }
  useEffect(() => {
    errorReporter.setScreen(detail ?? tab);
  }, [detail, tab]);
  // An Oura return that cold-started the app goes to the Oura screen, which finishes the connect.
  useEffect(() => {
    let active = true;
    void takeInitialOuraReturn().then((url) => {
      if (!active || !url) return;
      openOn('More', { screen: 'more-devices', ouraReturn: url });
    });
    return () => {
      active = false;
    };
    // Once, at launch: the link that started the app never changes.
  }, []);
  const openSession = (id: string, fullOverride = false) =>
    open({ screen: 'workout-session', sessionId: id, fullOverride });
  // A tap on a home-screen widget (#3268); dropped while signed out.
  useWidgetLaunch(!!dataReader, (target) => {
    if (target.kind === 'session') {
      openOn('Workout', { screen: 'workout-session', sessionId: target.id, fullOverride: false });
    } else if (target.kind === 'train-instead') {
      // Home's own override (HomeRecommendation); the card then reads as a training day. A widget
      // tap usually cold-starts the app, before HomeProvider has opened the store, and the store
      // refuses writes until it has, so open it first (initialize is shared, not repeated).
      selectTab('Home');
      const store = home.store;
      if (store) {
        void store
          .initialize()
          .then(() => store.chooseRestDay(today, false))
          .catch(() => undefined);
      }
    } else selectTab(target.kind === 'home' ? 'Home' : target.kind === 'workout' ? 'Workout' : 'Nutrition');
  });
  const openSettings = () => open({ screen: 'settings' });
  const openWorkout = (id: string) => open({ screen: 'workout-log', workoutId: id });
  // A notification's workout: the Workout tab with it open, so Back lands on that tab.
  const openWorkoutFromAlert = (id: string) =>
    openOn('Workout', { screen: 'workout-log', workoutId: id });
  const openDay = (date: string) => open({ screen: 'health-day', date });
  const openWeek = (week: string) => open({ screen: 'health-week', week });
  const openHealthDetail = (next: HealthDetail) => open({ screen: 'health-detail', detail: next });
  const openPrograms = () => open({ screen: 'programs' });
  const openActivity = () => open({ screen: 'activity-recording' });
  const fullScreen = !!current && !['health-data', 'settings'].includes(current.screen);
  // #3724. Below the server's minimum build, the notice covers the app; the data screen (export
  // and sync health) still opens over it, and the notice carries sign-out itself.
  const tooOld = useTooOldNotice();
  // Android Back with nothing open: any tab but Home goes Home; Home leaves the app. Registered
  // only then, so it never competes with an open screen's own handler.
  useAndroidBack(
    !tooOld && stack.rootBack(nav) === 'home' ? () => selectTab('Home') : undefined,
  );
  if (tooOld && detail !== 'more-data') {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
        <TooOldScreen notice={tooOld} onOpenData={() => openOn('More', { screen: 'more-data' })} />
      </SafeAreaView>
    );
  }
  function screenFor(entry: Entry) {
    switch (entry.screen) {
      case 'coach':
        // Drawn once per scope below, so a conversation outlives its visit.
        return null;
      case 'friend-profile':
        return (
          <FriendProfileScreen
            key={`${accountKey}:${entry.friendId}`}
            userId={entry.friendId}
            onBack={back}
          />
        );
      case 'running':
        return <RunningScreen key={accountKey} onBack={back} openActivity={openActivity} />;
      case 'guided-walk':
        return <WalkScreen key={accountKey} onBack={back} openActivity={openActivity} />;
      case 'fitness-baselines':
        return <BaselinesScreen key={accountKey} onBack={back} openActivity={openActivity} />;
      case 'cardio':
        return (
          <CardioScreen
            key={accountKey}
            onBack={back}
            openRunning={() => open({ screen: 'running' })}
            openWalk={() => open({ screen: 'guided-walk' })}
            openBaselines={() => open({ screen: 'fitness-baselines' })}
            openActivity={openActivity}
            openSettings={openSettings}
          />
        );
      case 'activity-recording':
        return <ActivityScreen key={accountKey} onBack={back} onSaved={back} />;
      case 'more-data':
        return <DataSyncScreen onBack={back} />;
      case 'more-about':
        return <AboutScreen onBack={back} />;
      case 'more-admin':
        return <AdminConsoleScreen onBack={back} />;
      case 'more-account':
        return <AccountScreen onBack={back} />;
      case 'more-devices':
        return (
          <OuraScreen
            initialReturn={entry.ouraReturn ?? null}
            onBack={back}
            openSignedInDevices={() => open({ screen: 'more-signed-in-devices' })}
          />
        );
      case 'more-signed-in-devices':
        return <SignedInDevicesScreen onBack={back} />;
      case 'year-review':
        return <YearReviewScreen onBack={back} />;
      case 'collection':
        return <CollectionScreen onBack={back} />;
      case 'health-detail':
        return (
          <HealthDetailScreen
            key={`${entry.detail}:${accountKey}`}
            detail={entry.detail}
            onBack={back}
          />
        );
      case 'workout-log':
        return (
          <WorkoutLogScreen
            openCoach={() => openCoach()}
            workoutId={entry.workoutId}
            openSettings={openSettings}
            closeWorkout={back}
            minimizeWorkout={() => selectTab('Home')}
          />
        );
      case 'session-explain':
        return (
          <SessionExplainScreen
            key={`${accountKey}:${entry.sessionId}`}
            sessionId={entry.sessionId}
            onBack={back}
          />
        );
      case 'workout-session':
        return (
          <SessionScreen
            sessionId={entry.sessionId}
            initialFullOverride={entry.fullOverride}
            openSettings={openSettings}
            // The workout takes the session's place: closing it returns to where the session
            // was opened from, not to a session that has already been started.
            openWorkout={(id) =>
              setNav((value) => stack.replaceTop(value, { screen: 'workout-log', workoutId: id }))
            }
            closeSession={back}
          />
        );
      case 'programs':
        return (
          <ProgramsScreen onBack={back} openBuilder={() => open({ screen: 'program-builder' })} />
        );
      case 'program-builder':
        return <AIProgramBuilder onBack={back} onSaved={back} />;
      case 'exercise-library':
        return <ExerciseLibraryScreen onBack={back} />;
      case 'profile-goals':
        return (
          <ProfileGoalsScreen onBack={back} openProfile={() => open({ screen: 'profile-details' })} />
        );
      case 'profile-details':
        return (
          <ProfileDetailsScreen
            onBack={back}
            openClinical={() => open({ screen: 'clinical' })}
            openBaselines={() => open({ screen: 'fitness-baselines' })}
            openHealthBody={() => {
              selectTab('Health');
              setHealthPanel('body');
            }}
          />
        );
      case 'clinical':
        return <ClinicalScreen key={accountKey} onBack={back} />;
      case 'health-day':
        return (
          <HealthDayScreen
            key={`${accountKey}:${entry.date}`}
            initialDate={entry.date}
            onBack={back}
          />
        );
      case 'health-week':
        return (
          <HealthWeekScreen key={`${accountKey}:${entry.week}`} week={entry.week} onBack={back} />
        );
      case 'health-data':
      case 'settings':
        return (
          <Screen
            title={entry.screen === 'health-data' ? deviceHealthName : 'Settings'}
            backLabel={tab}
            onBack={back}
          >
            {entry.screen === 'health-data' ? <DataScreen /> : <SettingsScreen />}
            {health.error && entry.screen === 'health-data' && (
              <Notice
                title={`Unable to read ${deviceHealthName}`}
                message={health.error}
                error
              />
            )}
          </Screen>
        );
    }
  }
  return (
    <SafeAreaView
      edges={fullScreen ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <DynamicBackground
        section={tab.toLowerCase() as BackgroundSection}
        detail={detail}
        healthDetail={healthDetail}
      />
      <RetainedView key={`home:${accountKey}`} active={!current && tab === 'Home'}>
        <ScrollToTop.Provider value={scrollTop.Home ?? 0}>
          <HomeScreen
            openCoach={() => openCoach()}
            openHealthDetail={openHealthDetail}
            openHealthBody={() => {
              selectTab('Health');
              setHealthPanel('body');
            }}
            openDay={openDay}
            openWeek={openWeek}
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
              setSleepRequest((value) => ({
                scope: accountKey,
                date,
                count: value.count + 1,
              }));
            }}
            openSession={openSession}
            openWorkout={openWorkout}
            openMore={() => selectTab('More')}
            openPrograms={openPrograms}
            openExplanation={(id) => open({ screen: 'session-explain', sessionId: id })}
            openStats={() => {
              selectTab('Health');
              setHealthPanel('training');
            }}
            openCollection={() => open({ screen: 'collection' })}
          />
        </ScrollToTop.Provider>
      </RetainedView>
      <RetainedView key={`health:${accountKey}`} active={!current && tab === 'Health'}>
        <ScrollToTop.Provider value={scrollTop.Health ?? 0}>
          <HealthScreen
            sleepRequest={sleepRequest.scope === accountKey ? sleepRequest : undefined}
            panel={healthPanel}
            onPanelChange={setHealthPanel}
            openDetail={openHealthDetail}
            openDevices={() => open({ screen: 'more-devices' })}
            openPrograms={openPrograms}
            openSettings={openSettings}
            openDay={openDay}
            openWeek={openWeek}
          />
        </ScrollToTop.Provider>
      </RetainedView>
      <RetainedView key={`workout:${accountKey}`} active={!current && tab === 'Workout'}>
        <WorkoutScreen
          openCardio={() => open({ screen: 'cardio' })}
          openSettings={openSettings}
          openWorkout={openWorkout}
          openSession={openSession}
          openPrograms={openPrograms}
        />
      </RetainedView>
      <RetainedView key={`nutrition:${accountKey}`} active={!current && tab === 'Nutrition'}>
        <ScrollToTop.Provider value={scrollTop.Nutrition ?? 0}>
          <NutritionScreen
            openCoach={() => openCoach('nutrition')}
            openSettings={openSettings}
            dateRequest={
              nutritionDateRequest.scope === accountKey ? nutritionDateRequest : undefined
            }
            reviewRequest={
              nutritionReviewRequest.scope === accountKey ? nutritionReviewRequest.count : 0
            }
            estimateRequest={
              mealEstimateRequest?.scope === accountKey ? mealEstimateRequest : null
            }
          />
        </ScrollToTop.Provider>
      </RetainedView>
      <RetainedView key={`more:${accountKey}`} active={!current && tab === 'More'}>
        <ScrollToTop.Provider value={scrollTop.More ?? 0}>
          <MoreScreen
            openFriendProfile={(id) => open({ screen: 'friend-profile', friendId: id })}
            openSettings={openSettings}
            openAccount={() => open({ screen: 'more-account' })}
            openPrograms={openPrograms}
            openClinical={() => open({ screen: 'clinical' })}
            openGoals={() => open({ screen: 'profile-goals' })}
            openProfile={() => open({ screen: 'profile-details' })}
            openAppleHealth={() => open({ screen: 'health-data' })}
            openData={() => open({ screen: 'more-data' })}
            openDevices={() => open({ screen: 'more-devices' })}
            openAbout={() => open({ screen: 'more-about' })}
            openAdmin={() => open({ screen: 'more-admin' })}
            openYear={() => open({ screen: 'year-review' })}
            openCollection={() => open({ screen: 'collection' })}
          />
        </ScrollToTop.Provider>
      </RetainedView>
      {(['general', 'nutrition'] as const).map((scope) => (
        <RetainedView
          key={`coach:${accountKey}:${scope}`}
          active={current?.screen === 'coach' && current.scope === scope}
        >
          <CoachScreen scope={scope} onBack={back} onNavigate={coachDestination} />
        </RetainedView>
      ))}
      {/* Every open screen stays alive under the one on top, so Back finds it as it was left. */}
      {nav.stack.map((entry) =>
        entry.screen === 'coach' ? null : (
          <RetainedView key={`${entry.key}:${accountKey}`} active={entry === current}>
            {screenFor(entry)}
          </RetainedView>
        ),
      )}
      {!fullScreen && <ActiveWorkoutBar onResume={openWorkout} />}
      <AlertNavigation
        onMealEstimate={(request) => setMealEstimateRequest({ ...request, scope: accountKey })}
        onWorkout={openWorkoutFromAlert}
        onWalk={() => openOn('Workout', { screen: 'activity-recording' })}
        onTab={selectTab}
        onHealthDetail={(next) => openOn('Health', { screen: 'health-detail', detail: next })}
        onReview={() => {
          selectTab('Nutrition');
          setNutritionReviewRequest((value) => ({
            scope: accountKey,
            count: value.count + 1,
          }));
        }}
        onWeek={(week) => openOn('Health', { screen: 'health-week', week })}
      />
      <WorkoutStatusSync
        onWorkout={openWorkoutFromAlert}
        onWorkoutTab={() => selectTab('Workout')}
      />
      {!fullScreen && <TabBar selected={tab} onSelect={pressTab} />}
      <WeighInBanner />
    </SafeAreaView>
  );
}
/** Reports go out as the signed-in account; while signed out they wait in the reporter's queue. */
function ErrorReportConnection() {
  const { dataReader } = useAccountContext();
  useEffect(() => {
    errorReporter.connect(
      dataReader?.userId ?? null,
      dataReader ? (path, body) => dataReader.post(path, body) : null,
    );
  }, [dataReader]);
  return null;
}
function NativeInteractions() {
  const { dataReader } = useAccountContext();
  const scope = JSON.stringify([dataReader?.origin, dataReader?.userId]);
  return (
    <UndoProvider key={scope}>
      <CoachProvider>
        <AppShell />
      </CoachProvider>
    </UndoProvider>
  );
}
export default function App() {
  useGeistFonts();
  return (
    <SafeAreaProvider>
      <AccountProvider>
        <ErrorReportConnection />
        <WorkoutStatusAccountGuard />
        <LocalStorageProvider>
          <AppProvider>
            <AppStartupGate>
              <NativeInteractions />
            </AppStartupGate>
          </AppProvider>
        </LocalStorageProvider>
      </AccountProvider>
    </SafeAreaProvider>
  );
}
