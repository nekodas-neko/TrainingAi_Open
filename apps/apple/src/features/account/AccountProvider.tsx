import { createContext, useContext, type PropsWithChildren } from 'react';
import { useAccount } from './useAccount';

const Context = createContext<ReturnType<typeof useAccount> | null>(null);
export function AccountProvider({ children }: PropsWithChildren) {
  const value = useAccount();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAccountContext() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('AccountProvider is required.');
  }
  return value;
}
