import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  PanResponder,
  Platform,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { feedback } from '../../integrations/feedback/haptics';
import { Icon } from './Icon';
import { useReducedMotion } from './useReducedMotion';
import { useDragScroll } from './ReorderScrollView';
import { dragOrder, displacedItems, moveItem, type ItemBounds } from './reorder';

type DragState = {
  id: string;
  start: string[];
  next: string[];
  dy: number;
  scroll: number;
  bounds: Map<string, ItemBounds>;
};
export function SortableStack({
  order,
  label,
  renderItem,
  onChange,
  enabled = true,
  gap,
}: {
  order: string[];
  label: (id: string) => string;
  renderItem: (id: string, handle: ReactNode) => ReactNode;
  onChange: (order: string[]) => void | Promise<unknown>;
  enabled?: boolean;
  gap?: number;
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const scroll = useDragScroll();
  const spacing = gap ?? theme.spacing.md;
  const bounds = useRef(new Map<string, ItemBounds>());
  const offsets = useRef(new Map<string, Animated.Value>());
  const drag = useRef<DragState | null>(null);
  const dropAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const session = useRef(0);
  const mounted = useRef(true);
  const committing = useRef(false);
  const [active, setActive] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState(order);
  const latest = useRef({ order: localOrder, saved: order, onChange, label });
  latest.current = { order: localOrder, saved: order, onChange, label };
  function offset(id: string) {
    let value = offsets.current.get(id);
    if (!value) {
      value = new Animated.Value(0);
      offsets.current.set(id, value);
    }
    return value;
  }
  function update(dy: number) {
    const current = drag.current;
    if (!current) return;
    current.dy = dy;
    const distance = dy + current.scroll;
    offset(current.id).setValue(distance);
    const next = dragOrder(current.start, current.bounds, current.id, distance);
    if (next.join('|') === current.next.join('|')) return;
    current.next = next;
    feedback();
    for (const [id, shift] of displacedItems(current.start, next, current.bounds, spacing)) {
      if (id === current.id) continue;
      const value = offset(id);
      value.stopAnimation();
      if (reduced) value.setValue(shift);
      else
        Animated.spring(value, {
          toValue: shift,
          speed: 32,
          bounciness: 0,
          useNativeDriver: false,
        }).start();
    }
  }
  const saving = useRef(false);
  async function commit(next: string[]) {
    saving.current = true;
    committing.current = true;
    try {
      const result = await latest.current.onChange(next);
      if (mounted.current && result === false) setLocalOrder(latest.current.saved);
    } catch {
      if (mounted.current) setLocalOrder(latest.current.saved);
    } finally {
      committing.current = false;
      saving.current = false;
    }
  }
  function finish(cancelled = false) {
    const current = drag.current;
    if (!current) return;
    const token = session.current;
    drag.current = null;
    scroll?.end();
    saving.current = true;
    const changed = !cancelled && current.start.join('|') !== current.next.join('|');
    const next = changed ? current.next : current.start;
    const complete = () => {
      if (!mounted.current || token !== session.current) return;
      dropAnimation.current = null;
      setLocalOrder([...next]);
      setActive(null);
      if (!changed) {
        saving.current = false;
        return;
      }
      AccessibilityInfo.announceForAccessibility(
        `${latest.current.label(current.id)}, position ${next.indexOf(current.id) + 1} of ${next.length}`,
      );
      void commit(next);
    };
    if (reduced) {
      complete();
      return;
    }
    const destinations = displacedItems(current.start, next, current.bounds, spacing);
    dropAnimation.current = Animated.parallel(
      [...destinations].map(([id, shift]) =>
        Animated.spring(offset(id), {
          toValue: shift,
          speed: 32,
          bounciness: 0,
          useNativeDriver: false,
        }),
      ),
    );
    dropAnimation.current.start(complete);
  }

  function cancel() {
    session.current++;
    dropAnimation.current?.stop();
    dropAnimation.current = null;
    if (drag.current || active) scroll?.end();
    drag.current = null;
    for (const value of offsets.current.values()) {
      value.stopAnimation();
      value.setValue(0);
    }
    if (!committing.current) saving.current = false;
    if (mounted.current) setActive(null);
  }
  const methods = useRef({ update, finish, cancel });
  methods.current = { update, finish, cancel };
  const signature = order.join('|');
  useEffect(() => {
    methods.current.cancel();
    setLocalOrder(latest.current.saved);
  }, [signature]);
  useEffect(() => {
    if (!enabled) methods.current.cancel();
  }, [enabled]);
  useEffect(() => {
    mounted.current = true;
    methods.current.cancel();
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') methods.current.cancel();
    });
    return () => {
      listener.remove();
      mounted.current = false;
      methods.current.cancel();
    };
  }, []);
  return (
    <View collapsable={false} style={{ gap: spacing }}>
      {localOrder.map((id) => (
        <SortableItem
          key={id}
          id={id}
          label={label(id)}
          position={localOrder.indexOf(id) + 1}
          total={localOrder.length}
          enabled={enabled}
          active={active === id}
          moving={active !== null}
          offset={offset(id)}
          onLayout={(layout) => {
            const before = drag.current?.bounds.get(id);
            if (before && (before.height !== layout.height || before.y !== layout.y))
              methods.current.cancel();
            bounds.current.set(id, layout);
          }}
          onBegin={(pageY) => {
            if (drag.current || saving.current) return;
            session.current++;
            for (const value of offsets.current.values()) {
              value.stopAnimation();
              value.setValue(0);
            }
            const start = [...latest.current.order];
            drag.current = {
              id,
              start,
              next: start,
              dy: 0,
              scroll: 0,
              bounds: new Map(bounds.current),
            };
            setActive(id);
            feedback('impact');
            scroll?.begin(pageY, (delta) => {
              if (!drag.current) return;
              drag.current.scroll = delta;
              methods.current.update(drag.current.dy);
            });
          }}
          onMove={(dy, pageY) => {
            scroll?.move(pageY);
            methods.current.update(dy);
          }}
          onEnd={(cancelled) => methods.current.finish(cancelled)}
          onAccessibleMove={(direction) => {
            if (!enabled || saving.current) return;
            const items = latest.current.order;
            const target = items[items.indexOf(id) + direction];
            if (!target) return;
            const next = moveItem(items, id, target);
            setLocalOrder(next);
            void commit(next);
            AccessibilityInfo.announceForAccessibility(
              `${label(id)}, position ${next.indexOf(id) + 1} of ${next.length}`,
            );
          }}
          render={(handle) => renderItem(id, handle)}
        />
      ))}
    </View>
  );
}
function SortableItem({
  id,
  label,
  position,
  total,
  enabled,
  active,
  moving,
  offset,
  onLayout,
  onBegin,
  onMove,
  onEnd,
  onAccessibleMove,
  render,
}: {
  id: string;
  label: string;
  position: number;
  total: number;
  enabled: boolean;
  active: boolean;
  moving: boolean;
  offset: Animated.Value;
  onLayout: (bounds: ItemBounds) => void;
  onBegin: (pageY: number) => void;
  onMove: (dy: number, pageY: number) => void;
  onEnd: (cancelled: boolean) => void;
  onAccessibleMove: (direction: -1 | 1) => void;
  render: (handle: ReactNode) => ReactNode;
}) {
  const { theme } = useTheme();
  const callbacks = useRef({ enabled, onBegin, onMove, onEnd });
  callbacks.current = { enabled, onBegin, onMove, onEnd };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => callbacks.current.enabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => callbacks.current.onBegin(event.nativeEvent.pageY),
        onPanResponderMove: (_, gesture) => callbacks.current.onMove(gesture.dy, gesture.moveY),
        onPanResponderRelease: () => callbacks.current.onEnd(false),
        onPanResponderTerminate: () => callbacks.current.onEnd(true),
      }),
    [],
  );
  const handle = (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${label}`}
      accessibilityValue={{
        min: 1,
        max: total,
        now: position,
        text: `Position ${position} of ${total}`,
      }}
      accessibilityState={{ disabled: !enabled }}
      accessibilityHint="Drag to move. Swipe up or down to reorder with VoiceOver."
      accessibilityActions={[
        { name: 'increment', label: 'Move later' },
        { name: 'decrement', label: 'Move earlier' },
      ]}
      onAccessibilityAction={(event) =>
        onAccessibleMove(event.nativeEvent.actionName === 'increment' ? 1 : -1)
      }
      style={{
        width: theme.sizes.touchTarget,
        height: theme.sizes.touchTarget,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radii.control,
        backgroundColor: active ? theme.colors.brandSurface : 'transparent',
        ...(Platform.OS === 'web'
          ? {
              touchAction: 'none' as const,
            }
          : {}),
      }}
    >
      <Icon name="grip" tone={active ? 'brand' : 'muted'} />
    </View>
  );
  return (
    <View
      collapsable={false}
      testID={`sortable-${id}`}
      onLayout={(event) => onLayout(event.nativeEvent.layout)}
      style={{ zIndex: active ? 10 : 0 }}
    >
      <DragPosition offset={offset} moving={moving} active={active}>
        {render(handle)}
      </DragPosition>
    </View>
  );
}
function DragPosition({
  offset,
  moving,
  active,
  children,
}: {
  offset: Animated.Value;
  moving: boolean;
  active: boolean;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  const [position, setPosition] = useState(0);
  useEffect(() => {
    const listener = offset.addListener(({ value }) => setPosition(value));
    return () => offset.removeListener(listener);
  }, [offset]);
  return (
    <View
      collapsable={false}
      style={{
        opacity: active ? 0.95 : 1,
        transform: [{ translateY: moving ? position : 0 }],
        ...(active
          ? {
              shadowColor: theme.colors.text,
              shadowOpacity: 0.15,
              shadowRadius: theme.spacing.sm,
              shadowOffset: { width: 0, height: theme.spacing.xs },
              elevation: 8,
            }
          : {}),
      }}
    >
      {children}
    </View>
  );
}
