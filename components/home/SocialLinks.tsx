"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Github,
  Mail,
  Twitter,
  Send,
  Globe,
  Youtube,
  MessageCircle,
  Link2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useIconfontSymbols } from "./Iconfont";
import {
  resolveLucideIcon,
  isLucideIcon,
  getLucideIconByName,
} from "@/lib/lucideIconResolver";
import {
  resolveIconImageSrc,
  isInlineSvgValue,
  isIconifyValue,
  renderInlineSvg,
} from "@/lib/iconValue";
import IconifyIcon from "./IconifyIcon";

const ICON_MAP: Record<string, LucideIcon> = {
  github: Github,
  mail: Mail,
  email: Mail,
  twitter: Twitter,
  send: Send,
  telegram: Send,
  globe: Globe,
  website: Globe,
  youtube: Youtube,
  "message-circle": MessageCircle,
  qq: MessageCircle,
  bilibili: MessageCircle,
  link: Link2,
  default: Globe,
};

interface SocialLink {
  id: number;
  name: string;
  icon: string;
  url: string;
  /** 点击弹出的图片（微信/QQ 这类没有可跳转主页的平台放二维码）；非空时不再跳转 */
  popupImage?: string;
  tip: string;
  sort: number;
}

interface SocialLinksProps {
  initialLinks?: SocialLink[];
  /** Iconify API 基地址（后台「外部服务」配置；空串表示使用内置默认） */
  iconifyApi?: string;
}

/** 图标查找函数 memo 化，避免每次 render 重新创建 */
const resolveIcon = (iconName: string): LucideIcon => {
  // 优先处理 lucide: 前缀的图标
  if (isLucideIcon(iconName)) {
    const LucideIconComp = resolveLucideIcon(iconName);
    if (LucideIconComp) return LucideIconComp;
  }
  // 其次是裸图标名（历史数据/手填），先按连字符式在白名单里查（如 book-open）
  const kebab = getLucideIconByName(iconName.trim());
  if (kebab) return kebab;
  const key = iconName.toLowerCase().replace(/[^a-z]/g, "");
  return ICON_MAP[key] || ICON_MAP[iconName] || ICON_MAP.default;
};

/**
 * 单个社交图标。
 * 渲染优先级：图片类（favicon / 图片直链，后台「从网站获取」写入的就是这类）
 * → iconfont symbol → lucide/内置图标。
 * 图片加载失败时回退到内置图标，避免只留一个空白洞（此前图片类值一律被当成
 * 图标名去查表，查不到就渲染成地球，于是 GitHub/BiliBili 显示的图标是错的）。
 */
function SocialIcon({
  icon,
  name,
  iconfontSymbols,
  iconifyApi,
}: {
  icon: string;
  name: string;
  iconfontSymbols: string[];
  iconifyApi?: string;
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const imgSrc = imgBroken ? null : resolveIconImageSrc(icon);

  // 1. 内联 SVG 代码（后台可整体粘贴 iconfont 导出的 <svg>…</svg>）
  if (isInlineSvgValue(icon)) {
    return (
      <span
        aria-hidden="true"
        data-testid="social-icon-inline-svg"
        className="inline-flex items-center justify-center"
        style={{ width: 32, height: 32 }}
        dangerouslySetInnerHTML={{ __html: renderInlineSvg(icon, 32) }}
      />
    );
  }

  // 2. 图片类（favicon / 图片直链，后台「从网站获取」写入的就是这类）
  if (imgSrc) {
    return (
      // 管理员配置的外部图标地址，走原生 img（同 LinkIconPreview / MediaPicker 的做法）
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgSrc}
        alt={name}
        className="h-[32px] w-[32px] rounded-md object-cover"
        loading="lazy"
        onError={() => setImgBroken(true)}
      />
    );
  }

  // 3. iconfont symbol（阿里云矢量图标库，后台图标库地址注入的 symbol 名）
  if (iconfontSymbols.includes(icon)) {
    return (
      <svg className="h-[32px] w-[32px]" aria-hidden="true" focusable="false">
        <use href={`#${icon}`} />
      </svg>
    );
  }

  // 4. Iconify 在线图标（prefix:name，如 fa:github、mdi:home）
  if (isIconifyValue(icon)) {
    return <IconifyIcon icon={icon} size={32} className="h-[32px] w-[32px]" apiBase={iconifyApi} />;
  }

  // 5. lucide / 内置图标（兜底）
  const IconComponent = resolveIcon(icon);
  return <IconComponent className="h-[32px] w-[32px]" />;
}

