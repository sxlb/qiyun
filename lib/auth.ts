import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { isValidIp } from "@/lib/ip";

// ---- 类型增强：把"是否需要强制改密"标记透传到 session / JWT ----
declare module "next-auth" {
  interface User {
    mustChangePassword?: boolean;
    sessionVersion?: number;
  }
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      mustChangePassword?: boolean;
      sessionVersion?: number;
    };
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    mustChangePassword?: boolean;
    sessionVersion?: number;
  }
}

// 运行时安全校验：确保环境变量已配置
let envChecked = false;
function validateAuthEnv() {
  if (envChecked) return;
  envChecked = true;

  const secret = process.env.NEXTAUTH_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    throw new Error("[auth] NEXTAUTH_SECRET 未设置，请使用 `openssl rand -base64 32` 生成后写入环境变量");
  }
  if (secret.length < 32) {
    throw new Error("[auth] NEXTAUTH_SECRET 长度不足 32 字符");
  }
  if (isProd) {
    if (
      secret === "dev-only-do-not-use-in-production-please-change-32chars" ||
      secret === "change-me-to-a-random-string-32-chars-or-more" ||
      secret === "please-change-this-to-a-random-32-char-string"
    ) {
      throw new Error("[auth] 生产环境 NEXTAUTH_SECRET 仍为示例值，请修改为真实随机密钥");
    }
  }
}

// 简单内存限流：5 分钟窗口内失败 5 次后锁定 10 分钟。
// 限流按"来源 IP + 账号"维度计数（key = login:<ip>），避免：
// 1) 任意来源的失败请求锁死真实管理员（全局单 key 的 DoS）；
// 2) 多 IP 分布式爆破各自独立计数绕过。
// 单实例部署有效；多实例/Serverless 需改用 Redis 等共享存储。
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;

type Attempt = { count: number; firstAt: number; lockUntil: number };
const attempts = new Map<string, Attempt>();

// 上限保护：攻击者可通过伪造 x-forwarded-for 等头生成大量不同 key。
// 若不设上限，attempts Map 会随唯一 key 数量无界增长（内存 DoS）。
// 超限时先清理已过期条目，仍超限则按插入顺序淘汰最旧条目（Map 保持插入序）。
const MAX_ATTEMPT_KEYS = 5_000;

function pruneAttempts(now: number): void {
  if (attempts.size < MAX_ATTEMPT_KEYS) return;
  for (const [k, a] of attempts) {
    const expired = (a.lockUntil > 0 && now >= a.lockUntil) || now - a.firstAt > WINDOW_MS;
    if (expired) attempts.delete(k);
  }
  while (attempts.size >= MAX_ATTEMPT_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

/**
 * 头对象的最小兼容形态：
 * - Next.js 路由的 NextRequest.headers（Headers，有 get 方法）
 * - next-auth authorize 回调的 req.headers（Record<string, any>，key 为小写）
 */
type LoginHeaderSource =
  | Headers
  | { get?: (name: string) => string | null }
  | Record<string, unknown>
  | undefined;

/** 从两种头对象形态中读取同名头值（数组头拼接为逗号分隔） */
function readLoginHeader(headers: LoginHeaderSource, name: string): string {
  if (!headers) return "";
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get: (n: string) => string | null }).get(name) ?? "";
  }
  const v = (headers as Record<string, unknown>)[name.toLowerCase()];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return (v as string[]).join(",");
  return "";
}

/**
 * 从请求头提取限流 key（按来源 IP）：优先 x-forwarded-for 首个合法 IP，
 * 其次 x-real-ip；均非法/缺失时回退 "unknown"。
 *
 * 信任模型说明：个人站点常见两种部署——
 * 1) 位于可信反向代理/CDN 之后：转发头由代理写入，取值准确；
 * 2) 直接暴露公网：转发头可被请求方任意伪造。
 * 无论哪种场景，伪造只会让攻击者把失败次数记到"自己伪造的 key"上（自锁），
 * 无法绕过真正的防线：已存在账号的 userKey（login:user:<username>）按账号维度
 * 独立锁定，不依赖 IP。此处仅做严格结构校验（拒绝越界 IPv4/超长/非 IP 字符），
 * 并把 key 总量限制在 MAX_ATTEMPT_KEYS 内，防止伪造头撑爆内存。
 */
