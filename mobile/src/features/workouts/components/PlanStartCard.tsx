import { useState } from 'react';
import { View } from 'react-native';
import { plural } from '@trainingai/shared/format/plural';
import { AppButton, AppText, Badge, Card, Icon, Stack } from '../../../shared/ui';
import { TouchSurface } from '../../../shared/ui/TouchSurface';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { LiftCoachMenu } from '../../coach/components/LiftCoachMenu';
import { PLAN_ROWS_SHOWN, type PlanStartModel } from '../data/plan-start';

/** The day's plan on the AI program (mockup 1A): header, meta line, the lifts, and why. */
export function PlanStartCard({
  model,
  onSelect,
}: {
  model: PlanStartModel;
  onSelect: (id: string) => void;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? model.rows : model.rows.slice(0, PLAN_ROWS_SHOWN);
  const hidden = model.rows.length - shown.length;
  return (
    <Card tone="brand">
      <Stack direction="row" justify="space-between" align="center" gap="sm">
        <AppText variant="heading" style={{ flex: 1 }}>
          {model.header}
        </AppText>
        {model.typeLabel && <Badge label={model.typeLabel} />}
      </Stack>
      <AppText variant="caption" tone="muted">
        {model.meta}
      </AppText>
      {model.failure && (
        <AppText variant="caption" tone="muted">
          {model.failure}
        </AppText>
      )}
      <Stack gap="sm">
        {shown.map((row, index) => (
          <View key={row.id}>
            <TouchSurface
              accessibilityRole="button"
              accessibilityLabel={`${row.name}, ${row.scheme}${row.done ? ', completed' : ''}`}
              onPress={() => onSelect(row.id)}
            >
              <Stack
                gap="xs"
                style={{
                  minHeight: theme.sizes.touchTarget,
                  justifyContent: 'center',
                  // Room for the lift's "…" Coach menu, which sits over the row, not inside it.
                  paddingRight: theme.sizes.touchTarget,
                }}
              >
                <Stack direction="row" align="center" gap="sm">
                  <AppText variant="micro" tone={row.done ? 'brand' : 'muted'}>
                    {row.done ? '✓' : index + 1}
                  </AppText>
                  <AppText variant="label" style={{ flex: 1 }}>
                    {row.name}
                  </AppText>
                  <AppText variant="caption">{row.scheme}</AppText>
                  {row.change && (
                    <Stack direction="row" align="center" gap="xs">
                      <Icon
                        name={row.change.direction}
                        size={theme.sizes.iconSmall}
                        tone={row.change.direction === 'up' ? 'brand' : 'muted'}
                      />
                      <AppText
                        variant="micro"
                        tone={row.change.direction === 'up' ? 'brand' : 'muted'}
                        accessibilityLabel={`${row.change.direction === 'up' ? 'up' : 'down'} ${row.change.amount} since last time`}
                      >
                        {row.change.amount}
                      </AppText>
                    </Stack>
                  )}
                </Stack>
                {(row.deloaded || row.injured || row.superset) && (
                  <Stack direction="row" wrap gap="xs">
                    {row.deloaded && <Badge label="Deload" />}
                    {row.injured && <Badge label="Injury" tone="heart" />}
                    {row.superset && <Badge label="Superset" />}
                  </Stack>
                )}
                {row.note && (
                  // Wrapped, never cut: why this lift's load moved.
                  <AppText variant="micro" tone="muted">
                    {row.note}
                  </AppText>
                )}
              </Stack>
            </TouchSurface>
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                minHeight: theme.sizes.touchTarget,
                justifyContent: 'center',
              }}
            >
              <LiftCoachMenu sessionExerciseId={row.id} name={row.name} />
            </View>
          </View>
        ))}
      </Stack>
      {(hidden > 0 || expanded) && model.rows.length > PLAN_ROWS_SHOWN && (
        <AppButton
          variant="ghost"
          title={
            expanded
              ? 'Show fewer'
              : `+ ${hidden} more${model.notesBehindMore ? ` · ${plural(model.notesBehindMore, 'note', 'notes')}` : ''}`
          }
          onPress={() => setExpanded(!expanded)}
        />
      )}
      {model.notes.map((line) => (
        <AppText key={line} variant="caption" tone="muted">
          {line}
        </AppText>
      ))}
      {model.reason && (
        <AppText variant="caption" tone="muted">
          {model.reason}
        </AppText>
      )}
    </Card>
  );
}
