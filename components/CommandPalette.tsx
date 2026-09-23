"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft, Globe, Users, ArrowUp, Music, X } from "lucide-react";

export interface CmdLink {
  id: number;
  name: string;
  url: string;
}

interface CommandPaletteProps {
  /** 「我的网站」链接（用于搜索跳转） */
  siteLinks?: CmdLink[];
  /** 「友情链接」（用于搜索跳转） */
  friendLinks?: CmdLink[];
  /** 网站区域标题（默认「我的网站」） */
  siteTitle?: string;
  /** 友链区域标题（默认「友情链接」） */
  friendTitle?: string;
}

const MUSIC_LINK = "music";

interface Action {
  key: string;
  label: string;
  hint: string;
  icon: typeof Globe;
  group: string;
  run: () => void;
  order: number;
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  return el.isContentEditable;
}

/**
 * 命令面板：Ctrl/Cmd + K 或「/」唤起。
 * 搜索「我的网站 / 友情链接」并快捷跳转，附带常用站点操作。
 */
export default function CommandPalette({ siteLinks = [], friendLinks = [], siteTitle = "我的网站", friendTitle = "友情链接" }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全局快捷键：Ctrl/Cmd+K 或 「/」打开，Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (!e.metaKey && !e.ctrlKey && e.key === "/" && !isEditable(e.target)) {
        // 【Medium 修复】"/" 键在 textarea/input 等可编辑元素中不触发面板
        e.preventDefault();
        setOpen(true);
      } else if (open && e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    // 清理函数确保在组件 unmount 或依赖变化时移除旧监听器
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 打开时聚焦输入框并重置查询
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const isLinkMusic = (name: string, url: string) => url === MUSIC_LINK || name === "音乐";

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => (q ? s.toLowerCase().includes(q) : true);
    const out: Action[] = [];
    let order = 0;
    if (siteTitle) {
      siteLinks.filter((l) => match(l.name) || match(l.url)).forEach((l, i) => {
        out.push({
          key: `site-${l.id}`,
          label: l.name,
          hint: l.url === MUSIC_LINK ? "音乐" : l.url,
          icon: Globe,
          group: siteTitle,
          run: () => {
            if (isLinkMusic(l.name, l.url)) {
              window.dispatchEvent(new CustomEvent("toggle-music-player"));
            } else {
              window.open(l.url, "_blank", "noopener,noreferrer");
            }
          },
          order: order++ + i / 1000,
        });
      });
    }
    if (friendTitle) {
      friendLinks.filter((l) => match(l.name) || match(l.url)).forEach((l, i) => {
        out.push({
          key: `friend-${l.id}`,
          label: l.name,
          hint: l.url,
          icon: Users,
          group: friendTitle,
          run: () => window.open(l.url, "_blank", "noopener,noreferrer"),
          order: order++ + i / 1000,
        });
      });
    }
    // 站点操作
    const actions: Action[] = [
      { key: "top", label: "回到顶部", hint: "", icon: ArrowUp, group: "操作", order: 1000, run: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
      { key: "music", label: "打开音乐列表", hint: "", icon: Music, group: "操作", order: 1001, run: () => window.dispatchEvent(new CustomEvent("toggle-music-player")) },
    ];
    actions.forEach((a) => out.push({ ...a, label: match(a.label) ? a.label : "" }));
    const filtered = out.filter((a) => a.label);
    return filtered.sort((a, b) => a.order - b.order);
  }, [query, siteLinks, friendLinks, siteTitle, friendTitle]);

  // 打开时重置 active 到首项，防止滚动错位
  useEffect(() => {
    if (open) setActive(0);
  }, [open, query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (entries[active]) {
        const r = entries[active];
        setOpen(false);
        r.run();
      }
    }
  };

  if (!open) return null;

  return (
    // 全屏遮罩 + 顶部居中的玻璃命令面板；点击遮罩关闭（区别于公告弹窗的「我知道了」）
    <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[16vh]" role="dialog" aria-modal="true" aria-label="命令面板">
      <button type="button" aria-label="关闭命令面板" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-[#0d1626]/95 shadow-2xl backdrop-blur-xl">
        {/* 搜索输入框 */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
          <Search className="h-5 w-5 shrink-0 text-white/50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={`搜索 ${siteTitle} / ${friendTitle}…`}
            className="w-full bg-transparent text-base text-white placeholder-white/40 outline-none"
          />
          <kbd className="hidden shrink-0 rounded-md border border-white/15 px-1.5 py-0.5 font-sans text-xs text-white/45 sm:inline-flex">Esc</kbd>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {entries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-white/40">没有找到匹配项</p>
          ) : (
            entries.map((item, i) => {
              const firstOfGroup = i === 0 || entries[i - 1].group !== item.group;
              const Icon = item.icon;
              return (
                <div key={item.key}>
                  {firstOfGroup && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-white/35">{item.group}</p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => { setOpen(false); item.run(); }}
                    className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      active === i ? "bg-white/10" : "bg-transparent"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-white/45" />
                    <span className="flex-1 truncate text-sm text-white">{item.label}</span>
                    {item.hint && <span className="max-w-[45%] truncate text-xs text-white/35">{item.hint}</span>}
                    {active === i && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-white/30" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2.5 text-[11px] text-white/35">
          <span className="inline-flex items-center gap-1"><kbd className="rounded border border-white/15 px-1">↑</kbd><kbd className="rounded border border-white/15 px-1">↓</kbd> 选择</span>
          <span className="inline-flex items-center gap-1"><kbd className="rounded border border-white/15 px-1">↵</kbd> 打开</span>
          <span className="ml-auto"><X className="mr-1 inline h-3 w-3" />Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}