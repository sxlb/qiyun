import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 「选一个版本更新」这条链路的接口回归。
 *
 * 两个接口配合完成：/api/update/releases 给出可选的版本清单（并标出每个版本相对当前的位置），
 * /api/update/trigger 据此接受「更新/回滚到指定版本」。
 *
 * 这里重点锁住的是**白名单校验**：指定版本必须以已发布列表为准。
 * 少了这道校验，用户手误把 0.0.1 写成 0.0.01，宿主机侧只会以「拉取镜像失败」收场，
 * 报错完全不指向真正的原因；更糟的是它可以被构造出任意字符串塞进镜像名。
 */

const mocks = {
  requireSession: vi.fn(),
  fetchReleaseList: vi.fn(),
  fetchLatestRelease: vi.fn(),
  readCachedRelease: vi.fn(),
  execState: vi.fn(),
  writeRequest: vi.fn(),
  rollbackTargets: vi.fn(),
  updateRecordCreate: vi.fn(),
  writeOperationLog: vi.fn(),
};

vi.mock("@/lib/server", () => ({
  requireSession: (...a: unknown[]) => mocks.requireSession(...a),
  success: (data: unknown) =>
    new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }),
  error: (msg: string, status?: number) =>
    new Response(JSON.stringify({ error: msg }), {
      status: status ?? 400,
      headers: { "Content-Type": "application/json" },
    }),
  internalError: (msg: string) =>
    new Response(JSON.stringify({ error: `${msg}: 服务器内部错误` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }),
  getClientIp: () => "127.0.0.1",
  writeOperationLog: (...a: unknown[]) => mocks.writeOperationLog(...a),
  parseJsonBody: async <T,>(req: NextRequest): Promise<T | null> => {
    try {
      return (await req.json()) as T;
    } catch {
      return null;
    }
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: { updateRecord: { create: (...a: unknown[]) => mocks.updateRecordCreate(...a) } },
}));

vi.mock("@/lib/update", () => ({
  checkDeployDirWritable: () => null,
  execState: () => mocks.execState(),
  writeRequest: (...a: unknown[]) => mocks.writeRequest(...a),
  rollbackTargets: () => mocks.rollbackTargets(),
  newId: () => "test-id",
  DeployDirError: class DeployDirError extends Error {},
}));

vi.mock("@/lib/version", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/version")>();
  return {
    ...actual,
    CURRENT_VERSION: "0.0.10",
    fetchReleaseList: (...a: unknown[]) => mocks.fetchReleaseList(...a),
    fetchLatestRelease: (...a: unknown[]) => mocks.fetchLatestRelease(...a),
    readCachedRelease: (...a: unknown[]) => mocks.readCachedRelease(...a),
  };
});

function release(version: string) {
  return {
    tag: version,
    version,
    name: version,
    body: `### ${version} 的说明`,
    htmlUrl: `https://github.com/sxlb/qiyun/releases/tag/${version}`,
    publishedAt: "2026-10-04T12:00:00Z",
  };
}

function triggerRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/update/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callTrigger(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/update/trigger/route");
  return POST(triggerRequest(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({ user: { name: "admin" } });
  mocks.execState.mockReturnValue({ kind: "idle" });
  mocks.rollbackTargets.mockReturnValue([]);
  mocks.updateRecordCreate.mockResolvedValue({});
  mocks.fetchReleaseList.mockResolvedValue({ data: [release("0.0.11"), release("0.0.10"), release("0.0.9")] });
});

describe("GET /api/update/releases", () => {
  async function call(query = "") {
    const { GET } = await import("@/app/api/update/releases/route");
    return GET(new NextRequest(`http://localhost:3000/api/update/releases${query}`));
  }

  it("未登录返回 401", async () => {
    mocks.requireSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("逐条标出相对当前版本的位置（新 / 当前 / 旧）", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.currentVersion).toBe("0.0.10");
    expect(body.releases.map((r: { version: string; relation: string }) => [r.version, r.relation])).toEqual([
      ["0.0.11", "newer"],
      ["0.0.10", "current"],
      ["0.0.9", "older"],
    ]);
    // 说明正文要带出来，后台「更新内容」才有东西可展开
    expect(body.releases[0].body).toContain("0.0.11 的说明");
  });

  it("拉取失败时把原因透传出去，而不是伪装成「没有版本」", async () => {
    mocks.fetchReleaseList.mockResolvedValue({ data: [], error: "网络错误，获取版本列表失败，请重试" });

    const body = await (await call()).json();

    expect(body.releases).toEqual([]);
    expect(body.error).toContain("网络错误");
  });

  it("force=1 时强制刷新（传给 fetchReleaseList 的 force 为 true）", async () => {
    await call("?force=1");
    expect(mocks.fetchReleaseList).toHaveBeenCalledWith(true);
  });
});

describe("POST /api/update/trigger（指定版本）", () => {
  it("更新到已发布的指定版本：接受，并按该版本写入请求", async () => {
    const res = await callTrigger({ action: "update", version: "0.0.9" });

    expect(res.status).toBe(200);
    expect(mocks.writeRequest).toHaveBeenCalledTimes(1);
    expect(mocks.writeRequest.mock.calls[0][0]).toMatchObject({ action: "update", version: "0.0.9" });
  });

  it("版本不在已发布列表中时拒绝，且不写请求", async () => {
    const res = await callTrigger({ action: "update", version: "9.9.9" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("不在已发布列表中");
    expect(mocks.writeRequest).not.toHaveBeenCalled();
  });

  it("版本列表本身取不到时，如实说明无法校验而不是说版本不存在", async () => {
    mocks.fetchReleaseList.mockResolvedValue({ data: [], error: "获取版本列表超时" });

    const res = await callTrigger({ action: "update", version: "0.0.11" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("无法校验目标版本");
  });

  it("带 v 前缀的写法归一化后再校验（v0.0.11 → 0.0.11）", async () => {
    const res = await callTrigger({ action: "update", version: "v0.0.11" });

    expect(res.status).toBe(200);
    expect(mocks.writeRequest.mock.calls[0][0]).toMatchObject({ version: "0.0.11" });
  });

  it("不传版本时仍走「更新到最新」的原有链路", async () => {
    mocks.fetchLatestRelease.mockResolvedValue({ data: release("0.0.11"), fromCache: false });

    const res = await callTrigger({ action: "update" });

    expect(res.status).toBe(200);
    expect(mocks.writeRequest.mock.calls[0][0]).toMatchObject({ version: "0.0.11" });
    // 只有走下去才知道是不是最新，因此必须真的查一次
    expect(mocks.fetchLatestRelease).toHaveBeenCalled();
    expect(mocks.fetchReleaseList).not.toHaveBeenCalled();
  });

  it("回滚到「不在本地历史、但确实已发布」的版本：允许（等价于手工 deploy.sh 指定版本）", async () => {
    mocks.rollbackTargets.mockReturnValue([]);

    const res = await callTrigger({ action: "rollback", version: "0.0.9" });

    expect(res.status).toBe(200);
    expect(mocks.writeRequest.mock.calls[0][0]).toMatchObject({ action: "rollback", version: "0.0.9" });
  });

  it("回滚到既不在历史、也不是已发布的版本：拒绝", async () => {
    const res = await callTrigger({ action: "rollback", version: "8.8.8" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("不是已发布的版本");
    expect(mocks.writeRequest).not.toHaveBeenCalled();
  });

  it("已有任务在执行时拒绝重复提交", async () => {
    mocks.execState.mockReturnValue({ kind: "running" });

    const res = await callTrigger({ action: "update", version: "0.0.11" });

    expect(res.status).toBe(409);
    expect(mocks.writeRequest).not.toHaveBeenCalled();
  });
});
