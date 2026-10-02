"use client";

/**
 * Lucide 图标解析工具（唯一数据源）
 * - 支持 "lucide:xxx" 前缀格式的图标值
 * - 从固定白名单映射表中查找对应图标组件
 *   （避免 `import * as` + 动态属性访问使 Next.js optimizePackageImports 失效，
 *   全部 ~1800 个图标被打进客户端 bundle；白名单只打包实际用到的图标）
 * - 白名单同时服务两处：前台渲染（SocialLinks / LinkTabs / SkillCloud）与后台选择器
 *   （admin/LucideIconPicker），kebab 名由 PascalCase 导出名机械派生，避免维护第二份清单
 */

import {
  Activity,
  AlertCircle,
  Anchor,
  ArrowUpRight,
  Award,
  Banknote,
  BarChart,
  BarChart3,
  Battery,
  Bell,
  Bitcoin,
  Book,
  Bookmark,
  BookOpen,
  Box,
  Briefcase,
  Brush,
  Building,
  Bug,
  Cake,
  Calendar,
  Camera,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Clipboard,
  Clock,
  Cloud,
  CloudMoon,
  CloudSun,
  Code,
  Coffee,
  Coins,
  Compass,
  Copy,
  Cpu,
  CreditCard,
  Database,
  Disc,
  Dog,
  Download,
  Dumbbell,
  Edit,
  ExternalLink,
  Facebook,
  Feather,
  File,
  FileText,
  Film,
  Fish,
  Flame,
  Flower2,
  Folder,
  FolderOpen,
  Gamepad2,
  Gift,
  Github,
  Gitlab,
  Globe,
  Hammer,
  HardDrive,
  Headphones,
  Heart,
  HeartPulse,
  HelpCircle,
  Home,
  House,
  IceCream,
  Image,
  Info,
  Instagram,
  Key,
  KeyRound,
  Laptop,
  Layers,
  Leaf,
  Link,
  Link2,
  ListMusic,
  Lock,
  Mail,
  Map,
  MapPin,
  Medal,
  Menu,
  MessageCircle,
  MessageSquare,
  Microscope,
  Minus,
  Monitor,
  Moon,
  MoonStar,
  MoreHorizontal,
  MoreVertical,
  Mountain,
  Music,
  Music2,
  Navigation,
  Newspaper,
  Package,
  Palette,
  Pause,
  Pen,
  PenTool,
  Pencil,
  PieChart,
  Pizza,
  Plane,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  Settings2,
  Share2,
  Shield,
  ShieldCheck,
  Ship,
  Shuffle,
  Signal,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkles,
  Star,
  Stethoscope,
  Sun,
  SunMedium,
  Sunrise,
  Sunset,
  Tablet,
  Terminal,
  ThumbsUp,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  Truck,
  Tv,
  Twitch,
  Twitter,
  Unlock,
  Upload,
  User,
  Users,
  Video,
  Volume2,
  VolumeX,
  Wallet,
  Wand2,
  Waves,
  Wifi,
  Wrench,
  X,
  Youtube,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Lucide 图标值前缀 */
export const LUCIDE_PREFIX = "lucide:";

/**
 * 图标白名单：可用的 lucide 图标（按需打包）。
 * key 为 PascalCase 导出名；新增图标时在此追加并补充 import 即可，
 * 后台选择器的候选列表会自动同步（见 LUCIDE_ICON_NAMES）。
 */
export const LUCIDE_ICON_WHITELIST: Record<string, LucideIcon> = {
  Activity,
  AlertCircle,
  Anchor,
  ArrowUpRight,
  Award,
  Banknote,
  BarChart,
  BarChart3,
  Battery,
  Bell,
  Bitcoin,
  Book,
  Bookmark,
  BookOpen,
  Box,
  Briefcase,
  Brush,
  Building,
  Bug,
  Cake,
  Calendar,
  Camera,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Clipboard,
  Clock,
  Cloud,
  CloudMoon,
  CloudSun,
  Code,
  Coffee,
  Coins,
  Compass,
  Copy,
  Cpu,
  CreditCard,
  Database,
  Disc,
  Dog,
  Download,
  Dumbbell,
  Edit,
  ExternalLink,
  Facebook,
  Feather,
  File,
  FileText,
  Film,
  Fish,
  Flame,
  Flower2,
  Folder,
  FolderOpen,
  Gamepad2,
  Gift,
  Github,
  Gitlab,
  Globe,
  Hammer,
  HardDrive,
  Headphones,
  Heart,
  HeartPulse,
  HelpCircle,
  Home,
  House,
  IceCream,
  Image,
  Info,
  Instagram,
  Key,
  KeyRound,
  Laptop,
  Layers,
  Leaf,
  Link,
  Link2,
  ListMusic,
  Lock,
  Mail,
  Map,
  MapPin,
  Medal,
  Menu,
  MessageCircle,
  MessageSquare,
  Microscope,
  Minus,
  Monitor,
  Moon,
  MoonStar,
  MoreHorizontal,
  MoreVertical,
  Mountain,
  Music,
  Music2,
  Navigation,
  Newspaper,
  Package,
  Palette,
  Pause,
  Pen,
  PenTool,
  Pencil,
  PieChart,
  Pizza,
  Plane,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  Settings2,
  Share2,
  Shield,
  ShieldCheck,
  Ship,
  Shuffle,
  Signal,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkles,
  Star,
  Stethoscope,
  Sun,
  SunMedium,
  Sunrise,
  Sunset,
  Tablet,
  Terminal,
  ThumbsUp,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  Truck,
  Tv,
  Twitch,
  Twitter,
  Unlock,
  Upload,
  User,
  Users,
  Video,
  Volume2,
  VolumeX,
  Wallet,
  Wand2,
  Waves,
  Wifi,
  Wrench,
  X,
  Youtube,
  Zap,
};

/**
 * PascalCase → kebab-case 转换
 * 例如 "ChevronsRight" → "chevrons-right"、"Settings2" → "settings-2"
 *
 * 转换结果直接作为 LUCIDE_ICONS_BY_NAME 的 key，查表时用同一份 key，
 * 故存成 "lucide:settings-2" 再解析回来必定命中同一条目（闭环自洽）。
 */
export function pascalToKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
}

