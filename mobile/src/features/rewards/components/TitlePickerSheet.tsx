import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { availableTitles } from '@trainingai/shared/achievement-display';
import { AppText, Icon, Sheet, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { feedback } from '../../../integrations/feedback/haptics';
import { useEquipTitle } from '../data/useRewards';
import { titleIcon } from './titleIcons';

/** The current app's Equip Title sheet: the titles earned, one tap to equip, and a way to clear it. */
export function TitlePickerSheet({
  visible,
  equipped,
  unlockedIds,
  onClose,
}: {
  visible: boolean;
  equipped: string | null;
  unlockedIds: string[];
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const equip = useEquipTitle();
  // The id being saved, or '__none__' while clearing. Every row is off while one is in flight.
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (visible) setFailed(false);
  }, [visible]);
  const titles = availableTitles(unlockedIds);
  async function choose(titleId: string | null) {
    if (saving) return;
    setSaving(titleId ?? '__none__');
    setFailed(false);
    const saved = await equip(titleId);
    setSaving(null);
    if (saved) {
      feedback('success');
      onClose();
    } else {
      setFailed(true);
    }
  }
  const row = (equippedRow: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.md,
    minHeight: theme.sizes.touchTarget,
    borderRadius: theme.radii.control,
    borderWidth: 1,
    borderColor: equippedRow ? theme.colors.brand : theme.colors.border,
    backgroundColor: equippedRow ? theme.colors.brandSurface : 'transparent',
    padding: theme.spacing.md,
  });
  const circle = {
    width: theme.sizes.foodThumbnail,
    height: theme.sizes.foodThumbnail,
    borderRadius: theme.radii.pill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  return (
    <Sheet visible={visible} title="Equip Title" onClose={onClose}>
      <Stack gap="sm">
        {equipped && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="No title. Remove equipped title"
            disabled={!!saving}
            onPress={() => void choose(null)}
            style={[
              row(false),
              { backgroundColor: theme.colors.raised, opacity: saving ? 0.6 : 1 },
            ]}
          >
            <View style={[circle, { backgroundColor: theme.colors.track }]}>
              <AppText variant="heading" tone="muted">
                —
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="subheading" tone="muted">
                No Title
              </AppText>
              <AppText variant="caption" tone="muted">
                Remove equipped title
              </AppText>
            </View>
          </Pressable>
        )}
        {titles.length === 0 ? (
          <AppText
            tone="muted"
            style={{ textAlign: 'center', paddingVertical: theme.spacing.xxl }}
          >
            Unlock achievements to earn titles
          </AppText>
        ) : (
          titles.map(([id, def]) => {
            const isEquipped = equipped === id;
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={
                  isEquipped ? `${def.display}, equipped` : `Equip ${def.display}`
                }
                disabled={!!saving || isEquipped}
                onPress={() => void choose(id)}
                style={[row(isEquipped), { opacity: saving && !isEquipped ? 0.6 : 1 }]}
              >
                <View style={[circle, { backgroundColor: theme.colors.brandSurface }]}>
                  <Icon
                    name={titleIcon(id)}
                    size={theme.sizes.iconCompact}
                    tone="brand"
                  />
                </View>
                <AppText
                  variant="subheading"
                  tone={isEquipped ? 'brand' : 'text'}
                  style={{ flex: 1 }}
                >
                  {def.display}
                </AppText>
                {isEquipped && (
                  <View
                    style={{
                      borderRadius: theme.radii.pill,
                      backgroundColor: theme.colors.brand,
                      paddingHorizontal: theme.spacing.sm,
                      paddingVertical: theme.spacing.xxs,
                    }}
                  >
                    <AppText
                      variant="caption"
                      style={{ color: theme.colors.onBrand, fontWeight: '700' }}
                    >
                      Equipped
                    </AppText>
                  </View>
                )}
              </Pressable>
            );
          })
        )}
        {failed && (
          <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
            Failed to equip title
          </AppText>
        )}
      </Stack>
    </Sheet>
  );
}
