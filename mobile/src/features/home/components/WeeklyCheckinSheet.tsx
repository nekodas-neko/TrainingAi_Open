import type { ReactNode } from 'react';
import type { CheckinAnswer } from '@trainingai/shared/weekly-checkin/effects';
import {
  AppButton,
  AppText,
  ChipPicker,
  SegmentedControl,
  Sheet,
  Stack,
  TextField,
  WeekdayPicker,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  PAIN_WHERE_MAX,
  SESSION_LENGTHS,
  answersIncomplete,
  resultRows,
  type CheckinAnswers,
  type CheckinState,
  type OfferAction,
  type ResultRow,
  type SaveNotes,
  type UndoTarget,
} from '../data/weekly-checkin';

const FEEL: readonly { label: string; value: CheckinAnswer }[] = [
  { label: 'Heavy', value: 'heavy' },
  { label: 'About right', value: 'about_right' },
  { label: 'Light', value: 'light' },
];
const YES_NO = [
  { label: 'No', value: 'no' },
  { label: 'Yes', value: 'yes' },
] as const;

export type CheckinSheetProps = {
  state: CheckinState;
  answers: CheckinAnswers;
  onAnswers: (next: CheckinAnswers) => void;
  notes: SaveNotes | null;
  offline: boolean;
  /** The control being sent: 'save', or a result row's key. */
  sending: string | null;
  message: string | null;
  onSave: () => void;
  onOffer: (row: string, offer: OfferAction, decision: 'accept' | 'decline') => void;
  onUndo: (row: string, target: UndoTarget) => void;
  onClose: () => void;
};

/**
 * #3890, decision 10a A: one scrolling sheet with Save pinned at the bottom. Untouched, it is one
 * scroll and one tap. Once saved it shows what the server reports for each answer, with its offers
 * and undos, from the state the last call returned.
 */
export function WeeklyCheckinSheet(props: CheckinSheetProps) {
  const { state, onClose } = props;
  const saved = state.checkin?.status === 'saved';
  return (
    <Sheet
      visible
      title={saved ? 'Review saved · What changes next week' : 'Weekly check-in'}
      onClose={onClose}
      footer={saved ? <ResultFooter onClose={onClose} /> : <SaveFooter {...props} />}
    >
      {saved ? <ResultBody {...props} /> : <FormBody {...props} />}
    </Sheet>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <AppText variant="subheading">{title}</AppText>
      {children}
    </Stack>
  );
}

function FormBody({ state, answers, onAnswers }: CheckinSheetProps) {
  const lifts = state.lifts.map((l) => ({ label: l.exerciseName, value: l.sessionExerciseId }));
  const set = (patch: Partial<CheckinAnswers>) => onAnswers({ ...answers, ...patch });
  return (
    <>
      <Question title="Your week">
        {state.summary?.lines.map((line, i) => (
          <AppText key={i} variant="body">
            {line}
          </AppText>
        ))}
      </Question>
      <Question title="How did each lift feel?">
        {state.lifts.length === 0 && (
          <AppText variant="caption" tone="muted">
            No main lift to ask about this week.
          </AppText>
        )}
        {state.lifts.map((lift) => (
          <Stack key={lift.sessionExerciseId} gap="xs">
            <AppText variant="label">{lift.exerciseName}</AppText>
            <SegmentedControl
              label={`How ${lift.exerciseName} felt`}
              options={FEEL}
              value={answers.lifts[lift.sessionExerciseId] ?? 'about_right'}
              onChange={(value) =>
                set({ lifts: { ...answers.lifts, [lift.sessionExerciseId]: value } })
              }
            />
          </Stack>
        ))}
      </Question>
      <Question title="Anything that hurt or felt wrong?">
        <SegmentedControl
          label="Anything that hurt or felt wrong"
          options={YES_NO}
          value={answers.pain}
          onChange={(pain) => set({ pain })}
        />
        {answers.pain === 'yes' && (
          <>
            <ChipPicker
              label="Which lift?"
              options={lifts}
              value={answers.painLift}
              onChange={(painLift) => set({ painLift })}
            />
            <TextField
              label="Where? (optional)"
              value={answers.painWhere}
              maxLength={PAIN_WHERE_MAX}
              onChangeText={(painWhere) => set({ painWhere })}
              hint={`${answers.painWhere.length}/${PAIN_WHERE_MAX}`}
              returnKeyType="done"
            />
          </>
        )}
      </Question>
      <Question title="Anything to swap?">
        <SegmentedControl
          label="Anything to swap"
          options={YES_NO}
          value={answers.swap}
          onChange={(swap) => set({ swap })}
        />
        {answers.swap === 'yes' && (
          <ChipPicker
            label="Which lift?"
            options={lifts}
            value={answers.swapLift}
            onChange={(swapLift) => set({ swapLift })}
          />
        )}
      </Question>
      <Question title="Next week">
        <AppText variant="label">Days off</AppText>
        <WeekdayPicker
          value={answers.daysOff.map((d) => d - 1)}
          onToggle={(day) =>
            set({
              daysOff: answers.daysOff.includes(day + 1)
                ? answers.daysOff.filter((d) => d !== day + 1)
                : [...answers.daysOff, day + 1],
            })
          }
        />
        <AppText variant="label">Session length</AppText>
        <SegmentedControl
          label="Session length"
          options={SESSION_LENGTHS}
          value={answers.length}
          onChange={(length) => set({ length })}
        />
      </Question>
    </>
  );
}

