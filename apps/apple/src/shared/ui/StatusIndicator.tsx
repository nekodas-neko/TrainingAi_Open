import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { LoadingIndicator } from './LoadingIndicator';
import { IconButton } from './IconButton';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { Sheet } from './Sheet';

export function StatusIndicator({
  label,
  busy = false,
  error,
  onRetry,
  message,
  actionLabel = 'Retry',
}: {
  label: string;
  busy?: boolean;
  error?: string | null;
  onRetry?: () => void;
  message?: string | null;
  actionLabel?: string;
}) {
  const { theme } = useTheme();
  const [details, setDetails] = useState(false);
  const detail = error ?? message;
  useEffect(() => {
    if (!detail) {
      setDetails(false);
    }
  }, [detail]);
  return (
    <View
      style={{
        width: theme.sizes.touchTarget,
        height: theme.sizes.touchTarget,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {busy ? (
        <LoadingIndicator accessibilityLabel={`Loading ${label}`} />
      ) : detail ? (
        <IconButton
          icon={error ? 'refresh' : 'check'}
          tone={error ? 'danger' : 'brand'}
          label={error ? `${label} unavailable` : label}
          hint="View details"
          onPress={() => setDetails(true)}
        />
      ) : null}
      <Sheet visible={details && !!detail} title={label} onClose={() => setDetails(false)}>
        <AppText>{detail}</AppText>
        {onRetry && (
          <AppButton
            title={actionLabel}
            onPress={() => {
              setDetails(false);
              onRetry();
            }}
          />
        )}
      </Sheet>
    </View>
  );
}
