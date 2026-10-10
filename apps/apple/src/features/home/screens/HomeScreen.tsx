import {
  AppText,
  AppButton,
  Stack,
  Section,
  FeatureRow,
  PlaceholderCard,
} from '../../../shared/ui';
import { HealthSummary } from '../../health/components/HealthSummary';
import { HealthNotice } from '../../health/components/HealthNotice';
import { useHealthContext } from '../../health/HealthProvider';
import { diagnosticsAvailable } from '../../../development/diagnostics/client';

export function HomeScreen({ openHealth }: { openHealth: () => void }) {
  const { snapshot } = useHealthContext();
  return (
    <>
      <PlaceholderCard
        eyebrow="YOUR NEXT SESSION"
        title="Make room for your next workout"
        description="Your program and next scheduled session will appear here."
        action="Start workout"
      />
      <Stack gap="md">
        <AppText variant="heading">Today’s health</AppText>
        <HealthSummary />
        <AppButton title="Read Apple Health" variant="secondary" onPress={openHealth} />
      </Stack>
      {snapshot && <HealthNotice snapshot={snapshot} reportsAvailable={diagnosticsAvailable} />}
      <Section title="Daily check-in">
        <FeatureRow title="Morning check-in" subtitle="Sleep, recovery and how you feel" />
        <FeatureRow title="Mood & energy" subtitle="Keep track of your day" />
      </Section>
      <Section title="Your overview">
        <FeatureRow title="Weekly progress" subtitle="Training, activity and your goals" />
        <FeatureRow title="Calendar & history" subtitle="Your sessions and daily reviews" />
        <FeatureRow title="AI coach" subtitle="Guidance for your training and recovery" />
      </Section>
    </>
  );
}
