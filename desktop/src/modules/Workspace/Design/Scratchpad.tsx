import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Check, Download, PenLine, RotateCcw, Square, Trash2 } from 'lucide-react';
import { getDesignSnapshot, saveDesignScratchpad } from '../../../lib/ipc';
import type { DesignPoint, DesignShape, ScratchpadDocument } from '../../../lib/design-types';
import { clientPoint, countPenPoints, normalizeRectangle, penPath, pointDistance, scratchpadPng } from './drawing';
import './scratchpad.css';

type Tool = 'pen' | 'rectangle';
interface Gesture { pointerId: number; id: string; kind: Tool; start: DesignPoint; end: DesignPoint; points: DesignPoint[]; maxPoints: number; color: string; width: number }
let recoveryPad: ScratchpadDocument | null = null;

const COLORS = ['#293329', '#b64b42', '#487b9b', '#8b649d', '#f4f0e7'];
function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : 'The scratchpad could not complete this action.';
}

function shapeFromGesture(gesture: Gesture): DesignShape | null {
  if (gesture.kind === 'pen') return { id: gesture.id, kind: 'pen', points: gesture.points, color: gesture.color, width: gesture.width };
  const rectangle = normalizeRectangle(gesture.start, gesture.end);
  return rectangle ? { id: gesture.id, kind: 'rectangle', ...rectangle, color: gesture.color, strokeWidth: gesture.width } : null;
}

function Shape({ shape }: { shape: DesignShape }) {
  if (shape.kind === 'rectangle') return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill="none" stroke={shape.color} strokeWidth={shape.strokeWidth} strokeLinejoin="round" />;
  if (shape.points.length === 1) return <circle cx={shape.points[0].x} cy={shape.points[0].y} r={shape.width / 2} fill={shape.color} />;
  return <path d={penPath(shape.points)} fill="none" stroke={shape.color} strokeWidth={shape.width} strokeLinecap="round" strokeLinejoin="round" />;
}

