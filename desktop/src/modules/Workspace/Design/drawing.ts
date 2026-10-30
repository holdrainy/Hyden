import type { DesignPoint, DesignShape, ScratchpadDocument } from '../../../lib/design-types.ts';

export interface BoardBounds { left: number; top: number; width: number; height: number }

/** Map viewport pointer positions to the fixed drawing coordinates, including scaled layouts. */
export function clientPoint(clientX: number, clientY: number, bounds: BoardBounds, board: Pick<ScratchpadDocument, 'width' | 'height'>): DesignPoint {
  if (![clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height, board.width, board.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || board.width <= 0 || board.height <= 0) {
    throw new Error('The drawing surface is not ready.');
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    x: round(Math.max(0, Math.min(board.width, (clientX - bounds.left) * board.width / bounds.width))),
    y: round(Math.max(0, Math.min(board.height, (clientY - bounds.top) * board.height / bounds.height))),
  };
}

export function normalizeRectangle(from: DesignPoint, to: DesignPoint): { x: number; y: number; width: number; height: number } | null {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) throw new Error('Rectangle coordinates must be finite.');
  const width = Math.abs(to.x - from.x), height = Math.abs(to.y - from.y);
  if (width < 1 || height < 1) return null;
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width, height };
}

export function pointDistance(from: DesignPoint, to: DesignPoint): number { return Math.hypot(to.x - from.x, to.y - from.y); }

export function penPath(points: DesignPoint[]): string {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

export function countPenPoints(shapes: DesignShape[]): number {
  return shapes.reduce((total, shape) => total + (shape.kind === 'pen' ? shape.points.length : 0), 0);
}

/** The same logical geometry and paper color as the SVG board; no SVG/HTML parsing occurs. */
export function drawScratchpad(canvas: HTMLCanvasElement, board: ScratchpadDocument): void {
  if (!Number.isInteger(board.width) || !Number.isInteger(board.height) || board.width < 64 || board.height < 64 || board.width > 2048 || board.height > 2048 || board.width * board.height > 4 * 1024 * 1024 || board.shapes.length > 250 || !/^#[0-9a-f]{6}$/i.test(board.background)) {
    throw new Error('The scratchpad is outside the supported export limits.');
  }
  canvas.width = board.width; canvas.height = board.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser does not provide a drawing canvas.');
  context.fillStyle = board.background;
  context.fillRect(0, 0, board.width, board.height);
  context.lineCap = 'round'; context.lineJoin = 'round';
  for (const shape of board.shapes) {
    if (!/^#[0-9a-f]{6}$/i.test(shape.color)) throw new Error('The drawing contains an invalid color.');
    context.strokeStyle = shape.color; context.fillStyle = shape.color;
    if (shape.kind === 'pen') {
      if (!shape.points.length || shape.points.length > 2500 || !Number.isFinite(shape.width) || shape.width < 1 || shape.width > 24) throw new Error('The pen stroke is outside the supported limits.');
      context.lineWidth = shape.width;
      if (shape.points.length === 1) {
        context.beginPath(); context.arc(shape.points[0].x, shape.points[0].y, shape.width / 2, 0, Math.PI * 2); context.fill();
      } else {
        context.beginPath();
        shape.points.forEach((point, index) => { if (index) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y); });
        context.stroke();
      }
    } else {
      if (![shape.x, shape.y, shape.width, shape.height, shape.strokeWidth].every(Number.isFinite) || shape.width < 1 || shape.height < 1 || shape.strokeWidth < 1 || shape.strokeWidth > 24) throw new Error('The rectangle is outside the supported limits.');
      context.lineWidth = shape.strokeWidth;
      context.strokeRect(shape.x, shape.y, shape.width, shape.height);
    }
  }
}

export async function scratchpadPng(board: ScratchpadDocument): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    drawScratchpad(canvas, board);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob || blob.type !== 'image/png') reject(new Error('This browser could not encode the scratchpad as PNG.'));
        else resolve(blob);
      }, 'image/png');
    });
  } finally { canvas.width = 1; canvas.height = 1; }
}
