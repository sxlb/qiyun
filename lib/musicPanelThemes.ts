/**
 * 音乐面板风格（主题系统）
 *
 * 三套风格：黑胶暖色 / 纸面印刷 / 黑白等宽。旧的玻璃霓虹已下线，不再作为选项。
 *
 * 配置分两层，与站点既有习惯一致：
 * - 站点默认：后台 profile.musicPanelStyle（决定所有访客默认看到哪个风格）
 * - 本机覆盖：localStorage（访客在音乐面板里自己换，只影响自己；可选「跟随站点」）
 *
 * 风格的**实际视觉**在 app/globals.css 的 `.mp[data-style=...]` 变量块里，
 * 本模块只负责取值与解析，保持纯函数、可单测。
 */

export type MusicPanelStyle = "vinyl" | "editorial" | "mono";

/** 本机选择「跟随站点」时存储的值 */
export const FOLLOW_SITE = "follow";

/** localStorage 键名（与播放器既有的 music-player-* 前缀保持一致） */
export const MUSIC_PANEL_STYLE_KEY = "music-player-panel-style";

/** 兜底风格：甲 · 黑胶暖色 */
export const DEFAULT_MUSIC_PANEL_STYLE: MusicPanelStyle = "vinyl";

/** 风格清单（后台下拉与前端切换共用同一份，避免两处各写一份） */
export const MUSIC_PANEL_STYLE_OPTIONS: {
  value: MusicPanelStyle;
  label: string;
  hint: string;
}[] = [
  {
    value: "vinyl",
    label: "黑胶暖色",
    hint: "炭黑配琥珀，中央唱片缓缓转动；歌单做成唱片背面的曲目表",
  },
  {
    value: "editorial",
    label: "纸面印刷",
    hint: "纸白底配墨黑衬线，歌单像杂志目录；三套里唯一的亮色面板，反差最大",
  },
  {
    value: "mono",
    label: "黑白等宽",
    hint: "纯黑配一点青色，等宽字体与直角描边；信息密度最高，气质偏冷",
  },
];

const STYLE_VALUES: string[] = MUSIC_PANEL_STYLE_OPTIONS.map((o) => o.value);

/** 是否为受支持的风格值（把任意来源的字符串收敛成联合类型） */
export function isMusicPanelStyle(value: unknown): value is MusicPanelStyle {
  return typeof value === "string" && STYLE_VALUES.includes(value);
}

/**
 * 收敛某一层的取值：非法值 / 空值 / 旧版残留（如已下线的 glass）一律视为
 * 「这一层没有意见」，交给下一层决定，而不是直接兜底 —— 否则浏览器里残留的
 * 历史值会把站点配置也一起顶掉。
 */
function normalize(value: string | null | undefined): MusicPanelStyle | null {
  return isMusicPanelStyle(value) ? value : null;
}

/**
 * 解析最终生效的风格：本机覆盖优先，其次站点默认，最后兜底到 DEFAULT_MUSIC_PANEL_STYLE。
 */
export function resolveMusicPanelStyle(input: {
  siteDefault?: string | null;
  localOverride?: string | null;
}): MusicPanelStyle {
  return normalize(input.localOverride) ?? normalize(input.siteDefault) ?? DEFAULT_MUSIC_PANEL_STYLE;
}

/* ==================== 三套风格的结构差异 ==================== */

/**
 * 三套风格不只是换配色：甲有中央黑胶唱片、乙是大字号衬线标题、丙用段式 LED 进度条。
 * 这些差异全部收敛到下面这张表，组件按表渲染，避免 JSX 里散落 `style === "vinyl" ? …`。
 */
export interface MusicPanelTraits {
  /** 面板头部左侧的标签（SIDE A / NOW PLAYING） */
  side: string;
  /** 头部是否显示「当前曲序 / 总数」 */
  showCount: boolean;
  /** 是否渲染中央黑胶唱片 */
  disc: boolean;
  /** 进度条形态：细线 / 段式 LED */
  progress: "line" | "led";
  /** 歌词区块标题 */
  lyricLabel: string;
  /** 曲目区块标题 */
  listLabel: string;
  /** 歌词对齐方式 */
  lyricAlign: "center" | "left";
  /** 当前歌词行的前缀标记 */
  lyricCursor: string;
}

export const MUSIC_PANEL_TRAITS: Record<MusicPanelStyle, MusicPanelTraits> = {
  vinyl: {
    side: "SIDE A",
    showCount: false,
    disc: true,
    progress: "line",
    lyricLabel: "歌词",
    listLabel: "曲目",
    lyricAlign: "center",
    lyricCursor: "",
  },
  editorial: {
    side: "NOW PLAYING",
    showCount: true,
    disc: false,
    progress: "line",
    lyricLabel: "歌词",
    listLabel: "目录",
    lyricAlign: "center",
    lyricCursor: "",
  },
  mono: {
    side: "NOW PLAYING",
    showCount: true,
    disc: false,
    progress: "led",
    lyricLabel: "LYRICS",
    listLabel: "TRACKS",
    lyricAlign: "left",
    lyricCursor: "> ",
  },
};

