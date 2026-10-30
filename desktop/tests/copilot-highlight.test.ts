import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightCode } from '../src/modules/AICopilot/highlight.ts';

test('code highlighting is lossless and colors supported lexical tokens', () => {
  const source = 'def greet(name):\n    # Local only\n    return "Hello " + name + str(42)\n';
  const tokens = highlightCode(source, 'python');
  assert.equal(tokens.map((token) => token.text).join(''), source);
  assert.ok(tokens.some((token) => token.kind === 'keyword' && token.text === 'def'));
  assert.ok(tokens.some((token) => token.kind === 'comment'));
  assert.ok(tokens.some((token) => token.kind === 'string'));
  assert.ok(tokens.some((token) => token.kind === 'number'));
});

test('code highlighting caps output nodes while preserving all long or untrusted source', () => {
  const source = ('const x = "<script>alert(1)</script>"; // comment\n').repeat(2000);
  const tokens = highlightCode(source, 'javascript', 50);
  assert.equal(tokens.map((token) => token.text).join(''), source);
  assert.ok(tokens.filter((token) => token.kind !== 'plain').length <= 50);
  assert.equal(highlightCode(source, 'unsupported')[0].text, source);
  assert.deepEqual(highlightCode(source, 'javascript', 0), [{ kind: 'plain', text: source }]);
});

test('a shared highlighting budget bounds many code blocks without dropping code', () => {
  let budget = 40;
  const source = 'let count = 1; const answer = "text"; return true;';
  let colored = 0;
  for (let block = 0; block < 100; block++) {
    const tokens = highlightCode(source, 'typescript', budget);
    assert.equal(tokens.map((token) => token.text).join(''), source);
    const nodes = tokens.filter((token) => token.kind !== 'plain').length;
    colored += nodes;
    budget = Math.max(0, budget - nodes);
  }
  assert.ok(colored <= 40);
});
