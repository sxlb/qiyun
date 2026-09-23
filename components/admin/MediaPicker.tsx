"use client";

/**
 * 统一媒体选择器（后台用）
 * - 支持 FontAwesome 图标库选择（fa6-solid / fa6-brands，通过 Iconify 获取）
 * - 支持 lucide 图标库选择
 * - 支持手动输入网络图片 URL / 本地图片路径
 * - 支持 Iconify 在线图标（prefix:name）
 * - 支持粘贴 iconfont 导出的内联 SVG 代码
 * - 支持关键词随机图（loremflickr，无需 API Key）
 * - 支持 Openverse API 搜索（Creative Commons 开放版权图片）
 * - 值格式：
 *   - FontAwesome 图标："fa6-solid:图标名" | "fa6-brands:图标名"
 *   - lucide 图标："lucide:图标名"（如 "lucide:github"）
 *   - 网络图片：http(s)://... URL；本地图片：/images/xxx.png、/api/uploads/...
 *   - Iconify 图标："prefix:name"（如 "mdi:home"）
 *   - 内联 SVG：以 "<svg" 开头的整段代码（阿里 iconfont 直接复制）
 *   - 随机图："random:关键词"（如 "random:nature"；旧写法 "unsplash:关键词" 仍兼容识别）
 *
 * 注：本组件刻意使用原生 <img> 而非 next/image —— 预览对象是管理员即时输入/第三方搜索返回的
 * 任意外部 URL，走 next/image 需要远程域名白名单且会把不可信图片经优化器代理，故不使用。
 */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Link, Sparkles, Search, Loader2, Code2, Cloud } from "lucide-react";
import LucideIconPicker, { LUCIDE_PREFIX, extractLucideIconName } from "./LucideIconPicker";
import FaIconPicker from "./FaIconPicker";
import { resolveLucideIcon, getLucideIconByName } from "@/components/lucideIconResolver";
import { useIconfontSymbols } from "@/components/Iconfont";
import IconifyIcon from "@/components/IconifyIcon";
import { resolveFaPresetLucideName } from "@/lib/iconValue";
import {
  RANDOM_PREFIX,
  extractRandomKeyword,
  getRandomImageUrl,
  isRandomImageValue,
  isInlineSvgValue,
  isIconifyValue,
  isLocalImagePath,
  renderInlineSvg,
} from "@/lib/iconValue";

interface Props {
  /** 当前值（图标名 / lucide:xxx / http(s) URL / random:关键词） */
  value: string;
  /** 值变更回调 */
  onChange: (value: string) => void;
  /** 占位提示 */
  placeholder?: string;
  /** 标签 */
  label?: string;
  /** 输入框 id（供 <Label htmlFor> 关联，提升可访问性） */
  id?: string;
  /** 图标选择模式隐藏随机图和开放版权图片来源。 */
  iconOnly?: boolean;
}

/** Openverse API 返回的图片结果 */
interface OpenverseImage {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  creator?: string;
  license: string;
  license_version?: string;
}

