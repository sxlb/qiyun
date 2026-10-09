import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIO_LAST_TRACK_KEY,
  AUDIO_MUTED_KEY,
  AUDIO_PLAY_MODE_KEY,
  AUDIO_PROGRESS_KEY,
  AUDIO_VOLUME_KEY,
  DEFAULT_MUSIC_PANEL_PREFS,
  MUSIC_PREFS_RESET_EVENT,
  type MusicPanelPrefs,
} from "@/lib/musicPanelThemes";

/* ==================== 播放模式与下一首计算 ==================== */

/** 播放模式：order 顺序（播完停止）/ loop 列表循环 / single 单曲循环 / shuffle 随机 */
export type PlayMode = "order" | "loop" | "single" | "shuffle";

/**
 * 根据播放模式计算下一首曲目的下标（纯函数，便于单元测试）
 * @param mode 播放模式
 * @param playlistLength 歌单长度（≤0 视为无歌单）
 * @param currentIndex 当前曲目下标（-1 表示未播放或找不到）
 * @returns 下一首下标；-1 表示播放结束（仅顺序模式最后一首）
 */
export function getNextTrackIndex(
  mode: PlayMode,
  playlistLength: number,
  currentIndex: number
): number {
  if (playlistLength <= 0) return -1;
  // 未播放或下标越界：从第一首开始
  if (currentIndex < 0 || currentIndex >= playlistLength) return 0;

  switch (mode) {
    case "single":
      // 单曲循环：停留在当前曲目
      return currentIndex;
    case "shuffle": {
      // 随机选一首，歌单多于一首时避免与当前重复
      if (playlistLength === 1) return currentIndex;
      let next = currentIndex;
      while (next === currentIndex) {
        next = Math.floor(Math.random() * playlistLength);
      }
      return next;
    }
    case "loop":
      // 列表循环：顺序播放，最后一首回到第一首
      return (currentIndex + 1) % playlistLength;
    case "order":
    default:
      // 顺序播放：最后一首播放结束
      return currentIndex + 1 >= playlistLength ? -1 : currentIndex + 1;
  }
}

/* ==================== 音频播放器核心逻辑 ==================== */

export interface Track {
  id: string;
  name: string;
  artist: string;
  url: string;
  cover?: string;
  /** 歌词：纯文本（含 mm:ss 时间标签）或歌词文件 URL */
  lrc?: string;
}

// 第三方歌单原始字段（name/title、artist/author、url、cover/pic、lrc）
interface RawTrack {
  id?: number | string;
  name?: string;
  title?: string;
  artist?: string;
  author?: string;
  url?: string;
  cover?: string;
  pic?: string;
  lrc?: string;
}

// 音量 / 静音 / 进度 / 续播的本地持久化键。
// 统一在 lib/musicPanelThemes 里声明：音乐面板的「恢复默认」要按同一张表清理这些键，
// 字符串散在两处必然会出现「重置后还有一项没清掉」。
const VOLUME_KEY = AUDIO_VOLUME_KEY;
const MUTED_KEY = AUDIO_MUTED_KEY;
const PROGRESS_KEY = AUDIO_PROGRESS_KEY;
const LAST_TRACK_KEY = AUDIO_LAST_TRACK_KEY;
const PLAY_MODE_KEY = AUDIO_PLAY_MODE_KEY;

/** 播放进度落盘的最小间隔（ms）：续播只需大致对齐，不必每次 timeupdate 都写 */
export const PROGRESS_PERSIST_INTERVAL_MS = 5000;

/**
 * 是否应把播放进度写入 localStorage。
 *
 * timeupdate 约 4Hz，原实现每次都 `JSON.stringify` 整张进度表并**同步**写 localStorage，
 * 播放期间等于每秒阻塞主线程约 4 次。改为按间隔节流，并在暂停 / 关页面时
 * （见监听器 effect 内的 pause 与 pagehide）补一次落盘，避免节流窗口内的进度丢失。
 */
export function shouldPersistProgress(lastPersistedAt: number, now: number): boolean {
  return now - lastPersistedAt >= PROGRESS_PERSIST_INTERVAL_MS;
}

/** 取消静音时若音量为 0，恢复到的默认音量（同时是首次访问的初始音量，取较小的舒适值） */
export const DEFAULT_VOLUME = 0.4;

