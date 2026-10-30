import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Menu, ShieldCheck } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { ModuleBoundary } from '../components/ModuleBoundary';
import { getShellStatus } from '../lib/ipc';
import type { ShellStatus } from '../lib/ipc';
import { modules, resolveModule } from '../modules/registry';
import type { ModuleId } from '../modules/registry';
import { ShellContext } from './context';

export function App() {
  const [activeId, setActiveId] = useState<ModuleId>(() => resolveModule(window.location.hash.slice(1)).id);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [status, setStatus] = useState<ShellStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const activeModule = resolveModule(activeId);
  const ActiveScreen = activeModule.component;

  const navigate = useCallback((id: ModuleId) => {
    window.location.hash = id;
    setActiveId(id);
  }, []);

  useEffect(() => {
    let disposed = false;
    getShellStatus().then((value) => {
      if (!disposed) setStatus(value);
    }).catch(() => {
      if (!disposed) setConnectionError('The desktop host did not respond. Restart the application to reconnect.');
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const onHash = () => setActiveId(resolveModule(window.location.hash.slice(1)).id);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      const module = modules.find((entry) => entry.shortcut === event.key);
      if (module) { event.preventDefault(); navigate(module.id); setMobileOpen(false); }
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, [navigate]);

  useEffect(() => {
    document.title = `${activeModule.title} — Hyden`;
    mainRef.current?.focus({ preventScroll: true });
    mainRef.current?.scrollTo(0, 0);
  }, [activeModule.id, activeModule.title]);

  return (
    <ShellContext.Provider value={{ activeModule, navigate, status, connectionError }}>
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      <div className={`app-shell ${collapsed ? 'sidebar-compact' : ''}`}>
        <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} toggleCollapsed={() => setCollapsed((value) => !value)} closeMobile={() => setMobileOpen(false)} />
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button className="icon-button mobile-menu" onClick={() => setMobileOpen((value) => !value)} aria-label="Toggle navigation" aria-expanded={mobileOpen} aria-controls="sidebar"><Menu size={20} /></button>
              <span>My space</span><ChevronRight size={13} /><strong>{activeModule.title}</strong>
            </div>
            <div className="privacy-label"><ShieldCheck size={14} /><span>Local-first shell</span></div>
          </header>
          <main id="main-content" tabIndex={-1} ref={mainRef}>
            {connectionError && <div className="error-banner" role="alert">{connectionError}</div>}
            <ModuleBoundary key={activeId}>
              <Suspense fallback={<p className="loading" role="status">Opening your space…</p>}>
                <ActiveScreen />
              </Suspense>
            </ModuleBoundary>
          </main>
          <footer className="bottom-bar"><span>HYDEN <span className="footer-version">v{status?.appVersion ?? '0.1.0'}</span></span><span>Core shell <span className="footer-divider">/</span> No background workers</span></footer>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
