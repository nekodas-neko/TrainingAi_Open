import { createContext } from 'react';
export const RowGestureContext = createContext<{
  suppressPress: () => boolean;
  suppressLongPress: () => boolean;
} | null>(null);
