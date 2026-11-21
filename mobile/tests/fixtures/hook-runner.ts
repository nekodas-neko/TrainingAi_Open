// A `react` stand-in that runs one hook the way React commits it: on each render, layout effects
// (their cleanups first) run inside the commit, then passive cleanups and passive effects after it.
// Enough to test effect ordering in a hook without a renderer.
type Effect = { deps?: unknown[]; run?: () => void | (() => void); cleanup?: void | (() => void) };
let slots: unknown[] = [];
let cursor = 0;
let layout: Effect[] = [];
let passive: Effect[] = [];
let pendingLayout: number[] = [];
let pendingPassive: number[] = [];

const changed = (a: unknown[] | undefined, b: unknown[] | undefined) =>
  !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

function slot<T>(make: () => T): { value: T } {
  const index = cursor++;
  if (!(index in slots)) slots[index] = { value: make() };
  return slots[index] as { value: T };
}
export function useState<T>(initial: T | (() => T)): [T, (next: T) => void] {
  const held = slot(() => (typeof initial === 'function' ? (initial as () => T)() : initial));
  return [held.value, (next) => void (held.value = next)];
}
export function useRef<T>(initial: T) {
  return slot(() => ({ current: initial })).value;
}
export function useMemo<T>(make: () => T, deps: unknown[]): T {
  const held = slot(() => ({ deps: undefined as unknown[] | undefined, value: undefined as T }));
  if (changed(held.value.deps, deps)) held.value = { deps, value: make() };
  return held.value.value;
}
function effect(list: Effect[], pending: number[], run: Effect['run'], deps?: unknown[]) {
  const index = cursor++;
  const known = list[index];
  if (!known) {
    list[index] = { deps, run };
    pending.push(index);
  } else if (changed(known.deps, deps)) {
    known.deps = deps;
    known.run = run;
    pending.push(index);
  }
}
export const useLayoutEffect = (run: Effect['run'], deps?: unknown[]) =>
  effect(layout, pendingLayout, run, deps);
export const useEffect = (run: Effect['run'], deps?: unknown[]) =>
  effect(passive, pendingPassive, run, deps);

function flush(list: Effect[], pending: number[]) {
  for (const index of pending) list[index].cleanup?.();
  for (const index of pending) list[index].cleanup = list[index].run?.();
  pending.length = 0;
}

/** Renders `hook` once more, committing as React does; returns what it returned. */
export function render<T>(hook: () => T): T {
  cursor = 0;
  const result = hook();
  flush(layout, pendingLayout);
  flush(passive, pendingPassive);
  return result;
}
export function unmount() {
  for (const list of [layout, passive]) for (const e of list) e?.cleanup?.();
  slots = [];
  layout = [];
  passive = [];
  pendingLayout = [];
  pendingPassive = [];
}
export default { useState, useRef, useMemo, useLayoutEffect, useEffect };
