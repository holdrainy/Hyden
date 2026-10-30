import type { ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { prepareMarkdownPreview } from '../Workspace/markdown-helpers';
import type { InlineToken } from '../Workspace/markdown-helpers';
import { highlightCode } from './highlight';

function Inline({ tokens }: { tokens: InlineToken[] }): ReactNode {
  return tokens.map((token, index) => {
    if (token.type === 'strong') return <strong key={index}><Inline tokens={token.children} /></strong>;
    if (token.type === 'em') return <em key={index}><Inline tokens={token.children} /></em>;
    if (token.type === 'code') return <code key={index}>{token.text}</code>;
    return 'text' in token ? token.text : null;
  });
}

export default function ChatMarkdown({ content, onCopy }: { content: string; onCopy: (text: string) => void }) {
  const { blocks, truncated } = prepareMarkdownPreview(content, { characters: 64000, lines: 1200, nodes: 2000 });
  let highlightBudget = 1500;
  return (
    <div className="ai-markdown">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          const highlighted = highlightCode(block.text, block.language, highlightBudget);
          highlightBudget = Math.max(0, highlightBudget - highlighted.filter((token) => token.kind !== 'plain').length);
          return <div className="ai-code-block" key={index}><div className="ai-code-heading"><span>{block.language || 'text'}</span><button aria-label="Copy code" onClick={() => onCopy(block.text)}><Copy size={11} />Copy</button></div><pre><code>{highlighted.map((token, tokenIndex) => token.kind === 'plain' ? token.text : <span className={`ai-token-${token.kind}`} key={tokenIndex}>{token.text}</span>)}</code></pre></div>;
        }
        if (block.type === 'list' || block.type === 'tasks') return <ul key={index} className={block.type === 'tasks' ? 'ai-task-list' : undefined}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{block.type === 'tasks' && <span aria-hidden="true">{'checked' in item && item.checked ? '☑' : '☐'} </span>}<Inline tokens={item.tokens} /></li>)}</ul>;
        const text = <Inline tokens={block.tokens} />;
        if (block.type === 'heading') return block.level === 1 ? <h3 key={index}>{text}</h3> : <h4 key={index}>{text}</h4>;
        return <p key={index}>{text}</p>;
      })}
      {truncated && <p className="ai-render-limit">Message preview is limited to keep the interface responsive. Copy the message to access all saved text.</p>}
    </div>
  );
}
