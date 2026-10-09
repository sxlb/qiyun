import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { amapSign } from "@/lib/amap";

/**
 * 后台「服务状态」里的高德探测。
 *
 * 回归背景：高德 Key 一旦开启「数字签名」，不带 sig 的请求会返回
 * HTTP 200 + INVALID_USER_SIGNATURE；而这里早期只传了 key，于是所有配好签名的站点
 * 都被显示成「Key 无效或权限不足」——用户拿着成对的 Key/私钥去排查一个根本不存在的错误。
 *
 * 本文件锁的是「探测请求真的带上了签名」，这是纯前端逻辑测不到的地方。
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  profileFindFirst: vi.fn(),
}));

vi.mock("@/lib/server", () => ({
  requireSession: mocks.requireSession,
  error: (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("@/lib/db", () => ({
  prisma: { profile: { findFirst: (...args: unknown[]) => mocks.profileFindFirst(...args) } },
}));

const KEY = "test-amap-key";
const SECRET = "abcsecret123";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** 本轮用例的实际出站请求 */
let calls: string[] = [];

/**
 * 桩掉出站请求。除高德外一律返回 200 —— 本文件只关心高德那一条探测项。
 * @param amapBody 高德响应的 body（HTTP 一律 200，高德正是这样表达失败的）
 */
function stubFetch(amapBody: unknown) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return jsonResponse(url.includes("restapi.amap.com") ? amapBody : { ok: true });
    })
  );
}

function baseProfile(over: Record<string, unknown> = {}) {
  return { amapKey: "", amapSecretKey: "", weatherCity: "", ...over };
}

interface HealthBody {
  services: Array<{ id: string; status: string; error?: string; url: string }>;
}

/** 每次都带 force=1：健康检查有 30 秒模块级缓存，不带会把上一个用例的结果复用过来 */
async function getHealth(): Promise<HealthBody> {
  const { GET } = await import("@/app/api/health/route");
  const res = await GET(new NextRequest("http://localhost:3000/api/health?force=1"));
  expect(res.status).toBe(200);
  return (await res.json()) as HealthBody;
}

function amapService(body: HealthBody) {
  const svc = body.services.find((s) => s.id === "amap");
  expect(svc, "配置了 amapKey 就应当出现高德探测项").toBeTruthy();
  return svc as { id: string; status: string; error?: string; url: string };
}

/** 取本轮高德探测的实际出站 URL */
function amapCall(): URL {
  const url = calls.find((u) => u.includes("restapi.amap.com"));
  expect(url, "应当真的发起了一次高德请求").toBeTruthy();
  return new URL(url as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: "admin" });
  mocks.profileFindFirst.mockResolvedValue(baseProfile({ amapKey: KEY, amapSecretKey: SECRET }));
  stubFetch({ status: "1", lives: [{ city: "北京市", weather: "晴" }] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("服务状态 · 高德探测", () => {
  it("探测请求必须带 sig，且与官方签名规范一致（漏签名会被高德拒绝）", async () => {
    const body = await getHealth();

    const url = amapCall();
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(url.searchParams.get("sig")).toBe(
      amapSign({ key: KEY, city: "210000", extensions: "base" }, SECRET)
    );
    expect(amapService(body).status).toBe("ok");
  });

  it("未配置城市时用国标 adcode 兜底（高德天气必须传 city，否则 20000 INVALID_PARAMS）", async () => {
    await getHealth();
    expect(amapCall().searchParams.get("city")).toBe("210000");
  });

  it("配置了固定城市时按配置的城市探测", async () => {
    mocks.profileFindFirst.mockResolvedValue(
      baseProfile({ amapKey: KEY, amapSecretKey: SECRET, weatherCity: "成都市" })
    );

    await getHealth();

    expect(decodeURIComponent(amapCall().searchParams.get("city") as string)).toBe("成都市");
  });

  it("没填私钥时不带 sig（未开数字签名的 Key 依然能正常探测）", async () => {
    mocks.profileFindFirst.mockResolvedValue(baseProfile({ amapKey: KEY, amapSecretKey: "" }));

    const body = await getHealth();

    expect(amapCall().searchParams.get("sig")).toBeNull();
    expect(amapService(body).status).toBe("ok");
  });

  it("签名不通过时给出「核对私钥」的提示，而不是误导性的 Key 无效", async () => {
    stubFetch({ status: "0", info: "INVALID_USER_SIGNATURE", infocode: "10007" });

    const body = await getHealth();

    const svc = amapService(body);
    expect(svc.status).toBe("fail");
    expect(svc.error).toContain("私钥");
    expect(svc.error).not.toContain("Key 无效");
  });

  it("Key 真无效时仍如实提示 Key 无效", async () => {
    stubFetch({ status: "0", info: "INVALID_USER_KEY", infocode: "10001" });

    expect(amapService(await getHealth()).error).toBe("Key 无效或权限不足");
  });

  it("对外返回的展示 URL 不能带上 key / sig（避免密钥随健康响应下发到页面）", async () => {
    const body = await getHealth();

    const svc = amapService(body);
    expect(svc.url).not.toContain(KEY);
    expect(svc.url).not.toContain(SECRET);
    expect(svc.url).not.toContain("sig=");
  });

  it("未配置高德 Key 时不产生高德探测项，也不发请求", async () => {
    mocks.profileFindFirst.mockResolvedValue(baseProfile());

    const body = await getHealth();

    expect(body.services.some((s) => s.id === "amap")).toBe(false);
    expect(calls.some((u) => u.includes("restapi.amap.com"))).toBe(false);
  });
});
