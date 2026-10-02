"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Github,
  Mail,
  Twitter,
  Send,
  Globe,
  Youtube,
  MessageCircle,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { useIconfontSymbols } from "./Iconfont";
import {
  resolveLucideIcon,
  isLucideIcon,
  getLucideIconByName,
} from "./lucideIconResolver";
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

  const sortedLinks = useMemo(
    () => [...links].sort((a, b) => a.sort - b.sort),
    [links],
  );

  if (sortedLinks.length === 0) return null;

  return (
    <div className="social-links-bar">
      <div className="social-link-row">
        {sortedLinks.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="social-icon"
            title={link.tip || link.name}
            aria-label={link.tip || link.name}
          >
            <SocialIcon
              icon={link.icon}
              name={link.name}
              iconfontSymbols={iconfontSymbols}
              iconifyApi={iconifyApi}
            />
            <span className="social-link-title">{link.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
