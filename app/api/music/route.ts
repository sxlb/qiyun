import { NextResponse, NextRequest } from "next/server";
import { assertPublicHttpUrl, fetchFollowingSafeRedirects, UnsafeUrlError } from "@/lib/ssrf";
import { readTextWithLimit } from "@/lib/request-body";
import { prisma } from "@/lib/db";
import type { Track } from "@/hooks/useAudioPlayer";

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
    // 后台音乐配置（歌单 API 基地址 + 账户 Cookie）：私网白名单与 Cookie 透传都取自这一次查询
    const cfg = await loadSongAccountConfig(server);
    const allowPrivate = cfg.songApi !== "" && cfg.songApi === api;
    const baseUrl = await assertPublicHttpUrl(api, { allowPrivate });

    // 方案零之一：网易云官方 API（music.163.com/api）
    //
    // 官方接口的路径与开源实现（NeteaseCloudMusicApi）完全不同：官方没有
    // /playlist/track/all 与 /song/url/v1，拼出来必然 404，这正是「后台选了官方直连、
    // 前台却提示未配置歌单」的成因。按主机识别后走专用分支，不再尝试后两种方案
    // ——那些路径对官方域名同样必然失败，只会白白多打两次上游请求。
    if (baseUrl.hostname === "music.163.com") {
      const official = await tryNeteaseOfficialPlaylist(baseUrl, id, allowPrivate, cfg.cookie);
      return NextResponse.json(official ?? []);
    }

    // 方案零之二：QQ 音乐官方（y.qq.com）—— 官方与开源实现的接口路径同样完全不同
    if (isTencentMusicHost(baseUrl.hostname)) {
      const tencent = await tryTencentOfficialPlaylist(baseUrl, id, allowPrivate, cfg.cookie);
      return NextResponse.json(tencent ?? []);
    }

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

/** 后台音乐配置：歌单 API 基地址（私网白名单用）与当前平台的账户 Cookie */
interface SongAccountConfig {
  songApi: string;
  cookie: string;
}

/**
 * 读取后台音乐配置。
 * - `songApi`：仅当与请求里的 api 精确相同时才放行私网（自建 API 常部署在本机/内网）
 * - `cookie`：按当前平台取对应账户 Cookie，透传给官方接口，用站主的会员权限取播放地址
 * 数据库不可用时返回空配置：保持严格 SSRF（不放行私网），且不携带任何凭据。
 */
async function loadSongAccountConfig(server: string): Promise<SongAccountConfig> {
  try {
    const profile = await prisma.profile.findFirst({ orderBy: { id: "asc" } });
    if (!profile) return { songApi: "", cookie: "" };
    // 用 ?? "" 兜住字段缺失（旧库尚未迁移、或查询只取了部分列）：
    // 这里一旦抛错就会降级成「不放行私网」，把自建 API 变成静默不可用。
    const raw = server === "tencent" ? profile.songCookieTencent : profile.songCookieNetease;
    return {
      songApi: (profile.songApi ?? "").trim(),
      cookie: (raw ?? "").trim(),
    };
  } catch {
    return { songApi: "", cookie: "" };
  }
}

/** 官方接口的响应形状（只取用得到的字段） */
interface OfficialPlaylistDetail {
  playlist?: { trackIds?: { id?: number }[] };
}
interface OfficialSong {
  id?: number;
  name?: string;
  /** 新版字段为 ar / al，旧版为 artists / album */
  ar?: { name?: string }[];
  artists?: { name?: string }[];
  al?: { picUrl?: string };
  album?: { picUrl?: string };
}
interface OfficialSongUrl {
  data?: { id?: number; url?: string | null }[];
}

/** 官方批量接口一次最多查 100 个 id */
const OFFICIAL_BATCH = 100;

/**
 * 网易云官方 API（music.163.com/api）直连取歌单。
 *
 * 官方接口的路径与数据结构跟开源 NeteaseCloudMusicApi 完全不同，实测可用的三个端点：
 * - `/v6/playlist/detail?id=` → `playlist.trackIds` 是全部歌曲 ID（`playlist.tracks` 只给前 10 首）
 * - `/song/detail?ids=[…]`   → 歌曲名 / 歌手 / 封面
 * - `/song/enhance/player/url?ids=[…]&br=128000` → 播放地址；VIP 与无版权曲目返回
 *   `code:-110` 且 url 为 null，这是官方行为，跳过即可，不算错误
 * 歌词走 `/song/lyric?id=`，由播放器的歌词组件按需拉取。
 *
 * 返回 `null` 表示「拿不到这个歌单」（歌单不存在或官方接口异常）；
 * 返回空数组表示「歌单有效，但没有一首可播」。两者对访客的呈现不同，不能混为一谈。
 */
