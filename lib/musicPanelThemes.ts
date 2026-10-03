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
  /** 设置视图头部左侧的标签（进入设置后替换 side，避免沿用「正在播放」这类语义不符的标题） */
  settingsLabel: string;
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
    settingsLabel: "设置",
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
    settingsLabel: "设置",
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
    settingsLabel: "SETTINGS",
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
/*
 * 全部偏好只存本机（localStorage），不上报服务端 —— 与「站点默认风格在后台配置、
 * 访客可在面板里本机覆盖」的两层设计一致。因此新增设置项不需要动数据库与迁移。
 *
 * 键名统一收敛在本模块：组件与 useAudioPlayer 都从这里取，避免同一个键在两处
 * 各写一遍字符串（漏改一处就会出现「设置完刷新就失效」这类难查的问题）。
 */

/** 顶部常驻歌词胶囊开关 */
export const TOP_LYRICS_KEY = "music-player-top-lyrics";
/** 面板内是否显示歌词区块 */
export const SHOW_LYRICS_KEY = "music-player-show-lyrics";
/** 面板内是否显示曲目区块 */
export const SHOW_PLAYLIST_KEY = "music-player-show-playlist";
/** 顶部悬浮歌词的字号档位 */
export const TOP_LYRICS_SIZE_KEY = "music-player-top-lyrics-size";
/** 初始音量（0-100） */
export const DEFAULT_VOLUME_KEY = "music-player-default-volume";
/** 记住播放模式 */
export const REMEMBER_PLAY_MODE_KEY = "music-player-remember-mode";
/** 续播上次曲目 */
export const RESUME_LAST_TRACK_KEY = "music-player-resume-track";
/** 关闭音乐列表弹窗后是否继续播放 */
export const KEEP_PLAYING_KEY = "music-player-keep-playing";
/** 面板不透明度（40-100，百分比） */
export const PANEL_OPACITY_KEY = "music-player-panel-opacity";
/** 歌词聚焦：非当前行模糊淡出 */
export const LYRIC_BLUR_KEY = "music-player-lyric-blur";
/** 歌词对齐覆盖（site=跟随面板风格） */
export const LYRIC_ALIGN_KEY = "music-player-lyric-align";
/** 歌单显示封面缩略图 */
export const TRACK_COVER_KEY = "music-player-track-cover";
/** 键盘快捷键（空格 / PgUp / PgDn） */
export const HOTKEYS_KEY = "music-player-hotkeys";
/** 系统媒体控制（锁屏 / 耳机按键） */
export const MEDIA_SESSION_KEY = "music-player-media-session";

/* —— 播放行为类键：由 useAudioPlayer 读写（音量 / 静音 / 进度 / 上次曲目） —— */
/** 上一次的音量 */
export const AUDIO_VOLUME_KEY = "music-player-volume";
/** 是否静音 */
export const AUDIO_MUTED_KEY = "music-player-muted";
/** 每首曲目的播放进度表 */
export const AUDIO_PROGRESS_KEY = "music-player-progress";
/** 上次播放的曲目 id（续播用） */
export const AUDIO_LAST_TRACK_KEY = "music-player-last-track";
/** 上次的播放模式（顺序/列表循环/单曲循环/随机） */
export const AUDIO_PLAY_MODE_KEY = "music-player-play-mode";

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

/* —— 歌词对齐：默认跟随面板风格（三套风格各有自己的对齐），可本机强制覆盖 —— */
export const LYRIC_ALIGN_SITE = "site";
export type LyricAlignPref = typeof LYRIC_ALIGN_SITE | "center" | "left";

export const LYRIC_ALIGN_OPTIONS: { value: LyricAlignPref; label: string }[] = [
  { value: LYRIC_ALIGN_SITE, label: "跟随风格" },
  { value: "center", label: "居中" },
  { value: "left", label: "左对齐" },
];

const LYRIC_ALIGN_VALUES: string[] = LYRIC_ALIGN_OPTIONS.map((o) => o.value);

