import { DESIGN_LIMITS } from './design-types.ts';
import type { ParsedFigmaUrl } from './design-types.ts';

const HOSTS = new Set(['figma.com', 'www.figma.com', 'embed.figma.com']);
const QUERY_KEYS = ['node-id', 'page-id', 'viewport', 'scaling', 'content-scaling', 'starting-point-node-id', 'hide-ui', 'theme'] as const;

function invalid(): never {
  throw new Error('Use a public/shared HTTPS Figma design, prototype, or board link, or its Figma embed URL.');
}

/** Normalize only known Figma origins and document paths; never fetch or accept pasted HTML. */
export function parseFigmaUrl(input: string): ParsedFigmaUrl {
  return parse(input, 0);
}

function parse(input: string, depth: number): ParsedFigmaUrl {
  if (typeof input !== 'string' || !input.trim() || input.length > DESIGN_LIMITS.urlLength || /[\u0000-\u001f\u007f<>]/.test(input)) invalid();
  let url: URL;
  try { url = new URL(input.trim()); } catch { return invalid(); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) invalid();
  if ((url.hostname === 'figma.com' || url.hostname === 'www.figma.com') && /^\/embed\/?$/.test(url.pathname)) {
    const target = url.searchParams.getAll('url');
    if (depth >= 2 || target.length !== 1 || !target[0]) invalid();
    return parse(target[0], depth + 1);
  }
  const path = /^\/(design|file|proto|board)\/([A-Za-z0-9_-]{6,128})(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!path) invalid();
  const kind: ParsedFigmaUrl['kind'] = path[1] === 'file' ? 'design' : path[1] as ParsedFigmaUrl['kind'];
  let slug = '';
  if (path[3]) {
    try { slug = decodeURIComponent(path[3]); } catch { return invalid(); }
    if (slug.length > 512 || /[\\/\u0000-\u001f\u007f<>]/.test(slug) || slug === '.' || slug === '..') invalid();
  }
  const documentPath = `/${kind}/${path[2]}${slug ? `/${encodeURIComponent(slug)}` : ''}`;
  const source = new URL(`https://www.figma.com${documentPath}`);
  const embed = new URL(`https://embed.figma.com${documentPath}`);
  embed.searchParams.set('embed-host', 'share');
  for (const key of QUERY_KEYS) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1) invalid();
    if (!values.length) continue;
    const value = values[0];
    if (value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) invalid();
    source.searchParams.set(key, value);
    embed.searchParams.set(key, value);
  }
  if (source.href.length > DESIGN_LIMITS.urlLength || embed.href.length > DESIGN_LIMITS.urlLength) invalid();
  return { sourceUrl: source.href, embedUrl: embed.href, fileKey: path[2], kind };
}
