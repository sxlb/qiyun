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
      if (now - b.windowStart >= DEFAULT_WINDOW_MS) buckets.delete(k);
    }
    // 清理后仍满：驱逐最旧的一个 bucket（非当前 key），为新 key 腾出空间
    // 而非直接拒绝——防止攻击者用长窗口 key 塞满 Map 造成内存 DoS 同时误杀正常用户
    if (buckets.size >= MAX_BUCKETS) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, b] of buckets) {
        if (k !== key && b.windowStart < oldestTime) {
          oldestKey = k;
          oldestTime = b.windowStart;
        }
      }
      if (oldestKey) buckets.delete(oldestKey);
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
