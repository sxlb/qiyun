import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { resetRateLimiter } from "@/lib/server";

/** 真实浏览器 UA：路由会过滤爬虫/探针，测试必须携带人类 UA 才会真正计数 */
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
/** 爬虫 UA（用于验证过滤逻辑） */
const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/** 构造统计上报请求（可携带 UV Cookie；默认带真实浏览器 UA） */
function makeRequest(cookie?: string, ua: string = REAL_UA): NextRequest {
  const headers: Record<string, string> = { "user-agent": ua };
  if (cookie) headers.Cookie = cookie;
  return new NextRequest("http://localhost/api/stats", {
    method: "POST",
    headers,
  });
}

// 模拟 Prisma 客户端，避免连接真实数据库
const mocks = {
  findUnique: vi.fn(),
  aggregate: vi.fn(),
  upsert: vi.fn(),
  visitRecordCreate: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  prisma: {
    visitStat: {
      findUnique: (...args: unknown[]) => mocks.findUnique(...args),
      aggregate: (...args: unknown[]) => mocks.aggregate(...args),
      upsert: (...args: unknown[]) => mocks.upsert(...args),
    },
    // POST 明细写入（visitRecord.create）需 mock，否则路由内层 try/catch
    // 会吞掉 TypeError 并打印大量噪音日志（生产 schema 已含该模型，此仅为测试补齐）
    visitRecord: {
      create: (...args: unknown[]) => mocks.visitRecordCreate(...args),
    },
  },
}));

// 动态导入被测模块（在 mock 注册之后）
const { GET, POST } = await import("@/app/api/stats/route");

describe("stats API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // POST 在写库后还会查一次今日记录与累计（响应携带统计结果），
    // 这里给默认值，避免未覆盖的 mock 返回 undefined 导致 `.then((s)=>s._sum)` 报错
    mocks.findUnique.mockResolvedValue(null);
    mocks.aggregate.mockResolvedValue({ _sum: { pv: 0, uv: 0 } });
    // 清空 IP 限流状态，避免用例间互相影响
    resetRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET", () => {
    it("今日与累计数据均为 0 时返回默认值", async () => {
      mocks.findUnique.mockResolvedValue(null);
      mocks.aggregate.mockResolvedValue({ _sum: { pv: null, uv: null } });

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        todayPv: 0,
        todayUv: 0,
        totalPv: 0,
        totalUv: 0,
      });
    });

    it("存在今日记录与累计数据时正确返回", async () => {
      mocks.findUnique.mockResolvedValue({ date: "2026-08-07", pv: 10, uv: 3 });
      mocks.aggregate.mockResolvedValue({ _sum: { pv: 100, uv: 30 } });

      const res = await GET();
      const body = await res.json();

      expect(body).toEqual({
        todayPv: 10,
        todayUv: 3,
        totalPv: 100,
        totalUv: 30,
      });
    });

    it("数据库异常时返回 500", async () => {
      mocks.findUnique.mockRejectedValue(new Error("db down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await GET();
      expect(res.status).toBe(500);

      consoleSpy.mockRestore();
    });

    it("东八区日期边界：UTC 前一日 16:00（北京 00:00）归入当日", async () => {
      // Docker 容器默认 UTC，todayStr 显式按 UTC+8 计算，此处固定边界时间验证
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T16:00:00.000Z")); // 北京 2026-08-26 00:00
      mocks.findUnique.mockResolvedValue(null);
      mocks.aggregate.mockResolvedValue({ _sum: { pv: null, uv: null } });

      const res = await GET();
      await res.json();
      expect(mocks.findUnique).toHaveBeenCalledWith({ where: { date: "2026-08-26" } });
    });

    it("东八区日期边界：UTC 当日 15:59（北京 23:59）仍归当日", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T15:59:00.000Z")); // 北京 2026-08-25 23:59
      mocks.findUnique.mockResolvedValue(null);
      mocks.aggregate.mockResolvedValue({ _sum: { pv: null, uv: null } });

      const res = await GET();
      await res.json();
      expect(mocks.findUnique).toHaveBeenCalledWith({ where: { date: "2026-08-25" } });
    });
  });

  describe("POST", () => {
    it("首次访问（无 UV Cookie）：pv 与 uv 均 +1，并签发去重 Cookie", async () => {
      mocks.upsert.mockResolvedValue({});

      const res = await POST(makeRequest()) as NextResponse;

      expect(res.status).toBe(200);
      const [args] = mocks.upsert.mock.calls[0];
      expect(args.update).toEqual({
        pv: { increment: 1 },
        uv: { increment: 1 },
      });
      expect(args.create).toEqual({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        pv: 1,
        uv: 1,
      });
      // 服务端签发 httpOnly Cookie 用于后续 UV 去重，完整属性断言
      const cookie = res.cookies.get("qiyun-uv");
      expect(cookie?.value).toBe("1");
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("lax");
      expect(cookie?.path).toBe("/");
      expect(cookie?.maxAge).toBe(365 * 24 * 60 * 60);
    });

    it("老访客（携带 UV Cookie）：仅 pv +1，不再更新 uv", async () => {
      mocks.upsert.mockResolvedValue({});

      const res = await POST(makeRequest("qiyun-uv=1")) as NextResponse;

      expect(res.status).toBe(200);
      const [args] = mocks.upsert.mock.calls[0];
      expect(args.update).toEqual({ pv: { increment: 1 } });
      expect(args.create).toEqual({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        pv: 1,
        uv: 0,
      });
      // 老访客不再重复签发 Cookie
      expect(res.cookies.get("qiyun-uv")).toBeUndefined();
    });

    it("爬虫 UA 不计入统计：仅返回结果，不写库也不签发 Cookie", async () => {
      mocks.upsert.mockResolvedValue({});

      const res = await POST(makeRequest(undefined, BOT_UA)) as NextResponse;

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // 关键：不写汇总、不写明细、不签发 UV Cookie（避免蜘蛛刷高 PV/UV 与设备分布）
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(mocks.visitRecordCreate).not.toHaveBeenCalled();
      expect(res.cookies.get("qiyun-uv")).toBeUndefined();
    });

    it("空 UA 视为非人类流量，同样不计入", async () => {
      mocks.upsert.mockResolvedValue({});

      const res = await POST(makeRequest(undefined, "")) as NextResponse;

      expect(res.status).toBe(200);
      expect(mocks.upsert).not.toHaveBeenCalled();
    });

    it("同一 IP 高频请求触发限流（429），且不再写库", async () => {
      mocks.upsert.mockResolvedValue({});

      // 前 60 次正常放行（默认每分钟 60 次）
      for (let i = 0; i < 60; i++) {
        await POST(makeRequest("qiyun-uv=1"));
      }
      const res = await POST(makeRequest("qiyun-uv=1"));

      expect(res.status).toBe(429);
      expect(mocks.upsert).toHaveBeenCalledTimes(60);
    });

    it("数据库异常时返回 500", async () => {
      mocks.upsert.mockRejectedValue(new Error("db down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest());
      expect(res.status).toBe(500);

      consoleSpy.mockRestore();
    });
  });
});
