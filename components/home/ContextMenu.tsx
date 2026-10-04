"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { scrollPageToTop } from "@/lib/scroll";
import {
  ArrowUpToLine,
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  ListMusic,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useMusic } from "@/components/home/MusicPlayer";
import {
  buildContextMenu,
  findLinkHref,
  shouldInterceptContextMenu,
  SELECTION_SEARCH_BASE,
  type ContextMenuAction,
  type ContextMenuItem,
  type RightClickMode,
} from "@/lib/rightClick";

/**
 * 前端右键行为（后台「站点信息 → 前端右键行为」）：
 *   default  → 本组件完全不介入（甚至不挂 contextmenu 监听）
 *   disabled → 拦截后什么都不弹（输入框 / 可编辑区 / 触屏长按仍放行原生菜单）
 *   menu     → 弹本站功能菜单
 *
 * 和背景 / 音乐的联动走既有的 window 事件约定（wallpaper-next / open-command-palette），
 * 不额外引入全局状态：菜单是「顺手调用一下已有能力」的角色，不该反向持有它们的内部状态。
 */

/** 动作 → 图标。数据定义在 lib（可脱离 DOM 单测），图标留在组件，两边各自只关心自己的一半 */
const ACTION_ICONS: Record<ContextMenuAction, LucideIcon> = {
  "open-link": ExternalLink,
  "copy-link-address": Link2,
  "copy-selection": Copy,
  "search-selection": Search,
  "toggle-play": Play,
  "prev-track": SkipBack,
  "next-track": SkipForward,
  "open-playlist": ListMusic,
  "next-wallpaper": ImageIcon,
  "scroll-top": ArrowUpToLine,
  "open-command-palette": Wand2,
  "copy-page-link": Link2,
};

/** 复制成功的提示停留时长（毫秒）：够看清，又不至于让菜单挡着页面 */
const COPIED_HINT_MS = 900;

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** 右键时刻的选中文字：动作执行时选区可能已经变化，必须先快照 */
  selection: string;
  linkHref: string;
}

/**
 * 写剪贴板：优先异步 Clipboard API，失败（非安全上下文 / 权限被拒）再退回
 * 临时 textarea + execCommand。返回是否成功，供菜单显示「已复制」。
 */
