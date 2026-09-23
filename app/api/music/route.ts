import { NextResponse, NextRequest } from "next/server";
import { assertPublicHttpUrl, fetchFollowingSafeRedirects, UnsafeUrlError } from "@/lib/ssrf";
import { prisma } from "@/lib/db";
import type { Track } from "@/components/useAudioPlayer";

export const dynamic = "force-dynamic";

// 单次第三方请求的整体超时（含全部重定向跳转）：防止上游慢响应拖住接口
const REQUEST_TIMEOUT_MS = 8000;
// 响应体上限：歌单 JSON 一般远小于此，防止上游返回超大响应拖垮内存
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * 音乐接口（歌单数据源）
 * - 无参数：返回空播放列表（无内置示例兜底）
 * - ?api=&server=netease&type=playlist&id=xxx：代理歌单 API（绕过浏览器 CORS）
 *
 * 数据源方案（按顺序尝试）：
 * 1. NeteaseMiniPlayer v3 / NeteaseCloudMusicApi（开源网易云 API，推荐，可自建）：
 *    api 填其基地址，走 /playlist/track/all 全量歌单 + /song/url/v1 批量播放地址 + /lyric 歌词。
 * 2. 兼容第三方歌单 API（meting / home 项目 api，返回数组）：原逻辑，api 填完整歌单接口。
 *
 * 安全：
 * - api 参数为任意 URL，属 SSRF 高危点，必须经过 assertPublicHttpUrl 校验
 *   （协议白名单 + 私网/保留地址拦截 + DNS 解析校验 + 重定向逐跳复核 + 响应体大小限制）。
 * - 管理员在后台配置的 songApi（精确匹配）放行私网/本机，以支持自建 API 部署于服务器本机。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const api = searchParams.get("api") || "";
  const server = searchParams.get("server") || "netease";
  const type = searchParams.get("type") || "playlist";
  const id = searchParams.get("id") || "";

  // 未配置歌单参数：返回空列表
  if (!/^https?:\/\//.test(api) || !id) {
    return NextResponse.json([]);
  }

  try {
    // 是否管理员在后台配置的歌单 API 基地址：是则放行私网（自建 API 常部署于本机/内网）
    const allowPrivate = await isConfiguredSongApi(api);
    const baseUrl = await assertPublicHttpUrl(api, { allowPrivate });

    // 方案一：NeteaseMiniPlayer v3 / NeteaseCloudMusicApi（开源网易云 API）
    const ncm = await tryNeteaseCloudPlaylist(baseUrl, id, allowPrivate);
    if (ncm) return NextResponse.json(ncm);

    // 方案二：兼容第三方歌单 API（meting / home 项目 api，返回数组）
    const target = new URL(baseUrl.toString());
    target.searchParams.set("server", server);
    target.searchParams.set("type", type);
    target.searchParams.set("id", id);

    // 归一化歌单结构：仅接受数组（部分源返回 { data: [...] }）。
    // 若返回的是业务错误对象（如网易官方直连的 { code: 404 }），不能原样透传给前端，
    // 否则播放器会拿到非歌单结构而显示空/异常；统一返回空数组。
    const parsed = await fetchPublicJson(target, allowPrivate);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : [];
    return NextResponse.json(list);
  } catch (e) {
    console.error("[GET /api/music] 代理请求失败:", e);
    return NextResponse.json([]);
  }
}

/** 是否管理员在后台配置的歌单 API 基地址（精确匹配）：是则允许访问私网/本机 */
async function isConfiguredSongApi(api: string): Promise<boolean> {
  try {
    const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } });
    return !!profile && profile.songApi.trim() === api;
  } catch {
    // 数据库不可用时按非白名单处理（保持严格 SSRF）
    return false;
  }
}

/** NeteaseCloudMusicApi 歌单歌曲（/playlist/track/all 响应项） */
interface NcmSong {
  id: number;
  name: string;
  ar?: { name: string }[];
  al?: { picUrl?: string };
}

