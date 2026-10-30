import { ArrowLeft, ArrowRight, Check, Construction } from 'lucide-react';
import { useShell } from '../app/context';

export default function ModuleScreen() {
  const { activeModule, navigate } = useShell();
  const Icon = activeModule.icon;

  return (
    <div className="page module-page">
      <button className="text-button" onClick={() => navigate('overview')}><ArrowLeft size={15} /> Back to overview</button>
      <div className="page-heading">
        <div className="eyebrow">YOUR TOOLKIT / {activeModule.title.toUpperCase()}</div>
        <h1>{activeModule.title}</h1>
        <p>{activeModule.subtitle}</p>
      </div>
      <section className="empty-panel" aria-labelledby="module-title">
        <div className={`module-icon large-icon icon-${activeModule.id}`}><Icon size={34} strokeWidth={1.4} /></div>
        <span className="pill neutral-pill"><Construction size={13} /> PLANNED MODULE</span>
        <h2 id="module-title">A place for {activeModule.id === 'copilot' ? 'your local copilot' : activeModule.title.toLowerCase()}.</h2>
        <p>{activeModule.description} This screen is the starting point; these features aren’t implemented yet.</p>
        <ul className="capability-list">{activeModule.capabilities.map((capability) => <li key={capability}><Check size={14} />{capability}</li>)}</ul>
        <button className="secondary-button" onClick={() => navigate('overview')}>Explore the other modules <ArrowRight size={15} /></button>
      </section>
      <p className="page-footnote">No files opened. No worker started. Just the shell, ready to build on.</p>
    </div>
  );
}
