import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMarkdown, inlineTokens, markdownToPlainText, parseMarkdown, prepareMarkdownPreview, toggleTask } from '../src/modules/Workspace/markdown-helpers.ts';

test('parses headings, task state and fenced code without interpreting HTML', () => {
  const blocks = parseMarkdown('# Notes\n\n- [ ] Next\n- [X] Done\n\n```js\nconst bold = "**literal**";\n<script>alert(1)</script>\n```\n\n<img src=x onerror=alert(1)>');
  assert.deepEqual(blocks[0], { type: 'heading', level: 1, text: 'Notes' });
  assert.deepEqual(blocks[1], { type: 'tasks', items: [{ text: 'Next', checked: false, line: 2 }, { text: 'Done', checked: true, line: 3 }] });
  assert.deepEqual(blocks[2], { type: 'code', text: 'const bold = "**literal**";\n<script>alert(1)</script>', language: 'js' });
  assert.deepEqual(blocks[3], { type: 'paragraph', text: '<img src=x onerror=alert(1)>' });
  assert.equal(parseMarkdown('```\nnot closed')[0].type, 'code');
});

test('inline formatting preserves text and literal inline code', () => {
  assert.deepEqual(inlineTokens('A **bold** _italic_ `a * b`'), [
    { type: 'text', text: 'A ' }, { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
    { type: 'text', text: ' ' }, { type: 'em', children: [{ type: 'text', text: 'italic' }] },
    { type: 'text', text: ' ' }, { type: 'code', text: 'a * b' },
  ]);
  assert.deepEqual(inlineTokens('\\*literal\\*'), [{ type: 'text', text: '*literal*' }]);
});

test('plain text export strips supported formatting while preserving code and task completion', () => {
  const source = '# Heading\n\nA **bold** and _italic_ thought.\n\n- [x] Done\n- [ ] Next\n\n```\na * b + c\n```';
  assert.equal(markdownToPlainText(source), 'Heading\n\nA bold and italic thought.\n\n[x] Done\n[ ] Next\n\na * b + c');
});

test('task toggles target exact source lines and preserve CRLF and other content', () => {
  const source = '# Header\r\n\r\n- [ ] One\r\n- [x] Two\r\n';
  assert.equal(toggleTask(source, 2), '# Header\r\n\r\n- [x] One\r\n- [x] Two\r\n');
  assert.equal(toggleTask(source, 3), '# Header\r\n\r\n- [ ] One\r\n- [ ] Two\r\n');
  assert.equal(toggleTask(source, 0), source);
  assert.equal(toggleTask(source, 99), source);
});

test('toolbar wraps and unwraps selected emphasis and gives a useful caret selection', () => {
  const bold = formatMarkdown('Hello world', 6, 11, 'bold');
  assert.deepEqual(bold, { text: 'Hello **world**', start: 8, end: 13 });
  assert.deepEqual(formatMarkdown(bold.text, bold.start, bold.end, 'bold'), { text: 'Hello world', start: 6, end: 11 });
  const empty = formatMarkdown('', 0, 0, 'italic');
  assert.equal(empty.text, '_italic text_');
  assert.equal(empty.text.slice(empty.start, empty.end), 'italic text');
});

test('toolbar formats selected lines, changes heading levels and surrounds code cleanly', () => {
  assert.equal(formatMarkdown('first\nsecond', 0, 12, 'task').text, '- [ ] first\n- [ ] second');
  assert.equal(formatMarkdown('## Heading', 3, 3, 'heading1').text, '# Heading');
  assert.equal(formatMarkdown('# Heading', 3, 3, 'heading1').text, 'Heading');
  const code = formatMarkdown('before after', 7, 12, 'code');
  assert.equal(code.text, 'before \n```\nafter\n```');
  assert.equal(code.text.slice(code.start, code.end), 'after');
});

test('preview budgets bound dense task and emphasis DOM without truncating saved or exported text', () => {
  const tasks = '- [ ] task\n'.repeat(10000);
  const taskPreview = prepareMarkdownPreview(tasks);
  assert.equal(taskPreview.truncated, true);
  assert.ok(taskPreview.nodeCount <= 2000);
  const taskBlock = taskPreview.blocks[0];
  assert.equal(taskBlock.type, 'tasks');
  if (taskBlock.type === 'tasks') {
    assert.ok(taskBlock.items.length < 500);
    assert.equal(taskBlock.items[0].line, 0);
    assert.equal(taskBlock.items[1].line, 1);
  }
  assert.equal(markdownToPlainText(tasks).split('\n').length, 10000, 'export includes every task');
  const emphasisPreview = prepareMarkdownPreview('**a** '.repeat(20000));
  assert.equal(emphasisPreview.truncated, true);
  assert.ok(emphasisPreview.nodeCount <= 2000);
  const linePreview = prepareMarkdownPreview('one\n'.repeat(2000), { characters: 20000, nodes: 10000 });
  assert.equal(linePreview.truncated, true, 'line cap independently bounds preview parsing');
  assert.equal(linePreview.blocks[0].type, 'paragraph');
  const small = prepareMarkdownPreview('# Heading\n\nText **bold**.');
  assert.equal(small.truncated, false);
});
