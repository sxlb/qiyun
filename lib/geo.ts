/**
 * 离线 IP 归属解析（ip2region 本地数据库，无外部 HTTP 依赖）。
 * 数据包自带 ip2region.db（IPv4）+ ipv6wry.db（IPv6），无需联网/密钥。
 * 首次使用时惰性加载实例并缓存，避免拖慢首屏无关请求。
 */
import IP2Region from "ip2region";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface RegionInfo {
  country: string;
  province: string;
  city: string;
  /** 内网/回环/保留地址或解析失败（不计入地域展示，归"局域网/未知"） */
  internal: boolean;
}

// ip2region 的默认数据库路径是相对包内 __dirname 推导的（dist/lib/../../data）。
// Next.js 服务端打包会把包内文件合入 .next/，__dirname 被改写后相对路径即失效，
// 因此这里显式按包入口定位数据库的真实绝对路径，兼容 dev/生产与 vitest。
const _require = createRequire(import.meta.url);

let _pkgDir: string | null = null;
function pkgDir(): string | null {
  if (_pkgDir) return _pkgDir;
  try {
    // 入口 = <pkg>/dist/lib/index.js，向上三级即包根目录
    _pkgDir = resolve(_require.resolve("ip2region"), "..", "..", "..");
  } catch {
    _pkgDir = "missing";
  }
  return _pkgDir === "missing" ? null : _pkgDir;
}

function findDb(name: "ip2region.db" | "ipv6wry.db"): string | null {
  const candidates = [
    // 由包入口推导（esbuild/vitest/Node 均稳定）
    { root: pkgDir(), prefix: "data" },
    // 项目根 node_modules（Next 服务端进程 cwd=项目根）
    { root: process.cwd(), prefix: "node_modules/ip2region/data" },
  ];
  for (const c of candidates) {
    if (!c.root) continue;
    const p = resolve(c.root, c.prefix, name);
    if (existsSync(p)) return p;
  }
  return null;
}

let instance: IP2Region | null = null;

/** 惰性单例：进程内复用同一份数据库句柄 */
function getInstance(): IP2Region {
  if (!instance) {
    const ipv4db = findDb("ip2region.db");
    if (!ipv4db) {
      // 兜底走库默认相对路径（依赖 __dirname 未被改写）
      instance = new IP2Region();
    } else {
      const ipv6db = findDb("ipv6wry.db");
      instance = new IP2Region({ ipv4db, ipv6db: ipv6db ?? undefined, disableIpv6: !ipv6db });
    }
  }
  return instance;
}

// 私有/回环/保留网段（IPv4）
const PRIVATE_RX = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/;
// 回环/链路本地/ULA（IPv6 前缀）
const PRIVATE_V6 = ["::1", "::", "fe80:", "fc", "fd"];

const INTERNAL_MARKER = /内网|局域网|保留|未分配|IANA/;

function normalize(s?: string): string {
  return (s ?? "").replace(/\s/g, "").replace(/^[0]+$/, "");
}

/**
 * 解析 IP 所属地域。
 * - 内网/回环/保留或查库失败 → internal=true（页面归入"局域网/未知"）
 * - 其余返回国家/省/市（ip2region 对国内精确到省市级，海外到国家）
 * 纯同步、无网络，可安全用于批量统计。
 */
export function lookupIpRegion(ip: string): RegionInfo {
  const empty: RegionInfo = { country: "", province: "", city: "", internal: true };

  if (!ip) return empty;
  const v = ip.trim().toLowerCase();
  if (PRIVATE_RX.test(ip) || PRIVATE_V6.some((p) => v.startsWith(p))) return empty;

  let res;
  try {
    res = getInstance().search(v);
  } catch {
    return empty;
  }
  if (!res) return empty;

  const raw = [res.country, res.province, res.city].filter(Boolean).join(" ");
  if (INTERNAL_MARKER.test(raw)) return empty;

  const info: RegionInfo = {
    country: normalize(res.country),
    province: normalize(res.province),
    city: normalize(res.city),
    internal: false,
  };
  return info;
}

/** 生成地域展示标签：内网 → 局域网/未知；海外 → 国家；国内 → 国家+省(+市) */
export function regionLabel(info: RegionInfo): string {
  if (info.internal) return "局域网/未知";
  const parts = [info.country, info.province, info.city].filter(Boolean);
  return parts.join(" ") || "未知";
}