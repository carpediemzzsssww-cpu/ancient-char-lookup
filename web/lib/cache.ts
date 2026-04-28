import type { Era, EraStatus, CharImages } from './ccamc';

type CachedShape = {
  hitChar: string;
  eras: Record<Era, string[]>;
  eraStatus: Record<Era, EraStatus>;
};

/**
 * 字 → 4 时代图片 URL 的缓存。
 *
 * 默认实现：进程内 Map（per Vercel-instance）。Vercel Function 实例通常会
 * 在持续流量下保持 warm（10-30 分钟），所以即使没有持久化 KV，热数据也能
 * 命中。冷启动会丢失——这是免费方案，对的起 0 元成本。
 *
 * 如果配置了 Vercel KV / Upstash Redis（环境变量 KV_REST_API_URL +
 * KV_REST_API_TOKEN），自动升级为持久缓存（30 天 TTL）。
 *
 * 缓存只存"成功"的结果。captcha 触发或 empty 不缓存——下次还能尝试。
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const MEM_MAX = 5000; // 进程内最多缓存 5000 字

type CacheEntry = CachedShape & { expiresAt: number };
const memCache = new Map<string, CacheEntry>();

function memGet(char: string): CacheEntry | null {
  const e = memCache.get(char);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    memCache.delete(char);
    return null;
  }
  return e;
}

function memSet(char: string, data: CachedShape) {
  if (memCache.size >= MEM_MAX) {
    const firstKey = memCache.keys().next().value;
    if (firstKey !== undefined) memCache.delete(firstKey);
  }
  memCache.set(char, { ...data, expiresAt: Date.now() + TTL_MS });
}

// --- 可选 KV 层（Upstash Redis REST API）---
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);
const KV_KEY_PREFIX = 'acl:char:'; // ancient-char-lookup

async function kvGet(char: string): Promise<CachedShape | null> {
  if (!KV_ENABLED) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${KV_KEY_PREFIX}${encodeURIComponent(char)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j?.result) return null;
    return JSON.parse(j.result);
  } catch {
    return null;
  }
}

async function kvSet(char: string, data: CachedShape): Promise<void> {
  if (!KV_ENABLED) return;
  try {
    const ttlSec = Math.floor(TTL_MS / 1000);
    await fetch(`${KV_URL}/set/${KV_KEY_PREFIX}${encodeURIComponent(char)}?EX=${ttlSec}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // 缓存写失败不影响主流程
  }
}

// --- 公开 API ---

export async function getCachedChar(char: string): Promise<CachedShape | null> {
  const m = memGet(char);
  if (m) return { hitChar: m.hitChar, eras: m.eras, eraStatus: m.eraStatus };
  if (KV_ENABLED) {
    const k = await kvGet(char);
    if (k) {
      memSet(char, k);
      return k;
    }
  }
  return null;
}

export async function setCachedChar(char: string, data: CachedShape): Promise<void> {
  const hasAny = Object.values(data.eras).some((v) => v.length > 0);
  if (!hasAny) return;
  memSet(char, data);
  if (KV_ENABLED) await kvSet(char, data);
}

export function cacheStats() {
  return {
    memSize: memCache.size,
    memMax: MEM_MAX,
    kvEnabled: KV_ENABLED,
  };
}

export type CachedCharImages = Pick<CharImages, 'char' | 'eras'> & { fromCache: boolean };