async function tryNeteaseOfficialPlaylist(
  base: URL,
  id: string,
  allowPrivate: boolean,
  cookie: string
): Promise<Track[] | null> {
  // 统一 API 根：后台填 https://music.163.com 或 https://music.163.com/api 都能用
  const trimmed = base.pathname.replace(/\/+$/, "");
  const apiRoot = trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  const build = (sub: string, params: Record<string, string>): URL => {
    const url = new URL(base.toString());
    url.pathname = `${apiRoot}${sub}`;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  };
  // 带站主账户 Cookie 时，官方按会员权限返回播放地址（VIP 曲目也能播；
  // 不填则 VIP / 无版权曲目仍返回 url: null，属官方行为）
  const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};

  // 1) 歌单详情：取全部歌曲 ID
  let detail: OfficialPlaylistDetail;
  try {
    detail = (await fetchPublicJson(
      build("/v6/playlist/detail", { id }),
      allowPrivate,
      headers
    )) as OfficialPlaylistDetail;
  } catch {
    return null;
  }
  const ids = (detail.playlist?.trackIds ?? [])
    .map((t) => t.id)
    .filter((v): v is number => typeof v === "number");
  if (ids.length === 0) return null;

  // 2) 分批取歌曲信息与播放地址
  const info = new Map<number, { name: string; artist: string; cover: string }>();
  const playable = new Map<number, string>();
  for (let i = 0; i < ids.length; i += OFFICIAL_BATCH) {
    const batch = ids.slice(i, i + OFFICIAL_BATCH);
    const idsParam = `[${batch.join(",")}]`;

    try {
      const songs = (await fetchPublicJson(
        build("/song/detail", { ids: idsParam }),
        allowPrivate,
        headers
      )) as { songs?: OfficialSong[] };
      for (const s of songs.songs ?? []) {
        if (typeof s.id !== "number") continue;
        info.set(s.id, {
          name: s.name || "未知歌曲",
          artist: (s.ar ?? s.artists ?? [])
            .map((a) => a.name)
            .filter(Boolean)
            .join("/"),
          cover: s.al?.picUrl || s.album?.picUrl || "",
        });
      }
    } catch {
      // 取不到歌名不影响播放：组装时用「未知歌曲」兜底
    }

    try {
      const urls = (await fetchPublicJson(
        build("/song/enhance/player/url", { ids: idsParam, br: "128000" }),
        allowPrivate,
        headers
      )) as OfficialSongUrl;
      for (const d of urls.data ?? []) {
        if (typeof d.id === "number" && d.url) playable.set(d.id, d.url);
      }
    } catch {
      // 本批取不到播放地址：这批曲目会被跳过，不影响其它批次
    }
  }

  // 3) 组装为播放器 Track；拿不到播放地址（VIP / 无版权）的曲目直接跳过
  const tracks: Track[] = [];
  for (const songId of ids) {
    const url = playable.get(songId);
    if (!url) continue;
    const meta = info.get(songId);
    tracks.push({
      id: String(songId),
      name: meta?.name || "未知歌曲",
      artist: meta?.artist || "未知歌手",
      url,
      cover: meta?.cover || "",
      lrc: build("/song/lyric", { id: String(songId), lv: "1", kv: "1", tv: "-1" }).toString(),
    });
  }
  return tracks;
}

/* ==================== QQ 音乐官方直连 ==================== */

/** QQ 音乐官方主机：后台填 https://y.qq.com（或 c.y.qq.com / u.y.qq.com）都识别 */
function isTencentMusicHost(hostname: string): boolean {
  return hostname === "y.qq.com" || hostname.endsWith(".y.qq.com");
}

/**
 * 从 QQ 音乐 Cookie 里取 uin（QQ 号）。
 * vkey 接口要把它填进请求体；取不到就按未登录（"0"）处理 —— 那样返回的 purl 会全空。
 */