/**
 * 拖动音量条后的下一个状态。
 * 音量为 0 时图标同样显示为"静音"，若此时只改音量而不解除 muted，
 * 用户拖满音量条依旧无声 —— 表现为「静音关不掉」，因此音量 > 0 即视为取消静音。
 */
export function resolveVolumeChange(
  volume: number,
  muted: boolean
): { volume: number; muted: boolean } {
  return { volume, muted: volume > 0 ? false : muted };
}

/**
 * 点击喇叭后的下一个状态。
 * 音量为 0 时图标本来就显示为静音态，此时点击的意图必然是"恢复声音"而不是再静音一次，
 * 因此按"当前是否静音（含音量为 0）"取反；恢复时若音量为 0 一并恢复到上次的非零音量。
 */
export function resolveMuteToggle(input: {
  muted: boolean;
  volume: number;
  lastAudible: number;
}): { volume: number; muted: boolean } {
  const effectivelyMuted = input.muted || input.volume <= 0;
  const muted = !effectivelyMuted;
  if (!muted && input.volume <= 0) {
    return { muted, volume: input.lastAudible > 0 ? input.lastAudible : DEFAULT_VOLUME };
  }
  return { muted, volume: input.volume };
}

/** 播放模式循环顺序 */
export const PLAY_MODES: PlayMode[] = ["loop", "single", "shuffle", "order"];

/** 归一化第三方歌单字段为播放器 Track */
export function normalizeTracks(raw: RawTrack[], offset: number): Track[] {
  return raw.map((v, i) => ({
    id: String(v.id ?? offset + i),
    name: v.name || v.title || "未知歌曲",
    artist: v.artist || v.author || "未知歌手",
    url: v.url || "",
    cover: v.cover || v.pic || "",
    lrc: v.lrc || "",
  }));
}

/* ==================== 歌词（顶部常驻显示与弹窗面板共用） ==================== */

export interface LyricLine {
  time: number;
  text: string;
}

/**
 * 解析 LRC 歌词文本 → 带时间戳的行数组（按时间升序）。
 *
 * 冒号用 \x3A 转义：避免被 Tailwind 内容扫描误当作任意属性类（[prop:value]）生成非法 CSS。
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:[\x3A.](\d{1,3}))?\]/g;
  for (const line of lrc.split(/\r?\n/)) {
    const tags = line.match(timeRegex);
    if (!tags) continue;
    const text = line.replace(timeRegex, "").trim();
    for (const tag of tags) {
      const parts = tag.slice(1, -1).split(":");
      const minutes = parseInt(parts[0], 10);
      const seconds = parseFloat(parts[1]);
      if (!Number.isNaN(minutes) && !Number.isNaN(seconds)) {
        lines.push({ time: minutes * 60 + seconds, text: text || "♪" });
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * 计算「让某一行在滚动容器里垂直居中」所需的 scrollTop。
 *
 * 参数取的是行与容器的视口坐标（getBoundingClientRect）而非 offsetTop：
 * 容器本身不是定位元素时，offsetTop 是相对更外层定位祖先的距离，
 * 越往下偏得越多，scrollTo 会被算到容器底部之外 —— 表现就是歌词被一路拉到底、不跟歌走。
 */
export function centeredScrollTop(
  containerTop: number,
  containerHeight: number,
  containerScrollTop: number,
  rowTop: number,
  rowHeight: number
): number {
  const offsetInContent = rowTop - containerTop + containerScrollTop;
  return Math.max(0, offsetInContent - containerHeight / 2 + rowHeight / 2);
}

/**
 * 按播放时间定位当前句下标：取「最后一个 time ≤ t」的行，未到首句时返回 -1。
 * 二分查找，供顶部胶囊与弹窗面板共用同一套判定。
 */
