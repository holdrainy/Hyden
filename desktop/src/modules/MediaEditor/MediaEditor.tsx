import { useState } from 'react';
import { Image, Scissors, SlidersHorizontal } from 'lucide-react';
import ImageProcessor from './ImageProcessor';
import Trimmer from './Trimmer';
import './editor.css';

export default function MediaEditor() {
  const [tab, setTab] = useState<'trim' | 'image'>('trim');
  return (
    <div className="page me-page">
      <div className="me-heading"><div className="page-heading"><div className="eyebrow"><span className="tiny-line" /> YOUR TOOLKIT / MEDIA EDITOR</div><h1>A few useful edits.</h1><p>Trim a moment. Tidy an image. Keep the original yours.</p></div><span className="me-local-label"><SlidersHorizontal size={14} /> On-demand tools</span></div>
      <div className="me-tabs" role="tablist" aria-label="Media editor tools"><button role="tab" id="me-trim-tab" aria-controls="me-tool-panel" aria-selected={tab === 'trim'} onClick={() => setTab('trim')}><Scissors size={16} />Audio/Video Trimmer</button><button role="tab" id="me-image-tab" aria-controls="me-tool-panel" aria-selected={tab === 'image'} onClick={() => setTab('image')}><Image size={16} />Image Processor</button></div>
      <section id="me-tool-panel" role="tabpanel" aria-labelledby={tab === 'trim' ? 'me-trim-tab' : 'me-image-tab'}>{tab === 'trim' ? <Trimmer /> : <ImageProcessor />}</section>
      <p className="page-footnote">Original files stay untouched. Switching tools releases the current preview.</p>
    </div>
  );
}
