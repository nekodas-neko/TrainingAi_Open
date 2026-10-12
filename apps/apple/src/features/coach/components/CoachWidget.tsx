import { useMemo } from 'react';
import { AppButton, AppText, Card, Icon, ListRow } from '../../../shared/ui';
import { CoachWidgetSchema, type WidgetResult, type ChangePreviewArgs } from '../data/widgets';
import { DOMAIN_TIER, FIELD_LABEL } from '../data/patch';
import { ChoiceCard } from './CoachChoices';
import { ChangeCard } from './CoachChanges';
import { ChartCard } from './CoachChart';
import { PlanCard } from './CoachPlan';
export type Destination = 'program_builder' | 'log_activity' | 'profile' | 'nutrition';
export function CoachWidget({
  input,
  onResult,
  onReview,
  onNavigate,
}: {
  input: unknown;
  onResult?: (result: WidgetResult) => void;
  onReview: (args: ChangePreviewArgs) => void;
  onNavigate: (destination: Destination) => void;
}) {
  const parsed = useMemo(() => CoachWidgetSchema.safeParse(input), [input]);
  if (!parsed.success)
    return (
      <Card>
        <AppText tone="muted">
          This step could not be shown. Ask Coach to answer in text instead.
        </AppText>
      </Card>
    );
  const args = parsed.data;
  if (args.kind === 'choice_list') return <ChoiceCard args={args} onResult={onResult} />;
  if (args.kind === 'chart') return <ChartCard args={args} onResult={onResult} />;
  if (args.kind === 'plan_card') return <PlanCard args={args} onResult={onResult} />;
  if (args.kind === 'handoff')
    return (
      <Card padded={false}>
        <ListRow
          leading={<Icon name="external" tone="brand" />}
          title={args.title}
          subtitle={args.subtitle}
          onPress={() => onNavigate(args.destination)}
        />
      </Card>
    );
  if (DOMAIN_TIER[args.patch.domain] === 3)
    return (
      <Card tone="heart">
        <AppText variant="label">Affects your whole block</AppText>
        <AppText>{args.title}</AppText>
        <AppText variant="caption" tone="muted">
          {args.patch.changes.map((change) => FIELD_LABEL[change.field]).join(', ')}
        </AppText>
        {onResult && (
          <AppButton
            title="Review what this does"
            variant="surface"
            onPress={() => onReview({ ...args, kind: 'change_preview' })}
          />
        )}
      </Card>
    );
  return <ChangeCard args={args} onResult={onResult} />;
}
