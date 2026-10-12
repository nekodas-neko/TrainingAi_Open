import { HomeSection, HiddenHomeSections, type SectionBounds } from '../components/HomeSection';
import { HomeHeader } from '../components/HomeHeader';
import { HomeScores } from '../components/HomeScores';
import { useEffect, useState, useRef } from 'react';
import { View } from 'react-native';
import { getScheduledSessionsPerWeek } from '@trainingai/shared/schedule-utils';
import { shiftDateStr, weekStartForDay } from '@trainingai/shared/date-utils';
import type { Program } from '@trainingai/shared/types/program';
import {
  AppButton,
  AppText,
  Card,
  Disclosure,
  PageLayout,
  Stack,
  StateCard,
  TabPanel,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHome } from '../data/HomeProvider';
import { homeSections, trainingDays } from '../data/models';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { readinessSpec, profileSpec } from '../../health/data/models';
import type { HealthDetail } from '../../health/screens/HealthDetailScreen';
import { BodyBatteryCard } from '../../health/components/BodyBatteryCard';
import { MorningCheckinSheet } from '../../health/components/MorningCheckinSheet';
import { MetricLogSheet, type LogMetric } from '../../health/components/MetricLogSheet';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { calendarSpec, programSpec } from '../../workouts/data/models';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import type { SessionPreview } from '../../workouts/catalog';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { HomeRecommendation } from '../components/HomeRecommendation';
import { HomeTrainingSummary, HomeWeekStrip } from '../components/HomeTrainingSummary';
import { HomeMetricTiles, HomeWidget } from '../components/HomeWidgets';
import { HomeTimeline } from '../components/HomeTimeline';
import { ExerciseReadinessSheet } from '../components/ExerciseReadinessSheet';
import { HomeLayoutSheet } from '../components/HomeLayoutSheet';
import { HomeBanners } from '../components/HomeBanners';
import { healthCopy } from '../../health/data/display-copy';

