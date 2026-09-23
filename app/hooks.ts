/**
 * 主页数据准备（Server Helper）
 * 接收 Prisma Profile 行对象，返回组件所需的完整 props + 默认值 + CSS 派生计算结果。
 */

import { prisma } from "@/lib/db";
import { DEFAULT_WELCOME_MESSAGES } from "@/lib/validation";
import { resolveWallpaperUrl } from "@/lib/wallpaperCache";
import type { Profile } from "@prisma/client";
import type { ThemeMode } from "@/components/ThemeProvider";

// ── 静态常量：昵称艺术字体 ──
// 内置仅一款「有爱圆体」（中英双语，随镜像打包），由 logoArtFont 开关控制启停；
// 若需按品牌选择更多字体，应改为引入对应字体文件并恢复多字体映射，而不是仅改一个字段值。
const LOGO_ART_FONT_CLASS = "font-art-nowar";

export interface SiteLinkRow {
  id: number;
  name: string;
  url: string;
  icon?: string;
  sort: number;
}

export interface SocialLinkRow {
  id: number;
  name: string;
  icon: string;
  url: string;
  tip: string;
  sort: number;
}

export interface FriendLinkRow {
  id: number;
  name: string;
  url: string;
  icon: string;
  description: string;
  sort: number;
}

export interface ProjectRow {
  id: number;
  title: string;
  description: string;
  url: string;
  image: string;
  tags: string;
  featured: boolean;
  enabled: boolean;
  sort: number;
}

export interface SkillRow {
  id: number;
  name: string;
  level: number;
  icon: string;
  sort: number;
}

// ── 头像相关工具函数 ──────────────────────────────────────────

interface AvatarFallbacks {
  finalAvatar: string;
  avatarShapeClass: string;
  avatarStyle: React.CSSProperties | undefined;
}

/**
 * 从外部服务拉取一张随机头像（备用）；失败时返回空串走本地默认。
 * 注意：不设置 next.revalidate，避免 ISR 将"某一个人的随机头像"错误地缓存为公共页面——
 * SSR 阶段不同用户的请求应各自拿到独立头像。若源不稳定，首页降级使用默认头像即可。
 */
async function fetchRandomAvatar(): Promise<string> {
  try {
    const res = await fetch("https://v2.xxapi.cn/api/head?return=json", {
      // 外部头像源失败/超时快速回退（仅阻塞当前 SSR 请求）；不设置 next.revalidate 防止公共缓存泄漏
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return "";
    const json = await res.json();
    return typeof json?.data === "string" && json.data ? json.data : "";
  } catch {
    return "";
  }
}

async function resolveAvatar(
  profile: Pick<Profile, "avatar" | "useRandomAvatar" | "avatarShape" | "avatarBorderColor">
): Promise<AvatarFallbacks> {
  const useRandomAvatar = profile.useRandomAvatar ?? false;
  let finalAvatar = profile.avatar || "";

  if (useRandomAvatar && !finalAvatar) {
    finalAvatar = await fetchRandomAvatar();
  }

  const shape = profile.avatarShape || "circle";
  const shapeClass =
    shape === "square" ? "rounded-none"
    : shape === "rounded" ? "rounded-2xl"
    : "rounded-full";

  const borderColor = profile.avatarBorderColor || "";
  const style = borderColor
    ? { boxShadow: `0 0 0 2px ${borderColor}, 0 8px 24px rgba(0, 0, 0, 0.35)` }
    : undefined;

  return { finalAvatar, avatarShapeClass: shapeClass, avatarStyle: style };
}

// ── 季节特效 ──────────────────────────────────────────────────
export type SeasonEffect = "firefly" | "snow" | "lantern";

// ── 数据库查询重试 ────────────────────────────────────────────
/**
 * SQLite 偶发 busy / 容器刚启动未就绪时的兜底：
 * 首次部署访问时查询可能短暂失败，**最多重试 1 次后若仍失败则 throw**。
 * 原因：Next.js ISR 会把 200 响应（哪怕残缺）缓存 60 秒，而 500 不会被缓存 ——
 * throw 让页面返回 500，ISR 继续服务上一版可用页面，下一次请求自动重试。
 * 返回空数组会把残缺页缓存 60 秒（与「卡片消失」现象吻合）。
 */
async function withRetry<T>(fn: () => Promise<T>, delayMs = 300): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, delayMs));
    const result = await fn(); // 重试仍失败直接 throw，让调用方触发 ISR 500
    return result;
  }
}

