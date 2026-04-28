/**
 * 进程内健康指标。每个 Vercel function 实例独立计数；冷启动重置。
 * 用于：判断当前实例是否正在被反爬限制（连续 captcha 触发率高），
 * 以及 /api/probe 的诊断输出。
 */

const RECENT_WINDOW = 60; // 最近 60 次请求

let totalRequests = 0;
let totalCacheHits = 0;
let totalCaptchaHits = 0;
const recent: ('ok' | 'captcha' | 'empty' | 'error')[] = [];

export function recordRequest(outcome: 'ok' | 'captcha' | 'empty' | 'error') {
  totalRequests++;
  if (outcome === 'captcha') totalCaptchaHits++;
  recent.push(outcome);
  if (recent.length > RECENT_WINDOW) recent.shift();
}

export function recordCacheHit() {
  totalCacheHits++;
}

/** 最近窗口内 captcha 命中率 ≥ 0.5 视为反爬触发中 */
export function isAntiBotActive(): boolean {
  if (recent.length < 10) return false;
  const captchaCount = recent.filter((r) => r === 'captcha').length;
  return captchaCount / recent.length >= 0.5;
}

export function healthSnapshot() {
  const recentLen = recent.length;
  const captchaInRecent = recent.filter((r) => r === 'captcha').length;
  const okInRecent = recent.filter((r) => r === 'ok').length;
  return {
    totalRequests,
    totalCacheHits,
    totalCaptchaHits,
    cacheHitRate: totalRequests > 0 ? totalCacheHits / (totalCacheHits + totalRequests) : 0,
    recentWindow: recentLen,
    captchaInRecent,
    okInRecent,
    antiBotActive: isAntiBotActive(),
  };
}