export type HomeNavigation = {
  openHealthDetail: (detail: HealthDetail) => void;
  openHealthBody: () => void;
  openDay: (date: string) => void;
  openWeek: (week: string) => void;
  openNutrition: (review?: boolean, date?: string) => void;
  openSleep?: (date: string) => void;
  openSession: (id: string, fullOverride?: boolean) => void;
  openWorkout: (id: string) => void;
  openMore: () => void;
  openPrograms: () => void;
  openStats: () => void;
};
export function HomeScreen(navigation: HomeNavigation) {
  const { theme } = useTheme();
  const home = useHome();
  const health = useHealthData();
  const workout = useWorkoutContext();
  const journal = useWorkoutJournal();
  const nutrition = useNutrition();
  const resources = useWorkoutResources();
  const readiness = useWorkoutResource(readinessSpec(health.today));
  const profile = useWorkoutResource(profileSpec);
  const programs = useWorkoutResource(programSpec);
  const [year, month] = health.today.split('-').map(Number);
  const previous = shiftDateStr(health.today.slice(0, 7) + '-01', -1)
    .split('-')
    .map(Number);
  const calendar = useWorkoutResource(calendarSpec(year, month));
  const lastCalendar = useWorkoutResource(calendarSpec(previous[0], previous[1]));
  const [manual, setManual] = useState(false);
  const [editing, setEditing] = useState(false);
  const sectionBounds = useRef(new Map<string, SectionBounds>());
  const [modal, setModal] = useState<'morning' | 'layout' | 'readiness' | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionPreview>();
  const [metric, setMetric] = useState<LogMetric | null>(null);
  useEffect(() => {
    void health.store?.refresh();
    workout.refreshIfStale();
    for (const kind of ['logs', 'targets'] as const) {
      void nutrition.store?.refresh(kind, health.today);
    }
  }, [health.store, health.today, workout.refreshIfStale, nutrition.store]);
  async function refresh() {
    if (manual) {
      return;
    }
    setManual(true);
    workout.refresh();
    try {
      await Promise.all([
        resources?.refreshVisible(true),
        health.store?.refresh(true),
        health.appleSleep.refresh(true),
        home.store?.refresh('mood', health.today, true),
        home.store?.refresh('preferences', health.today, true),
        nutrition.store?.refresh('logs', health.today, true),
        nutrition.store?.refresh('targets', health.today, true),
        home.store?.sync(),
        nutrition.store?.sync(),
        journal.controller?.sync(),
      ]);
    } finally {
      setManual(false);
    }
  }
  function openReadiness(session?: SessionPreview) {
    setSelectedSession(session);
    setModal('readiness');
  }
  const days = trainingDays(
    [lastCalendar.data?.trainedDays, calendar.data?.trainedDays],
    journal.data.workouts,
  );
  const program = programs.data?.programs.find((p) => p.id === workout.catalog?.program?.id);
  const schedule = program?.schedule ?? null;
  const target = program ? getScheduledSessionsPerWeek(program as Program) : null;
  const scores = readiness.data;
  const pending =
    home.operations.length ||
    health.operations.length ||
    nutrition.operations.length ||
    nutrition.http.length;
  const error =
    [
      home.error,
      ...Object.values(home.errors),
      health.error,
      health.bodyError,
      health.sleepError,
      health.appleSleep.error,
      readiness.error,
      calendar.error,
      lastCalendar.error,
    ]
      .filter(Boolean)
      .join('\n\n') || null;
  const name = profile.data?.user.name;
  const loaded = !!calendar.data && !!lastCalendar.data;
  const sections = homeSections(home.preferences).filter(
    (key) => !home.preferences.homeHiddenSections?.includes(key),
  );
  return (
    <PageLayout
      title="Home"
      header={
        <HomeHeader
          today={health.today}
          timezone={health.timezone}
          name={name}
          avatar={profile.data?.user.avatar}
          error={error}
          pending={!!pending}
          refreshing={manual || workout.refreshingManually}
          onRefresh={() => void refresh()}
          onLayout={() => setEditing((value) => !value)}
          editing={editing}
          onProfile={navigation.openMore}
        />
      }
    >
      {!workout.signedIn || health.denied || home.denied ? (
        <View style={{ padding: theme.spacing.lg }}>
          <StateCard
            title="Connect your account"
            message="Sign in to see your training, health and nutrition together."
          />
          <AppButton title="Account settings" onPress={navigation.openMore} />
        </View>
      ) : (
        <TabPanel refreshing={manual} onRefresh={() => void refresh()}>
          <Stack style={{ paddingHorizontal: theme.spacing.lg }} gap="md">
            <HomeScores onOpen={navigation.openHealthDetail} />
            {scores?.illnessAdvisory && scores.illnessFlag === 'watch' && (
              <AppText variant="micro" tone="muted">
                {healthCopy(scores.illnessAdvisory)}
              </AppText>
            )}
            {scores?.illnessAdvisory &&
              ['elevated', 'fever'].includes(scores.illnessFlag ?? '') && (
                <Card>
                  <AppText variant="label">
                    {scores.illnessFlag === 'fever' ? 'Fever' : 'Elevated'}
                    {(scores.illnessSuppression ?? 0) > 0
                      ? ` · energy −${scores.illnessSuppression}`
                      : ''}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {healthCopy(scores.illnessAdvisory)}
                  </AppText>
                </Card>
              )}
            <BodyBatteryCard />
            {editing && (
              <AppButton
                title="Widgets & score style"
                variant="surface"
                onPress={() => setModal('layout')}
              />
            )}
            <HomeBanners
              openMorning={() => setModal('morning')}
              openWeek={navigation.openWeek}
              openReview={() => navigation.openNutrition(true)}
            />
            {sections.map((key) => (
              <HomeSection
                key={key}
                id={key}
                editing={editing}
                bounds={sectionBounds.current}
                onLayout={(id, bounds) => sectionBounds.current.set(id, bounds)}
              >
                {key === 'recommendation' ? (
                  <HomeRecommendation
                    key={key}
                    trained={days[health.today] ?? []}
                    onReadiness={openReadiness}
                    onStart={navigation.openSession}
                    onResume={navigation.openWorkout}
                    openPrograms={navigation.openPrograms}
                  />
                ) : key === 'streak' ? (
                  <HomeTrainingSummary
                    key={key}
                    days={days}
                    today={health.today}
                    loaded={loaded}
                    schedule={schedule}
                    target={target}
                    ai={workout.catalog?.program?.phaseMode === 'ai_dynamic'}
                    openStats={navigation.openStats}
                  />
                ) : key === 'weekStrip' ? (
                  <HomeWeekStrip
                    key={key}
                    days={days}
                    today={health.today}
                    loaded={loaded}
                    hasProgram={!!workout.catalog?.program}
                    openDay={navigation.openDay}
                  />
                ) : key === 'metricTiles' ? (
                  <HomeMetricTiles
                    key={key}
                    openBody={navigation.openHealthBody}
                    openNutrition={() => navigation.openNutrition()}
                    log={setMetric}
                  />
                ) : (
                  <HomeWidget
                    key={key}
                    id={key.replace(/^card_/, '')}
                    openBody={navigation.openHealthBody}
                    openNutrition={() => navigation.openNutrition()}
                    openDetail={navigation.openHealthDetail}
                    openReadiness={() =>
                      openReadiness(
                        workout.catalog?.program?.sessions.find(
                          (session) => session.id === workout.catalog?.recommendation.sessionId,
                        ),
                      )
                    }
                    openTraining={navigation.openStats}
                    openMorning={() => setModal('morning')}
                  />
                )}
              </HomeSection>
            ))}
            {editing && <HiddenHomeSections />}
            <HomeTimeline
              openDay={navigation.openDay}
              openNutrition={(date) => navigation.openNutrition(false, date)}
              openSleep={navigation.openSleep ?? (() => navigation.openHealthDetail('sleep'))}
            />
          </Stack>
        </TabPanel>
      )}
      {modal === 'morning' && (
        <MorningCheckinSheet
          onClose={() => {
            setModal(null);
            void home.store?.mark(`morning-prompt:${health.today}`).catch(() => {});
          }}
        />
      )}
      {modal === 'layout' && <HomeLayoutSheet onClose={() => setModal(null)} />}
      {modal === 'readiness' && (
        <ExerciseReadinessSheet onClose={() => setModal(null)} session={selectedSession} />
      )}
      {metric && (
        <MetricLogSheet
          field={metric}
          initial={metric === 'waterMl' ? null : (health.body?.today?.[metric] ?? null)}
          onClose={() => setMetric(null)}
        />
      )}
    </PageLayout>
  );
}