export interface MusicPanelPrefs {
  /** 顶部常驻歌词胶囊（与顶部进度条共用同一开关习惯） */
  topLyrics: boolean;
  /** 面板内显示歌词区块 */
  showLyrics: boolean;
  /** 面板内显示曲目区块 */
  showPlaylist: boolean;
  /** 顶部悬浮歌词的字号档位 */
  lyricSize: LyricSizeLevel;
  /** 歌词聚焦：非当前行模糊淡出 */
  lyricBlur: boolean;
  /** 歌词对齐：site 表示跟随面板风格 */
  lyricAlign: LyricAlignPref;
  /** 歌单行显示封面缩略图 */
  trackCover: boolean;
  /** 初始音量（0-100）：还没有记住过音量时使用 */
  volume: number;
  /** 面板不透明度（40-100，百分比） */
  panelOpacity: number;
  /** 记住播放模式（顺序/列表循环/单曲循环/随机） */
  rememberPlayMode: boolean;
  /** 续播上次曲目：加载歌单后自动选中上次在听的那首（不自动播放） */
  resumeLastTrack: boolean;
  /** 关闭音乐列表弹窗后是否继续播放 */
  keepPlaying: boolean;
  /** 键盘快捷键：空格播放暂停 / PgUp 上一首 / PgDn 下一首 */
  hotkeys: boolean;
  /** 系统媒体控制：锁屏与耳机按键 */
  mediaSession: boolean;
}

export const DEFAULT_MUSIC_PANEL_PREFS: MusicPanelPrefs = {
  topLyrics: true,
  showLyrics: true,
  showPlaylist: true,
  lyricSize: DEFAULT_LYRIC_SIZE,
  // 默认开启：把注意力收在当前句上，是「歌词」这一区块本该有的阅读层级
  lyricBlur: true,
  lyricAlign: LYRIC_ALIGN_SITE,
  // 默认关闭：多一张缩略图意味着多一轮第三方图片请求，按需开启
  trackCover: false,
  volume: 40,
  panelOpacity: 100,
  rememberPlayMode: true,
  // 默认开启：仅选中不播放，不会制造「页面一打开就有声音」的意外
  resumeLastTrack: true,
  keepPlaying: true,
  hotkeys: true,
  mediaSession: true,
};

/** 面板不透明度的可调下限：再低就看不清面板里的文字了 */
export const MIN_PANEL_OPACITY = 40;

/** MusicPanelPrefs 里所有布尔字段的键名（开关行与落盘表都以此为准） */
export type MusicPanelBoolPref = {
  [K in keyof MusicPanelPrefs]: MusicPanelPrefs[K] extends boolean ? K : never;
}[keyof MusicPanelPrefs];

/** 布尔偏好 → localStorage 键（收敛成一张表，避免组件与设置项两处写错） */
export const MUSIC_PANEL_BOOL_KEYS: Record<MusicPanelBoolPref, string> = {
  topLyrics: TOP_LYRICS_KEY,
  showLyrics: SHOW_LYRICS_KEY,
  showPlaylist: SHOW_PLAYLIST_KEY,
  lyricBlur: LYRIC_BLUR_KEY,
  trackCover: TRACK_COVER_KEY,
  rememberPlayMode: REMEMBER_PLAY_MODE_KEY,
  resumeLastTrack: RESUME_LAST_TRACK_KEY,
  keepPlaying: KEEP_PLAYING_KEY,
  hotkeys: HOTKEYS_KEY,
  mediaSession: MEDIA_SESSION_KEY,
};

/** 非布尔偏好的落盘键（面板风格另有自己的键，见 MUSIC_PANEL_STYLE_KEY） */
export const MUSIC_PANEL_VALUE_KEYS = {
  lyricSize: TOP_LYRICS_SIZE_KEY,
  volume: DEFAULT_VOLUME_KEY,
  panelOpacity: PANEL_OPACITY_KEY,
  lyricAlign: LYRIC_ALIGN_KEY,
} as const;

/**
 * 「恢复默认」需要清理的全部本机键（含播放行为类与面板风格）。
 * 集中在这里而不是散在组件里：漏清一个键就会出现「重置后某项仍是旧值」。
 */
export const ALL_MUSIC_LOCAL_KEYS: string[] = [
  MUSIC_PANEL_STYLE_KEY,
  ...Object.values(MUSIC_PANEL_BOOL_KEYS),
  ...Object.values(MUSIC_PANEL_VALUE_KEYS),
  AUDIO_VOLUME_KEY,
  AUDIO_MUTED_KEY,
  AUDIO_PROGRESS_KEY,
  AUDIO_LAST_TRACK_KEY,
  AUDIO_PLAY_MODE_KEY,
];

/** 「恢复默认」时通知常驻播放层复位内存态（音量/静音/进度表不在 React 树里） */
export const MUSIC_PREFS_RESET_EVENT = "music-prefs-reset";

/** 收敛 0-100 的百分比档位（音量 / 不透明度），非法值回落 fallback */
export function parsePercentPref(value: unknown, fallback: number): number {
  // 「没设置过」必须先判掉：Number(null) / Number("") / Number("  ") 都是 0，
  // 直接转数字会把「未设置」误判成「用户设成了 0%」——
  // 与当年「首次访问音量被读成 0、喇叭显示静音且点不动」是同一类 bug。
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return rounded >= 0 && rounded <= 100 ? rounded : fallback;
}

