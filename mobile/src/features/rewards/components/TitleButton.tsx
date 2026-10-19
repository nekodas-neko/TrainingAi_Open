import { useState } from 'react';
import { Pressable } from 'react-native';
import { AppText, Icon } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { titleName } from '../data/view';
import { titleIcon } from './titleIcons';
import { TitlePickerSheet } from './TitlePickerSheet';

/** Under the name on More › Profile: the equipped title, or the prompt to set one. */
export function TitleButton({
  equipped,
  unlockedIds,
}: {
  equipped: string | null;
  unlockedIds: string[];
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const name = titleName(equipped);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name ? `Title: ${name}. Change title` : 'Set title'}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.xs,
          minHeight: theme.sizes.touchTarget,
          paddingHorizontal: theme.spacing.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {name && equipped ? (
          <>
            <Icon
              name={titleIcon(equipped)}
              size={theme.sizes.iconCompact}
              tone="brand"
            />
            <AppText variant="subheading" tone="brand">
              {name}
            </AppText>
          </>
        ) : (
          <AppText variant="caption" tone="muted">
            Tap to set title
          </AppText>
        )}
      </Pressable>
      <TitlePickerSheet
        visible={open}
        equipped={equipped}
        unlockedIds={unlockedIds}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