function tencentUinFromCookie(cookie: string): string {
  const m = /(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/i.exec(cookie);
  return m?.[1] ?? "0";
}

/** QQ 音乐歌单 / 榜单响应里的歌曲（榜单把歌曲包在 data 里） */
interface TencentSong {
  songmid?: string;
  songname?: string;
  singer?: { name?: string }[];
  albummid?: string;
  data?: TencentSong;
}

/**
 * QQ 音乐官方直连取歌单。
 *
 * 与网易云不同，QQ 音乐**必须带账户 Cookie**：未登录时 vkey 接口返回的 purl 全为空
 * （结果码 104003），一首也播不了 —— 单看歌单能拿到，也依然「拉不到歌单」。
 * 带上网页登录后的 Cookie（含 uin / qm_keyst），才能用站主的会员权限取到播放地址。
 *
 * 链路（均为明文接口，无需 eapi 加密）：
 * 1. 歌单 `/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?disstid=`；
 *    为空时按榜单 `/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=` 再试一次
 * 2. 播放地址走 `u.y.qq.com/cgi-bin/musicu.fcg` 的 `CgiGetVkey`，
 *    用 GET 的 data 参数传递（免去为它给请求封装补 POST body）
 * 3. 完整地址 = 返回的 `sip[0]` + `purl`
 */
async function tryTencentOfficialPlaylist(
  _base: URL,
  id: string,
  allowPrivate: boolean,
  cookie: string
): Promise<Track[] | null> {
  // Referer 是官方接口的硬要求（缺了会被拒），Cookie 则决定能否取到播放地址
  const headers: Record<string, string> = { Referer: "https://y.qq.com/" };
  if (cookie) headers.Cookie = cookie;

  const songs = await fetchTencentSongs(id, allowPrivate, headers);
  if (songs.length === 0) return null;

  const mids = songs.map((s) => s.songmid).filter((m): m is string => !!m);
  const playable = await fetchTencentPurls(
    mids,
    allowPrivate,
    headers,
    tencentUinFromCookie(cookie)
  );

  const tracks: Track[] = [];
  for (const s of songs) {
    if (!s.songmid) continue;
    const url = playable.get(s.songmid);
    if (!url) continue; // 无版权 / 未登录：官方不给 purl，跳过即可
    tracks.push({
      id: s.songmid,
      name: s.songname || "未知歌曲",
      artist:
        (s.singer ?? [])
          .map((x) => x.name)
          .filter(Boolean)
          .join("/") || "未知歌手",
      url,
      cover: s.albummid
        ? `https://y.qq.com/music/photo_new/T002R300x300M000${s.albummid}.jpg`
        : "",
      // 官方歌词接口要求 Referer 为 y.qq.com，浏览器直连拿不到，故留空（歌照常播）
      lrc: "",
    });
  }
  return tracks;
}

/** 取 QQ 音乐歌单（disstid）或榜单（topid）的歌曲列表 */
async function fetchTencentSongs(
  id: string,
  allowPrivate: boolean,
  headers: Record<string, string>
): Promise<TencentSong[]> {
  const query = "format=json&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0";
  try {
    const playlist = (await fetchPublicJson(
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(id)}&${query}`,
      allowPrivate,
      headers
    )) as { cdlist?: { songlist?: TencentSong[] }[] };
    const list = playlist?.cdlist?.[0]?.songlist;
    if (Array.isArray(list) && list.length > 0) return list;
  } catch {
    /* 不是歌单 ID：下面按榜单再试一次 */
  }

  try {
    const top = (await fetchPublicJson(
      `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=${encodeURIComponent(id)}&${query}`,
      allowPrivate,
      headers
    )) as { songlist?: TencentSong[] };
    return (top?.songlist ?? []).map((s) => s.data ?? s);
  } catch {
    return [];
  }
}

/** 批量取播放地址（vkey → purl），返回 songmid → 完整 URL */
async function fetchTencentPurls(
  mids: string[],
  allowPrivate: boolean,
  headers: Record<string, string>,
  uin: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < mids.length; i += OFFICIAL_BATCH) {
    const batch = mids.slice(i, i + OFFICIAL_BATCH);
    const payload = {
      req_0: {
        module: "vkey.GetVkeyServer",
        method: "CgiGetVkey",
        param: {
          guid: "10000",
          songmid: batch,
          songtype: batch.map(() => 0),
          uin,
          loginflag: 1,
          platform: "20",
        },
      },
      comm: { uin: Number(uin) || 0, format: "json", ct: 24, cv: 0 },
    };
    try {
      const res = (await fetchPublicJson(
        `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`,
        allowPrivate,
        headers
      )) as {
        req_0?: { data?: { sip?: string[]; midurlinfo?: { songmid?: string; purl?: string }[] } };
      };
      const sip = res?.req_0?.data?.sip?.[0] ?? "";
      for (const info of res?.req_0?.data?.midurlinfo ?? []) {
        if (info.songmid && info.purl) out.set(info.songmid, sip + info.purl);
      }
    } catch {
      // 本批失败不影响其它批次
    }
  }
  return out;
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
async function fetchPublicJson(
  url: URL | string,
  allowPrivate = false,
  headers?: Record<string, string>
): Promise<unknown> {
  const { response } = await fetchFollowingSafeRedirects(url.toString(), {
    allowPrivate,
    // 账户 Cookie 由此透传给上游（官方接口靠它才返回 VIP 曲目的播放地址）
    ...(headers ? { headers } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`第三方响应异常: HTTP ${response.status}`);
  }

  const text = await readBodyLimited(response, MAX_RESPONSE_BYTES);
  return JSON.parse(text);
}

/**
 * 流式读取响应体并限制最大字节数，防止超大响应拖垮服务。
 *
 * 读取实现复用 lib/request-body 的 readTextWithLimit（与 /api/icons 共用同一份，
 * 此前各写一份、逻辑重复）；本函数只负责把结果映射成本路由既有的错误语义 ——
 * 超限仍抛 UnsafeUrlError，保持对上层提示不变。
 */
async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
  const read = await readTextWithLimit(res, maxBytes);
  if (read.ok) return read.text;
  if (read.reason === "over-limit") throw new UnsafeUrlError("响应体超过大小限制");
  throw new Error("读取上游响应体失败");
}
