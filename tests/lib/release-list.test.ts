import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchReleaseList, resetReleaseListCache } from "@/lib/version";

/**
 * 发布列表（后台「版本列表与更新日志」的数据来源）。
 *
 * 和单版本检测（fetchLatestRelease）的区别不止端点：列表要能回答「这个版本改了什么」，
 * 所以每一条都带 Markdown 说明正文。这里锁住的是失败语义 ——
 * 「取不到列表」和「确实没有发布」必须区分开，否则后台会把网络故障显示成「该项目没有版本」。
 */

let tmp: string;
const savedDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-releases-"));
  process.env.DATA_DIR = tmp;
  resetReleaseListCache(); // 模块级缓存：不重置会串场
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const OFFICIAL = "https://api.github.com/";
const MIRROR = "https://gh-proxy.com/https://api.github.com/";

function release(tag: string, body = "") {
  return {
    tag_name: tag,
    name: tag,
    body,
    html_url: `https://github.com/sxlb/qiyun/releases/tag/${tag}`,
    published_at: "2026-10-04T12:00:00Z",
  };
}

/** 按 URL 决定响应；handler 返回 null 表示该源连不上（抛错 → 归为 net 失败） */
function mockFetch(handler: (url: string) => Response | null) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const res = handler(url);
      if (!res) throw new Error("fetch failed");
      return res;
    })
  );
  return calls;
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchReleaseList", () => {
  it("拉到列表并把字段映射为 ReleaseInfo（版本号去掉 v 前缀、保留说明正文）", async () => {
    mockFetch((url) =>
      url.startsWith(OFFICIAL)
        ? json([release("v0.0.10", "### 新增\n- 首页单屏"), release("0.0.9", "### 修复\n- 登录卡住")])
        : null
    );

    const { data, error } = await fetchReleaseList();

    expect(error).toBeUndefined();
    expect(data.map((r) => r.version)).toEqual(["0.0.10", "0.0.9"]);
    expect(data[0].body).toContain("首页单屏");
    expect(data[0].htmlUrl).toContain("/releases/tag/v0.0.10");
  });

  it("请求的是列表端点（带分页参数），不是 /releases/latest", async () => {
    const calls = mockFetch(() => json([]));

    await fetchReleaseList();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((u) => u.includes("/repos/sxlb/qiyun/releases?per_page="))).toBe(true);
    expect(calls.some((u) => u.endsWith("/releases/latest"))).toBe(false);
  });

  it("要拼接出合法的官方源地址（base 结尾斜杠缺失会拼成 api.github.comrepos 这种无效主机）", async () => {
    const calls = mockFetch(() => json([]));

    await fetchReleaseList();

    // 缺斜杠时这里是 "https://api.github.comrepos/..."，官方源会静默地永远失败
    expect(calls).toContain("https://api.github.com/repos/sxlb/qiyun/releases?per_page=30");
  });

  it("官方源不通时自动降级到代理", async () => {
    mockFetch((url) => (url.startsWith(MIRROR) ? json([release("0.0.10")]) : null));

    const { data, error } = await fetchReleaseList();

    expect(error).toBeUndefined();
    expect(data).toHaveLength(1);
  });

  it("返回体不是数组时按「拉取失败」处理，而不是当成没有发布", async () => {
    // 代理有时会回一个对象（如错误 JSON）或 HTML；若直接当空列表，后台会显示「没有版本」
    mockFetch(() => json({ message: "Not Found" }));

    const { data, error } = await fetchReleaseList();

    expect(data).toEqual([]);
    expect(error).toBeTruthy();
  });

  it("全部源失败时返回 error 且列表为空", async () => {
    mockFetch(() => null);

    const { data, error } = await fetchReleaseList();

    expect(data).toEqual([]);
    expect(error).toBeTruthy();
  });

  it("10 分钟内复用缓存；force 绕过缓存重新拉取", async () => {
    let payload = [release("0.0.10")];
    const calls = mockFetch(() => json(payload));

    const first = await fetchReleaseList();
    expect(first.data).toHaveLength(1);
    const afterFirst = calls.length;

    // 期间远端变了，但没到 TTL 也没 force：应复用缓存
    payload = [release("0.0.11"), release("0.0.10")];
    const cached = await fetchReleaseList();
    expect(cached.data).toHaveLength(1);
    expect(calls.length).toBe(afterFirst);

    // force：重新拉取，看到新列表
    const forced = await fetchReleaseList(true);
    expect(forced.data.map((r) => r.version)).toEqual(["0.0.11", "0.0.10"]);
    expect(calls.length).toBeGreaterThan(afterFirst);
  });
});
