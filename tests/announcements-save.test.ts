import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 覆盖 PUT /api/announcements 批量保存语义（整表替换，与链接面板一致）：
 * - 项含 id 且存在 → 更新；含 id 但不存在 → 按新增兜底；无 id → 新增；
 * - 未提交的旧记录 → 删除；
 * - 空数组（删除全部公告）→ 仅删除，不遗漏操作日志。
 */

const mocks = {
  findMany: vi.fn(),
  outsideFindMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  opLogCreate: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  prisma: {
    siteAnnouncement: {
      findMany: (...args: unknown[]) => mocks.outsideFindMany(...args),
    },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        siteAnnouncement: {
          findMany: (...args: unknown[]) => mocks.findMany(...args),
          create: (...args: unknown[]) => mocks.create(...args),
          update: (...args: unknown[]) => mocks.update(...args),
          deleteMany: (...args: unknown[]) => mocks.deleteMany(...args),
        },
        operationLog: {
          create: (...args: unknown[]) => mocks.opLogCreate(...args),
        },
      }),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve({ user: { name: "admin" } })),
}));

process.env.NEXTAUTH_SECRET = "test-secret-for-announcements-save-0123456789abcdef";

const { PUT } = await import("@/app/api/announcements/route");

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/announcements", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/announcements（公告批量保存）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outsideFindMany.mockResolvedValue([]);
  });

  it("空数组（删除全部公告）→ 仅删除，返回 0/0/0", async () => {
    mocks.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mocks.deleteMany.mockResolvedValue({ count: 2 });

    const res = await PUT(putRequest([]));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ createdCount: 0, updatedCount: 0, deletedCount: 2 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.opLogCreate).toHaveBeenCalledTimes(1);
  });

  it("新增（无 id）+ 更新（带既有 id）+ 删除未提交", async () => {
    mocks.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({});
    mocks.create.mockResolvedValue({});

    const payload = [
      { id: 1, title: "改", content: "改内容", pinned: true, enabled: true, sort: 0 },
      { title: "新", content: "新内容", pinned: false, enabled: true, sort: 1 },
    ];
    const res = await PUT(putRequest(payload));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ createdCount: 1, updatedCount: 1, deletedCount: 1 });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    // 删除未提交的 id=2
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } });
  });

  it("提交带不存在 id 的项 → 按新增兜底而非崩溃", async () => {
    mocks.findMany.mockResolvedValue([{ id: 1 }]);
    mocks.create.mockResolvedValue({});
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    const payload = [{ id: 999, title: "残留", content: "内容", pinned: false, enabled: true, sort: 0 }];
    const res = await PUT(putRequest(payload));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ createdCount: 1, updatedCount: 0, deletedCount: 1 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("非数组请求体 → 400", async () => {
    const res = await PUT(putRequest({ title: "x" }));
    expect(res.status).toBe(400);
  });
});