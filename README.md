# 栖云 · Qiyun

**栖息于云端，构建你的数字空间。**

Next.js 15 + TypeScript + Tailwind CSS + Prisma（SQLite）的个人主页 / 导航首页，内置后台管理，Docker 一键部署，推送自动发版。

## 功能亮点

**前台**：动态壁纸（必应 / 动漫 / 风景）、音乐播放器（Meting / QQ 音乐）、时钟天气、导航链接、作品集、氛围特效、全局命令面板、访问统计、SEO 后台可配。

**后台**（`/admin`）：全站可视化配置——站点信息、主题壁纸、音乐、社交链接、作品集、技能云、天气设置；账号管理、操作审计、数据导入导出。

**安全**：SSRF 防护 · TOTP 二次验证 · 全 API Zod 校验 · CSP 响应头 · 操作日志审计。

[部署教程](docs/deploy-1panel.md) · [变更日志](CHANGELOG.md) · [字体许可](FONT_LICENSES.md)

## 快速开始

### 服务器部署

```bash
./deploy.sh latest        # GHCR 镜像拉取并启动
```

详见 → [宝塔 / 1Panel 部署教程](docs/deploy-1panel.md)

### 本地开发

```bash
npm install && cp .env.example .env
npx prisma migrate deploy && node prisma/seed.js
npm run dev
```

前台 `http://localhost:3000` · 后台 `http://localhost:3000/admin` · 默认账号 `admin / 123456`

## 技术栈

| 领域 | 选型 |
|------|------|
| 框架 | Next.js 15 (App Router, standalone) |
| 数据库 | SQLite + Prisma 5.22 ORM |
| 认证 | NextAuth v4 + JWT + TOTP 2FA |
| 测试 | Vitest · 59 文件 / 545 用例 |
| CI/CD | GitHub Actions → GHCR 镜像自动发布 |

