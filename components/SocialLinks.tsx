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
import { resolveFaPresetLucideName } from "@/lib/iconValue";

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
}

/** 图标查找函数 memo 化，避免每次 render 重新创建 */
const resolveIcon = (iconName: string): LucideIcon => {
  // 优先处理 lucide: 前缀的图标
  if (isLucideIcon(iconName)) {
    const LucideIconComp = resolveLucideIcon(iconName);
    if (LucideIconComp) return LucideIconComp;
  }
  // 其次是 @vicons/fa 预设名（Blog / Cloud / ... 大写形式的历史值）
  const presetLucide = resolveFaPresetLucideName(iconName);
  if (presetLucide) {
    const presetComp = getLucideIconByName(presetLucide);
    if (presetComp) return presetComp;
  }
  // 再是裸图标名（历史数据/手填），先按连字符式在白名单里查（如 book-open）
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
}: {
  icon: string;
  name: string;
  iconfontSymbols: string[];
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const imgSrc = imgBroken ? null : resolveIconImageSrc(icon, 32);

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
    return <IconifyIcon icon={icon} size={32} className="h-[32px] w-[32px]" />;
  }

  // 5. lucide / @vicons/fa 预设名（兜底）
  const IconComponent = resolveIcon(icon);
  return <IconComponent className="h-[32px] w-[32px]" />;
}

/**
 * 社交链接容器：纯图标横排（对齐 home .social 布局）
 * - 默认透明背景，hover 时显示毛玻璃效果
 * - 每个图标悬停放大 + title 提示（替代 tooltip）
 * - PC 端 hover 时右侧显示 tip 文字
 * - 高度固定 42px，border-radius 6px，响应式 ≤840px 居中
 */
export default function SocialLinks({ initialLinks }: SocialLinksProps) {
  const [links, setLinks] = useState<SocialLink[]>(initialLinks ?? []);
  const [tip, setTip] = useState("通过这里联系我吧");
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
      <div className="social-link-row flex items-center">
        {sortedLinks.map((link) => {
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="social-icon"
              onMouseEnter={() => setTip(link.tip)}
              onMouseLeave={() => setTip("通过这里联系我吧")}
              title={link.tip || link.name}
              aria-label={link.tip || link.name}
            >
              {/* 32px 图标，间距交由容器 row gap 统一控制（微调放大，提升辨识度） */}
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <SocialIcon icon={link.icon} name={link.name} iconfontSymbols={iconfontSymbols} />
              </span>
            </a>
          );
        })}
      </div>
      {/* tip 显示区域（PC hover 时显示） */}
      <span className="social-tip">{tip}</span>
    </div>
  );
}
