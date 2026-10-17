import { useState } from 'react';
import { shortSessionName } from '@trainingai/shared/session-palette';
import { AppText, Card, Legend, MonthCalendar } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { calendarSpec } from '../../workouts/data/models';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { useSessionColors } from '../../workouts/useSessionColors';
import { useActivities } from '../../activities/data/ActivityProvider';
import { useHealthData } from '../data/HealthDataProvider';

// The training calendar: a dot per session in the session's colour (two dots on a two-session day),
// a cyan dot for a logged activity, and a legend that names them.
export function TrainingCalendarCard({ openDay }: { openDay: (date: string) => void }) {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const { sessions, color } = useSessionColors();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [year, number] = month.split('-').map(Number);
  const state = useWorkoutResource(calendarSpec(year, number));
  const journal = useWorkoutJournal();
  const activities = useActivities();
  const trained: Record<string, string[]> = {};
  const active: Record<string, string[]> = {};
  const add = (into: Record<string, string[]>, date: string, names: readonly string[]) => {
    const day = date.replace(/\//g, '-');
    into[day] = [...new Set([...(into[day] ?? []), ...names])];
  };
  for (const [date, names] of Object.entries(state.data?.trainedDays ?? {})) {
    add(trained, date, names);
  }
  for (const [date, names] of Object.entries(state.data?.activityDays ?? {})) {
    add(active, date, names);
  }
  for (const row of activities.rows) {
    if (row.payload.date.startsWith(month)) {
      add(active, row.payload.date, [row.payload.title]);
    }
  }
  for (const workout of journal.data.workouts) {
    if (workout.status === 'completed' && workout.date.startsWith(month)) {
      add(trained, workout.date, [workout.sessionName]);
    }
  }
  const activityColor = theme.tones.recovery.foreground;
  const markers: Record<string, string[]> = {};
  const dots: Record<string, string[]> = {};
  for (const date of new Set([...Object.keys(trained), ...Object.keys(active)])) {
    markers[date] = [...(trained[date] ?? []), ...(active[date] ?? [])];
    dots[date] = [...(trained[date] ?? []).map(color), ...(active[date] ? [activityColor] : [])];
  }
  return (
    <Card>
      <AppText variant="heading" accessibilityRole="header">
        Training Calendar
      </AppText>
      <MonthCalendar
        nativeStyle
        status={
          <ResourceStatus inline label="Calendar records" state={state} refresh={state.refresh} />
        }
        today={today}
        month={month}
        markers={markers}
        dots={dots}
        selected={selected ?? undefined}
        onMonthChange={setMonth}
        onSelect={(date) => {
          setSelected(date);
          openDay(date);
        }}
      />
      <Legend
        items={[
          ...sessions.map((session) => ({
            label: shortSessionName(session.name),
            color: color(session.name),
          })),
          { label: 'Activity', color: activityColor },
        ]}
      />
    </Card>
  );
}
