import { useEffect, useState, type PropsWithChildren } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { openLocalStorage } from '../../core/storage/open';
import type { LocalStorage } from '../../core/storage/LocalStorage';
import { StorageUpgradeRequired } from '../../core/storage/migrations';
import { StorageProvider } from '../../core/storage/StorageProvider';
import { AppearancePreferences } from '../../features/settings/appearance';
import { AppearanceProvider } from '../../features/settings/AppearanceProvider';
import { ThemeProvider, useTheme } from '../../shared/theme/ThemeProvider';
import { AppButton, AppText, LoadingIndicator, Notice, Screen } from '../../shared/ui';

type ReadyStorage = {
  storage: LocalStorage;
  preferences: AppearancePreferences;
};

export function StartupScreen({ error, retry }: { error: string | null; retry?: () => void }) {
  const { theme } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Screen title={error ? 'Saved data unavailable' : 'Opening TrainingAi'}>
        {error ? (
          <>
            <Notice title="Could not open saved data" message={error} error />
            <AppButton title="Retry" onPress={retry} />
          </>
        ) : (
          <>
            <LoadingIndicator accessibilityLabel="Opening saved data" />
            <AppText tone="muted">Opening saved data…</AppText>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}

export function LocalStorageProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState<ReadyStorage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    void openLocalStorage()
      .then(async (storage) => {
        const preferences = new AppearancePreferences(storage.device());
        await preferences.load();
        return { storage, preferences };
      })
      .then(
        (value) => {
          if (active) {
            setReady(value);
          }
        },
        (reason: unknown) => {
          if (!active) {
            return;
          }
          const message =
            reason instanceof StorageUpgradeRequired
              ? reason.message
              : reason instanceof Error &&
                  /Cannot find native module.*ExpoSQLite/.test(reason.message)
                ? 'Install the latest iPhone development build to enable local storage.'
                : 'Your saved data could not be opened. Retry after unlocking your phone. Existing data has not been cleared.';
          setError(message);
        },
      );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (!ready) {
    return (
      <ThemeProvider>
        <StartupScreen error={error} retry={() => setAttempt((value) => value + 1)} />
      </ThemeProvider>
    );
  }
  return (
    <StorageProvider storage={ready.storage}>
      <AppearanceProvider preferences={ready.preferences}>{children}</AppearanceProvider>
    </StorageProvider>
  );
}
