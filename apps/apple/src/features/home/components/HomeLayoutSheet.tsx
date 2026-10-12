import { useState } from 'react';
import {
  AppButton,
  AppText,
  Card,
  IconButton,
  MultiChoice,
  Picker,
  Sheet,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useHome } from '../data/HomeProvider';
import {
  homeSections,
  moveHomeSection,
  metricLabels,
  sectionLabels,
  widgetLabels,
  scoreStyles,
} from '../data/models';

export function HomeLayoutSheet({ onClose }: { onClose: () => void }) {
  const home = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefs = home.preferences;
  const order = homeSections(prefs);
  const hidden = prefs.homeHiddenSections ?? [];
  async function save(patch: Partial<typeof prefs>) {
    if (!home.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await home.store.savePreferences(patch);
    } catch {
      setError('Could not save your Home layout on this phone. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title="Home layout"
      onClose={onClose}
      actions={<StatusIndicator label="Home layout" error={error ?? home.error} busy={busy} />}
      footer={<AppButton title="Done" onPress={onClose} />}
    >
      <AppText variant="caption" tone="muted">
        Choose your cards and move sections into the order you prefer.
      </AppText>
      {order.map((key, index) => (
        <Card key={key}>
          <Stack direction="row" align="center" justify="space-between">
            <AppText variant="label" style={{ flex: 1 }}>
              {sectionLabels[key]}
            </AppText>
            <IconButton
              icon="up"
              label={`Move ${sectionLabels[key]} up`}
              disabled={busy || index === 0}
              onPress={() => void save({ homeSectionOrder: moveHomeSection(order, key, -1) })}
            />
            <IconButton
              icon="down"
              label={`Move ${sectionLabels[key]} down`}
              disabled={busy || index === order.length - 1}
              onPress={() => void save({ homeSectionOrder: moveHomeSection(order, key, 1) })}
            />
            <AppButton
              title={hidden.includes(key) ? 'Show' : 'Hide'}
              variant="ghost"
              disabled={busy}
              accessibilityLabel={`${hidden.includes(key) ? 'Show' : 'Hide'} ${sectionLabels[key]}`}
              onPress={() =>
                void save({
                  homeHiddenSections: hidden.includes(key)
                    ? hidden.filter((x) => x !== key)
                    : [...hidden, key],
                })
              }
            />
          </Stack>
        </Card>
      ))}
      <MultiChoice
        label="Cards"
        value={prefs.homeCards ?? []}
        options={Object.entries(widgetLabels).map(([value, label]) => ({ value, label }))}
        onChange={(homeCards) => {
          if (!busy) {
            void save({ homeCards });
          }
        }}
      />
      <MultiChoice
        label="Metric tiles"
        value={prefs.homeWidgets ?? ['weightKg', 'steps', 'calories']}
        options={Object.entries(metricLabels).map(([value, label]) => ({ value, label }))}
        onChange={(homeWidgets) => {
          if (!busy) {
            void save({ homeWidgets });
          }
        }}
      />
      <Picker
        label="Score appearance"
        value={prefs.scoreRingStyle ?? 'default'}
        options={scoreStyles}
        onChange={(scoreRingStyle) => void save({ scoreRingStyle })}
      />
      <Picker
        label="Weight trend"
        value={String(prefs.weightLookback ?? 7)}
        options={[
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
        ]}
        onChange={(value) => void save({ weightLookback: Number(value) })}
      />
    </Sheet>
  );
}
