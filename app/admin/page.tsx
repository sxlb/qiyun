"use client";

import { useEffect, useState, useCallback, useRef, lazy, Suspense, memo } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { loadProfile } from "@/components/admin/profileShared";
import {
  User,
  Settings,
  ScrollText,
  CloudSun,
  LogOut,
  Menu,
  X,
  Activity,
  LayoutDashboard,
  ShieldCheck,
  Wrench,
  Palette,
  Music,
  Database,
  BarChart3,
  Megaphone,
  ExternalLink,
  Copy,
  Images,
  Link2,
  Rocket,
  FolderGit2,
  Sparkles,
} from "lucide-react";

// 面板组件懒加载：每个面板拆成独立 chunk，进入对应 tab 时才按需加载，
// 避免后台首屏一次性打包全部面板及其重依赖（图表 / Markdown 渲染等）。
// 后台固定 4 列等宽，面板间仅切换不销毁，加载一次后保持挂载，避免重复请求。
const ProfilePanel = lazy(() => import("@/components/admin/ProfilePanel"));
const LinksManager = lazy(() => import("@/components/admin/LinksManager"));
const AccountPanel = lazy(() => import("@/components/admin/AccountPanel"));
const OperationLogPanel = lazy(() => import("@/components/admin/OperationLogPanel"));
const MediaPanel = lazy(() => import("@/components/admin/MediaPanel"));
const WeatherPanel = lazy(() => import("@/components/admin/WeatherPanel"));
const HealthPanel = lazy(() => import("@/components/admin/HealthPanel"));
const ThemePanel = lazy(() => import("@/components/admin/ThemePanel"));
const MusicPanel = lazy(() => import("@/components/admin/MusicPanel"));
const DataPanel = lazy(() => import("@/components/admin/DataPanel"));
const StatsPanel = lazy(() => import("@/components/admin/StatsPanel"));
const AnnouncementPanel = lazy(() => import("@/components/admin/AnnouncementPanel"));
const UpdatePanel = lazy(() => import("@/components/admin/UpdatePanel"));
const ProjectsPanel = lazy(() => import("@/components/admin/ProjectsPanel"));
const SkillsPanel = lazy(() => import("@/components/admin/SkillsPanel"));


type TabId =
  | "profile"
  | "theme"
  | "music"
  | "links"
  | "weather"
  | "announcements"
  | "account"
  | "logs"
  | "health"
  | "data"
  | "stats"
  | "media"
  | "update"
  | "projects"
  | "skills";

interface TabItem {
  id: TabId;
  label: string;
  icon: typeof User;
  description: string;
}

interface NavGroup {
  label: string;
  icon: typeof LayoutDashboard;
  items: TabItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "站点内容",
    icon: LayoutDashboard,
    items: [
      { id: "profile", label: "站点信息", icon: User, description: "设置个人主页的基本资料与展示信息" },
      { id: "announcements", label: "站点公告", icon: Megaphone, description: "发布/编辑公告，前台上方展示" },
      { id: "links", label: "链接管理", icon: Link2, description: "集中管理社交、网站与友情链接" },
      { id: "projects", label: "作品集", icon: FolderGit2, description: "管理展示的作品项目（含封面与置顶）" },
      { id: "skills", label: "技能云", icon: Sparkles, description: "管理技能标签与熟练度" },
    ],
  },
  {
    label: "外观与功能",
    icon: Palette,
    items: [
      { id: "theme", label: "主题与壁纸", icon: Palette, description: "配置背景壁纸、主题模式与整体视觉氛围" },
      { id: "music", label: "音乐设置", icon: Music, description: "配置音乐播放器的歌单来源与播放平台" },
      { id: "weather", label: "天气设置", icon: CloudSun, description: "配置天气组件的城市与展示样式" },
    ],
  },
  {
    label: "系统设置",
    icon: ShieldCheck,
    items: [
      { id: "account", label: "账号与安全", icon: Settings, description: "修改登录密码与账号安全选项" },
    ],
  },
  {
    label: "运维与统计",
    icon: Wrench,
    items: [
      { id: "stats", label: "访问统计", icon: BarChart3, description: "查看访问数据与趋势" },
      { id: "logs", label: "操作日志", icon: ScrollText, description: "查看系统操作记录与审计日志" },
      { id: "health", label: "服务状态", icon: Activity, description: "监控服务运行状态与健康指标" },
      { id: "data", label: "数据管理", icon: Database, description: "备份与恢复站点数据" },
      { id: "media", label: "媒体库", icon: Images, description: "集中管理上传的图片资源" },
      { id: "update", label: "系统更新", icon: Rocket, description: "检测并更新站点版本、查看日志与回滚" },
    ],
  },
];

