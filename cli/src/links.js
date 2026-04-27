export function buildRefLinks(char, config) {
  const tpl = config.reference_links;
  const encoded = encodeURIComponent(char);
  return [
    { name: '字統', url: tpl.zi_tools.replace('{char}', encoded) },
    { name: '古文字', url: tpl.ccamc.replace('{encoded}', encoded) },
    { name: '小學堂', url: tpl.xiaoxue.replace('{char}', encoded) },
    { name: '漢典', url: tpl.zdic.replace('{char}', encoded) },
  ];
}
