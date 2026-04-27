#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseInput } from './src/parser.js';
import { buildIndex } from './src/indexer.js';
import { createMatcher, imageToBase64 } from './src/matcher.js';
import { buildRefLinks } from './src/links.js';
import { renderHTML, renderRow } from './src/generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ERAS = ['甲骨文', '金文', '战国文字', '篆书'];

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      chars: { type: 'string' },
      output: { type: 'string', default: 'output/对照表.html' },
      offline: { type: 'boolean', default: true },
    },
  });

  if (!values.input && !values.chars) {
    console.error('用法：node cli.js --input <file.docx|.txt> 或 --chars "字符串" [--output out.html]');
    process.exit(1);
  }

  const projectRoot = __dirname;
  const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'config.json'), 'utf8'));

  const t0 = Date.now();

  console.log('▸ 解析输入...');
  const entries = await parseInput({ input: values.input, chars: values.chars });
  console.log(`  条目数：${entries.length}`);

  console.log('▸ 加载/构建 EVOBC 索引...');
  const idx = await buildIndex(config, projectRoot);
  console.log(`  索引收录字数：${Object.keys(idx.chars).length}`);

  console.log('▸ 匹配古文字图片...');
  const matcher = createMatcher(idx, projectRoot);
  const rows = [];
  let anyHit = 0;
  let allMiss = 0;
  const eraHits = Object.fromEntries(ERAS.map((e) => [e, 0]));

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const m = await matcher.matchEntry(entry);
    // 转 base64
    m.images_b64 = {};
    for (const era of ERAS) {
      const im = m.images[era];
      if (im) {
        const b64 = await imageToBase64(im.abs_path);
        if (b64) {
          m.images_b64[era] = b64;
          eraHits[era]++;
        }
      }
    }
    if (m.missing_eras.length === ERAS.length) allMiss++;
    else anyHit++;

    const refLinks = buildRefLinks(entry.main, config);
    rows.push(renderRow(i + 1, entry, m, refLinks));

    if ((i + 1) % 50 === 0) process.stdout.write('.');
    if ((i + 1) % 500 === 0) process.stdout.write(` ${i + 1}\n`);
  }
  process.stdout.write('\n');

  const elapsedSec = (Date.now() - t0) / 1000;
  const stats = { total: entries.length, anyHit, allMiss, elapsedSec, eraHits };

  console.log('▸ 渲染 HTML...');
  const html = renderHTML(rows, stats, entries);
  const outPath = path.resolve(projectRoot, values.output);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, html, 'utf8');

  console.log('—— 完成 ——');
  console.log(`  输出：${outPath}`);
  console.log(`  总条目：${stats.total}`);
  console.log(`  至少一种古文字形：${stats.anyHit}（${(100 * stats.anyHit / stats.total).toFixed(1)}%）`);
  console.log(`  完全未收录：${stats.allMiss}`);
  console.log(`  各时代命中：${ERAS.map((e) => `${e} ${eraHits[e]}`).join(' / ')}`);
  console.log(`  耗时：${elapsedSec.toFixed(1)}s`);
  const sizeKB = (await fs.stat(outPath)).size / 1024;
  console.log(`  HTML 体积：${sizeKB.toFixed(0)} KB`);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
