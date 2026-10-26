import { useState } from 'react';
import { shortSessionName } from '@trainingai/shared/session-palette';
import { Card, Legend, MonthCalendar } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { calendarSpec } from '../../workouts/data/models';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { useSessionColors } from '../../workouts/useSessionColors';
import { useActivities } from '../../activities/data/ActivityProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { calendarMarks } from '../data/training-view';

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
  const activityColor = theme.training.activity;
  const { markers, dots } = calendarMarks({
    month,
    trainedDays: state.data?.trainedDays ?? {},
    activityDays: state.data?.activityDays ?? {},
    activities: activities.rows.map((row) => row.payload),
    workouts: journal.data.workouts,
    sessionColor: color,
    activityColor,
  });
  return (
    <Card>
      <MonthCalendar
        title="Training Calendar"
        nativeStyle
        status={
          <ResourceStatus inline label="Calendar records" state={state} refresh={state.refresh} />
        }
        today={today}
        month={month}
        markers={markers}
        dots={dots}
        topAligned
        selected={selected ?? undefined}
        onMonthChange={setMonth}
        onSelect={(date) => {
          setSelected(date);
          openDay(date);
        }}
      />
      <Legend
        ruled
        centered
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
