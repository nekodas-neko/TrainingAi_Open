export function workoutFixture(userId = 'user-one') {
  const session = {
    id: 'session-one',
    programId: 'program-one',
    name: 'Upper body',
    position: 0,
    exercises: [{ id: 'exercise-one', exerciseName: 'Bench press', position: 0 }],
  };
  const program = {
    id: 'program-one',
    userId,
    name: 'Strength plan',
    isActive: true,
    phaseMode: 'automatic',
    sessions: [session],
  };
  const meta = { program, estimatedMinBySession: { [session.id]: 40 } };
  const next = {
    isRestDay: false,
    reason: 'Next up: Upper body',
    session,
    estimatedDurationMin: 42,
  };
  const all = {
    perSession: {
      [session.id]: {
        program,
        session,
        aiPrescriptionPending: false,
        dataDate: '2026-10-10',
        phaseStatus: { phase: { name: 'Build' } },
        exercises: [
          {
            sessionExerciseId: 'exercise-one',
            name: 'Bench press',
            defaultSets: 2,
            styleName: 'Strength',
            muscleGroups: ['Chest'],
            instructions: 'Keep your feet planted.',
            progressionStyle: [
              { pct: 70, reps: 8, restSec: 90, useFor1rm: true },
              { pct: 75, reps: 6, restSec: 120, useFor1rm: true },
            ],
          },
        ],
      },
    },
  };
  const get = async (path: string, query?: Record<string, string>) => {
    if (path === '/api/exercise-library') {
      return {
        exercises: [
          {
            name: 'Bench press',
            muscles: [
              { muscle: 'chest', role: 'main' },
              { muscle: 'triceps', role: 'secondary' },
            ],
          },
        ],
      };
    }
    if (path === '/api/muscle-recovery') {
      return { muscles: [{ muscle: 'chest', pct: 42, hoursAgo: 24 }] };
    }
    if (path === '/api/next-session') {
      return next;
    }
    if (path === '/api/workout-data' && query?.tab === 'meta') {
      return meta;
    }
    if (path === '/api/workout-data' && query?.tab === 'all') {
      return all;
    }
    throw new Error('Unexpected request.');
  };
  return { meta, next, all, reader: { origin: 'https://example.com', userId, get } };
}
