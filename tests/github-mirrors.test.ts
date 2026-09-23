import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listProxySources,
  mirrorLabel,
  normalizeMirrorBase,
  readCustomMirrors,
  readProxyPreference,
  testProxySources,
  writeCustomMirrors,
  writeProxyPreference,
} from "@/lib/version";

const OK_BODY = { tag_name: "0.0.9", name: "0.0.9", body: "", html_url: "", published_at: "" };

describe("normalizeMirrorBase（代理地址规范化）", () => {
  it("只填代理前缀时自动补上游地址", () => {
    expect(normalizeMirrorBase("https://hk.gh-proxy.com")).toBe(
      "https://hk.gh-proxy.com/https://api.github.com/"
    );
    expect(normalizeMirrorBase("  https://gh.dpik.top/  ")).toBe(
      "https://gh.dpik.top/https://api.github.com/"
    );
  });

  it("已含 api.github.com 的直连镜像只补结尾斜杠", () => {
    expect(normalizeMirrorBase("https://gh-proxy.com/https://api.github.com/")).toBe(
      "https://gh-proxy.com/https://api.github.com/"
    );
    expect(normalizeMirrorBase("https://mirror.example.com/api.github.com")).toBe(
      "https://mirror.example.com/api.github.com/"
    );
  });

  it("非 http(s) 或空值视为非法（返回 null）", () => {
    expect(normalizeMirrorBase("")).toBeNull();
    expect(normalizeMirrorBase("   ")).toBeNull();
    expect(normalizeMirrorBase("hk.gh-proxy.com")).toBeNull();
    expect(normalizeMirrorBase("ftp://hk.gh-proxy.com")).toBeNull();
    expect(normalizeMirrorBase("javascript:alert(1)")).toBeNull();
  });

  it("mirrorLabel 取代理域名用于展示", () => {
    expect(mirrorLabel("https://hk.gh-proxy.com/https://api.github.com/")).toBe("hk.gh-proxy.com");
    expect(mirrorLabel("not a url")).toBe("not a url");
  });
});

describe("候选源清单（官方 + 内置/环境变量 + 自定义）", () => {
  let tmp: string;
  const savedDataDir = process.env.DATA_DIR;
  const savedMirrors = process.env.GITHUB_API_MIRRORS;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-mirrors-"));
    process.env.DATA_DIR = tmp;
    delete process.env.GITHUB_API_MIRRORS;
  });

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
    if (savedMirrors === undefined) delete process.env.GITHUB_API_MIRRORS;
    else process.env.GITHUB_API_MIRRORS = savedMirrors;
  });

  it("默认给出官方 + 内置代理，官方居首且全部为可拼接形式", async () => {
    const sources = await listProxySources();
    expect(sources[0]).toEqual({ base: "https://api.github.com", scope: "official" });
    expect(sources.length).toBeGreaterThanOrEqual(5);
    expect(sources.filter((s) => s.scope === "builtin").length).toBe(4);
    // 每个内置代理都必须是「代理 + 上游完整地址」形式，否则会拼出 403 的路径
    for (const s of sources.filter((x) => x.scope !== "official")) {
      expect(s.base).toMatch(/api\.github\.com\/$/);
    }
  });

  it("环境变量存在时整组替换内置代理，并标记为 env；无协议的项被忽略", async () => {
    process.env.GITHUB_API_MIRRORS = "https://only.example.com, bad-value";
    const sources = await listProxySources();
    expect(sources.filter((s) => s.scope === "env")).toEqual([
      { base: "https://only.example.com/https://api.github.com/", scope: "env" },
    ]);
    expect(sources.some((s) => s.base.includes("gh-proxy.com"))).toBe(false);
  });

  it("自定义代理追加在最后，与内置重复时不重复请求同一源", async () => {
    await writeCustomMirrors([
      "https://mine.example.com",
      "https://gh-proxy.com", // 与内置重复：保留内置，不重复
      "https://api.github.com", // 与官方重复：忽略
    ]);
    const sources = await listProxySources();
    const custom = sources.filter((s) => s.scope === "custom");
    expect(custom).toEqual([
      { base: "https://mine.example.com/https://api.github.com/", scope: "custom" },
    ]);
    expect(sources.filter((s) => s.base.startsWith("https://gh-proxy.com"))).toHaveLength(1);
    expect(sources.filter((s) => s.base === "https://api.github.com")).toHaveLength(1);
  });
});

