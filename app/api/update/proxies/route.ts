import { NextRequest } from "next/server";
import {
  requireSession,
  success,
  error,
  internalError,
  parseJsonBody,
  writeOperationLog,
  getClientIp,
} from "@/lib/server";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import {
  listProxySources,
  mirrorLabel,
  normalizeMirrorBase,
  readCustomMirrors,
  readProxyPreference,
  testProxySources,
  writeCustomMirrors,
  writeProxyPreference,
} from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * GitHub 加速代理管理：/api/update/proxies（仅管理员）
 *
 * - GET                     ：返回候选源清单（官方 + 内置/环境变量 + 自定义）与当前优先代理，不发起网络请求
 * - GET ?test=1             ：并发测试全部候选源的连通性与延迟（由后台按钮主动触发，避免每次开面板都打一遍）
 * - POST { mirrors }        ：整组保存自定义代理（自动规范化+去重），保存后立即对版本检测生效
 * - POST { preferred }      ：指定/清除优先代理（null 或空串 = 恢复全源自动竞速）
 * - POST { mirrors, preferred }：两者一起提交
 *
 * 说明：自定义代理与优先代理持久化在数据卷的 github-mirrors.json，不引入数据库表；
 * 内置代理始终保留，运维也可用环境变量 GITHUB_API_MIRRORS 整组替换内置列表。
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    const test = new URL(request.url).searchParams.get("test") === "1";
    const [sources, custom, preferred] = await Promise.all([
      listProxySources(),
      readCustomMirrors(),
      readProxyPreference(),
    ]);
    // 连通性测试并发发起，最慢的源决定整体耗时（约等于单个源的超时上限）
    const results = test ? await testProxySources() : null;

    return success({ sources, custom, preferred, results });
  } catch (e) {
    return internalError("[GET /api/update/proxies] 获取代理列表失败", e);
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session) return error("未授权", 401);

  try {
    const body = await parseJsonBody<{ mirrors?: unknown; preferred?: unknown }>(request);
    if (!body) return error("参数错误：请求体不是合法 JSON");

    const hasMirrors = Array.isArray(body.mirrors);
    const hasPreferred = "preferred" in body;
    if (!hasMirrors && !hasPreferred) {
      return error("参数错误：需提供 mirrors（字符串数组）或 preferred（字符串或 null）");
    }

    // 1) 保存自定义代理列表
    let custom = await readCustomMirrors();
    let invalid = 0;
    if (hasMirrors) {
      const raw = (body.mirrors as unknown[]).map((m) => String(m));
      // 校验：协议合法 + 目标非内网/保留地址。
      // 这些地址会被服务端**主动请求**（lib/version.ts 的连通性探测），
      // 只校验协议前缀会放过 http://169.254.169.254/ 这类云元数据/内网地址，形成 SSRF。
      // 解析失败同样忽略：地址不可用时留着也只会让探测反复空跑。
      const accepted: string[] = [];
      let rejected = 0;
      for (const m of raw) {
        const item = m.trim();
        if (!item) continue;
        const base = normalizeMirrorBase(item);
        if (!base) {
          rejected += 1;
          continue;
        }
        try {
          await assertPublicHttpUrl(base);
        } catch {
          rejected += 1;
          continue;
        }
        accepted.push(item);
      }
      invalid = rejected;
      const ok = await writeCustomMirrors(accepted);
      if (!ok) {
        return error("保存失败：数据目录不可写，请检查容器对 data 卷的写权限");
      }
      custom = await readCustomMirrors();
    }

    // 2) 设置/清除优先代理（写了 mirrors 之后再设置，避免被列表保存顺带清掉）
    let preferred = await readProxyPreference();
    if (hasPreferred) {
      const rawPreferred = body.preferred;
      const value = typeof rawPreferred === "string" && rawPreferred.trim() ? rawPreferred.trim() : null;
      const ok = await writeProxyPreference(value);
      if (!ok) {
        return error("保存失败：数据目录不可写，请检查容器对 data 卷的写权限");
      }
      preferred = await readProxyPreference();
      if (value && !preferred) {
        // 不在候选列表里的地址会被忽略（避免写坏配置后版本检测反复空跑）
        return error("该地址不在候选源列表中，无法设为优先代理");
      }
    }

    await writeOperationLog({
      module: "update",
      action: "proxies",
      username: session.user?.name || "unknown",
      summary: hasPreferred
        ? `设置 GitHub 优先代理：${preferred ? mirrorLabel(preferred) : "已恢复自动竞速"}`
        : `更新 GitHub 加速代理（自定义 ${custom.length} 个${invalid > 0 ? `，忽略非法 ${invalid} 个` : ""}）`,
      detail: custom.length > 0 ? custom.join("、") : "已清空自定义代理",
      ip: getClientIp(request),
    });

    return success({ custom, preferred, invalid });
  } catch (e) {
    return internalError("[POST /api/update/proxies] 保存代理失败", e);
  }
}
