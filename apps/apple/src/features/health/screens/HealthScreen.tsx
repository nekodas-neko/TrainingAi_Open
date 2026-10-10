import { AppButton, Section, FeatureRow } from '../../../shared/ui';
import { HealthSummary } from '../components/HealthSummary';
import { HealthNotice } from '../components/HealthNotice';
import { useHealthContext } from '../HealthProvider';
import { diagnosticsAvailable } from '../../../development/diagnostics/client';

export function HealthScreen({ openData }: { openData: () => void }) {
  const health = useHealthContext();
  return (
    <>
      <HealthNotice snapshot={health.snapshot} reportsAvailable={diagnosticsAvailable} />
      <HealthSummary />
      <Section title="Health insights">
        <FeatureRow title="Sleep" subtitle="Stages, trends and sleep quality" />
        <FeatureRow title="Readiness & recovery" subtitle="Understand your recovery and stress" />
        <FeatureRow title="Heart & fitness" subtitle="Heart rate, HRV and fitness trends" />
        <FeatureRow title="Body measurements" subtitle="Weight, composition and your goals" />
        <FeatureRow title="Activity & energy" subtitle="Movement, steps and energy balance" />
      </Section>
      <Section title="Data sources">
        <FeatureRow
          title="Apple Health"
          subtitle="Read your data, sources and permissions"
          onPress={openData}
        />
        <FeatureRow
          title="Devices & integrations"
          subtitle="Rings, sensors and connected services"
        />
      </Section>

      <AppButton
        variant="secondary"
        title="Explore sample data"
        disabled={health.busy}
        onPress={health.loadSample}
      />
    </>
  );
}
