"use client";

import { memo, useCallback, createContext, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ChevronLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Music2,
  X,
  Repeat,
  Repeat1,
  Shuffle,
  ListMusic,
  Volume2,
  VolumeX,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import {
  useAudioPlayer,
  formatTime,
  centeredScrollTop,
  type Track,
  type LyricLine,
  type UseAudioPlayerProps,
  type PlayMode,
} from "@/hooks/useAudioPlayer";
import {
  resolveMusicPanelStyle,
  isMusicPanelStyle,
  musicPanelTraits,
  readMusicPanelPrefs,
  formatBoolPref,
  lyricSizeLabel,
  clampPercent,
  clampPanelOpacity,
  MUSIC_PANEL_STYLE_KEY,
  MUSIC_PANEL_STYLE_OPTIONS,
  MUSIC_PANEL_BOOL_KEYS,
  MUSIC_PANEL_VALUE_KEYS,
  ALL_MUSIC_LOCAL_KEYS,
  MUSIC_PREFS_RESET_EVENT,
  LYRIC_SIZE_OPTIONS,
  LYRIC_ALIGN_OPTIONS,
  FOLLOW_SITE,
  MIN_PANEL_OPACITY,
  DEFAULT_MUSIC_PANEL_PREFS,
  DEFAULT_HANDLE_PLACEMENT,
  readHandlePlacement,
  writeHandlePlacement,
  parseMusicSidebarDefault,
  type HandlePlacement,
  type MusicSidebarDefault,
  type LyricAlignPref,
  type LyricSizeLevel,
  type MusicPanelBoolPref,
  type MusicPanelPrefs,
  type MusicPanelStyle,
} from "@/lib/musicPanelThemes";
import Hitokoto from "@/components/home/Hitokoto";

// 播放模式元信息（图标 + 提示文案）
const PLAY_MODE_META: Record<PlayMode, { label: string; Icon: LucideIcon }> = {
  loop: { label: "列表循环", Icon: Repeat },
  single: { label: "单曲循环", Icon: Repeat1 },
  shuffle: { label: "随机播放", Icon: Shuffle },
  order: { label: "顺序播放", Icon: ListMusic },
};

/* ==================== 播放器上下文 ==================== */

interface MusicContextValue {
  // 播放核心（来自 useAudioPlayer）
  isPlaying: boolean;
  togglePlay: () => void;
  /** 直接暂停（关闭弹窗时按偏好停止播放用；togglePlay 依赖 state 闭包，不适合这种场合） */
  pause: () => void;
  currentTrack: Track | null;
  playlist: Track[];
  playMode: PlayMode;
  cyclePlayMode: () => void;
  volume: number;
  changeVolume: (v: number) => void;
  muted: boolean;
  toggleMuted: () => void;
  duration: number;
  currentTime: number;
  loading: boolean;
  error: string;
  /**
   * 自动播放被浏览器策略拦截、正等待首次用户交互续播。
   *
   * 用于给访客一个可照做的提示（音乐把手上的呼吸圈），否则"开关开着却没声音"
   * 会被当成功能坏了。移动端浏览器在用户交互前一律拒绝出声，这是策略而非故障。
   */
  autoplayBlocked: boolean;
  playNext: () => void;
  playPrev: () => void;
  selectTrack: (t: Track) => void;
  audioEl: HTMLAudioElement | null;
  /** 当前歌曲的歌词行（已解析并按时间升序）；顶部常驻歌词与弹窗面板共用 */
  lyricLines: LyricLine[];
  /** 当前句下标（未到首句为 -1） */
  lyricIndex: number;
  // UI 状态（对齐 home：musicOpenState 控制面板 / musicBoxOpenState 列表弹窗）
  panelOpen: boolean;
  setPanelOpen: (b: boolean) => void;
  /**
   * 抽屉是否铺满屏遮罩。
   *
   * 只有访客自己点开时才是模态（点空白处关闭）；站点配置成「默认展开」时它是常驻面板 ——
   * 铺遮罩会让访客必须先点掉遮罩才能用网站，一个默认展开的播放器不该有这种代价。
   */
  panelModal: boolean;
  setPanelModal: (b: boolean) => void;
  /** 站点配置的音乐侧栏默认状态：demo 展开示范一次 / expand 默认展开 / collapse 默认收起 */
  sidebarDefault: MusicSidebarDefault;
  boxOpen: boolean;
  setBoxOpen: (b: boolean) => void;
  /** 当前生效的音乐面板风格（站点默认 + 本机覆盖解析后的结果） */
  panelStyle: MusicPanelStyle;
  /** 本机切换面板风格（写入 localStorage；传 FOLLOW_SITE 表示跟随站点） */
  setPanelStyle: (value: string) => void;
  /** 本机是否显式选了风格（false = 跟随站点；用于设置浮层里「跟随站点」的选中态） */
  panelStyleFollowsSite: boolean;
  /** 面板设置浮层是否展开（卡片面板的齿轮会把它连同弹窗一起打开） */
  settingsOpen: boolean;
  setSettingsOpen: (b: boolean) => void;
  /** 本机偏好：歌词/曲目显示、播放行为、面板观感等（全部只存本机） */
  prefs: MusicPanelPrefs;
  /** 偏好是否已从 localStorage 载入完成（未就绪前播放层不做初始化，见 useAudioPlayer 的 prefsReady） */
  prefsReady: boolean;
  /**
   * 切换某项布尔偏好（同时写入 localStorage；写不进去不影响本次会话）。
   * 键名取 MusicPanelPrefs 里的布尔字段，落盘键由 MUSIC_PANEL_BOOL_KEYS 统一映射。
   */
  setPref: (key: MusicPanelBoolPref, value: boolean) => void;
  /** 顶部悬浮歌词的字号档位（1-7） */
  lyricSize: LyricSizeLevel;
  /** 切换字号档位（同时写入 localStorage） */
  setLyricSize: (level: LyricSizeLevel) => void;
  /** 设置初始音量（0-100） */
  setVolumePref: (value: number) => void;
  /** 设置面板不透明度（40-100） */
  setPanelOpacity: (value: number) => void;
  /** 设置歌词对齐（site=跟随面板风格） */
  setLyricAlign: (value: LyricAlignPref) => void;
  /** 一键恢复本机偏好的全部默认值（含面板风格与播放行为） */
  resetPrefs: () => void;
}

const MusicContext = createContext<MusicContextValue | null>(null);

export function useMusic(): MusicContextValue {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error("useMusic 必须在 MusicProvider 内使用");
  return ctx;
}

/* ===== 曲目行 =====
 * 三套风格共用同一份结构（序号 / 封面 / 曲名 / 艺人），观感全部交给 .mp-row 令牌。
 * memo 后仅当歌单、当前曲目或「显示封面」偏好变化时重渲染。
 */
const TrackRow = memo(function TrackRow({
  track,
  index,
  active,
  showCover,
  onSelect,
}: {
  track: Track;
  index: number;
  active: boolean;
  showCover: boolean;
  onSelect: (t: Track) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(track)}
      className={`mp-row${active ? " is-active" : ""}`}
      aria-current={active ? "true" : undefined}
    >
      <span className="mp-row-num">{String(index + 1).padStart(2, "0")}</span>
      {showCover &&
        (track.cover ? (
          // unoptimized：封面来自任意第三方图床，next/image 优化器需要远程域名白名单；与站内其他远程图一致地短路 loader
          <Image
            src={track.cover}
            alt=""
            width={26}
            height={26}
            unoptimized
            className="mp-row-cover"
          />
        ) : (
          // 占位块：没有封面也要占住同一宽度，否则有无封面的行左右错位
          <span className="mp-row-cover is-empty" aria-hidden="true" />
        ))}
      <span className="mp-row-name">{track.name}</span>
      <span className="mp-row-meta">{track.artist || "—"}</span>
    </button>
  );
});

