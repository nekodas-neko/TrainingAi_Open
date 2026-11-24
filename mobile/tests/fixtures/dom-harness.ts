// A DOM for the tests that run real Sheet / ScreenBoundary code (#4099): jsdom, react-dom and
// react-native-web. jsdom and react-dom are devDependencies of this project, so a missing one is an
// import error that fails the file; nothing here skips.
import { createRequire, registerHooks } from 'node:module';

export type Redirect = { from: string; specifiers: string[]; to: string };
export type Dom = {
  act: (fn: () => Promise<unknown> | void) => Promise<void>;
  root: { render(element: unknown): void };
  h: (...args: unknown[]) => unknown;
  Activity: unknown;
  wait: (ms: number) => Promise<void>;
  click: (text: string) => Promise<void>;
};
export const here = (path: string) => new URL(path, import.meta.url).href;

export async function loadDom(redirects: Redirect[]): Promise<Dom> {
  const rnw = createRequire(import.meta.url).resolve('react-native-web');
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'react-native') return { url: `file://${rnw}`, shortCircuit: true };
      for (const r of redirects)
        if (context.parentURL === r.from && r.specifiers.includes(specifier))
          return { url: r.to, shortCircuit: true };
      return next(specifier, context);
    },
  });
  // A variable specifier: this directory has no types for jsdom.
  const jsdom = 'jsdom';
  const { JSDOM } = (await import(jsdom)) as { JSDOM: new (html: string, options: object) => { window: any } };
  const w = new JSDOM('<!doctype html><div id=root></div>', { pretendToBeVisual: true }).window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: w.HTMLElement,
    Element: w.Element,
    Node: w.Node,
    ShadowRoot: w.ShadowRoot,
    MutationObserver: w.MutationObserver,
    getComputedStyle: w.getComputedStyle.bind(w),
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
  });
  const warn = console.warn;
  console.warn = () => {};
  const React = await import('react');
  // A variable specifier: this directory has no types for react-dom.
  const client = 'react-dom/client';
  const { createRoot } = (await import(client)) as { createRoot: (node: unknown) => Dom['root'] };
  const act = (React as unknown as { act: Dom['act'] }).act;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const dom: Dom = {
    act,
    root: createRoot(w.document.getElementById('root')),
    h: React.createElement as Dom['h'],
    Activity: (React as unknown as { Activity: unknown }).Activity,
    wait,
    async click(text) {
      const target = [...w.document.querySelectorAll('button')].find((b) => b.textContent === text);
      if (!target) throw new Error(`no button "${text}"`);
      await act(async () => {
        target.click();
        await wait(0);
      });
    },
  };
  console.warn = warn;
  return dom;
}
