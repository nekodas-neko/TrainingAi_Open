import { useState } from 'react';
import { ActionMenu, IconButton } from '../../../shared/ui';
import { useCoachLaunch } from '../CoachProvider';
import type { CoachOpenRequest } from '../data/CoachConversation';

/** What each line of a lift's "…" menu opens (#3896 step 7, 8a A): the Coach about that lift, and the
 *  two shortcuts straight into one of its buttons. Ids only; the server reads the rest. */
export function liftMenuRequests(sessionExerciseId: string): { title: string; request: CoachOpenRequest }[] {
  const context = { origin: 'exercise' as const, sessionExerciseId };
  return [
    { title: 'Ask Coach about this lift', request: { context } },
    { title: 'More reps, less weight', request: { context, chip: 'more_reps' } },
    { title: 'Swap exercise', request: { context, chip: 'swap' } },
  ];
}

/** The "…" on a lift row, and the action menu it opens. */
export function LiftCoachMenu({ sessionExerciseId, name }: { sessionExerciseId: string; name: string }) {
  const launch = useCoachLaunch();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="more" label={`More for ${name}`} onPress={() => setOpen(true)} />
      <ActionMenu
        visible={open}
        title={name}
        onClose={() => setOpen(false)}
        actions={liftMenuRequests(sessionExerciseId).map(({ title, request }, i) => ({
          title,
          icon: i === 0 ? 'coach' : undefined,
          run: () => launch(request),
        }))}
      />
    </>
  );
}
