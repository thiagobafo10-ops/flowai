export type TextChunk = { index: number; content: string; tokenCount: number };

const CHARS_PER_TOKEN = 4;

function hardCut(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Splits a paragraph larger than `size` into sentences, then hard cuts what is still too long. */
function splitOversized(paragraph: string, size: number): string[] {
  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) out.push(current);
    current = "";
  };
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > size) {
      flush();
      out.push(...hardCut(sentence, size));
    } else if (current && current.length + 1 + sentence.length > size) {
      flush();
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  flush();
  return out;
}

/** Last ~`overlap` characters of `text`, moved forward to the start of a word. */
function overlapSuffix(text: string, overlap: number): string {
  if (text.length <= overlap) return text;
  let suffix = text.slice(-overlap);
  if (!/\s/.test(text.charAt(text.length - overlap - 1))) {
    const ws = suffix.search(/\s/);
    if (ws >= 0) suffix = suffix.slice(ws);
  }
  return suffix.trim();
}

export function chunkText(
  text: string,
  opts: { maxTokens?: number; overlapTokens?: number } = {},
): TextChunk[] {
  const limit = (opts.maxTokens ?? 800) * CHARS_PER_TOKEN;
  const overlap = Math.min((opts.overlapTokens ?? 100) * CHARS_PER_TOKEN, Math.floor(limit / 4));
  const SEP = "\n\n";
  // A piece must fit alongside the overlap prefix of the next chunk.
  const pieceMax = limit - overlap - SEP.length;

  const pieces = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > pieceMax ? splitOversized(p, pieceMax) : [p]));

  const contents: string[] = [];
  let current = "";
  let currentHasNew = false;
  for (const piece of pieces) {
    if (currentHasNew && current.length + SEP.length + piece.length > limit) {
      contents.push(current);
      current = `${overlapSuffix(current, overlap)}${SEP}${piece}`;
    } else {
      current = current ? `${current}${SEP}${piece}` : piece;
    }
    currentHasNew = true;
  }
  if (current.trim()) contents.push(current);

  return contents.map((content, index) => ({
    index,
    content,
    tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
  }));
}
