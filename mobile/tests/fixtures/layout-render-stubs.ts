// Stand-ins for the React Native layer that keep every `style` a component passes, as data on a
// plain element, so a test can read the rendered tree's resolved styles. react-dom/server does no
// layout: this shows which box carries which style key, not how the phone draws it.
import { createElement as h, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };

/** Flattens a style value (array, nested arrays, falsy entries) the way React Native does. */
export function flatten(style: unknown, into: Record<string, unknown> = {}) {
  if (Array.isArray(style)) style.forEach((item) => flatten(item, into));
  else if (style && typeof style === 'object') Object.assign(into, style);
  return into;
}
const resolve = (style: unknown) =>
  JSON.stringify(flatten(typeof style === 'function' ? style({ pressed: false }) : style));

const box = (tag: string, name: string) => (props: Props) =>
  h(tag, { 'data-ui': name, 'data-style': resolve(props.style) }, props.children);

class Value {
  setValue() {}
  stopAnimation() {}
}
export const Animated = {
  View: box('div', 'Animated.View'),
  Value,
  spring: () => ({ start() {} }),
};
export const Platform = { OS: 'android' };
export const Pressable = box('div', 'Pressable');
export const useReducedMotion = () => false;

export const Stack = ({ direction, style, children }: Props) =>
  h('div', { 'data-ui': 'Stack', 'data-direction': direction ?? 'column', 'data-style': resolve(style) }, children);
export const AppText = ({ children }: Props) => h('span', { 'data-ui': 'AppText' }, children);
export const AppButton = ({ title }: Props) => h('button', { 'data-ui': 'AppButton' }, title as string);
export const SessionGlyph = () => h('i', { 'data-ui': 'SessionGlyph' });
export const useTheme = () => ({
  theme: {
    radii: { control: 8 },
    colors: { background: '#000000', muted: '#888888' },
    spacing: { sm: 8, md: 12 },
    sizes: { iconCompact: 20 },
  },
});

/** The rendered markup as a tree, so a test can ask who sits inside whom. */
export type Node = { ui: string; style: Record<string, unknown>; direction?: string; text: string; children: Node[]; parent?: Node };
export function parse(markup: string): Node {
  const root: Node = { ui: 'root', style: {}, text: '', children: [] };
  let at = root;
  for (const token of markup.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith('</')) {
      if (at.parent) at = at.parent;
    } else if (token.startsWith('<')) {
      const attr = (name: string) => token.match(new RegExp(`${name}="([^"]*)"`))?.[1];
      const node: Node = {
        ui: attr('data-ui') ?? 'html',
        style: JSON.parse((attr('data-style') ?? '{}').replaceAll('&quot;', '"')),
        direction: attr('data-direction'),
        text: '',
        children: [],
        parent: at,
      };
      at.children.push(node);
      at = node;
    } else at.text += token;
  }
  return root;
}
export const find = (node: Node, test: (n: Node) => boolean): Node[] =>
  [...(test(node) ? [node] : []), ...node.children.flatMap((child) => find(child, test))];
export const ancestors = (node: Node): Node[] => (node.parent ? [node.parent, ...ancestors(node.parent)] : []);
