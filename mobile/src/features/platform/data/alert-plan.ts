import { walkPlan } from '../../activities/data/guidance.ts';
import { getProtocol, phasesTotalSec } from '@trainingai/shared/fitness-tests/protocols';
import type { ActivitySession } from '../../activities/data/ActivityStore.ts';
import type { WorkoutRecord } from '../../workouts/logging/workout.ts';
import type { Alert, PlatformSettings } from './models.ts';
export function planAlerts(
  settings: PlatformSettings,
  workouts: WorkoutRecord[],
  activity: ActivitySession | null,
  now = Date.now(),
): Alert[] {
  const scope = settings.scope;
  const result: Alert[] = [];
  for (const workout of workouts) {
    if (
      settings.restAlerts &&
      workout.status === 'active' &&
      workout.rest &&
      workout.rest.endsAt > now
    ) {
      const exercise = workout.exercises.find((row) => row.id === workout.rest!.exerciseId);
      result.push({
        id: `${scope}:rest:${workout.id}`,
        scope,
        title: 'Rest complete',
        body: exercise ? `Ready for ${exercise.name}.` : 'Ready for your next set.',
        target: 'workout',
        recordId: workout.id,
        trigger: { at: workout.rest.endsAt },
      });
    }
  }
  if (
    settings.walkCues &&
    activity?.guidance?.kind === 'walk' &&
    activity.mode === 'active' &&
    activity.startMs !== null &&
    activity.pauseStartMs === null
  ) {
    const plan = walkPlan(activity.guidance.config);
    const base = activity.startMs + activity.pausedMs;
    for (const segment of plan.segments) {
      const at = base + segment.startSec * 1000;
      if (segment.index === 0 || at <= now) continue;
      const label =
        segment.kind === 'fast'
          ? 'Fast walking'
          : segment.kind === 'slow'
            ? 'Easy walking'
            : segment.kind === 'cooldown'
              ? 'Cool down'
              : 'Warm up';
      result.push({
        id: `${scope}:walk:${activity.id}:${segment.index}`,
        scope,
        title: label,
        body: `${Math.round((segment.endSec - segment.startSec) / 60)} min · interval walk`,
        target: 'walk',
        recordId: activity.id,
        trigger: { at },
      });
    }
    const at = base + plan.totalSec * 1000;
    if (at > now)
      result.push({
        id: `${scope}:walk:${activity.id}:done`,
        scope,
        title: 'Walk complete',
        body: 'Your planned intervals are finished. Open the app to review and save.',
        target: 'walk',
        recordId: activity.id,
        trigger: { at },
      });
  }
  if (
    settings.walkCues &&
    activity?.mode === 'active' &&
    activity.startMs !== null &&
    activity.pauseStartMs === null &&
    activity.guidance?.kind !== 'walk'
  ) {
    const base = activity.startMs + activity.pausedMs;
    const protocol =
      activity.guidance?.kind === 'test' ? getProtocol(activity.guidance.protocol) : undefined;
    let elapsed = 0;
    for (const [index, phase] of (protocol?.phases ?? []).entries()) {
      const at = base + elapsed * 1000;
      if (index > 0 && at > now)
        result.push({
          id: `${scope}:activity:${activity.id}:${phase.key}`,
          scope,
          title: phase.label,
          body: phase.instruction,
          target: 'walk',
          recordId: activity.id,
          trigger: { at },
        });
      elapsed += phase.durationSec;
    }
    const seconds = protocol
      ? (protocol.durationSec ?? phasesTotalSec(protocol.phases ?? []))
      : (activity.target?.minutes ?? 0) * 60;
    const at = base + seconds * 1000;
    if (seconds > 0 && at > now)
      result.push({
        id: `${scope}:activity:${activity.id}:done`,
        scope,
        title: protocol ? 'Test complete' : 'Planned time complete',
        body: 'Open the app to review your activity.',
        target: 'walk',
        recordId: activity.id,
        trigger: { at },
      });
  }
  for (const reminder of settings.reminders.filter((row) => row.enabled)) {
    const [hour, minute] = reminder.time.split(':').map(Number);
    const target =
      reminder.kind === 'meal' || reminder.kind === 'supplement'
        ? 'nutrition'
        : reminder.kind === 'workout'
          ? 'workout'
          : reminder.kind;
    const days = [...new Set(reminder.days)].sort();
    for (const weekday of days.length === 7 ? [undefined] : days) {
      result.push({
        id: `${scope}:reminder:${reminder.id}:${weekday ?? 'daily'}`,
        scope,
        title: reminder.title,
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        body: 'Your TrainingAi reminder.',
        target,
        trigger: { hour, minute, ...(weekday !== undefined ? { weekday } : {}) },
      });
    }
  }
  return result;
}
