export interface HighlightToken { text: string; kind: 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'literal' }

const KEYWORDS = new Set(['as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default', 'else', 'elif', 'enum', 'except', 'export', 'extends', 'finally', 'fn', 'for', 'from', 'function', 'if', 'impl', 'import', 'in', 'interface', 'let', 'match', 'new', 'of', 'pass', 'pub', 'raise', 'return', 'self', 'static', 'struct', 'super', 'switch', 'throw', 'try', 'type', 'use', 'var', 'while', 'with', 'yield']);
const LANGUAGES = new Set(['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'python', 'py', 'rust', 'rs', 'json', 'bash', 'sh', 'shell', 'sql', 'css']);

/** Bounded lexical coloring only; source is always rendered as React text. */
export function highlightCode(source: string, language: string, tokenBudget = 1500): HighlightToken[] {
  if (!LANGUAGES.has(language.toLowerCase()) || tokenBudget <= 0) return [{ kind: 'plain', text: source }];
  const result: HighlightToken[] = [];
  const limit = 12000;
  const text = source.slice(0, limit);
  const pattern = /(?:\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    if (result.length >= Math.min(1500, tokenBudget)) break;
    const start = match.index ?? 0;
    if (start > position) result.push({ kind: 'plain', text: text.slice(position, start) });
    const token = match[0];
    const kind = /^(?:\/\/|#|\/\*)/.test(token) ? 'comment'
      : /^["'`]/.test(token) ? 'string'
      : /^\d/.test(token) ? 'number'
      : /^(?:true|false|null|None|True|False|undefined)$/.test(token) ? 'literal'
      : KEYWORDS.has(token) || (language === 'sql' && /^(?:SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|ON|AS|AND|OR|CREATE|TABLE)$/.test(token)) ? 'keyword' : 'plain';
    result.push({ kind, text: token });
    position = start + token.length;
  }
  if (position < source.length) result.push({ kind: 'plain', text: source.slice(position) });
  return result;
}
