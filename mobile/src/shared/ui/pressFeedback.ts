/**
 * The one pressed look (#3759): a pressable dims to PRESSED_OPACITY while a finger is on it.
 * The shared `Pressable` applies it by default, so a feature never sets a pressed opacity itself.
 */
export const PRESSED_OPACITY = 0.8;

/** `none` is for a control whose own state already changes on press, and for drag surfaces. */
export type PressFeedback = 'dim' | 'none';

type PressState = { pressed: boolean };
type StyleProp<S extends PressState> = unknown | ((state: S) => unknown);

const resolve = <S extends PressState>(style: StyleProp<S>, state: S) =>
  typeof style === 'function' ? (style as (state: S) => unknown)(state) : style;

/** The opacity a style ends up with; in an array the last one set wins, as React Native reads it. */
function opacityOf(style: unknown): unknown {
  if (Array.isArray(style))
    return style.reduce<unknown>((found, item) => opacityOf(item) ?? found, undefined);
  return style && typeof style === 'object' ? (style as { opacity?: unknown }).opacity : undefined;
}

/**
 * The caller's style with the pressed dim added. A style that already changes its opacity when
 * pressed is the caller's own pressed look and is returned untouched. A fixed opacity (a card
 * drawn at 0.6, say) is dimmed in proportion.
 */
export function withPressedOpacity<S extends PressState>(style: StyleProp<S>) {
  return (state: S) => {
    const own = resolve(style, state);
    if (!state.pressed) return own;
    const pressed = opacityOf(own);
    const resting = opacityOf(resolve(style, { ...state, pressed: false }));
    if (pressed !== resting || (pressed != null && typeof pressed !== 'number')) return own;
    return [own, { opacity: (pressed ?? 1) * PRESSED_OPACITY }];
  };
}

/** A press only dims something that answers it: enabled, with a press or long press of its own. */
export function dimsOnPress(props: {
  feedback?: PressFeedback;
  disabled?: boolean | null;
  onPress?: unknown;
  onLongPress?: unknown;
}) {
  return (
    props.feedback !== 'none' &&
    !props.disabled &&
    (props.onPress != null || props.onLongPress != null)
  );
}
