import {
  AppButton,
  AppText,
  Card,
  ColorChoice,
  Grid,
  HueSlider,
  Notice,
  SegmentedControl,
} from '../../../shared/ui';
import { useAppearancePreferences } from '../AppearanceProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { palettes, type Brand } from '../../../shared/theme/palettes';

export function AppearancePanel() {
  const { theme, mode, setMode, brand, setBrand, customHue, setCustomHue, previewCustomHue } =
    useTheme();
  const { saveStatus, retry } = useAppearancePreferences();
  return (
    <Card>
      <AppText variant="heading">Appearance</AppText>
      <SegmentedControl
        label="Colour scheme"
        value={mode}
        onChange={setMode}
        options={[
          { label: 'System', value: 'system' },
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ]}
      />
      <AppText variant="label">Accent colour</AppText>
      <HueSlider
        value={customHue}
        onChange={previewCustomHue}
        onComplete={setCustomHue}
        onCancel={() => previewCustomHue(undefined)}
      />
      <Grid columns={2}>
        {(Object.keys(palettes) as Brand[]).map((key) => (
          <ColorChoice
            key={key}
            label={palettes[key].label}
            color={palettes[key][theme.mode].brand}
            selected={customHue === null && brand === key}
            onPress={() => setBrand(key)}
          />
        ))}
      </Grid>
      {saveStatus === 'error' ? (
        <>
          <Notice
            title="Preferences not saved"
            message="Your changes apply now, but could not be saved for next time."
            error
          />
          <AppButton title="Retry saving preferences" variant="secondary" onPress={retry} />
        </>
      ) : (
        <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
          {saveStatus === 'saving'
            ? 'Saving preferences…'
            : 'Preferences are saved on this iPhone.'}
        </AppText>
      )}
    </Card>
  );
}
