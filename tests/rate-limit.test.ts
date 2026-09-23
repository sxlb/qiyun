import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { isRateLimited, resetRateLimiter } from "@/lib/server";

describe("isRateLimited（滑动窗口限流）", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("窗口内第 61 次请求被限流（默认 60/分钟）", () => {
    const key = "test-key";
    for (let i = 0; i < 60; i++) {
      expect(isRateLimited(key)).toBe(false);
    }
    expect(isRateLimited(key)).toBe(true);
  });

  it("不同 key 相互隔离", () => {
    for (let i = 0; i < 60; i++) isRateLimited("key-a");
    expect(isRateLimited("key-b")).toBe(false);
    expect(isRateLimited("key-a")).toBe(true);
  });

  it("自定义阈值生效", () => {
    const key = "custom";
    expect(isRateLimited(key, 2)).toBe(false);
    expect(isRateLimited(key, 2)).toBe(false);
    expect(isRateLimited(key, 2)).toBe(true);
  });

  it("窗口过期后重新计数", () => {
    vi.useFakeTimers();
    const key = "window";
    const max = 2;
    const windowMs = 1000;

    expect(isRateLimited(key, max, windowMs)).toBe(false);
    expect(isRateLimited(key, max, windowMs)).toBe(false);
    expect(isRateLimited(key, max, windowMs)).toBe(true);

    // 用 fake timers 快进窗口，避免真实等待拖慢套件（原实现依赖 Date.now）
    vi.advanceTimersByTime(1100);
    expect(isRateLimited(key, max, windowMs)).toBe(false);
  });

  it("桶满时拒绝新 key 而非无界增长（内存 DoS 防护）", () => {
    vi.useFakeTimers();
    const max = 3;
    const windowMs = 60_000;
    // 填满默认桶上限（MAX_BUCKETS=10000），全部用长窗口 key 使清理阶段无法删除
    for (let i = 0; i < 10_000; i++) {
      expect(isRateLimited(`bulk-${i}`, max, windowMs)).toBe(false);
    }
    // 桶已满且清理不掉：新 key 直接被视为限流（拒绝插入）
    expect(isRateLimited("overflow-key", max, windowMs)).toBe(true);
  });
});
