import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  IconButton,
  Notice,
  Sheet,
  Stack,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource, useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { librarySpec } from '../../workouts/data/models';
import { failureNotice } from '../../../core/reporting/index.ts';
import {
  EQUIPMENT_OPTIONS,
  MUSCLE_OPTIONS,
  adminExercisesSpec,
  adminMediaReviewSpec,
  adminMediaSpec,
  coverage,
  draftFromExercise,
  emptyExerciseDraft,
  exerciseBody,
  exerciseConfirm,
  filterExercises,
  gifSource,
  gifSourceLabel,
  mediaByName,
  reviewQueue,
  reviewedMap,
  toggleIn,
  toggleMuscle,
  type AdminExercise,
  type ExerciseDraft,
} from '../data/admin-content';
import { ConfirmSheet } from './ConfirmSheet';
import { GifReviewSheet } from './GifReviewSheet';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radii.small,
        borderWidth: 1,
        borderColor: active ? theme.colors.brand : theme.colors.border,
        minHeight: theme.sizes.touchTarget,
        justifyContent: 'center',
      }}
    >
      <AppText variant="caption" style={{ color: active ? theme.colors.brand : theme.colors.muted }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function ExerciseForm({
  initial,
  renamed,
  saving,
  onSave,
  onCancel,
}: {
  initial: ExerciseDraft;
  renamed?: boolean;
  saving: boolean;
  onSave: (draft: ExerciseDraft) => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const [d, setD] = useState(initial);
  const wrap = { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm } as const;
  return (
    <Card>
      <TextField
        label="Exercise name"
        value={d.name}
        placeholder="e.g. Barbell Squat"
        onChangeText={(name) => setD({ ...d, name })}
      />
      {renamed && d.name !== initial.name && (
        <AppText variant="caption" tone="muted">
          Renaming updates this exercise everywhere it’s used.
        </AppText>
      )}
      <AppText variant="caption" tone="muted">
        Type
      </AppText>
      <View style={wrap}>
        {(['weighted', 'bodyweight'] as const).map((t) => (
          <Chip key={t} label={t} active={d.exerciseType === t} onPress={() => setD({ ...d, exerciseType: t })} />
        ))}
      </View>
      <AppText variant="caption" tone="muted">
        Equipment
      </AppText>
      <View style={wrap}>
        {EQUIPMENT_OPTIONS.map((o) => (
          <Chip key={o} label={o} active={d.equipment.includes(o)} onPress={() => setD({ ...d, equipment: toggleIn(d.equipment, o) })} />
        ))}
      </View>
      <AppText variant="caption" tone="muted">
        Muscles: tap a name for main, or 2° for secondary; tap again to remove
      </AppText>
      <View style={wrap}>
        {MUSCLE_OPTIONS.map((m) => {
          const role = d.muscles.find((x) => x.muscle === m)?.role;
          return (
            <View key={m} style={{ flexDirection: 'row', gap: theme.spacing.xxs }}>
              <Chip label={m} active={role === 'main'} onPress={() => setD({ ...d, muscles: toggleMuscle(d.muscles, m, 'main') })} />
              <Chip label="2°" active={role === 'secondary'} onPress={() => setD({ ...d, muscles: toggleMuscle(d.muscles, m, 'secondary') })} />
            </View>
          );
        })}
      </View>
      <TextField
        label="How-to instructions (optional)"
        value={d.instructions}
        multiline
        onChangeText={(instructions) => setD({ ...d, instructions })}
      />
      <TextField
        label="Custom GIF URL (optional — overrides S3 media)"
        value={d.gifUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={(gifUrl) => setD({ ...d, gifUrl })}
      />
      <TextField
        label="Static thumbnail URL (optional)"
        value={d.imageUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={(imageUrl) => setD({ ...d, imageUrl })}
      />
      <AppButton title="Save" busy={saving} disabled={!d.name.trim()} onPress={() => onSave(d)} />
      <AppButton title="Cancel" variant="secondary" disabled={saving} onPress={onCancel} />
    </Card>
  );
}

type Pending = { kind: 'delete' | 'mirror'; name: string };

export function AdminExercisesPanel({ exercises }: { exercises: readonly AdminExercise[] }) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const media = useWorkoutResource(adminMediaSpec);
  const reviews = useWorkoutResource(adminMediaReviewSpec);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sweep, setSweep] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const mediaMap = mediaByName(media.data);
  const reviewed = reviewedMap(reviews.data);
  const cover = coverage(exercises, mediaMap);
  const queue = reviewQueue(exercises, mediaMap, reviewed);
  const flagged = Object.values(reviewed).filter((v) => v === 'wrong').length;
  const shown = filterExercises(exercises, search);
  // The picker, programs and logging all read the library.
  const invalidate = [adminExercisesSpec.path, adminMediaSpec.path, librarySpec.path];

  async function save(draft: ExerciseDraft, id?: string) {
    if (!resources || busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const body = exerciseBody(draft);
      if (id) await resources.write('PATCH', '/api/admin/exercises', { id, ...body }, invalidate);
      else await resources.write('POST', '/api/admin/exercises', body, invalidate);
      setAdding(false);
      setEditing(null);
      setNotice({ text: id ? 'Exercise updated' : 'Exercise added', error: false });
    } catch (failure) {
      setNotice({ text: failureNotice('Save failed', failure), error: true });
    } finally {
      setBusy(null);
    }
  }
  async function remove(name: string) {
    if (!resources || busy) return;
    setBusy(`delete:${name}`);
    setNotice(null);
    try {
      await resources.write('DELETE', '/api/admin/exercises', undefined, invalidate, { name });
      setNotice({ text: 'Exercise deleted', error: false });
    } catch (failure) {
      setNotice({ text: failureNotice('Delete failed', failure), error: true });
    } finally {
      setBusy(null);
    }
  }
  async function mirror(name: string, force: boolean) {
    if (!resources || busy) return;
    setBusy(`mirror:${name}`);
    setNotice(null);
    try {
      const res = (await resources.write(
        'POST',
        '/api/admin/mirror-dataset-gifs',
        { exerciseName: name, force },
        invalidate,
      )) as { status?: string } | null;
      setNotice(
        res?.status === 'no_match'
          ? { text: `${name}: no dataset match`, error: false }
          : { text: `${name}: mirrored`, error: false },
      );
    } catch (failure) {
      setNotice({ text: failureNotice(`Mirror failed for ${name}`, failure), error: true });
    } finally {
      setBusy(null);
    }
  }

  const confirm = pending && exerciseConfirm[pending.kind];
  return (
    <Stack>
      <Card>
        <AppText variant="label">Exercise GIFs</AppText>
        <AppText variant="caption" tone="muted">
          {cover.covered} / {cover.live} covered
        </AppText>
        <AppText variant="caption" tone="muted">
          {queue.length > 0
            ? `${queue.length} GIF${queue.length === 1 ? '' : 's'} unreviewed`
            : 'All GIFs reviewed'}
          {flagged > 0 ? ` · ${flagged} flagged wrong` : ''}
        </AppText>
        <AppButton
          title="Review GIFs"
          icon="check"
          variant="surface"
          disabled={queue.length === 0}
          onPress={() => setSweep(true)}
        />
      </Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
        <TextField
          label="Search exercises"
          hideLabel
          leadingIcon="search"
          value={search}
          placeholder="Search exercises…"
          onChangeText={setSearch}
        />
        <AppButton
          title="Add"
          icon="plus"
          variant="surface"
          onPress={() => {
            setAdding(true);
            setEditing(null);
          }}
        />
      </View>
      {notice && <Notice title={notice.error ? 'Could not do that' : 'Done'} message={notice.text} error={notice.error} />}
      {adding && (
        <ExerciseForm
          initial={emptyExerciseDraft}
          saving={busy === 'save'}
          onSave={(d) => void save(d)}
          onCancel={() => setAdding(false)}
        />
      )}
      <AppText variant="caption" tone="muted">
        {shown.length} exercises
        {cover.merged > 0 ? ` · ${cover.merged} merged, not counted in coverage` : ''}
      </AppText>
      {shown.map((ex) => {
        const source = gifSource(ex.name, ex.gifUrl, mediaMap);
        const hasMirror = !!mediaMap[ex.name.toLowerCase()]?.gifUrl;
        return editing === ex.id ? (
          <ExerciseForm
            key={ex.id}
            initial={draftFromExercise(ex)}
            renamed
            saving={busy === 'save'}
            onSave={(d) => void save(d, ex.id)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Card key={ex.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="label" numberOfLines={1}>
                  {ex.name}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {ex.equipment.join(', ') || 'No equipment'}
                  {ex.muscles.some((m) => m.role === 'main')
                    ? ` · ${ex.muscles.filter((m) => m.role === 'main').map((m) => m.muscle).join(', ')}`
                    : ''}
                </AppText>
              </View>
              {source ? <Badge label={gifSourceLabel[source]} /> : null}
            </View>
            {/* The actions sit on their own line so the name stays readable at 384 px. */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.xs }}>
              <IconButton
                icon="cloudDownload"
                label={hasMirror ? `Re-mirror ${ex.name} from dataset` : `Mirror ${ex.name} from dataset`}
                busy={busy === `mirror:${ex.name}`}
                disabled={!!busy}
                onPress={() => (hasMirror ? setPending({ kind: 'mirror', name: ex.name }) : void mirror(ex.name, false))}
              />
              <IconButton
                icon="edit"
                label={`Edit ${ex.name}`}
                disabled={!!busy}
                onPress={() => {
                  setEditing(ex.id);
                  setAdding(false);
                }}
              />
              <IconButton
                icon="delete"
                label={`Delete ${ex.name}`}
                tone="danger"
                busy={busy === `delete:${ex.name}`}
                disabled={!!busy}
                onPress={() => setPending({ kind: 'delete', name: ex.name })}
              />
            </View>
          </Card>
        );
      })}
      {pending && confirm && (
        <ConfirmSheet
          title={confirm.title}
          message={`${pending.name} — ${confirm.message}`}
          confirmLabel={confirm.confirmLabel}
          onClose={() => setPending(null)}
          onConfirm={() => (pending.kind === 'delete' ? void remove(pending.name) : void mirror(pending.name, true))}
        />
      )}
      {sweep && (
        <GifReviewSheet
          candidates={queue}
          onClose={() => {
            setSweep(false);
            reviews.refresh();
          }}
        />
      )}
    </Stack>
  );
}
