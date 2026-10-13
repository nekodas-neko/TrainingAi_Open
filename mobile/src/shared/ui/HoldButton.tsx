import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';

export function HoldButton({
  title,
  onConfirm,
  disabled = false,
  duration = 1200,
}: {
  title: string;
  onConfirm: () => void;
  disabled?: boolean;
  duration?: number;
}) {
  const { theme } = useTheme(),
    [progress, setProgress] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fired = useRef(false);
  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  }
  useEffect(() => {
    if (disabled) stop();
    return stop;
  }, [disabled]);
  function start() {
    if (disabled || timer.current) return;
    fired.current = false;
    const started = Date.now();
    timer.current = setInterval(() => {
      const value = Math.min(1, (Date.now() - started) / duration);
      setProgress(value);
      if (value >= 1 && !fired.current) {
        fired.current = true;
        stop();
        onConfirm();
      }
    }, 30);
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={`Hold for ${duration / 1000} seconds to confirm`}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'activate', label: 'Confirm this change' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate' && !disabled) {
          Alert.alert('Apply this change?', 'This affects your whole block.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Apply', style: 'destructive', onPress: onConfirm },
          ]);
        }
      }}
      disabled={disabled}
      onPressIn={start}
      onPressOut={stop}
      style={{
        overflow: 'hidden',
        minHeight: theme.sizes.button,
        padding: theme.spacing.md,
        borderRadius: theme.radii.control,
        borderWidth: 1,
        borderColor: theme.colors.danger,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${progress * 100}%`,
          backgroundColor: theme.tones.heart.background,
        }}
      />
      <AppText variant="label" style={{ color: theme.colors.danger }}>
        {title}
      </AppText>
    </Pressable>
  );
}
