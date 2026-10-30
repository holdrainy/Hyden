import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientPoint, countPenPoints, normalizeRectangle, penPath } from '../src/modules/Workspace/Design/drawing.ts';
import type { DesignShape } from '../src/lib/design-types.ts';

test('drawing pointer coordinates scale to logical paper and clamp to its edges', () => {
  const bounds = { left: 100, top: 50, width: 600, height: 400 };
  const board = { width: 1200, height: 800 };
  assert.deepEqual(clientPoint(250, 150, bounds, board), { x: 300, y: 200 });
  assert.deepEqual(clientPoint(20, 999, bounds, board), { x: 0, y: 800 });
  assert.throws(() => clientPoint(10, 10, { ...bounds, width: 0 }, board));
  assert.throws(() => clientPoint(Number.NaN, 10, bounds, board));
});

test('rectangle drags normalize every direction and ignore zero-area clicks', () => {
  assert.deepEqual(normalizeRectangle({ x: 300, y: 250 }, { x: 100, y: 50 }), { x: 100, y: 50, width: 200, height: 200 });
  assert.deepEqual(normalizeRectangle({ x: 100, y: 50 }, { x: 300, y: 250 }), { x: 100, y: 50, width: 200, height: 200 });
  assert.equal(normalizeRectangle({ x: 1, y: 1 }, { x: 1, y: 99 }), null);
  assert.throws(() => normalizeRectangle({ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 10 }));
});

test('pen geometry retains source points and point budgets exclude rectangles', () => {
  const points = [{ x: 12.5, y: 22 }, { x: 30, y: 40 }];
  assert.equal(penPath(points), 'M 12.5 22 L 30 40');
  const shapes: DesignShape[] = [
    { id: 'stroke-1', kind: 'pen', points, color: '#293329', width: 3 },
    { id: 'rect-1', kind: 'rectangle', x: 0, y: 0, width: 100, height: 50, color: '#293329', strokeWidth: 3 },
  ];
  assert.equal(countPenPoints(shapes), 2);
  assert.deepEqual(points, [{ x: 12.5, y: 22 }, { x: 30, y: 40 }]);
});
