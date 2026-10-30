import { createContext, useContext } from 'react';
import type { ShellStatus } from '../lib/ipc';
import type { ModuleDefinition, ModuleId } from '../modules/registry';

interface ShellContextValue {
  activeModule: ModuleDefinition;
  navigate: (id: ModuleId) => void;
  status: ShellStatus | null;
  connectionError: string | null;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) throw new Error('Module must be mounted inside the shell');
  return context;
}
