export type InlineToken =
  | { type: 'text' | 'code'; text: string }
  | { type: 'strong' | 'em'; children: InlineToken[] };

export type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string; language: string }
  | { type: 'list'; items: { text: string }[] }
  | { type: 'tasks'; items: { text: string; checked: boolean; line: number }[] };

export type NoteFormat = 'heading1' | 'heading2' | 'heading3' | 'bold' | 'italic' | 'task' | 'code';

export type MarkdownPreviewBlock =
  | { type: 'heading'; level: number; tokens: InlineToken[] }
  | { type: 'paragraph'; tokens: InlineToken[] }
  | { type: 'code'; text: string; language: string }
  | { type: 'list'; items: { tokens: InlineToken[] }[] }
  | { type: 'tasks'; items: { tokens: InlineToken[]; label: string; checked: boolean; line: number }[] };

interface PreviewLimits { characters?: number; lines?: number; nodes?: number }

/** A deliberately small Markdown subset. Raw HTML stays ordinary text. */
export function inlineTokens(source: string, depth = 0): InlineToken[] {
  if (depth > 4) return [{ type: 'text', text: source }];
  const tokens: InlineToken[] = [];
  let text = '';
  const flush = () => { if (text) { tokens.push({ type: 'text', text }); text = ''; } };
  for (let position = 0; position < source.length;) {
    if (source[position] === '\\' && position + 1 < source.length && /[\\*_`]/.test(source[position + 1])) {
      text += source[position + 1]; position += 2; continue;
    }
    const marker = source.startsWith('**', position) ? '**'
      : source.startsWith('__', position) ? '__'
      : ['*', '_', '`'].includes(source[position]) ? source[position] : '';
    if (marker) {
      const end = source.indexOf(marker, position + marker.length);
      if (end > position + marker.length) {
        flush();
        const content = source.slice(position + marker.length, end);
        if (marker === '`') tokens.push({ type: 'code', text: content });
        else tokens.push({ type: marker.length === 2 ? 'strong' : 'em', children: inlineTokens(content, depth + 1) });
        position = end + marker.length;
        continue;
      }
    }
    text += source[position]; position++;
  }
  flush();
  return tokens;
}

const taskPattern = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const bulletPattern = /^\s*[-*+]\s+(.*)$/;
const headingPattern = /^(#{1,6})\s+(.*)$/;
const fencePattern = /^\s*```([^`]*)$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  for (let line = 0; line < lines.length;) {
    const value = lines[line];
    if (!value.trim()) { line++; continue; }
    const fence = value.match(fencePattern);
    if (fence) {
      const code: string[] = [];
      line++;
      while (line < lines.length && !/^\s*```\s*$/.test(lines[line])) code.push(lines[line++]);
      if (line < lines.length) line++;
      blocks.push({ type: 'code', text: code.join('\n'), language: fence[1].trim() });
      continue;
    }
    const heading = value.match(headingPattern);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); line++; continue; }
    if (taskPattern.test(value)) {
      const items: Extract<MarkdownBlock, { type: 'tasks' }>['items'] = [];
      while (line < lines.length) {
        const task = lines[line].match(taskPattern);
        if (!task) break;
        items.push({ text: task[2], checked: task[1].toLowerCase() === 'x', line }); line++;
      }
      blocks.push({ type: 'tasks', items }); continue;
    }
    if (bulletPattern.test(value)) {
      const items: { text: string }[] = [];
      while (line < lines.length && !taskPattern.test(lines[line])) {
        const bullet = lines[line].match(bulletPattern);
        if (!bullet) break;
        items.push({ text: bullet[1] }); line++;
      }
      blocks.push({ type: 'list', items }); continue;
    }
    const paragraph = [value]; line++;
    while (line < lines.length && lines[line].trim() && !headingPattern.test(lines[line]) && !fencePattern.test(lines[line]) && !bulletPattern.test(lines[line])) {
      paragraph.push(lines[line++]);
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

/** Bound preview DOM work independently of the full saved/exported Markdown document. */
export function prepareMarkdownPreview(source: string, limits: PreviewLimits = {}): { blocks: MarkdownPreviewBlock[]; truncated: boolean; nodeCount: number } {
  const maxCharacters = Math.max(0, limits.characters ?? 60000);
  const maxLines = Math.max(0, limits.lines ?? 1000);
  const maxNodes = Math.max(0, limits.nodes ?? 2000);
  let truncated = source.length > maxCharacters;
  const lines = source.slice(0, maxCharacters).split(/\r?\n/);
  if (lines.length > maxLines) truncated = true;
  let remaining = maxNodes;
  const take = (count: number) => {
    if (remaining < count) { truncated = true; return false; }
    remaining -= count; return true;
  };
  const limitInline = (tokens: InlineToken[]): InlineToken[] => {
    const result: InlineToken[] = [];
    for (const token of tokens) {
      if ('text' in token) {
        if (!take(token.type === 'code' ? 2 : 1)) break;
        result.push(token);
      } else {
        if (!take(1)) break;
        result.push({ type: token.type, children: limitInline(token.children) });
      }
    }
    return result;
  };
  const blocks: MarkdownPreviewBlock[] = [];
  for (const block of parseMarkdown(lines.slice(0, maxLines).join('\n'))) {
    if (block.type === 'code') {
      // div, pre, code, text; optional language span + text.
      if (!take(block.language ? 6 : 4)) break;
      blocks.push(block); continue;
    }
    if (!take(1)) break;
    if (block.type === 'tasks') {
      const items: Extract<MarkdownPreviewBlock, { type: 'tasks' }>['items'] = [];
      for (const item of block.items) {
        // li, label, input, span; inline content has its own budget.
        if (!take(4)) break;
        items.push({ tokens: limitInline(inlineTokens(item.text)), label: item.text, checked: item.checked, line: item.line });
      }
      blocks.push({ type: 'tasks', items });
    } else if (block.type === 'list') {
      const items: { tokens: InlineToken[] }[] = [];
      for (const item of block.items) {
        if (!take(1)) break;
        items.push({ tokens: limitInline(inlineTokens(item.text)) });
      }
      blocks.push({ type: 'list', items });
    } else {
      const tokens = limitInline(inlineTokens(block.text));
      blocks.push(block.type === 'heading' ? { type: 'heading', level: block.level, tokens } : { type: 'paragraph', tokens });
    }
  }
  return { blocks, truncated, nodeCount: maxNodes - remaining };
}

function plainInline(tokens: InlineToken[]): string {
  return tokens.map((token) => 'text' in token ? token.text : plainInline(token.children)).join('');
}

/** Export readable text without treating code or raw HTML as formatting. */
export function markdownToPlainText(source: string): string {
  return parseMarkdown(source).map((block) => {
    if (block.type === 'code') return block.text;
    if (block.type === 'tasks') return block.items.map((item) => `[${item.checked ? 'x' : ' '}] ${plainInline(inlineTokens(item.text))}`).join('\n');
    if (block.type === 'list') return block.items.map((item) => `• ${plainInline(inlineTokens(item.text))}`).join('\n');
    return plainInline(inlineTokens(block.text));
  }).join('\n\n');
}

export function toggleTask(source: string, line: number): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return source;
  lines[line] = lines[line].replace(/^(\s*[-*+]\s+\[)([ xX])(\].*)$/, (_match, before: string, checked: string, after: string) => `${before}${checked === ' ' ? 'x' : ' '}${after}`);
  return lines.join(newline);
}

export function formatMarkdown(source: string, start: number, end: number, format: NoteFormat): { text: string; start: number; end: number } {
  start = Math.min(source.length, Math.max(0, start));
  end = Math.min(source.length, Math.max(start, end));
  const replace = (from: number, to: number, replacement: string, selectionStart: number, selectionEnd: number) => ({
    text: source.slice(0, from) + replacement + source.slice(to), start: selectionStart, end: selectionEnd,
  });
  if (format === 'bold' || format === 'italic') {
    const marker = format === 'bold' ? '**' : '_';
    const selected = source.slice(start, end);
    if (source.slice(start - marker.length, start) === marker && source.slice(end, end + marker.length) === marker) {
      return replace(start - marker.length, end + marker.length, selected, start - marker.length, end - marker.length);
    }
    const content = selected || (format === 'bold' ? 'bold text' : 'italic text');
    return replace(start, end, marker + content + marker, start + marker.length, start + marker.length + content.length);
  }
  if (format === 'code') {
    const before = start > 0 && source[start - 1] !== '\n' ? '\n' : '';
    const after = end < source.length && source[end] !== '\n' ? '\n' : '';
    const content = source.slice(start, end) || 'code here';
    const opening = `${before}\`\`\`\n`;
    return replace(start, end, `${opening}${content}\n\`\`\`${after}`, start + opening.length, start + opening.length + content.length);
  }
  const from = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1;
  const lastSelectedCharacter = end > start && source[end - 1] === '\n' ? end - 1 : end;
  const nextNewline = source.indexOf('\n', lastSelectedCharacter);
  const to = nextNewline < 0 ? source.length : nextNewline;
  const lines = source.slice(from, to).split('\n');
  const prefix = format === 'task' ? '- [ ] ' : `${'#'.repeat(Number(format.slice(-1)))} `;
  const alreadyFormatted = lines.every((line) => format === 'task' ? taskPattern.test(line) : line.startsWith(prefix));
  const formatted = lines.map((line) => {
    if (alreadyFormatted) return format === 'task' ? line.replace(/^\s*[-*+]\s+\[[ xX]\]\s?/, '') : line.slice(prefix.length);
    const content = format === 'task' ? line.replace(/^\s*[-*+]\s+\[[ xX]\]\s?/, '') : line.replace(/^#{1,6}\s+/, '');
    return prefix + content;
  }).join('\n');
  return replace(from, to, formatted, from, from + formatted.length);
}
