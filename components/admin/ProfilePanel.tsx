"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { DEFAULT_WELCOME_MESSAGES, DEFAULT_SITE_TITLE, DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_KEYWORDS } from "@/lib/validation";
import { Eye, EyeOff } from "lucide-react";
import { PanelLoading } from "./panel";
import { loadProfile, setCachedProfile, hasCachedProfile, profileFieldPatch, selectClass } from "./profileShared";
import { useGlobalSaveState, useRegisterSave, useEditRevision, type SaveOutcome } from "./GlobalSave";
import UploadButton from "./UploadButton";

interface Profile {
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
  // 天气配置（统一通过 /api/profile 读写，与 WeatherPanel 共享同一数据源）
  weatherProvider: string;
  amapKey: string;
  amapSecretKey: string;
  txWeatherKey: string;
  txWeatherSk: string;
  weatherCity: string;
}

const INITIAL: Profile = {
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
  useRandomAvatar: false,
  welcomeEnabled: true,
  welcomeIndex: 0,
  welcomeMessages: JSON.stringify(DEFAULT_WELCOME_MESSAGES),
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
  // 天气配置（与 profileShared INITIAL_PROFILE 保持一致）
  weatherProvider: "tencent",
  amapKey: "",
  amapSecretKey: "",
  txWeatherKey: "",
  txWeatherSk: "",
  weatherCity: "",
};

const TIME_FORMATS = [
  { value: "24", label: "24 小时制" },
  { value: "12", label: "12 小时制" },
];

// 一言类型（与 v1.hitokoto.cn 的 c 参数对应）
const HITOKOTO_TYPES = [
  { value: "", label: "随机（不限制类型）" },
  { value: "a", label: "动画" },
  { value: "b", label: "漫画" },
  { value: "c", label: "游戏" },
  { value: "d", label: "文学" },
  { value: "e", label: "原创" },
  { value: "f", label: "来自网络" },
  { value: "g", label: "其他" },
  { value: "h", label: "影视" },
  { value: "i", label: "诗词" },
  { value: "j", label: "网易云音乐" },
  { value: "k", label: "哲学" },
  { value: "l", label: "抖机灵" },
];

const DATE_FORMAT_PRESETS = [
  { value: "YYYY年M月D日 dddd", label: "2026年8月22日 周六" },
  { value: "YYYY年MM月DD日 dddd", label: "2026年08月22日 周六" },
  { value: "YYYY-MM-DD dddd", label: "2026-08-22 周六" },
  { value: "MM月DD日 dddd", label: "08月22日 周六" },
  { value: "YYYY/M/D dddd", label: "2026/8/22 周六" },
];

// 原生 select 统一样式见 profileShared（此处不再重复定义，避免两处样式漂移）

