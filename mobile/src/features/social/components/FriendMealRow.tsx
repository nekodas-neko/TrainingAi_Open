import { View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { AppButton, AppText, Badge, Icon, ListRow, Stack } from '../../../shared/ui';
import { friendMealSubtitle, type FriendMeal } from '../data/friend-meals';

/**
 * One meal in a friend's library (#2218): its name and per-portion figures, the whole ingredient
 * list when opened, and the button that copies it into the viewer's own meals. A meal the viewer
 * already has by name is marked and offers "Add again" (a second copy), so the mark is a hint and
 * never a block.
 */
export function FriendMealRow({
  entry,
  open,
  have,
  busy,
  disabled,
  onToggle,
  onAdd,
}: {
  entry: FriendMeal;
  open: boolean;
  have: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onAdd: () => void;
}) {
  const { theme } = useTheme();
  const { meal } = entry;
  const action = have ? 'Add again' : 'Add to my meals';
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <ListRow
        divider={false}
        density="compact"
        title={meal.name}
        subtitle={friendMealSubtitle(meal)}
        expanded={open}
        onPress={onToggle}
        trailing={<Icon name={open ? 'up' : 'down'} tone="muted" />}
      />
      {open && (
        <Stack
          gap="xs"
          style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}
        >
          {meal.ingredients.map((ingredient, index) => (
            <Stack key={index} direction="row" justify="space-between" gap="md">
              <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
                {ingredient.name}
              </AppText>
              <AppText variant="caption" tone="muted">
                {Math.round(ingredient.weightG).toLocaleString()} g
              </AppText>
            </Stack>
          ))}
        </Stack>
      )}
      <Stack
        direction="row"
        justify="space-between"
        align="center"
        style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md }}
      >
        {have ? <Badge label="In your meals" tone="brand" /> : <View />}
        <AppButton
          title={action}
          icon="plus"
          variant={have ? 'surface' : 'secondary'}
          accessibilityLabel={`${action}: ${meal.name}`}
          busy={busy}
          disabled={disabled}
          onPress={onAdd}
        />
      </Stack>
    </View>
  );
}
