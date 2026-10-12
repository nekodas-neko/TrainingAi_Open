import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  AppButton,
  Carousel,
  IconButton,
  PageLayout,
  SegmentedControl,
  StateCard,
  TabPanel,
  StatusIndicator,
  Sheet,
  AppText,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { BodyPanel } from '../components/BodyPanel';
import { TrainingPanel } from '../components/TrainingPanel';
import { ProgressPanel } from '../components/ProgressPanel';
import type { HealthDetail } from './HealthDetailScreen';
import { HealthViewReady } from '../components/HealthViewReady';
import { HealthSyncNotice } from '../components/HealthSyncNotice';
import { SleepNight } from '../components/SleepNight';

const panels = [
  { id: 'body', label: 'Body' },
  { id: 'training', label: 'Training' },
  { id: 'progress', label: 'Progress' },
] as const;
export type HealthPanel = (typeof panels)[number]['id'];
export function HealthScreen({
  openDetail,
  openPrograms,
  openSettings,
  panel,
  onPanelChange,
  openDay,
  openWeek,
  sleepRequest,
}: {
  openDetail: (detail: HealthDetail) => void;
  openPrograms: () => void;
  openSettings: () => void;
  panel?: HealthPanel;
  onPanelChange?: (panel: HealthPanel) => void;
  openDay: (date: string) => void;
  openWeek: (week: string) => void;
  sleepRequest?: { date: string; count: number };
}) {
  const { theme } = useTheme();
  const health = useHealthData();
  const resources = useWorkoutResources();
  const [localTab, setTab] = useState<HealthPanel>('training');
  const [sleepDate, setSleepDate] = useState<string | null>(null);
  useEffect(() => {
    if (sleepRequest) {
      setSleepDate(sleepRequest.date);
    }
  }, [sleepRequest]);
  const tab = panel ?? localTab;
  const [visited, setVisited] = useState<Set<HealthPanel>>(() => new Set([tab]));
  function select(panel: HealthPanel) {
    setTab(panel);
    onPanelChange?.(panel);
    setVisited((old) => new Set([...old, panel]));
  }
  useEffect(() => {
    void health.store?.refresh();
  }, [health.store, health.today]);
  function refresh() {
    health.refresh();
    void resources?.refreshVisible();
  }
  return (
    <PageLayout
      title="Health"
      subtitle="Body & training"
      actions={
        <>
          <HealthSyncNotice inline />
          <StatusIndicator
            label="Health records"
            busy={!health.ready}
            error={health.bodyError ?? health.sleepError ?? health.error}
            onRetry={health.refresh}
          />
          <IconButton
            icon="refresh"
            label="Refresh Health"
            busy={health.refreshing}
            onPress={refresh}
          />
        </>
      }
    >
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <SegmentedControl
          label="Health views"
          options={panels.map((panel) => ({ value: panel.id, label: panel.label }))}
          value={tab}
          onChange={select}
        />
      </View>
      {!health.connected || health.denied ? (
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <StateCard
            title="Connect your account"
            message={health.error ?? 'Sign in to load your health records.'}
          />
          <AppButton title="Account settings" onPress={openSettings} />
        </View>
      ) : (
        <Carousel
          items={panels}
          selectedId={tab}
          onSelect={(id) => select(id as HealthPanel)}
          showDots={false}
          label={(panel) => panel.label}
          renderItem={(panel) => (
            <TabPanel refreshing={health.refreshing} onRefresh={refresh}>
              {visited.has(panel.id) && (
                <HealthViewReady view={panel.id}>
                  {panel.id === 'body' ? (
                    <BodyPanel openDetail={openDetail} />
                  ) : panel.id === 'training' ? (
                    <TrainingPanel
                      openPrograms={openPrograms}
                      openDay={openDay}
                      openWeek={openWeek}
                    />
                  ) : (
                    <ProgressPanel />
                  )}
                </HealthViewReady>
              )}
            </TabPanel>
          )}
        />
      )}
      {sleepDate && (
        <Sheet visible fullHeight title="Sleep" onClose={() => setSleepDate(null)}>
          {health.sleep.some((night) => night.date === sleepDate) ? (
            <SleepNight night={health.sleep.find((night) => night.date === sleepDate)!} />
          ) : (
            <AppText tone="muted">No saved sleep reading for {sleepDate}.</AppText>
          )}
        </Sheet>
      )}
    </PageLayout>
  );
}
