import { ScrollView } from 'react-native';
import { Badge } from './Badge';
import { Stack } from './Stack';

export function StepProgress({
  steps,
}: {
  steps: { id: string; label: string; state: 'done' | 'current' | 'upcoming' }[];
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      <Stack direction="row" accessibilityLabel="Set progress">
        {steps.map((step) => (
          <Badge
            key={step.id}
            label={`${step.state === 'done' ? '✓ ' : ''}${step.label}`}
            tone={step.state === 'upcoming' ? 'neutral' : 'brand'}
          />
        ))}
      </Stack>
    </ScrollView>
  );
}
