"use client";

import { useState } from "react";
import {
  Star,
  BookOpen,
  Cloud,
  Music,
  Compass,
  Link,
  Flame,
  Monitor,
  Globe,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import type { ProjectRow, FriendLinkRow } from "@/app/hooks";
import { useIconfontSymbols } from "./Iconfont";
import { resolveLucideIcon, isLucideIcon } from "./lucideIconResolver";
import { resolveIconImageSrc } from "@/lib/iconValue";

// 图标映射表（与并入前的网站链接组件一致）
const ICON_MAP: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  book: BookOpen,
  cloud: Cloud,
  music: Music,
  compass: Compass,
  link: Link,
  flame: Flame,
  fire: Flame,
  monitor: Monitor,
  globe: Globe,
  website: Globe,
  default: Globe,
};

interface TabLink {
  id: number;
  name: string;
  icon: string;
  url: string;
  sort: number;
}

type TabKey = "site" | "friend" | "project";

interface LinkTabsProps {
  /** 网站链接（tab「网站」） */
  siteLinks: TabLink[];
  /** 友情链接（tab「友情」） */
  friendLinks: FriendLinkRow[];
  /** 作品（tab「作品」，已按 enabled/featured/sort 过滤排序） */
  projects: ProjectRow[];
  /** 区域标题「网站」部分（后台可配置） */
  siteTitle?: string;
  /** 标题图标：显示在「网站」tab 标签前（后台可配置，支持图片/iconfont/lucide 图标名） */
  siteIcon?: string;
  /** 区域标题「友情」部分（后台可配置） */
  friendTitle?: string;
}

