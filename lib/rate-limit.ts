/**
 * 轻量内存滑动窗口限流器（按 key 计次，窗口内超过阈值返回 true）。
 * 适用于单实例部署（个人站点）；多实例 / Serverless 场景需改用 Redis 等共享存储。
 */
interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

/**
 * 判断 key 是否超过限流阈值（每 key 在 windowMs 窗口内最多允许 max 次）。
 */
export function isRateLimited(key: string, max = DEFAULT_MAX, windowMs = DEFAULT_WINDOW_MS): boolean {
  const now = Date.now();

  // 桶过多时先清理过期条目，避免无界增长
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart >= DEFAULT_WINDOW_MS) {
        buckets.delete(k);
      }
    }
    // 无论能否清理出空间，只要 Map 已占满就拒绝新 key 写入（被动防御）
    if (buckets.size >= MAX_BUCKETS) {
      return true;
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    // 新窗口
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

/** 清空限流状态（测试用） */
export function resetRateLimiter(): void {
  buckets.clear();
}