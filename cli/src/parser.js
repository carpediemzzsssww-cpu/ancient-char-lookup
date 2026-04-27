import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';

const HAN_RE = /[一-鿿㐀-䶿]/u;
const HAN_GLOBAL = /[一-鿿㐀-䶿]/gu;

// 一行可能形如 "俯（頫）" / "爽（奭）" / "縣" / "类 ( 類 )"
// 主字 = 第一个汉字；括号内 = 异体字（也参与查找）
function parseLine(line) {
  const stripped = line.trim();
  if (!stripped) return null;

  // 找括号（中文/英文都支持）
  const m = stripped.match(/^([一-鿿㐀-䶿])\s*[（(]\s*([一-鿿㐀-䶿]+)\s*[）)]/u);
  if (m) {
    return { main: m[1], variants: m[2].split('') };
  }

  // 没有括号：取行内所有汉字，第一个为主字，其余作异体
  const chars = stripped.match(HAN_GLOBAL) || [];
  if (chars.length === 0) return null;
  return { main: chars[0], variants: chars.slice(1) };
}

export async function parseTxt(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return parseText(text);
}

export async function parseDocx(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  return parseText(value);
}

export function parseChars(str) {
  return parseText(str);
}

function parseText(text) {
  const entries = [];
  const seen = new Set();
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

export async function parseInput({ input, chars }) {
  if (chars) return parseChars(chars);
  if (!input) throw new Error('需要 --input 或 --chars 参数');
  const ext = path.extname(input).toLowerCase();
  if (ext === '.docx') return parseDocx(input);
  return parseTxt(input);
}