export function getLoginRateLimitKey(headers?: LoginHeaderSource): string {
  let ip = "";
  const xff = readLoginHeader(headers, "x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (isValidIp(first)) ip = first;
  }
  if (!ip) {
    const real = readLoginHeader(headers, "x-real-ip").trim();
    if (isValidIp(real)) ip = real;
  }
  return `login:${ip || "unknown"}`;
}

export function checkRateLimit(key = "admin"): { locked: boolean; remainingMs: number } {
  const now = Date.now();
  pruneAttempts(now);
  const a = attempts.get(key);

  if (a && now < a.lockUntil) {
    return { locked: true, remainingMs: a.lockUntil - now };
  }
  if (a && now >= a.lockUntil && a.lockUntil > 0) {
    attempts.delete(key);
    return { locked: false, remainingMs: 0 };
  }
  if (a && now - a.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return { locked: false, remainingMs: 0 };
  }

  return { locked: false, remainingMs: 0 };
}

export function recordFailedAttempt(key = "admin") {
  const now = Date.now();
  pruneAttempts(now);
  const a = attempts.get(key) || { count: 0, firstAt: now, lockUntil: 0 };

  if (now < a.lockUntil) return;
  if (now - a.firstAt > WINDOW_MS) {
    a.count = 0;
    a.firstAt = now;
  }

  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockUntil = now + LOCK_MS;
  }
  attempts.set(key, a);
}

function clearAttempts(key = "admin") {
  attempts.delete(key);
}

/** 账号维度限流 key（仅对已存在用户使用，避免锁定差异泄露账号存在性） */
export function getLoginUserRateKey(username: string): string {
  return `login:user:${username.toLowerCase()}`;
}

/** 清空全部登录限流状态（测试用） */
export function resetLoginRateLimit(): void {
  attempts.clear();
}

