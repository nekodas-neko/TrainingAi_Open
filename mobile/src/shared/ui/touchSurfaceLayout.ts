/**
 * Which of a TouchSurface caller's style keys place the surface in its parent. TouchSurface draws
 * an `Animated.View` (for the press scale) around the `Pressable`, so the wrapper is the parent's
 * child: a key that positions the surface has to land on it, not on the Pressable inside (#4067).
 */
const OUTER_KEYS = new Set([
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'width',
  'minWidth',
  'maxWidth',
  'margin',
  'marginHorizontal',
  'marginVertical',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginStart',
  'marginEnd',
]);

type Style = Record<string, unknown>;

function flatten(style: unknown, into: Style = {}): Style {
  if (Array.isArray(style)) style.forEach((item) => flatten(item, into));
  else if (style && typeof style === 'object') Object.assign(into, style);
  return into;
}

/**
 * The `flex` shorthand as a grow/shrink pair on an auto basis. A zero basis (what `flex: 1` means
 * to React Native) would make the wrapper collapse inside a parent whose size comes from its
 * content, which is how the Grid cells and the AI Periodization row are laid out.
 */
function expandFlex(flex: number): Style {
  return flex > 0 ? { flexGrow: flex, flexShrink: 1 } : { flexGrow: 0, flexShrink: flex < 0 ? 1 : 0 };
}

/** Splits a caller's static style into what sits on the wrapper and what stays on the Pressable. */
export function splitTouchSurfaceStyle(style: unknown): { outer: Style; inner: Style } {
  const outer: Style = {};
  const inner: Style = {};
  for (const [key, value] of Object.entries(flatten(style))) {
    if (key === 'flex' && typeof value === 'number') Object.assign(outer, expandFlex(value));
    else if (OUTER_KEYS.has(key)) outer[key] = value;
    else inner[key] = value;
  }
  return { outer, inner };
}
