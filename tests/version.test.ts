import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchLatestRelease, resetReleaseCache } from "../lib/version";

const OFFICIAL = "https://api.github.com";
const PROXY_BASE = "https://gh-proxy.com/https://api.github.com";
const RELEASE_PATH = "/repos/sxlb/qiyun/releases/latest";

const OK_BODY = {
  tag_name: "0.0.5",
  name: "v0.0.5",
  body: "b",
  html_url: "https://github.com/sxlb/qiyun/releases/tag/0.0.5",
  published_at: "2026-01-01T00:00:00Z",
};

/** 单个源的模拟结果：HTTP 状态码 / 连接失败 / 超时 / 无响应 */
type SourceResult = number | "net" | "timeout" | null;

/** 按 URL 区分官方与镜像，返回差异化结果，并记录请求过的地址 */
function mockFetch(opts: { official: SourceResult; proxy: SourceResult }) {
  const requested: string[] = [];
  const fn = vi.fn(async (url: string) => {
    requested.push(url);
    const s = url.startsWith(OFFICIAL) ? opts.official : opts.proxy;
    if (s === "net") throw new TypeError("fetch failed");
    if (s === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (s === undefined || s === null) return { ok: false, status: 0, json: async () => ({}) };
    return { ok: s >= 200 && s < 300, status: s, json: async () => OK_BODY };
  });
  vi.stubGlobal("fetch", fn);
  return { requested };
}

describe("fetchLatestRelease 多源降级", () => {
  // 用例必须与环境隔离：lib/version 会读取宿主机版本缓存（DATA_DIR/latest.json），
  // 开发/部署机上的真实缓存会被当作"新鲜结果"直接返回，让用例变成依赖机器状态的假失败。
  // 这里把 DATA_DIR 指向空临时目录（即"无缓存"），并在每个用例前重建。
  let tmp: string;
  const savedDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    resetReleaseCache();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-version-"));
    process.env.DATA_DIR = tmp;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
  });

  it("官方可达时优先走官方并成功", async () => {
    mockFetch({ official: 200, proxy: 200 });
    const r = await fetchLatestRelease();
    expect(r.data?.version).toBe("0.0.5");
    expect(r.error).toBeUndefined();
  });

  it("官方不通时降级到公共代理并成功", async () => {
    mockFetch({ official: "net", proxy: 200 });
    const r = await fetchLatestRelease();
    expect(r.data?.version).toBe("0.0.5");
  });

  it("镜像地址必须是「代理前缀 + 官方完整地址」，不能拼成 /repos/... 路径形式", async () => {
    // 回归：base 少写上游地址时会拼出 https://gh-proxy.com/repos/...，实测返回 403（Cloudflare Error 1000），
    // 于是「官方抖动时降级到镜像」这条兜底路径实际从未生效。
    const { requested } = mockFetch({ official: "net", proxy: 200 });
    await fetchLatestRelease();

    expect(requested).toContain(`${PROXY_BASE}${RELEASE_PATH}`);
    expect(requested.some((u) => /^https:\/\/gh-proxy\.com\/repos\//.test(u))).toBe(false);
  });

  it("官方与全部代理均失败时返回友好文案而非抛底层异常", async () => {
    mockFetch({ official: null, proxy: null });
    const r = await fetchLatestRelease();
    expect(r.data).toBeNull();
    expect(r.error).toBeDefined();
    expect(r.error).not.toMatch(/aborted|timeout|fetch failed/i); // 不透传底层英文原文
  });

  it("官方被限流（403）时，错误文案点出状态码而不是笼统的「网络错误」", async () => {
    mockFetch({ official: 403, proxy: 403 });
    const r = await fetchLatestRelease();
    expect(r.data).toBeNull();
    expect(r.error).toContain("403");
  });

  it("官方连接失败 + 镜像 403 时，按官方的真实原因报错（不被镜像状态掩盖）", async () => {
    mockFetch({ official: "net", proxy: 403 });
    const r = await fetchLatestRelease();
    expect(r.data).toBeNull();
    expect(r.error).toBe("网络错误，获取最新版本失败，请重试");
  });

  it("官方超时 + 镜像 403 时，报超时提示", async () => {
    mockFetch({ official: "timeout", proxy: 403 });
    const r = await fetchLatestRelease();
    expect(r.data).toBeNull();
    expect(r.error).toContain("超时");
  });

  it("官方 404（无 release）优先判定为「暂无已发布的版本」", async () => {
    mockFetch({ official: 404, proxy: 403 });
    const r = await fetchLatestRelease();
    expect(r.data).toBeNull();
    expect(r.error).toContain("暂无已发布");
  });

  it("宿主机缓存新鲜时直接采用，不打网络（避免每次进后台都请求 GitHub）", async () => {
    writeHostCache(Date.now());
    const { requested } = mockFetch({ official: 200, proxy: 200 });
    const r = await fetchLatestRelease();
    expect(r.data?.version).toBe("0.0.1");
    expect(r.fromCache).toBe(true);
    expect(requested).toHaveLength(0);
  });

  it("「检测更新」强制刷新（force）绕过宿主机缓存，仍走网络取真实最新版", async () => {
    writeHostCache(Date.now());
    const { requested } = mockFetch({ official: 200, proxy: 200 });
    const r = await fetchLatestRelease(true);
    expect(r.data?.version).toBe("0.0.5");
    expect(requested.length).toBeGreaterThan(0);
  });

  it("全部源失败时降级到过期的宿主机缓存，避免 UI 显示为未知", async () => {
    writeHostCache(Date.now() - 60 * 60 * 1000); // 1 小时前 > 10 分钟新鲜阈值
    mockFetch({ official: "net", proxy: "net" });
    const r = await fetchLatestRelease();
    expect(r.data?.version).toBe("0.0.1");
    expect(r.fromCache).toBe(true);
  });
});

/** 写入宿主机版本缓存文件（模拟容器登录/cron 刷新后的结果） */
function writeHostCache(timestamp: number) {
  fs.writeFileSync(
    path.join(process.env.DATA_DIR as string, "latest.json"),
    JSON.stringify({
      timestamp,
      data: {
        tag: "0.0.1",
        name: "栖云 · Qiyun 0.0.1",
        body: "cached",
        htmlUrl: "https://github.com/sxlb/qiyun/releases/tag/0.0.1",
        publishedAt: "2026-01-02T00:00:00Z",
        version: "0.0.1",
      },
    })
  );
}
