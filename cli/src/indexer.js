import fs from 'node:fs/promises';
import path from 'node:path';

// 解析图片文件名 -> era 代码
// 文件名形如：00746_Book_BI_1.png / 00001_Book_OBC_X_1027_1.png / 00746_Web_SS1_3.png
// 取第三段（Book/Web 之后那段），即 era 代码
const ERA_RE = /^\d+_(?:Book|Web)_([A-Z]+\d?)_/;

function eraFromFilename(name) {
  const m = name.match(ERA_RE);
  return m ? m[1] : null;
}

export async function buildIndex(config, projectRoot) {
  const indexPath = path.join(projectRoot, 'data/evobc_index.json');
  // 缓存命中
  try {
    const stat = await fs.stat(indexPath);
    if (stat.isFile()) {
      const raw = await fs.readFile(indexPath, 'utf8');
      const idx = JSON.parse(raw);
      return idx;
    }
  } catch {}

  // 重建
  const kvPath = path.join(projectRoot, config.evobc.key_value_file);
  const imagesRoot = path.join(projectRoot, config.evobc.images_root);

  const kvRaw = await fs.readFile(kvPath, 'utf8');
  const idToChar = JSON.parse(kvRaw);
  const charToId = {};
  for (const [id, ch] of Object.entries(idToChar)) {
    charToId[ch] = id;
  }

  // era_codes 反向：代码 -> 时代名
  const codeToEra = {};
  for (const [era, codes] of Object.entries(config.evobc.era_codes)) {
    for (const c of codes) codeToEra[c] = era;
  }

  // 扫每个 ID 文件夹
  const ids = await fs.readdir(imagesRoot);
  const charIndex = {}; // { ch: { era: [filename, ...] } }
  let scanned = 0;
  for (const id of ids) {
    const ch = idToChar[id];
    if (!ch) continue;
    const dir = path.join(imagesRoot, id);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    const buckets = {};
    for (const f of files) {
      const code = eraFromFilename(f);
      if (!code) continue;
      const era = codeToEra[code];
      if (!era) continue; // 跳过 CS（隶书）等
      (buckets[era] ??= []).push(f);
    }
    if (Object.keys(buckets).length > 0) {
      charIndex[ch] = buckets;
    }
    scanned++;
    if (scanned % 1000 === 0) {
      process.stdout.write(`  扫描进度: ${scanned}/${ids.length}\r`);
    }
  }
  process.stdout.write(`  扫描完成: ${scanned} 字目录\n`);

  const result = {
    images_root: config.evobc.images_root,
    chars: charIndex,
    char_to_id: charToId,
  };
  await fs.writeFile(indexPath, JSON.stringify(result), 'utf8');
  return result;
}