## 系统架构

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" font-family="'Inter', 'Noto Sans SC', sans-serif" font-size="12">
  <rect width="800" height="400" fill="#0f172a" rx="8"/>
  <text x="400" y="28" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="bold">请求生命周期与系统分层</text>
  <!-- Client -->
  <g transform="translate(20, 55)">
    <rect width="110" height="310" rx="6" fill="#1e293b" stroke="#334155"/>
    <text x="55" y="18" text-anchor="middle" fill="#94a3b8" font-size="11" font-weight="bold">客户端</text>
    <circle cx="25" cy="50" r="12" fill="#3b82f6" opacity="0.3"/><text x="25" y="54" text-anchor="middle" fill="#60a5fa" font-size="9">⚡</text><text x="48" y="54" fill="#cbd5e1">Next.js SSR/ISR</text>
    <circle cx="25" cy="85" r="12" fill="#8b5cf6" opacity="0.3"/><text x="25" y="89" text-anchor="middle" fill="#a78bfa" font-size="9">🔐</text><text x="48" y="89" fill="#cbd5e1">NextAuth JWT</text>
    <circle cx="25" cy="120" r="12" fill="#06b6d4" opacity="0.3"/><text x="25" y="124" text-anchor="middle" fill="#22d3ee" font-size="9">📊</text><text x="48" y="124" fill="#cbd5e1">Stats POST</text>
    <circle cx="25" cy="155" r="12" fill="#f59e0b" opacity="0.3"/><text x="25" y="159" text-anchor="middle" fill="#fbbf24" font-size="9">💾</text><text x="48" y="159" fill="#cbd5e1">Admin CRUD</text>
    <circle cx="25" cy="190" r="12" fill="#10b981" opacity="0.3"/><text x="25" y="194" text-anchor="middle" fill="#34d399" font-size="9">🌐</text><text x="48" y="194" fill="#cbd5e1">外部代理访问</text>
    <line x1="15" y1="220" x2="100" y2="220" stroke="#334155"/><text x="55" y="240" text-anchor="middle" fill="#64748b" font-size="9">Browser / Spider</text>
  </g>
  <!-- Server API Layer -->
  <g transform="translate(150, 55)">
    <rect width="260" height="310" rx="6" fill="#1e293b" stroke="#334155"/>
    <text x="130" y="18" text-anchor="middle" fill="#94a3b8" font-size="11" font-weight="bold">Next.js 15 App Router</text>
    <rect x="15" y="35" width="230" height="42" rx="4" fill="#1e3a5f" stroke="#3b82f6" opacity="0.5"/>
    <text x="130" y="53" text-anchor="middle" fill="#93c5fd" font-size="10" font-weight="bold">API Route Handlers</text>
    <text x="130" y="68" text-anchor="middle" fill="#64748b" font-size="9">认证 → Zod 校验 → Rate Limit → 业务逻辑</text>
    <rect x="15" y="95" width="230" height="42" rx="4" fill="#2d1b4e" stroke="#8b5cf6" opacity="0.5"/>
    <text x="130" y="113" text-anchor="middle" fill="#c4b5fd" font-size="10" font-weight="bold">安全守卫层</text>
    <text x="130" y="128" text-anchor="middle" fill="#64748b" font-size="9">SSRF 白名单 · TOTP · CSP · 响应头</text>
    <rect x="15" y="155" width="230" height="42" rx="4" fill="#1a3d2e" stroke="#10b981" opacity="0.5"/>
    <text x="130" y="173" text-anchor="middle" fill="#6ee7b7" font-size="10" font-weight="bold">Prisma ORM</text>
    <text x="130" y="188" text-anchor="middle" fill="#64748b" font-size="9">连接池 · 事务 · Migrate Deploy · 类型安全</text>
    <rect x="15" y="215" width="230" height="42" rx="4" fill="#3d2b1a" stroke="#f59e0b" opacity="0.5"/>
    <text x="130" y="233" text-anchor="middle" fill="#fcd34d" font-size="10" font-weight="bold">第三方上游服务</text>
    <text x="130" y="248" text-anchor="middle" fill="#64748b" font-size="9">Bing · Meting · Amap · Tencent Weather</text>
    <rect x="15" y="270" width="230" height="30" rx="4" fill="#0c1426" stroke="#334155"/>
    <text x="130" y="289" text-anchor="middle" fill="#64748b" font-size="9">SQLite .db → Standalone Output</text>
  </g>
  <!-- Database -->
  <g transform="translate(430, 100)">
    <ellipse cx="70" cy="25" rx="55" ry="18" fill="#334155" stroke="#64748b"/>
    <line x1="15" y1="25" x2="15" y2="140" stroke="#64748b" stroke-width="2"/>
    <line x1="125" y1="25" x2="125" y2="140" stroke="#64748b" stroke-width="2"/>
    <ellipse cx="70" cy="140" rx="55" ry="18" fill="#1e293b" stroke="#64748b"/>
    <rect x="15" y="25" width="110" height="115" fill="#1e293b" stroke="#64748b"/>
    <text x="70" y="62" text-anchor="middle" fill="#60a5fa" font-size="11" font-weight="bold">SQLite</text>
    <text x="70" y="80" text-anchor="middle" fill="#94a3b8" font-size="9">single file</text>
    <text x="70" y="95" text-anchor="middle" fill="#94a3b8" font-size="9">prod.db</text>
    <text x="70" y="115" text-anchor="middle" fill="#64748b" font-size="9">~KB ~MB scale</text>
  </g>
  <!-- Arrows -->
  <defs><marker id="ab" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#3b82f6"/></marker></defs>
  <line x1="130" y1="100" x2="150" y2="100" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#ab)"/>
  <text x="140" y="95" fill="#3b82f6" font-size="8">HTTPS</text>
  <line x1="410" y1="200" x2="430" y2="160" stroke="#10b981" stroke-width="1.5"/>
  <text x="418" y="175" fill="#10b981" font-size="8">SQL</text>
  <line x1="410" y1="260" x2="430" y2="260" stroke="#f59e0b" stroke-width="1.5"/>
  <text x="418" y="255" fill="#f59e0b" font-size="8">HTTP</text>
  <!-- Footer -->
  <text x="400" y="385" text-anchor="middle" fill="#64748b" font-size="10">Stack: Next.js 15 · Prisma 5.22 · Zod 3.23 · TOTP 2FA · SQLite · Standalone · Vitest 545 Tests</text>
</svg>
```

> 上图：客户端请求经 `App Router` 分发到各 API 路由，依次通过认证 → Zod 校验 → Rate Limit 守卫，最终由 Prisma ORM 操作 SQLite 或代理请求第三方服务。

## 项目结构

```
├── app/                  # 路由与页面（App Router）
│   ├── api/              # API 路由（认证/配置/壁纸/音乐/天气/统计/更新）
│   ├── admin/            # 后台管理
│   └── page.tsx          # 首页
├── components/           # UI 组件
├── lib/                  # 核心逻辑（auth/ssrf/validation/update）
├── docs/                 # 部署教程
├── prisma/               # Schema、迁移（48+）、seed
├── public/fonts/         # 自托管字体
├── scripts/              # 宿主机更新执行器
├── tests/                # Vitest 测试（59 文件 / 545 用例）
├── .github/workflows/    # CI/CD 自动发版（源码需要，镜像构建产物不打包）
└── deploy.sh / Dockerfile / docker-compose.yml
```

## 许可

保留作者版权信息，未经授权请勿整站抄袭。