export function findLyricIndex(lines: LyricLine[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let idx = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= time) {
      idx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return idx;
}

/**
 * 把「歌词字段」解析成 LRC 文本。
 *
 * 歌单接口给出的 lrc 可能是**纯文本**（含 mm:ss 标签）也可能是**歌词文件 URL**：
 * - URL 时先取回；NeteaseCloudMusicApi 的 /lyric 返回 `{lrc:{lyric}}` JSON，纯 LRC 接口返回文本；
 * - 取回失败或响应异常时返回空串（顶部与面板都不渲染歌词，而不是把错误抛到渲染层）。
 */
export async function resolveLyricText(raw: string, signal?: AbortSignal): Promise<string> {
  const value = (raw || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const res = await fetch(value, { signal });
    if (!res.ok) return "";
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { lrc?: { lyric?: string } };
      return typeof json?.lrc?.lyric === "string" ? json.lrc.lyric : text;
    } catch {
      return text;
    }
  } catch {
    return "";
  }
}

/** 格式化播放时长：秒 → m:ss */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export interface UseAudioPlayerProps {
  /** 歌单 API 地址（三种方案任选其一）：
   *  1. NeteaseMiniPlayer v3 / NeteaseCloudMusicApi 基地址（自动走 track/all + song/url/v1）
   *  2. meting 类歌单接口（如 api.injahow.cn/meting，返回数组）
   *  3. home 项目 api（同 meting 格式的歌单接口）
   */
  songApi?: string;
  /** 歌单平台（netease / tencent，随歌单接口参数传递） */
  songServer?: string;
  /** 歌单 ID */
  songId?: string;
  /** 后台开关：歌单加载完成后尝试自动播放（浏览器拦截时静默放弃） */
  autoplay?: boolean;
  /**
   * 本机偏好（音乐面板「设置」里读写）。只影响播放行为的三项：
   * 初始音量、是否记住播放模式、是否续播上次曲目。未传时用默认偏好。
   */
  prefs?: MusicPanelPrefs;
  /**
   * 偏好是否已就绪。
   *
   * Provider 首帧读不到 localStorage（要保证 SSR 与服务端渲染一致），偏好得等一个
   * effect 才可用。若不等这个信号就拿默认偏好去初始化音量 / 播放模式，用户存好的
   * 设置会被默认值抢先覆盖 —— 表现为「明明设了初始音量，每次打开还是 40%」。
   * 直接使用本 hook 的场景（如单测）不传即视为已就绪。
   */
  prefsReady?: boolean;
}

/**
 * 音频播放器核心逻辑（状态机）
 * - 播放列表加载：歌单数据源三种方案（NeteaseMiniPlayer v3 / meting / home 项目 api），
 *   songApi 填对应地址，经 /api/music 拉取后归一化为播放列表
 * - 播放模式：顺序 / 列表循环 / 单曲循环 / 随机
 * - 错误处理：音频加载失败自动切歌，连续失败超过阈值后停止并提示
 * - 音量 / 静音本地持久化
 * - 事件契约：广播 music-progress / music-track-change / music-player-close，
 *   监听 toggle-music-player
 */
