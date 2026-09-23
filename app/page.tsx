import { prisma } from "@/lib/db";
import { DEFAULT_SITE_TITLE, DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_KEYWORDS } from "@/lib/validation";
import { cache } from "react";
import { Quote } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import Background from "@/components/Background";
import ClockWeatherCapsule from "@/components/ClockWeatherCapsule";
import SocialLinks from "@/components/SocialLinks";
import LinkTabs from "@/components/LinkTabs";
import CommandPalette from "@/components/CommandPalette";
import SkillCloud from "@/components/SkillCloud";
import ThemeProvider from "@/components/ThemeProvider";
import LogoFontLoader from "@/components/LogoFontLoader";
import { CustomFont, FaviconUpdater } from "@/components/DomEffects";
import ScriptInjector from "@/components/ScriptInjector";
import { IconfontScript } from "@/components/Iconfont";
import { MusicProviderLazy, MusicCardLazy } from "@/components/MusicPlayer";
import { DecorativeEffectsLazy } from "@/components/DecorativeEffects";
import pkg from "../package.json";
// 别名 nextDynamic：下方路由段配置需要占用 `dynamic` 这个名字（export const dynamic），
// 与 next/dynamic 的默认导出同名会冲突，故此处改名。
import nextDynamic from "next/dynamic";
// SSR: loading screen 必须渲染，保证首屏无白屏；客户端 hydrate 后自动由
// LoadingScreen 自身逻辑（等待 background-ready）控制收起。
const LoadingScreen = nextDynamic(() => import("@/components/LoadingScreen").then((m) => m.LoadingScreen), { ssr: true });
const SeasonalEffect = nextDynamic(() => import("@/components/SeasonalEffect"));
// 公告居中弹窗（非首屏必需，延迟加载减小首屏 JS）
const AnnouncementNotification = nextDynamic(() => import("@/components/AnnouncementNotification"), { ssr: true });
// 页脚懒加载：桌面端页脚在视口外，延迟加载减小首屏 JS
const FooterLazy = nextDynamic(() => import("@/components/Footer"), {
  ssr: true,
  loading: () => <div className="h-12" />,
});

/**
 * 按请求渲染（不预渲染）：首页数据全部来自运行时数据库，而生产库位于容器数据卷，
 * 构建期并不存在。若在构建期预渲染，Prisma 要么报错中断构建，要么渲染出空数据页，
 * 而这个空数据页会被写入镜像并作为缓存对外提供 —— 表现为「部署后首次访问卡片消失，
 * 刷新一下才出现」（需等 ISR 重新校验）。改为按请求渲染后每次读取真实数据。
 */
export const dynamic = "force-dynamic";

/** 从数据库加载站点信息（React cache：同一请求内 generateMetadata 与组件渲染共享一次查询）。
 *  失败重试一次；仍失败直接 throw，让该次请求明确暴露问题，
 *  而不是静默渲染出「卡片缺失」的残缺页。 */
const getProfile = cache(async () => {
  try {
    return await prisma.profile.findFirst({ orderBy: { id: "asc" } });
  } catch {
    await new Promise((r) => setTimeout(r, 300));
    return await prisma.profile.findFirst({ orderBy: { id: "asc" } });
  }
});

