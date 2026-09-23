/**
 * 后台各站点信息面板共享的类型、默认值与常量配置。
 * 站点信息、主题与壁纸、音乐设置等多个面板都读写 /api/profile 的完整配置对象，
 * 因此共享同一套 Profile 字段定义与默认值，避免各面板重复维护导致不同步。
 */

// 完整站点配置字段（与 ProfilePanel 保持一致，另含 friendLinksTitle）
export interface ProfileShape {
  avatar: string;
  siteIcon: string;
  nickname: string;
  bio: string;
  github: string;
  email: string;
  bgApi: string;
  coverType: string;
  autoBGSwitchInterval: number;
  wallpaperRefresh: number;
  theme: string;
  songApi: string;
  songServer: string;
  songId: string;
  musicAutoplay: boolean;
  siteUrl: string;
  siteIcp: string;
  siteMps: string;
  siteStart: string;
  siteLinksTitle: string;
  siteLinksIcon: string;
  friendLinksTitle: string;
  iconfontUrl: string;
  logoArtFont: boolean;
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
  useRandomAvatar: boolean;
  welcomeEnabled: boolean;
  welcomeIndex: number;
  welcomeMessages: string;
  // 高级配置
  siteTitle: string;
  siteDescription: string;
  siteKeywords: string;
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
  avatarShape: string;
  avatarBorderColor: string;
  siteFooterHtml: string;
  // 天气配置（统一通过 /api/profile 读写 Profile 记录）。
  // 显式声明到接口中：面板保存时会回传完整 profile 对象，若不声明，
  // 仅靠运行时 spread 隐式透传，一旦有人加 .pick()/.strict() 会静默清空天气配置。
  weatherProvider: string;
  amapKey: string;
  amapSecretKey: string;
  txWeatherKey: string;
  txWeatherSk: string;
  weatherCity: string;
}

export const INITIAL_PROFILE: ProfileShape = {
  avatar: "",
  siteIcon: "",
  nickname: "",
  bio: "",
  github: "",
  email: "",
  bgApi: "",
  coverType: "bing",
  autoBGSwitchInterval: 0,
  wallpaperRefresh: 0,
  theme: "system",
  songApi: "https://api.injahow.cn/meting",
  songServer: "netease",
  songId: "3778678",
  musicAutoplay: false,
  siteUrl: "",
  siteIcp: "",
  siteMps: "",
  siteStart: "",
  siteLinksTitle: "我的网站",
  siteLinksIcon: "link",
  friendLinksTitle: "友情链接",
  iconfontUrl: "",
  logoArtFont: true,
  customFontEnabled: false,
  customFontFamily: "",
  customFontScope: "nickname",
  loadingScreen: true,
  clickEffect: true,
  consoleEgg: true,
  showStats: true,
  dynamicTitle: true,
  topProgressBar: true,
  seasonalEffectEnabled: false,
  commandPalette: true,
  useRandomAvatar: false,
  welcomeEnabled: true,
  welcomeIndex: 0,
  welcomeMessages: JSON.stringify([
    "欢迎来到本站～",
    "很高兴遇见你，祝你愉快！",
    "愿时光温柔，伴你左右",
    "相逢即是缘分，欢迎光临",
    "欢迎回来，好久不见",
  ]),
  // 高级配置
  siteTitle: "",
  siteDescription: "",
  siteKeywords: "",
  accentColor: "",
  glassOpacity: 28,
  glassBlur: 16,
  analyticsScript: "",
  headScript: "",
  timeFormat: "24",
  showSeconds: true,
  dateFormat: "YYYY年M月D日 dddd",
  hitokotoType: "",
  bgOverlay: 0,
  avatarShape: "circle",
  avatarBorderColor: "",
  siteFooterHtml: "",
  // 天气配置（与 lib/validation.ts profileSchema 默认值保持一致）
  weatherProvider: "tencent",
  amapKey: "",
  amapSecretKey: "",
  txWeatherKey: "",
  txWeatherSk: "",
  weatherCity: "",
};

// —— 表单统一样式 ——
export const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 admin-select";

export const rangeClass = "w-full accent-primary admin-range";

