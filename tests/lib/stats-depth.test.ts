import { describe, it, expect } from "vitest";
import { sourceBucket, mondayOf, weekDelta, shiftDate, SOURCE_BUCKET_LABEL } from "@/lib/stats";

describe("sourceBucket（来源分桶）", () => {
  it("空或无 referrer 归为直接访问", () => {
    expect(sourceBucket("")).toBe("direct");
    expect(sourceBucket("null")).toBe("external");
  });

  it("搜索引擎域名归为搜索引擎", () => {
    for (const d of ["baidu.com", "www.google.com", "bing.com", "sogou.com", "so.com", "yandex.ru"]) {
      expect(sourceBucket(d)).toBe("search");
    }
  });

  it("社交平台域名归为社交平台", () => {
    for (const d of ["weibo.com", "weixin.qq.com", "bilibili.com", "douyin.com"]) {
      expect(sourceBucket(d)).toBe("social");
    }
  });

  it("其余第三方域名归为外链", () => {
    expect(sourceBucket("github.com")).toBe("external");
    expect(sourceBucket("example.org")).toBe("external");
  });

  it("标签映射覆盖四类来源", () => {
    expect(Object.keys(SOURCE_BUCKET_LABEL)).toEqual(["direct", "search", "social", "external"]);
  });
});

describe("mondayOf（周一为一周起点）", () => {
  it("周中任意日回退到本周一", () => {
    expect(mondayOf("2026-09-03")).toBe("2026-08-31"); // 周四
    expect(mondayOf("2026-09-01")).toBe("2026-08-31"); // 周二
  });

  it("周一本身不变", () => {
    expect(mondayOf("2026-08-31")).toBe("2026-08-31");
  });

  it("周日归上周一", () => {
    expect(mondayOf("2026-09-06")).toBe("2026-08-31"); // 周日 → 上周一
  });
});

describe("weekDelta（周环比增幅）", () => {
  it("正常计算百分比并四舍五入", () => {
    expect(weekDelta(150, 100)).toBe(50);
    expect(weekDelta(50, 100)).toBe(-50);
    expect(weekDelta(199, 200)).toBe(0);
  });

  it("上周为 0 时，本周有量记 +100，无量记 0", () => {
    expect(weekDelta(10, 0)).toBe(100);
    expect(weekDelta(0, 0)).toBe(0);
  });
});

describe("shiftDate（日期偏移）", () => {
  it("跨月/跨年偏移正确", () => {
    expect(shiftDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});