// 扁平化 TABS 用于兼容现有逻辑
const TABS: TabItem[] = NAV_GROUPS.flatMap((g) => g.items);

// 侧边栏导航项：模块级 memo 组件，避免在 AdminPage 内联定义导致每次渲染重建组件类型
const NavItem = memo(function NavItem({
  tab,
  active,
  onSelect,
}: {
  tab: TabItem;
  active: boolean;
  onSelect: (id: TabId) => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      onClick={() => onSelect(tab.id)}
      aria-current={active ? "page" : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ease-out ${
        active
          ? "bg-primary/10 text-primary font-semibold"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {/* 激活态左侧竖线指示器 */}
      <span
        className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200 ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
        }`}
      />
      <Icon
        className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
          active ? "scale-110" : "group-hover:scale-105"
        }`}
      />
      <span className="truncate">{tab.label}</span>
    </button>
  );
});

// 侧边栏品牌区：模块级组件（避免每次渲染重建类型），接收 username 与 compact 控制紧凑布局
function BrandHeader({ username, compact = false }: { username: string; compact?: boolean }) {
  return (
    <div className="relative overflow-hidden">
      {/* 顶部渐变装饰条 */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-violet-500 to-fuchsia-500" />
      <div
        className={`relative flex items-center gap-3 border-b px-5 ${
          compact ? "py-4" : "px-6 py-5"
        }`}
      >
        {/* 品牌 Logo */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-600 text-white shadow-md shadow-primary/20">
          <LayoutDashboard className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            个人主页后台
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {username}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 面板懒加载时的占位（每个面板各自独立，互不影响） */
function PanelLoading() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">正在加载面板...</p>
    </div>
  );
}

/**
 * 面板插槽：每个面板拥有**独立的 Suspense 边界**。
 *
 * 这里必须一个面板一个边界，不能共用一个外层 Suspense：
 * 首次进入某个懒加载面板时它会挂起（chunk 未加载），共用边界会让 React
 * 隐藏并重置其余已挂载面板的副作用与状态 —— 表现就是「切个选项卡，刚才改的
 * 内容全没了」，后台全局保存也就无从谈起。
 */
function PanelSlot({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={active ? "" : "hidden"}>
      <Suspense fallback={<PanelLoading />}>{children}</Suspense>
    </div>
  );
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  // 移动端抽屉侧边栏开关
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // 默认账号改密提示（本次会话内可关闭）
  const [hideDefaultWarning, setHideDefaultWarning] = useState(false);
  // 站点首页地址：通过 State 管理，服务端默认空字符串防 hydration 不匹配；客户端用 window.location.origin 兜底
  const [homepageUrl, setHomepageUrl] = useState("");
  // 已访问过的面板 tab 集合
  // 切换回来时保留表单输入/滚动/数据等全部状态，避免重复请求与重渲染
  // 【Critical 修复】初始化包含 "profile"，否则首次打开后台看不到任何面板
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(new Set(["profile"]));
  // 移动端抽屉：开启时把焦点移入关闭按钮，关闭后归还给菜单按钮（键盘可达性）
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const navCloseRef = useRef<HTMLButtonElement>(null);

  // 抽屉键盘支持：Esc 关闭并把焦点还给触发按钮
  useEffect(() => {
    if (!mobileNavOpen) return;
    navCloseRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileNavOpen(false);
        navToggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  // 切换分类：桌面端直接切换；移动端切换后关闭抽屉
  // 目标 tab 首次被选中即标记为已挂载，此后切换回来不再重载
  // 用 useCallback 稳定引用，配合 memo 的 NavItem 避免侧边栏整组重渲染
  const selectTab = useCallback((id: TabId) => {
    setActiveTab(id);
    setMountedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setMobileNavOpen(false);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHomepageUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadProfile()
      .then((d) => {
        if (!cancelled && d?.siteUrl) setHomepageUrl(d.siteUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyHomepage() {
    try {
      await navigator.clipboard.writeText(homepageUrl || window?.location.origin || "");
      toast.success("主页地址已复制");
    } catch {
      toast.error("复制失败，请重试");
    }
  }

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/admin/login");
    }
  }, [status, router]);

  useEffect(() => {
    document.title = "后台管理 · 个人主页";
  }, []);

  // 【Critical 修复】初始激活的 profile 面板已在 mountedTabs 初始化时标记，无需额外 useEffect

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return null;
  }

  const username = session?.user?.name || "管理员";
  const currentTab = TABS.find((t) => t.id === activeTab);

  // 侧边栏品牌区组件（模块级，避免每次渲染重建类型）
  // 接收 username 与 compact 控制紧凑布局

  return (
    <main className="admin min-h-screen bg-background">
      {/* 移动端纵向排列（顶栏在上），桌面端横向排列（侧边栏在左） */}
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* ===== 桌面端：左侧固定侧边导航 ===== */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card/70 backdrop-blur-sm md:flex">
          <BrandHeader username={username} />

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {NAV_GROUPS.map((group) => {
              const GroupIcon = group.icon;
              return (
                <div key={group.label} className="space-y-1">
                  {/* 分组标题 */}
                  <div className="flex items-center gap-2 px-3 pb-1.5">
                    <GroupIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                      {group.label}
                    </span>
                  </div>
                  {/* 分组下的导航项 */}
                  <div className="space-y-0.5">
                    {group.items.map((tab) => (
                      <NavItem key={tab.id} tab={tab} active={activeTab === tab.id} onSelect={selectTab} />
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="space-y-2 border-t p-3">
            <a
              href={homepageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
              打开主页
            </a>
            <Button
              variant="outline"
              size="sm"
              className="w-full transition-all duration-200 hover:border-error/40 hover:bg-error/10 hover:text-error"
              onClick={() => signOut({ callbackUrl: "/admin/login" })}
            >
              <LogOut className="mr-2 h-4 w-4" />
              退出登录
            </Button>
          </div>
        </aside>

        {/* ===== 移动端：顶栏 + 抽屉侧边导航 ===== */}
        {/* 顶部栏 */}
        <header className="sticky top-0 z-30 flex w-full shrink-0 items-center justify-between border-b bg-background/90 px-3 py-2.5 backdrop-blur-md md:hidden">
          <button
            ref={navToggleRef}
            onClick={() => setMobileNavOpen(true)}
            aria-label="打开菜单"
            aria-haspopup="dialog"
            aria-expanded={mobileNavOpen}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-600 text-white shadow-sm">
              <LayoutDashboard className="h-3.5 w-3.5" />
            </div>
            <h1 className="text-sm font-semibold tracking-tight">个人主页后台</h1>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/admin/login" })}
            aria-label="退出登录"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </header>

        {/* 抽屉遮罩：鼠标点击的便捷关闭入口；键盘关闭走 Esc 或抽屉内的关闭按钮，
            因此对辅助技术隐藏，避免被读成无意义的可交互元素 */}
        {mobileNavOpen && (
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* 抽屉侧边栏 */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="后台导航菜单"
          inert={!mobileNavOpen}
          className={`fixed inset-y-0 left-0 z-50 w-64 transform shadow-2xl transition-transform duration-300 ease-out md:hidden ${
            mobileNavOpen
              ? "translate-x-0 pointer-events-auto"
              : "-translate-x-full pointer-events-none"
          }`}
        >
          <div className="flex h-full flex-col border-r bg-card">
            <div className="flex items-center justify-between">
              <BrandHeader username={username} compact />
              <button
                ref={navCloseRef}
                onClick={() => {
                  setMobileNavOpen(false);
                  navToggleRef.current?.focus();
                }}
                aria-label="关闭菜单"
                className="mr-3 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
              {NAV_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.label} className="space-y-1">
                    <div className="flex items-center gap-2 px-3 pb-1.5">
                      <GroupIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                        {group.label}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((tab) => (
                        <NavItem key={tab.id} tab={tab} active={activeTab === tab.id} onSelect={selectTab} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </nav>

            <div className="space-y-2 border-t p-3">
              <a
                href={homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileNavOpen(false)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
                打开主页
              </a>
              <Button
                variant="outline"
                size="sm"
                className="w-full transition-all duration-200 hover:border-error/40 hover:bg-error/10 hover:text-error"
                onClick={() => {
                  setMobileNavOpen(false);
                  signOut({ callbackUrl: "/admin/login" });
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </Button>
            </div>
          </div>
        </aside>

        {/* ===== 内容区 ===== */}
        <div className="min-w-0 flex-1">
          <div className="mx-auto max-w-4xl px-4 py-6 pb-16 md:px-8 md:py-8">
            {/* 强制改密提示：mustChangePassword 为 true 时显示；改密成功后（后端置 false）自动消失 */}
            {session?.user?.mustChangePassword && !hideDefaultWarning && (
              <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3.5 text-sm text-warning shadow-sm backdrop-blur">
                <p className="leading-relaxed">
                  当前登录账号 <strong className="font-semibold">{username}</strong> 仍在使用默认密码，存在被暴力破解的风险，请尽快前往「账号设置」修改密码。
                </p>
                <button
                  type="button"
                  onClick={() => setHideDefaultWarning(true)}
                  className="shrink-0 font-medium underline underline-offset-2 transition-opacity hover:opacity-70"
                  aria-label="关闭提示"
                >
                  知道了
                </button>
              </div>
            )}

            {/* 页面标题头 */}
            {currentTab && (
              <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    {(() => {
                      const Icon = currentTab.icon;
                      return <Icon className="h-5 w-5" />;
                    })()}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">
                      {currentTab.label}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {currentTab.description}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyHomepage}
                  className="gap-1.5 text-muted-foreground"
                >
                  <Copy className="h-4 w-4" />
                  复制主页地址
                </Button>
              </div>
            )}

            {/* 内容面板：已访问过的面板全部保持挂载，未激活的用 CSS 隐藏。
                每个面板各自一个 Suspense 边界按需加载 chunk —— 共用边界会让「首次进入某个面板」
                挂起时重置其它面板的状态，导致未保存的改动丢失。切换回来状态/滚动/输入全部保留，零重载 */}
            <div className="transition-opacity duration-300">
              {mountedTabs.has("profile") && (
                <PanelSlot active={activeTab === "profile"}>
                  <ProfilePanel />
                </PanelSlot>
              )}
              {mountedTabs.has("theme") && (
                <PanelSlot active={activeTab === "theme"}>
                  <ThemePanel />
                </PanelSlot>
              )}
              {mountedTabs.has("music") && (
                <PanelSlot active={activeTab === "music"}>
                  <MusicPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("links") && (
                <PanelSlot active={activeTab === "links"}>
                  <LinksManager />
                </PanelSlot>
              )}
              {mountedTabs.has("weather") && (
                <PanelSlot active={activeTab === "weather"}>
                  <WeatherPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("announcements") && (
                <PanelSlot active={activeTab === "announcements"}>
                  <AnnouncementPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("account") && (
                <PanelSlot active={activeTab === "account"}>
                  <AccountPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("logs") && (
                <PanelSlot active={activeTab === "logs"}>
                  <OperationLogPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("health") && (
                <PanelSlot active={activeTab === "health"}>
                  <HealthPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("data") && (
                <PanelSlot active={activeTab === "data"}>
                  <DataPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("stats") && (
                <PanelSlot active={activeTab === "stats"}>
                  <StatsPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("media") && (
                <PanelSlot active={activeTab === "media"}>
                  <MediaPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("update") && (
                <PanelSlot active={activeTab === "update"}>
                  <UpdatePanel />
                </PanelSlot>
              )}
              {mountedTabs.has("projects") && (
                <PanelSlot active={activeTab === "projects"}>
                  <ProjectsPanel />
                </PanelSlot>
              )}
              {mountedTabs.has("skills") && (
                <PanelSlot active={activeTab === "skills"}>
                  <SkillsPanel />
                </PanelSlot>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