// 网站/友链每页 6 个（3 列 × 2 行），对齐原网站链接轮播布局
const PAGE_SIZE = 6;
// 作品每页 2 个，单列展示（一行一个，共 2 行）
const PROJECT_PAGE_SIZE = 2;

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export default function LinkTabs({
  siteLinks,
  friendLinks,
  projects,
  siteTitle = "我的网站",
  siteIcon = "",
  friendTitle = "友情链接",
}: LinkTabsProps) {
  // 仅渲染有数据的 tab；初始 tab 优先网站 → 友链 → 作品
  const hasSite = siteLinks.length > 0;
  const hasFriend = friendLinks.length > 0;
  const hasProject = projects.length > 0;

  const availableTabs: { key: TabKey; label: string; count: number; icon?: string }[] = [];
  if (hasSite) availableTabs.push({ key: "site", label: siteTitle || "我的网站", count: siteLinks.length, icon: siteIcon });
  if (hasFriend) availableTabs.push({ key: "friend", label: friendTitle || "友情链接", count: friendLinks.length });
  if (hasProject) availableTabs.push({ key: "project", label: "我的作品", count: projects.length });

  const [tab, setTab] = useState<TabKey>(
    () => availableTabs[0]?.key ?? "site"
  );
  const [sitePage, setSitePage] = useState(0);
  const [friendPage, setFriendPage] = useState(0);
  const [projectPage, setProjectPage] = useState(0);
  const iconfontSymbols = useIconfontSymbols();

  if (availableTabs.length === 0) {
    return null;
  }

  // 当前活跃数据源与对应分页 state
  const isSite = tab === "site";
  const isFriend = tab === "friend";
  const isProject = tab === "project";
  const active = isProject ? projects : isFriend ? friendLinks : siteLinks;
  const page = isProject ? projectPage : isFriend ? friendPage : sitePage;
  const setPage = isProject ? setProjectPage : isFriend ? setFriendPage : setSitePage;

  const getIcon = (iconName: string): LucideIcon => {
    if (isLucideIcon(iconName)) {
      const LucideIconComp = resolveLucideIcon(iconName);
      if (LucideIconComp) return LucideIconComp;
    }
    const key = iconName.toLowerCase().replace(/[^a-z-]/g, "");
    return ICON_MAP[key] || ICON_MAP[iconName] || ICON_MAP.default;
  };

  // 「网站」tab 保留音乐触发特例（与并入前行为一致）
  const isMusicTrigger = (link: TabLink) => link.name === "音乐" || link.url === "music:";

  const handleLinkClick = (link: TabLink, kind: "site" | "friend") => {
    if (isSite && isMusicTrigger(link)) {
      const event = new CustomEvent("toggle-music-player");
      window.dispatchEvent(event);
      return;
    }
    // 热门链接统计：fire-and-forget 上报（失败静默，不影响跳转）。
    // 只上报 (kind, id)：名称与链接由服务端回查数据库取权威值，
    // 该接口无鉴权，若由前端上传 name/url 就能被任意访客投毒。
    try {
      fetch("/api/stats/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: link.id, kind }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* 忽略 */
    }
    window.open(link.url, "_blank", "noopener,noreferrer");
  };

  const pages = isProject ? chunk(projects, PROJECT_PAGE_SIZE) : isFriend ? chunk(active as TabLink[], PROJECT_PAGE_SIZE) : chunk(active as TabLink[], PAGE_SIZE);
  const currentPage = Math.min(page, pages.length - 1);
  const goTo = (index: number) => setPage(index);

  const handleWheel = (e: React.WheelEvent) => {
    if (pages.length <= 1) return;
    if (e.deltaY > 0) {
      setPage((p) => Math.min(p + 1, pages.length - 1));
    } else {
      setPage((p) => Math.max(p - 1, 0));
    }
  };

  // 键盘翻页：左右方向键 / PageUp-PageDown / Home-End（对齐轮播滚轮交互）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (pages.length <= 1) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      setPage((p) => Math.min(p + 1, pages.length - 1));
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      setPage((p) => Math.max(p - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPage(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPage(pages.length - 1);
    }
  };

  return (
    <div className="site-links-container">
      {/* tab 条：仅渲染有数据的 tab，多个 tab 等分并贯穿竖线分隔；选中项白色 + 强调色下划线 */}
      <div className="relative mb-3 flex items-center rounded-2xl border border-white/10 bg-white/5 py-1.5 backdrop-blur-sm">
        {availableTabs.map((t, i) => (
          <FragmentTabBtn
            key={t.key}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
            label={t.label}
            icon={t.icon}
            iconfontSymbols={iconfontSymbols}
            isLast={i === availableTabs.length - 1}
          />
        ))}
      </div>

      {/* 卡片轮播：每页固定 6 格（3 列 × 2 行），不足补占位以保持网格高度恒定 */}
      <div
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        role="region"
        aria-label={`${tab === "project" ? "我的作品" : tab === "friend" ? friendTitle : siteTitle}，可用左右方向键翻页`}
        tabIndex={0}
        className="select-none outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        <div key={currentPage} className={`animate-fade grid gap-4 ${isProject || isFriend ? "grid-cols-1" : "grid-cols-3"}`}>
          {Array.from({ length: isProject || isFriend ? PROJECT_PAGE_SIZE : PAGE_SIZE }, (_, i) => {
            const item = pages[currentPage][i];
            if (!item) {
              return <div key={`link-ph-${i}`} className="h-[var(--nav-cell,100px)]" aria-hidden />;
            }

            // 作品卡：封面图 + 精选角标 + 标题，外链可点击
            if (isProject) {
              const p = item as unknown as ProjectRow;
              // 图片来源：random:关键词 随机图 / http(s) 外链 / 媒体库路径
              const imageUrl = resolveIconImageSrc(p.image, 120);
              const card = (
                <div className="card-btn flex h-[var(--nav-cell,100px)] w-full items-center gap-3 overflow-hidden px-3 text-left">
                  {imageUrl && (
                    <Image
                      src={imageUrl}
                      alt={p.title}
                      width={60}
                      height={60}
                      className="h-[60px] w-[60px] shrink-0 rounded-lg object-cover"
                      unoptimized
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-center">
                    <span className="truncate text-sm font-semibold text-white">{p.title}</span>
                    {p.description && (
                      <span className="mt-0.5 truncate text-xs text-white/60">{p.description}</span>
                    )}
                  </div>
                  {p.featured && (
                    <span className="absolute right-2 top-2 text-amber-300">
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </span>
                  )}
                </div>
              );
              return p.url ? (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative"
                  onClick={() => {
                    try {
                      fetch("/api/stats/click", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        // 作品与网站链接的自增 id 空间相互独立，必须带 kind 才能正确归类
                        body: JSON.stringify({ id: p.id, kind: "project" }),
                        keepalive: true,
                      }).catch(() => {});
                    } catch { /* 忽略 */ }
                  }}
                >
                  {card}
                </a>
              ) : (
                <div key={p.id} className="group relative">
                  {card}
                </div>
              );
            }

            // 友链卡：图标 + 标题 + 描述，和作品布局一致
            if (isFriend) {
              const f = item as FriendLinkRow;
              const imgSrc = resolveIconImageSrc(f.icon, 120);
              const useIconfont = !imgSrc && iconfontSymbols.includes(f.icon);
              const hasIcon = !!f.icon && (!!imgSrc || isLucideIcon(f.icon) || iconfontSymbols.includes(f.icon));
              const IconComponent = getIcon(f.icon);
              return (
                <button
                  key={f.id}
                  onClick={() => handleLinkClick(f as unknown as TabLink, "friend")}
                  className="card-btn flex h-[var(--nav-cell,100px)] w-full items-center gap-3 overflow-hidden px-3 text-left"
                  title={f.name}
                >
                  {hasIcon && (
                    imgSrc ? (
                      <Image
                        src={imgSrc}
                        alt={f.name}
                        width={60}
                        height={60}
                        className="h-[60px] w-[60px] shrink-0 rounded-lg object-cover"
                        unoptimized
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : useIconfont ? (
                      <svg className="h-[60px] w-[60px] shrink-0 text-white/80" aria-hidden="true" focusable="false">
                        <use href={`#${f.icon}`} />
                      </svg>
                    ) : (
                      <IconComponent className="h-[60px] w-[60px] shrink-0 text-white/80" />
                    )
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-center">
                    <span className="truncate text-sm font-semibold text-white">{f.name}</span>
                    {f.description && (
                      <span className="mt-0.5 truncate text-xs text-white/60">{f.description}</span>
                    )}
                  </div>
                </button>
              );
            }

            const link = item as TabLink;
            const imgSrc = resolveIconImageSrc(link.icon, 52);
            const IconComponent = getIcon(link.icon);
            const useIconfont = !imgSrc && iconfontSymbols.includes(link.icon);
            return (
              <button
                key={link.id}
                onClick={() => handleLinkClick(link, "site")}
                className="card-btn flex h-[var(--nav-cell,100px)] w-full flex-col items-center justify-center gap-1 md:flex-row md:gap-2"
                title={link.name}
              >
                {imgSrc ? (
                  <Image
                    src={imgSrc}
                    alt={link.name}
                    width={26}
                    height={26}
                    className="h-[26px] w-[26px] shrink-0 rounded-full object-cover"
                    unoptimized
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : useIconfont ? (
                  <svg className="h-[26px] w-[26px] shrink-0 text-white/80" aria-hidden="true" focusable="false">
                    <use href={`#${link.icon}`} />
                  </svg>
                ) : (
                  <IconComponent className="h-[26px] w-[26px] shrink-0 text-white/80" />
                )}
                <span className="max-w-full truncate text-xs font-medium tracking-wide text-white/85 md:max-w-[7.5rem] md:text-base">
                  {link.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 翻页按钮：左右箭头 + 分页指示点。
          容器恒定渲染以保持各 tab 容器等高，切换时卡片区不跳动；控件仅在多页时显示 */}
      <div className="mt-4 flex min-h-8 items-center justify-center gap-4 lg:mt-5" aria-hidden={pages.length <= 1}>
        {pages.length > 1 && <button
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            disabled={currentPage === 0}
            aria-label="上一页"
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
              currentPage === 0
                ? "cursor-not-allowed bg-white/5 text-white/25"
                : "bg-white/10 text-white/75 hover:bg-white/20 hover:text-white active:scale-95"
            }`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>}

          {pages.length > 1 && <div className="flex items-center gap-2">
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`第 ${i + 1} 页`}
                className={`h-2.5 rounded-full transition-all duration-300 ease-out ${
                  i === currentPage ? "w-6 bg-white/90" : "w-2.5 bg-white/20 hover:bg-white/40"
                }`}
              />
            ))}
          </div>}

          {pages.length > 1 && <button
            onClick={() => setPage((p) => Math.min(p + 1, pages.length - 1))}
            disabled={currentPage === pages.length - 1}
            aria-label="下一页"
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
              currentPage === pages.length - 1
                ? "cursor-not-allowed bg-white/5 text-white/25"
                : "bg-white/10 text-white/75 hover:bg-white/20 hover:text-white active:scale-95"
            }`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>}
      </div>
    </div>
  );
}

/**
 * tab 标签前的图标。
 * 与链接卡保持同一套三分支渲染：图片地址 → iconfont symbol → lucide 图标名。
 * 解析不出具体图标时返回 null（不渲染），避免出现无意义的默认占位图形。
 */
function TabIcon({ value, iconfontSymbols }: { value?: string; iconfontSymbols: string[] }) {
  if (!value) return null;
  const imgSrc = resolveIconImageSrc(value, 32);
  if (imgSrc) {
    return (
      <Image
        src={imgSrc}
        alt=""
        width={16}
        height={16}
        className="h-4 w-4 shrink-0 rounded object-cover"
        unoptimized
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  if (iconfontSymbols.includes(value)) {
    return (
      <svg className="h-4 w-4 shrink-0" aria-hidden="true" focusable="false">
        <use href={`#${value}`} />
      </svg>
    );
  }
  const key = value.toLowerCase().replace(/[^a-z-]/g, "");
  const IconComp = ICON_MAP[key];
  return IconComp ? <IconComp className="h-4 w-4 shrink-0" aria-hidden /> : null;
}

function FragmentTabBtn({
  active,
  onClick,
  label,
  icon,
  iconfontSymbols,
  isLast,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: string;
  iconfontSymbols: string[];
  isLast: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold transition-all duration-200 ${
        active ? "text-white" : "text-white/55 hover:text-white/85"
      } ${active && "underline decoration-[1.5px] underline-offset-[4px]"}`}
      style={active ? { textDecorationColor: "var(--accent-color, #7dd3fc)" } : undefined}
    >
      <TabIcon value={icon} iconfontSymbols={iconfontSymbols} />
      {label}
      {!isLast && (
        <span className="absolute inset-y-1.5 -right-[6.5px] w-px bg-white/15" aria-hidden />
      )}
    </button>
  );
}