/* ===== 黑胶唱片（仅甲 · 黑胶暖色） =====
 * 纹路层静止、只有光泽层旋转 —— 纯径向的纹理转起来是看不出来的。
 * 暂停时用 .is-paused 冻住动画（而不是卸载节点），恢复播放能接着转。
 */
function Disc({ title, spinning }: { title: string; spinning: boolean }) {
  return (
    <div className="mp-disc" aria-hidden="true">
      <span className="mp-disc-grooves" />
      <span className={`mp-disc-sheen${spinning ? "" : " is-paused"}`} />
      <span className="mp-disc-label">{title}</span>
      <span className="mp-disc-hole" />
    </div>
  );
}

/* ===== 歌词区块 =====
 * 歌词的拉取 / 解析 / 当前句判定在 useAudioPlayer：顶部要常驻显示当前句，
 * 而本区块所在的弹窗是按需挂载的（关掉就没了），数据必须留在常驻层，
 * 两个显示面（顶部胶囊 / 面板内）共享同一份歌词与同一个「当前句」。
 * 这里只负责渲染与自动滚动。
 */
function LyricBlock({ cursor }: { cursor: string }) {
  const { lyricLines: lines, lyricIndex: current } = useMusic();
  const listRef = useRef<HTMLDivElement>(null);

  // 当前行自动居中滚动：只滚歌词容器本身，避免 scrollIntoView 带动整页
  // 位置用视口坐标算，不能用 offsetTop（否则会把歌词一路滚到底）；依赖须带 lines，换歌时即使当前句下标相同也要重新定位
  useEffect(() => {
    const container = listRef.current;
    const active = container?.querySelector<HTMLElement>("[data-active='true']");
    if (!container || !active) return;
    const box = container.getBoundingClientRect();
    const row = active.getBoundingClientRect();
    container.scrollTo({
      top: centeredScrollTop(box.top, container.clientHeight, container.scrollTop, row.top, row.height),
      behavior: "smooth",
    });
  }, [current, lines]);

  if (lines.length === 0) return null;

  return (
    <div ref={listRef} className="mp-scroll mp-lyric max-h-24 overflow-y-auto">
      {lines.map((line, i) => (
        <div
          key={i}
          data-active={i === current}
          className={`mp-lyric-line${i === current ? " is-cur" : ""}`}
        >
          {i === current && cursor ? cursor : ""}
          {line.text}
        </div>
      ))}
    </div>
  );
}

