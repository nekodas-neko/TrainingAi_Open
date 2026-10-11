import type { PropsWithChildren } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function Sheet({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{ visible: boolean; title: string; onClose: () => void }>) {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.scrim }}>
        <Pressable accessibilityLabel="Close dialog" onPress={onClose} style={{ flex: 1 }} />
        <SafeAreaView
          edges={['bottom']}
          accessibilityViewIsModal
          style={{
            maxHeight: '85%',
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radii.card,
            borderTopRightRadius: theme.radii.card,
            padding: theme.spacing.lg,
          }}
        >
          <Stack direction="row" align="center" justify="space-between">
            <AppText variant="heading" style={{ flex: 1 }}>
              {title}
            </AppText>
            <IconButton icon="close" label="Close dialog" onPress={onClose} />
          </Stack>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: theme.spacing.md, paddingVertical: theme.spacing.md }}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
