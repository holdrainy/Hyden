import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Heading1, Minus, Plus, Rows3 } from 'lucide-react';
import type { WorkspaceSheet } from '../../lib/workspace-types';
import { alterSheet, columnLabel, evaluateSheet } from './formulas';
import './sheets.css';

export default function Sheets({ sheet, onChange, disabled = false }: {
  sheet: WorkspaceSheet;
  onChange: (sheet: WorkspaceSheet) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<[number, number]>([0, 0]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const evaluated = useMemo(() => evaluateSheet(sheet), [sheet]);
  const selectedAddress = `${columnLabel(selected[1])}${selected[0] + 1}`;

  useEffect(() => { setSelected([0, 0]); setEditing(null); setError(''); }, [sheet.id]);

  useEffect(() => {
    setSelected((position) => [Math.min(position[0], sheet.rows - 1), Math.min(position[1], sheet.columns - 1)]);
  }, [sheet.rows, sheet.columns]);

  const updateCell = (address: string, value: string) => {
    if (value.length > 2000) { setError('Each cell supports up to 2,000 characters.'); return; }
    setError('');
    const cells = { ...sheet.cells };
    if (value) cells[address] = value; else delete cells[address];
    onChange({ ...sheet, cells });
  };

  const structure = (axis: 'row' | 'column', action: 'insert' | 'delete') => {
    const position = axis === 'row' ? selected[0] : selected[1];
    try {
      const next = alterSheet(sheet, axis, action, action === 'insert' ? position + 1 : position);
      onChange(next);
      setEditing(null); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The sheet could not be changed.'); }
  };

  const focusCell = (row: number, column: number) => {
    const nextRow = Math.max(0, Math.min(sheet.rows - 1, row));
    const nextColumn = Math.max(0, Math.min(sheet.columns - 1, column));
    inputs.current.get(`${columnLabel(nextColumn)}${nextRow + 1}`)?.focus();
  };

  return (
    <section className="ws-sheet" aria-label="Spreadsheet editor">
      <div className="ws-sheet-toolbar" role="group" aria-label="Sheet structure">
        <div className="ws-sheet-tool-group"><span><Rows3 size={14} /> Rows</span><button aria-label="Add row" title="Insert below the selected row" onClick={() => structure('row', 'insert')} disabled={disabled || sheet.rows >= 200}><Plus size={13} /></button><button aria-label="Delete row" title="Delete selected row" onClick={() => structure('row', 'delete')} disabled={disabled || sheet.rows <= 1}><Minus size={13} /></button></div>
        <div className="ws-sheet-tool-group"><span><Columns3 size={14} /> Columns</span><button aria-label="Add column" title="Insert after the selected column" onClick={() => structure('column', 'insert')} disabled={disabled || sheet.columns >= 26}><Plus size={13} /></button><button aria-label="Delete column" title="Delete selected column" onClick={() => structure('column', 'delete')} disabled={disabled || sheet.columns <= 1}><Minus size={13} /></button></div>
        <button className="ws-sheet-header-toggle" aria-label="Format first row as header" aria-pressed={sheet.headerRow} disabled={disabled} onClick={() => onChange({ ...sheet, headerRow: !sheet.headerRow })}><Heading1 size={15} /> Header row</button>
        <span className="ws-sheet-dimensions">{sheet.rows} rows × {sheet.columns} columns</span>
      </div>
      <div className="ws-sheet-formula-bar"><span className="ws-sheet-address" aria-label="Selected cell">{selectedAddress}</span><span className="ws-sheet-fx" aria-hidden="true">ƒx</span><input aria-label="Cell formula" placeholder="A value, =SUM(A1:A3), or =A1*2" value={sheet.cells[selectedAddress] ?? ''} disabled={disabled} maxLength={2000} onChange={(event) => updateCell(selectedAddress, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); focusCell(...selected); } }} /></div>
      {error && <p className="ws-sheet-error" role="alert">{error}</p>}
      <div className="ws-sheet-scroll" tabIndex={0} role="region" aria-label="Sheet grid, scroll horizontally for more columns">
        <table className="ws-sheet-grid" aria-label={sheet.title}>
          <thead><tr><th className="ws-sheet-corner" scope="col"><span aria-hidden="true">⌑</span></th>{Array.from({ length: sheet.columns }, (_, col) => <th key={col} scope="col" className={selected[1] === col ? 'ws-sheet-coordinate-selected' : ''}><button aria-label={`Select column ${columnLabel(col)}`} onClick={() => setSelected(([row]) => [row, col])}>{columnLabel(col)}</button></th>)}</tr></thead>
          <tbody>{Array.from({ length: sheet.rows }, (_, row) => <tr key={row} className={sheet.headerRow && row === 0 ? 'ws-sheet-header-row' : ''}><th scope="row" className={selected[0] === row ? 'ws-sheet-coordinate-selected' : ''}><button aria-label={`Select row ${row + 1}`} onClick={() => setSelected(([, col]) => [row, col])}>{row + 1}</button></th>{Array.from({ length: sheet.columns }, (_, col) => {
            const address = `${columnLabel(col)}${row + 1}`;
            const value = evaluated[address] ?? '';
            const raw = sheet.cells[address] ?? '';
            const failed = typeof value === 'string' && /^#(?:REF|CYCLE|DIV|VALUE|ERROR|LIMIT)/.test(value);
            return <td key={address} className={`${address === selectedAddress ? 'ws-sheet-cell-selected' : ''} ${failed ? 'ws-sheet-cell-error' : ''}`}><input ref={(element) => { if (element) inputs.current.set(address, element); else inputs.current.delete(address); }} aria-label={`Cell ${address}`} aria-invalid={failed || undefined} title={failed ? `${value} — check this cell’s formula and references` : undefined} spellCheck={false} autoComplete="off" inputMode="text" disabled={disabled} value={editing === address ? raw : String(value)} maxLength={2000} onFocus={() => { setSelected([row, col]); setEditing(address); }} onBlur={() => setEditing((active) => active === address ? null : active)} onChange={(event) => updateCell(address, event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); focusCell(row + (event.shiftKey ? -1 : 1), col); }
              if (event.key === 'Tab') {
                const position = row * sheet.columns + col + (event.shiftKey ? -1 : 1);
                if (position >= 0 && position < sheet.rows * sheet.columns) { event.preventDefault(); focusCell(Math.floor(position / sheet.columns), position % sheet.columns); }
              }
              if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault(); focusCell(row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0), col + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0));
              }
              if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); }
            }} /></td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <div className="ws-sheet-footer"><span>Enter / Tab to move · Alt + arrow keys to navigate</span><span>Formulas: <code>=SUM(A1:A3)</code> · <code>=AVERAGE(A1:A3)</code> · <code>=A1*2</code></span></div>
      <p className="ws-sheet-note">Edits save locally. Insertions shift references; deleting a referenced row or column leaves an explicit #REF! error. Formula cells show their source while editing.</p>
    </section>
  );
}