/* ===== 传输控制（上一首 / 播放暂停 / 下一首 + 进度条 + 时间） ===== */
function TransportBar() {
  const m = useMusic();
  const noPlaylist = !m.playlist.length;
  return (
    <>
      <div className="mp-transport">
        <button
          type="button"
          className="mp-step"
          onClick={m.playPrev}
          disabled={noPlaylist}
          title="上一首"
          aria-label="上一首"
        >
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="mp-play"
          onClick={m.togglePlay}
          disabled={noPlaylist}
          title={m.isPlaying ? "暂停" : "播放"}
          aria-label={m.isPlaying ? "暂停" : "播放"}
        >
          {m.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="mp-step"
          onClick={m.playNext}
          disabled={noPlaylist}
          title="下一首"
          aria-label="下一首"
        >
          <SkipForward className="h-4 w-4" />
        </button>
        <span className="mp-gap" />
        <ProgressBar audioEl={m.audioEl} duration={m.duration} />
      </div>
      <div className="mp-times">
        <span>{formatTime(m.currentTime)}</span>
        {m.loading && <span>加载中…</span>}
        <span>{formatTime(m.duration)}</span>
      </div>
    </>
  );
}

/* ===== 设置视图（分组：外观 / 歌词 / 播放） =====
 * 后台配置的是「站点默认风格」，这里切换的是「本机覆盖」；选「跟随站点」即清掉本机选择。
 * 其余设置项都只影响本机（localStorage），不改站点数据。
 *
 * 为什么要分组：设置项从 3 组长到 11 项后，一列铺开接近 20 行 —— 面板必须整体滚动，
 * 会把播放器和歌单一起挤下去（打开设置就「拥挤」的直接原因），也很容易找不到想改的那一项。
 * 现在改成「独立视图 + 三组」：进入设置时只渲染设置（不再叠在播放器上），
 * 切组时高度不变（见 globals.css 的 .mp-tabpanel 固定高度）。
 *
 * 分组依据是「改的是什么」，不是控件类型：
 *   外观 = 面板本身的观感；歌词 = 所有歌词相关；播放 = 播放行为与系统集成。
 * 组内顺序统一为「先选择/拖动的项，后开关」——开关成组读起来才像一份清单。
 */
const SETTINGS_TABS = [
  { key: "look", label: "外观" },
  { key: "lyric", label: "歌词" },
  { key: "play", label: "播放" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** 各组底部的开关行（键名 → 标签，顺序即展示顺序） */
const SETTINGS_SWITCHES: Record<SettingsTab, { key: MusicPanelBoolPref; label: string }[]> = {
  look: [
    { key: "showPlaylist", label: "面板内显示曲目" },
    { key: "trackCover", label: "歌单显示封面" },
  ],
  lyric: [
    { key: "topLyrics", label: "顶部常驻歌词" },
    { key: "showLyrics", label: "面板内显示歌词" },
    { key: "lyricBlur", label: "歌词聚焦（非当前行模糊）" },
  ],
  play: [
    // 自动播放放第一位：它是最容易惹人烦的一项（页面一打开就出声），
    // 放最前便于找到并关掉；默认关闭，需访客显式打开。
    { key: "autoplay", label: "自动播放" },
    { key: "rememberPlayMode", label: "记住播放模式" },
    { key: "resumeLastTrack", label: "续播上次曲目" },
    { key: "keepPlaying", label: "关闭弹窗后继续播放" },
    { key: "hotkeys", label: "键盘快捷键（空格 / PgUp / PgDn）" },
    { key: "mediaSession", label: "系统媒体控制（锁屏 / 耳机）" },
  ],
};

function PanelSettings() {
  const m = useMusic();
  const [tab, setTab] = useState<SettingsTab>("look");
  const activeHint = MUSIC_PANEL_STYLE_OPTIONS.find((o) => o.value === m.panelStyle)?.hint ?? "";
  const alignLabel =
    LYRIC_ALIGN_OPTIONS.find((o) => o.value === m.prefs.lyricAlign)?.label ?? "";
  const activeTabLabel = SETTINGS_TABS.find((t) => t.key === tab)?.label ?? "";

  /** 一组的开关行：三处渲染逻辑完全相同，抽出来避免各写一遍 */
  const switches = (group: SettingsTab) =>
    SETTINGS_SWITCHES[group].map((row) => (
      <div className="mp-settings-row" key={row.key}>
        <span>{row.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={m.prefs[row.key]}
          aria-label={row.label}
          className={`mp-switch${m.prefs[row.key] ? " is-on" : ""}`}
          onClick={() => m.setPref(row.key, !m.prefs[row.key])}
        />
      </div>
    ));

  return (
    <div className="mp-settings">
      <div className="mp-tabs" role="tablist" aria-label="设置分组">
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`mp-tab${tab === item.key ? " is-on" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 组内容：高度固定（.mp-tabpanel），切组时面板不会跳高度 */}
      <div className="mp-tabpanel mp-scroll" role="tabpanel" aria-label={activeTabLabel}>
        {/* ── 外观：面板本身的观感 ── */}
        {tab === "look" && (
          <>
            <div className="mp-settings-row">
              <span>面板风格</span>
            </div>
            <div className="mp-styles" role="radiogroup" aria-label="面板风格">
              <button
                type="button"
                role="radio"
                aria-checked={m.panelStyleFollowsSite}
                className={`mp-chip${m.panelStyleFollowsSite ? " is-on" : ""}`}
                onClick={() => m.setPanelStyle(FOLLOW_SITE)}
              >
                跟随站点
              </button>
              {MUSIC_PANEL_STYLE_OPTIONS.map((option) => {
                const on = !m.panelStyleFollowsSite && m.panelStyle === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`mp-chip${on ? " is-on" : ""}`}
                    onClick={() => m.setPanelStyle(option.value)}
                    title={option.hint}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="mp-hint">{activeHint}</div>

            {/* 面板不透明度：只降面板底色 alpha（color-mix），文字不会跟着变淡 */}
            <div className="mp-settings-row">
              <span>面板不透明度</span>
              <span className="mp-hint">{m.prefs.panelOpacity}%</span>
            </div>
            <input
              type="range"
              min={MIN_PANEL_OPACITY}
              max={100}
              step={1}
              value={m.prefs.panelOpacity}
              onChange={(event) => m.setPanelOpacity(Number(event.currentTarget.value))}
              className="mp-pref-range"
              aria-label="面板不透明度"
            />

            {switches("look")}
          </>
        )}

        {/* ── 歌词：所有歌词相关（显示开关 + 排版） ── */}
        {tab === "lyric" && (
          <>
            {/* 顶部悬浮歌词字号：7 档，每档在移动端与桌面端各取一套像素（见 globals.css 的 .top-lyric） */}
            <div className="mp-settings-row">
              <span>悬浮歌词字号</span>
              <span className="mp-hint">{lyricSizeLabel(m.prefs.lyricSize)}</span>
            </div>
            <div className="mp-styles" role="radiogroup" aria-label="悬浮歌词字号">
              {LYRIC_SIZE_OPTIONS.map((option) => {
                const on = m.prefs.lyricSize === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`mp-chip${on ? " is-on" : ""}`}
                    onClick={() => m.setLyricSize(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {/* 歌词对齐：默认跟着面板风格（三套风格各有自己的对齐），这里可以强行覆盖 */}
            <div className="mp-settings-row">
              <span>歌词对齐</span>
              <span className="mp-hint">{alignLabel}</span>
            </div>
            <div className="mp-styles" role="radiogroup" aria-label="歌词对齐">
              {LYRIC_ALIGN_OPTIONS.map((option) => {
                const on = m.prefs.lyricAlign === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`mp-chip${on ? " is-on" : ""}`}
                    onClick={() => m.setLyricAlign(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {switches("lyric")}
          </>
        )}

        {/* ── 播放：播放行为与系统集成 ── */}
        {tab === "play" && (
          <>
            {/* 初始音量：只在还没记住过音量时生效（拖过播放器音量条后以实测值为准） */}
            <div className="mp-settings-row">
              <span>初始音量</span>
              <span className="mp-hint">{m.prefs.volume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={m.prefs.volume}
              onChange={(event) => m.setVolumePref(Number(event.currentTarget.value))}
              className="mp-pref-range"
              aria-label="初始音量"
            />

            {switches("play")}
          </>
        )}
      </div>

      <button type="button" className="mp-reset" onClick={m.resetPrefs}>
        恢复默认设置
      </button>
    </div>
  );
}

/* ==================== 音乐列表弹窗 ==================== */
/**
 * 居中弹窗，三套风格共用同一套骨架。功能按用途拆进独立分区，不再糊成一整块：
 *   头部（SIDE A / NOW PLAYING + 曲序计数 + 设置 + 关闭）
 *   分区一 · 当前播放：唱片 + 曲目信息 + 传输控制 + 进度 + 音量/播放模式
 *   分区二 · 歌词（无歌词数据时整块不出现）
 *   分区三 · 歌单（面板里唯一的滚动区）
 * 点齿轮进入「设置视图」：它与上面三个分区互斥，占满面板主体（只渲染设置），
 * 头部换成「设置 + 返回」，内部再按 外观 / 歌词 / 播放 分三组。
 * 分区的边框与浅底色见 globals.css 的 .mp-section；
 * 「有没有唱片 / 进度条形态 / 歌词对齐」由 traits 决定，其余观感交给 .mp 令牌。
 */
function MusicModal() {
  const m = useMusic();
  const traits = musicPanelTraits(m.panelStyle);
  const close = () => {
    m.setSettingsOpen(false);
    m.setBoxOpen(false);
    // 按本机偏好决定关掉弹窗是否停播：默认继续播放（与旧行为一致）
    if (!m.prefs.keepPlaying) {
      m.pause();
      window.dispatchEvent(new Event("music-player-close"));
      return;
    }
    // 未播放时广播关闭事件，让动态标题复位
    if (!m.isPlaying) window.dispatchEvent(new Event("music-player-close"));
  };
  const index = m.playlist.findIndex((t) => t.id === m.currentTrack?.id);
  const noData = !m.currentTrack && m.playlist.length === 0;
  const ModeIcon = PLAY_MODE_META[m.playMode].Icon;
  // 面板观感变量：不透明度（color-mix 只降底色 alpha）与歌词对齐覆盖
  // （「跟随风格」时不注入，把对齐交给 .mp[data-style] 自己的 --mp-lyric-align）
  const dialogStyle: CSSProperties & Record<string, string> = {
    "--mp-panel-alpha": `${m.prefs.panelOpacity}%`,
    ...(m.prefs.lyricAlign === "site" ? {} : { "--mp-lyric-align": m.prefs.lyricAlign }),
  };

  return (
    <div
      className="mp mp-scrim"
      data-style={m.panelStyle}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="音乐列表"
    >
      <div
        className="mp mp-dialog"
        data-style={m.panelStyle}
        data-lyric-blur={m.prefs.lyricBlur ? "on" : "off"}
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mp-head">
          {/* 进入设置后头部换成「设置」，不再沿用 SIDE A / NOW PLAYING 这类与当前内容不符的标题 */}
          <span className="mp-side">{m.settingsOpen ? traits.settingsLabel : traits.side}</span>
          <span className="mp-spacer" />
          {!m.settingsOpen && traits.showCount && m.playlist.length > 0 && (
            <span className="mp-count">
              {String(Math.max(index, 0) + 1).padStart(2, "0")} / {String(m.playlist.length).padStart(2, "0")}
            </span>
          )}
          {m.settingsOpen ? (
            // 设置是面板内的独立视图：返回用左箭头（与齿轮同一位置），收起即回到播放器
            <button
              type="button"
              className="mp-icon-btn"
              onClick={() => m.setSettingsOpen(false)}
              title="返回播放器"
              aria-label="返回播放器"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className="mp-icon-btn"
              onClick={() => m.setSettingsOpen(true)}
              title="面板设置"
              aria-label="面板设置"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          <button type="button" className="mp-icon-btn" onClick={close} title="关闭" aria-label="关闭音乐列表">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 设置与播放器互斥：设置占满面板主体，不再叠在播放器上面把内容挤下去 */}
        {m.settingsOpen ? (
          <PanelSettings />
        ) : (
          <>
            {m.error && <div className="mp-note mp-error">{m.error}</div>}
            {noData && (
              <div className="mp-note mp-empty">尚未配置音乐歌单，请在后台音乐设置中填写接口地址和歌单 ID。</div>
            )}

        {/* 分区一：当前播放（唱片 + 曲目信息 + 传输控制 + 进度 + 音量/播放模式） */}
        <section className="mp-section mp-section-stage">
          <div className="mp-now">
            {traits.disc && <Disc title={m.currentTrack?.name ?? "—"} spinning={m.isPlaying} />}
            <div className="mp-now-text">
              <div className="mp-title">{m.currentTrack?.name || "选择一首歌曲"}</div>
              <div className="mp-artist">{m.currentTrack?.artist || "—"}</div>
            </div>
          </div>

          <TransportBar />

          {/* 音量与播放模式：设计稿之外的功能行，用低对比度收纳，不抢主视觉 */}
          <div className="mp-extras">
            <VolumeSlider variant="panel" volume={m.volume} muted={m.muted} onChange={m.changeVolume} onToggleMuted={m.toggleMuted} />
            <button
              type="button"
              className="mp-icon-btn"
              onClick={m.cyclePlayMode}
              title={`当前：${PLAY_MODE_META[m.playMode].label}（点击切换）`}
              aria-label={`播放模式：${PLAY_MODE_META[m.playMode].label}`}
            >
              <ModeIcon className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* 分区二：歌词（没有歌词数据时整块不出现，不留空壳） */}
        {m.prefs.showLyrics && m.lyricLines.length > 0 && (
          <section className="mp-section">
            <div className="mp-block-label">{traits.lyricLabel}</div>
            <LyricBlock cursor={traits.lyricCursor} />
          </section>
        )}

        {/* 分区三：歌单（面板里唯一的滚动区） */}
        {m.prefs.showPlaylist && m.playlist.length > 0 && (
          <section className="mp-section mp-section-list">
            <div className="mp-block-label">{traits.listLabel}</div>
            <div className="mp-list-wrap mp-scroll">
              <div className="mp-list">
                {m.playlist.map((track, i) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={i}
                    active={m.currentTrack?.id === track.id}
                    showCover={m.prefs.trackCover}
                    onSelect={m.selectTrack}
                  />
                ))}
              </div>
            </div>
          </section>
        )}
          </>
        )}
      </div>
    </div>
  );
}

/* ==================== 功能卡：一言（不再与音乐面板互换） ==================== */
/**
 * 挂载于右侧功能卡组左格：现在只渲染一言。
 *
 * 音乐控制已搬到右下角的音乐侧栏（`MusicSidebar`）—— 原来这一格会在
 * 「一言 ↔ 音乐控制面板」之间互换，为了切换时不推移下方卡片，音乐面板被迫压到
 * 84px 高，窄屏下信息挤成一团；同时右栏也再没有余量放常驻侧栏。
 * 改成一个不占布局的右下角浮层后，这两个约束同时消失。
 */
export function MusicCard({ hitokotoType = "" }: { hitokotoType?: string }) {
  return <Hitokoto type={hitokotoType} />;
}

/* ==================== 音乐侧栏（可拖动的竖直把手 + 展开抽屉） ==================== */
/**
 * 常驻屏幕一侧的音乐控制浮层：收起 = 44×98 竖直把手，展开 = 320px 抽屉。
 *
 * 为什么是浮层而不是常驻竖栏：内容容器 max-w-6xl(1152px) + md:px-6，
 * 视口 1280px 时左右各只剩 64px 余量，1024px 时只剩 24px —— 全高竖栏必然压住
 * 时钟卡 / 导航卡，而右栏正是页面主体。把手做成有边界的胶囊，不占布局、不遮挡。
 *
 * 停靠位置（默认左侧）+ 垂直位置都记在本机：按住把手可拖到任意位置，
 * 松手后水平方向自动贴合到最近的一侧（垂直位置保持），下次访问沿用。
 * 位置用 transform 表达（见 globals.css 的 .music-handle），贴合是一条合成层动画。
 *
 * 抽屉里只放「一眼要看的信息 + 最常用的三个操作」：封面 / 曲名 / 上下首 / 播放暂停 / 音量，
 * 歌单、歌词、面板设置这些重内容继续留在音乐列表弹窗里（`MusicModal`），点「音乐列表」进入。
 * 这样侧栏不必重复实现弹窗已有的能力，也就不存在两处逻辑漂移。
 */

/** 把手与视口**上下**边缘的内缩（与 CSS 的 --handle-inset 一致）；水平方向贴边，见下 */
const HANDLE_INSET = 16;
/**
 * 水平内缩为 0：把手贴在屏幕边缘上，就是「挂在屏幕边上的那片标签」。
 * 停靠时贴到 0、拖动夹取也贴到 0，否则拖到边上会留出一缝、看起来又浮起来了。
 */
const HANDLE_EDGE_X = 0;
/** 把手尺寸的兜底值（与 CSS 的 2.75rem × 6.125rem 一致）；挂载后会实测校正 */
const HANDLE_DEFAULT_SIZE = { w: 44, h: 98 };
/** 位移超过这个距离才算「拖动」，否则按点击处理（打开抽屉） */
const DRAG_THRESHOLD_PX = 4;
/** 展开示范的停留时长：过了这一刻就自动收起 */
export const AUTO_COLLAPSE_MS = 3000;
/**
 * 等待欢迎通知离场的轮询间隔。
 *
 * 通知什么时候被关是它自己的事，侧栏不该为此替它定义事件、也不该和它共享状态 ——
 * 直接用「屏幕上还有没有那块遮罩」来判断最省事、也最不容易被通知的改动带偏。
 * 只有通知确实在屏上时才会轮询，且一关掉立刻停止，代价可以忽略。
 * （导出仅为本文件的测试用，不是对外 API）
 */
export const NOTICE_POLL_MS = 400;
/**
 * 欢迎通知遮罩的类名（`AnnouncementNotification` 的根节点）。
 * 改这里的名字必须同步改通知组件 —— tests/lib/music-sidebar-style.test.ts 有跨文件断言兜着。
 */
const NOTICE_SCRIM_SELECTOR = ".notice-scrim";
/** 「展开示范已做过」的标记：只记本会话，同一个标签页刷新不再打扰（新标签页算新会话） */
const SIDEBAR_INTRO_KEY = "music-sidebar-intro-shown";
/**
 * 加载动画收起后、再去判断「有没有通知」之前先等的那一下。
 *
 * 通知是在同一个事件（loading-screen-removed）里被唤出的，React 的提交与这里的检查
 * 同处一个任务；不等一拍就查 DOM，会查到「通知还没插进来」，于是把有通知误判成没通知。
 */
export const NOTICE_REVEAL_SETTLE_MS = 250;
/**
 * 等加载动画收起的兜底时长：与欢迎通知自己的兜底同刻（它也是超过这个时间就直接弹出）。
 * 正常情况下 loading-screen-removed 会先到，这一条只是防止事件丢失后侧栏永远不动作。
 */
const NOTICE_REVEAL_FALLBACK_MS = 3000;

/** 本次访问是否还需要做一次展开示范（只读，不写） */
function readIntroPending(): boolean {
  try {
    return window.sessionStorage.getItem(SIDEBAR_INTRO_KEY) !== "1";
  } catch {
    // 隐私模式读不到：照常示范一次，宁可多展示也不要功能看起来不存在
    return true;
  }
}

/** 记下「示范已做过」 */
function markIntroShown(): void {
  try {
    window.sessionStorage.setItem(SIDEBAR_INTRO_KEY, "1");
  } catch {
    // 写不进去只影响「刷新后是否再示范一次」
  }
}

export function MusicSidebar() {
  const m = useMusic();
  const { setPanelOpen, setPanelModal, sidebarDefault } = m;
  const track = m.currentTrack;
  const noData = !track && m.playlist.length === 0;

  const handleRef = useRef<HTMLButtonElement | null>(null);
  /** 停靠位置（左右 + 距底）：默认左侧，拖动后落盘 */
  const [placement, setPlacement] = useState<HandlePlacement>(DEFAULT_HANDLE_PLACEMENT);
  /** 把手实测尺寸（拖动夹取与停靠位置都要用） */
  const [size, setSize] = useState(HANDLE_DEFAULT_SIZE);
  /** 视口尺寸：停靠位置依赖它，窗口变化要重算 */
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  /** 拖动中的实时位置（视口坐标下的左上角）；null = 未拖动，用停靠位置 */
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * 拖动中的权威标记。
   *
   * 必须用 ref 而不是直接用 dragging 这个 state：pointerdown 与紧随其后的第一个
   * pointermove 可能落在同一批渲染里，此时 move 的回调闭包读到的 dragging 还是 false，
   * 于是「拖得越快越容易整段拖不动」。state 只用于渲染（跟手样式）。
   */
  const draggingRef = useRef(false);
  /** 拖动位移的权威值：pointerup 与最后一次 pointermove 可能同帧，读 state 会拿到旧值 */
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragOriginRef = useRef({ px: 0, py: 0, x: 0, y: 0 });
  /** 本次交互是否已超过拖动阈值：超了就不再当成点击 */
  const movedRef = useRef(false);
  /** 访客是否已经动过手：动过就不再自动收起（不打断他） */
  const interactedRef = useRef(false);

  // 读取本机记录的停靠位置。服务端渲染读不到 localStorage，挂载后再读，
  // 首帧用默认值（左侧贴底），因此不会出现 hydration 不一致。
  useEffect(() => {
    try {
      setPlacement(readHandlePlacement(window.localStorage));
    } catch {
      // 隐私模式等场景读不到：保持默认左侧
    }
  }, []);

  // 视口尺寸：停靠位置与拖动夹取都依赖它
  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // 实测把手尺寸：抽屉打开时把手不在 DOM 里量不到，所以每次收起后再量一次。
  // 实测的意义在于 rem 与实际字号不一致时（用户改过浏览器默认字号）位置仍准确。
  useEffect(() => {
    if (m.panelOpen) return;
    const el = handleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height });
  }, [m.panelOpen]);

  /**
   * 本次访问是否需要做一次「展开示范」。
   *
   * 只在这里读一次（延迟初始化）：读与写必须分开 —— 若在渲染/副作用里「读不到就立刻写标记」，
   * 开发模式下 StrictMode 会把 effect 跑两遍，第二遍就读到自己刚写下的标记，
   * 于是「展开后没有倒计时」，抽屉会一直挂着不收。
   */
  const introPendingRef = useRef<boolean | null>(null);
  if (introPendingRef.current === null) introPendingRef.current = readIntroPending();

  /**
   * 按站点配置决定侧栏进门时的状态（后台「音乐设置 → 侧栏默认状态」）：
   *
   * - `collapse`：什么都不做，只留贴边把手；
   * - `expand`：常驻展开，且**不铺遮罩** —— 它是面板不是弹窗，访客随时可以自己收起；
   * - `demo`：本会话首次访问展开示范一次，倒计时从「欢迎通知离场」之后才开始。
   *
   * 倒计时起点不是挂载那一刻：两者同时占屏会让页面被两层遮罩叠暗，
   * 而且抽屉会在弹窗还开着的时候自己收走，看起来像闪了一下。
   */
  useEffect(() => {
    if (sidebarDefault === "collapse") return;
    if (sidebarDefault === "expand") {
      setPanelModal(false);
      setPanelOpen(true);
      return;
    }
    if (!introPendingRef.current) return;
    markIntroShown();
    setPanelModal(true);
    setPanelOpen(true);

    let collapseTimer = 0;
    let settleTimer = 0;
    let pollTimer = 0;
    let revealFallbackTimer = 0;
    let judged = false;

    const armCollapse = () => {
      collapseTimer = window.setTimeout(() => {
        if (!interactedRef.current) setPanelOpen(false);
      }, AUTO_COLLAPSE_MS);
    };
    const noticeGone = () => !document.querySelector(NOTICE_SCRIM_SELECTOR);
    const onNoticeGone = () => {
      window.clearInterval(pollTimer);
      armCollapse();
    };
    /** 等一拍让通知的插入提交完，再判定屏上有没有通知 */
    const judge = () => {
      settleTimer = window.setTimeout(() => {
        if (noticeGone()) {
          armCollapse();
          return;
        }
        // 通知正挡着：等它被关掉，再从那一刻开始算 3 秒
        pollTimer = window.setInterval(() => {
          if (noticeGone()) onNoticeGone();
        }, NOTICE_POLL_MS);
      }, NOTICE_REVEAL_SETTLE_MS);
    };
    const onLoaderGone = () => {
      if (judged) return;
      judged = true;
      judge();
    };

    // 与欢迎通知的唤出时机对齐：它同样等「加载动画收起」，或超时后兜底弹出。
    // 不在这一步对齐，侧栏会在通知还没弹出来时就把「没有通知」当真，提前开始倒计时 ——
    // 表现就是「通知还开着，抽屉已经自己收走了」。
    if (!document.getElementById("loader-wrapper")) {
      onLoaderGone();
    } else {
      window.addEventListener("loading-screen-removed", onLoaderGone, { once: true });
      revealFallbackTimer = window.setTimeout(onLoaderGone, NOTICE_REVEAL_FALLBACK_MS);
    }

    return () => {
      window.clearTimeout(collapseTimer);
      window.clearTimeout(settleTimer);
      window.clearTimeout(revealFallbackTimer);
      window.clearInterval(pollTimer);
      window.removeEventListener("loading-screen-removed", onLoaderGone);
    };
  }, [setPanelOpen, setPanelModal, sidebarDefault]);

  /** 把位置夹在视口内（水平贴边、垂直留出 HANDLE_INSET 的浮起感） */
  function clampPos(x: number, y: number) {
    const vw = viewport?.w ?? window.innerWidth;
    const vh = viewport?.h ?? window.innerHeight;
    const maxX = Math.max(HANDLE_EDGE_X, vw - size.w - HANDLE_EDGE_X);
    const maxY = Math.max(HANDLE_INSET, vh - size.h - HANDLE_INSET);
    return {
      x: Math.min(Math.max(x, HANDLE_EDGE_X), maxX),
      y: Math.min(Math.max(y, HANDLE_INSET), maxY),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    // 只认主键（触屏的 pointerType 不是 mouse，直接放行）
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = handleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    sizeRefMeasure(rect.width, rect.height);
    movedRef.current = false;
    dragOriginRef.current = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
    dragPosRef.current = { x: rect.left, y: rect.top };
    // 捕获指针：拖出把手范围甚至拖出窗口也继续收到 move / up。
    // 包在 try 里：合成事件（测试 / 自动化）传进来的 pointerId 在浏览器里并不存在，
    // setPointerCapture 会抛 NotFoundError，不能因此把整个按下流程打断。
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      // 捕获失败只是「拖出元素后收不到 move」，不影响本次拖动
    }
    draggingRef.current = true;
    setDragging(true);
    setDragPos({ x: rect.left, y: rect.top });
  }

  function sizeRefMeasure(w: number, h: number) {
    if (w > 0 && h > 0 && (w !== size.w || h !== size.h)) setSize({ w, h });
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingRef.current) return;
    const origin = dragOriginRef.current;
    const dx = e.clientX - origin.px;
    const dy = e.clientY - origin.py;
    if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    movedRef.current = true;
    const next = clampPos(origin.x + dx, origin.y + dy);
    dragPosRef.current = next;
    setDragPos(next);
  }

  function endDrag(e: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // 先复位状态再做收尾动作：releasePointerCapture 在「指针已不在捕获中」时
    // 会抛 NotFoundError（浏览器实测），若把它排在前面，异常会中断整个收尾 ——
    // 表现是把手卡在拖动态再也收不回来。
    setDragging(false);
    try {
      handleRef.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      // 指针已被释放：无需处理
    }
    const pos = dragPosRef.current;
    dragPosRef.current = null;
    setDragPos(null);
    // 没真正拖动：交给 onClick 打开抽屉
    if (!movedRef.current || !pos) return;
    const vw = viewport?.w ?? window.innerWidth;
    const vh = viewport?.h ?? window.innerHeight;
    const next: HandlePlacement = {
      // 吸附到最近的一侧，垂直位置保持松手时的位置
      side: pos.x + size.w / 2 < vw / 2 ? "left" : "right",
      bottom: Math.max(HANDLE_INSET, Math.round(vh - pos.y - size.h)),
    };
    interactedRef.current = true;
    setPlacement(next);
    try {
      writeHandlePlacement(window.localStorage, next);
    } catch {
      // 写不进去也不影响本次会话内的位置
    }
  }

  function onHandleClick() {
    // 拖动结束后的那次 click 不该顺手打开抽屉（movedRef 在 pointerdown 时已复位）
    if (movedRef.current) return;
    interactedRef.current = true;
    // 访客自己点开的，就是模态：铺遮罩、点空白处收起
    setPanelModal(true);
    setPanelOpen(true);
  }

  if (!m.panelOpen) {
    // 停靠位置：左侧贴左、右侧贴右（水平都是 0）；垂直位置由 bottom 换算成左上角坐标
    const rest = {
      x:
        placement.side === "left"
          ? HANDLE_EDGE_X
          : Math.max(HANDLE_EDGE_X, (viewport?.w ?? 0) - size.w - HANDLE_EDGE_X),
      y: Math.max(HANDLE_INSET, (viewport?.h ?? 0) - placement.bottom - size.h),
    };
    const pos = dragPos ?? rest;
    return (
      <button
        ref={handleRef}
        type="button"
        className="music-handle music-dark-scope"
        data-side={placement.side}
        data-playing={m.isPlaying ? "true" : "false"}
        data-dragging={dragging ? "true" : "false"}
        // 自动播放被拦截时给把手挂一个呼吸圈（见 globals.css）：提示"点一下就能出声"
        data-autoplay-blocked={m.autoplayBlocked ? "true" : "false"}
        // 位置走 CSS 变量 → transform（见 globals.css）；视口未知时省略，
        // 让 CSS 的兜底值顶一帧，避免先闪在左上角
        style={
          viewport
            ? ({
                "--handle-x": `${pos.x}px`,
                "--handle-y": `${pos.y}px`,
              } as CSSProperties)
            : undefined
        }
        onClick={onHandleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title={
          m.autoplayBlocked
            ? "浏览器已阻止自动播放，点击页面任意处即可开始播放"
            : track
              ? `音乐控制 · ${track.name}（可拖动）`
              : "音乐控制（可拖动）"
        }
        aria-label={m.autoplayBlocked ? "展开音乐控制（点击页面任意处开始播放）" : "展开音乐控制"}
        aria-expanded={false}
      >
        {/* 方向提示：箭头指向抽屉展开的方向（左侧停靠时由 CSS 镜像 180°） */}
        <ChevronLeft className="music-handle-cue h-4 w-4" />
        {track?.cover ? (
          // unoptimized：封面来自任意第三方图床，next/image 优化器需要远程域名白名单，
          // unoptimized 直接短路默认 loader（与站内其他远程图一致）
          <Image
            src={track.cover}
            alt=""
            width={38}
            height={38}
            unoptimized
            className="music-handle-disc"
          />
        ) : (
          <span className="music-handle-icon">
            <Music2 className="h-4 w-4" />
          </span>
        )}
      </button>
    );
  }

  return (
    <>
        {/* 遮罩：点空白处收起（抽屉的通用预期）。层级 56 低于音乐列表弹窗(200)。
            站点配置成「默认展开」时它是常驻面板，不铺遮罩 ——
            否则访客必须先点掉遮罩才能操作网站，一个默认展开的播放器不该有这种代价 */}
        {m.panelModal && (
          <div className="music-drawer-scrim" onClick={() => m.setPanelOpen(false)} aria-hidden />
        )}
      <section className="music-drawer music-dark-scope" data-side={placement.side} aria-label="音乐控制">
        <div className="music-drawer-head">
          <span className="music-drawer-title">正在播放</span>
          <button
            type="button"
            className="music-icon-btn"
            onClick={() => m.setPanelOpen(false)}
            title="收起"
            aria-label="收起音乐控制"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {noData && (
          <p className="music-drawer-empty">
            尚未配置音乐歌单，请在后台音乐设置中填写接口地址和歌单 ID。
          </p>
        )}

        {/* 自动播放被浏览器拦截：抽屉常驻可见时这里是最容易被读到的提示位 */}
        {!noData && m.autoplayBlocked && (
          <p className="music-drawer-note" role="status">
            浏览器已阻止自动播放，点击页面任意处即可开始播放
          </p>
        )}

        {!noData && (
          <>
            <div className="music-drawer-track">
              {track?.cover ? (
                <Image
                  src={track.cover}
                  alt=""
                  width={44}
                  height={44}
                  unoptimized
                  className="music-drawer-cover"
                />
              ) : (
                <span className="music-drawer-cover-fallback">
                  <Music2 className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="music-drawer-name truncate">{track?.name || "选择一首歌曲"}</div>
                <div className="music-drawer-artist truncate">{track?.artist || "—"}</div>
              </div>
            </div>

            <div className="music-drawer-controls">
              <button
                type="button"
                className="music-step-btn"
                onClick={m.playPrev}
                disabled={!m.playlist.length}
                title="上一首"
                aria-label="上一首"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="music-play-btn"
                onClick={m.togglePlay}
                disabled={!m.playlist.length}
                title={m.isPlaying ? "暂停" : "播放"}
                aria-label={m.isPlaying ? "暂停" : "播放"}
              >
                {m.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <button
                type="button"
                className="music-step-btn"
                onClick={m.playNext}
                disabled={!m.playlist.length}
                title="下一首"
                aria-label="下一首"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

          </>
        )}

        {/* 音乐列表入口常驻：歌单为空 / 加载失败时也要能进弹窗看提示、进设置 */}
        <div className="music-drawer-foot">
          {!noData && (
            <VolumeSlider
              volume={m.volume}
              muted={m.muted}
              onChange={m.changeVolume}
              onToggleMuted={m.toggleMuted}
            />
          )}
          <button type="button" className="music-drawer-list-btn" onClick={() => m.setBoxOpen(true)}>
            音乐列表
          </button>
        </div>
      </section>
    </>
  );
}

/* ==================== Provider（页面根部挂载，包住全站内容） ==================== */
export default function MusicProvider({
  children,
  musicPanelStyle,
  musicSidebarDefault,
  ...props
}: UseAudioPlayerProps & {
  children: React.ReactNode;
  /** 站点默认的音乐面板风格（后台配置；访客可在面板里本机覆盖） */
  musicPanelStyle?: string;
  /** 站点配置的音乐侧栏默认状态（后台配置）：demo / expand / collapse */
  musicSidebarDefault?: string;
}) {
  // 站点配置先收敛一次：脏值不会把侧栏卡在一个说不通的状态上
  const sidebarDefault = parseMusicSidebarDefault(musicSidebarDefault);
  // 面板风格与偏好都留在本机：站点默认来自后台配置，访客可在面板里覆盖（localStorage）。
  // 首屏先按站点默认 + 默认偏好渲染，挂载后再读本机值
  // （服务端渲染读不到 localStorage，首屏直接读会导致 hydration 不一致而闪烁）。
  const [localStyle, setLocalStyle] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<MusicPanelPrefs>(DEFAULT_MUSIC_PANEL_PREFS);
  /**
   * 后台配置的自动播放（站点级）。它不再直接驱动播放，而是当访客从没动过
   * 「自动播放」开关时的**初值** —— 否则老部署里已开自动播放的站点会被本机默认值静默关掉。
   * 用 ref 存：读偏好只在挂载时跑一次，而 props 每次渲染都是新对象，
   * 直接引用会让 effect 的依赖检查报缺失依赖。
   */
  const siteAutoplayRef = useRef(props.autoplay ?? false);
  /**
   * 偏好是否已载入完成。
   *
   * 必须显式传给 useAudioPlayer：它要在挂载时用偏好里的初始音量 / 播放模式 / 续播曲目
   * 做一次初始化。若不等这个信号，初始化会先用默认偏好跑掉（首帧 prefs 还是默认值），
   * 用户存好的设置就被默认值顶掉了。
   */
  const [prefsReady, setPrefsReady] = useState(false);

  const {
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
    autoplayBlocked,
    playNext,
    playPrev,
    selectTrack,
    lyricLines,
    lyricIndex,
    audioEl,
    setAudioEl,
  } = useAudioPlayer({ ...props, autoplay: prefs.autoplay, prefs, prefsReady });

  const [panelOpen, setPanelOpen] = useState(false);
  /** 抽屉是否铺遮罩：访客自己点开时铺（模态），站点「默认展开」不铺（常驻面板） */
  const [panelModal, setPanelModal] = useState(true);
  const [boxOpen, setBoxOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    try {
      const ls = window.localStorage;
      setLocalStyle(ls.getItem(MUSIC_PANEL_STYLE_KEY));
      // 键名表在 lib/musicPanelThemes 里，新增偏好项不必改这里（改漏的症状是「设置完刷新就还原」）
      setPrefs(readMusicPanelPrefs(ls, { autoplay: siteAutoplayRef.current }));
    } catch {
      // 隐私模式等场景下 localStorage 不可用：保持站点默认与默认偏好
    } finally {
      // 读失败也要放行：否则播放层会因为等不到信号而永远不做音量/播放模式初始化
      setPrefsReady(true);
    }
  }, []);

  /** 写入本机存储（隐私模式等场景静默忽略） */
  const writeLocal = useCallback((key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 写不进去也不影响本次会话内的切换
    }
  }, []);

  const setPanelStyle = useCallback(
    (value: string) => {
      setLocalStyle(value);
      writeLocal(MUSIC_PANEL_STYLE_KEY, value);
    },
    [writeLocal]
  );

  const setPref = useCallback(
    (key: MusicPanelBoolPref, value: boolean) => {
      setPrefs((prev) => ({ ...prev, [key]: value }));
      writeLocal(MUSIC_PANEL_BOOL_KEYS[key], formatBoolPref(value));
    },
    [writeLocal]
  );

  // 字号档位是数值而非布尔，单独一个 setter（落盘为 "4" 这类字符串）
  const setLyricSize = useCallback(
    (level: LyricSizeLevel) => {
      setPrefs((prev) => ({ ...prev, lyricSize: level }));
      writeLocal(MUSIC_PANEL_VALUE_KEYS.lyricSize, String(level));
    },
    [writeLocal]
  );

  const setVolumePref = useCallback(
    (value: number) => {
      const level = clampPercent(value);
      setPrefs((prev) => ({ ...prev, volume: level }));
      writeLocal(MUSIC_PANEL_VALUE_KEYS.volume, String(level));
    },
    [writeLocal]
  );

  const setPanelOpacity = useCallback(
    (value: number) => {
      const level = clampPanelOpacity(value);
      setPrefs((prev) => ({ ...prev, panelOpacity: level }));
      writeLocal(MUSIC_PANEL_VALUE_KEYS.panelOpacity, String(level));
    },
    [writeLocal]
  );

  const setLyricAlign = useCallback(
    (value: LyricAlignPref) => {
      setPrefs((prev) => ({ ...prev, lyricAlign: value }));
      writeLocal(MUSIC_PANEL_VALUE_KEYS.lyricAlign, value);
    },
    [writeLocal]
  );

  /**
   * 一键恢复默认：清掉全部本机键并复位内存态。
   * 音量 / 静音 / 播放模式 / 进度表留在 useAudioPlayer 里，不在 React 树上，
   * 因此清完存储后还要广播一次事件让常驻播放层同步复位（否则本轮仍是旧值）。
   */
  const resetPrefs = useCallback(() => {
    setPrefs(DEFAULT_MUSIC_PANEL_PREFS);
    setLocalStyle(null);
    try {
      const ls = window.localStorage;
      for (const key of ALL_MUSIC_LOCAL_KEYS) ls.removeItem(key);
    } catch {
      // 隐私模式等场景忽略
    }
    window.dispatchEvent(new Event(MUSIC_PREFS_RESET_EVENT));
  }, []);

  /** 直接暂停：关闭弹窗按偏好停播时使用（togglePlay 依赖 state 闭包，这里要的是确定性的停） */
  const pause = useCallback(() => setIsPlaying(false), [setIsPlaying]);

  const panelStyle = resolveMusicPanelStyle({
    siteDefault: musicPanelStyle,
    localOverride: localStyle,
  });
  // 本机存的值非法（含 null 与已下线的旧值）即视为「跟随站点」，与 resolveMusicPanelStyle 的收敛口径一致
  const panelStyleFollowsSite = !isMusicPanelStyle(localStyle);

  // 音频元素 ref 回调（稳定引用，避免每次渲染重绑）
  const audioRefCallback = useCallback((el: HTMLAudioElement | null) => setAudioEl(el), [setAudioEl]);

  // 键盘快捷键（对齐 home：Space 播放暂停 / PageUp 上一曲 / PageDown 下一首）
  // 可在面板设置里关闭：空格是页面滚动与按钮激活的通用键，被全站劫持并不总是用户想要的
  useEffect(() => {
    if (!prefs.hotkeys) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 输入控件与按钮聚焦时放行原生行为：Space 激活按钮、PageUp/Down 操作下拉，
      // 否则 Tab 聚焦到「音乐列表」等按钮后按空格只会切歌，无法激活按钮
      if (target && (["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      switch (e.code) {
        case "Space":
          e.preventDefault(); // 阻止页面默认滚动
          if (playlist.length) togglePlay();
          break;
        case "PageUp":
          e.preventDefault();
          playPrev();
          break;
        case "PageDown":
          e.preventDefault();
          playNext();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playlist.length, togglePlay, playPrev, playNext, prefs.hotkeys]);

  // 外部「音乐」链接（SiteLinks）触发：打开列表弹窗（对齐 home Links.vue）
  useEffect(() => {
    const handleToggle = () => setBoxOpen(true);
    window.addEventListener("toggle-music-player", handleToggle);
    return () => window.removeEventListener("toggle-music-player", handleToggle);
  }, []);

  // Media Session：更新系统媒体元数据（锁屏/系统 UI 显示歌名与封面）
  // 三个 Media Session effect 都受「系统媒体控制」偏好约束：关掉后不再向系统暴露播放状态
  useEffect(() => {
    if (!prefs.mediaSession) return;
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.name,
      artist: currentTrack.artist,
      artwork: currentTrack.cover ? [{ src: currentTrack.cover, sizes: "512x512", type: "image/jpeg" }] : undefined,
    });
  }, [currentTrack, prefs.mediaSession]);

  // Media Session：系统媒体控制（耳机/锁屏按键）
  useEffect(() => {
    if (!prefs.mediaSession) return;
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", togglePlay);
    ms.setActionHandler("pause", togglePlay);
    ms.setActionHandler("nexttrack", playNext);
    ms.setActionHandler("previoustrack", playPrev);
    ms.setActionHandler("seekbackward", (details) => {
      if (audioEl) audioEl.currentTime = Math.max(0, audioEl.currentTime - (details.seekOffset || 10));
    });
    ms.setActionHandler("seekforward", (details) => {
      if (audioEl) audioEl.currentTime = Math.min(audioEl.duration || Infinity, audioEl.currentTime + (details.seekOffset || 10));
    });
    ms.setActionHandler("seekto", (details) => {
      if (audioEl && details.seekTime != null) audioEl.currentTime = details.seekTime;
    });
    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("seekbackward", null);
      ms.setActionHandler("seekforward", null);
      ms.setActionHandler("seekto", null);
    };
  }, [audioEl, togglePlay, playNext, playPrev, prefs.mediaSession]);

  useEffect(() => {
    if (!prefs.mediaSession) return;
    if (!("mediaSession" in navigator) || !audioEl || !Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audioEl.playbackRate || 1,
        position: Math.min(currentTime, duration),
      });
    } catch {
      // Browsers reject position state until metadata is available.
    }
  }, [audioEl, currentTime, duration, prefs.mediaSession]);

  // Media Session：把播放/暂停状态同步给系统 UI（锁屏、通知栏、耳机按键）。
  // 系统据此显示正确的按钮，也更容易把这个页面识别成「正在播放的媒体」，
  // 减少被后台省电策略直接暂停的概率。
  useEffect(() => {
    if (!prefs.mediaSession) return;
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      /* 个别浏览器不支持写入该属性，忽略即可 */
    }
  }, [isPlaying, prefs.mediaSession]);

  const value: MusicContextValue = {
    isPlaying,
    togglePlay,
    pause,
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
    autoplayBlocked,
    playNext,
    playPrev,
    selectTrack,
    lyricLines,
    lyricIndex,
    audioEl,
    panelOpen,
    setPanelOpen,
    panelModal,
    setPanelModal,
    sidebarDefault,
    boxOpen,
    setBoxOpen,
    settingsOpen,
    setSettingsOpen,
    panelStyle,
    setPanelStyle,
    panelStyleFollowsSite,
    prefs,
    prefsReady,
    setPref,
    lyricSize: prefs.lyricSize,
    setLyricSize,
    setVolumePref,
    setPanelOpacity,
    setLyricAlign,
    resetPrefs,
  };

  return (
    <MusicContext.Provider value={value}>
      {/* 音频元素常驻挂载：收起面板/弹窗时音乐不中断 */}
      <audio
        id="music-audio"
        ref={audioRefCallback}
        src={currentTrack?.url}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          // 页面不可见时收到的暂停，通常来自浏览器/系统的后台策略（移动端省电、
          // 锁屏、Edge 效率模式），而不是访客的意图。此时保留播放态，回到前台会自动拉起
          // —— 若在这里一律置为暂停，访客切出去再回来就再也不会响（表现为「音乐莫名停了」）。
          // 访客主动暂停、以及系统媒体控件的暂停都会先经过 togglePlay，状态仍能正确落到 false。
          if (document.hidden) return;
          setIsPlaying(false);
        }}
      />
      {boxOpen && <MusicModal />}
      {/* 音乐侧栏常驻右下角：放在 Provider 内直接读上下文，不需要页面再挂一个入口 */}
      <MusicSidebar />
      {children}
    </MusicContext.Provider>
  );
}

// ===== 懒加载包装（合并自 MusicProviderLazy.tsx） =====

import nextDynamic from "next/dynamic";
import type { ReactNode } from "react";

const MusicProviderLazyComp = nextDynamic(
  () => import("./MusicPlayer").then((m) => m.default),
  { loading: () => null }
);

const MusicCardLazyComp = nextDynamic(
  () => import("./MusicPlayer").then((m) => m.MusicCard),
  {
    ssr: false,
    // 骨架与真实卡片同高：父格有 min-h，宽屏下行高又由时钟卡撑住，
    // 用 h-full (+ min-h 兜底) 才不会在加载完成的一瞬间把整列卡片顶一下
    loading: () => (
      <div className="card-glass card-func h-full min-h-[90px] w-full animate-pulse" />
    ),
  }
);

interface MusicProviderWrapperProps {
  songApi: string;
  songServer: string;
  songId: string;
  musicAutoplay: boolean;
  /** 站点默认的音乐面板风格（透传给 Provider） */
  musicPanelStyle?: string;
  /** 站点配置的音乐侧栏默认状态（透传给 Provider）：demo / expand / collapse */
  musicSidebarDefault?: string;
  children: ReactNode;
}

export function MusicProviderLazy({
  songApi,
  songServer,
  songId,
  musicAutoplay,
  musicPanelStyle,
  musicSidebarDefault,
  children,
}: MusicProviderWrapperProps) {
  return (
    <MusicProviderLazyComp
      songApi={songApi}
      songServer={songServer}
      songId={songId}
      autoplay={musicAutoplay}
      musicPanelStyle={musicPanelStyle}
      musicSidebarDefault={musicSidebarDefault}
    >
      {children}
    </MusicProviderLazyComp>
  );
}

export { MusicCardLazyComp as MusicCardLazy };

// ===== 以下组件合并自 music/VolumeSlider.tsx + music/ProgressBar.tsx =====

/**
 * 音量滑杆：静音时归零，百分比 tooltip 挂在轨道下方。
 *
 * 两个变体共用同一份逻辑，只换样式类：
 * - `glass`（默认）：卡片面板用，沿用站内玻璃卡片的红色轨道
 * - `panel`：音乐列表弹窗用，跟随 .mp 面板风格令牌（琥珀 / 朱红 / 青）
 */
export function VolumeSlider({ volume, muted, onChange, onToggleMuted, variant = "glass" }: {
  volume: number;
  muted: boolean;
  onChange: (value: number) => void;
  onToggleMuted: () => void;
  variant?: "glass" | "panel";
}) {
  const value = muted ? 0 : volume;
  const percent = Math.round(value * 100);
  const inPanel = variant === "panel";
  const fill = inPanel ? "var(--mp-accent)" : "var(--nc-red)";
  const track = inPanel ? "var(--mp-track)" : "var(--nc-track)";
  return (
    <div className={inPanel ? "mp-vol" : "music-volume flex items-center gap-2"}>
      <button
        type="button"
        className={
          inPanel
            ? "mp-vol-btn"
            : "flex h-6 w-6 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        }
        onClick={onToggleMuted}
        aria-label={muted ? "取消静音" : "静音"}
      >
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <div className="relative flex items-center">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          className={inPanel ? "mp-vol-range" : "music-volume-range w-24"}
          style={{
            background: `linear-gradient(to right, ${fill} ${percent}%, ${track} ${percent}%)`,
          }}
          aria-label={`音量 ${percent}%`}
        />
        <span className={inPanel ? "mp-vol-tip" : "music-volume-tooltip"}>{percent}%</span>
      </div>
    </div>
  );
}

/**
 * 播放进度条：timeupdate 驱动 + 拖拽跳转。
 *
 * 形态（细线 / 段式 LED）由 `.mp[data-style]` 下的背景层决定，
 * 这里只把进度百分比交给 `--mp-fill`；仍然是一个 range，
 * 因此拖拽与键盘操作能力完整保留（旧实现里的 LED 版会丢掉这两点）。
 */
export function ProgressBar({ audioEl, duration }: {
  audioEl: HTMLAudioElement | null;
  duration: number;
}) {
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!audioEl) return;
    const update = () => { if (!dragging) setProgress(audioEl.currentTime); };
    const reset = () => setProgress(0);
    audioEl.addEventListener("timeupdate", update);
    audioEl.addEventListener("loadedmetadata", reset);
    return () => {
      audioEl.removeEventListener("timeupdate", update);
      audioEl.removeEventListener("loadedmetadata", reset);
    };
  }, [audioEl, dragging]);

  const value = duration > 0 ? Math.min(duration, Math.max(0, progress)) : 0;
  const percent = duration > 0 ? (value / duration) * 100 : 0;
  const fillStyle: CSSProperties & Record<string, string> = { "--mp-fill": `${percent}%` };
  return (
    <input
      type="range"
      min={0}
      max={duration || 0}
      step={0.1}
      value={value}
      disabled={!duration}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onChange={(event) => {
        const next = Number(event.currentTarget.value);
        setProgress(next);
        if (audioEl) audioEl.currentTime = next;
      }}
      style={fillStyle}
      className="mp-range cursor-pointer"
      aria-label="播放进度"
    />
  );
}
