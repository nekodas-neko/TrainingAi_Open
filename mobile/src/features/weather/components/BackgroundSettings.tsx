import { AppButton, AppText, Card, SwitchRow } from '../../../shared/ui';
import { useWeather } from '../WeatherProvider';
const sections = {
  home: 'Home',
  health: 'Health',
  workout: 'Workout',
  nutrition: 'Nutrition',
  more: 'More',
} as const;
export function BackgroundSettings() {
  const { settings, store, saveError } = useWeather();
  return (
    <Card>
      <AppText variant="heading">Dynamic backgrounds</AppText>
      <SwitchRow
        label="Enable backgrounds"
        value={settings.backgroundEnabled}
        onValueChange={(backgroundEnabled) => void store.configure({ backgroundEnabled })}
      />
      {settings.backgroundEnabled && (
        <>
          <AppText variant="caption" tone="muted">
            Home and Workout follow daylight and weather. Other tabs have their own colour
            palette.
          </AppText>
          <SwitchRow
            label="Animate weather"
            value={settings.backgroundAnimated}
            onValueChange={(backgroundAnimated) => void store.configure({ backgroundAnimated })}
          />
          {(Object.keys(sections) as (keyof typeof sections)[]).map((key) => (
            <SwitchRow
              key={key}
              label={sections[key]}
              value={settings.backgroundSections[key]}
              onValueChange={(value) =>
                void store.configure((current) => ({
                  backgroundSections: { ...current.backgroundSections, [key]: value },
                }))
              }
            />
          ))}
        </>
      )}
      {saveError && (
        <AppButton
          title="Retry saving backgrounds"
          variant="ghost"
          onPress={() => void store.retry()}
        />
      )}
    </Card>
  );
}