/** kebab-case 图标名 → Lucide 组件（由 LUCIDE_ICON_WHITELIST 派生，不单独维护） */
export const LUCIDE_ICONS_BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(LUCIDE_ICON_WHITELIST).map(([pascal, Comp]) => [pascalToKebabCase(pascal), Comp])
);

/** 可选图标名列表（kebab-case，后台选择器直接消费） */
export const LUCIDE_ICON_NAMES: string[] = Object.keys(LUCIDE_ICONS_BY_NAME);

/**
 * 判断图标值是否为 lucide 格式（以 lucide: 开头）
 */
export function isLucideIcon(iconValue: string): boolean {
  return iconValue?.startsWith(LUCIDE_PREFIX);
}

/**
 * 从 lucide:xxx 格式的值中提取纯图标名（kebab-case）
 * 例如 "lucide:github" → "github"
 */
export function extractLucideIconName(iconValue: string): string {
  if (isLucideIcon(iconValue)) {
    return iconValue.slice(LUCIDE_PREFIX.length);
  }
  return "";
}

/**
 * 根据 kebab-case 图标名在白名单中查找 Lucide 图标组件。
 * 找不到（未收录白名单）时返回 null，调用方回退默认图标。
 * 同时兼容历史数据中的裸图标名（如 "book-open"）。
 */
export function getLucideIconByName(name: string): LucideIcon | null {
  if (!name) return null;
  return LUCIDE_ICONS_BY_NAME[name] ?? null;
}

/**
 * 根据图标值（支持 lucide: 前缀）解析 Lucide 图标组件
 * - 若为 lucide:xxx 格式，在白名单中查找对应图标
 * - 若不是 lucide 格式，返回 null（由调用方处理回退逻辑）
 */
export function resolveLucideIcon(iconValue: string): LucideIcon | null {
  if (!isLucideIcon(iconValue)) return null;
  const name = extractLucideIconName(iconValue);
  return getLucideIconByName(name);
}