/** 动态 SEO 元信息：后台配置的标题/描述/关键词/站点地址（ISR 60s 缓存） */
export async function generateMetadata(): Promise<import("next").Metadata> {
  const profile = await getProfile();
  // 后台留空时回退到统一默认文案，保证搜索引擎不会抓到空描述 / 空关键词
  const siteTitle = profile?.siteTitle?.trim() || DEFAULT_SITE_TITLE;
  const siteDescription = profile?.siteDescription?.trim() || DEFAULT_SITE_DESCRIPTION;
  const siteKeywords = profile?.siteKeywords?.trim() || DEFAULT_SITE_KEYWORDS;
  const siteUrl = profile?.siteUrl?.trim().replace(/\/+$/, "");
  // 头像可能为空、相对上传路径或外链：仅当可拼出完整 URL 时才作为 OG 图片，避免产出损坏的分享卡片
  let ogImage;
  const avatar = profile?.avatar?.trim() || "";
  if (avatar) {
    const absoluteAvatar = /^https?:\/\//i.test(avatar)
      ? avatar
      : siteUrl && avatar.startsWith("/")
      ? `${siteUrl}${avatar}`
      : "";
    if (absoluteAvatar) ogImage = { url: absoluteAvatar, width: 512, height: 512, alt: siteTitle };
  }
  // siteUrl 必须为合法 http(s) 才注入 metadataBase/canonical，避免后台误填非法地址让整页抛错
  let metadataBase: URL | undefined;
  if (siteUrl) {
    try {
      const u = new URL(siteUrl);
      if (u.protocol === "http:" || u.protocol === "https:") metadataBase = u;
    } catch {
      metadataBase = undefined;
    }
  }
  return {
    title: siteTitle,
    description: siteDescription,
    ...(siteKeywords
      ? { keywords: siteKeywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean) }
      : {}),
    ...(metadataBase ? { metadataBase, alternates: { canonical: metadataBase.origin + metadataBase.pathname } } : {}),
    openGraph: {
      type: "website",
      siteName: siteTitle,
      url: siteUrl || undefined,
      title: siteTitle,
      description: siteDescription,
      locale: "zh_CN",
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: siteTitle,
      description: siteDescription,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

// ── 数据准备：默认值、头像解析、字体映射等逻辑已抽取到 hooks.ts ──
import { getHomeData } from "./hooks";
import { CURRENT_VERSION } from "@/lib/version";

export default async function Home() {
  const profile = await getProfile();
  const d = await getHomeData(profile);

  return (
    <ThemeProvider theme={d.theme} accentColor={d.accentColor} glassOpacity={d.glassOpacity} glassBlur={d.glassBlur}>
      {/* 音乐播放器 Provider：包住全站内容，提供播放状态与列表弹窗；控制面板内嵌于功能卡组（MusicCard） */}
      <MusicProviderLazy
        songApi={d.songApi}
        songServer={d.songServer}
        songId={d.songId}
        musicAutoplay={d.musicAutoplay}
      >
        {/* 桌面端 main 最小一屏高（md:min-h-dvh）：内容不足一屏时仍整体垂直居中，页脚贴底；
            内容超高（如并入技能云后）自然增长而非裁切，仅超高部分滚动。
            移动端 main 自然高度，页脚在内容后滚动出现 */}
        <main className="relative flex min-h-dvh w-full flex-col text-white">
        {process.env.NODE_ENV === "development" && pkg.author !== "sxlb" &&
          (() => { console.warn("[qiyun] 检测到作者信息已被修改，请保留 package.json 中的 author 版权标识"); return null; })()}
        <FaviconUpdater icon={d.siteIcon} />
        <ScriptInjector scripts={[d.headScript]} deferScripts={[d.analyticsScript]} />

        {/* 站点通知居中弹窗（欢迎 + 公告合并展示，fixed 定位，独立于页面流） */}
        <AnnouncementNotification
          welcomeEnabled={d.welcomeEnabled}
          siteName={d.nickname}
          welcomeMessages={d.welcomeMessages}
          welcomeIndex={d.welcomeIndex}
        />

        {/* 命令面板：Ctrl/Cmd+K 或 「/」唤起，搜索网站/友链快捷跳转（受后台开关控制） */}
        {d.commandPalette && (
          <CommandPalette
            siteLinks={d.siteLinks}
            friendLinks={d.friendLinks}
            siteTitle={d.siteLinksTitle}
            friendTitle={d.friendLinksTitle}
          />
        )}

        {/* 全屏加载动画：首屏必需，保持预加载（ssr:true） */}
        <LoadingScreen enabled={d.loadingScreen} siteName={d.nickname} />

        <DecorativeEffectsLazy
          clickEffect={d.clickEffect}
          consoleEgg={d.consoleEgg}
          dynamicTitle={d.dynamicTitle}
          topProgressBar={d.topProgressBar}
          siteName={d.nickname}
        />

        {/* SSR 阶段已解析壁纸直链：浏览器在 HTML 解析时即开始下载背景图（与 JS 并行），消除首屏等待 */}
        {d.wallpaperUrl && <link rel="preload" as="image" href={d.wallpaperUrl} fetchPriority="high" />}

        {/* 阿里云矢量图标库：配置后注入 symbol 脚本，供社交/网站链接图标使用 */}
        <IconfontScript url={d.iconfontUrl} />

        <Background bgApi={d.bgApi} coverType={d.coverType} autoSwitchInterval={d.autoBGSwitchInterval} bgOverlay={d.bgOverlay} wallpaperRefresh={d.wallpaperRefresh} initialUrl={d.wallpaperUrl} />
        <SeasonalEffect type={d.effectType} enabled={d.seasonalEffectEnabled} />
        {/* 自定义字体（范围=全站时注入 body 字体） */}
        <CustomFont enabled={d.customFontEnabled} family={d.customFontFamily} scope={d.customFontScope} />

        <section className="relative z-10 flex w-full flex-1 flex-col items-center">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-5 pt-4 pb-20 md:my-auto md:items-start md:px-6 md:pb-0 md:pt-0 lg:gap-8">
            {/* 双栏：各自自然高度、整体垂直居中（对齐全站 .all align-items:center）；
                左栏 translateY(20px) 下移，复刻参考站左低右高的错位张力 */}
            <div className="flex w-full flex-col items-center gap-5 md:flex-row md:items-center md:gap-8 lg:gap-12">
              {/* 左侧区域：头像 + 简介 + 社交（内容贴顶对齐，头像在最上方） */}
              <div className="flex w-full flex-col items-center md:w-1/2 md:items-start md:translate-y-5">
                <div className="flex items-center gap-5 sm:gap-7 md:gap-8 lg:gap-9 xl:gap-12">
                  <Avatar
                    className={`h-[104px] w-[104px] shadow-card-md sm:h-[116px] sm:w-[116px] md:h-[144px] md:w-[144px] lg:h-[156px] lg:w-[156px] xl:h-[168px] xl:w-[168px] ${d.avatarShapeClass} ${
                      d.avatarBorderColor ? "" : "ring-2 ring-white/30"
                    }`}
                    style={d.avatarStyle}
                  >
                    {d.finalAvatar ? <AvatarImage src={d.finalAvatar} alt={d.nickname} /> : null}
                    <AvatarFallback className="bg-white/10 text-3xl uppercase text-white md:text-4xl">
                      {d.nickname.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <h1 className={`${d.logoFontClass} text-glow-accent leading-none tracking-tight truncate logo-title`}>
                    <span
                      className="text-[36px] leading-none sm:text-[38px] md:text-[46px] lg:text-[56px] xl:text-[68px]"
                      style={d.logoFontFamily ? { fontFamily: d.logoFontFamily } : undefined}
                    >
                      <LogoFontLoader text={d.nickname} fontClass={d.logoFontClass} fontFamily={d.logoFontFamily} />
                    </span>
                  </h1>
                </div>

                {/* 社交链接 */}
                <SocialLinks initialLinks={d.socialLinks} />

                {/* 简介卡片 */}
                <div className="card-glass card-info mt-6 flex max-w-[500px] w-full items-start justify-between gap-4 p-5">
                  <Quote className="mt-0.5 h-[20px] w-[20px] shrink-0 rotate-180 text-white/50" />
                  <p className="min-w-0 flex-1 break-words text-[17px] leading-relaxed text-white/90">{d.bio}</p>
                  <Quote className="mt-0.5 h-[20px] w-[20px] shrink-0 text-white/50" />
                </div>

                {/* 技能云：并列于左栏简介下方，拉大与简介的间距 */}
                <div className="mt-8 w-full max-w-[500px]">
                  <SkillCloud skills={d.skills} />
                </div>
              </div>

              {/* 右侧区域：功能区 + 链接 */}
              <div className="flex w-full flex-col gap-5 md:w-1/2 md:max-w-[500px] lg:gap-7">
                {/* 功能卡片组：一言 + 时钟天气（≥880px 起并排以适配矮视口单屏；更窄时堆叠避免时钟过窄） */}
                <div className="grid grid-cols-1 gap-4 min-[880px]:grid-cols-2 min-[880px]:gap-5 lg:gap-6">
                  {/* 一言 / 音乐控制面板（hover 或"打开音乐"按钮切换，对齐 home） */}
                  <div>
                    <MusicCardLazy hitokotoType={d.hitokotoType} />
                  </div>

                  {/* 时钟+天气：clock-card-container 启用容器查询（container-type: inline-size），
                      时间字号按卡片宽度自适应（cqw）；min-h 对齐参考站 .function 高度 165px */}
                  <div className="clock-card-container min-h-[180px]">
                    <div className="card-glass card-func flex h-full w-full flex-col justify-end p-5 lg:p-6">
                      <ClockWeatherCapsule
                        timeFormat={d.timeFormat}
                        showSeconds={d.showSeconds}
                        dateFormat={d.dateFormat}
                      />
                    </div>
                  </div>
                </div>

                {/* 导航卡：我的网站 / 我的友链 / 我的作品 多 tab 切换，共用同一容器；无数据的 tab 自动隐藏 */}
                {(d.siteLinks.length > 0 || d.friendLinks.length > 0 || d.projects.length > 0) && (
                  <div className="card-glass card-list w-full rounded-2xl p-5 lg:p-6">
                    <LinkTabs
                      siteLinks={d.siteLinks.map((l) => ({ ...l, icon: l.icon ?? "" }))}
                      friendLinks={d.friendLinks}
                      projects={d.projects}
                      siteTitle={d.siteLinksTitle}
                      siteIcon={d.siteLinksIcon}
                      friendTitle={d.friendLinksTitle}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 页脚：版权信息 */}
        <FooterLazy siteIcp={d.siteIcp} siteMps={d.siteMps} siteStart={d.siteStart} showStats={d.showStats} siteFooterHtml={d.siteFooterHtml} appVersion={CURRENT_VERSION} />
        </main>
      </MusicProviderLazy>
    </ThemeProvider>
  );
}
