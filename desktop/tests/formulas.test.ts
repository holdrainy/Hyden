import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceSheet } from '../src/lib/workspace-types.ts';
import { alterSheet, columnLabel, evaluateSheet, toCsv, toSheetJson } from '../src/modules/Workspace/formulas.ts';

function sheet(cells: Record<string, string>, rows = 6, columns = 5): WorkspaceSheet {
  return { id: 'sheet', title: 'Test sheet', rows, columns, cells, headerRow: false, createdAt: 'now', updatedAt: 'now', revision: 1 };
}

test('evaluates arithmetic with precedence, unary operations, references and ranges', () => {
  const values = evaluateSheet(sheet({ A1: '2', A2: '4', A3: '=A1+A2*3', B1: '=SUM(A1:A3)', B2: '=AVERAGE(A1:A2)', C1: '=-(2+3)*4/2', C2: '=SUM(A1:A2, 10)', C3: '=SUM(A1, SUM(A2, 2))' }));
  assert.equal(values.A3, 14);
  assert.equal(values.B1, 20);
  assert.equal(values.B2, 3);
  assert.equal(values.C1, -10);
  assert.equal(values.C2, 16);
  assert.equal(values.C3, 8);
  assert.equal(values.D1, '');
  assert.equal(columnLabel(25), 'Z');
  assert.equal(columnLabel(26), 'AA');
});

test('propagates clear formula failures and refuses JavaScript or unsupported syntax', () => {
  const values = evaluateSheet(sheet({ A1: '=A2', A2: '=A1', A3: '=SUM(A1:A2)', B1: '=1/0', B2: '=Z999', B3: '=AVERAGE(C4:C5)', C1: 'hello', C2: '=C1+2', C3: '=globalThis.alert(1)', D1: '=SUM(1,', D2: '=2**3', D3: '=.5+1e2' }));
  assert.equal(values.A1, '#CYCLE!');
  assert.equal(values.A2, '#CYCLE!');
  assert.equal(values.A3, '#CYCLE!');
  assert.equal(values.B1, '#DIV/0!');
  assert.equal(values.B2, '#REF!');
  assert.equal(values.B3, '#DIV/0!');
  assert.equal(values.C2, '#VALUE!');
  assert.equal(values.C3, '#ERROR!');
  assert.equal(values.D1, '#ERROR!');
  assert.equal(values.D2, '#ERROR!');
  assert.equal(values.D3, 100.5);
});

test('range functions skip empty/text cells and propagate dependency errors', () => {
  const values = evaluateSheet(sheet({ A1: '10', A2: 'text', A4: '20', B1: '=SUM(A1:A4)', B2: '=AVERAGE(A1:A4)', B3: '=SUM(D4:D5)', C1: '=SUM(AA1:AB2)', C2: '=SUM(B4)', B4: '=1/0' }));
  assert.equal(values.B1, 30);
  assert.equal(values.B2, 15);
  assert.equal(values.B3, 0);
  assert.equal(values.C1, '#REF!');
  assert.equal(values.C2, '#DIV/0!');
});

test('nested/large expressions terminate with bounded limit errors', () => {
  const deep = '=' + '('.repeat(90) + '1' + ')'.repeat(90);
  assert.equal(evaluateSheet(sheet({ A1: deep })).A1, '#LIMIT!');
  assert.equal(evaluateSheet(sheet({ A1: '=' + '1+'.repeat(1001) + '1' })).A1, '#LIMIT!');
  const cells: Record<string, string> = {};
  for (let row = 1; row < 80; row++) cells[`A${row}`] = `=A${row + 1}`;
  cells.A80 = '1';
  assert.equal(evaluateSheet(sheet(cells, 80)).A1, '#LIMIT!');
});

test('row and column edits move cell content and preserve dependency identity', () => {
  const original = sheet({ A1: '3', A2: '4', B1: '=SUM(A1:A2)', C3: '=A2+B1' });
  const inserted = alterSheet(original, 'row', 'insert', 1);
  assert.equal(inserted.cells.A3, '4');
  assert.equal(inserted.cells.B1, '=SUM(A1:A3)');
  assert.equal(inserted.cells.C4, '=A3+B1');
  assert.equal(evaluateSheet(inserted).C4, 11);
  assert.deepEqual(original.cells, { A1: '3', A2: '4', B1: '=SUM(A1:A2)', C3: '=A2+B1' });
  const removed = alterSheet(original, 'row', 'delete', 1);
  assert.equal(removed.cells.B1, '=SUM(A1:#REF!)');
  assert.equal(removed.cells.C2, '=#REF!+B1');
  assert.equal(evaluateSheet(removed).C2, '#REF!');
  const columns = alterSheet(original, 'column', 'insert', 0);
  assert.equal(columns.cells.C1, '=SUM(B1:B2)');
  const deletedColumn = alterSheet(original, 'column', 'delete', 0);
  assert.equal(evaluateSheet(deletedColumn).A1, '#REF!');
  assert.throws(() => alterSheet(sheet({}, 1, 1), 'row', 'delete', 0), /at least one/);
  assert.throws(() => alterSheet(sheet({}, 200), 'row', 'insert', 0), /200/);
});

test('CSV exports calculated values, escapes quotes/newlines, and neutralizes formula-like text', () => {
  const data = sheet({ A1: '="unsafe"', B1: '@external', C1: ' -cmd', D1: '-12', A2: 'a,"quoted"\nvalue', B2: '=D1*2', C2: ' plain text ' }, 2, 4);
  const csv = toCsv(data);
  assert.equal(csv, '"#ERROR!","\'@external","\' -cmd","-12"\r\n"a,""quoted""\nvalue","-24"," plain text ",""');
  const exported = JSON.parse(toSheetJson(data));
  assert.equal(exported.version, 1);
  assert.equal(exported.sheet.cells.B2, '=D1*2');
  assert.equal(exported.sheet.rows, 2);
});

test('structural edits distinguish scientific number lexemes from cell references', () => {
  const data = sheet({ A1: '2', B1: '=1.E3 + .5e2 + 1E+3 + A1', B2: '=E3+1.E3', E3: '7' });
  const inserted = alterSheet(data, 'row', 'insert', 0);
  assert.equal(inserted.cells.B2, '=1.E3 + .5e2 + 1E+3 + A2');
  assert.equal(inserted.cells.B3, '=E4+1.E3');
  assert.equal(evaluateSheet(inserted).B2, 2052);
  assert.equal(evaluateSheet(inserted).B3, 1007);
  const removed = alterSheet(inserted, 'row', 'delete', 0);
  assert.equal(removed.cells.B1, data.cells.B1);
  assert.equal(removed.cells.B2, data.cells.B2);
  const columns = alterSheet(data, 'column', 'insert', 0);
  assert.equal(columns.cells.C1, '=1.E3 + .5e2 + 1E+3 + B1');
  assert.equal(columns.cells.C2, '=F3+1.E3');
  assert.equal(evaluateSheet(columns).C1, 2052);
});