/**
 * 社交链接容器：图标在上、文字标题在下（对齐 home .social 布局）
 * - 每个链接 = 32px 图标 + 下方小号文字标题，始终可见（标题适配主题：悬停变强调色）
 * - 悬停浮现毛玻璃背景（--card-alpha 联动），原生 title 提示保留 tip 文案
 * - 胶囊自带内边距，全尺寸居中；超宽时换行呈对称「按钮云」
 */
export default function SocialLinks({ initialLinks, iconifyApi }: SocialLinksProps) {
  const [links, setLinks] = useState<SocialLink[]>(initialLinks ?? []);
  // 当前展开的弹出图（微信/QQ 二维码）；null 表示未展开
  const [popup, setPopup] = useState<{ src: string; name: string } | null>(null);
  // 已注册的 iconfont symbol（阿里云矢量图标库），供图标优先渲染
  const iconfontSymbols = useIconfontSymbols();

  // 仅在未提供 SSR 初始数据时，客户端拉取
  useEffect(() => {
    if (initialLinks && initialLinks.length > 0) return;
    fetch("/api/social-links", { signal: AbortSignal.timeout(8000) })
      .then((r) => r.ok ? r.json() : [])
      .then(setLinks)
      .catch((e) => { if (process.env.NODE_ENV === "development") console.error("[SocialLinks]", e); });
  }, [initialLinks]);

  // Esc 关闭弹层：只在展开时挂监听，平时零开销
  useEffect(() => {
    if (!popup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popup]);

  const sortedLinks = useMemo(
    () => [...links].sort((a, b) => a.sort - b.sort),
    [links],
  );

  if (sortedLinks.length === 0) return null;

  return (
    <div className="social-links-bar">
      <div className="social-link-row">
        {sortedLinks.map((link) => {
          const label = link.tip || link.name;
          const popupImage = link.popupImage?.trim() ?? "";
          const icon = (
            <SocialIcon
              icon={link.icon}
              name={link.name}
              iconfontSymbols={iconfontSymbols}
              iconifyApi={iconifyApi}
            />
          );

          // 有弹出图时不再跳转：改渲染成 button 弹出图片。
          // 两者都填时以弹出图为准 —— 字段名本身就是「点击弹出图片」，
          // 用户在后台填了它，期望的就是点开看图。
          if (popupImage) {
            return (
              <button
                key={link.id}
                type="button"
                className="social-icon"
                title={label}
                aria-label={label}
                aria-haspopup="dialog"
                onClick={() => setPopup({ src: popupImage, name: link.name })}
              >
                {icon}
                <span className="social-link-title">{link.name}</span>
              </button>
            );
          }

          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="social-icon"
              title={label}
              aria-label={label}
            >
              {icon}
              <span className="social-link-title">{link.name}</span>
            </a>
          );
        })}
      </div>

      {/* 弹出图查看器：portal 到 body，两个理由都不能省 ——
          1. 弹层是 fixed，留在单屏外壳的滚动容器里虽不会被裁切，但 .social-links-bar 所在的
             <section> 带 z-10、自身形成层叠上下文，里面的 z-index 再高也压不过外层 z-[85] 的公告浮层
             （实测被欢迎通知整个盖住）；
          2. 挂到 body 后才在根层叠上下文里比大小：150 高于内容与公告，低于加载动画的 999。 */}
      {popup && typeof document !== "undefined" && createPortal(
        <div className="social-qr-scrim" role="dialog" aria-modal="true" aria-label={`${popup.name} 二维码`}>
          {/* 点遮罩关闭：与站内其它浮层（如控制台彩蛋）用同一套写法 */}
          <div className="social-qr-backdrop" onClick={() => setPopup(null)} aria-hidden="true" />
          <figure className="social-qr-card">
            <button
              type="button"
              className="social-qr-close"
              onClick={() => setPopup(null)}
              aria-label="关闭"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
            {/* 管理员上传/配置的图片，走原生 img */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={popup.src} alt={`${popup.name} 二维码`} className="social-qr-img" />
            <figcaption className="social-qr-caption">{popup.name}</figcaption>
          </figure>
        </div>,
        document.body
      )}
    </div>
  );
}
