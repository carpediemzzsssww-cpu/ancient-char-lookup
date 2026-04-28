/**
 * 进程内 mutex：同一字的并发请求合并成一次。
 *
 * 场景：用户字表里同一个字出现多次（前端已去重，但跨用户/跨请求依然可能同字）。
 * 多人同时查"令"，本来要打 N 次 ccamc，合并后只打 1 次。
 *
 * 内部用一个 in-flight Map：char → 正在进行的 Promise。
 * 同字第二次调用直接 await 同一个 Promise。
 */

const inFlight = new Map<string, Promise<unknown>>();

export async function withSingleflight<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p as Promise<T>;
}

export function inFlightCount() {
  return inFlight.size;
}
