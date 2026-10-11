import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { createTheme, type ThemeMode, type ThemeOverrides } from './theme';
import type { Brand } from './palettes';

type ThemeOptions = {
  initialMode?: ThemeMode;
  initialBrand?: Brand;
  overrides?: ThemeOverrides;
  mode?: ThemeMode;
  brand?: Brand;
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
}: ThemeOptions) {
  const system = useColorScheme();
  const [localMode, setLocalMode] = useState(initialMode);
  const [localBrand, setLocalBrand] = useState(initialBrand);
  const mode = controlledMode ?? localMode;
  const brand = controlledBrand ?? localBrand;
  const setMode = onModeChange ?? setLocalMode;
  const setBrand = onBrandChange ?? setLocalBrand;
  const resolved = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const theme = useMemo(
    () => createTheme(resolved, brand, overrides),
    [resolved, brand, overrides],
  );
  return { theme, mode, brand, setMode, setBrand };
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
