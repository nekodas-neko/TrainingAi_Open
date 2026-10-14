import { AppText, Card, SwitchRow } from '../../../shared/ui';
import { usePlatformIntegrations } from '../../platform/PlatformProvider';
import { appHandoff } from '../../../integrations/app-handoff/platform';

// Turns the morning hand-off to the Oura app on or off (#2896). Android only.
export function OuraMorningSyncSetting() {
  const { state, store } = usePlatformIntegrations();
  if (!appHandoff || !store || !state?.ready) return null;
  return (
    <Card>
      <AppText variant="heading">Oura</AppText>
      <SwitchRow
        label="Fetch last night’s sleep from Oura on a morning open"
        value={state.settings.ouraMorningSync}
        onValueChange={(ouraMorningSync) =>
          void store.configure({ ouraMorningSync }).catch(() => {})
        }
      />
      <AppText variant="caption" tone="muted">
        When last night’s sleep hasn’t arrived yet, TrainingAi opens the Oura app for a moment
        so it syncs, then comes straight back. Once each morning, and only while Oura is
        connected.
      </AppText>
      {state.error && (
        <AppText variant="caption" tone="muted" accessibilityRole="alert">
          {state.error}
        </AppText>
      )}
    </Card>
  );
}
