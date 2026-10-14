import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export const NestedScrollGesture = createContext<
  ((owner: symbol, active: boolean) => void) | null
>(null);

export function useNestedScrollBoundary() {
  const owners = useRef(new Set<symbol>());
  const [locked, setLocked] = useState(false);
  const control = useCallback((owner: symbol, active: boolean) => {
    if (active) owners.current.add(owner);
    else owners.current.delete(owner);
    setLocked(owners.current.size > 0);
  }, []);
  return { locked, control };
}

export function useNestedScrollGesture() {
  const control = useContext(NestedScrollGesture);
  const owner = useRef(Symbol());
  const begin = useCallback(() => control?.(owner.current, true), [control]);
  const end = useCallback(() => control?.(owner.current, false), [control]);
  useEffect(() => {
    const token = owner.current;
    return () => control?.(token, false);
  }, [control]);
  return { begin, end };
}
