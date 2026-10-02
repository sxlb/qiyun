import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { readTextWithLimit } from "@/lib/server";

/**
 * readTextWithLimit：把「请求体体积上限」从事后校验改成**读取过程中**生效。
 *
 * 背景：/api/backup/restore 原先只看 content-length 头，chunked 传输下该头可缺失或
 * 虚报，检查恒不触发；而 request.json() 会先把整个 body 读进内存，读完之后再判断
 * 大小已经无法阻止内存耗尽。
 */

function postJson(body: string): NextRequest {
  return new NextRequest("http://localhost/api/x", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

/** 无 content-length 的流式请求体：模拟 chunked 传输 */
function postStreamed(text: string): NextRequest {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  // duplex: "half" 是 Node(undici) 对流式请求体的要求；Next 的 RequestInit 类型未声明该字段，
  // 故按构造函数参数类型断言（运行时行为已由本文件的用例验证）。
  const init = {
    method: "POST",
    body: stream,
    duplex: "half",
  } as unknown as ConstructorParameters<typeof NextRequest>[1];
  return new NextRequest("http://localhost/api/x", init);
}

describe("readTextWithLimit（体积上限在读取时生效）", () => {
  it("未超限：正常读出文本", async () => {
    const res = await readTextWithLimit(postJson('{"a":1}'), 1024);
    expect(res).toEqual({ ok: true, text: '{"a":1}' });
  });

  it("超过上限：返回 over-limit，不返回内容", async () => {
    const res = await readTextWithLimit(postJson(JSON.stringify({ big: "x".repeat(5000) })), 1024);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("over-limit");
  });

  it("无 content-length（chunked）但实际超限：仍能截断", async () => {
    const res = await readTextWithLimit(postStreamed("y".repeat(5000)), 1024);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("over-limit");
  });

  it("无 content-length 且未超限：正常读出", async () => {
    const res = await readTextWithLimit(postStreamed("hello"), 1024);
    expect(res).toEqual({ ok: true, text: "hello" });
  });

  it("空请求体：返回空文本（由调用方按 JSON 解析失败处理）", async () => {
    const req = new NextRequest("http://localhost/api/x", { method: "POST" });
    const res = await readTextWithLimit(req, 1024);
    expect(res).toEqual({ ok: true, text: "" });
  });
});
