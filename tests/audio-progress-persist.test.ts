import { describe, it, expect } from "vitest";
import {
  PROGRESS_PERSIST_INTERVAL_MS,
  shouldPersistProgress,
} from "@/components/useAudioPlayer";

/**
 * 播放进度落盘节流。
 *
 * 背景：timeupdate 约每 250ms 触发一次，原实现每次都对整张进度表 JSON.stringify
 * 并**同步**写 localStorage —— 播放期间每秒约 4 次阻塞主线程，而续播只需要
 * 「大致对得上」。改为按间隔节流，并在暂停 / 关页面时补一次落盘。
 */
describe("shouldPersistProgress（进度落盘节流判定）", () => {
  it("间隔常量是 5 秒量级的合理值", () => {
    expect(PROGRESS_PERSIST_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    expect(PROGRESS_PERSIST_INTERVAL_MS).toBeLessThanOrEqual(30_000);
  });

  it("首次落盘（尚无记录）应写入", () => {
    expect(shouldPersistProgress(0, 1_700_000_000_000)).toBe(true);
  });

  it("距上次不足一个间隔时不再写入", () => {
    const last = 1_700_000_000_000;
    expect(shouldPersistProgress(last, last + 250)).toBe(false);
    expect(shouldPersistProgress(last, last + PROGRESS_PERSIST_INTERVAL_MS - 1)).toBe(false);
  });

  it("达到间隔即写入", () => {
    const last = 1_700_000_000_000;
    expect(shouldPersistProgress(last, last + PROGRESS_PERSIST_INTERVAL_MS)).toBe(true);
    expect(shouldPersistProgress(last, last + PROGRESS_PERSIST_INTERVAL_MS * 6)).toBe(true);
  });

  it("时间回拨（now 早于上次）时保持不写，避免异常时钟造成高频写", () => {
    const last = 1_700_000_000_000;
    expect(shouldPersistProgress(last, last - 5_000)).toBe(false);
  });
});
