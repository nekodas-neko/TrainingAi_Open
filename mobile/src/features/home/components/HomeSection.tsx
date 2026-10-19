import { useUndo } from '../../../shared/ui/undo/UndoProvider';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { layoutMotion } from '../../../shared/ui/layoutMotion';
import { feedback } from '../../../integrations/feedback/haptics';
import { useCallback, useMemo, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import {
  AppButton,
  ActionMenu,
  AppText,
  ColorSwatches,
  IconButton,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHome } from '../data/HomeProvider';
import { homeSections, moveHomeSection, sectionLabels } from '../data/models';
import { failureNotice } from '../../../core/reporting/index.ts';
export function HomeSection({
  id,
  editing,
  dragHandle,
  onEdit,
  children,
}: {
  id: string;
  editing: boolean;
  dragHandle?: ReactNode;
  onEdit?: () => void;
  children: PropsWithChildren['children'];
}) {
  const { theme } = useTheme();
  const home = useHome();
  const undo = useUndo();
  const reduced = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [colors, setColors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const order = useMemo(() => homeSections(home.preferences), [home.preferences]);
  const index = order.indexOf(id);
  async function save(patch: Partial<typeof home.preferences>) {
    try {
      layoutMotion(reduced);
      await home.store?.savePreferences(patch);
      setError(null);
    } catch (failure) {
      setError(failureNotice('Could not save your layout on this phone.', failure));
    }
  }
  const reorder = useCallback(
    (next: string[]) => {
      const store = home.store;
      if (!store) return;
      const previous = homeSections(store.getSnapshot().preferences);
      void undo.perform({
        key: 'home-order',
        showNotice: false,
        label: 'Dashboard reordered',
        apply: async () => {
          layoutMotion(reduced);
          await store.savePreferences({ homeSectionOrder: next });
          feedback();
        },
        revert: async () => {
          layoutMotion(reduced);
          await store.savePreferences({ homeSectionOrder: previous });
        },
      });
    },
    [home.store, undo, reduced],
  );
  function hide() {
    const store = home.store;
    if (!store) return;
    void undo.perform({
      key: `home-hide:${id}`,
      label: `${sectionLabels[id]} hidden`,
      apply: async () => {
        layoutMotion(reduced);
        await store.savePreferences({
          homeHiddenSections: [
            ...new Set([...(store.getSnapshot().preferences.homeHiddenSections ?? []), id]),
          ],
        });
      },
      revert: async () => {
        layoutMotion(reduced);
        await store.savePreferences({
          homeHiddenSections: (store.getSnapshot().preferences.homeHiddenSections ?? []).filter(
            (key) => key !== id,
          ),
        });
      },
    });
  }
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
    <>
      <View style={{ gap: theme.spacing.xs }}>
        {editing && (
          <Stack direction="row" align="center" gap="xs">
            {dragHandle}
            <AppText variant="caption" style={{ flex: 1 }}>
              {sectionLabels[id]}
            </AppText>
            {keys.length > 0 && (
              <IconButton
                icon="settings"
                label={`Colour ${sectionLabels[id]}`}
                onPress={() => setColors(!colors)}
              />
            )}
            <IconButton icon="close" label={`Hide ${sectionLabels[id]}`} onPress={hide} />
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
        <Pressable
          accessible={false}
          delayLongPress={350}
          onLongPress={() => {
            if (!editing) {
              feedback('impact');
              setMenu(true);
            }
          }}
        >
          <View pointerEvents={editing ? 'none' : 'auto'}>{children}</View>
        </Pressable>
        {error && <StatusIndicator label="Home layout" error={error} />}
      </View>
      {menu && (
        <ActionMenu
          visible
          title={sectionLabels[id] ?? 'Widget'}
          onClose={() => setMenu(false)}
          actions={[
            { title: 'Customize dashboard', icon: 'layout', run: () => onEdit?.() },
            {
              title: 'Move earlier',
              icon: 'up',
              disabled: index === 0,
              run: () => reorder(moveHomeSection(order, id, -1)),
            },
            {
              title: 'Move later',
              icon: 'down',
              disabled: index === order.length - 1,
              run: () => reorder(moveHomeSection(order, id, 1)),
            },
            { title: 'Hide widget', icon: 'close', run: hide },
          ]}
        />
      )}
    </>
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
