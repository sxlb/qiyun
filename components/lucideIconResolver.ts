"use client";

/**
 * Lucide 图标解析工具
 * - 支持 "lucide:xxx" 前缀格式的图标值
 * - 从固定白名单映射表中查找对应图标组件
 *   （避免 `import * as` + 动态属性访问使 Next.js optimizePackageImports 失效，
 *   全部 ~1500 个图标被打进客户端 bundle；白名单只打包实际用到的图标）
 * - 提供 kebab-case → PascalCase 转换
 */

import {
  Activity,
  AlertCircle,
  Anchor,
  ArrowUpRight,
  Award,
  Banknote,
  BarChart3,
  Battery,
  Bell,
  Bitcoin,
  Book,
  BookOpen,
  Box,
  Brush,
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
  ExternalLink,
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
  Info,
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
  MessageCircle,
  Microscope,
  Minus,
  Monitor,
  Moon,
  MoonStar,
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
  Terminal,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  Truck,
  Tv,
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
 * 图标白名单：后台链接图标可选用的 lucide 图标（按需打包）。
 * key 为 PascalCase 导出名；新增图标时在此追加并补充 import 即可。
 */
export const LUCIDE_ICON_WHITELIST: Record<string, LucideIcon> = {
  Activity,
  AlertCircle,
  Anchor,
  ArrowUpRight,
  Award,
  Banknote,
  BarChart3,
  Battery,
  Bell,
  Bitcoin,
  Book,
  BookOpen,
  Box,
  Brush,
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
  ExternalLink,
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
  Info,
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
  MessageCircle,
  Microscope,
  Minus,
  Monitor,
  Moon,
  MoonStar,
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
  Terminal,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  Truck,
  Tv,
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
 * kebab-case → PascalCase 转换
 * 例如 "chevron-right" → "ChevronRight"
 */
export function kebabToPascalCase(str: string): string {
  return str
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * 根据 kebab-case 图标名在白名单中查找 Lucide 图标组件
 * 找不到（未收录白名单）时返回 null，调用方回退默认图标
 */
export function getLucideIconByName(name: string): LucideIcon | null {
  if (!name) return null;
  const pascalName = kebabToPascalCase(name);
  return LUCIDE_ICON_WHITELIST[pascalName] ?? null;
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
