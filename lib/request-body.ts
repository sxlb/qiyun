import { NextRequest } from "next/server";

/** 安全解析 JSON 请求体；请求体非法 JSON 时返回 null（调用方应返回 400）。 */
export async function parseJsonBody<T = unknown>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** 带字节上限读取请求体的结果 */
export type LimitedBody =
  | { ok: true; text: string }
  | { ok: false; reason: "over-limit" | "read-error" };

/**
 * 带字节上限地读取请求体文本：**边读边计数**，超限立即取消流。
 *
 * 为什么不复用 parseJsonBody：`request.json()` 会先把整个 body 读进内存，
 * 此时再判断大小已经无法阻止内存耗尽。也不能只信 content-length ——
 * `Transfer-Encoding: chunked` 下该头可缺失或虚报，检查恒不触发。
 * 因此：先用 content-length 做一次廉价预判，再在读取过程中硬截断。
 */
export async function readTextWithLimit(
  request: NextRequest,
  maxBytes: number
): Promise<LimitedBody> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) return { ok: false, reason: "over-limit" };
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "over-limit" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read-error" };
  }
  return { ok: true, text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}