// 预先生成的 dummy 哈希，用于用户不存在时保持响应时间一致（防时序攻击）
// 这是一个 bcrypt 哈希字符串，对任意密码 compare 都会返回 false 但消耗相同时间
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "账号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials, req) {
        validateAuthEnv();

        // 限流检查：按来源 IP 维度计数（不抛异常，会被 NextAuth 吞掉，直接返回 null）
        // 前端通过 /api/auth/rate-limit 公开接口判断当前 IP 是否被锁定
        const rateKey = getLoginRateLimitKey(req?.headers);
        const { locked } = checkRateLimit(rateKey);
        if (locked) {
          return null;
        }

        if (!credentials?.username || !credentials?.password) return null;

        // 从数据库查询用户
        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
        });

        // 时序攻击防护：用户不存在时也执行一次 bcrypt.compare，保持响应时间一致
        if (!user) {
          await bcrypt.compare(credentials.password, DUMMY_HASH);
          recordFailedAttempt(rateKey);
          return null;
        }

        // 账号维度锁定检查（用户存在后）：多 IP 分布式爆破时锁账号本身
        const userKey = getLoginUserRateKey(credentials.username);
        const userLock = checkRateLimit(userKey);
        if (userLock.locked) {
          return null;
        }

        // bcrypt 验证密码
        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
          recordFailedAttempt(rateKey);
          recordFailedAttempt(userKey);
          return null;
        }

        // 两步验证：密码通过后校验 TOTP（开启时）
        // 验证码缺失/错误同样计入失败次数（双 key），防暴力尝试验证码
        const code = (credentials as { totpCode?: string }).totpCode?.trim() || "";
        if (user.twoFactorEnabled) {
          if (!code || !verifyTOTP(user.twoFactorSecret, code)) {
            recordFailedAttempt(rateKey);
            recordFailedAttempt(userKey);
            return null;
          }
        }

        clearAttempts(rateKey);
        clearAttempts(userKey);

        // 登录成功后按需刷新版本缓存（fire-and-forget，不阻塞登录；短时重复登录自动去重）。
        // 这样每次进入后台都能拿到较新的"最新版本"提示。
        void refreshLoginVersionCache();

        return {
          id: String(user.id),
          name: user.username,
          mustChangePassword: user.mustChangePassword,
          sessionVersion: user.sessionVersion ?? 0,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      // 首次登录：把"是否需要强制改密"与"会话版本号"写入 token
      if (user) {
        const u = user as { mustChangePassword?: boolean; sessionVersion?: number };
        token.mustChangePassword = u.mustChangePassword ?? false;
        token.sessionVersion = u.sessionVersion ?? 0;
      }
      // 改密成功触发 session.update() 时，从数据库读取最新标记，
      // 保证"改密后提示条消失"无需重新登录也能立即生效。
      if (trigger === "update" && token.name) {
        try {
          const fresh = await prisma.user.findUnique({
            where: { username: token.name },
            select: { mustChangePassword: true, sessionVersion: true },
          });
          token.mustChangePassword = fresh?.mustChangePassword ?? token.mustChangePassword ?? false;
          token.sessionVersion = fresh?.sessionVersion ?? token.sessionVersion ?? 0;
        } catch {
          // DB 读取异常时保留原标记，不影响登录流程
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.mustChangePassword = token.mustChangePassword ?? false;
        session.user.sessionVersion = token.sessionVersion ?? 0;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export { validateAuthEnv };

/**
 * 校验会话是否已被吊销（改密 / 重置默认 / 账号被删）。
 *
 * JWT 策略下 token 默认 30 天内始终有效，改密码并不会让它失效；
 * 因此引入 User.sessionVersion：登录时写入 token，敏感操作时自增，
 * 两者不一致即说明该 token 已过期，应视为未登录。
 *
 * 数据库异常时返回 false（不误判失效），避免把管理员锁在门外。
 */
export async function isSessionRevoked(
  session: { user?: { name?: string | null; sessionVersion?: number } } | null
): Promise<boolean> {
  const name = session?.user?.name;
  if (!name) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { username: name },
      select: { sessionVersion: true },
    });
    // 账号已不存在（被删除或改名）：当前 token 同样应当失效
    if (!user) return true;
    return (session?.user?.sessionVersion ?? 0) !== (user.sessionVersion ?? 0);
  } catch {
    return false;
  }
}

/**
 * 登录成功后触发版本缓存按需刷新（fire-and-forget）。
 * 懒加载避免 auth 与 version 模块在启动期强耦合；任何异常都不影响登录流程。
 */
async function refreshLoginVersionCache(): Promise<void> {
  try {
    const { refreshVersionCacheOnLogin } = await import("@/lib/version");
    await refreshVersionCacheOnLogin();
  } catch {
    // 刷新失败（出网/写盘异常）仅影响"检测更新"提示，不影响登录
  }
}

// ===== 两步验证 TOTP（合并自 totp.ts） =====

/**
 * TOTP（RFC 6238）零依赖实现：HMAC-SHA1 + base32 secret + 30s 步长。
 * 用于后台两步验证（与 Google Authenticator / 1Password 等兼容）。
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 生成随机 base32 secret（20 字节 → 32 字符，无 padding） */
export function generateSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** base32 解码（容忍小写与 padding/空格） */
function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** HOTP（RFC 4226）：HMAC-SHA1 动态截断 → 6 位数字 */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/**
 * 验证 TOTP 验证码：30s 步长，允许 ±window 步时间漂移（默认 ±1 步）。
 */
export function verifyTOTP(secret: string, code: string, window = 1): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const decoded = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (hotp(decoded, counter + i) === normalized) return true;
  }
  return false;
}

/** 生成 otpauth:// URI（可复制到 Authenticator 手动添加或扫码） */
export function buildOtpauthUrl(secret: string, account = "admin"): string {
  return `otpauth://totp/${encodeURIComponent(account)}?secret=${secret}&issuer=Qiyun&algorithm=SHA1&digits=6&period=30`;
}
