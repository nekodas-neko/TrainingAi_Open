import { useMemo, useState, type PropsWithChildren } from 'react';
import { PanResponder, View } from 'react-native';
import {
  AppButton,
  AppText,
  ColorSwatches,
  Icon,
  IconButton,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHome } from '../data/HomeProvider';
import { homeSections, moveHomeSection, sectionLabels } from '../data/models';
export type SectionBounds = { y: number; height: number };
export function HomeSection({
  id,
  editing,
  bounds,
  onLayout,
  children,
}: {
  id: string;
  editing: boolean;
  bounds: Map<string, SectionBounds>;
  onLayout: (id: string, bounds: SectionBounds) => void;
  children: PropsWithChildren['children'];
}) {
  const { theme } = useTheme();
  const home = useHome();
  const [colors, setColors] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const order = homeSections(home.preferences);
  const index = order.indexOf(id);
  async function save(patch: Partial<typeof home.preferences>) {
    try {
      await home.store?.savePreferences(patch);
      setError(null);
    } catch {
      setError('Could not save your layout on this phone.');
    }
  }
  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => editing,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderRelease: (_, gesture) => {
          setDragging(false);
          const start = bounds.get(id);
          if (!start) {
            return;
          }
          const position = start.y + start.height / 2 + gesture.dy;
          const target = [...bounds]
            .filter(
              ([key]) =>
                order.includes(key) && !home.preferences.homeHiddenSections?.includes(key),
            )
            .sort(
              (a, b) =>
                Math.abs(a[1].y + a[1].height / 2 - position) -
                Math.abs(b[1].y + b[1].height / 2 - position),
            )[0]?.[0];
          if (target && target !== id) {
            const next = [...order];
            next.splice(index, 1);
            next.splice(order.indexOf(target), 0, id);
            void save({ homeSectionOrder: next });
          }
        },
        onPanResponderTerminate: () => setDragging(false),
      }),
    [editing, id, order.join('|'), home.preferences.homeHiddenSections?.join('|'), bounds],
  );
  const keys =
    id === 'streak'
      ? ['streakLeft', 'streakRight']
      : id === 'recommendation'
        ? ['recommendedToday']
        : id.startsWith('card_')
          ? [id.slice(5)]
          : id === 'metricTiles'
            ? (home.preferences.homeWidgets ?? ['weightKg', 'steps', 'calories'])
            : [];
  return (
    <View
      onLayout={(event) => onLayout(id, event.nativeEvent.layout)}
      style={{ gap: theme.spacing.xs, opacity: dragging ? 0.6 : 1 }}
    >
      {editing && (
        <Stack direction="row" align="center" gap="xs">
          <View
            {...drag.panHandlers}
            accessibilityRole="button"
            accessibilityLabel={`Drag ${sectionLabels[id]}`}
            style={{
              minWidth: theme.sizes.touchTarget,
              minHeight: theme.sizes.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="layout" tone="muted" />
          </View>
          <AppText variant="caption" style={{ flex: 1 }}>
            {sectionLabels[id]}
          </AppText>
          <IconButton
            icon="up"
            label={`Move ${sectionLabels[id]} up`}
            disabled={index === 0}
            onPress={() => void save({ homeSectionOrder: moveHomeSection(order, id, -1) })}
          />
          <IconButton
            icon="down"
            label={`Move ${sectionLabels[id]} down`}
            disabled={index === order.length - 1}
            onPress={() => void save({ homeSectionOrder: moveHomeSection(order, id, 1) })}
          />
          {keys.length > 0 && (
            <IconButton
              icon="settings"
              label={`Colour ${sectionLabels[id]}`}
              onPress={() => setColors(!colors)}
            />
          )}
          <IconButton
            icon="close"
            label={`Hide ${sectionLabels[id]}`}
            onPress={() =>
              void save({
                homeHiddenSections: [...(home.preferences.homeHiddenSections ?? []), id],
              })
            }
          />
        </Stack>
      )}
      {editing &&
        colors &&
        keys.map((key) => (
          <ColorSwatches
            key={key}
            label={`${key === 'streakLeft' ? 'Streak' : key === 'streakRight' ? 'This Week' : sectionLabels[id]} colour`}
            value={
              id === 'metricTiles'
                ? home.preferences.pillColors?.[key]
                : home.preferences.cardColors?.[key]
            }
            onChange={(color) =>
              void save(
                id === 'metricTiles'
                  ? { pillColors: { ...home.preferences.pillColors, [key]: color } }
                  : { cardColors: { ...home.preferences.cardColors, [key]: color } },
              )
            }
          />
        ))}
      <View pointerEvents={editing ? 'none' : 'auto'}>{children}</View>
      {error && <StatusIndicator label="Home layout" error={error} />}
    </View>
  );
}
export function HiddenHomeSections() {
  const home = useHome();
  const hidden = home.preferences.homeHiddenSections ?? [];
  if (!hidden.length) {
    return null;
  }
  return (
    <Stack>
      <AppText variant="eyebrow" tone="muted">
        Hidden sections
      </AppText>
      {hidden.map((id) => (
        <AppButton
          key={id}
          title={`Show ${sectionLabels[id] ?? id}`}
          variant="surface"
          onPress={() =>
            void home.store?.savePreferences({
              homeHiddenSections: hidden.filter((key) => key !== id),
            })
          }
        />
      ))}
    </Stack>
  );
}
