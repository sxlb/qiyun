import { NextResponse } from "next/server";
import { z } from "zod";

/** 输出服务端错误日志（含调用栈），供运维排查；错误详情不回传给客户端 */
export function logError(message: string, error?: unknown) {
  // 生产环境同样要打全量错误：只打 message 会让容器日志里只剩「触发更新失败」，
  // 真实原因（如 EACCES: permission denied）无处可查，线上排查只能靠猜。
  if (error === undefined) {
    console.error(message);
    return;
  }
  console.error(message, error instanceof Error ? (error.stack ?? error.message) : error);
}

/** 返回 JSON 响应，默认 200 */
export function json(data: unknown, init?: number | ResponseInit): Response {
  return typeof init === "number" ? NextResponse.json(data, { status: init }) : NextResponse.json(data);
}

/** 成功响应：200/201 */
export function success<T>(data: T, status: 200 | 201 = 200): ReturnType<typeof json> {
  return json(data, status) as ReturnType<typeof json>;
}

/** 错误响应：4xx / 5xx */
export function error(message: string, status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 = 400) {
  return json({ error: message }, status);
}

/** 服务器内部错误：统一 500 */
export function internalError(message = "服务器错误", e?: unknown) {
  logError(message, e);
  return error("服务器内部错误", 500);
}

/** 格式化 zod 校验错误为可读消息（如 "name: 名称不能为空; url: 链接必须以 http 开头"） */
export function formatZodError(zodError: z.ZodError): string {
  return zodError.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
}
