import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { formatZodError, parseJsonBody } from "@/lib/server";

describe("formatZodError（zod 校验错误格式化）", () => {
  it("多字段错误以分号连接，并带字段路径", () => {
    const schema = z.object({
      name: z.string().min(1, "名称不能为空"),
      url: z.string().refine((v) => v.startsWith("http"), "链接必须以 http 开头"),
    });
    const result = schema.safeParse({ name: "", url: "bad" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain("name: 名称不能为空");
      expect(msg).toContain("url: 链接必须以 http 开头");
    }
  });

  it("根级错误（无字段路径）回退为 root", () => {
    const schema = z.object({ a: z.string() }).refine(() => false, {
      message: "整体不合法",
      path: ["root"],
    });
    const result = schema.safeParse({ a: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toContain("root: 整体不合法");
    }
  });
});

describe("parseJsonBody（安全解析 JSON 请求体）", () => {
  it("合法 JSON 返回解析后的对象", async () => {
    const req = new NextRequest("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "张三", sort: 1 }),
    });
    const data = await parseJsonBody<{ name: string; sort: number }>(req);
    expect(data).toEqual({ name: "张三", sort: 1 });
  });

  it("非法 JSON 返回 null", async () => {
    const req = new NextRequest("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ 这不是合法 JSON",
    });
    expect(await parseJsonBody(req)).toBeNull();
  });

  it("空请求体返回 null", async () => {
    const req = new NextRequest("http://localhost/api/test", {
      method: "POST",
    });
    expect(await parseJsonBody(req)).toBeNull();
  });

  it("Content-Type 非 JSON 且 body 非合法 JSON 时返回 null（parseJsonBody 不依赖 content-type）", async () => {
    const req = new NextRequest("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain text",
    });
    expect(await parseJsonBody(req)).toBeNull();
  });
});