export function useAudioPlayer({
  songApi = "",
  songServer = "netease",
  songId = "",
  autoplay = false,
  prefs = DEFAULT_MUSIC_PANEL_PREFS,
  prefsReady = true,
}: UseAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [playMode, setPlayMode] = useState<PlayMode>("loop");
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 音频元素挂载状态（由 UI 中的 <audio> ref 回调同步）
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // ===== 歌词 =====
  // 放在这里（而不是音乐弹窗内部）的原因：顶部要常驻显示当前句，且弹窗是按需挂载的，
  // 歌词数据必须留在常驻层，否则一关弹窗顶部就没词了。
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);

  useEffect(() => {
    const raw = currentTrack?.lrc || "";
    if (!raw) {
      setLyricLines([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    void resolveLyricText(raw, controller.signal).then((text) => {
      if (!cancelled) setLyricLines(text ? parseLrc(text) : []);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentTrack?.lrc]);

  // 当前句：直接由已有的 currentTime 派生，无需再挂一个 timeupdate 监听
  const lyricIndex = useMemo(
    () => findLyricIndex(lyricLines, currentTime),
    [lyricLines, currentTime]
  );

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  audioElRef.current = audioEl;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
      if (saved && typeof saved === "object") progressRef.current = saved;
    } catch {
      progressRef.current = {};
    }
  }, []);

  // 连续加载失败计数（自动切歌防死循环）
  const errorCountRef = useRef(0);
  const preloadedUrlsRef = useRef(new Set<string>());
  const progressRef = useRef<Record<string, number>>({});
  /** 上次把进度写入 localStorage 的时刻（用于节流判定） */
  const lastPersistRef = useRef(0);

  // 保持最新 state 的 ref：音频事件只绑定一次，回调内读取最新值
  const stateRef = useRef({ playlist, currentTrack, playMode });
  stateRef.current = { playlist, currentTrack, playMode };

  // ===== 播放列表加载 =====
  const loadPlaylistRef = useRef<AbortController | null>(null);
  /** 上一次发起的参数；相同且请求还在途时直接复用，不重发 */
  const loadQueryRef = useRef<string>("");

  const loadPlaylist = useCallback(async () => {
    // 歌单数据源支持三种地址：NeteaseMiniPlayer v3 / NeteaseCloudMusicApi 基地址、meting 类接口、home 项目 api
    // 未配置 songApi/songId 时返回空列表（无内置示例兜底）
    if (!songApi.trim() || !songId.trim()) {
      setPlaylist([]);
      return;
    }
    const query = `${songApi.trim()}|${songServer}|${songId}`;
    // 同一份参数已有在途请求：直接复用。开发模式的 StrictMode 会「挂载→清理→再挂载」，
    // 若这里照旧重发并 abort 上一次，浏览器必然报 net::ERR_ABORTED（控制台噪音），
    // 而参数没变、数据完全一样，重取没有意义。
    if (query === loadQueryRef.current && loadPlaylistRef.current) return;
    loadQueryRef.current = query;
    // 参数真的变了才取消上一次，避免旧响应覆盖新配置
    loadPlaylistRef.current?.abort();
    const controller = new AbortController();
    loadPlaylistRef.current = controller;
    try {
      const res = await fetch(
        `/api/music?api=${encodeURIComponent(songApi.trim())}&server=${songServer}&type=playlist&id=${encodeURIComponent(songId)}`,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) }
      );
      if (res.ok) {
        const data: unknown = await res.json();
        // /api/music 返回归一化后的 Track[]；meting/home 源返回原始数组，再做一次字段归一化
        if (Array.isArray(data)) {
          setPlaylist(normalizeTracks(data as RawTrack[], 0));
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // 请求被取消，正常忽略
      if (process.env.NODE_ENV === "development") console.error("[MusicPlayer] 加载播放列表失败:", e);
    } finally {
      // 只有自己仍是在途请求时才清空，避免把后来者顶掉
      if (loadPlaylistRef.current === controller) loadPlaylistRef.current = null;
    }
  }, [songApi, songServer, songId]);

  useEffect(() => {
    loadPlaylist();
    // 清理时**不** abort：请求自带 8s 超时兜底，卸载后自然结束即可；
    // 在这里取消只会让开发模式下多出一条 net::ERR_ABORTED。
  }, [loadPlaylist]);

  // ===== 自动播放（访客偏好「设置 → 播放 → 自动播放」，默认关闭）=====
  // 歌单加载完成后触发一次；浏览器拦截自动播放（未交互页面）时 play() 会 reject，
  // 由下方播放 effect 统一复位 isPlaying，UI 回到未播放态，不产生"假播放"。
  //
  // 必须等 prefsReady：偏好是挂载后才从 localStorage 读出来的，不等就会出现
  // 「访客明明关着自动播放，却因为读盘前跑了一轮默认值而响了一声」。
  const autoplayTriedRef = useRef(false);
  useEffect(() => {
    if (!prefsReady || !autoplay || autoplayTriedRef.current) return;
    if (playlist.length === 0 || currentTrack) return;
    autoplayTriedRef.current = true;
    setCurrentTrack(playlist[0]);
    setIsPlaying(true);
  }, [prefsReady, autoplay, playlist, currentTrack, setIsPlaying]);

  // ===== 音量 / 静音持久化 =====
  // 上次的非零音量：音量为 0 时点「取消静音」用它恢复，避免恢复成 0 依旧无声
  const lastAudibleVolumeRef = useRef(DEFAULT_VOLUME);
  /** 初始音量是否已应用：偏好可能晚一帧就绪（见 prefsReady），必须只应用一次，不能被后到的默认值覆盖 */
  const volumeInitRef = useRef(false);
  useEffect(() => {
    if (!prefsReady || volumeInitRef.current) return;
    volumeInitRef.current = true;
    try {
      // 必须先判断 key 是否存在：localStorage 为空时 Number(null) === 0，
      // 会把首次访问的音量直接设成 0 —— 页面无声、喇叭显示静音态，且点它也不会变。
      const rawVolume = localStorage.getItem(VOLUME_KEY);
      // 没有记住过音量时用本机偏好里的「初始音量」；有记录则以用户实际拖动过的值为准
      const fallback = prefs.volume / 100;
      const v = rawVolume !== null ? Number(rawVolume) : fallback;
      if (Number.isFinite(v) && v >= 0 && v <= 1) {
        setVolume(v);
        if (v > 0) lastAudibleVolumeRef.current = v;
      }
      setMuted(localStorage.getItem(MUTED_KEY) === "1");
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [prefsReady, prefs.volume]);

  /** 写入本地存储（隐私模式等场景静默忽略） */
  const persist = useCallback((key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 忽略 */
    }
  }, []);

  /** 读取本地存储（隐私模式等场景返回 null） */
  const readLocal = useCallback((key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }, []);

  // ===== 播放模式：按本机偏好决定是否跨会话记住 =====
  const playModeInitRef = useRef(false);
  useEffect(() => {
    if (!prefsReady || playModeInitRef.current) return;
    playModeInitRef.current = true;
    if (!prefs.rememberPlayMode) return;
    const saved = readLocal(PLAY_MODE_KEY);
    if (saved && (PLAY_MODES as string[]).includes(saved)) setPlayMode(saved as PlayMode);
  }, [prefsReady, prefs.rememberPlayMode, readLocal]);

  useEffect(() => {
    if (!prefsReady || !prefs.rememberPlayMode) return;
    persist(PLAY_MODE_KEY, playMode);
  }, [playMode, prefsReady, prefs.rememberPlayMode, persist]);

  // ===== 续播上次曲目（只选中，不自动播放）=====
  const resumeTriedRef = useRef(false);
  // 记住当前曲目 id（随机播放时的次序无法复现，只记「在听哪一首」）
  useEffect(() => {
    if (!prefsReady || !prefs.resumeLastTrack || !currentTrack) return;
    persist(LAST_TRACK_KEY, currentTrack.id);
  }, [currentTrack, prefsReady, prefs.resumeLastTrack, persist]);

  useEffect(() => {
    if (!prefsReady || !prefs.resumeLastTrack || resumeTriedRef.current) return;
    // 等歌单到手再找：id 要能在歌单里对上才有意义（歌单换过就忽略）
    if (currentTrack || playlist.length === 0) return;
    resumeTriedRef.current = true;
    const savedId = readLocal(LAST_TRACK_KEY);
    if (!savedId) return;
    const track = playlist.find((t) => t.id === savedId);
    if (track) setCurrentTrack(track);
  }, [playlist, currentTrack, prefsReady, prefs.resumeLastTrack, readLocal]);

  // ===== 「恢复默认」：清掉落盘值后，把留在内存里的播放状态一起复位 =====
  // 音量 / 静音 / 播放模式 / 进度表都不在 React 树的上层，光删 localStorage 本轮不生效。
  useEffect(() => {
    const onReset = () => {
      const v = DEFAULT_MUSIC_PANEL_PREFS.volume / 100;
      setVolume(v);
      setMuted(false);
      setPlayMode("loop");
      lastAudibleVolumeRef.current = v > 0 ? v : DEFAULT_VOLUME;
      progressRef.current = {};
    };
    window.addEventListener(MUSIC_PREFS_RESET_EVENT, onReset);
    return () => window.removeEventListener(MUSIC_PREFS_RESET_EVENT, onReset);
  }, []);

  const changeVolume = useCallback(
    (v: number) => {
      if (v > 0) lastAudibleVolumeRef.current = v;
      const next = resolveVolumeChange(v, muted);
      setVolume(next.volume);
      persist(VOLUME_KEY, String(next.volume));
      // 拖动音量条即解除静音：否则静音态下滑条永远跳回 0，用户无法靠它恢复声音
      if (next.muted !== muted) {
        setMuted(next.muted);
        persist(MUTED_KEY, next.muted ? "1" : "0");
      }
    },
    [muted, persist]
  );

  const toggleMuted = useCallback(() => {
    const next = resolveMuteToggle({
      muted,
      volume,
      lastAudible: lastAudibleVolumeRef.current,
    });
    setMuted(next.muted);
    persist(MUTED_KEY, next.muted ? "1" : "0");
    if (next.volume !== volume) {
      setVolume(next.volume);
      persist(VOLUME_KEY, String(next.volume));
    }
  }, [muted, volume, persist]);

  // ===== 音频事件处理（事件只绑定一次，逻辑通过 stateRef 读取最新值） =====
  const handlersRef = useRef({
    onEnded: () => {},
    onError: () => {},
  });

  handlersRef.current.onEnded = () => {
    const { playlist: list, currentTrack: track, playMode: mode } = stateRef.current;
    const idx = list.findIndex((t) => t.id === track?.id);
    const next = getNextTrackIndex(mode, list.length, idx);
    errorCountRef.current = 0;
    if (next === -1) {
      // 顺序模式播完最后一首：停止
      setIsPlaying(false);
      return;
    }
    if (next === idx) {
      // 单曲循环：从头重播
      const audio = audioElRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }
    setCurrentTrack(list[next]);
  };

  handlersRef.current.onError = () => {
    const { playlist: list, currentTrack: track } = stateRef.current;
    errorCountRef.current += 1;
    // 同一首歌连续失败超过阈值（最多 3 次或歌单长度）则停止，避免死循环
    const maxTries = Math.max(1, Math.min(3, list.length));
    if (list.length === 0 || errorCountRef.current >= maxTries) {
      setIsPlaying(false);
      setLoading(false);
      setError("音频加载失败，已停止播放");
      errorCountRef.current = 0;
      return;
    }
    setError("音频加载失败，自动切换下一首");
    const idx = list.findIndex((t) => t.id === track?.id);
    const next = getNextTrackIndex("order", list.length, idx);
    if (next === -1) {
      setIsPlaying(false);
      setLoading(false);
    } else {
      setCurrentTrack(list[next]);
    }
  };

  useEffect(() => {
    const audio = audioEl;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      const saved = currentTrack ? progressRef.current[currentTrack.id] : 0;
      if (saved && saved < audio.duration - 3) {
        audio.currentTime = saved;
        setCurrentTime(saved);
      }
      setLoading(false);
    };
    /** 把进度表落盘（失败静默：隐私模式 / 配额满）；抽出来供节流之外的时机补写 */
    const persistProgress = () => {
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressRef.current));
      } catch {
        // localStorage may be unavailable in private browsing.
      }
    };
    const onTimeUpdate = () => {
      const time = audio.currentTime;
      setCurrentTime(time);
      if (currentTrack) {
        progressRef.current[currentTrack.id] = time;
        // 节流落盘：timeupdate 约 4Hz，每次都同步写 localStorage 会持续占用主线程
        const now = Date.now();
        if (shouldPersistProgress(lastPersistRef.current, now)) {
          lastPersistRef.current = now;
          persistProgress();
        }
      }
    };
    const onEnded = () => handlersRef.current.onEnded();
    const onWaiting = () => setLoading(true);
    const onPlaying = () => {
      setLoading(false);
      errorCountRef.current = 0;
    };
    const onError = () => handlersRef.current.onError();

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);
    // 关键时机补写：暂停或关页面时，把节流窗口内最后一次进度落盘，避免丢失
    audio.addEventListener("pause", persistProgress);
    window.addEventListener("pagehide", persistProgress);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("pause", persistProgress);
      window.removeEventListener("pagehide", persistProgress);
    };
  }, [audioEl, currentTrack]);

  useEffect(() => {
    const track = currentTrack;
    if (!track || !audioEl || duration <= 0 || currentTime < duration * 0.8) return;
    const index = playlist.findIndex((t) => t.id === track.id);
    const next = playlist[getNextTrackIndex(playMode, playlist.length, index)];
    if (!next?.url || preloadedUrlsRef.current.has(next.url)) return;
    preloadedUrlsRef.current.add(next.url);
    void fetch(next.url, { cache: "force-cache" }).catch(() => preloadedUrlsRef.current.delete(next.url));
  }, [audioEl, currentTime, currentTrack, duration, playMode, playlist]);

  // ===== 播放 / 暂停 / 切歌 =====
  useEffect(() => {
    const audio = audioEl;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      audio.play().catch(() => {
        // 自动播放可能被浏览器阻止（如切歌/后台开关自动播放时）：
        // 复位为未播放态，避免按钮显示"暂停"却无声的假播放状态
        if (process.env.NODE_ENV === "development") console.warn("[MusicPlayer] 自动播放被阻止");
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [audioEl, isPlaying, currentTrack]);

  // 切换曲目：src 变化后浏览器自动开始加载，无需显式 load()
  // （显式 load() 会中断播放 effect 中已发起的 play()，导致切歌/首次播放无声）
  // 这里仅复位时长/错误状态
  useEffect(() => {
    if (!audioEl || !currentTrack) return;
    setDuration(0);
    setCurrentTime(progressRef.current[currentTrack.id] || 0);
    setLoading(true);
    setError("");
    errorCountRef.current = 0;
  }, [audioEl, currentTrack]);

  useEffect(() => {
    const audio = audioEl;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [audioEl, volume, muted]);

  // ===== 播放列表 / 曲目操作 =====
  const playNext = useCallback(() => {
    const { playlist: list, currentTrack: track } = stateRef.current;
    if (!list.length) return;
    const idx = list.findIndex((t) => t.id === track?.id);
    const next = idx === -1 ? 0 : (idx + 1) % list.length;
    errorCountRef.current = 0;
    setCurrentTrack(list[next]);
  }, []);

  const playPrev = useCallback(() => {
    const { playlist: list, currentTrack: track } = stateRef.current;
    if (!list.length) return;
    const idx = list.findIndex((t) => t.id === track?.id);
    const prev = idx === -1 ? 0 : (idx - 1 + list.length) % list.length;
    errorCountRef.current = 0;
    setCurrentTrack(list[prev]);
  }, []);

  const togglePlay = useCallback(() => {
    const { playlist: list, currentTrack: track } = stateRef.current;
    if (!track && list.length > 0) {
      // 首次播放：设置当前歌曲，由播放 effect 触发
      setCurrentTrack(list[0]);
      setIsPlaying(true);
      return;
    }
    const audio = audioElRef.current;
    if (audio) {
      if (isPlaying) audio.pause();
      else audio.play().catch(() => {});
    }
  }, [isPlaying]);

  const selectTrack = useCallback((track: Track) => {
    errorCountRef.current = 0;
    setCurrentTrack(track);
    setIsPlaying(true);
  }, []);

  // ===== 播放模式 =====
  const cyclePlayMode = useCallback(() => {
    setPlayMode((prev) => {
      const idx = PLAY_MODES.indexOf(prev);
      return PLAY_MODES[(idx + 1) % PLAY_MODES.length];
    });
  }, []);

  // ===== 事件契约 =====
  // 面板/弹窗开关已上移到组件层（MusicProvider），这里仅保留广播：播放进度（顶部进度条联动）、
  // 曲目变化（动态标题联动）、播放停止时的 music-player-close（动态标题复位）

  // 广播播放进度（节流 500ms，供顶部进度条联动；收起播放器后仍持续广播）
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const audio = audioElRef.current;
      if (!audio) return;
      window.dispatchEvent(
        new CustomEvent("music-progress", {
          detail: { currentTime: audio.currentTime, duration, playing: true },
        })
      );
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, duration]);

  // 广播曲目变化（供动态标题联动）
  useEffect(() => {
    if (!currentTrack) return;
    window.dispatchEvent(
      new CustomEvent("music-track-change", {
        detail: { name: currentTrack.name, artist: currentTrack.artist },
      })
    );
  }, [currentTrack]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 3500);
    return () => window.clearTimeout(timer);
  }, [error]);

  return {
    isPlaying,
    setIsPlaying,
    togglePlay,
    currentTrack,
    playlist,
    playMode,
    cyclePlayMode,
    volume,
    changeVolume,
    muted,
    toggleMuted,
    duration,
    currentTime,
    loading,
    error,
    playNext,
    playPrev,
    selectTrack,
    lyricLines,
    lyricIndex,
    audioEl,
    setAudioEl,
  };
}
