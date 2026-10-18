import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme, useWindowDimensions } from 'react-native';
import { createTheme, type ThemeMode, type ThemeOverrides } from './theme';
import { customAccent } from './custom-accent';
import { scalesText, textScale } from './text-scale';
import type { Brand } from './palettes';

type ThemeOptions = {
  initialMode?: ThemeMode;
  initialBrand?: Brand;
  overrides?: ThemeOverrides;
  mode?: ThemeMode;
  brand?: Brand;
  customHue?: number | null;
  onCustomHueChange?: (hue: number | null) => void;
  onModeChange?: (mode: ThemeMode) => void;
  onBrandChange?: (brand: Brand) => void;
};

function useThemeController({
  initialMode = 'system',
  initialBrand = 'green',
  overrides,
  mode: controlledMode,
  brand: controlledBrand,
  onModeChange,
  onBrandChange,
  customHue: controlledHue = null,
  onCustomHueChange,
}: ThemeOptions) {
  const system = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const [localMode, setLocalMode] = useState(initialMode);
  const [localBrand, setLocalBrand] = useState(initialBrand);
  const mode = controlledMode ?? localMode;
  const brand = controlledBrand ?? localBrand;
  const setMode = onModeChange ?? setLocalMode;
  const [localHue, setLocalHue] = useState<number | null>(null);
  const [previewHue, setPreviewHue] = useState<number | undefined>();
  const customHue = previewHue ?? (onCustomHueChange ? controlledHue : localHue);
  const setCustomHue = (hue: number | null) => {
    setPreviewHue(undefined);
    (onCustomHueChange ?? setLocalHue)(hue);
  };
  const setBrand = (value: Brand) => {
    setPreviewHue(undefined);
    setLocalHue(null);
    (onBrandChange ?? setLocalBrand)(value);
  };
  const resolved = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const theme = useMemo(
    () =>
      createTheme(resolved, brand, {
        ...overrides,
        colors: {
          ...(customHue !== null ? customAccent(customHue, resolved) : {}),
          ...overrides?.colors,
        },
      }),
    [resolved, brand, overrides, customHue],
  );
  return {
    theme,
    mode,
    brand,
    customHue,
    setMode,
    setBrand,
    setCustomHue,
    previewCustomHue: setPreviewHue,
    /** The factor text is drawn at; for sizes that must track text, such as a row fitting a label. */
    textScale: textScale(fontScale),
    /** Pass to every Text and TextInput so none shrinks below its token size (text-scale.ts). */
    allowFontScaling: scalesText(fontScale),
  };
}
const Context = createContext<ReturnType<typeof useThemeController> | null>(null);
export function ThemeProvider({ children, ...options }: PropsWithChildren<ThemeOptions>) {
  const value = useThemeController(options);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTheme() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('ThemeProvider is required.');
  }
  return value;
}
