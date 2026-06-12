'use client';

import { createContext, useContext, useState, useCallback } from 'react';

interface NavGuardContextValue {
  guardFn: ((href: string) => void) | null;
  register: (fn: (href: string) => void) => void;
  unregister: () => void;
}

const NavGuardContext = createContext<NavGuardContextValue>({
  guardFn: null,
  register: () => {},
  unregister: () => {},
});

export function NavGuardProvider({ children }: { children: React.ReactNode }) {
  const [guardFn, setGuardFn] = useState<((href: string) => void) | null>(null);

  const register = useCallback((fn: (href: string) => void) => {
    setGuardFn(() => fn);
  }, []);

  const unregister = useCallback(() => {
    setGuardFn(null);
  }, []);

  return (
    <NavGuardContext.Provider value={{ guardFn, register, unregister }}>
      {children}
    </NavGuardContext.Provider>
  );
}

export function useNavGuard() {
  return useContext(NavGuardContext);
}
