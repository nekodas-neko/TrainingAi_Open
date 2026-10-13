import { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { AppButton, AppText, TimerRing } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

export function StartCountdown({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const [remaining, setRemaining] = useState(3);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    let count = 3;
    const timer = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(timer);
        complete.current();
      } else {
        setRemaining(count);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.scrim,
          justifyContent: 'center',
          alignItems: 'center',
          gap: theme.spacing.xl,
        }}
      >
        <AppText variant="hero" tone="brand">
          Get ready
        </AppText>
        <TimerRing value={String(remaining)} progress={remaining / 3} />
        <AppButton title="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </Modal>
  );
}
