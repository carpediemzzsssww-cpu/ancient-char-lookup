import mammoth from 'mammoth';

export type Entry = { main: string; variants: string[] };

const HAN_GLOBAL = /[一-鿿㐀-䶿]/gu;
const LINE_BRACKET_RE = /^([一-鿿㐀-䶿])\s*[（(]\s*([一-鿿㐀-䶿]+)\s*[）)]/u;

function parseLine(line: string): Entry | null {
  const stripped = line.trim();
  if (!stripped) return null;
  const m = stripped.match(LINE_BRACKET_RE);
  if (m && m[1] && m[2]) return { main: m[1], variants: m[2].split('') };
  const chars = stripped.match(HAN_GLOBAL) || [];
  const main = chars[0];
  if (!main) return null;
  return { main, variants: chars.slice(1) };
}

export function parseText(text: string): Entry[] {
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const e = parseLine(line);
    if (!e) continue;
    const key = e.main + '|' + e.variants.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }
  return entries;
}

export async function parseDocxBuffer(buf: Buffer): Promise<Entry[]> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return parseText(value);
}
