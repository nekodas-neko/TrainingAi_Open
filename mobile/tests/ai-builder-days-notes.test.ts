// #3840: Preview's AI builder maps weekly days to sessions in week order, as the web and the server's
// neighbour check do, and keeps the check's notes from the generate reply.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GenerateProgramResponseSchema,
  generatedDraft,
  sortedWeekDays,
} from '../src/features/programs/builder-model.ts';

const inputs = {
  programName: 'Plan',
  equipment: ['barbell'],
  sessionsPerWeek: 3,
  timePerSessionMinutes: 60,
  musclesToFocus: ['Chest'],
  goal: 'strength' as const,
  progressionMode: 'phase' as const,
  phaseStructureName: 'Strength',
  totalWeeks: 12,
  scheduleType: 'weekly' as const,
  rotationRestAfterN: 3,
  // Tapped Friday, Monday, Wednesday.
  weeklyDays: [4, 0, 2],
};
const session = (name: string) => ({
  name,
  icon: '💪',
  exercises: [{ name: 'Squat', exerciseRole: 'primary' as const, mainMuscles: ['quads'], secondaryMuscles: [] }],
});
const program = {
  name: 'Plan', phaseStructureName: 'Strength', phaseSetId: 'set', reasoning: 'Why.', phases: [],
  sessions: [session('Push'), session('Pull'), session('Legs')],
};

test('weekly days map to sessions in week order, whatever order they were tapped in', () => {
  let n = 0;
  const draft = generatedDraft(program, inputs, () => `30000000-0000-4000-8000-${String(n++).padStart(12, '0')}`);
  assert.equal(draft.schedule?.type, 'weekly');
  const days = (draft.schedule?.type === 'weekly' && draft.schedule.days) || [];
  const nameOf = (id: string | null | undefined) => draft.sessions.find((s) => s.id === id)?.name;
  assert.deepEqual(days.map((d) => [d.dayOfWeek, nameOf(d.sessionId)]), [[0, 'Push'], [2, 'Pull'], [4, 'Legs']]);
});

test('sortedWeekDays sorts and drops repeats', () => {
  assert.deepEqual(sortedWeekDays([6, 1, 3, 1]), [1, 3, 6]);
});

test('the generate reply keeps the check notes, and a reply without them keeps the program', () => {
  const withNotes = GenerateProgramResponseSchema.parse({ program, notes: ['Chest gets 7 sets a week.', 3] });
  assert.deepEqual(withNotes.notes, ['Chest gets 7 sets a week.']);
  const without = GenerateProgramResponseSchema.parse({ program });
  assert.deepEqual(without.notes, []);
  assert.equal(without.program.sessions.length, 3);
});
