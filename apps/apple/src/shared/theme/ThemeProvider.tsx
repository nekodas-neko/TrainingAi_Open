import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { createTheme, type ThemeMode, type ThemeOverrides } from './theme';
import type { Brand } from './palettes';

function useThemeController(
  initialMode: ThemeMode,
  initialBrand: Brand,
  overrides?: ThemeOverrides,
) {
  const system = useColorScheme();
  const [mode, setMode] = useState(initialMode);
  const [brand, setBrand] = useState(initialBrand);
  const resolved = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const theme = useMemo(
    () => createTheme(resolved, brand, overrides),
    [resolved, brand, overrides],
  );
  return { theme, mode, brand, setMode, setBrand };
}
const Context = createContext<ReturnType<typeof useThemeController> | null>(null);
export function ThemeProvider({
  children,
  initialMode = 'system',
  initialBrand = 'green',
  overrides,
}: PropsWithChildren<{
  initialMode?: ThemeMode;
  initialBrand?: Brand;
  overrides?: ThemeOverrides;
}>) {
  const value = useThemeController(initialMode, initialBrand, overrides);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTheme() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('ThemeProvider is required.');
  }
  return value;
}
