import path from 'node:path';
import fs from 'node:fs/promises';
import * as OpenCC from 'opencc-js';

const ERAS = ['甲骨文', '金文', '战国文字', '篆书'];

// 偏好顺序：优先取较短文件名（一般是手描精修版），其次取首图
function pickImage(files) {
  if (!files || files.length === 0) return null;
  const sorted = [...files].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return sorted[0];
}

function lookupSingle(idx, ch) {
  return idx.chars[ch] || null;
}

function lookupWithConvert(idx, ch, converters) {
  const direct = lookupSingle(idx, ch);
  if (direct) return { hit: ch, buckets: direct };
  for (const conv of converters) {
    const ch2 = conv(ch);
    if (ch2 !== ch && idx.chars[ch2]) {
      return { hit: ch2, buckets: idx.chars[ch2] };
    }
  }
  return null;
}

export function createMatcher(idx, projectRoot) {
  const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
  const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
  const converters = [s2t, t2s];

  async function matchEntry(entry) {
    // 候选字 = 主字 + 异体
    const candidates = [entry.main, ...entry.variants];
    const result = {
      main: entry.main,
      variants: entry.variants,
      hit_via: null,        // 实际命中的字
      images: {},           // { era: { file, abs_path, relative } }
      sources: {},          // { era: 'evobc' | 'ccamc' }
      missing_eras: [],
    };

    let buckets = null;
    let hitCh = null;
    for (const c of candidates) {
      const r = lookupWithConvert(idx, c, converters);
      if (r) { buckets = r.buckets; hitCh = r.hit; break; }
    }

    if (buckets) {
      result.hit_via = hitCh;
      for (const era of ERAS) {
        const pick = pickImage(buckets[era]);
        if (pick) {
          const id = idx.char_to_id[hitCh];
          const rel = path.join(idx.images_root, id, pick);
          result.images[era] = {
            file: pick,
            abs_path: path.join(projectRoot, rel),
            relative: rel,
          };
          result.sources[era] = 'evobc';
        } else {
          result.missing_eras.push(era);
        }
      }
    } else {
      result.missing_eras = [...ERAS];
    }
    return result;
  }

  return { matchEntry };
}

export async function imageToBase64(absPath) {
  try {
    const buf = await fs.readFile(absPath);
    const ext = path.extname(absPath).slice(1).toLowerCase() || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
