import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Bold, Braces, CheckSquare2, Columns2, Eye, Heading1, Heading2, Heading3, Italic, Maximize2, Minimize2, PencilLine } from 'lucide-react';
import type { WorkspaceNote } from '../../lib/ipc';
import MarkdownPreview from './markdown';
import { formatMarkdown, toggleTask } from './markdown-helpers';
import type { NoteFormat } from './markdown-helpers';
import './notes.css';

const NOTE_LIMIT = 200000;
type View = 'write' | 'preview' | 'split';

export default function Notes({ note, onChange, disabled = false }: { note: WorkspaceNote; onChange: (note: WorkspaceNote) => void; disabled?: boolean }) {
  const [view, setView] = useState<View>('split');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const focusButtonRef = useRef<HTMLButtonElement>(null);
  const wordCount = note.markdown.trim() ? note.markdown.trim().split(/\s+/).length : 0;

  const changeText = (markdown: string) => {
    if (disabled) return false;
    if (markdown.length > NOTE_LIMIT) { setError('A note can contain at most 200,000 characters. Export or split this note to keep writing.'); return false; }
    setError('');
    onChange({ ...note, markdown });
    return true;
  };

  const format = (kind: NoteFormat) => {
    const textarea = textareaRef.current;
    const next = formatMarkdown(note.markdown, textarea?.selectionStart ?? note.markdown.length, textarea?.selectionEnd ?? note.markdown.length, kind);
    if (!changeText(next.text)) return;
    if (view === 'preview') setView('write');
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.start, next.end);
    });
  };

  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && focused) { event.preventDefault(); setFocused(false); focusButtonRef.current?.focus(); }
    if (focused && event.key === 'Tab') {
      const focusable = [...(editorRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled)') ?? [])].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };

  const textKeyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !disabled) {
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); format('bold'); }
      if (event.key.toLowerCase() === 'i') { event.preventDefault(); format('italic'); }
    }
  };

  return (
    <section ref={editorRef} className={`ws-note-editor ${focused ? 'ws-note-focused' : ''}`} role={focused ? 'dialog' : undefined} aria-modal={focused || undefined} aria-label={focused ? 'Note editor focus mode' : 'Note editor'} onKeyDown={keyboard}>
      <div className="ws-note-toolbar">
        <div className="ws-note-formatting" role="group" aria-label="Markdown formatting">
          {([
            ['heading1', 'Heading 1', Heading1], ['heading2', 'Heading 2', Heading2], ['heading3', 'Heading 3', Heading3],
            ['bold', 'Bold', Bold], ['italic', 'Italic', Italic], ['task', 'Task list', CheckSquare2], ['code', 'Code block', Braces],
          ] as const).map(([kind, label, Icon]) => <button type="button" key={kind} aria-label={label} title={label} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => format(kind)}><Icon size={16} strokeWidth={1.6} /></button>)}
        </div>
        <div className="ws-note-view-controls" role="group" aria-label="Editor view">
          {([['write', 'Write', PencilLine], ['split', 'Split', Columns2], ['preview', 'Preview', Eye]] as const).map(([value, label, Icon]) => <button type="button" key={value} aria-label={`${label} note`} aria-pressed={view === value} onClick={() => setView(value)}><Icon size={13} /><span>{label}</span></button>)}
        </div>
        <button type="button" ref={focusButtonRef} className="ws-note-focus-toggle" aria-label={focused ? 'Exit focus mode' : 'Enter focus mode'} aria-pressed={focused} title={focused ? 'Exit focus mode (Esc)' : 'Focus mode'} onClick={() => setFocused((value) => !value)}>{focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
      {focused && <div className="ws-note-focus-heading"><span>JUST YOU AND YOUR IDEAS</span><h2>{note.title}</h2></div>}
      {error && <p className="ws-note-error" role="alert">{error}</p>}
      <div className={`ws-note-panes ws-note-view-${view}`}>
        {view !== 'preview' && <div className="ws-note-source-pane"><div className="ws-note-pane-label">MARKDOWN</div><textarea ref={textareaRef} aria-label="Note Markdown" value={note.markdown} disabled={disabled} maxLength={NOTE_LIMIT} onChange={(event) => changeText(event.target.value)} onKeyDown={textKeyboard} placeholder={'# A place to begin\n\nWrite a thought. Make a list. Follow an idea.\n\n- [ ] One small thing for today'} spellCheck autoCapitalize="sentences" /></div>}
        {view !== 'write' && <div className="ws-note-preview-pane"><div className="ws-note-pane-label">PREVIEW</div><MarkdownPreview source={note.markdown} disabled={disabled} onToggleTask={(line) => changeText(toggleTask(note.markdown, line))} /></div>}
      </div>
      <div className="ws-note-editor-footer"><span>{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'} <span>·</span> {note.markdown.length.toLocaleString()} characters</span><span>Markdown stays yours.</span></div>
    </section>
  );
}