describe("自定义代理持久化", () => {
  let tmp: string;
  const saved = process.env.DATA_DIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-mirrors-file-"));
    process.env.DATA_DIR = tmp;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = saved;
  });

  it("写入后读回一致，并自动规范化 / 去重 / 过滤非法项", async () => {
    await writeCustomMirrors(["https://a.example.com", "https://a.example.com/", "bad", ""]);
    expect(await readCustomMirrors()).toEqual(["https://a.example.com/https://api.github.com/"]);
  });

  it("文件缺失或损坏时返回空数组（不影响内置代理兜底）", async () => {
    expect(await readCustomMirrors()).toEqual([]);
    fs.writeFileSync(path.join(tmp, "github-mirrors.json"), "{ not json");
    expect(await readCustomMirrors()).toEqual([]);
  });
});

describe("优先代理（后台「设为优先」）", () => {
  let tmp: string;
  const saved = process.env.DATA_DIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-preferred-"));
    process.env.DATA_DIR = tmp;
    delete process.env.GITHUB_API_MIRRORS;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = saved;
  });

  it("设置后能读回，并在候选源清单里标记 preferred", async () => {
    await writeProxyPreference("https://hk.gh-proxy.com");
    const normalized = "https://hk.gh-proxy.com/https://api.github.com/";
    expect(await readProxyPreference()).toBe(normalized);

    const sources = await listProxySources();
    const marked = sources.filter((s) => s.preferred);
    expect(marked).toEqual([{ base: normalized, scope: "builtin", preferred: true }]);
  });

  it("传 null 清除设置，恢复全源自动竞速", async () => {
    await writeProxyPreference("https://hk.gh-proxy.com");
    await writeProxyPreference(null);
    expect(await readProxyPreference()).toBeNull();
    expect((await listProxySources()).some((s) => s.preferred)).toBe(false);
  });

  it("不在候选列表里的地址会被拒绝（避免写坏配置后版本检测反复空跑）", async () => {
    await writeProxyPreference("https://not-in-list.example.com");
    expect(await readProxyPreference()).toBeNull();
  });

  it("保存自定义代理列表不会清掉已有的优先设置", async () => {
    await writeCustomMirrors(["https://mine.example.com"]);
    await writeProxyPreference("https://mine.example.com");
    await writeCustomMirrors(["https://mine.example.com", "https://other.example.com"]);
    expect(await readProxyPreference()).toBe("https://mine.example.com/https://api.github.com/");
  });

  it("优先代理被移出列表时，优先设置一并清除", async () => {
    await writeCustomMirrors(["https://mine.example.com"]);
    await writeProxyPreference("https://mine.example.com");
    await writeCustomMirrors([]);
    expect(await readProxyPreference()).toBeNull();
  });
});

describe("testProxySources（后台连通性测试）", () => {
  let tmp: string;
  const saved = process.env.DATA_DIR;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-mirrors-test-"));
    process.env.DATA_DIR = tmp;
    delete process.env.GITHUB_API_MIRRORS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = saved;
  });

  it("逐个给出可用性与耗时，官方源排在最前", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://api.github.com")) {
          return { ok: true, status: 200, json: async () => OK_BODY };
        }
        // 其余代理一律 403，模拟被限流/不可用
        return { ok: false, status: 403, json: async () => ({}) };
      })
    );

    const results = await testProxySources();
    expect(results[0].scope).toBe("official");
    expect(results[0].ok).toBe(true);
    expect(results[0].ms).toBeGreaterThanOrEqual(0);
    expect(results[0].label).toContain("api.github.com");

    const failed = results.filter((r) => !r.ok);
    expect(failed.length).toBeGreaterThanOrEqual(4);
    for (const f of failed) {
      expect(f.status).toBe(403);
      expect(f.reason).toContain("403");
    }
  });

  it("连接失败（非 HTTP 错误）也能给出可读原因", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const results = await testProxySources();
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].reason).toBe("连接失败");
    expect(results[0].status).toBeUndefined();
  });
});
