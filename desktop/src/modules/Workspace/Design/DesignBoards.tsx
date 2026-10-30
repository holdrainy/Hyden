import { useState } from 'react';
import { PanelsTopLeft, PenTool } from 'lucide-react';
import FigmaViewer from './FigmaViewer';
import Scratchpad from './Scratchpad';
import './design.css';

export default function DesignBoards() {
  const [tool, setTool] = useState<'figma' | 'scratchpad'>('figma');

  return (
    <section className="design-tools" aria-label="Design and boards">
      <div className="design-intro"><div><h2>Make a little room for possibilities.</h2><p>Keep a design close, or start with a few lines of your own.</p></div><span>BOARDS &amp; IDEAS</span></div>
      <div className="design-tool-tabs" role="tablist" aria-label="Design tools">
        <button id="design-figma-tab" role="tab" aria-selected={tool === 'figma'} aria-controls="design-tool-panel" onClick={() => setTool('figma')}><PanelsTopLeft size={15} />Figma boards</button>
        <button id="design-scratchpad-tab" role="tab" aria-selected={tool === 'scratchpad'} aria-controls="design-tool-panel" onClick={() => setTool('scratchpad')}><PenTool size={15} />Offline scratchpad</button>
      </div>
      <div id="design-tool-panel" role="tabpanel" aria-labelledby={tool === 'figma' ? 'design-figma-tab' : 'design-scratchpad-tab'}>
        {tool === 'figma' ? <FigmaViewer /> : <Scratchpad />}
      </div>
    </section>
  );
}