async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function ContextMenu({
  mode,
  coverType,
  commandPaletteEnabled,
}: {
  mode: RightClickMode;
  /** 壁纸类型：只有随机类（风景 / 动漫）才谈得上「换一张」 */
  coverType: string;
  commandPaletteEnabled: boolean;
}) {
  const music = useMusic();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [active, setActive] = useState(0);
  /** 刚复制成功的条目：短暂把文案换成「已复制」再关闭，否则点了没有任何反馈 */
  const [copied, setCopied] = useState<ContextMenuAction | null>(null);
  const menuElRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const canSwitchWallpaper = coverType === "landscape" || coverType === "anime";

  // 关闭：清掉可能挂着的「已复制」延迟关闭定时器，避免卸载后再 setState
  const close = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    setCopied(null);
    setMenu(null);
  }, []);

  useEffect(() => close, [close]);

  /** 菜单按视口边缘翻转：右下角右键时不能把菜单顶出屏幕 */
  const placeMenu = useCallback(
    (el: HTMLDivElement | null) => {
      menuElRef.current = el;
      if (!el || !menu) return;
      const rect = el.getBoundingClientRect();
      const pad = 8;
      const maxLeft = window.innerWidth - rect.width - pad;
      const maxTop = window.innerHeight - rect.height - pad;
      el.style.left = `${Math.max(pad, Math.min(menu.x, maxLeft))}px`;
      el.style.top = `${Math.max(pad, Math.min(menu.y, maxTop))}px`;
    },
    [menu]
  );

  /**
   * 事件是否发生在菜单自身内部（点菜单项、在菜单上右键都不该被当成「关掉重开」）。
   * 只读 ref，身份恒定，可以安全地进 effect 依赖。
   */
  const isInsideMenu = useCallback(
    (target: EventTarget | null) =>
      !!menuElRef.current && target instanceof Node && menuElRef.current.contains(target),
    []
  );

  // ===== 拦截右键 =====
  // 只挂这一个 contextmenu 监听：曾经另有一个「在别处右键就先关掉旧菜单」的监听，
  // 两个监听同时命中时 React 会合并两次 setState，后写的 null 把新菜单覆盖掉 ——
  // 表现为菜单已打开时再右键，菜单直接消失而不是挪到新位置。
  useEffect(() => {
    if (mode === "default") return;
    const onContextMenu = (event: MouseEvent) => {
      // 菜单自己身上再右键：维持现状（既不重建也不关闭），不做任何状态变更
      if (isInsideMenu(event.target)) {
        event.preventDefault();
        return;
      }
      const coarsePointer =
        typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
      if (!shouldInterceptContextMenu({ target: event.target, mode, coarsePointer })) {
        // 放行原生菜单（输入框 / 可编辑区 / 触屏长按）：顺手收起自己的菜单，
        // 否则会出现「原生菜单 + 站内菜单」两层同时挂着
        close();
        return;
      }
      event.preventDefault();
      if (mode === "disabled") {
        close();
        return;
      }
      const selection = window.getSelection?.()?.toString().trim() ?? "";
      const linkHref = findLinkHref(event.target, window.location.href);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        selection,
        linkHref,
        items: buildContextMenu({
          hasSelection: selection.length > 0,
          hasPlaylist: music.playlist.length > 0,
          canSwitchWallpaper,
          commandPaletteEnabled,
          linkHref,
        }),
      });
      setActive(0);
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [mode, music.playlist.length, canSwitchWallpaper, commandPaletteEnabled, close, isInsideMenu]);

  // ===== 失焦即关：左键、滚动、缩放、切标签页都不该留着菜单 =====
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: Event) => {
      // mousedown 先于 click 派发：不放过菜单内部的按下，点菜单项就会「先关菜单再丢点击」，
      // 表现为所有条目都点不动
      if (isInsideMenu(event.target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    // 注意：右键不在这里处理 —— 换位置/关闭都由上面的拦截监听统一负责，
    // 两边同时处理会互相覆盖（见该监听的注释）
    window.addEventListener("resize", onDown);
    window.addEventListener("scroll", onDown, true);
    window.addEventListener("blur", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onDown);
      window.removeEventListener("scroll", onDown, true);
      window.removeEventListener("blur", onDown);
    };
  }, [menu, close, isInsideMenu]);

  // 打开即聚焦菜单容器，键盘用户可以直接方向键选择
  useEffect(() => {
    if (menu) menuElRef.current?.focus();
  }, [menu]);

  const execute = useCallback(
    async (item: ContextMenuItem, state: MenuState) => {
      const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
      switch (item.action) {
        case "open-link":
          open(state.linkHref);
          break;
        case "copy-link-address":
          if (await copyText(state.linkHref)) {
            setCopied(item.action);
            closeTimerRef.current = window.setTimeout(close, COPIED_HINT_MS);
            return;
          }
          break;
        case "copy-selection":
          if (await copyText(state.selection)) {
            setCopied(item.action);
            closeTimerRef.current = window.setTimeout(close, COPIED_HINT_MS);
            return;
          }
          break;
        case "search-selection":
          open(`${SELECTION_SEARCH_BASE}${encodeURIComponent(state.selection)}`);
          break;
        case "toggle-play":
          music.togglePlay();
          break;
        case "prev-track":
          music.playPrev();
          break;
        case "next-track":
          music.playNext();
          break;
        case "open-playlist":
          music.setBoxOpen(true);
          break;
        case "next-wallpaper":
          // 由 Background 组件监听并**强制**去上游取一张新图（普通取图是缓存优先，
          // 不会为了换图请求上游），这里不持有它的内部状态
          window.dispatchEvent(new Event("wallpaper-next"));
          break;
        case "scroll-top":
          scrollPageToTop(prefersReducedMotion() ? "auto" : "smooth");
          break;
        case "open-command-palette":
          window.dispatchEvent(new Event("open-command-palette"));
          break;
        case "copy-page-link":
          if (await copyText(window.location.href)) {
            setCopied(item.action);
            closeTimerRef.current = window.setTimeout(close, COPIED_HINT_MS);
            return;
          }
          break;
      }
      close();
    },
    [music, close]
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!menu) return;
      const last = menu.items.length - 1;
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          close();
          break;
        case "ArrowDown":
          event.preventDefault();
          setActive((prev) => (prev >= last ? 0 : prev + 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setActive((prev) => (prev <= 0 ? last : prev - 1));
          break;
        case "Home":
          event.preventDefault();
          setActive(0);
          break;
        case "End":
          event.preventDefault();
          setActive(last);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          void execute(menu.items[active], menu);
          break;
      }
    },
    [menu, active, execute, close]
  );

  if (!menu) return null;

  const items = menu.items;
  // 与播放状态联动的条目：图标要跟着当前状态走
  const iconFor = (action: ContextMenuAction): LucideIcon =>
    action === "toggle-play" ? (music.isPlaying ? Pause : Play) : ACTION_ICONS[action];

  return (
    <div
      ref={placeMenu}
      className="ctx-menu"
      role="menu"
      aria-label="页面功能菜单"
      tabIndex={-1}
      style={{ left: menu.x, top: menu.y }}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => {
        const Icon = copied === item.action ? Check : iconFor(item.action);
        return (
          <Fragment key={item.action}>
            {index > 0 && items[index - 1].group !== item.group && (
              <div className="ctx-sep" role="separator" />
            )}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-active={index === active}
              className={`ctx-item${index === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => void execute(item, menu)}
            >
              <Icon className="ctx-icon" aria-hidden="true" />
              <span className="ctx-label">{copied === item.action ? "已复制" : item.label}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
