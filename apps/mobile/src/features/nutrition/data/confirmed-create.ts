import { z } from 'zod';
import { ApiError } from '../../account/api/client';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources';
const attemptSchema = z.object({
  before: z.array(z.string()),
  payload: z.record(z.string(), z.unknown()),
});
export class UnconfirmedCreate extends Error {
  constructor() {
    super(
      'The previous save is not confirmed. Check the saved list before starting another save.',
    );
  }
}
export async function confirmedCreate<T extends { id: string }>(
  resources: WorkoutResources,
  path: string,
  payload: Record<string, unknown>,
  list: () => Promise<T[]>,
  match: (row: T, body: Record<string, unknown>) => boolean,
) {
  const key = 'nutrition-create:' + path;
  const prior = await resources.draft(key, attemptSchema);
  const rows = await list();
  if (prior) {
    const recovered = rows.filter(
      (row) => !prior.before.includes(row.id) && match(row, prior.payload),
    );
    if (recovered.length === 1) {
      await resources.clearDraft(key);
      resources.invalidate(['/api/nutrition', '/api/supplements']);
      return recovered[0];
    }
    throw new UnconfirmedCreate();
  }
  await resources.saveDraft(key, { before: rows.map((r) => r.id), payload });
  try {
    await resources.connection.post(path, payload);
  } catch (cause) {
    if (
      cause instanceof ApiError &&
      cause.status >= 400 &&
      cause.status < 500 &&
      cause.status !== 408
    ) {
      await resources.clearDraft(key);
    }
    throw cause;
  }
  const after = await list();
  const added = after.filter(
    (row) => !rows.some((old) => old.id === row.id) && match(row, payload),
  );
  if (added.length !== 1) {
    throw new UnconfirmedCreate();
  }
  await resources.clearDraft(key);
  resources.invalidate(['/api/nutrition', '/api/supplements']);
  return added[0];
}