/** 预览组件：根据值类型渲染对应图标/图片 */
function MediaPreview({ value, className = "h-10 w-10" }: { value: string; className?: string }) {
  const iconfontSymbols = useIconfontSymbols();

  if (!value) return null;

  // FontAwesome 图标（fa6-solid:xxx / fa6-brands:xxx）— 使用 Iconify 渲染
  if (/^fa6-(solid|brands):/.test(value)) {
    return <IconifyIcon icon={value} size={28} className={`${className} text-muted-foreground`} />;
  }

  // 内联 SVG 代码（阿里 iconfont 直接复制的一整段 <svg>…</svg>）
  if (isInlineSvgValue(value)) {
    return (
      <span
        className={className}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        // renderInlineSvg 已做安全清洗（去 on* 事件与 href/src）并统一尺寸，避免 200×200 撑破预览框
        dangerouslySetInnerHTML={{ __html: renderInlineSvg(value, 28) }}
      />
    );
  }

  // Iconify 在线图标（prefix:name，如 fa:github）
  if (isIconifyValue(value)) {
    return <IconifyIcon icon={value} size={28} className={`${className} text-muted-foreground`} />;
  }

  // 随机图（random: / 旧 unsplash:）
  if (isRandomImageValue(value)) {
    const keyword = extractRandomKeyword(value);
    return (
      <img
        src={getRandomImageUrl(keyword, 80, 80)}
        alt={keyword}
        className={`${className} rounded object-cover`}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }

  // 图片：网络图片 URL，或本地/媒体路径（/images/xxx.png、/api/uploads/...）
  if (/^https?:\/\//i.test(value) || isLocalImagePath(value)) {
    return (
      <img
        src={value}
        alt=""
        className={`${className} rounded object-cover`}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    );
  }

  // @vicons/fa 预设名（历史数据，如 Blog / CompactDisc）→ 映射到 lucide 同名图标
  const presetLucideName = resolveFaPresetLucideName(value);
  if (presetLucideName) {
    const PresetComp = getLucideIconByName(presetLucideName);
    if (PresetComp) return <PresetComp className={`${className} text-muted-foreground`} />;
  }

  // lucide 图标
  if (value.startsWith(LUCIDE_PREFIX)) {
    const name = extractLucideIconName(value);
    const IconComp = resolveLucideIcon(name);
    if (IconComp) {
      return <IconComp className={`${className} text-muted-foreground`} />;
    }
    return null;
  }

  // iconfont 图标
  if (iconfontSymbols.includes(value)) {
    return (
      <svg className={`${className} text-muted-foreground`} aria-hidden="true" focusable="false">
        <use href={`#${value}`} />
      </svg>
    );
  }

  return null;
}

/** Iconify 常用图标快捷示例（避免管理员记不住 prefix:name 写法） */
const ICONIFY_SAMPLES = ["fa:github", "mdi:home", "tabler:brand-bilibili", "simple-icons:bilibili", "ri:wechat-fill"];

/** Tab 切换时需要值格式的映射表（空串表示当前 value 不匹配该 tab，需清空或跳过） */
const TAB_VALID_VALUE_CHECKS: Record<string, (v: string) => boolean> = {
  "fa-icons": (v) => /^fa6-(solid|brands):/.test(v),
  lucide: (v) => v.startsWith(LUCIDE_PREFIX),
  iconify: isIconifyValue,
  svg: isInlineSvgValue,
  random: isRandomImageValue,
  url: (v) => /^https?:\/\//i.test(v) || isLocalImagePath(v),
  openverse: () => true, // 搜索页面无需校验
};

export default function MediaPicker({
  value,
  onChange,
  placeholder = "输入或选择图标/图片",
  label,
  id,
  iconOnly = false,
}: Props) {
  type PickerTab = "url" | "lucide" | "fa-icons" | "iconify" | "svg" | "random" | "openverse";
  const [tab, setTab] = useState<PickerTab>(() => {
    if (isInlineSvgValue(value)) return "svg";
    if (isIconifyValue(value)) return "iconify";
    if (isRandomImageValue(value)) return iconOnly ? "url" : "random";
    if (/^https?:\/\//i.test(value) || isLocalImagePath(value)) return "url";
    if (value.startsWith(LUCIDE_PREFIX)) return "lucide";
    // fa6-solid:xxx / fa6-brands:xxx
    if (/^fa6-(solid|brands):/.test(value)) return "fa-icons";
    return "lucide"; // 默认 Lucide（零依赖，最快加载）
  });
  const [randomKeyword, setRandomKeyword] = useState(() => extractRandomKeyword(value));

  /** 智能切换 Tab：若当前 value 不匹配目标 tab 的格式要求，则先清空再切换 */
  const handleTabChange = (t: PickerTab) => {
    const checker = TAB_VALID_VALUE_CHECKS[t];
    if (checker && !checker(value)) {
      // 当前 value 不符合该 tab 格式 → 先清空值（避免残留旧值导致渲染异常）
      onChange("");
    }
    setTab(t);
  };

  // Openverse 搜索状态
  const [openverseQuery, setOpenverseQuery] = useState("");
  const [openverseResults, setOpenverseResults] = useState<OpenverseImage[]>([]);
  const [openverseLoading, setOpenverseLoading] = useState(false);

  const handleRandomKeywordChange = (kw: string) => {
    setRandomKeyword(kw);
    if (kw.trim()) {
      onChange(`${RANDOM_PREFIX}${kw.trim()}`);
    }
  };

  /** 拉取 Openverse 结果（返回解析后的列表，失败返回空数组） */
  const fetchOpenverse = async (query: string, pageSize: number): Promise<OpenverseImage[]> => {
    const res = await fetch(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${pageSize}&filter_dead=true`
    );
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    return ((data.results || []) as Array<{
      id: string;
      title: string;
      url: string;
      thumbnail?: string;
      creator?: string;
      license: string;
      license_version?: string;
    }>).map((item) => ({
      id: item.id,
      title: item.title || "Untitled",
      url: item.url,
      thumbnail: item.thumbnail || item.url,
      creator: item.creator,
      license: item.license,
      license_version: item.license_version,
    }));
  };

  // Openverse 搜索（展示缩略图网格供挑选）
  const handleOpenverseSearch = async () => {
    const q = openverseQuery.trim();
    if (!q) return;
    setOpenverseLoading(true);
    try {
      setOpenverseResults(await fetchOpenverse(q, 12));
    } catch {
      setOpenverseResults([]);
    } finally {
      setOpenverseLoading(false);
    }
  };

  // 随机一张：取一批结果后任选其一，保存为稳定的图片直链（避免依赖会失效的随机图服务）
  const handleRandomPick = async () => {
    const q = openverseQuery.trim();
    if (!q) return;
    setOpenverseLoading(true);
    try {
      const results = await fetchOpenverse(q, 20);
      if (results.length > 0) {
        const picked = results[Math.floor(Math.random() * results.length)];
        onChange(picked.url);
        setOpenverseResults(results);
        setTab("url");
      } else {
        setOpenverseResults([]);
      }
    } catch {
      setOpenverseResults([]);
    } finally {
      setOpenverseLoading(false);
    }
  };

  return (
    <div className="min-w-0 space-y-2">
      {label && <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>}

      {/* 预览 + 手动输入（min-w-0 允许在窄列/移动端收缩，避免撑破父容器） */}
      {tab === "svg" ? (
        // SVG 代码是多行长文本，改用 Textarea 编辑（单行 Input 粘贴 10KB+ 代码体验极差）
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/30">
            <MediaPreview value={value} />
          </div>
          <Textarea
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={'粘贴 iconfont 导出的完整代码，形如 <svg ...>...</svg>'}
            spellCheck={false}
            className="min-h-[76px] min-w-0 flex-1 font-mono text-xs leading-relaxed"
          />
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/30">
            <MediaPreview value={value} />
          </div>
          <Input
            id={id}
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v);
              // 随机图关键词需同步到内部 state（供「随机图」Tab 输入框回显）
              if (isRandomImageValue(v)) {
                setRandomKeyword(extractRandomKeyword(v));
              }
              // 自动切换 Tab：检测到 fa6-solid: / fa6-brands: 前缀 → 切到 FontAwesome
              if (/^fa6-(solid|brands):/.test(v)) setTab("fa-icons");
              // 检测到 lucide: 前缀 → 切到 Lucide
              else if (v.startsWith(LUCIDE_PREFIX)) setTab("lucide");
              // 检测到 Iconify 格式 prefix:name → 切到 Iconify
              else if (isIconifyValue(v)) setTab("iconify");
              // 检测到 random: → 切到随机图
              else if (isRandomImageValue(v)) setTab("random");
              // URL → 切到 URL/路径
              else if (/^https?:\/\//i.test(v) || isLocalImagePath(v)) setTab("url");
            }}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            className="h-10 sm:h-9 min-w-0 flex-1"
          />
        </div>
      )}

      {/* Tab 选择器：移动端固定成三列，≥sm 四列（末项不会被拉伸成整行） */}
      <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/30 p-1 sm:gap-1">
        {(["url", "lucide", "fa-icons", "iconify", "svg", ...(iconOnly ? [] : ["random", "openverse"])] as PickerTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleTabChange(t)}
            className={`flex basis-[calc((100%-0.75rem)/4)] items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 py-2 text-xs transition-colors sm:basis-[calc((100%-1.125rem)/5)] sm:py-1 ${
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "url" && <Link className="h-3 w-3 shrink-0" />}
            {t === "lucide" && <ImageIcon className="h-3 w-3 shrink-0" />}
            {t === "fa-icons" && <Sparkles className="h-3 w-3 shrink-0" />}
            {t === "iconify" && <Cloud className="h-3 w-3 shrink-0" />}
            {t === "svg" && <Code2 className="h-3 w-3 shrink-0" />}
            {t === "random" && <Sparkles className="h-3 w-3 shrink-0" />}
            {t === "openverse" && <Search className="h-3 w-3 shrink-0" />}
            {t === "url"
              ? "URL/路径"
              : t === "lucide"
                ? "Lucide"
                : t === "fa-icons"
                  ? "FontAwesome"
                  : t === "iconify"
                    ? "Iconify"
                    : t === "svg"
                      ? "SVG代码"
                      : t === "random"
                        ? "随机图"
                        : "搜索图"}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="min-h-[60px] min-w-0">
        {tab === "url" && (
          <p className="text-xs text-muted-foreground">
            在上方输入框粘贴图片地址：支持 http(s) 网络图片，也支持本地/媒体路径（/images/xxx.png、上传后得到的 /api/uploads/...）。
          </p>
        )}
        {tab === "lucide" && (
          <LucideIconPicker
            value={value.startsWith(LUCIDE_PREFIX) ? value : ""}
            onChange={(v: string) => {
              onChange(v);
              setTab("lucide");
            }}
          />
        )}
        {tab === "fa-icons" && (
          <FaIconPicker
            value={value.startsWith("fa6-") ? value : ""}
            onChange={(v: string) => {
              onChange(v);
              setTab("fa-icons");
            }}
          />
        )}
        {tab === "iconify" && (
          <div className="space-y-2">
            <Input
              value={isIconifyValue(value) ? value : ""}
              onChange={(e) => onChange(e.target.value.trim())}
              placeholder="输入 prefix:name，如 mdi:home、simple-icons:bilibili"
              spellCheck={false}
              className="h-10 sm:h-8 font-mono text-xs"
            />
            {/* 常用图标一键填入：Iconify 聚合 150+ 图标集，无需本地依赖 */}
            <div className="flex flex-wrap gap-1.5">
              {ICONIFY_SAMPLES.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => onChange(sample)}
                  className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                    value === sample
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {sample}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              从 iconify.design 在线加载（首次访问需联网），图标颜色跟随主题文字色。浏览器打开
              iconify.design 搜索图标即可拿到 prefix:name。
            </p>
          </div>
        )}
        {tab === "svg" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              在 iconfont.cn 选中图标 → 「复制 SVG」→ 把完整 &lt;svg&gt;…&lt;/svg&gt; 代码粘贴到上方文本框，
              保存后前台按原色渲染（尺寸会自动缩放为 32×32，不会撑破布局）。
            </p>
            {isInlineSvgValue(value) && (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
                <span className="text-xs text-muted-foreground">
                  已识别为 SVG 代码（{value.length} 字符）
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange("")}
                  className="h-6 shrink-0 px-2 text-xs"
                >
                  清空
                </Button>
              </div>
            )}
          </div>
        )}
        {!iconOnly && tab === "random" && (
          <div className="space-y-2">
            <Input
              value={randomKeyword}
              onChange={(e) => handleRandomKeywordChange(e.target.value)}
              placeholder="输入关键词（如 nature、city、tech）"
              className="h-10 sm:h-8"
            />
            <p className="text-xs text-muted-foreground">
              按关键词从 Flickr 随机取图（loremflickr，无需 Key），每次打开页面可能显示不同图片。
              如需可控版权的图片，请改用「Openverse」搜索并保存直链。
            </p>
          </div>
        )}
        {!iconOnly && tab === "openverse" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                value={openverseQuery}
                onChange={(e) => setOpenverseQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleOpenverseSearch()}
                placeholder="搜索开放版权图片（如 sunset、mountain）"
                className="h-10 sm:h-8 min-w-0 flex-1"
              />
              <Button
                type="button"
                size="sm"
                onClick={handleOpenverseSearch}
                disabled={openverseLoading}
                className="h-10 shrink-0 gap-1 sm:h-8"
              >
                {openverseLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                搜索
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRandomPick}
                disabled={openverseLoading}
                className="h-10 shrink-0 gap-1 sm:h-8"
                title="按关键词随机挑一张开放版权图片"
              >
                {openverseLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                随机一张
              </Button>
            </div>
            {openverseResults.length > 0 && (
              <div className="grid max-h-[300px] grid-cols-3 gap-2 overflow-y-auto rounded-lg border bg-muted/20 p-2 sm:grid-cols-4">
                {openverseResults.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      onChange(img.url);
                      setOpenverseResults([]);
                      setTab("url");
                    }}
                    className="group relative aspect-square overflow-hidden rounded-md border bg-background transition-all hover:border-primary hover:shadow-sm"
                    title={`${img.title}\n作者: ${img.creator || "未知"}\n许可证: ${img.license}`}
                  >
                    <img
                      src={img.thumbnail}
                      alt={img.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <p className="truncate text-[10px] text-white">{img.license.toUpperCase()}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Creative Commons 旗下聚合，数据源含 Flickr、Wikimedia、博物馆等。点击选择后直接使用图片直链。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
