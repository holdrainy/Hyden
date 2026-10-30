import { ArrowUpRight, ChevronLeft, ChevronRight, Layers3, Leaf, X } from 'lucide-react';
import { modules } from '../modules/registry';
import { useShell } from '../app/context';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  toggleCollapsed: () => void;
  closeMobile: () => void;
}

export function Sidebar({ collapsed, mobileOpen, toggleCollapsed, closeMobile }: SidebarProps) {
  const { activeModule, navigate, status, connectionError } = useShell();

  return (
    <>
      {mobileOpen && <button className="sidebar-backdrop" onClick={closeMobile} aria-label="Close navigation" />}
      <aside id="sidebar" className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-open' : ''}`}>
        <div className="brand-row">
          <a className="brand" href="#overview" aria-label="Hyden overview" onClick={closeMobile}>
            <span className="brand-mark"><Layers3 size={23} strokeWidth={1.6} /></span>
            <span className="sidebar-label">hyden<span className="brand-period">.</span></span>
          </a>
          <button className="icon-button mobile-close" onClick={closeMobile} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <div className="space-label sidebar-label">YOUR SPACE</div>
        <nav aria-label="Main navigation">
          {modules.map(({ id, title, icon: Icon, shortcut }) => (
            <button
              key={id}
              className={`nav-item ${activeModule.id === id ? 'is-active' : ''}`}
              aria-current={activeModule.id === id ? 'page' : undefined}
              aria-label={title}
              title={collapsed ? `${title} (Alt+${shortcut})` : undefined}
              onClick={() => { navigate(id); closeMobile(); }}
            >
              <Icon size={19} strokeWidth={1.6} />
              <span className="sidebar-label nav-title">{title}</span>
              <span className="sidebar-label nav-shortcut">{shortcut}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-note sidebar-label">
            <Leaf size={19} strokeWidth={1.6} />
            <strong>A little less cloud.</strong>
            <p>No accounts. No subscriptions.<br />Just a space of your own.</p>
            <a href="#overview" onClick={closeMobile}>Local by design <ArrowUpRight size={13} /></a>
          </div>
          <div className="sidebar-footer">
            <span className={`status-dot ${connectionError ? 'is-error' : ''}`} />
            <span className="sidebar-label runtime-label">{connectionError ? 'Host unavailable' : status?.host === 'desktop' ? 'Desktop shell' : status ? 'Browser preview' : 'Checking host…'}</span>
            <button className="icon-button collapse-button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="sidebar">
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