function SaveFooter({ answers, offline, sending, message, onSave }: CheckinSheetProps) {
  const { theme } = useTheme();
  const incomplete = answersIncomplete(answers);
  const hint = message ?? incomplete ?? (offline ? 'You’re offline. Save when you’re back online.' : null);
  return (
    <Stack gap="xs" style={{ paddingTop: theme.spacing.sm }}>
      {hint && (
        <AppText
          variant="caption"
          tone={message ? 'danger' : 'muted'}
          accessibilityLiveRegion="polite"
        >
          {hint}
        </AppText>
      )}
      <AppButton
        title="Save review"
        busy={sending === 'save'}
        disabled={!!incomplete || offline || (sending !== null && sending !== 'save')}
        onPress={onSave}
      />
    </Stack>
  );
}

function ResultFooter({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  return (
    <Stack style={{ paddingTop: theme.spacing.sm }}>
      <AppButton title="Done" onPress={onClose} />
    </Stack>
  );
}

function ResultBody(props: CheckinSheetProps) {
  const { state, notes, message } = props;
  const rows = state.checkin ? resultRows(state.checkin, notes) : [];
  return (
    <>
      {message && (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {message}
        </AppText>
      )}
      {rows.map((row) => (
        <ResultRowView key={row.key} row={row} {...props} />
      ))}
    </>
  );
}

function ResultRowView({
  row,
  state,
  offline,
  sending,
  onOffer,
  onUndo,
}: CheckinSheetProps & { row: ResultRow }) {
  const { theme } = useTheme();
  const checkinId = state.checkin?.id;
  const blocked = offline || sending !== null;
  const busy = sending === row.key;
  return (
    <Stack
      gap="xs"
      style={{
        paddingBottom: theme.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Stack direction="row" align="center" gap="sm">
        <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label">{row.title}</AppText>
          <AppText variant="caption" tone="muted">
            {row.status}
          </AppText>
        </Stack>
        {row.undo && checkinId && (
          <AppButton
            title="Undo"
            variant="ghost"
            busy={busy}
            disabled={blocked}
            accessibilityLabel={`Undo: ${row.title}`}
            onPress={() => onUndo(row.key, row.undo!)}
          />
        )}
      </Stack>
      {row.note && (
        <AppText variant="caption" tone="muted">
          {row.note}
        </AppText>
      )}
      {row.offer && checkinId && (
        <Stack gap="xs">
          <AppText variant="body">{row.offer.question}</AppText>
          <Stack direction="row">
            <AppButton
              title={row.offer.acceptLabel}
              variant="secondary"
              busy={busy}
              disabled={blocked}
              style={{ flex: 1 }}
              onPress={() => onOffer(row.key, row.offer!.accept, 'accept')}
            />
            <AppButton
              title="Not now"
              variant="ghost"
              disabled={blocked}
              onPress={() => onOffer(row.key, row.offer!.decline, 'decline')}
            />
          </Stack>
        </Stack>
      )}
      {row.alternatives && checkinId && (
        <Stack gap="xs">
          {row.alternatives.map((alt) => (
            <AppButton
              key={alt.exerciseId}
              title={alt.label}
              variant="surface"
              disabled={blocked}
              accessibilityLabel={`Swap for ${alt.label}`}
              onPress={() => onOffer(row.key, { kind: 'swap', toExerciseId: alt.exerciseId }, 'accept')}
            />
          ))}
          {row.declineSwap && (
            <AppButton
              title="Keep it"
              variant="ghost"
              disabled={blocked}
              onPress={() => onOffer(row.key, row.declineSwap!, 'decline')}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}
