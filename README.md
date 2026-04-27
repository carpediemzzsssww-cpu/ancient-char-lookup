# 古文字對照表生成器 / Ancient Char Lookup

文字学/古汉语作业辅助工具：输入汉字 → 生成「**現代漢字 · 甲骨文 · 金文 · 戰國文字 · 篆書**」对照表，可打印 A4。

包含两个产品，**主产品是本地 CLI**：

| | 用途 | 数据源 | 覆盖率 | 适用场景 |
|---|---|---|---|---|
| 🌟 **`cli/`** 本地 CLI | 生成完整对照表 | EVOBC 离线数据集 | **99.6%**（13,714 字） | 主推。作业级、高质量 |
| **`web/`** Web 导航表 | 生成 4 大字源庫的检索链接表 | 不抓图，纯链接 | 100% | 临时查询、手机随手用 |

## 🌟 本地 CLI（`cli/`）—— 推荐

```bash
cd cli
npm install

# 一次性下载 EVOBC 数据集（约 2GB）
# https://figshare.com/s/ce2cf55b35a2f8ecc4c6
# 解压后整体放到 cli/data/evobc/

node cli.js --input char_list.txt --output output/对照表.html
# 1.7s 跑完 1233 条字，99.6% 命中
```

参数：
- `--input <docx|txt>` 解析作业文件
- `--chars "字符串"` 直接传字
- `--output <path>` 输出位置（默认 `output/对照表.html`）
- `--offline` 跳过在线 fallback（默认即纯本地）

输出 HTML 特性：
- 8 列对照表：序号 / 现代汉字 / 甲骨文 / 金文 / 战国文字 / 篆书 / 参考链接 / 备注
- 图片 base64 内嵌（独立可分发）
- 顶部搜索框 + 全字索引云 + URL 锚点直达
- A4 横向打印优化（自动隐藏链接列）

## Web 导航表（`web/`）

> **在线访问：** https://ancient-char-lookup.vercel.app

⚠️ **重要说明**：Web 版**不内嵌古文字图片**，只生成 4 大字源庫的检索链接。原因如下。

### 为什么 Web 版不出完整对照表？

最初设计 Web 版时，计划用在线抓取 [ccamc.org 開放古文字字形庫](http://ccamc.org/) 的图片
（因为 EVOBC 离线数据集 2GB 大小，无法部署到 Vercel）。
实测后发现 ccamc.org 对密集请求会返回**验证码页面**反爬，无法稳定供 Web 服务使用。

折中方案：Web 版改为**字源导航表**——
- 上传/粘贴 → 解析 → 为每字生成 4 个权威字源庫的直达链接：
  [字統网](https://zi.tools)（最全字形演变 + 详细考释）·
  [古文字字形庫](http://ccamc.org)（CC0）·
  [小学堂](https://xiaoxue.iis.sinica.edu.tw)（CC0）·
  [汉典](https://www.zdic.net)
- 用户点链接到对应站点查看字形（无需自己一个个搜）
- 适合临时查阅；**对照表请用 CLI 生成**

### 本地开发

```bash
cd web
npm install
npm run dev    # http://localhost:3000
```

技术栈：Next.js 16 App Router · TypeScript · Tailwind CSS · 部署 Vercel。

## 数据来源致谢

- **EVOBC 数据集**：华中科技大学白翔团队 · [GitHub](https://github.com/RomanticGodVAN/character-Evolution-Dataset) · 229,170 张图，13,714 字类
- **ccamc.org 開放古文字字形庫**：CC0 授权
- **字統网 zi.tools**：字形演变综合查询平台
- **[小學堂](https://xiaoxue.iis.sinica.edu.tw)**：中央研究院数位文化中心
- **[漢典](https://www.zdic.net)**：综合汉字字典

## License

MIT — see [LICENSE](./LICENSE)
