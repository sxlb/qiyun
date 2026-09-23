import { describe, it, expect } from "vitest";
import { buildDailySeries, buildWeekHours, WEEKDAY_COUNT, HOURS_PER_DAY } from "@/lib/stats";

describe("buildDailySeries（趋势序列组装）", () => {
  const base = "2026-08-29";

  it("缺失日期补零，窗口取最近 N 天", () => {
    const records = [
      { date: "2026-08-27", pv: 5, uv: 1 },
      { date: "2026-08-29", pv: 10, uv: 2 },
    ];
    const series = buildDailySeries(records, 5, base);
    expect(series).toHaveLength(5);
    expect(series[4]).toEqual({ date: "2026-08-29", pv: 10, uv: 2 });
    expect(series[3]).toEqual({ date: "2026-08-28", pv: 0, uv: 0 });
    expect(series[0].date).toBe("2026-08-25");
  });

  it("记录超过窗口时只取最近 N 天", () => {
    const records = [
      { date: "2026-08-01", pv: 1, uv: 0 },
      { date: "2026-08-29", pv: 2, uv: 0 },
    ];
    const series = buildDailySeries(records, 3, base);
    expect(series).toHaveLength(3);
    expect(series[0].date).toBe("2026-08-27");
    expect(series.some((s) => s.date === "2026-08-01")).toBe(false);
  });

  it("空记录返回全零窗口", () => {
    const series = buildDailySeries([], 3, base);
    expect(series).toHaveLength(3);
    expect(series.every((s) => s.pv === 0 && s.uv === 0)).toBe(true);
  });
});

describe("buildWeekHours（一周时段热力图矩阵）", () => {
  it("固定尺寸 7×24，默认全零", () => {
    const grid = buildWeekHours([]);
    expect(grid).toHaveLength(WEEKDAY_COUNT);
    for (const row of grid) {
      expect(row).toHaveLength(HOURS_PER_DAY);
      expect(row.every((v) => v === 0)).toBe(true);
    }
  });

  it("按日期归一到星期，同一格累加", () => {
    // 2026-08-31 是周一、2026-08-30 是周日；检查周一(索引0)的 10 时会话
    const grid = buildWeekHours([
      { date: "2026-08-31", hour: 10, count: 3 },
      { date: "2026-08-31", hour: 10, count: 2 }, // 同一格累加 → 5
      { date: "2026-08-31", hour: 23, count: 1 }, // 周一的深夜
      { date: "2026-08-30", hour: 10, count: 9 }, // 周日(索引6)与周一不同格
    ]);
    expect(grid[0][10]).toBe(5);
    expect(grid[0][23]).toBe(1);
    expect(grid[6][10]).toBe(9);
    expect(grid[1][10]).toBe(0);
  });

  it("非法日期 / 越界小时被跳过，不影响其他格", () => {
    const grid = buildWeekHours([
      { date: "not-a-date", hour: 4, count: 1 },
      { date: "2026-08-31", hour: 99, count: 1 },
      { date: "2026-08-31", hour: -1, count: 1 },
      { date: "2026-08-31", hour: 7, count: 2 },
    ]);
    expect(grid[0][7]).toBe(2);
    const total = grid.flat().reduce((s, v) => s + v, 0);
    expect(total).toBe(2);
  });
});
