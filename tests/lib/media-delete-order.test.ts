import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * DELETE /api/media/[id] 的删除顺序。
 *
 * 背景：原实现先 fs.rm 磁盘文件、再删数据库记录。DB 删除是可能失败的一步，
 * 而物理文件不可回滚——一旦 DB 删除失败，留下的记录会永远指向一个已经被删掉的文件，
 * 媒体库里这张图从此 404，且没有任何入口能修（记录无法重新指向不存在的文件）。
 *
 * 这里锁定两条行为：
 * 1. 正常路径：先删记录、后删文件；
 * 2. 异常路径：删记录失败时，磁盘文件必须原封不动。
 */

const calls: string[] = [];
const deleteMock = vi.fn(async () => {
  calls.push("db-delete");
  return {};
});
const rmMock = vi.fn(async () => {
  calls.push("fs-rm");
});
const opLogMock = vi.fn(async () => ({}));

// 说明：这里刻意不写 `(...args) => mock(...args)`。带实现的 vi.fn(impl) 其签名由 impl 推断，
// 是「无参」的，透传展开会触发 TS2556；而本文件只断言调用顺序、不关心入参，零参包装即可。
vi.mock("@/lib/db", () => ({
  prisma: {
    imageAsset: {
      findUnique: vi.fn(async () => ({
        id: 1,
        fileName: "abc.webp",
        url: "/api/uploads/file/abc.webp",
        usage: "avatar",
      })),
      delete: () => deleteMock(),
    },
    operationLog: { create: () => opLogMock() },
  },
}));

vi.mock("node:fs", () => ({
  promises: { rm: () => rmMock() },
}));

vi.mock("next-auth", () => ({
  getSession: vi.fn(async () => ({ user: { name: "admin" } })),
  getServerSession: vi.fn(async () => ({ user: { name: "admin" } })),
}));

// requireSession 会校验密钥长度（不足 32 字符直接抛错），本文件必须自带一个足够长的密钥，
// 否则用例会因为鉴权失败拿到 500 而"假通过"
process.env.NEXTAUTH_SECRET = "test-secret-for-media-delete-order-0123456789abcdef";

const { DELETE } = await import("@/app/api/media/[id]/route");

function deleteRequest() {
  return new NextRequest("http://localhost/api/media/1", { method: "DELETE" });
}

function ctx(id = "1") {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/media/[id]（记录与文件的删除顺序）", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("正常路径：先删数据库记录，再删磁盘文件", async () => {
    const res = await DELETE(deleteRequest(), ctx());

    expect(res.status).toBe(200);
    expect(calls, `实际顺序为 ${calls.join(" → ")}`).toEqual(["db-delete", "fs-rm"]);
  });

  it("删记录失败时，磁盘文件必须保持原样（不能先删文件）", async () => {
    deleteMock.mockRejectedValueOnce(new Error("database is locked"));

    const res = await DELETE(deleteRequest(), ctx());

    expect(res.status).toBe(500);
    expect(rmMock, "删库失败却已经把文件删掉了，记录会变成永久 404").not.toHaveBeenCalled();
  });

  it("文件名不安全时跳过删文件，但仍会删掉记录", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.imageAsset.findUnique).mockResolvedValueOnce({
      id: 1,
      fileName: "../secrets.txt",
      url: "/api/uploads/file/x",
      usage: "",
    } as never);

    const res = await DELETE(deleteRequest(), ctx());

    expect(res.status).toBe(200);
    expect(calls).toEqual(["db-delete"]);
  });
});
