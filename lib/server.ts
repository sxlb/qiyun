/**
 * 服务端 API 工具集 — Barrel 门面（re-export）。
 *
 * 原 lib/server.ts 已拆分为以下独立模块：
 *   - response.ts       响应封装（success / error / internalError / logError / formatZodError）
 *   - auth-server.ts    会话校验（requireSession）
 *   - request-body.ts   请求体解析（parseJsonBody / readTextWithLimit / LimitedBody）
 *   - audit.ts          操作日志与差异对比（writeOperationLog / diffLinks / diffProfile / getChangedProfileFields / LogModule / LinkItem / LogInput / getClientIp / isValidIp）
 *   - rate-limit.ts     限流器（isRateLimited / resetRateLimiter）
 *   - link-list-api.ts  链接列表路由工厂（createLinkListApi / toLinkDelegate / syncByUpsert 及其类型）
 *   - serialize-write.ts 串行化写队列（serialized）
 *
 * 本文件仅做 re-export，确保所有 `from "@/lib/server"` 的既有导入无需改动即可正常工作。
 */

/* ==================== 响应封装 ==================== */
export { logError } from "./response";
export { json, success, error, internalError, formatZodError } from "./response";

/* ==================== 会话校验 ==================== */
export { requireSession } from "./auth-server";

/* ==================== 请求体解析 ==================== */
export { parseJsonBody, readTextWithLimit } from "./request-body";
export type { LimitedBody } from "./request-body";

/* ==================== 操作日志与差异对比 ==================== */
export {
  writeOperationLog,
  getClientIp,
  isValidIp,
  diffLinks,
  getChangedProfileFields,
  diffProfile,
} from "./audit";
export type { LogModule, LogInput, LinkItem } from "./audit";

/* ==================== 轻量内存限流 ==================== */
export { isRateLimited, resetRateLimiter } from "./rate-limit";

/* ==================== 链接列表路由工厂 + Upsert 工具 ==================== */
export {
  createLinkListApi,
  toLinkDelegate,
  syncByUpsert,
} from "./link-list-api";
export type {
  LinkDelegate,
  LinkRouteConfig,
  UpsertItem,
  UpsertCounts,
  UpsertCallbacks,
} from "./link-list-api";

/* ==================== 串行化写队列 ==================== */
export { serialized } from "./serialize-write";
