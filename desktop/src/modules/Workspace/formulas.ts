import type { WorkspaceSheet } from '../../lib/workspace-types.ts';

export type CellValue = string | number;
type SheetData = Pick<WorkspaceSheet, 'rows' | 'columns' | 'cells'>;
const MAX_STEPS = 100_000;
const ERRORS = new Set(['#REF!', '#CYCLE!', '#DIV/0!', '#VALUE!', '#ERROR!', '#LIMIT!']);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

class FormulaFault extends Error {
  constructor(code: string) { super(code); }
}

export function columnLabel(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + (value - 1) % 26) + label;
  }
  return label;
}

function coordinates(address: string): [number, number] | null {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  return Number.isSafeInteger(column) && Number.isSafeInteger(row) ? [row - 1, column - 1] : null;
}

interface Range { range: [string, string] }
type Value = CellValue | Range;
function numeric(value: Value): number {
  if (typeof value === 'object') throw new FormulaFault('#VALUE!');
  if (typeof value === 'number') return value;
  if (ERRORS.has(value)) throw new FormulaFault(value);
  if (value === '') return 0;
  if (NUMBER.test(value) && Number.isFinite(Number(value))) return Number(value);
  throw new FormulaFault('#VALUE!');
}

function tokenize(source: string): string[] {
  if (source.length > 2000) throw new FormulaFault('#LIMIT!');
  const tokens: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset++; continue; }
    const remaining = source.slice(offset);
    const match = /^(?:#(?:REF!|CYCLE!|DIV\/0!|VALUE!|ERROR!|LIMIT!)|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+[1-9]\d*|[a-z]+|[+\-*/(),:])/i.exec(remaining);
    if (!match) throw new FormulaFault('#ERROR!');
    tokens.push(match[0].toUpperCase());
    if (tokens.length > 1024) throw new FormulaFault('#LIMIT!');
    offset += match[0].length;
  }
  return tokens;
}

/** Small bounded recursive-descent interpreter. It never evaluates JavaScript. */
class FormulaParser {
  private index = 0;
  private depth = 0;
  private readonly tokens: string[];
  private readonly resolve: (address: string) => CellValue;
  private readonly rangeValues: (from: string, to: string) => CellValue[];
  private readonly step: () => void;

  constructor(source: string, resolve: (address: string) => CellValue, rangeValues: (from: string, to: string) => CellValue[], step: () => void) {
    this.tokens = tokenize(source); this.resolve = resolve; this.rangeValues = rangeValues; this.step = step;
  }

  run(): CellValue {
    if (!this.tokens.length) throw new FormulaFault('#ERROR!');
    const result = this.expression();
    if (this.index !== this.tokens.length) throw new FormulaFault('#ERROR!');
    if (typeof result === 'object') throw new FormulaFault('#VALUE!');
    return result;
  }

  private expression(): Value {
    let value = this.product();
    while (this.peek() === '+' || this.peek() === '-') {
      const operation = this.take();
      const rhs = this.product();
      value = this.finite(operation === '+' ? numeric(value) + numeric(rhs) : numeric(value) - numeric(rhs));
    }
    return value;
  }

  private product(): Value {
    let value = this.primary();
    while (this.peek() === '*' || this.peek() === '/') {
      const operation = this.take();
      const rhs = numeric(this.primary());
      if (operation === '/' && rhs === 0) throw new FormulaFault('#DIV/0!');
      value = this.finite(operation === '*' ? numeric(value) * rhs : numeric(value) / rhs);
    }
    return value;
  }

  private primary(): Value {
    this.step();
    if (++this.depth > 64) throw new FormulaFault('#LIMIT!');
    try {
      const token = this.take();
      if (token === '+' || token === '-') return this.finite((token === '-' ? -1 : 1) * numeric(this.primary()));
      if (token === '(') { const value = this.expression(); this.expect(')'); return value; }
      if (ERRORS.has(token)) throw new FormulaFault(token);
      if (NUMBER.test(token)) return this.finite(Number(token));
      if (/^[A-Z]+[1-9]\d*$/.test(token)) {
        if (this.peek() === ':') {
          this.take(); const end = this.take();
          if (!/^[A-Z]+[1-9]\d*$/.test(end)) throw new FormulaFault('#REF!');
          return { range: [token, end] };
        }
        return this.resolve(token);
      }
      if (token === 'SUM' || token === 'AVERAGE') {
        this.expect('(');
        const values: CellValue[] = [];
        if (this.peek() !== ')') {
          while (true) {
            const value = this.expression();
            values.push(...(typeof value === 'object' ? this.rangeValues(...value.range) : [value]));
            if (this.peek() !== ',') break;
            this.take();
          }
        }
        this.expect(')');
        const numbers: number[] = [];
        for (const value of values) {
          if (typeof value === 'string' && ERRORS.has(value)) throw new FormulaFault(value);
          if (typeof value === 'number') numbers.push(value);
          else if (value.trim() && NUMBER.test(value.trim())) numbers.push(numeric(value.trim()));
        }
        if (token === 'AVERAGE' && numbers.length === 0) throw new FormulaFault('#DIV/0!');
        const sum = numbers.reduce((total, number) => total + number, 0);
        return this.finite(token === 'SUM' ? sum : sum / numbers.length);
      }
      throw new FormulaFault('#ERROR!');
    } finally { this.depth--; }
  }

