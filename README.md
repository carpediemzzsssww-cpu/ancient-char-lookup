# 古文字對照表生成器 / Ancient Char Lookup

一个面向文字学/古汉语/中文系学生的古文字字形对照工具。
输入汉字文本（或上传 .docx / .txt），即时生成「**現代漢字 · 甲骨文 · 金文 · 戰國文字 · 篆書**」对照表，可打印 A4 横向。

包含两个产品：

| | 谁用 | 数据源 | 特点 |
|---|---|---|---|
| **`web/`** Web 应用 | 任何人，浏览器打开即用 | ccamc.org（在线） | 部署在 Vercel，无须本地装任何东西 |
| **`cli/`** 本地 CLI | 大批量场景（>200 字）/ 高覆盖率需求 | EVOBC 离线数据集（13,714 字） | 1.7s 跑完 1233 字，99.6% 命中 |

## Web 应用（`web/`）

→ [在线访问](#) <!-- 部署后填 Vercel URL -->

```bash
cd web
npm install
npm run dev    # http://localhost:3000
```

技术栈：Next.js 14 App Router + TypeScript + Tailwind CSS · 部署 Vercel。

## 本地 CLI（`cli/`）

```bash
cd cli
npm install
# 下载 EVOBC 数据集（约 2GB）：https://figshare.com/s/ce2cf55b35a2f8ecc4c6
# 解压后整体放到 cli/data/evobc/
node cli.js --input char_list.txt --output output/对照表.html
```

参数：`--input <docx|txt>` 或 `--chars "字符串"`；`--offline` 跳过在线 fallback。

## 数据来源致谢

- **EVOBC 数据集**（用于 CLI）：华中科技大学白翔团队，[GitHub](https://github.com/RomanticGodVAN/character-Evolution-Dataset)
- **ccamc.org 開放古文字字形庫**（用于 Web）：CC0 授权
- 参考链接来源：[zi.tools 字統网](https://zi.tools)、[小学堂](https://xiaoxue.iis.sinica.edu.tw)、[漢典](https://www.zdic.net)

## License

MIT — see [LICENSE](./LICENSE)