export default function ProfilePanel() {
  const [profile, setProfile] = useState<Profile>(INITIAL);
  const [loading, setLoading] = useState(!hasCachedProfile());
  const [saving, setSaving] = useState(false);
  // 是否存在未保存的修改：控制右下角悬浮保存按钮的显隐
  const [dirty, setDirty] = useState(false);
  // 载入时的基线快照：用于向全局保存上报「本面板改动了哪些字段」
  const baselineRef = useRef<Profile | null>(null);
  const { markEdited, isStale, currentRevision } = useEditRevision();
  // 全局保存进行中：提示统一由注册中心汇总，面板内不再重复弹
  const { saving: globalSaving } = useGlobalSaveState();
  const formRef = useRef<HTMLFormElement>(null);
  // 天气配置密码可见性切换
  const [showAmapKey, setShowAmapKey] = useState(false);
  const [showAmapSecretKey, setShowAmapSecretKey] = useState(false);
  const [showTxWeatherKey, setShowTxWeatherKey] = useState(false);
  const [showTxWeatherSk, setShowTxWeatherSk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadProfile()
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setProfile(data);
          baselineRef.current = data;
        } else toast.error("加载数据失败");
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // 欢迎语数组：JSON 字符串 <-> 数组双向维护（Hook 须在条件 return 前调用）
  const welcomeList = useMemo(() => {
    try {
      const arr = JSON.parse(profile.welcomeMessages);
      return Array.isArray(arr) && arr.length ? arr : DEFAULT_WELCOME_MESSAGES.slice();
    } catch {
      return DEFAULT_WELCOME_MESSAGES.slice();
    }
  }, [profile.welcomeMessages]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // 以服务端最新配置为基线，只提交本面板改动过的字段：
      // 直接 PUT 本地整份快照会把主题/音乐面板已保存的字段覆盖回旧值
      const patch = profileFieldPatch(profile, baselineRef.current);
      // 记录提交时刻的修订号：请求往返期间用户仍可能继续编辑
      const savedRevision = currentRevision();
      const base = await loadProfile(true);
      if (!base) {
        toast.error("读取站点配置失败，请刷新后重试");
        return;
      }
      const payload = { ...base, ...patch } as Profile;
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setCachedProfile(payload);
        // 基线推进到「已落库的内容」，无论期间是否有新改动都成立
        baselineRef.current = payload;
        if (isStale(savedRevision)) {
          // 保存期间又有新改动：保留本地输入与脏标记，等用户再存一次
          if (!globalSaving) toast.warning("已保存，但保存期间又有新的修改，请再次保存");
          return;
        }
        setProfile(payload);
        toast.success("保存成功");
        setDirty(false);
      } else toast.error("保存失败");
    } catch {
      toast.error("网络错误");
    } finally {
      setSaving(false);
    }
  }

  /** 全局保存合并提交后的收尾：只在「提交期间没有新改动」时才清脏标记 */
  const applySaveOutcome = ({ revision, payload }: SaveOutcome) => {
    const saved = (payload ?? profile) as Profile;
    baselineRef.current = saved;
    if (isStale(revision)) return; // 期间又有新改动：保留本地输入与脏标记
    setProfile(saved);
    setDirty(false);
  };

  // 接入全局保存：仅上报本面板改动过的字段，避免与主题/音乐面板互相覆盖
  useRegisterSave({
    id: "profile",
    label: "站点信息",
    dirty,
    profilePatch: () => profileFieldPatch(profile, baselineRef.current),
    revision: currentRevision,
    markClean: applySaveOutcome,
    validate: undefined,
  });

  if (loading) {
    return <PanelLoading />;
  }

  // TSX 中泛型箭头函数需加尾逗号，避免被解析为 JSX；
  // 任何字段变更都标记 dirty（并推进编辑修订号），驱动右下角悬浮保存按钮浮现
  const set = <K extends keyof Profile,>(key: K, value: Profile[K]) => {
    // 用函数式更新：同一事件里连续两次 set 不会因为闭包里的旧值而互相覆盖
    setProfile((prev) => ({ ...prev, [key]: value }));
    markEdited();
    setDirty(true);
  };

  function setWelcomeItem(idx: number, value: string) {
    const next = welcomeList.slice();
    next[idx] = value;
    set("welcomeMessages", JSON.stringify(next));
  }

  function addWelcomeItem() {
    if (welcomeList.length >= 20) return;
    set("welcomeMessages", JSON.stringify([...welcomeList, ""]));
  }

  function removeWelcomeItem(idx: number) {
    if (welcomeList.length <= 1) return;
    const next = welcomeList.filter((_, i) => i !== idx);
    set("welcomeMessages", JSON.stringify(next));
    // 删除当前选中项前的句子时，选中下标前移保持指向不变
    if (profile.welcomeIndex > idx) set("welcomeIndex", profile.welcomeIndex - 1);
    else if (profile.welcomeIndex >= next.length) set("welcomeIndex", next.length - 1);
  }

  return (
    <Card>
      {/* 页面级标题头由 admin/page.tsx 提供，卡内不再重复标题 */}
      <CardContent>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-3 pb-16">
          {/* ========== 基础信息 ========== */}
          <details open className="group overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3.5 font-medium transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden list-none">
              <span className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                <span className="text-sm font-semibold tracking-tight">站点资料</span>
                <span className="text-xs font-normal text-muted-foreground">基本信息 · 欢迎通知 · SEO 配置</span>
              </span>
              <svg className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </summary>
            <div className="space-y-5 border-t px-5 py-5">
              {/* ---- 基本信息 ---- */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">基本信息</h4>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="avatar">头像 URL</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="avatar"
                        value={profile.avatar}
                        onChange={(e) => set("avatar", e.target.value)}
                        placeholder="https://example.com/avatar.png"
                      />
                      <UploadButton onUploaded={(url) => set("avatar", url)} label="上传" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="siteIcon">网站图标 URL</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="siteIcon"
                        value={profile.siteIcon}
                        onChange={(e) => set("siteIcon", e.target.value)}
                        placeholder="留空使用默认图标"
                      />
                      {profile.siteIcon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.siteIcon}
                          alt="网站图标预览"
                          className="h-8 w-8 shrink-0 rounded object-contain ring-1 ring-border"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.opacity = "0.3";
                          }}
                        />
                      )}
                      <UploadButton onUploaded={(url) => set("siteIcon", url)} label="上传" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      浏览器标签页 / 收藏夹图标（支持 png / svg / ico）
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nickname">昵称</Label>
                  <Input
                    id="nickname"
                    value={profile.nickname}
                    onChange={(e) => set("nickname", e.target.value)}
                    placeholder="你的昵称"
                  />
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-input bg-background/50 px-3 py-2.5 transition-colors hover:bg-muted/30" htmlFor="logoArtFont">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">艺术字体显示</span>
                      <span className="text-xs text-muted-foreground">昵称使用手写艺术字体</span>
                    </span>
                    <input
                      id="logoArtFont"
                      type="checkbox"
                      name="logoArtFont"
                      checked={profile.logoArtFont}
                      onChange={(e) => set("logoArtFont", e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-input bg-background/50 px-3 py-2.5 transition-colors hover:bg-muted/30" htmlFor="loadingScreen">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">全屏加载动画</span>
                      <span className="text-xs text-muted-foreground">首页三环旋转加载</span>
                    </span>
                    <input
                      id="loadingScreen"
                      type="checkbox"
                      name="loadingScreen"
                      checked={profile.loadingScreen}
                      onChange={(e) => set("loadingScreen", e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    内置艺术字体：有爱圆体（中英双语），随镜像打包
                  </p>
                </div>

                <div className="mt-4 space-y-3">
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-input bg-background/50 px-3 py-2.5 transition-colors hover:bg-muted/30" htmlFor="customFontEnabled">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">自定义字体</span>
                      <span className="text-xs text-muted-foreground">输入系统/网络字体名，无需重新构建</span>
                    </span>
                    <input
                      id="customFontEnabled"
                      type="checkbox"
                      name="customFontEnabled"
                      checked={profile.customFontEnabled}
                      onChange={(e) => set("customFontEnabled", e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>

                  {profile.customFontEnabled && (
                    <>
                      <div>
                        <Label htmlFor="customFontFamily">字体名称（CSS font-family）</Label>
                        <input
                          id="customFontFamily"
                          name="customFontFamily"
                          className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder='如 "PingFang SC"、Microsoft YaHei'
                          value={profile.customFontFamily}
                          onChange={(e) => set("customFontFamily", e.target.value)}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          仅支持中英文、数字、空格、引号与连字符；浏览器无此字体时自动回退思源黑体
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="customFontScope">应用范围</Label>
                        <select
                          id="customFontScope"
                          name="customFontScope"
                          className={selectClass}
                          value={profile.customFontScope}
                          onChange={(e) => set("customFontScope", e.target.value)}
                        >
                          <option value="nickname">仅昵称</option>
                          <option value="all">全站</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

                {/* 特效与功能开关组（2 列紧凑排列） */}
                <div className="grid gap-2 md:grid-cols-2">
                  {(
                    [
                      {
                        key: "clickEffect" as const,
                        title: "点击粒子特效",
                        desc: "点击页面绽放彩色粒子",
                      },
                      {
                        key: "consoleEgg" as const,
                        title: "控制台彩蛋",
                        desc: "DevTools 显示 ASCII 艺术字",
                      },
                      {
                        key: "showStats" as const,
                        title: "站点访问统计",
                        desc: "关闭后停止上报，页脚也不显示数字",
                      },
                      {
                        key: "dynamicTitle" as const,
                        title: "动态页面标题",
                        desc: "标签页显示问候语与歌名",
                      },
                      {
                        key: "topProgressBar" as const,
                        title: "顶部音乐进度条",
                        desc: "页面顶部可拖拽播放进度",
                      },
                      {
                        key: "seasonalEffectEnabled" as const,
                        title: "季节装饰特效",
                        desc: "萤火虫/雪花/灯笼（按月份自动切换）",
                      },
                      {
                        key: "commandPalette" as const,
                        title: "命令面板 (Ctrl/Cmd+K)",
                        desc: "快捷键呼出全局搜索与执行面板（关闭后可释放该快捷键给 Chrome DevTools 等工具使用）",
                      },
                      {
                        key: "useRandomAvatar" as const,
                        title: "随机头像",
                        desc: "每次刷新使用随机头像",
                      },
                    ] as { key: keyof Profile; title: string; desc: string }[]
                  ).map((item) => (
                    <label
                      key={item.key}
                      htmlFor={item.key}
                      className="flex cursor-pointer items-center justify-between rounded-lg border border-input bg-background/50 px-3 py-2.5 transition-colors hover:bg-muted/30"
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{item.desc}</span>
                      </span>
                      <input
                        id={item.key}
                        type="checkbox"
                        name={item.key}
                        checked={profile[item.key] as boolean}
                        onChange={(e) => set(item.key, e.target.checked as Profile[typeof item.key])}
                        className="h-4 w-4 accent-primary"
                      />
                    </label>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio">个性签名</Label>
                  <Textarea
                    id="bio"
                    value={profile.bio}
                    onChange={(e) => set("bio", e.target.value)}
                    placeholder="一句话介绍自己"
                    rows={2}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  GitHub、邮箱等主页入口请在「链接管理 → 社交链接」中添加，避免与站点信息重复配置。
                </p>
              </div>

              {/* ---- 欢迎通知 ---- */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">欢迎通知</h4>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-input bg-background/50 px-3 py-2.5 transition-colors hover:bg-muted/30" htmlFor="welcomeEnabled">
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">顶部居中欢迎消息</span>
                    <span className="text-xs text-muted-foreground">
                      页面加载后顶部展示欢迎语（同一会话仅显示一次）
                    </span>
                  </span>
                  <input
                    id="welcomeEnabled"
                    type="checkbox"
                    name="welcomeEnabled"
                    checked={profile.welcomeEnabled}
                    onChange={(e) => set("welcomeEnabled", e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                </label>

                <div className="space-y-2">
                  <Label>欢迎语列表</Label>
                  <div className="space-y-2">
                    {welcomeList.map((msg, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <label
                          htmlFor={`welcome-radio-${idx}`}
                          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
                          title="选择页面展示这句"
                        >
                          <input
                            id={`welcome-radio-${idx}`}
                            type="radio"
                            name="welcomeIndex"
                            value={idx}
                            checked={profile.welcomeIndex === idx}
                            onChange={() => set("welcomeIndex", idx)}
                            className="h-4 w-4 accent-primary"
                          />
                          第 {idx + 1} 句
                        </label>
                        <Input
                          id={`welcome-message-${idx}`}
                          name={`welcome-message-${idx}`}
                          value={msg}
                          onChange={(e) => setWelcomeItem(idx, e.target.value)}
                          placeholder="输入欢迎语，支持 {siteName} 占位符"
                        />
                        <button
                          type="button"
                          onClick={() => removeWelcomeItem(idx)}
                          disabled={welcomeList.length <= 1}
                          className="shrink-0 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addWelcomeItem}
                    disabled={welcomeList.length >= 20}
                  >
                    + 添加欢迎语
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    勾选第 N 句即表示页面展示该句；{`{siteName}`} 占位符会替换为站点昵称
                  </p>
                </div>
              </div>

              {/* ---- SEO 配置 ---- */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SEO 配置</h4>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                <p className="text-xs text-muted-foreground">
                  后台配置后立即替换标签页标题与搜索引擎描述，无需重新构建
                </p>

                <div className="space-y-2">
                  <Label htmlFor="siteTitle">站点标题</Label>
                  <Input
                    id="siteTitle"
                    value={profile.siteTitle}
                    onChange={(e) => set("siteTitle", e.target.value)}
                    placeholder={`留空使用默认「${DEFAULT_SITE_TITLE}」`}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="siteDescription">站点描述</Label>
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => set("siteDescription", DEFAULT_SITE_DESCRIPTION)}
                    >
                      填入默认描述
                    </button>
                  </div>
                  <Textarea
                    id="siteDescription"
                    value={profile.siteDescription}
                    onChange={(e) => set("siteDescription", e.target.value)}
                    placeholder={DEFAULT_SITE_DESCRIPTION}
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    用于搜索引擎收录；留空则自动使用上面这句默认描述
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="siteKeywords">站点关键词</Label>
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => set("siteKeywords", DEFAULT_SITE_KEYWORDS)}
                    >
                      填入默认关键词
                    </button>
                  </div>
                  <Input
                    id="siteKeywords"
                    value={profile.siteKeywords}
                    onChange={(e) => set("siteKeywords", e.target.value)}
                    placeholder={DEFAULT_SITE_KEYWORDS}
                  />
                  <p className="text-xs text-muted-foreground">逗号分隔；留空使用默认关键词</p>
                </div>
              </div>
            </div>
          </details>

          {/* ========== 内容展示 ========== */}
          <details className="group overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3.5 font-medium transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden list-none">
              <span className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span className="text-sm font-semibold tracking-tight">内容展示</span>
                <span className="text-xs font-normal text-muted-foreground">时钟 · 一言</span>
              </span>
              <svg className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </summary>
            <div className="space-y-5 border-t px-5 py-5">
              {/* ---- 时钟与一言 ---- */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">时钟与一言</h4>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="timeFormat">时钟格式</Label>
                    <select
                      id="timeFormat"
                      className={selectClass}
                      value={profile.timeFormat}
                      onChange={(e) => set("timeFormat", e.target.value)}
                    >
                      {TIME_FORMATS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-input bg-background/50 px-3 py-2.5 transition-colors hover:bg-muted/30" htmlFor="showSeconds">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">显示秒数</span>
                      <span className="text-xs text-muted-foreground">时钟是否显示秒</span>
                    </span>
                    <input
                      id="showSeconds"
                      type="checkbox"
                      name="showSeconds"
                      checked={profile.showSeconds}
                      onChange={(e) => set("showSeconds", e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dateFormat">日期格式</Label>
                  <select
                    id="dateFormat"
                    className={selectClass}
                    value={profile.dateFormat}
                    onChange={(e) => set("dateFormat", e.target.value)}
                  >
                    {DATE_FORMAT_PRESETS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    {!DATE_FORMAT_PRESETS.some((o) => o.value === profile.dateFormat) && (
                      <option value={profile.dateFormat}>自定义：{profile.dateFormat}</option>
                    )}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    支持占位符：YYYY 年 / YY 两位年 / MM / M / DD / D / dddd 中文星期
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hitokotoType">一言类型</Label>
                  <select
                    id="hitokotoType"
                    className={selectClass}
                    value={profile.hitokotoType}
                    onChange={(e) => set("hitokotoType", e.target.value)}
                  >
                    {HITOKOTO_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    指定类型后优先从 hitokoto.cn 获取对应分类句子
                  </p>
                </div>
              </div>
            </div>
          </details>

          {/* ========== 网站链接区 ========== */}
          <details className="group overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3.5 font-medium transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden list-none">
              <span className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]" />
                <span className="text-sm font-semibold tracking-tight">网站链接区</span>
                <span className="text-xs font-normal text-muted-foreground">区域标题 · 图标库地址</span>
              </span>
              <svg className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </summary>
            <div className="space-y-5 border-t px-5 py-5">
              {/* ---- 网站链接区 ---- */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">网站链接区</h4>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="siteLinksTitle">网站标签标题</Label>
                    <Input
                      id="siteLinksTitle"
                      value={profile.siteLinksTitle}
                      onChange={(e) => set("siteLinksTitle", e.target.value)}
                      placeholder="我的网站"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="friendLinksTitle">友情标签标题</Label>
                    <Input
                      id="friendLinksTitle"
                      value={profile.friendLinksTitle}
                      onChange={(e) => set("friendLinksTitle", e.target.value)}
                      placeholder="友情链接"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  两个标题合并为区域大标题展示，如「我的网站 / 友情链接」；仅某类有数据时只显示对应的标题
                </p>

                <div className="space-y-2">
                  <Label htmlFor="siteLinksIcon">标题图标</Label>
                  <Input
                    id="siteLinksIcon"
                    value={profile.siteLinksIcon}
                    onChange={(e) => set("siteLinksIcon", e.target.value)}
                    placeholder="link"
                  />
                  <p className="text-xs text-muted-foreground">
                    显示在「我的网站」标签文字前。支持 lucide 图标名（如 link / globe）、
                    iconfont symbol 名，或图片地址（http(s) 外链 / 媒体库路径）；留空则不显示图标。
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="iconfontUrl">图标库地址（阿里云矢量图标库）</Label>
                  <Input
                    id="iconfontUrl"
                    value={profile.iconfontUrl}
                    onChange={(e) => set("iconfontUrl", e.target.value)}
                    placeholder="https://at.alicdn.com/t/c/font_xxxx_xxxx.js"
                  />
                  <p className="text-xs text-muted-foreground">
                    在 iconfont.cn 创建项目 → 添加图标 → 选择「Symbol」模式 → 复制生成的 JS 链接填入。
                    配置后，社交链接与网站链接的图标输入框旁会出现「从图标库选择」按钮，可挑选图标。
                    留空则仅使用内置 lucide 图标。
                  </p>
                </div>
              </div>
            </div>
          </details>

          {/* ========== 页脚与脚本 ========== */}
          <details className="group overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3.5 font-medium transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden list-none">
              <span className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                <span className="text-sm font-semibold tracking-tight">页脚与脚本</span>
                <span className="text-xs font-normal text-muted-foreground">页脚信息 · 统计与脚本</span>
              </span>
              <svg className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </summary>
            <div className="space-y-5 border-t px-5 py-5">
              {/* ---- 页脚 ---- */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">页脚</h4>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="siteUrl">站点地址</Label>
                  <Input
                    id="siteUrl"
                    value={profile.siteUrl}
                    onChange={(e) => set("siteUrl", e.target.value)}
                    placeholder="https://your-domain.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    用于站点 SEO：生成 canonical 链接、网页分享卡片（OpenGraph）地址与站点地图（sitemap）。
                    页脚版权信息中的作者名固定指向项目作者主页，如需修改请编辑源码。
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="siteIcp">ICP 备案号</Label>
                    <Input
                      id="siteIcp"
                      value={profile.siteIcp}
                      onChange={(e) => set("siteIcp", e.target.value)}
                      placeholder="京ICP备XXXXXXXX号"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="siteMps">公安备案号</Label>
                    <Input
                      id="siteMps"
                      value={profile.siteMps}
                      onChange={(e) => set("siteMps", e.target.value)}
                      placeholder="苏公网安备XXXXXXXX号"
                    />
                    <p className="text-xs text-muted-foreground">
                      填写后显示带盾牌图标的公安备案链接
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="siteStart">建站日期</Label>
                  <Input
                    id="siteStart"
                    type="date"
                    value={profile.siteStart}
                    onChange={(e) => set("siteStart", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    用于计算页脚「已运行 N 天」
                  </p>
                </div>

                <div>
                  <Label htmlFor="siteFooterHtml">页脚自定义 HTML</Label>
                  <Textarea
                    id="siteFooterHtml"
                    name="siteFooterHtml"
                    value={profile.siteFooterHtml}
                    onChange={(e) => set("siteFooterHtml", e.target.value)}
                    placeholder={'如 <a href="https://example.com">友链</a>'}
                    rows={3}
                    className="mt-1 font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    显示在页脚版权行上方，支持 HTML 标签（管理员可信内容）
                  </p>
                </div>
              </div>

              {/* ---- 统计与脚本 ---- */}
              <div className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/60" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">统计与脚本</h4>
                  <div className="h-px flex-1 bg-border/60" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="headScript" className="flex items-center justify-between">
                    <span>&lt;head&gt; 脚本注入</span>
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => set("headScript", "/* 清除 */")}
                    >
                      清除
                    </button>
                  </Label>
                  <Textarea
                    id="headScript"
                    value={profile.headScript}
                    onChange={(e) => set("headScript", e.target.value)}
                    placeholder="&#60;script src=&#34;https://example.com/analytics.js&#34;&#62;&#60;/script&#62;"
                    rows={3}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    将 HTML 代码片段插入到 &lt;head&gt; 标签结束前；通常用于广告追踪、统计脚本
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="analyticsScript" className="flex items-center justify-between">
                    <span>自定义分析脚本</span>
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => set("analyticsScript", "")}
                    >
                      清除
                    </button>
                  </Label>
                  <Textarea
                    id="analyticsScript"
                    value={profile.analyticsScript}
                    onChange={(e) => set("analyticsScript", e.target.value)}
                    placeholder="// 例如百度统计 / Google Analytics / Cloudflare Web Analytics 内联脚本"
                    rows={5}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    自定义分析脚本将注入到页面底部（&lt;/body&gt; 之前），支持匿名函数包裹的异步执行逻辑
                  </p>
                </div>

                {/* ---- 天气配置 ---- */}
                <div className="space-y-3.5">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border/60" />
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">天气配置</h4>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="weatherProvider">天气数据源</Label>
                    <select
                      id="weatherProvider"
                      value={profile.weatherProvider || "tencent"}
                      onChange={(e) => set("weatherProvider", e.target.value)}
                      className={selectClass}
                    >
                      <option value="tencent">腾讯天气（免费，需填城市）</option>
                      <option value="tencent-key">腾讯天气 Key 版（IP 定位 + 实况）</option>
                      <option value="amap">高德地图（Web 服务 API）</option>
                    </select>
                  </div>

                  {(profile.weatherProvider === "tencent-key" || profile.weatherProvider === "amap") && (
                    <>
                      <div className="space-y-2">
                        {profile.weatherProvider === "amap" ? (
                          <>
                            <Label htmlFor="amapKey">高德 Web 服务 API Key</Label>
                            <div className="relative">
                              <Input
                                id="amapKey"
                                type={showAmapKey ? "text" : "password"}
                                value={profile.amapKey || ""}
                                onChange={(e) => set("amapKey", e.target.value)}
                                placeholder="如 8a4f...（16 位十六进制）"
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowAmapKey((v) => !v)}
                                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                                aria-label={showAmapKey ? "隐藏 Key" : "显示 Key"}
                                tabIndex={-1}
                              >
                                {showAmapKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              前往{" "}
                              <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
                                高德开放平台
                              </a>{" "}
                              创建「Web 服务」类型的 Key
                            </p>
                          </>
                        ) : (
                          <>
                            <Label htmlFor="txWeatherKey">腾讯位置服务 Key</Label>
                            <div className="relative">
                              <Input
                                id="txWeatherKey"
                                type={showTxWeatherKey ? "text" : "password"}
                                value={profile.txWeatherKey || ""}
                                onChange={(e) => set("txWeatherKey", e.target.value)}
                                placeholder="如 JXVBZ-..."
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowTxWeatherKey((v) => !v)}
                                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                                aria-label={showTxWeatherKey ? "隐藏 Key" : "显示 Key"}
                                tabIndex={-1}
                              >
                                {showTxWeatherKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              前往{" "}
                              <a href="https://console.map.qq.com/" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
                                腾讯位置服务
                              </a>{" "}
                              创建 Key 并开通「WebServiceAPI」权限
                            </p>
                          </>
                        )}
                      </div>

                      <div className="space-y-2">
                        {profile.weatherProvider === "amap" ? (
                          <>
                            <Label htmlFor="amapSecretKey">高德私钥（签名密钥）</Label>
                            <div className="relative">
                              <Input
                                id="amapSecretKey"
                                type={showAmapSecretKey ? "text" : "password"}
                                value={profile.amapSecretKey || ""}
                                onChange={(e) => set("amapSecretKey", e.target.value)}
                                placeholder="Key 开启数字签名时填写，未开启可留空"
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowAmapSecretKey((v) => !v)}
                                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                                aria-label={showAmapSecretKey ? "隐藏私钥" : "显示私钥"}
                                tabIndex={-1}
                              >
                                {showAmapSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <Label htmlFor="txWeatherSk">腾讯位置服务密钥（SK）</Label>
                            <div className="relative">
                              <Input
                                id="txWeatherSk"
                                type={showTxWeatherSk ? "text" : "password"}
                                value={profile.txWeatherSk || ""}
                                onChange={(e) => set("txWeatherSk", e.target.value)}
                                placeholder="Key 开启数字签名时必填"
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowTxWeatherSk((v) => !v)}
                                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                                aria-label={showTxWeatherSk ? "隐藏密钥 SK" : "显示密钥 SK"}
                                tabIndex={-1}
                              >
                                {showTxWeatherSk ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Key 在控制台开启了「数字签名」时需填写对应的密钥（SK）；未开启签名可留空
                            </p>
                          </>
                        )}
                      </div>
                    </>
                  )}

                  {profile.weatherProvider === "tencent" && (
                    <div className="space-y-2">
                      <Label htmlFor="weatherCity">城市名称</Label>
                      <Input
                        id="weatherCity"
                        value={profile.weatherCity || ""}
                        onChange={(e) => set("weatherCity", e.target.value)}
                        placeholder="如 深圳、广州、北京"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        填写需要查询天气的城市名称，无需配置 Key
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </details>
        </form>
      </CardContent>
      <CardContent className="pt-0">
        <Button onClick={onSubmit} disabled={saving} type="button" className="w-full">
          {saving ? "保存中..." : "保存站点信息"}
        </Button>
      </CardContent>
    </Card>
  );
}
