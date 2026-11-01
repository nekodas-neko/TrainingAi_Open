// A small Markdown reader for AI prose (Coach replies, digests). It covers what the current
// app's react-markdown + GFM output uses: headings, **bold**, *italic*, `code`, [links](https://…),
// bullet and numbered lists and simple pipe tables. Anything it doesn't recognise stays literal text,
// which also keeps a half-streamed token (an unclosed `**` or `[`) from rendering oddly.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'bullet'; children: Inline[] }
  | { type: 'number'; marker: string; children: Inline[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] };

const INLINE =
  /`([^`]+)`|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*(?=\S)(.+?)(?<=\S)\*\*(?!\*)|__(?=\S)(.+?)(?<=\S)__|\*(?=[^\s*])(.+?)(?<=[^\s*])\*|(?<![\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w])/;

/** Only web links are opened; anything else (javascript:, intent:, file:) is shown as plain text. */
export function safeLinkHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) break;
    if (m.index > 0) out.push({ type: 'text', text: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ type: 'code', text: m[1] });
    else if (m[2] !== undefined) {
      const href = safeLinkHref(m[3]);
      const children = parseInline(m[2]);
      if (href) out.push({ type: 'link', href, children });
      else out.push(...children);
    } else if (m[4] !== undefined || m[5] !== undefined)
      out.push({ type: 'bold', children: parseInline((m[4] ?? m[5])!) });
    else out.push({ type: 'italic', children: parseInline((m[6] ?? m[7])!) });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push({ type: 'text', text: rest });
  return out;
}

const SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && SEPARATOR.test(lines[i + 1])) {
      const header = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const row = cells(lines[i]);
        rows.push(header.map((_, c) => parseInline(row[c] ?? '')));
        i++;
      }
      i--;
      blocks.push({ type: 'table', header: header.map(parseInline), rows });
      continue;
    }
    const heading = /^#{1,6} +(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', children: parseInline(heading[1]) });
      continue;
    }
    const bullet = /^\s*[-*+] +(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ type: 'bullet', children: parseInline(bullet[1]) });
      continue;
    }
    const numbered = /^\s*(\d{1,3})[.)] +(.*)$/.exec(line);
    if (numbered) {
      blocks.push({ type: 'number', marker: `${numbered[1]}.`, children: parseInline(numbered[2]) });
      continue;
    }
    blocks.push({ type: 'paragraph', children: parseInline(line.trim()) });
  }
  return blocks;
}
