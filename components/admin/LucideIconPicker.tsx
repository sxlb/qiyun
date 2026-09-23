"use client";

/**
 * Lucide 图标选择器（后台用）
 * - 弹出式面板，展示常用 lucide 图标，支持搜索过滤
 * - 网格布局，点击选中，选中值格式为 "lucide:图标名"（kebab-case）
 * - 样式参考 IconfontPicker，保持后台 UI 一致
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Home,
  User,
  Users,
  Mail,
  Github,
  Gitlab,
  Twitter,
  Facebook,
  Instagram,
  Youtube,
  Twitch,
  Globe,
  Link,
  Bookmark,
  BookOpen,
  Book,
  Music,
  Headphones,
  Radio,
  Film,
  Image,
  Camera,
  Video,
  Cloud,
  Sun,
  Moon,
  Star,
  Heart,
  ThumbsUp,
  MessageCircle,
  MessageSquare,
  Send,
  Share2,
  Download,
  Upload,
  Copy,
  Edit,
  Trash2,
  Plus,
  Minus,
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  Settings,
  Bell,
  Menu,
  MoreHorizontal,
  MoreVertical,
  ExternalLink,
  Monitor,
  Laptop,
  Smartphone,
  Tablet,
  Code,
  Terminal,
  Database,
  Server,
  Cpu,
  Shield,
  Lock,
  Unlock,
  Key,
  Map,
  MapPin,
  Navigation,
  Compass,
  Coffee,
  Pizza,
  Gamepad2,
  Palette,
  PenTool,
  Layers,
  Briefcase,
  Building,
  Calendar,
  Clock,
  Zap,
  Activity,
  BarChart,
  PieChart,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

/** 常用 lucide 图标列表（kebab-case 名称） */
export const LUCIDE_COMMON_ICONS: string[] = [
  "home",
  "user",
  "users",
  "mail",
  "github",
  "gitlab",
  "twitter",
  "facebook",
  "instagram",
  "youtube",
  "twitch",
  "globe",
  "link",
  "bookmark",
  "book-open",
  "book",
  "music",
  "headphones",
  "radio",
  "film",
  "image",
  "camera",
  "video",
  "cloud",
  "sun",
  "moon",
  "star",
  "heart",
  "thumbs-up",
  "message-circle",
  "message-square",
  "send",
  "share-2",
  "download",
  "upload",
  "copy",
  "edit",
  "trash-2",
  "plus",
  "minus",
  "x",
  "check",
  "chevron-right",
  "chevron-left",
  "settings",
  "bell",
  "search",
  "menu",
  "more-horizontal",
  "more-vertical",
  "external-link",
  "monitor",
  "laptop",
  "smartphone",
  "tablet",
  "code",
  "terminal",
  "database",
  "server",
  "cpu",
  "shield",
  "lock",
  "unlock",
  "key",
  "map",
  "map-pin",
  "navigation",
  "compass",
  "coffee",
  "pizza",
  "gamepad-2",
  "palette",
  "pen-tool",
  "layers",
  "briefcase",
  "building",
  "calendar",
  "clock",
  "zap",
  "activity",
  "bar-chart",
  "pie-chart",
  "trending-up",
];

