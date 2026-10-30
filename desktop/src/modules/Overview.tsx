import { ArrowDownToLine, ArrowRight, ArrowUpRight, Circle, Command, HardDrive, Layers3, PlugZap } from 'lucide-react';
import { useShell } from '../app/context';
import { modules } from './registry';

export default function Overview() {
  const { navigate, status, connectionError } = useShell();

  return (
    <div className="page overview-page">
      <div className="page-heading">
        <div className="eyebrow"><span className="tiny-line" /> YOUR PERSONAL DESKTOP</div>
        <h1>A space that’s yours.</h1>
        <p>Your media, ideas, and everyday tools. Together, on your machine.</p>
      </div>

      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <span className="pill"><span className="status-dot" /> THE FOUNDATION IS HERE</span>
          <h2 id="welcome-title">Less running.<br /><span>More room to create.</span></h2>
          <p>A lightweight shell for the tools you choose.<br className="desktop-break" /> Open a module to explore what comes next.</p>
          <button className="primary-button" onClick={() => navigate('workspace')}>Explore your workspace <ArrowRight size={16} /></button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="art-tile tile-back"><HardDrive size={30} strokeWidth={1.1} /></div>
          <div className="art-tile tile-front"><Layers3 size={53} strokeWidth={1.1} /></div>
          <div className="art-caption"><span className="status-dot" /> BUILT AROUND YOU</div>
          <span className="art-cross cross-one">+</span><span className="art-cross cross-two">+</span>
        </div>
      </section>

      <section className="module-section" aria-labelledby="modules-title">
        <div className="section-heading"><div><h2 id="modules-title">Your toolkit</h2><p>Five modules. One familiar place.</p></div><span className="section-note">Built to grow with you <ArrowUpRight size={13} /></span></div>
        <div className="module-grid">
          {modules.filter((module) => module.id !== 'overview').map(({ id, title, description, status: moduleStatus, icon: Icon }, index) => (
            <button className="module-card group" key={id} onClick={() => navigate(id)}>
              <div className="card-top"><span className={`module-icon icon-${id}`}><Icon size={23} strokeWidth={1.5} /></span><ArrowUpRight className="card-arrow" size={16} /></div>
              <h3>{title}</h3><p>{description}</p>
              <div className="card-footer"><span><Circle size={6} fill="currentColor" /> {moduleStatus === 'preview' ? 'Browser preview' : 'Planned module'}</span><span className="card-index">0{index + 1}</span></div>
            </button>
          ))}
          <div className="module-card philosophy-card"><PlugZap size={24} strokeWidth={1.3} /><h3>A smaller footprint.</h3><p>Heavy tools start when you need them. The rest of the time, they stay out of the way.</p><span className="philosophy-caption">THE HYDEN APPROACH <span>↗</span></span></div>
        </div>
      </section>

      <section className="foundation-strip" aria-label="Shell status">
        <div className="foundation-icon"><ArrowDownToLine size={20} strokeWidth={1.5} /></div>
        <div><h3>{connectionError ? 'Desktop host unavailable' : status?.host === 'desktop' ? 'Running on your desktop' : 'You’re exploring the shell'}</h3><p>{connectionError ? 'Restart the application to reconnect to the native host.' : status?.host === 'desktop' ? 'Native IPC connected. Modules and local storage are next.' : 'Navigation is live. Native services and module features come next.'}</p></div>
        <span className="shortcut-hint"><Command size={13} /> Navigate with Alt + 1–6</span>
      </section>
      <p className="page-footnote">No sign-in. No remote services used by the shell. A little more independence.</p>
    </div>
  );
}
