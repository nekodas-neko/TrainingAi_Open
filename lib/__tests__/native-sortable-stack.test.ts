import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import React, { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Item = { id: string; name: string; members: string[] };
type Props = {
  order: string[];
  label: (id: string) => string;
  renderItem: (id: string, handle: ReactNode) => ReactNode;
  onChange: (order: string[]) => void | Promise<unknown>;
};
let SortableStack: ComponentType<Props>;
let root: Root | undefined;
let container: HTMLDivElement;
let errors: unknown[];
let closeDom: () => void;

beforeAll(async () => {
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  closeDom = () => dom.window.close();
  const sourceDir = path.resolve('mobile/src/shared/ui');
  const bundled = await build({
    stdin: {
      contents: readFileSync(path.join(sourceDir, 'SortableStack.tsx'), 'utf8'),
      resolveDir: sourceDir,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [
      {
        name: 'native-host',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(react-native|.*ThemeProvider|.*haptics|\.\/Icon|\.\/useReducedMotion|\.\/ReorderScrollView)$/,
            },
            () => ({ path: 'host', namespace: 'host' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({
            loader: 'js',
            contents: `
        import React from 'react';
        export const View = ({children, accessibilityRole, onAccessibilityAction, testID}) => React.createElement('div', {
          'data-testid': testID,
          ...(accessibilityRole === 'adjustable' ? {role: 'button', onClick: () => onAccessibilityAction({nativeEvent:{actionName:'increment'}})} : {}),
        }, children);
        export const Animated = { Value: class { setValue(){} stopAnimation(){} addListener(){return 'listener'} removeListener(){} } };
        export const AppState = {addEventListener: () => ({remove(){}})};
        export const PanResponder = {create: () => ({panHandlers:{}})};
        export const Platform = {OS:'web'};
        export const AccessibilityInfo = {announceForAccessibility(){}};
        export const useTheme = () => ({theme:{spacing:{md:12,sm:8,xs:4},sizes:{touchTarget:44},radii:{control:12},colors:{brandSurface:'#000',text:'#fff'}}});
        export const useReducedMotion = () => true;
        export const useDragScroll = () => null;
        export const feedback = () => {};
        export const Icon = () => null;
      `,
          }));
        },
      },
    ],
  });
  const bundledModule = { exports: {} as { SortableStack: ComponentType<Props> } };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
    createRequire(import.meta.url),
    bundledModule,
    bundledModule.exports,
  );
  SortableStack = bundledModule.exports.SortableStack;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterAll(() => {
  closeDom?.();
  vi.unstubAllGlobals();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

function render(items: Item[], onChange: Props['onChange'] = () => {}) {
  if (!root) {
    container = document.createElement('div');
    document.body.append(container);
    errors = [];
    root = createRoot(container, { onUncaughtError: (error) => errors.push(error) });
  }
  act(() =>
    root!.render(
      React.createElement(SortableStack, {
        order: items.map((item) => item.id),
        label: (id) => items.find((item) => item.id === id)!.name,
        renderItem: (id, handle) =>
          React.createElement(
            'section',
            null,
            handle,
            items.find((item) => item.id === id)!.members.join(', '),
          ),
        onChange,
      }),
    ),
  );
  expect(errors).toEqual([]);
}

const item = (id: string, members = [id]): Item => ({ id, name: id, members });
const renderedIds = () =>
  [...container.querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid'));

describe('native sortable list renders changing membership', () => {
  it('removes a session or exercise without invoking callbacks for its retired id', () => {
    render([item('a'), item('b'), item('c')]);
    render([item('a'), item('c')]);
    expect(renderedIds()).toEqual(['sortable-a', 'sortable-c']);
    render([]);
    expect(container.textContent).toBe('');
  });

  it('links and unlinks supersets without rendering the previous block ids', () => {
    render([item('a'), item('b'), item('c')]);
    render([item('superset:0', ['a', 'b']), item('c')]);
    expect(container.textContent).toBe('a, bc');
    render([item('a'), item('b'), item('c')]);
    expect(renderedIds()).toEqual(['sortable-a', 'sortable-b', 'sortable-c']);
  });

  it('updates a circuit and then its last remaining member without stale children', () => {
    render([item('superset:0', ['a', 'b', 'c'])]);
    render([item('superset:0', ['a', 'c'])]);
    expect(container.textContent).toBe('a, c');
    render([item('c')]);
    expect(renderedIds()).toEqual(['sortable-c']);
  });

  it('renders newly added and AI-replaced sessions in the same render', () => {
    render([item('a'), item('b')]);
    render([item('new-b'), item('new-a'), item('new-c')]);
    expect(renderedIds()).toEqual(['sortable-new-b', 'sortable-new-a', 'sortable-new-c']);
    render([item('new-c'), item('new-a'), item('new-b')]);
    expect(renderedIds()).toEqual(['sortable-new-c', 'sortable-new-a', 'sortable-new-b']);
  });

  it('keeps optimistic reordering until its acknowledgement without losing parent replacements', async () => {
    const onChange = vi.fn(async () => {});
    render([item('a'), item('b')], onChange);
    await act(async () => container.querySelector<HTMLElement>('[role="button"]')!.click());
    expect(onChange).toHaveBeenCalledWith(['b', 'a']);
    expect(renderedIds()).toEqual(['sortable-b', 'sortable-a']);
    render([item('new-a')], onChange);
    expect(renderedIds()).toEqual(['sortable-new-a']);
  });
});
