export type RefLink = { name: string; url: string };

export function buildRefLinks(char: string): RefLink[] {
  const encoded = encodeURIComponent(char);
  return [
    { name: '字統', url: `https://zi.tools/zi/${encoded}` },
    { name: '古文字', url: `http://ccamc.org/cjkv_oaccgd.php?cjkv=${encoded}&type=oracle` },
    { name: '小學堂', url: `https://xiaoxue.iis.sinica.edu.tw/yanbian?char=${encoded}` },
    { name: '漢典', url: `https://www.zdic.net/hans/${encoded}` },
  ];
}
