import { useState } from 'react';
import { AppState } from 'react-native';
import { AppButton, AppText, Card, ChipPicker, Stack } from '../../../shared/ui';
import {
  appHandoff,
  handoffDebugAvailable,
} from '../../../integrations/app-handoff/platform';
import type { HandoffResult } from '../../../integrations/app-handoff/types';
import { OURA_PACKAGE } from '../data/oura-handoff';

const targets = [
  { label: 'Oura', value: OURA_PACKAGE },
  { label: 'Clock', value: 'com.sec.android.app.clockpackage' },
  { label: 'Settings', value: 'com.android.settings' },
] as const;
const delays = [1_000, 2_000, 5_000] as const;

// Spike for #2896, shown only in development and side-by-side builds: does TrainingAi come back
// to the front after opening another app, with and without "Display over other apps"?
export function AppHandoffDebugCard() {
  const [target, setTarget] = useState<string>(OURA_PACKAGE);
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState(() => appHandoff?.canDrawOverlays() ?? false);
  const [log, setLog] = useState<string[]>([]);
  if (!handoffDebugAvailable || !appHandoff) return null;
  const handoff = appHandoff;
  async function run(ms: number) {
    setBusy(true);
    try {
      const result: HandoffResult = await handoff.openAppBriefly(target, ms);
      const line = [
        `${targets.find((row) => row.value === target)?.label} ${ms / 1000}s`,
        result.outcome,
        result.method,
        `overlay ${result.overlayGranted ? 'on' : 'off'}`,
        `${Math.round(result.elapsedMs)} ms`,
        `app ${AppState.currentState}`,
        result.error,
      ]
        .filter(Boolean)
        .join(' · ');
      setLog((rows) => [line, ...rows].slice(0, 12));
    } catch (cause) {
      setLog((rows) => [cause instanceof Error ? cause.message : 'Failed', ...rows]);
    } finally {
      setOverlay(handoff.canDrawOverlays());
      setBusy(false);
    }
  }
  return (
    <Card>
      <AppText variant="heading">App hand-off test</AppText>
      <AppText variant="caption" tone="muted">
        Opens the chosen app, then tries to bring TrainingAi back. Not shown in the real app.
      </AppText>
      <ChipPicker
        label="App"
        value={target}
        options={targets.map((row) => ({
          ...row,
          label: handoff.isInstalled(row.value) ? row.label : `${row.label} (missing)`,
        }))}
        onChange={(value) => value && setTarget(value)}
        disabled={busy}
      />
      <Stack direction="row" gap="sm">
        {delays.map((ms) => (
          <AppButton
            key={ms}
            title={`${ms / 1000} s`}
            variant="secondary"
            disabled={busy}
            onPress={() => void run(ms)}
          />
        ))}
      </Stack>
      <AppText variant="caption">
        Display over other apps: {overlay ? 'allowed' : 'not allowed'}
      </AppText>
      <AppButton
        title="Open “Display over other apps”"
        variant="ghost"
        onPress={() => handoff.openOverlaySettings()}
      />
      {log.map((line, index) => (
        <AppText key={index} variant="micro" tone="muted">
          {line}
        </AppText>
      ))}
    </Card>
  );
}
