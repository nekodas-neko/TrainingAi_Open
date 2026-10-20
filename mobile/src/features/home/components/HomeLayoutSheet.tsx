import { useState } from 'react';
import {
  AppButton,
  AppText,
  Card,
  SortableStack,
  MultiChoice,
  Picker,
  Sheet,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useHome } from '../data/HomeProvider';
import {
  homeCardsPatch,
  homeSections,
  metricLabels,
  sectionLabels,
  widgetLabels,
  scoreStyles,
} from '../data/models';
import { failureNotice } from '../../../core/reporting/index.ts';

export function HomeLayoutSheet({ onClose }: { onClose: () => void }) {
  const home = useHome();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefs = home.preferences;
  const order = homeSections(prefs);
  const hidden = prefs.homeHiddenSections ?? [];
  async function save(patch: Partial<typeof prefs>) {
    if (!home.store || busy) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      await home.store.savePreferences(patch);
      return true;
    } catch (failure) {
      setError(failureNotice('Could not save your Home layout on this phone. Try again.', failure));
      return false;
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
        Drag a handle to reorder sections. Choose which cards you want to see.
      </AppText>
      <SortableStack
        order={order}
        enabled={!busy}
        label={(key) => sectionLabels[key]}
        onChange={(homeSectionOrder) => save({ homeSectionOrder })}
        renderItem={(key, handle) => (
          <Card key={key} style={{ paddingVertical: 0 }}>
            <Stack direction="row" align="center" justify="space-between" gap="sm">
              {handle}
              <AppText variant="label" style={{ flex: 1 }}>
                {sectionLabels[key]}
              </AppText>
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
        )}
      />
      <MultiChoice
        label="Cards"
        value={prefs.homeCards ?? []}
        options={Object.entries(widgetLabels).map(([value, label]) => ({ value, label }))}
        onChange={(homeCards) => {
          if (!busy) {
            void save(homeCardsPatch(prefs, homeCards));
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
