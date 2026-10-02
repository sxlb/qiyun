"use client";

import { memo, useCallback, createContext, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import {
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
  parseMusicPanelPrefs,
  formatBoolPref,
  lyricSizeLabel,
  MUSIC_PANEL_STYLE_KEY,
  MUSIC_PANEL_STYLE_OPTIONS,
  LYRIC_SIZE_OPTIONS,
  FOLLOW_SITE,
  TOP_LYRICS_KEY,
  TOP_LYRICS_SIZE_KEY,
  SHOW_LYRICS_KEY,
  SHOW_PLAYLIST_KEY,
  DEFAULT_MUSIC_PANEL_PREFS,
  type LyricSizeLevel,
  type MusicPanelPrefs,
  type MusicPanelStyle,
} from "@/lib/musicPanelThemes";
import Hitokoto from "@/components/Hitokoto";

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
  /** 本机偏好：顶部常驻歌词、面板内歌词与曲目开关 */
  prefs: MusicPanelPrefs;
  /** 切换某项布尔偏好（同时写入 localStorage；写不进去不影响本次会话） */
  setPref: (key: PanelPrefKey, value: boolean) => void;
  /** 顶部悬浮歌词的字号档位（1-7） */
  lyricSize: LyricSizeLevel;
  /** 切换字号档位（同时写入 localStorage） */
  setLyricSize: (level: LyricSizeLevel) => void;
}

/** 面板内的本机偏好键（与 localStorage 键一一对应，收敛成一张表避免写错） */
export type PanelPrefKey = "topLyrics" | "showLyrics" | "showPlaylist";

const PREF_STORAGE_KEYS: Record<PanelPrefKey, string> = {
  topLyrics: TOP_LYRICS_KEY,
  showLyrics: SHOW_LYRICS_KEY,
  showPlaylist: SHOW_PLAYLIST_KEY,
};

const MusicContext = createContext<MusicContextValue | null>(null);

export function useMusic(): MusicContextValue {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error("useMusic 必须在 MusicProvider 内使用");
  return ctx;
}

/* ===== 曲目行 =====
 * 三套风格共用同一份结构（序号 / 曲名 / 艺人），观感全部交给 .mp-row 令牌。
 * memo 后仅当歌单或当前曲目变化时重渲染。
 */
