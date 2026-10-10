import { AppText, Card, ColorChoice, Grid, SegmentedControl } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { palettes, type Brand } from '../../../shared/theme/palettes';

export function AppearancePanel() {
  const { theme, mode, setMode, brand, setBrand } = useTheme();
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
      <Grid columns={2}>
        {(Object.keys(palettes) as Brand[]).map((key) => (
          <ColorChoice
            key={key}
            label={palettes[key].label}
            color={palettes[key][theme.mode].brand}
            selected={brand === key}
            onPress={() => setBrand(key)}
          />
        ))}
      </Grid>
      <AppText variant="caption" tone="muted">
        Changes apply for this session.
      </AppText>
    </Card>
  );
}