// —— 共享配置加载 / 缓存 ——
// 站点信息、主题与壁纸、音乐设置等多个面板读写同一份完整配置。首次面板挂载时请求一次，
// 缓存后其余面板挂载可即时读取（避免每次切换 tab 都重复 GET /api/profile 出现 loading）。
// 任一面板保存成功后调用 setCachedProfile 更新缓存，保证面板间数据同步。
let cachedProfile: ProfileShape | null = null;
let inflightProfile: Promise<ProfileShape | null> | null = null;

/**
 * 计算「本面板相对基线改过哪些字段」（仅含真正变化的键）。
 *
 * 三个 profile 面板（站点信息/主题/音乐）都读写同一份完整配置：如果各自把本地整份
 * 快照 PUT 回去，用旧快照就会覆盖别的面板已经保存的字段。因此保存时必须只提交本面板
 * 改动过的字段，再与服务端最新基线合并后提交。
 *
 * @param current 面板当前表单值
 * @param baseline 面板载入（或上次保存成功）时的值；为 null 表示尚未载入，视为无改动
 */
export function profileFieldPatch<T extends object, B extends object>(
  current: T,
  baseline: B | null | undefined
): Record<string, unknown> {
  if (!baseline) return {};
  const base = baseline as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (value !== base[key]) patch[key] = value;
  }
  return patch;
}

export async function loadProfile(force = false): Promise<ProfileShape | null> {
  if (!force && cachedProfile) return cachedProfile;
  if (!inflightProfile) {
    inflightProfile = (async () => {
      try {
        const res = await fetch("/api/profile");
        const data = res.ok ? await res.json() : null;
        if (data) {
          // 兼容旧版配置（1=随机开关 / 3=旧间隔）：非法值重置为不刷新
          if (![0, 5, 10, 30].includes(data.wallpaperRefresh)) data.wallpaperRefresh = 0;
          cachedProfile = { ...INITIAL_PROFILE, ...data };
          return cachedProfile;
        }
        return cachedProfile;
      } catch {
        return cachedProfile;
      } finally {
        inflightProfile = null;
      }
    })();
  }
  return inflightProfile;
}

export function setCachedProfile(p: Partial<ProfileShape>) {
  cachedProfile = { ...INITIAL_PROFILE, ...p };
}

/** 是否已有内存缓存：面板初始 loading 据此置 false，切换面板时零闪烁 */
export function hasCachedProfile(): boolean {
  return cachedProfile !== null;
}

// —— 壁纸与主题 ——
export const COVER_TYPES = [
  { value: "bing", label: "必应每日壁纸" },
  { value: "landscape", label: "随机风景" },
  { value: "anime", label: "随机动漫" },
  { value: "custom", label: "自定义地址" },
];

export const SWITCH_INTERVALS = [
  { value: "0", label: "不自动切换" },
  { value: "1", label: "每 15 秒" },
  { value: "2", label: "每 30 秒" },
  { value: "3", label: "每 45 秒" },
];

export const WALLPAPER_REFRESH = [
  { value: "0", label: "不刷新（缓存固定）" },
  { value: "5", label: "每 5 分钟" },
  { value: "10", label: "每 10 分钟" },
  { value: "30", label: "每 30 分钟" },
];

export const THEMES = [
  { value: "system", label: "跟随系统" },
  { value: "time", label: "跟随时间" },
  { value: "bg", label: "跟随壁纸" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export const AVATAR_SHAPES = [
  { value: "circle", label: "圆形" },
  { value: "rounded", label: "圆角方形" },
  { value: "square", label: "方形" },
];

// —— 音乐播放 ——
export const SONG_SERVERS = [
  { value: "netease", label: "网易云音乐" },
  { value: "tencent", label: "QQ 音乐" },
];

export const SONG_API_PRESETS = [
  { value: "", label: "自定义 / 未配置", desc: "手动输入 API 地址" },
  {
    value: "https://api.injahow.cn/meting",
    label: "Meting 公共 API（推荐）",
    desc: "公益接口，支持网易云 / QQ 音乐",
  },
  {
    value: "https://netease-cloud-music-api-five-roan.vercel.app",
    label: "NeteaseCloudMusicApi（Vercel 示例）",
    desc: "开源网易云 API，支持完整功能",
  },
  {
    value: "https://music.163.com/api",
    label: "网易云官方 API（直连）",
    desc: "网易云官方接口，部分功能可能受限",
  },
];