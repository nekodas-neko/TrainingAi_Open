import { useState } from 'react';
import { ScrollView } from 'react-native';
import { z } from 'zod';
import { AppButton, AppText, Card, ListRow, Skeleton, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import type { ChoiceListArgs, WidgetResult } from '../data/widgets';
const optionsSchema = z.object({
  options: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      colorKey: z.string().optional(),
    }),
  ),
});
export function ChoiceCard({
  args,
  onResult,
}: {
  args: ChoiceListArgs;
  onResult?: (result: WidgetResult) => void;
}) {
  const { theme } = useTheme();
  const state = useWorkoutResource(
    {
      path: '/api/coach/options',
      schema: optionsSchema,
      ttl: 300000,
      query: {
        source: args.source ?? '',
        ...(args.sourceId ? { sourceId: args.sourceId } : {}),
      },
    },
    !!args.source,
  );
  const options = args.source ? (state.data?.options ?? []) : (args.options ?? []);
  const [picked, setPicked] = useState<string[]>([]);
  function choose(id: string) {
    if (!onResult) return;
    if (!args.multi) {
      onResult({ status: 'chose', id, label: options.find((o) => o.id === id)!.title });
      return;
    }
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
  const selected = options.filter((o) => picked.includes(o.id));
  return (
    <Card tone="sleep" style={{ opacity: onResult ? 1 : 0.6 }}>
      <AppText variant="label">{args.prompt}</AppText>
      {args.multi && args.selectAll && options.length > 1 && (
        <AppButton
          title={selected.length === options.length ? 'Clear all' : 'Select all'}
          variant="ghost"
          disabled={!onResult}
          onPress={() =>
            setPicked(selected.length === options.length ? [] : options.map((o) => o.id))
          }
        />
      )}
      <ScrollView nestedScrollEnabled style={{ maxHeight: theme.sizes.touchTarget * 6 }}>
        {options.map((option) => (
          <ListRow
            key={option.id}
            density="compact"
            title={option.title}
            subtitle={option.subtitle}
            trailing={
              args.multi ? (
                <AppText>{picked.includes(option.id) ? '✓' : '○'}</AppText>
              ) : undefined
            }
            onPress={onResult ? () => choose(option.id) : undefined}
          />
        ))}
        {options.length === 0 &&
          (state.loading && args.source ? (
            <Skeleton style={{ height: theme.sizes.touchTarget * 3 }} />
          ) : (
            <AppText tone="muted">{state.error ?? 'Nothing to choose from here.'}</AppText>
          ))}
      </ScrollView>
      {args.source && state.error && (
        <AppButton title="Retry options" variant="ghost" onPress={state.refresh} />
      )}
      {args.multi && (
        <AppButton
          title={`Continue${selected.length ? ` · ${selected.length}` : ''}`}
          disabled={!onResult || !selected.length}
          onPress={() =>
            onResult?.({
              status: 'chose',
              ids: selected.map((o) => o.id),
              label: selected.map((o) => o.title).join(', '),
            })
          }
        />
      )}
    </Card>
  );
}
