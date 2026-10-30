import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FileText, HardDrive, Palette, Plus, Search, Table2, Trash2 } from 'lucide-react';
import {
  createWorkspaceNote, createWorkspaceSheet, deleteWorkspaceNote, deleteWorkspaceSheet,
  getWorkspaceSnapshot, saveWorkspaceNote, saveWorkspaceSheet, subscribeWorkspaceChanges,
} from '../../lib/ipc';
import type { WorkspaceNote, WorkspaceSheet, WorkspaceSnapshot } from '../../lib/ipc';
import Notes from './Notes';
import Sheets from './Sheets';
import DesignBoards from './Design/DesignBoards';
import { markdownToPlainText } from './markdown-helpers';
import { toCsv, toSheetJson } from './formulas';
import './workspace.css';

type Draft = { kind: 'note'; value: WorkspaceNote } | { kind: 'sheet'; value: WorkspaceSheet };
type Tab = Draft['kind'] | 'design';
// Preserve an unsaved draft across module navigation if browser storage fails.
let recoveryDraft: Draft | null = null;

function message(error: unknown): string {
  return error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The workspace could not complete this action.';
}

function downloadText(title: string, extension: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'document'}.${extension}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Workspace() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('note');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'failed'>('saved');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const draftRef = useRef<Draft | null>(null);
  const canonical = useRef<Draft | null>(null);
  const pending = useRef<Draft | null>(null);
  const activeSave = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSelection = useRef<Partial<Record<Tab, string>>>({});
  const actionLock = useRef(false);

  const showDraft = useCallback((next: Draft | null) => {
    draftRef.current = next;
    if (mounted.current) setDraft(next);
  }, []);

  const refresh = useCallback(async () => {
    const next = await getWorkspaceSnapshot();
    if (!mounted.current) return next;
    setSnapshot(next);
    const current = draftRef.current;
    if (current && !pending.current && !activeSave.current) {
      const value = current.kind === 'note' ? next.notes.find((item) => item.id === current.value.id) : next.sheets.find((item) => item.id === current.value.id);
      const updated = value ? { kind: current.kind, value } as Draft : null;
      canonical.current = updated;
      showDraft(updated);
    }
    return next;
  }, [showDraft]);

  const drain = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (activeSave.current) return activeSave.current;
    const run = async () => {
      while (pending.current) {
        const job = pending.current;
        pending.current = null;
        if (mounted.current) setSaveState('saving');
        try {
          const base = canonical.current;
          const revision = base?.value.id === job.value.id ? base.value.revision : job.value.revision;
          const saved: Draft = job.kind === 'note'
            ? { kind: 'note', value: await saveWorkspaceNote({ ...job.value, revision }) }
            : { kind: 'sheet', value: await saveWorkspaceSheet({ ...job.value, revision }) };
          canonical.current = saved;
          if (!pending.current) {
            showDraft(saved);
            recoveryDraft = null;
          }
        } catch (reason) {
          pending.current ??= job;
          recoveryDraft = pending.current;
          if (mounted.current) { setError(message(reason)); setSaveState('failed'); }
          return false;
        }
      }
      if (mounted.current) { setSaveState('saved'); setError(''); }
      return true;
    };
    const operation = run();
    activeSave.current = operation;
    void operation.finally(() => { activeSave.current = null; });
    return operation;
  }, [showDraft]);

  const edit = (next: Draft) => {
    showDraft(next);
    pending.current = next;
    recoveryDraft = next;
    setSaveState('pending');
    setNotice('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void drain(), 300);
  };

  const select = useCallback((next: Draft | null) => {
    canonical.current = next;
    showDraft(next);
    if (next) lastSelection.current[next.kind] = next.value.id;
    setSaveState('saved');
    setError('');
  }, [showDraft]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let unsubscribe = () => {};
    const initialize = async () => {
      unsubscribe = await subscribeWorkspaceChanges(() => { void refresh().catch((reason) => { if (mounted.current) setError(message(reason)); }); });
      if (cancelled) { unsubscribe(); return; }
      // Storage may be unreadable after a failed write. Keep recovery exportable even then.
      if (recoveryDraft) {
        const recovered = recoveryDraft;
        setTab(recovered.kind);
        canonical.current = recovered;
        pending.current = recovered;
        showDraft(recovered);
        setSaveState('failed');
        setError('An unsaved draft was recovered. Retry saving, or export it before loading the saved version.');
      }
      const next = await getWorkspaceSnapshot();
      if (cancelled) return;
      setSnapshot(next);
      // Keep a recovered revision so conflicts cannot be silently overwritten.
      if (!recoveryDraft) {
        const first: Draft | null = next.notes[0] ? { kind: 'note', value: next.notes[0] } : next.sheets[0] ? { kind: 'sheet', value: next.sheets[0] } : null;
        select(first);
        if (first) setTab(first.kind);
      }
    };
    void initialize().catch((reason) => { if (!cancelled) setError(message(reason)); }).finally(() => { if (!cancelled) setLoading(false); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current) return;
      void drain();
      event.preventDefault();
      event.returnValue = '';
    };
    const pageHide = () => { void drain(); };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    return () => {
      cancelled = true;
      mounted.current = false;
      unsubscribe();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
      clearTimeout(timer.current);
      void drain();
    };
  }, [drain, refresh, select, showDraft]);

  useEffect(() => { setTitle(draft?.value.title ?? ''); }, [draft?.value.id, draft?.value.title]);

  const action = async (operation: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true); setNotice('');
    try { if (await drain()) await operation(); }
    catch (reason) { if (mounted.current) setError(message(reason)); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };

  const switchTab = (nextTab: Tab) => void action(async () => {
    if (nextTab === 'design') { setTab(nextTab); setSearch(''); return; }
    const next = await refresh();
    const values = nextTab === 'note' ? next.notes : next.sheets;
    const value = values.find((item) => item.id === lastSelection.current[nextTab]) ?? values[0];
    setTab(nextTab); setSearch('');
    select(value ? { kind: nextTab, value } as Draft : null);
  });

  const create = () => void action(async () => {
    const next: Draft = tab === 'note' ? { kind: 'note', value: await createWorkspaceNote() } : { kind: 'sheet', value: await createWorkspaceSheet() };
    await refresh(); select(next); setSearch('');
  });

  const rename = () => void action(async () => {
    const current = draftRef.current;
    if (!current) return;
    const value = title.trim();
    if (!value) throw new Error('Give your document a title.');
    edit({ kind: current.kind, value: { ...current.value, title: value } } as Draft);
    await drain();
  });

  const remove = () => void action(async () => {
    const current = draftRef.current;
    if (!current || !window.confirm(`Delete “${current.value.title}”? This cannot be undone. Export important work first.`)) return;
    if (current.kind === 'note') await deleteWorkspaceNote(current.value.id, current.value.revision);
    else await deleteWorkspaceSheet(current.value.id, current.value.revision);
    select(null);
    const next = await refresh();
    const value = current.kind === 'note' ? next.notes[0] : next.sheets[0];
    select(value ? { kind: current.kind, value } as Draft : null);
    setNotice('Document deleted.');
  });

  const reloadSaved = async () => {
    if (actionLock.current || !window.confirm('Discard this unsaved draft and load the saved version? Export it first if you need a copy.')) return;
    clearTimeout(timer.current);
    if (activeSave.current) await activeSave.current;
    try {
      const next = await getWorkspaceSnapshot();
      const current = draftRef.current;
      const value = current?.kind === 'note' ? next.notes.find((item) => item.id === current.value.id) : next.sheets.find((item) => item.id === current?.value.id);
      pending.current = null; recoveryDraft = null;
      setSnapshot(next);
      select(current && value ? { kind: current.kind, value } as Draft : null);
      setSaveState('saved'); setError('');
    }
    catch (reason) { setError(message(reason)); }
  };

  const copy = async (plain: boolean) => {
    if (draft?.kind !== 'note') return;
    try {
      await navigator.clipboard.writeText(plain ? markdownToPlainText(draft.value.markdown) : draft.value.markdown);
      setNotice(`${plain ? 'Plain text' : 'Markdown'} copied.`);
    } catch { setError('Clipboard access is unavailable. Export the document instead.'); }
  };

  const exportDocument = (format: string) => {
    if (!draft) return;
    try {
      const item = draft.value;
      if (draft.kind === 'note') downloadText(item.title, format, format === 'txt' ? markdownToPlainText(draft.value.markdown) : draft.value.markdown, 'text/plain;charset=utf-8');
      else downloadText(item.title, format, format === 'csv' ? toCsv(draft.value) : toSheetJson(draft.value), format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
      setNotice(`Exported ${format.toUpperCase()}.`);
    } catch (reason) { setError(message(reason)); }
  };

  const available = snapshot?.persistence === 'localStorage';
  const saveLabel = saveState === 'failed' ? 'Not saved' : !available ? loading ? 'Opening workspace…' : 'Storage unavailable' : saveState === 'saved' ? 'All changes saved' : saveState === 'pending' ? 'Unsaved changes' : 'Saving…';
  const documents = (tab === 'note' ? snapshot?.notes : snapshot?.sheets) ?? [];
  const visible = documents.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page ws-page">
      <div className="ws-heading"><div className="page-heading"><div className="eyebrow"><span className="tiny-line" /> YOUR TOOLKIT / WORKSPACE</div><h1>A little room to think.</h1><p>Notes, numbers, and a place to sketch what comes next.</p></div><span className="ws-storage-label"><HardDrive size={14} />{tab === 'design' ? 'Local boards · online Figma viewer' : available ? 'Saved in this browser' : loading ? 'Opening workspace…' : 'Storage unavailable'}</span></div>
      <div className="ws-tab-bar" role="tablist" aria-label="Workspace sections"><button role="tab" id="ws-notes-tab" aria-controls="ws-content" aria-selected={tab === 'note'} disabled={busy} onClick={() => switchTab('note')}><FileText size={16} />Notes<span>{snapshot?.notes.length ?? 0}</span></button><button role="tab" id="ws-sheets-tab" aria-controls="ws-content" aria-selected={tab === 'sheet'} disabled={busy} onClick={() => switchTab('sheet')}><Table2 size={16} />Sheets<span>{snapshot?.sheets.length ?? 0}</span></button><button role="tab" id="ws-design-tab" aria-controls="ws-content" aria-selected={tab === 'design'} disabled={busy} onClick={() => switchTab('design')}><Palette size={16} />Design</button><span className={`ws-save-label ws-save-${saveState}`} role="status">{tab === 'design' ? 'Design & Boards' : <>{available && saveState === 'saved' ? <Check size={12} /> : null}{saveLabel}</>}</span></div>
      {error && <div className="ws-message ws-error" role="alert"><span>{error}</span>{saveState === 'failed' && <div><button onClick={() => void drain()}>Retry save</button><button onClick={() => void reloadSaved()}>Load saved version</button></div>}</div>}
      {notice && <div className="ws-message" role="status">{notice}</div>}
      {tab === 'design' ? <section className="ws-design-area" id="ws-content" role="tabpanel" aria-labelledby="ws-design-tab"><DesignBoards /></section> : <div className="ws-body" id="ws-content" role="tabpanel" aria-labelledby={tab === 'note' ? 'ws-notes-tab' : 'ws-sheets-tab'}>
        <aside className="ws-document-manager" aria-label={tab === 'note' ? 'Notes documents' : 'Sheets documents'}><div className="ws-doc-heading"><span>{tab === 'note' ? 'YOUR NOTES' : 'YOUR SHEETS'}</span><button className="ws-new-button" onClick={create} disabled={!available || busy} aria-label={tab === 'note' ? 'New note' : 'New sheet'}><Plus size={16} /></button></div><label className="ws-search"><Search size={13} /><input aria-label="Search documents" placeholder="Find a document…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="ws-document-list">{visible.map((item) => <button key={item.id} className={draft?.value.id === item.id ? 'ws-document-selected' : ''} aria-pressed={draft?.value.id === item.id} onClick={() => void action(async () => { const next = await refresh(); const value = tab === 'note' ? next.notes.find((document) => document.id === item.id) : next.sheets.find((document) => document.id === item.id); select(value ? { kind: tab, value } as Draft : null); })} disabled={busy}>{tab === 'note' ? <FileText size={15} /> : <Table2 size={15} />}<span><strong>{item.title}</strong><small>{'markdown' in item ? `${item.markdown.length.toLocaleString()} characters` : `${item.rows} rows · ${item.columns} columns`}</small></span></button>)}{!visible.length && !loading && <p className="ws-list-empty">{search ? 'No matching documents.' : 'Start with a fresh page.'}</p>}</div><p className="ws-storage-note">Stored on this browser and origin. Export a copy before clearing browser data.</p></aside>
        <section className="ws-document-area" aria-label={tab === 'note' ? 'Note document' : 'Sheet document'}>
          {loading ? <div className="ws-empty" role="status">Opening your workspace…</div> : draft ? <>
            <div className="ws-document-toolbar"><form className="ws-title-form" onSubmit={(event) => { event.preventDefault(); rename(); }}><input aria-label="Document title" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} disabled={!available || busy} /><button type="submit" disabled={!available || busy || title.trim() === draft.value.title}>Rename</button></form><button className="ws-delete" aria-label="Delete document" title="Delete document" onClick={remove} disabled={!available || busy}><Trash2 size={15} /></button></div>
            <div className="ws-export-toolbar"><span>{draft.kind === 'note' ? 'MARKDOWN NOTE' : 'SPREADSHEET'}</span><div>{draft.kind === 'note' ? <><button onClick={() => void copy(false)}><Copy size={12} />Copy Markdown</button><button onClick={() => void copy(true)}>Copy text</button><button onClick={() => exportDocument('md')}><Download size={12} />.md</button><button onClick={() => exportDocument('txt')}>.txt</button></> : <><button onClick={() => exportDocument('csv')}><Download size={12} />Export CSV</button><button onClick={() => exportDocument('json')}>Export JSON</button></>}</div></div>
            <div className="ws-editor-container" onBlurCapture={() => { if (pending.current && saveState === 'pending') void drain(); }}>{draft.kind === 'note' ? <Notes note={draft.value} disabled={!available || busy} onChange={(value) => edit({ kind: 'note', value })} /> : <Sheets sheet={draft.value} disabled={!available || busy} onChange={(value) => edit({ kind: 'sheet', value })} />}</div>
          </> : <div className="ws-empty">{tab === 'note' ? <FileText size={35} strokeWidth={1.2} /> : <Table2 size={35} strokeWidth={1.2} />}<h2>{tab === 'note' ? 'Give your ideas a home.' : 'Make a little sense of the numbers.'}</h2><p>{snapshot?.persistence === 'unavailable' ? snapshot.notice : tab === 'note' ? 'A blank page, a few words, and somewhere to come back to.' : 'Start a small sheet for budgets, lists, or your next plan.'}</p><button className="primary-button" onClick={create} disabled={!available || busy}><Plus size={14} />{tab === 'note' ? 'Create your first note' : 'Create your first sheet'}</button></div>}
        </section>
      </div>}
      <p className="page-footnote">Notes, sheets, and sketches stay in this browser. Figma connects online only when you open a live board.</p>
    </div>
  );
}
