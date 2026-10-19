import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import {
  AppButton,
  AppText,
  Card,
  ListRow,
  SegmentedControl,
  Stack,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWeather } from '../WeatherProvider';
import { searchCities } from '../data/open-meteo';
import { isWeatherDay, temperatureLabel, type WeatherPlace } from '../data/models';
import { failureNotice } from '../../../core/reporting/index.ts';

export function WeatherSettings() {
  const { theme } = useTheme();
  const { store, settings, snapshot, busy, error, saveError } = useWeather();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const searchId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function search() {
    if (query.trim().length < 2 || searching) return;
    const id = ++searchId.current;
    setSearching(true);
    setMessage(null);
    try {
      const places = await searchCities(query);
      if (id !== searchId.current || !mounted.current) return;
      setResults(places);
      if (!places.length) setMessage('No matches. Try a city or suburb name.');
    } catch (failure) {
      if (id === searchId.current && mounted.current)
        setMessage(failureNotice('Could not search cities. Please retry.', failure));
    } finally {
      if (id === searchId.current && mounted.current) setSearching(false);
    }
  }
  async function currentLocation() {
    if (locating) return;
    setLocating(true);
    setMessage(null);
    try {
      await store.useCurrentLocation();
    } catch (cause) {
      if (mounted.current)
        setMessage(cause instanceof Error ? cause.message : 'Could not find your location.');
    } finally {
      if (mounted.current) setLocating(false);
    }
  }
  return (
    <Card>
      <AppText variant="heading">Weather</AppText>
      <SwitchRow
        label="Show weather on Home"
        value={settings.enabled}
        onValueChange={(enabled) => void store.configure({ enabled })}
      />
      {(settings.enabled || settings.backgroundEnabled) && (
        <>
          <AppText variant="caption" tone="muted">
            {settings.source === 'device'
              ? `Using device location${settings.city ? `. Fallback: ${settings.city.name}` : '.'}`
              : (settings.city?.name ?? 'Choose a city, or use your current location.')}
          </AppText>
          <SegmentedControl
            label="Temperature unit"
            value={settings.unit}
            onChange={(unit) => void store.configure({ unit })}
            options={[
              { value: 'celsius', label: 'Celsius' },
              { value: 'fahrenheit', label: 'Fahrenheit' },
            ]}
          />
          <AppButton
            title="Use current location"
            icon="pin"
            variant="secondary"
            busy={locating}
            onPress={() => void currentLocation()}
          />
          <AppText variant="caption" tone="muted">
            Location is used only while the app is open.
          </AppText>
          <Stack direction="row" align="flex-end">
            <TextField
              label="City or suburb"
              placeholder="Search e.g. Brisbane"
              value={query}
              onChangeText={(value) => {
                searchId.current++;
                setSearching(false);
                setQuery(value);
                setResults([]);
                setMessage(null);
              }}
              maxLength={100}
              returnKeyType="search"
              onSubmitEditing={() => void search()}
            />
            <AppButton
              title="Search"
              busy={searching}
              disabled={query.trim().length < 2}
              onPress={() => void search()}
            />
          </Stack>
          <View
            style={{
              minHeight: (theme.typography.caption.lineHeight ?? theme.sizes.iconSmall) * 2,
            }}
          >
            <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
              {message ??
                saveError ??
                error ??
                (busy
                  ? 'Refreshing weather…'
                  : 'Search by city or suburb name; postcodes are not supported.')}
            </AppText>
          </View>
          {results.map((place) => (
            <ListRow
              key={`${place.lat}:${place.lon}`}
              title={place.name}
              density="compact"
              onPress={() => {
                searchId.current++;
                setResults([]);
                setQuery('');
                setMessage(null);
                void store.configure({ city: place, source: 'city', enabled: true });
              }}
            />
          ))}
          {snapshot && (
            <Stack direction="row" align="center" justify="space-between">
              <AppText variant="label">
                {temperatureLabel(snapshot, settings.unit)}
                {isWeatherDay(snapshot) && snapshot.uvIndex != null
                  ? ` · UV ${Math.round(snapshot.uvIndex)}`
                  : ''}
              </AppText>
              <AppText variant="caption" tone="muted">
                Updated{' '}
                {new Date(snapshot.fetchedAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </AppText>
            </Stack>
          )}
          <AppButton
            title={saveError ? 'Retry saving & refresh' : 'Refresh weather'}
            variant="ghost"
            icon="refresh"
            busy={busy}
            disabled={!settings.city && settings.source !== 'device'}
            onPress={() => void store.retry()}
          />
        </>
      )}
      {!settings.enabled && saveError && (
        <>
          <AppText variant="caption" tone="muted">
            {saveError}
          </AppText>
          <AppButton
            title="Retry saving weather settings"
            variant="ghost"
            onPress={() => void store.retry()}
          />
        </>
      )}
      <AppButton
        title="Weather data by Open-Meteo"
        variant="ghost"
        icon="external"
        onPress={() => void Linking.openURL('https://open-meteo.com/')}
      />
    </Card>
  );
}
