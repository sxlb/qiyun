import { NextRequest, NextResponse } from "next/server";
import { error, getClientIp, internalError, parseJsonBody, requireSession } from "@/lib/server";
import { isRateLimited } from "@/lib/rate-limit";
import { fetchFollowingSafeRedirects, UnsafeUrlError } from "@/lib/ssrf";

export const dynamic = "force-dynamic";

/** 单次探测超时：外部服务偶发慢响应不应让后台面板一直转圈 */
const TEST_TIMEOUT_MS = 8000;

/**
 * POST /api/external-apis/test
 * 测试一个外部服务地址是否可用（后台「外部服务」面板的「测试」按钮）。
 *
 * 为什么需要它：这些地址由管理员在后台自行填写，填错或上游下线时无法立刻察觉。
 * 提供即时探活，改完地址即可当场验证，避免"保存后要等前台出问题才发现填错"。
 *
 * 安全设计：
 * 1. 仅管理员可调用 —— 本接口会发起服务端出站请求，对外开放等于提供匿名探活能力；
 * 2. 出站走 lib/ssrf 的「逐跳 SSRF 校验」，禁止指向内网 / 保留地址，
 *    防止该接口被当作内网端口扫描器使用（注意：因此内网自建的 API 无法在此测试）；
 * 3. 按管理员账号限流，避免连点刷出大量出站请求。
 *
 * 请求体：`{ url: string }`
 * 响应：`{ ok, status, latencyMs, message }`
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) return error("未授权", 401);

    // 限流键：优先按管理员账号（同一账号多标签页共享额度），缺失时退回 IP
    const rateKey = `external-api-test:${session.user?.name || getClientIp(request)}`;
    if (isRateLimited(rateKey, 20)) return error("测试过于频繁，请稍后再试", 429);

    const json = await parseJsonBody(request);
    if (json === null || typeof (json as { url?: unknown }).url !== "string") {
      return error("请求体格式错误，需为 { url: string }");
    }
    const target = ((json as { url: string }).url || "").trim();
    if (!target) return error("请先填写要测试的地址");

    const started = performance.now();
    try {
      const { response } = await fetchFollowingSafeRedirects(target, {
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        cache: "no-store",
        headers: {
          // 部分免费上游会拒绝无 User-Agent 的请求，这里伪装成浏览器
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "*/*",
        },
      });
      const latencyMs = Math.round(performance.now() - started);
      // 立即释放响应体：这里只关心"能否拿到响应"，避免大文件（如壁纸原图）占住内存与连接
      await response.body?.cancel().catch(() => {
        /* 取消失败不影响探测结论 */
      });
      return NextResponse.json({
        ok: response.ok,
        status: response.status,
        latencyMs,
        message: response.ok ? `可访问（HTTP ${response.status}）` : `服务返回 HTTP ${response.status}`,
      });
    } catch (e) {
      const latencyMs = Math.round(performance.now() - started);
      let message = "连接失败（域名无法解析或网络不可达）";
      if (e instanceof UnsafeUrlError) {
        // SSRF 校验不通过：多为内网地址或非法协议，原样透出原因便于排查
        message = e.message;
      } else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        message = `连接超时（${TEST_TIMEOUT_MS}ms）`;
      }
      return NextResponse.json({ ok: false, status: 0, latencyMs, message });
    }
  } catch (e) {
    return internalError("[POST /api/external-apis/test] 测试失败", e);
  }
}