  private peek(): string { return this.tokens[this.index] ?? ''; }
  private take(): string { this.step(); return this.tokens[this.index++] ?? ''; }
  private expect(token: string) { if (this.take() !== token) throw new FormulaFault('#ERROR!'); }
  private finite(number: number) { if (!Number.isFinite(number)) throw new FormulaFault('#VALUE!'); return number; }
}

export function evaluateSheet(sheet: SheetData): Record<string, CellValue> {
  const result: Record<string, CellValue> = {};
  const visiting = new Set<string>();
  let steps = 0;
  const step = () => { if (++steps > MAX_STEPS) throw new FormulaFault('#LIMIT!'); };
  const resolve = (address: string): CellValue => {
    const coordinate = coordinates(address);
    if (!coordinate || coordinate[0] >= sheet.rows || coordinate[1] >= sheet.columns) return '#REF!';
    if (Object.hasOwn(result, address)) return result[address];
    if (visiting.has(address)) return '#CYCLE!';
    if (visiting.size >= 64) return '#LIMIT!';
    const raw = sheet.cells[address] ?? '';
    const trimmed = raw.trim();
    if (!trimmed.startsWith('=')) {
      result[address] = NUMBER.test(trimmed) && Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw;
      return result[address];
    }
    visiting.add(address);
    try {
      step();
      result[address] = new FormulaParser(trimmed.slice(1), resolve, (from, to) => {
        const start = coordinates(from); const end = coordinates(to);
        if (!start || !end || Math.max(start[0], end[0]) >= sheet.rows || Math.max(start[1], end[1]) >= sheet.columns) throw new FormulaFault('#REF!');
        const values: CellValue[] = [];
        for (let row = Math.min(start[0], end[0]); row <= Math.max(start[0], end[0]); row++) {
          for (let col = Math.min(start[1], end[1]); col <= Math.max(start[1], end[1]); col++) {
            step(); values.push(resolve(`${columnLabel(col)}${row + 1}`));
          }
        }
        return values;
      }, step).run();
    } catch (error) { result[address] = error instanceof FormulaFault ? error.message : '#ERROR!'; }
    finally { visiting.delete(address); }
    return result[address];
  };
  for (let row = 0; row < sheet.rows; row++) {
    for (let col = 0; col < sheet.columns; col++) resolve(`${columnLabel(col)}${row + 1}`);
  }
  return result;
}

/** Structural edits move data and rewrite references; deleted references stay explicit errors. */
export function alterSheet(sheet: WorkspaceSheet, axis: 'row' | 'column', action: 'insert' | 'delete', index: number): WorkspaceSheet {
  const size = axis === 'row' ? sheet.rows : sheet.columns;
  if (!Number.isInteger(index) || index < 0 || index > size || (action === 'delete' && index === size)) throw new Error('Choose a valid row or column.');
  if (action === 'delete' && size <= 1) throw new Error('Keep at least one row and column.');
  if (action === 'insert' && size >= (axis === 'row' ? 200 : 26)) throw new Error(axis === 'row' ? 'This sheet supports up to 200 rows.' : 'This sheet supports up to 26 columns.');
  const cells: Record<string, string> = {};
  const adjust = (row: number, col: number): [number, number] | null => {
    const value = axis === 'row' ? row : col;
    if (action === 'delete' && value === index) return null;
    const shifted = action === 'insert' ? value >= index ? value + 1 : value : value > index ? value - 1 : value;
    return axis === 'row' ? [shifted, col] : [row, shifted];
  };
  for (const [address, raw] of Object.entries(sheet.cells)) {
    const coordinate = coordinates(address);
    if (!coordinate) continue;
    const moved = adjust(...coordinate);
    if (!moved) continue;
    // Consume numeric lexemes before reference lexemes: the E3 in 1.E3 is an exponent,
    // whereas a standalone E3 is a reference. Preserve original spacing and case.
    const value = raw.trimStart().startsWith('=') ? raw.replace(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+[1-9]\d*|[a-z]+/gi, (reference) => {
      if (!/^[A-Z]+[1-9]\d*$/i.test(reference)) return reference;
      const ref = coordinates(reference);
      const next = ref && adjust(...ref);
      return next ? `${columnLabel(next[1])}${next[0] + 1}` : '#REF!';
    }) : raw;
    cells[`${columnLabel(moved[1])}${moved[0] + 1}`] = value;
  }
  return { ...sheet, rows: sheet.rows + (axis === 'row' ? action === 'insert' ? 1 : -1 : 0), columns: sheet.columns + (axis === 'column' ? action === 'insert' ? 1 : -1 : 0), cells };
}

export function toCsv(sheet: WorkspaceSheet): string {
  const evaluated = evaluateSheet(sheet);
  const escape = (value: CellValue) => {
    let text = String(value);
    if (typeof value === 'string' && (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return Array.from({ length: sheet.rows }, (_, row) => Array.from({ length: sheet.columns }, (_, col) => escape(evaluated[`${columnLabel(col)}${row + 1}`] ?? '')).join(',')).join('\r\n');
}

export function toSheetJson(sheet: WorkspaceSheet): string {
  return JSON.stringify({ version: 1, kind: 'hyden.sheet', sheet: { title: sheet.title, rows: sheet.rows, columns: sheet.columns, headerRow: sheet.headerRow, cells: sheet.cells } }, null, 2);
}
