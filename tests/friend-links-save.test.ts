import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 覆盖链接批量保存的「按 id 增量同步」语义。
 *
 * 背景：旧实现是「清空 + 重插」（deleteMany + createMany），每次保存都会让所有行
 * 重新分配自增 id。而 SiteLinkClick.linkId 以该 id 为唯一键聚合点击量，id 一变，
 * 历史点击立刻脱钩，后台「热门链接」会出现同名多行、计数被永久拆散。
 *
 * 现改为 syncByUpsert：带 id 且库中存在 → 原地 update（id 不变）；无 id → create；
 * 库中存在但本次未提交 → 删除。
 */

const outerFindMany = vi.fn(); // 路由内 delegate.findMany（用于生成变更摘要）
const opLogCreate = vi.fn(); // writeOperationLog → prisma.operationLog.create

// 事务内的 friendLink 委托：listIds 用 findMany({select:{id}})，其余为 update/create/deleteMany
const tx = {
  findMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  prisma: {
    friendLink: {
      findMany: (...args: unknown[]) => outerFindMany(...args),
    },
    operationLog: {
      create: (...args: unknown[]) => opLogCreate(...args),
    },
    $transaction: (fn: (t: unknown) => unknown) => fn({ friendLink: tx }),
  },
}));

// 放行鉴权：requireSession 内部调用 getServerSession(NextAuthOptions)，
// 未 mock 时会因脱离请求作用域读 headers 而抛错。
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve({ user: { name: "admin" } })),
}));

// requireSession → validateAuthEnv 要求 NEXTAUTH_SECRET 至少 32 字符
process.env.NEXTAUTH_SECRET = "test-secret-for-friend-links-save-0123456789abcdef";

const { PUT } = await import("@/app/api/friend-links/route");

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/friend-links", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 真实的旧数据（用于生成操作日志的变更摘要）
const existingRows = [
  { id: 1, name: "甲站", url: "https://a.example.com", icon: "", description: "", sort: 0 },
  { id: 2, name: "乙站", url: "https://b.example.com", icon: "", description: "", sort: 1 },
];

describe("PUT /api/friend-links（批量保存）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    tx.update.mockResolvedValue({});
    tx.create.mockResolvedValue({});
    tx.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("空数组（删除全部链接）时删除全部行，且不创建任何行", async () => {
    outerFindMany.mockResolvedValue(existingRows);
    tx.deleteMany.mockResolvedValue({ count: 2 });

    const res = await PUT(putRequest([]));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ count: 0, created: 0, updated: 0, deleted: 2 });
    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] } } });
  });

  it("带 id 的条目原地更新，自增 id 保持不变（点击统计因此不会脱钩）", async () => {
    outerFindMany.mockResolvedValue(existingRows);

    const payload = [
      { id: 1, name: "甲站改名", url: "https://a.example.com", icon: "", description: "", sort: 0 },
      { id: 2, name: "乙站", url: "https://b.example.com", icon: "", description: "", sort: 1 },
    ];
    const res = await PUT(putRequest(payload));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 0, updated: 2, deleted: 0 });
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(tx.create).not.toHaveBeenCalled();
    // update 的 data 里不应包含 id（主键不可写）
    expect(tx.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.not.objectContaining({ id: expect.anything() }),
    });
  });

  it("无 id 的条目走新增，且不写入 id 字段", async () => {
    outerFindMany.mockResolvedValue([]);
    tx.findMany.mockResolvedValue([]);

    const payload = [{ name: "新站", url: "https://new.example.com", icon: "", description: "", sort: 0 }];
    const res = await PUT(putRequest(payload));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    expect(tx.create).toHaveBeenCalledTimes(1);
    expect(tx.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "新站" }),
    });
    expect(tx.create.mock.calls[0][0].data).not.toHaveProperty("id");
  });

  it("库中存在但未提交的行被删除（保持整表同步语义）", async () => {
    outerFindMany.mockResolvedValue(existingRows);
    tx.deleteMany.mockResolvedValue({ count: 1 });

    const payload = [
      { id: 1, name: "甲站", url: "https://a.example.com", icon: "", description: "", sort: 0 },
    ];
    const res = await PUT(putRequest(payload));

    expect(res.status).toBe(200);
    expect(tx.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } });
  });

  it("非法数据返回 400，且不触碰数据库", async () => {
    outerFindMany.mockResolvedValue([]);
    // url 非 http(s) 开头 → schema 拒绝
    const res = await PUT(putRequest([{ name: "x", url: "ftp://bad", icon: "", sort: 0 }]));

    expect(res.status).toBe(400);
    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.deleteMany).not.toHaveBeenCalled();
  });

  it("保存成功写操作日志", async () => {
    outerFindMany.mockResolvedValue(existingRows);
    opLogCreate.mockResolvedValue({});

    await PUT(
      putRequest([{ id: 1, name: "甲站", url: "https://a.example.com", icon: "", description: "", sort: 0 }])
    );

    expect(opLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ module: "friend-links", action: "batch_update" }),
      })
    );
  });
});