export default function Scratchpad() {
  const [pad, setPad] = useState<ScratchpadDocument | null>(recoveryPad);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(Boolean(recoveryPad));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const board = useRef<SVGSVGElement>(null);
  const padRef = useRef<ScratchpadDocument | null>(recoveryPad);
  const pending = useRef<ScratchpadDocument | null>(recoveryPad);
  const canonicalRevision = useRef(recoveryPad?.revision ?? 0);
  const activeSave = useRef<Promise<boolean> | null>(null);
  const activeGesture = useRef<Gesture | null>(null);
  const mounted = useRef(true);
  const dirtyRef = useRef(Boolean(recoveryPad));
  const exportingRef = useRef(false);
  const undoStack = useRef<ScratchpadDocument[]>([]);

  const showPad = useCallback((next: ScratchpadDocument) => {
    padRef.current = next;
    if (mounted.current) setPad(next);
  }, []);

  const drain = useCallback((): Promise<boolean> => {
    if (activeSave.current) return activeSave.current;
    const run = async () => {
      while (pending.current) {
        const job = pending.current;
        pending.current = null;
        if (mounted.current) setSaving(true);
        try {
          const saved = await saveDesignScratchpad({ ...job, revision: canonicalRevision.current });
          canonicalRevision.current = saved.revision;
          if (!pending.current) {
            showPad(saved);
            dirtyRef.current = false;
            if (recoveryPad === job) recoveryPad = null;
            if (mounted.current) { setDirty(false); setError(''); }
          }
        } catch (reason) {
          pending.current ??= job;
          recoveryPad = pending.current;
          if (mounted.current) { setDirty(true); setError(`${errorText(reason)} Your sketch is still available for PNG export.`); }
          return false;
        }
      }
      return true;
    };
    const task = run();
    activeSave.current = task;
    void task.finally(() => { activeSave.current = null; if (mounted.current) setSaving(false); });
    return task;
  }, [showPad]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    if (recoveryPad) {
      showPad(recoveryPad);
      canonicalRevision.current = recoveryPad.revision;
      pending.current = recoveryPad; dirtyRef.current = true;
      setDirty(true); setError('An unsaved scratchpad was recovered. Retry saving or export a PNG before loading the saved version.');
    }
    getDesignSnapshot().then((snapshot) => {
      if (disposed) return;
      if (!recoveryPad) { canonicalRevision.current = snapshot.scratchpad.revision; showPad(snapshot.scratchpad); }
    }).catch((reason) => { if (!disposed) setError(errorText(reason)); }).finally(() => { if (!disposed) setLoading(false); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      void drain(); event.preventDefault(); event.returnValue = '';
    };
    const pageHide = () => { void drain(); };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('pagehide', pageHide);
    return () => {
      disposed = true; mounted.current = false;
      activeGesture.current = null;
      window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', pageHide);
      void drain();
    };
  }, [drain, showPad]);

  const commit = (next: ScratchpadDocument, recordUndo = true) => {
    const previous = padRef.current;
    if (recordUndo && previous) undoStack.current = [...undoStack.current, previous].slice(-10);
    setUndoCount(undoStack.current.length);
    showPad(next); pending.current = next; recoveryPad = next; dirtyRef.current = true;
    setDirty(true); setNotice('');
    void drain();
  };

  const position = (event: PointerEvent<SVGSVGElement>): DesignPoint => clientPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), padRef.current!);
  const releasePointer = (pointerId: number) => { if (board.current?.hasPointerCapture(pointerId)) board.current.releasePointerCapture(pointerId); };
  const cancelGesture = () => {
    const current = activeGesture.current; activeGesture.current = null; setGesture(null);
    if (current) releasePointer(current.pointerId);
  };

  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const current = padRef.current;
    if (!current || loading || exportingRef.current || activeGesture.current || event.button !== 0 || !event.isPrimary) return;
    if (current.shapes.length >= 250) { setError('This scratchpad supports 250 shapes. Undo or clear it before adding another.'); return; }
    const remaining = 30000 - countPenPoints(current.shapes);
    if (tool === 'pen' && remaining < 1) { setError('The scratchpad reached its 30,000-point limit. Undo or clear it to keep drawing.'); return; }
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    const point = position(event);
    const next: Gesture = { pointerId: event.pointerId, id: crypto.randomUUID(), kind: tool, start: point, end: point, points: [point], maxPoints: Math.min(2500, remaining), color, width };
    activeGesture.current = next; setGesture(next); setNotice('');
  };

  const updateGesture = (event: PointerEvent<SVGSVGElement>, final = false): Gesture | null => {
    const current = activeGesture.current;
    if (!current || event.pointerId !== current.pointerId) return null;
    const point = position(event);
    let points = current.points;
    if (current.kind === 'pen' && points.length < current.maxPoints && (final || pointDistance(points[points.length - 1], point) >= 2)) {
      if (pointDistance(points[points.length - 1], point) > 0) points = [...points, point];
    }
    const next = { ...current, end: point, points };
    activeGesture.current = next; setGesture(next);
    return next;
  };

  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const completed = updateGesture(event, true);
    if (!completed) return;
    activeGesture.current = null; setGesture(null); releasePointer(event.pointerId);
    const shape = shapeFromGesture(completed), current = padRef.current;
    if (shape && current) commit({ ...current, shapes: [...current.shapes, shape] });
  };

  const undo = () => {
    cancelGesture();
    const previous = undoStack.current.pop();
    if (previous) commit(previous, false);
  };

  const clear = () => {
    const current = padRef.current;
    if (!current?.shapes.length || !window.confirm('Clear all shapes from this scratchpad?')) return;
    cancelGesture(); commit({ ...current, shapes: [] });
  };

  const reloadSaved = async () => {
    if (loading || exportingRef.current || !window.confirm('Discard this unsaved sketch and load the saved scratchpad? Export a PNG first if you need it.')) return;
    setLoading(true); cancelGesture();
    try {
      if (activeSave.current) await activeSave.current;
      const snapshot = await getDesignSnapshot();
      if (!mounted.current) return;
      canonicalRevision.current = snapshot.scratchpad.revision;
      pending.current = null; recoveryPad = null; dirtyRef.current = false;
      undoStack.current = []; setUndoCount(0);
      showPad(snapshot.scratchpad); setDirty(false); setError(''); setNotice('Saved scratchpad loaded.');
    } catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { if (mounted.current) setLoading(false); }
  };

  const exportPng = async () => {
    const current = padRef.current;
    if (!current || exportingRef.current) return;
    exportingRef.current = true; setExporting(true); setNotice('');
    try {
      const blob = await scratchpadPng(current);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'hyden-scratchpad.png'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('PNG exported. Your vector sketch stays editable in this browser.');
    } catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { exportingRef.current = false; if (mounted.current) setExporting(false); }
  };

  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); cancelGesture(); }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
  };

  const preview = gesture ? shapeFromGesture(gesture) : null;
  const disabled = !pad || loading || exporting;

  return (
    <section className="scratchpad" aria-label="Offline scratchpad">
      <div className="scratch-heading"><div><h2>Give an idea a little shape.</h2><p>A quick sketch, a rough layout, a place to start. No network needed.</p></div><span className={`scratch-save-status ${dirty ? 'scratch-unsaved' : ''}`} role="status">{loading ? 'Opening scratchpad…' : saving ? 'Saving sketch…' : dirty ? 'Sketch not saved' : pad?.revision ? <><Check size={12} />Saved locally</> : 'Ready to sketch'}</span></div>
      {error && <div className="scratch-feedback scratch-error" role="alert"><span>{error}</span>{dirty && <div><button onClick={() => { if (padRef.current) pending.current ??= padRef.current; void drain(); }}>Retry sketch save</button><button onClick={() => void reloadSaved()}>Load saved scratchpad</button></div>}{!pad && <button onClick={() => void reloadSaved()}>Retry loading scratchpad</button>}</div>}
      {notice && <div className="scratch-feedback" role="status">{notice}</div>}
      <div className="scratch-toolbar"><div className="scratch-tools" role="group" aria-label="Drawing tools"><button type="button" aria-label="Pen tool" aria-pressed={tool === 'pen'} disabled={disabled} onClick={() => setTool('pen')}><PenLine size={15} />Pen</button><button type="button" aria-label="Rectangle tool" aria-pressed={tool === 'rectangle'} disabled={disabled} onClick={() => setTool('rectangle')}><Square size={15} />Rectangle</button></div><label className="scratch-width">Stroke<select aria-label="Stroke width" value={width} disabled={disabled} onChange={(event) => setWidth(Number(event.target.value))}><option value={2}>Thin</option><option value={3}>Medium</option><option value={6}>Thick</option><option value={12}>Marker</option></select></label><div className="scratch-colors" role="group" aria-label="Pen colors">{COLORS.map((value) => <button type="button" key={value} aria-label={`Pen color ${value}`} aria-pressed={color === value} className={`scratch-color color-${value.slice(1)}`} disabled={disabled} onClick={() => setColor(value)} />)}</div><label className="scratch-paper">Paper<select aria-label="Canvas background" value={pad?.background ?? '#f4f0e7'} disabled={disabled} onChange={(event) => { if (padRef.current) commit({ ...padRef.current, background: event.target.value }); }}><option value="#f4f0e7">Paper</option><option value="#182019">Dark</option><option value="#ffffff">White</option></select></label><div className="scratch-actions"><button type="button" aria-label="Undo drawing" title="Undo the last change (Ctrl/Cmd+Z on the board)" disabled={disabled || !undoCount} onClick={undo}><RotateCcw size={14} /></button><button type="button" disabled={disabled || !pad?.shapes.length} onClick={clear}><Trash2 size={13} />Clear canvas</button><button type="button" className="scratch-export" disabled={!pad || exporting} onClick={() => void exportPng()}><Download size={13} />{exporting ? 'Exporting…' : 'Export PNG'}</button></div></div>
      <div className="scratch-stage">{pad ? <svg ref={board} className="scratch-board" role="img" aria-label="Drawing board" tabIndex={0} viewBox={`0 0 ${pad.width} ${pad.height}`} width={pad.width} height={pad.height} onPointerDown={pointerDown} onPointerMove={(event) => { updateGesture(event); }} onPointerUp={pointerUp} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (activeGesture.current) cancelGesture(); }} onKeyDown={keyboard}><rect width={pad.width} height={pad.height} fill={pad.background} />{pad.shapes.map((shape) => <Shape shape={shape} key={shape.id} />)}{preview && <Shape shape={preview} />}</svg> : <div className="scratch-empty">{loading ? 'Opening a clean page…' : 'The saved scratchpad could not be opened. Its stored data has not been changed.'}</div>}</div>
      <div className="scratch-footer"><span>{pad ? `${pad.width} × ${pad.height} · ${pad.shapes.length} / 250 shapes` : 'Local vector drawing'}</span><span>Draw and release to save · Escape cancels a gesture · Undo keeps 10 changes in this view</span></div>
    </section>
  );
}