/**
 * 尝试以 NeteaseCloudMusicApi（开源网易云 API）格式拉取歌单：
 * - /playlist/track/all?id= 全量歌单歌曲
 * - /song/url/v1?id=1,2,3&level=standard 批量播放地址（每批 100 个）
 * 返回播放器 Track[]；非该 API 响应（无 songs 字段）返回 null 供上层回退。
 */
async function tryNeteaseCloudPlaylist(
  base: URL,
  id: string,
  allowPrivate: boolean
): Promise<Track[] | null> {
  // 1. 全量歌单歌曲（非 NCM API 会 404，捕获异常返回 null 让上层回退 meting 方案）
  const detailUrl = new URL(base.toString());
  detailUrl.pathname = `${base.pathname.replace(/\/+$/, "")}/playlist/track/all`;
  detailUrl.searchParams.set("id", id);
  detailUrl.searchParams.set("limit", "500");
  let detail: { songs?: NcmSong[] };
  try {
    detail = (await fetchPublicJson(detailUrl, allowPrivate)) as { songs?: NcmSong[] };
  } catch {
    return null; // 非 NCM API（如 meting）：回退到方案二
  }
  if (!Array.isArray(detail.songs) || detail.songs.length === 0) return null;

  // 2. 分批批量获取播放地址
  const urlMap = new Map<number, string>();
  const ids = detail.songs.map((s) => s.id).filter((v) => typeof v === "number");
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const urlUrl = new URL(base.toString());
    urlUrl.pathname = `${base.pathname.replace(/\/+$/, "")}/song/url/v1`;
    urlUrl.searchParams.set("id", batch.join(","));
    urlUrl.searchParams.set("level", "standard");
    const ures = (await fetchPublicJson(urlUrl, allowPrivate)) as {
      data?: { id: number; url: string | null }[];
    };
    if (Array.isArray(ures.data)) {
      for (const d of ures.data) {
        if (d.url) urlMap.set(d.id, d.url);
      }
    }
  }

  // 3. 组装为播放器 Track（无播放地址（无版权等）的歌曲跳过）
  //    歌词 lrc 指向 NeteaseCloudMusicApi /lyric 接口（URL），由播放器 Lyrics 组件拉取并解析
  const baseStr = base.toString().replace(/\/+$/, "");
  const tracks: Track[] = [];
  for (const s of detail.songs) {
    const url = urlMap.get(s.id) || "";
    if (!url) continue;
    tracks.push({
      id: String(s.id),
      name: s.name || "未知歌曲",
      artist: (s.ar || []).map((a) => a.name).filter(Boolean).join("/") || "未知歌手",
      url,
      cover: s.al?.picUrl || "",
      lrc: `${baseStr}/lyric?id=${s.id}`,
    });
  }
  return tracks.length > 0 ? tracks : null;
}

/**
 * 安全地拉取第三方 JSON：
 * - 重定向逐跳 SSRF 校验统一由 fetchFollowingSafeRedirects 提供（内部用 redirect:"manual"，
 *   每一跳重新校验，并主动丢弃 3xx 响应体），杜绝 302 到内网/云元数据地址
 * - 内网放行仅通过 allowPrivate 显式开启（用于管理员配置的自建 API）
 * - 流式读取并限制响应体大小
 */
async function fetchPublicJson(url: URL, allowPrivate = false): Promise<unknown> {
  const { response } = await fetchFollowingSafeRedirects(url.toString(), {
    allowPrivate,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`第三方响应异常: HTTP ${response.status}`);
  }

  const text = await readBodyLimited(response, MAX_RESPONSE_BYTES);
  return JSON.parse(text);
}

/** 流式读取响应体并限制最大字节数，防止超大响应拖垮服务 */
async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new UnsafeUrlError("响应体超过大小限制");
  }

  if (!res.body) {
    const text = await res.text();
    if (text.length > maxBytes) throw new UnsafeUrlError("响应体超过大小限制");
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new UnsafeUrlError("响应体超过大小限制");
    }
    chunks.push(value);
  }
  // 合并分片后解码（避免 Blob 构造的类型不一致问题）
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