const TrackRow = memo(function TrackRow({
  track,
  index,
  active,
  onSelect,
}: {
  track: Track;
  index: number;
  active: boolean;
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

/* ===== 面板设置浮层（风格切换 + 三个显示开关） =====
 * 后台配置的是「站点默认风格」，这里切换的是「本机覆盖」；选「跟随站点」即清掉本机选择。
 */
const PREF_ROWS: { key: PanelPrefKey; label: string }[] = [
  { key: "topLyrics", label: "顶部常驻歌词" },
  { key: "showLyrics", label: "面板内显示歌词" },
  { key: "showPlaylist", label: "面板内显示曲目" },
];

function PanelSettings() {
  const m = useMusic();
  const activeHint = MUSIC_PANEL_STYLE_OPTIONS.find((o) => o.value === m.panelStyle)?.hint ?? "";
  return (
    <div className="mp-settings">
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

      {PREF_ROWS.map((row) => (
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
      ))}
    </div>
  );
}

/* ==================== 控制面板（对齐 home Music.vue） ==================== */
/**
 * 内嵌卡片控制面板（与一言共用同一个功能卡格，保持站内玻璃卡片外观，
 * 不跟随音乐列表弹窗的三套风格）。
 *
 * 两套布局按视口断点切换，共用同一份状态与操作：
 * - ≥880px：与时钟卡并排，行高由时钟卡决定（约 200px），沿用纵向三段布局把空间铺满
 * - <880px：这一格独占一行，改用紧凑布局压到 90px 以内，与一言卡片等高 ——
 *   否则「一言 ↔ 音乐」切换时行高会变化，把下方卡片整体推移
 */
function MusicPanel() {
  const m = useMusic();
  const [collapsed, setCollapsed] = useState(false);
  const track = m.currentTrack;
  const volume = (
    <VolumeSlider volume={m.volume} muted={m.muted} onChange={m.changeVolume} onToggleMuted={m.toggleMuted} />
  );
  const openList = () => m.setBoxOpen(true);
  const backToHitokoto = () => m.setPanelOpen(false);

  return (
    <div
      className={`card-glass card-func music-dark-scope h-full overflow-hidden transition-[width] duration-300 ${
        collapsed ? "w-16" : "w-full"
      }`}
    >
      {collapsed ? (
        <div className="flex h-full flex-col items-center justify-between gap-2 p-3">
          <button type="button" onClick={() => setCollapsed(false)} className={`h-10 w-10 overflow-hidden rounded-full bg-white/10 ${m.isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "8s" }} aria-label="展开音乐播放器">
            {m.currentTrack?.cover ? (
              // unoptimized：封面来自任意第三方图床，next/image 的优化器需要预先配置远程域名白名单；
              // unoptimized 会直接短路默认 loader（不触发该校验），与站内其他远程图一致
              <Image src={m.currentTrack.cover} alt="" width={40} height={40} unoptimized className="h-full w-full object-cover" />
            ) : (
              <Music2 className="m-auto h-5 w-5" />
            )}
          </button>
          <button type="button" onClick={m.togglePlay} disabled={!m.playlist.length} aria-label={m.isPlaying ? "暂停" : "播放"} className="rounded-full bg-white/20 p-2">
            {m.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => setCollapsed(false)} className="max-h-20 overflow-hidden text-xs [writing-mode:vertical-rl] text-white/80">
            {m.currentTrack?.name || "音乐"}
          </button>
        </div>
      ) : (
        <>
          {/* 紧凑布局（<880px）：一行曲目 + 一行控制，整体约 84px，与一言卡片齐平 */}
          <div className="flex h-full flex-col justify-center gap-1 p-3 min-[880px]:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={m.togglePlay}
                disabled={!m.playlist.length}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 transition-colors hover:bg-white/30 disabled:opacity-40"
                title={m.isPlaying ? "暂停" : "播放"}
                aria-label={m.isPlaying ? "暂停" : "播放"}
              >
                {m.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm leading-tight text-white/90">{track?.name || "未选择歌曲"}</div>
                <div className="truncate text-[11px] leading-tight text-white/55">{track?.artist || "打开音乐列表挑选"}</div>
              </div>
              <button
                type="button"
                onClick={m.playPrev}
                disabled={!m.playlist.length}
                className="shrink-0 p-1.5 text-white/70 transition-colors hover:text-white disabled:opacity-40"
                title="上一首"
                aria-label="上一首"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={m.playNext}
                disabled={!m.playlist.length}
                className="shrink-0 p-1.5 text-white/70 transition-colors hover:text-white disabled:opacity-40"
                title="下一首"
                aria-label="下一首"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              {volume}
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={openList} className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-white/80 transition-colors hover:bg-white/20">
                  音乐列表
                </button>
                <button type="button" onClick={backToHitokoto} className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-white/80 transition-colors hover:bg-white/20">
                  回到一言
                </button>
              </div>
            </div>
          </div>

          {/* 宽布局（≥880px）：与原来一致，纵向三段铺满整格 */}
          <div className="hidden h-full flex-col justify-between p-3 min-[880px]:flex">
            <div className="flex items-center justify-between text-xs">
              <button onClick={openList} className="rounded-md bg-white/10 px-2.5 py-1 text-white/80 transition-colors hover:bg-white/20">
                音乐列表
              </button>
              <button onClick={backToHitokoto} className="rounded-md bg-white/10 px-2.5 py-1 text-white/80 transition-colors hover:bg-white/20">
                回到一言
              </button>
            </div>

            <div className="flex items-center justify-evenly">
              <button
                onClick={m.playPrev}
                disabled={!m.playlist.length}
                className="p-2 text-white/70 transition-colors hover:text-white disabled:opacity-40"
                title="上一首"
                aria-label="上一首"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                onClick={m.togglePlay}
                disabled={!m.playlist.length}
                className="rounded-full bg-white/20 p-3 transition-colors hover:bg-white/30 disabled:opacity-40"
                title={m.isPlaying ? "暂停" : "播放"}
                aria-label={m.isPlaying ? "暂停" : "播放"}
              >
                {m.isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
              </button>
              <button
                onClick={m.playNext}
                disabled={!m.playlist.length}
                className="p-2 text-white/70 transition-colors hover:text-white disabled:opacity-40"
                title="下一首"
                aria-label="下一首"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="truncate px-2 text-center text-sm text-white/80">
                {track ? `${track.name} - ${track.artist}` : "未选择歌曲"}
              </div>
              <div className="flex justify-center">{volume}</div>
            </div>
            <button type="button" onClick={() => setCollapsed(true)} className="mt-2 text-center text-[11px] text-white/50 hover:text-white">收起</button>
          </div>
        </>
      )}
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
 * 分区的边框与浅底色见 globals.css 的 .mp-section；
 * 「有没有唱片 / 进度条形态 / 歌词对齐」由 traits 决定，其余观感交给 .mp 令牌。
 */
function MusicModal() {
  const m = useMusic();
  const traits = musicPanelTraits(m.panelStyle);
  const close = () => {
    m.setSettingsOpen(false);
    m.setBoxOpen(false);
    // 未播放时广播关闭事件，让动态标题复位
    if (!m.isPlaying) window.dispatchEvent(new Event("music-player-close"));
  };
  const index = m.playlist.findIndex((t) => t.id === m.currentTrack?.id);
  const noData = !m.currentTrack && m.playlist.length === 0;
  const ModeIcon = PLAY_MODE_META[m.playMode].Icon;

  return (
    <div
      className="mp mp-scrim"
      data-style={m.panelStyle}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="音乐列表"
    >
      <div className="mp mp-dialog" data-style={m.panelStyle} onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <span className="mp-side">{traits.side}</span>
          <span className="mp-spacer" />
          {traits.showCount && m.playlist.length > 0 && (
            <span className="mp-count">
              {String(Math.max(index, 0) + 1).padStart(2, "0")} / {String(m.playlist.length).padStart(2, "0")}
            </span>
          )}
          <button
            type="button"
            className={`mp-icon-btn${m.settingsOpen ? " is-on" : ""}`}
            onClick={() => m.setSettingsOpen(!m.settingsOpen)}
            aria-expanded={m.settingsOpen}
            title="面板设置"
            aria-label="面板设置"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button type="button" className="mp-icon-btn" onClick={close} title="关闭" aria-label="关闭音乐列表">
            <X className="h-4 w-4" />
          </button>
        </div>

        {m.settingsOpen && <PanelSettings />}

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
                    onSelect={m.selectTrack}
                  />
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ==================== 功能卡：音乐控制面板 / 一言 切换（对齐 home） ==================== */
/** 挂载于右侧功能卡组左格：控制面板开启时显示 MusicPanel，否则显示一言（hover 可打开音乐） */
export function MusicCard({ hitokotoType = "" }: { hitokotoType?: string }) {
  const m = useMusic();
  return m.panelOpen ? (
    <MusicPanel />
  ) : (
    <Hitokoto type={hitokotoType} onOpenMusic={() => m.setPanelOpen(true)} />
  );
}

/* ==================== Provider（页面根部挂载，包住全站内容） ==================== */
export default function MusicProvider({
  children,
  musicPanelStyle,
  ...props
}: UseAudioPlayerProps & {
  children: React.ReactNode;
  /** 站点默认的音乐面板风格（后台配置；访客可在面板里本机覆盖） */
  musicPanelStyle?: string;
}) {
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
    playNext,
    playPrev,
    selectTrack,
    lyricLines,
    lyricIndex,
    audioEl,
    setAudioEl,
  } = useAudioPlayer(props);

  const [panelOpen, setPanelOpen] = useState(false);
  const [boxOpen, setBoxOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 面板风格与偏好都留在本机：站点默认来自后台配置，访客可在面板里覆盖（localStorage）。
  // 首屏先按站点默认 + 默认偏好渲染，挂载后再读本机值
  // （服务端渲染读不到 localStorage，首屏直接读会导致 hydration 不一致而闪烁）。
  const [localStyle, setLocalStyle] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<MusicPanelPrefs>(DEFAULT_MUSIC_PANEL_PREFS);

  useEffect(() => {
    try {
      const ls = window.localStorage;
      setLocalStyle(ls.getItem(MUSIC_PANEL_STYLE_KEY));
      setPrefs(
        parseMusicPanelPrefs({
          topLyrics: ls.getItem(TOP_LYRICS_KEY),
          showLyrics: ls.getItem(SHOW_LYRICS_KEY),
          showPlaylist: ls.getItem(SHOW_PLAYLIST_KEY),
          lyricSize: ls.getItem(TOP_LYRICS_SIZE_KEY),
        })
      );
    } catch {
      // 隐私模式等场景下 localStorage 不可用：保持站点默认与默认偏好
    }
  }, []);

  const setPanelStyle = useCallback((value: string) => {
    setLocalStyle(value);
    try {
      window.localStorage.setItem(MUSIC_PANEL_STYLE_KEY, value);
    } catch {
      // 写不进去也不影响本次会话内的切换
    }
  }, []);

  const setPref = useCallback((key: PanelPrefKey, value: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    try {
      window.localStorage.setItem(PREF_STORAGE_KEYS[key], formatBoolPref(value));
    } catch {
      // 同上：写不进去不影响本次会话
    }
  }, []);

  // 字号档位是数值而非布尔，单独一个 setter（落盘为 "4" 这类字符串）
  const setLyricSize = useCallback((level: LyricSizeLevel) => {
    setPrefs((prev) => ({ ...prev, lyricSize: level }));
    try {
      window.localStorage.setItem(TOP_LYRICS_SIZE_KEY, String(level));
    } catch {
      // 同上：写不进去不影响本次会话
    }
  }, []);

  const panelStyle = resolveMusicPanelStyle({
    siteDefault: musicPanelStyle,
    localOverride: localStyle,
  });
  // 本机存的值非法（含 null 与已下线的旧值）即视为「跟随站点」，与 resolveMusicPanelStyle 的收敛口径一致
  const panelStyleFollowsSite = !isMusicPanelStyle(localStyle);

  // 音频元素 ref 回调（稳定引用，避免每次渲染重绑）
  const audioRefCallback = useCallback((el: HTMLAudioElement | null) => setAudioEl(el), [setAudioEl]);

  // 键盘快捷键（对齐 home：Space 播放暂停 / PageUp 上一曲 / PageDown 下一曲）
  useEffect(() => {
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
  }, [playlist.length, togglePlay, playPrev, playNext]);

  // 外部「音乐」链接（SiteLinks）触发：打开列表弹窗（对齐 home Links.vue）
  useEffect(() => {
    const handleToggle = () => setBoxOpen(true);
    window.addEventListener("toggle-music-player", handleToggle);
    return () => window.removeEventListener("toggle-music-player", handleToggle);
  }, []);

  // Media Session：更新系统媒体元数据（锁屏/系统 UI 显示歌名与封面）
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.name,
      artist: currentTrack.artist,
      artwork: currentTrack.cover ? [{ src: currentTrack.cover, sizes: "512x512", type: "image/jpeg" }] : undefined,
    });
  }, [currentTrack]);

  // Media Session：系统媒体控制（耳机/锁屏按键）
  useEffect(() => {
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
  }, [audioEl, togglePlay, playNext, playPrev]);

  useEffect(() => {
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
  }, [audioEl, currentTime, duration]);

  const value: MusicContextValue = {
    isPlaying,
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
    panelOpen,
    setPanelOpen,
    boxOpen,
    setBoxOpen,
    settingsOpen,
    setSettingsOpen,
    panelStyle,
    setPanelStyle,
    panelStyleFollowsSite,
    prefs,
    setPref,
    lyricSize: prefs.lyricSize,
    setLyricSize,
  };

  return (
    <MusicContext.Provider value={value}>
      {/* 音频元素常驻挂载：收起面板/弹窗时音乐不中断 */}
      <audio
        id="music-audio"
        ref={audioRefCallback}
        src={currentTrack?.url}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      {boxOpen && <MusicModal />}
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
  children: ReactNode;
}

export function MusicProviderLazy({
  songApi,
  songServer,
  songId,
  musicAutoplay,
  musicPanelStyle,
  children,
}: MusicProviderWrapperProps) {
  return (
    <MusicProviderLazyComp
      songApi={songApi}
      songServer={songServer}
      songId={songId}
      autoplay={musicAutoplay}
      musicPanelStyle={musicPanelStyle}
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
