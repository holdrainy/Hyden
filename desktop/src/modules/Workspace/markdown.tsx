import type { ReactNode } from 'react';
import { prepareMarkdownPreview } from './markdown-helpers';
import type { InlineToken } from './markdown-helpers';

function Inline({ tokens }: { tokens: InlineToken[] }): ReactNode {
  return tokens.map((token, index) => {
    if (token.type === 'strong') return <strong key={index}><Inline tokens={token.children} /></strong>;
    if (token.type === 'em') return <em key={index}><Inline tokens={token.children} /></em>;
    if (token.type === 'code') return <code key={index}>{token.text}</code>;
    return 'text' in token ? token.text : null;
  });
}

export default function MarkdownPreview({ source, disabled, onToggleTask }: { source: string; disabled?: boolean; onToggleTask: (line: number) => void }) {
  const { blocks, truncated } = prepareMarkdownPreview(source);
  return (
    <div className="ws-note-rendered" aria-label="Formatted note preview">
      {blocks.length === 0 && <p className="ws-note-preview-empty">A little room for your next idea. Start writing, and your formatted note will appear here.</p>}
      {blocks.map((block, index) => {
        if (block.type === 'code') return <div className="ws-note-code-block" key={index}>{block.language && <span>{block.language}</span>}<pre><code>{block.text}</code></pre></div>;
        if (block.type === 'tasks') return <ul className="ws-note-task-list" key={index}>{block.items.map((item) => <li key={item.line}><label><input type="checkbox" checked={item.checked} disabled={disabled} aria-label={`Task: ${item.label || 'Untitled task'}`} onChange={() => onToggleTask(item.line)} /><span className={item.checked ? 'ws-note-task-complete' : ''}><Inline tokens={item.tokens} /></span></label></li>)}</ul>;
        if (block.type === 'list') return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><Inline tokens={item.tokens} /></li>)}</ul>;
        const contents = <Inline tokens={block.tokens} />;
        if (block.type === 'heading') {
          if (block.level === 1) return <h1 key={index}>{contents}</h1>;
          if (block.level === 2) return <h2 key={index}>{contents}</h2>;
          if (block.level === 3) return <h3 key={index}>{contents}</h3>;
          if (block.level === 4) return <h4 key={index}>{contents}</h4>;
          if (block.level === 5) return <h5 key={index}>{contents}</h5>;
          return <h6 key={index}>{contents}</h6>;
        }
        return <p key={index}>{contents}</p>;
      })}
      {truncated && <p className="ws-note-preview-limit">Preview is limited to keep editing light. Your full note stays in the editor and is included in exports.</p>}
    </div>
  );
}