/** 把任意数值夹到 0-100 的整数区间（供设置面板的滑杆直接调用） */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MUSIC_PANEL_PREFS.volume;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** 收敛面板不透明度：低于下限会让文字不可读，因此下限比音量更高 */
export function clampPanelOpacity(value: number): number {
  const n = clampPercent(value);
  return Math.min(100, Math.max(MIN_PANEL_OPACITY, n));
}

/** 收敛任意来源的档位值（字符串 / 数字 / null / 历史脏值），非法一律回落默认档 */
export function parseLyricSize(value: unknown): LyricSizeLevel {
  const level = typeof value === "number" ? value : Number(value);
  return LYRIC_SIZE_VALUES.includes(level) ? (level as LyricSizeLevel) : DEFAULT_LYRIC_SIZE;
}

/** 收敛歌词对齐取值：非法值一律视为「跟随风格」 */
export function parseLyricAlign(value: unknown): LyricAlignPref {
  return typeof value === "string" && LYRIC_ALIGN_VALUES.includes(value)
    ? (value as LyricAlignPref)
    : LYRIC_ALIGN_SITE;
}

/** 档位对应的中文名（设置面板里回显当前档位） */
export function lyricSizeLabel(level: LyricSizeLevel): string {
  return LYRIC_SIZE_OPTIONS.find((o) => o.value === level)?.label ?? "";
}

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

/** 逐键读出的裸值（localStorage 只存字符串，null 表示未设置过） */
export type MusicPanelPrefsRaw = Partial<Record<keyof MusicPanelPrefs, string | null>>;

/** 把 localStorage 里逐键读取的裸值收敛成完整偏好对象（缺键一律取默认值） */
export function parseMusicPanelPrefs(raw: MusicPanelPrefsRaw): MusicPanelPrefs {
  const d = DEFAULT_MUSIC_PANEL_PREFS;
  return {
    topLyrics: parseBoolPref(raw.topLyrics, d.topLyrics),
    showLyrics: parseBoolPref(raw.showLyrics, d.showLyrics),
    showPlaylist: parseBoolPref(raw.showPlaylist, d.showPlaylist),
    lyricSize: parseLyricSize(raw.lyricSize),
    lyricBlur: parseBoolPref(raw.lyricBlur, d.lyricBlur),
    lyricAlign: parseLyricAlign(raw.lyricAlign),
    trackCover: parseBoolPref(raw.trackCover, d.trackCover),
    volume: parsePercentPref(raw.volume, d.volume),
    panelOpacity: clampPanelOpacity(parsePercentPref(raw.panelOpacity, d.panelOpacity)),
    rememberPlayMode: parseBoolPref(raw.rememberPlayMode, d.rememberPlayMode),
    resumeLastTrack: parseBoolPref(raw.resumeLastTrack, d.resumeLastTrack),
    keepPlaying: parseBoolPref(raw.keepPlaying, d.keepPlaying),
    hotkeys: parseBoolPref(raw.hotkeys, d.hotkeys),
    mediaSession: parseBoolPref(raw.mediaSession, d.mediaSession),
  };
}

/**
 * 从 localStorage 读取全部音乐本机偏好。
 *
 * 键名表就在本模块，调用方不必逐个列出 —— 将来新增一项偏好，只需补
 * MUSIC_PANEL_BOOL_KEYS / MUSIC_PANEL_VALUE_KEYS 与 parseMusicPanelPrefs，
 * 读取端不用改，也就不会漏读（漏读的症状是「设置完刷新就还原」，很难查）。
 */
export function readMusicPanelPrefs(storage: Storage): MusicPanelPrefs {
  const raw: MusicPanelPrefsRaw = {};
  for (const field of Object.keys(MUSIC_PANEL_BOOL_KEYS) as MusicPanelBoolPref[]) {
    raw[field] = storage.getItem(MUSIC_PANEL_BOOL_KEYS[field]);
  }
  raw.lyricSize = storage.getItem(MUSIC_PANEL_VALUE_KEYS.lyricSize);
  raw.volume = storage.getItem(MUSIC_PANEL_VALUE_KEYS.volume);
  raw.panelOpacity = storage.getItem(MUSIC_PANEL_VALUE_KEYS.panelOpacity);
  raw.lyricAlign = storage.getItem(MUSIC_PANEL_VALUE_KEYS.lyricAlign);
  return parseMusicPanelPrefs(raw);
}
