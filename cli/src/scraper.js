// ccamc.org 在线 fallback —— 占位实现
// EVOBC + opencc 已覆盖 char_list.txt 99.3%，本轮先不实现真抓取
// 当 --offline=false 且需要 fallback 时调用 fetchEra() 返回 null（视为未命中）
// 后续如需要：使用 axios + cheerio，按 PRD A.5 第 4 步实现并发/重试/退避

export function createScraper(config) {
  return {
    async fetchEra(/* char, era */) {
      return null;
    },
  };
}