/** kebab-case 图标名 → Lucide 组件 的映射表 */
const ICON_COMPONENT_MAP: Record<string, LucideIcon> = {
  home: Home,
  user: User,
  users: Users,
  mail: Mail,
  github: Github,
  gitlab: Gitlab,
  twitter: Twitter,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  twitch: Twitch,
  globe: Globe,
  link: Link,
  bookmark: Bookmark,
  "book-open": BookOpen,
  book: Book,
  music: Music,
  headphones: Headphones,
  radio: Radio,
  film: Film,
  image: Image,
  camera: Camera,
  video: Video,
  cloud: Cloud,
  sun: Sun,
  moon: Moon,
  star: Star,
  heart: Heart,
  "thumbs-up": ThumbsUp,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  send: Send,
  "share-2": Share2,
  download: Download,
  upload: Upload,
  copy: Copy,
  edit: Edit,
  "trash-2": Trash2,
  plus: Plus,
  minus: Minus,
  x: X,
  check: Check,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  settings: Settings,
  bell: Bell,
  search: Search,
  menu: Menu,
  "more-horizontal": MoreHorizontal,
  "more-vertical": MoreVertical,
  "external-link": ExternalLink,
  monitor: Monitor,
  laptop: Laptop,
  smartphone: Smartphone,
  tablet: Tablet,
  code: Code,
  terminal: Terminal,
  database: Database,
  server: Server,
  cpu: Cpu,
  shield: Shield,
  lock: Lock,
  unlock: Unlock,
  key: Key,
  map: Map,
  "map-pin": MapPin,
  navigation: Navigation,
  compass: Compass,
  coffee: Coffee,
  pizza: Pizza,
  "gamepad-2": Gamepad2,
  palette: Palette,
  "pen-tool": PenTool,
  layers: Layers,
  briefcase: Briefcase,
  building: Building,
  calendar: Calendar,
  clock: Clock,
  zap: Zap,
  activity: Activity,
  "bar-chart": BarChart,
  "pie-chart": PieChart,
  "trending-up": TrendingUp,
};

/** Lucide 图标值前缀 */
export const LUCIDE_PREFIX = "lucide:";

/**
 * 从 lucide:xxx 格式的值中提取纯图标名（kebab-case）
 * 例如 "lucide:github" → "github"
 */
export function extractLucideIconName(value: string): string {
  if (value.startsWith(LUCIDE_PREFIX)) {
    return value.slice(LUCIDE_PREFIX.length);
  }
  return "";
}

/**
 * 将图标名包装为 lucide:xxx 格式
 */
export function toLucideIconValue(name: string): string {
  return `${LUCIDE_PREFIX}${name}`;
}

interface Props {
  /** 当前选中的图标值（lucide:xxx 格式或纯图标名） */
  value: string;
  /** 选中图标时回调，返回 lucide:xxx 格式的值 */
  onChange: (value: string) => void;
}

export default function LucideIconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // 当前选中的纯图标名（去掉 lucide: 前缀）
  const selectedName = useMemo(() => {
    if (value.startsWith(LUCIDE_PREFIX)) {
      return value.slice(LUCIDE_PREFIX.length);
    }
    return value;
  }, [value]);

  // 按关键词过滤
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return LUCIDE_COMMON_ICONS;
    return LUCIDE_COMMON_ICONS.filter((name) => name.toLowerCase().includes(kw));
  }, [search]);

  const handleSelect = (name: string) => {
    onChange(toLucideIconValue(name));
    setOpen(false);
    setSearch("");
  };

  const SelectedIcon = ICON_COMPONENT_MAP[selectedName];

  return (
    <div className="relative">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 truncate"
        >
          从 Lucide 选择（{LUCIDE_COMMON_ICONS.length}）
        </Button>
        {SelectedIcon && (
          <SelectedIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
      </div>

      {/* 移动优先：小屏内联全宽；≥sm 改为右对齐浮层（从字段右缘向左展开），避免右列字段顶出视口 */}
      {open && (
        <div className="z-50 mt-2 w-full rounded-lg border bg-background p-3 shadow-lg sm:absolute sm:right-0 sm:top-full sm:w-80 sm:max-w-[calc(100vw-2rem)]">
          <div className="mb-2 flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索图标（如 github）"
              className="h-10 sm:h-8"
              autoFocus
            />
          </div>
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">暂无匹配图标</p>
          ) : (
            <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
              {filtered.map((name) => {
                const IconComp = ICON_COMPONENT_MAP[name];
                if (!IconComp) return null;
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => handleSelect(name)}
                    className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent ${
                      selectedName === name ? "bg-accent ring-1 ring-primary" : ""
                    }`}
                  >
                    <IconComp className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