/** 首页关联数据默认走 meting 公共 API + 网易云热歌榜，开箱即用 */
export const DEFAULT_SONG_API = "https://api.injahow.cn/meting";
export const DEFAULT_SONG_ID = "3778678";

export function getSeasonalEffect(): SeasonEffect {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 11) return "firefly";
  return (month === 1 || month === 2) ? "lantern" : "snow";
}

// ── 核心导出：将 Profile 转换为 Home component props ────
// 注意：这是服务端数据准备函数（非 React Hook），刻意不用 use 前缀，
// 避免被 react-hooks/rules-of-hooks 误判为 Hook 并限制调用位置。
export async function getHomeData(profile: Profile | null): Promise<{
  // ===== 基础信息 =====
  nickname: string;
  bio: string;
  finalAvatar: string;
  siteIcon: string;
  bgApi: string;
  /** SSR 阶段解析的壁纸直链（空串表示需前端兜底下载） */
  wallpaperUrl: string;

  // ===== 进阶配置 =====
  coverType: string;
  autoBGSwitchInterval: number;
  wallpaperRefresh: number;
  theme: ThemeMode;
  songApi: string;
  songServer: string;
  songId: string;
  /** 音乐自动播放（后台「音乐设置」开关控制） */
  musicAutoplay: boolean;
  siteUrl: string;
  siteIcp: string;
  siteMps: string;
  siteStart: string;
  siteLinksTitle: string;
  siteLinksIcon: string;
  friendLinksTitle: string;
  /** 阿里云矢量图标库 symbol 脚本地址（空串表示未配置） */
  iconfontUrl: string;
  logoFontClass: string;
  /** 自定义字体 font-family（仅范围=昵称时提供；全站时由 CustomFont 组件处理） */
  logoFontFamily: string | undefined;
  /** 自定义字体配置（透传给 CustomFont 组件） */
  customFontEnabled: boolean;
  customFontFamily: string;
  customFontScope: string;
  loadingScreen: boolean;
  clickEffect: boolean;
  consoleEgg: boolean;
  showStats: boolean;
  dynamicTitle: boolean;
  topProgressBar: boolean;
  seasonalEffectEnabled: boolean;
  commandPalette: boolean;
  welcomeEnabled: boolean;
  welcomeIndex: number;
  welcomeMessages: string;

  // ===== 高级配置 =====
  accentColor: string;
  glassOpacity: number;
  glassBlur: number;
  analyticsScript: string;
  headScript: string;
  timeFormat: string;
  showSeconds: boolean;
  dateFormat: string;
  hitokotoType: string;
  bgOverlay: number;
  avatarShapeClass: string;
  avatarStyle: React.CSSProperties | undefined;
  /** 自定义头像边框色（空串时前端使用默认白色半透明描边） */
  avatarBorderColor: string;
  /** 页脚自定义 HTML（管理员可信内容） */
  siteFooterHtml: string;

  // ===== 关联数据 =====
  siteLinks: SiteLinkRow[];
  socialLinks: SocialLinkRow[];
  friendLinks: FriendLinkRow[];
  /** 已启用的作品（首页「作品集」展示） */
  projects: ProjectRow[];
  /** 已启用的技能（首页「技能云」展示，按 sort 排序） */
  skills: SkillRow[];
  effectType: SeasonEffect;
}> {
  const rawNickname = profile?.nickname || "无名";
  const avatarPivot = {
    avatar: profile?.avatar || "",
    useRandomAvatar: profile?.useRandomAvatar ?? false,
    avatarShape: profile?.avatarShape || "circle",
    avatarBorderColor: profile?.avatarBorderColor || "",
  };

  // 并行执行多个独立的异步操作，缩短 SSR 时间；DB 查询失败时 throw，
  // 让 Next.js ISR 返回 500（不缓存残缺页），下一次请求自动重试。
  //
  // 壁纸解析等外网调用用 .catch 降级即可；关联数据查询失败则直接 throw——
  // 宁可整页返回 500（用户看到错误后刷新可重试），也不缓存"半张空白页面"。
  const [avatarResult, wallpaperUrl, siteLinksP, socialLinksP, friendLinksP, projectsP, skillsP] = await Promise.all([
    resolveAvatar(avatarPivot),
    resolveWallpaperUrl(profile?.bgApi || "").catch(() => ""),
    withRetry(() => prisma.siteLink.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] })),
    withRetry(() => prisma.socialLink.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] })),
    withRetry(() => prisma.friendLink.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] })),
    withRetry(() => prisma.project.findMany({ where: { enabled: true }, orderBy: [{ featured: "desc" }, { sort: "asc" }, { id: "asc" }] })),
    withRetry(() => prisma.skill.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] })),
  ]);

  const { finalAvatar, avatarShapeClass, avatarStyle } = avatarResult;

  return {
    // 基础
    nickname: rawNickname,
    bio: profile?.bio || "这个人很懒，什么都没写",
    finalAvatar,
    siteIcon: profile?.siteIcon || "",
    bgApi: profile?.bgApi || "",
    // SSR 阶段解析壁纸直链（用于 <link rel="preload"> 与首次直接加载）
    wallpaperUrl,

    // 进阶
    coverType: profile?.coverType || "bing",
    autoBGSwitchInterval: profile?.autoBGSwitchInterval ?? 0,
    wallpaperRefresh: profile?.wallpaperRefresh ?? 0,
    theme: (profile?.theme || "system") as ThemeMode,
    songApi: profile?.songApi || DEFAULT_SONG_API,
    songServer: profile?.songServer || "netease",
    songId: profile?.songId || DEFAULT_SONG_ID,
    musicAutoplay: profile?.musicAutoplay ?? false,
    siteUrl: profile?.siteUrl || "",
    siteIcp: profile?.siteIcp || "",
    siteMps: profile?.siteMps || "",
    siteStart: profile?.siteStart || "",
    siteLinksTitle: profile?.siteLinksTitle || "我的网站",
    siteLinksIcon: profile?.siteLinksIcon || "link",
    friendLinksTitle: profile?.friendLinksTitle || "友情链接",
    iconfontUrl: profile?.iconfontUrl || "",
    logoFontClass: (profile?.logoArtFont ?? true) ? LOGO_ART_FONT_CLASS : "font-bold",
    // 自定义字体（仅范围=昵称时注入到昵称元素；范围=全站时由 CustomFont 组件注入 body）
    logoFontFamily: profile?.customFontEnabled && profile?.customFontFamily?.trim()
      ? `"${profile.customFontFamily.trim()}", var(--font-noto-sc), var(--font-inter), sans-serif`
      : undefined,
    // 自定义字体配置透传（供 CustomFont 组件使用）
    customFontEnabled: profile?.customFontEnabled ?? false,
    customFontFamily: profile?.customFontFamily || "",
    customFontScope: profile?.customFontScope || "nickname",
    loadingScreen: profile?.loadingScreen ?? true,
    clickEffect: profile?.clickEffect ?? true,
    consoleEgg: profile?.consoleEgg ?? true,
    showStats: profile?.showStats ?? true,
    dynamicTitle: profile?.dynamicTitle ?? true,
    topProgressBar: profile?.topProgressBar ?? true,
    seasonalEffectEnabled: profile?.seasonalEffectEnabled ?? false,
    commandPalette: profile?.commandPalette ?? true,
    welcomeEnabled: profile?.welcomeEnabled ?? true,
    welcomeIndex: profile?.welcomeIndex ?? 0,
    welcomeMessages: profile?.welcomeMessages || JSON.stringify(DEFAULT_WELCOME_MESSAGES),

    // 高级
    accentColor: profile?.accentColor || "",
    glassOpacity: profile?.glassOpacity ?? 28,
    glassBlur: profile?.glassBlur ?? 16,
    analyticsScript: profile?.analyticsScript || "",
    headScript: profile?.headScript || "",
    timeFormat: profile?.timeFormat || "24",
    showSeconds: profile?.showSeconds ?? true,
    dateFormat: profile?.dateFormat || "YYYY年M月D日 dddd",
    hitokotoType: profile?.hitokotoType || "",
    bgOverlay: profile?.bgOverlay ?? 0,
    avatarShapeClass,
    avatarStyle,
    avatarBorderColor: profile?.avatarBorderColor || "",
    siteFooterHtml: profile?.siteFooterHtml || "",

    // 关联（DB 查询失败 fallback 空数组，避免整页数据丢失）
    siteLinks: siteLinksP,
    socialLinks: socialLinksP,
    friendLinks: friendLinksP,
    projects: projectsP,
    skills: skillsP,
    effectType: getSeasonalEffect(),
  };
}