/** 取某套风格的结构特征（非法值兜底到默认风格，保证组件拿到的一定是完整对象） */
export function musicPanelTraits(style: MusicPanelStyle): MusicPanelTraits {
  return MUSIC_PANEL_TRAITS[style] ?? MUSIC_PANEL_TRAITS[DEFAULT_MUSIC_PANEL_STYLE];
}

/* ==================== 面板内的本机偏好 ==================== */

/** 顶部常驻歌词胶囊开关 */
export const TOP_LYRICS_KEY = "music-player-top-lyrics";
/** 面板内是否显示歌词区块 */
export const SHOW_LYRICS_KEY = "music-player-show-lyrics";
/** 面板内是否显示曲目区块 */
export const SHOW_PLAYLIST_KEY = "music-player-show-playlist";
/** 顶部悬浮歌词的字号档位 */
export const TOP_LYRICS_SIZE_KEY = "music-player-top-lyrics-size";

/**
 * 顶部悬浮歌词的字号档位，共 7 档。
 *
 * 同一档位在移动端与桌面端取不同的像素（见 globals.css 的 `.top-lyric[data-size]`）：
 * 手机离眼近、视口窄，同样的 px 显得更大；桌面离眼远、视口宽，需要更大的字号才有同等可读性。
 * 因此每个档位不是单一数值，而是「移动端值 / 桌面端值」一对。
 */
export type LyricSizeLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 默认档位：标准（4） */
export const DEFAULT_LYRIC_SIZE: LyricSizeLevel = 4;

export const LYRIC_SIZE_OPTIONS: { value: LyricSizeLevel; label: string }[] = [
  { value: 1, label: "特小" },
  { value: 2, label: "很小" },
  { value: 3, label: "小" },
  { value: 4, label: "标准" },
  { value: 5, label: "大" },
  { value: 6, label: "很大" },
  { value: 7, label: "特大" },
];

const LYRIC_SIZE_VALUES: number[] = LYRIC_SIZE_OPTIONS.map((o) => o.value);

/** 收敛任意来源的档位值（字符串 / 数字 / null / 历史脏值），非法一律回落默认档 */
export function parseLyricSize(value: unknown): LyricSizeLevel {
  const level = typeof value === "number" ? value : Number(value);
  return LYRIC_SIZE_VALUES.includes(level) ? (level as LyricSizeLevel) : DEFAULT_LYRIC_SIZE;
}

/** 档位对应的中文名（设置面板里回显当前档位） */
export function lyricSizeLabel(level: LyricSizeLevel): string {
  return LYRIC_SIZE_OPTIONS.find((o) => o.value === level)?.label ?? "";
}

export interface MusicPanelPrefs {
  /** 顶部常驻歌词胶囊（与顶部进度条共用同一开关习惯） */
  topLyrics: boolean;
  /** 面板内显示歌词区块 */
  showLyrics: boolean;
  /** 面板内显示曲目区块 */
  showPlaylist: boolean;
  /** 顶部悬浮歌词的字号档位 */
  lyricSize: LyricSizeLevel;
}

export const DEFAULT_MUSIC_PANEL_PREFS: MusicPanelPrefs = {
  topLyrics: true,
  showLyrics: true,
  showPlaylist: true,
  lyricSize: DEFAULT_LYRIC_SIZE,
};

/**
 * 解析布尔偏好：只认 `"1"` / `"0"`，其余（null / 空串 / 历史脏值）一律回落到默认值。
 * 不把「非 1」直接当作 false —— 否则 localStorage 里一个残留的空串会把默认开启的功能关掉。
 */
export function parseBoolPref(value: string | null | undefined, fallback: boolean): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

/** 布尔偏好落盘格式（与 parseBoolPref 成对） */
export function formatBoolPref(value: boolean): string {
  return value ? "1" : "0";
}

/** 把 localStorage 里逐键读取的裸值收敛成完整偏好对象 */
export function parseMusicPanelPrefs(raw: {
  topLyrics?: string | null;
  showLyrics?: string | null;
  showPlaylist?: string | null;
  lyricSize?: string | null;
}): MusicPanelPrefs {
  return {
    topLyrics: parseBoolPref(raw.topLyrics, DEFAULT_MUSIC_PANEL_PREFS.topLyrics),
    showLyrics: parseBoolPref(raw.showLyrics, DEFAULT_MUSIC_PANEL_PREFS.showLyrics),
    showPlaylist: parseBoolPref(raw.showPlaylist, DEFAULT_MUSIC_PANEL_PREFS.showPlaylist),
    lyricSize: parseLyricSize(raw.lyricSize),
  };
}
