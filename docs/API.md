# 栖云 · Qiyun — API 文档

> **项目**: 栖云（Qiyun）个人主页 / 导航首页  
> **框架**: Next.js 16 · App Router  
> **数据库**: SQLite · Prisma ORM  
> **认证**: NextAuth.js + JWT (sessionVersion 踢出机制)

---

## 目录

- [通用规范](#通用规范)
  - [统一响应格式](#统一响应格式)
  - [认证方式](#认证方式)
  - [Rate Limit 汇总](#rate-limit-汇总)
  - [错误码约定](#错误码约定)
- [业务模块](#业务模块)
  - [1. 用户认证 (Auth)](#1-用户认证-auth)
  - [2. 个人资料 (Profile)](#2-个人资料-profile)
  - [3. 账号管理 (Account)](#3-账号管理-account)
    - [3a. 两步验证 (2FA)](#3a-两步验证-2fa)
  - [4. 社交链接 (Social Links)](#4-社交链接-social-links)
  - [5. 网站链接 (Site Links)](#5-网站链接-site-links)
  - [6. 友情链接 (Friend Links)](#6-友情链接-friend-links)
  - [7. 作品/项目 (Projects)](#7-作品项目-projects)
  - [8. 技能标签 (Skills)](#8-技能标签-skills)
  - [9. 公告 (Announcements)](#9-公告-announcements)
    - [9a. 公开公告端点](#9a-公开公告端点)
  - [10. 媒体库 (Media)](#10-媒体库-media)
    - [10a. 复制媒体资产](#10a-复制媒体资产)
  - [11. 文件上传 (Uploads)](#11-文件上传-uploads)
    - [11a. 文件服务](#11a-文件服务)
  - [12. 数据统计 (Stats)](#12-数据统计-stats)
    - [12a. 点击统计 (Click Tracking)](#12a-点击统计-click-tracking)
    - [12b. 数据看板 (Dashboard)](#12b-数据看板-dashboard)
    - [12c. 地域分布 (Geo)](#12c-地域分布-geo)
  - [13. 操作日志 (Operation Logs)](#13-操作日志-operation-logs)
    - [13a. 清理日志](#13a-清理日志)
    - [13b. 导出 CSV](#13b-导出-csv)
  - [14. 备份恢复 (Backup)](#14-备份恢复-backup)
    - [14a. 恢复备份](#14a-恢复备份)
  - [15. 系统工具 (System Utilities)](#15-系统工具-system-utilities)
    - [15a. 容器探针](#15a-容器探针)
    - [15b. 服务健康探测](#15b-服务健康探测)
    - [15c. Favicon 探测](#15c-favicon-探测)
    - [15d. 天气服务](#15d-天气服务)
    - [15e. 必应壁纸代理](#15e-必应壁纸代理)
    - [15f. 壁纸缓存服务](#15f-壁纸缓存服务)
    - [15g. 音乐播放代理](#15g-音乐播放代理)
    - [15h. 一言服务](#15h-一言服务)
    - [15i. Iconify 图标集目录](#15i-iconify-图标集目录)
    - [15j. 访客地域解析](#15j-访客地域解析)
    - [15k. 重置默认值](#15k-重置默认值)
    - [15l. GitHub 加速代理管理](#15l-github-加速代理管理)
    - [15m. 更新状态查询](#15m-更新状态查询)
    - [15n. 触发更新/回滚](#15n-触发更新回滚)
    - [15o. 外部服务连通性测试](#15o-外部服务连通性测试)
- [数据字典](#数据字典)
- [附录：链接列表 API 模式](#附录链接列表-api-模式)

---

## 通用规范

### 统一响应格式

所有 API 返回 `application/json`，使用 UTF-8 编码。

**成功响应**（200/201）：

```json
{
  "key": "value",
  ...
}
```

部分接口使用包裹格式：

```json
{
  "ok": true,
  "message": "操作成功",
  "data": { ... }
}
```

**错误响应**（4xx / 5xx）：

```json
{
  "error": "错误描述信息"
}
```

常见 HTTP 状态码：

| 状态码 | 含义                 |
| ------ | -------------------- |
| 200    | 请求成功             |
| 201    | 创建成功             |
| 400    | 请求参数错误         |
| 401    | 未授权 / 未登录      |
| 403    | 禁止操作（如密码错误） |
| 404    | 资源不存在           |
| 409    | 冲突（如用户名已存在） |
| 429    | 请求过于频繁（限流） |
| 500    | 服务器内部错误       |
| 502    | 上游服务不可用       |
| 503    | 服务不可用（依赖异常）|

### 认证方式

| 类型     | 说明                                          | 适用接口                       |
| -------- | --------------------------------------------- | ------------------------------ |
| **无需认证** | 完全公开                                     | `/api/ping`, `/api/bing`, `/api/wallpaper` 等 |
| **匿名 IP 限流** | 无需登录但需防刷，按 IP 限流               | `/api/stats`, `/api/stats/click` |
| **NextAuth Session** | 需管理员登录（通过 `@/lib/server.ts` 的 `requireSession()` 校验） | 几乎所有后台管理接口 |

会话失效机制：修改密码或执行重置默认后，`User.sessionVersion` 自增，旧 JWT 被判定为吊销。

### Rate Limit 汇总

| 接口路径                           | 限流规则                          | 频率限制                  |
| ---------------------------------- | --------------------------------- | ------------------------- |
| `/api/auth/rate-limit`             | 全局登录限流                      | 见 `lib/auth.ts`          |
| `/api/auth/2fa-status`             | 按 IP                             | 30 次/分钟                |
| `/api/account`                     | 按用户名                          | 5 次/60 秒                |
| `/api/account/2fa`                 | 按用户名+IP 双维度               | 10 次/分钟 (user) + 20 次/分钟 (IP) |
| `/api/profile`                     | 按用户名                          | 10 次/60 秒               |
| `/api/uploads` (POST)              | 按 IP                             | 3 次/60 秒                |
| `/api/projects` (PUT)              | 按用户名                          | 10 次/60 秒               |
| `/api/skills` (PUT)                | 按用户名                          | 10 次/60 秒               |
| `/api/announcements` (PUT)         | 按用户名                          | 10 次/60 秒               |
| `/api/stats` (POST)                | 按 IP                             | 30 次/分钟                |
| `/api/stats/click` (POST)          | 按 IP                             | 30 次/分钟                |
| `/api/weather`                     | 按访客 IP                         | 30 次/分钟                |
| `/api/backup/restore` (POST)       | 按 IP                             | 3 次/60 秒                |
| `/api/reset-default` (POST)        | 按用户名                          | 3 次/60 秒                |
| `/api/icons` (GET)                 | 按管理员账号                      | 30 次/分钟                |
| `/api/external-apis/test` (POST)   | 按管理员账号                      | 20 次/分钟                |
| `/api/update/proxies` (GET ?test)  | 全源并发测试                      | 按需手动触发              |

### 错误码约定

所有错误信息均以中文返回（面向国内用户），具体字段为 `error`。Zod 校验失败时，格式为：

```json
{ "error": "参数校验失败：field_name: 具体错误; field_name2: 具体错误2" }
```

---

## 业务模块

### 1. 用户认证 (Auth)

#### `GET/POST /api/auth/[...nextauth]`

| 属性       | 说明                        |
| ---------- | --------------------------- |
| 认证要求   | 无                          |
| Rate Limit | 由 NextAuth 内置及 `/api/auth/rate-limit` 控制 |

**描述**：NextAuth.js 标准路由，处理所有认证相关流程（登录、登出、OAuth 回调等）。认证策略在 `@/lib/auth.ts` 的 `authOptions` 中定义，采用 JWT 策略。

**客户端调用示例**：
```ts
import { signIn, signOut, getSession } from "next-auth/react";
// 登录
signIn("credentials", { username, password, callbackUrl: "/admin" });
// 获取会话
const session = await getSession();
```

---

#### `GET /api/auth/2fa-status`

| 属性       | 说明                                              |
| ---------- | ------------------------------------------------- |
| 认证要求   | 无需登录                                          |
| Rate Limit | 按 IP：30 次/分钟                                 |
| URL 参数   | `username` (可选): 要查询的用户名                 |

**描述**：探测指定账号是否开启了两步验证，用于登录页条件性地显示验证码输入框。

**请求参数**：

| 参数名    | 类型   | 必填 | 说明           |
| --------- | ------ | ---- | -------------- |
| `username` | string | 否   | 目标用户名     |

**成功响应 (200)**：

```json
{ "requires2fa": true }
// 或
{ "requires2fa": false }
```

**错误响应**：始终返回 `{ requires2fa: false }`（即使查询失败也不泄露用户是否存在）。

---

#### `GET /api/auth/rate-limit`

| 属性       | 说明        |
| ---------- | ----------- |
| 认证要求   | 无需登录    |

**描述**：公开接口，查询当前来源 IP 是否因多次登录失败而被锁定。

**成功响应 (200)**：

```json
{
  "locked": false,
  "remainingMs": 0,
  "remainingMinutes": 0
}
```

| 字段            | 类型    | 说明                     |
| --------------- | ------- | ------------------------ |
| `locked`        | boolean | 是否已被锁定             |
| `remainingMs`   | number  | 剩余锁定毫秒数           |
| `remainingMinutes` | number | 预计剩余锁定分钟数（锁定时）|

---

### 2. 个人资料 (Profile)

#### `GET /api/profile`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：获取站点全局配置（头像、背景、壁纸源、主题、SEO、音乐、自定义字体等所有前台展示配置）。

**成功响应 (200)**：完整 Profile 对象（见数据字典），例如：

```json
{
  "id": 1,
  "avatar": "",
  "siteIcon": "",
  "nickname": "无名",
  "bio": "这个人很懒，什么都没写",
  "github": "",
  "email": "",
  "bgApi": "",
  "weatherProvider": "tencent",
  "theme": "system",
  ...
}
```

---

#### `PUT /api/profile`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 每用户 60s 最多 10 次             |

**描述**：保存站点全局配置。使用 upsert 语义（单例模型），仅写入变更字段。

**请求体参数**（JSON）：

| 字段名 | 类型     | 必填 | 说明                          |
| ------ | -------- | ---- | ----------------------------- |
| *(全部 Profile 字段)* | *动态* | *按需* | 仅传输需要修改的字段即可   |

详细字段定义参见[数据字典 - Profile 模型](#profile)。

**成功响应 (200)**：更新后的完整 Profile 对象。若无任何字段变化则返回现有记录。

---

### 3. 账号管理 (Account)

#### `PUT /api/account`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 每用户 60s 最多 5 次              |

**描述**：修改用户名和密码。必须提供当前密码验证，至少修改用户名或密码之一。改密后自动使其他设备会话失效。

**请求体参数**：

| 字段名           | 类型     | 必填 | 说明                                |
| ---------------- | -------- | ---- | ----------------------------------- |
| `username`       | string   | 否   | 新用户名（2~32 字符）                |
| `currentPassword`| string   | 是   | 当前密码                             |
| `newPassword`    | string   | 否   | 新密码（8~128 字符）                 |

**成功响应 (200)**：

```json
{ "success": true, "message": "账号信息已更新" }
```

---

#### 3a. 两步验证 (2FA)

##### `GET /api/account/2fa`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：查询当前登录用户 2FA 启用状态。

**成功响应 (200)**：

```json
{ "enabled": true }  // 或 false
```

---

##### `POST /api/account/2fa`

| 属性       | 说明                                      |
| ---------- | ----------------------------------------- |
| 认证要求   | 需要 NextAuth Session                      |
| Rate Limit | 按用户名+IP 双维度；10 次/分钟 (user), 20 次/分钟 (IP) |

**描述**：管理两步验证，包含三个动作。

**请求体参数**：

| 字段名         | 类型   | 必填 | 说明                                           |
| -------------- | ------ | ---- | -----------------------------------------------|
| `action`       | string | 是   | `"setup"` \| `"enable"` \| `"disable"`          |
| `code`         | string | 条件 | 6 位 TOTP 验证码（enable/disable 必需）         |
| `password`     | string | 是   | 当前密码（安全敏感操作二次验证）                 |

**各 action 的行为**：

| Action     | 说明                                                       | 响应                                                  |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| `setup`    | 生成 TOTP 密钥并存储（不启用），返回二维码可扫描的 URI     | `{ ok: true, secret, otpauthUrl }`                    |
| `enable`   | 验证验证码后正式启用 2FA                                   | `{ ok: true, enabled: true }`                         |
| `disable`  | 验证验证码后关闭 2FA 并清除密钥                            | `{ ok: true, enabled: false }`                        |

---

### 4. 社交链接 (Social Links)

> 使用 [`createLinkListApi`](#附录链接列表-api-模式) 工厂生成的标准化 CRUD 路由。

#### `GET /api/social-links`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 不需要登录（公开只读）|

**描述**：获取社交链接列表，按 `sort ASC -> id ASC` 排序。

**成功响应 (200)**：

```json
[
  {
    "id": 1,
    "name": "GitHub",
    "icon": "github",
    "url": "https://github.com",
    "tip": "去 Github 看看",
    "sort": 0
  },
  ...
]
```

#### `POST /api/social-links`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：新增一条社交链接。

**请求体参数**：

| 字段名 | 类型   | 必填 | 说明                        |
| ------ | ------ | ---- | --------------------------- |
| `name` | string | 是   | 名称                       |
| `icon` | string | 是   | 图标标识（Lucide 名称等）    |
| `url`  | string | 是   | 跳转链接                    |
| `tip`  | string | 否   | hover 提示文字              |
| `sort` | number | 否   | 排序值，默认 0              |

**成功响应 (201)**：创建的 SocialLink 对象。

#### `PUT /api/social-links`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |

**描述**：批量保存社交链接列表（整表替换语义）。

**请求体参数**：数组，每项包含可选的 `id`。

```json
[
  { "id": 1, "name": "GitHub", "icon": "github", "url": "...", "tip": "", "sort": 0 },
  { "name": "Bilibili", "icon": "bilibili", "url": "...", "tip": "", "sort": 1 }
]
```

**成功响应 (200)**：

```json
{
  "count": 3,
  "created": 1,
  "updated": 2,
  "deleted": 0
}
```

---

### 5. 网站链接 (Site Links)

与社交链接结构相同的 CRUD 接口。

| Method | Path                  | 认证 |
| ------ | --------------------- | ---- |
| GET    | `/api/site-links`     | 无   |
| POST   | `/api/site-links`     | 需登录 |
| PUT    | `/api/site-links`     | 需登录 |

**请求体字段**：`name`(string), `icon`(string), `url`(string), `sort`(number)

**说明**：网站链接不携带 `tip` 字段（相比社交链接少一个字段）。

---

### 6. 友情链接 (Friend Links)

与社交链接结构相同的 CRUD 接口。

| Method | Path                   | 认证 |
| ------ | ---------------------- | ---- |
| GET    | `/api/friend-links`    | 无   |
| POST   | `/api/friend-links`    | 需登录 |
| PUT    | `/api/friend-links`    | 需登录 |

**请求体字段**：`name`(string), `url`(string), `icon`(string, 默认空), `description`(string, 默认空), `sort`(number)

---

### 7. 作品/项目 (Projects)

#### `GET /api/projects`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：获取所有作品（含未启用的），按 `featured DESC -> sort ASC -> id ASC` 排序。

**成功响应 (200)**：Project 对象数组。

#### `POST /api/projects`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：新增一条作品。

**请求体参数**：

| 字段名        | 类型    | 必填 | 说明                  |
| ------------- | ------- | ---- | --------------------- |
| `title`       | string  | 是   | 标题                  |
| `description` | string  | 否   | 描述                  |
| `url`         | string  | 否   | 项目链接              |
| `image`       | string  | 否   | 封面图 URL            |
| `tags`        | string  | 否   | 逗号分隔标签          |
| `featured`    | boolean | 否   | 是否置顶，默认 false  |
| `enabled`     | boolean | 否   | 是否启用，默认 true   |
| `sort`        | number  | 否   | 排序值，默认 0        |

**成功响应 (201)**：创建的项目对象。

#### `PUT /api/projects`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 每用户 60s 最多 10 次             |

**描述**：批量保存作品列表（整表替换语义）。含 `id` 则更新，无 `id` 则新增，未提交则删除。

**请求体**：与 POST 同结构的对象数组。

**成功响应 (200)**：

```json
{
  "list": [...],
  "createdCount": 1,
  "updatedCount": 2,
  "deletedCount": 0
}
```

---

### 8. 技能标签 (Skills)

#### `GET /api/skills`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：获取所有技能，按 `sort ASC -> id ASC` 排序。

#### `POST /api/skills`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：新增一项技能。

**请求体参数**：

| 字段名 | 类型    | 必填 | 说明                      |
| ------ | ------- | ---- | ------------------------- |
| `name` | string  | 是   | 技能名称                  |
| `level`| number  | 否   | 熟练度 0-100，默认 0      |
| `icon` | string  | 否   | 图标名（空则为纯文字标签） |
| `sort` | number  | 否   | 排序值，默认 0            |

**成功响应 (201)**：创建的技能对象。

#### `PUT /api/skills`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 每用户 60s 最多 10 次             |

**描述**：批量保存技能列表（整表替换语义）。

---

### 9. 公告 (Announcements)

#### `GET /api/announcements`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：获取所有公告（含未上线/过期），按 `pinned DESC -> sort ASC -> createdAt DESC` 排序。

#### `POST /api/announcements`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：新增一条公告。

**请求体参数**：

| 字段名      | 类型     | 必填 | 说明                          |
| ----------- | -------- | ---- | ----------------------------- |
| `title`     | string   | 是   | 公告标题                      |
| `content`   | string   | 是   | 公告内容（支持 Markdown HTML） |
| `pinned`    | boolean  | 否   | 是否置顶，默认 false          |
| `enabled`   | boolean  | 否   | 是否上线，默认 true           |
| `sort`      | number   | 否   | 排序值，默认 0                |
| `startAt`   | string\|null | 否 | 定时上线 ISO 时间字符串/null |
| `endAt`     | string\|null | 否 | 定时下线 ISO 时间字符串/null |

**成功响应 (201)**：创建的公告对象。

#### `PUT /api/announcements`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 每用户 60s 最多 10 次             |

**描述**：批量保存公告列表（整表替换语义）。

---

#### 9a. 公开公告端点

##### `GET /api/announcements/public`

| 属性       | 说明        |
| ---------- | ----------- |
| 认证要求   | 无需登录    |

**描述**：返回当前有效的公告（已启用且在定时上下线区间内）。

**成功响应 (200)**：符合筛选条件的公告数组，排序同后台接口。

---

### 10. 媒体库 (Media)

#### `GET /api/media`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| URL 参数   | `usage`(string, 可选)、`page`(number, 默认 1)、`pageSize`(number, 默认 24, 最大 100) |

**描述**：查询媒体资产列表，支持按 `usage` 过滤和分页。

**成功响应 (200)**：

```json
{
  "items": [
    {
      "id": 1,
      "url": "/api/uploads/file/a1b2c3.png",
      "fileName": "a1b2c3.png",
      "mimeType": "image/png",
      "size": 123456,
      "width": 1920,
      "height": 1080,
      "usage": "avatar",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 24
}
```

#### `POST /api/media`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Content-Type | multipart/form-data              |

**描述**：上传图片并登记到媒体库。文件大小上限 10MB。

**表单字段**：

| 字段名 | 类型   | 必填 | 说明                       |
| ------ | ------ | ---- | -------------------------- |
| `file` | File   | 是   | 图片文件                   |
| `usage`| string | 否   | 用途标记（avatar/icon/wallpaper 等） |

**成功响应 (201)**：

```json
{
  "ok": true,
  "item": { "id": 1, "url": "/api/uploads/file/xxx.png", "fileName": "...", ... }
}
```

#### `DELETE /api/media/[id]`

| 属性       | 说明                  |
| ---------- | --------------------- |
| 认证要求   | 需要 NextAuth Session  |
| URL 参数   | `[id]`: 资产整数 ID   |

**描述**：删除媒体资产（同时删除磁盘文件 + DB 记录）。带目录穿越防护。

**成功响应 (200)**：

```json
{ "ok": true }
```

---

#### 10a. 复制媒体资产

##### `POST /api/media/[id]/copy`

| 属性       | 说明                  |
| ---------- | --------------------- |
| 认证要求   | 需要 NextAuth Session  |
| URL 参数   | `[id]`: 源资产整数 ID |

**描述**：复制一份媒体资产（原文件以新文件名写入磁盘，DB 新建记录）。

**成功响应 (201)**：

```json
{
  "ok": true,
  "item": { "id": 2, "url": "/api/uploads/file/new_file.png", ... }
}
```

---

### 11. 文件上传 (Uploads)

#### `POST /api/uploads`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 按 IP：3 次/60 秒                 |
| Content-Type | multipart/form-data              |

**描述**：上传任意文件（头像/图标/壁纸）。返回 `/api/uploads/file/[name]` URL。

**表单字段**：

| 字段名 | 类型   | 必填 | 说明             |
| ------ | ------ | ---- | ---------------- |
| `file` | File   | 是   | 文件（上限 10MB）|

**成功响应 (200)**：

```json
{ "ok": true, "url": "/api/uploads/file/abc123.png" }
```

---

#### 11a. 文件服务

##### `GET /api/uploads/file/[name]`

| 属性       | 说明                          |
| ---------- | ----------------------------- |
| 认证要求   | 无（公开只读）                 |
| URL 参数   | `[name]`: 文件唯一安全文件名  |

**描述**：返回已上传的文件（带白名单和安全文件名校验）。长缓存。

---

### 12. 数据统计 (Stats)

#### `GET /api/stats`

| 属性       | 说明        |
| ---------- | ----------- |
| 认证要求   | 无（公开只读）|

**描述**：获取当日 PV/UV 和累计 PV/UV。

**成功响应 (200)**：

```json
{
  "todayPv": 100,
  "todayUv": 50,
  "totalPv": 10000,
  "totalUv": 3000
}
```

---

#### `POST /api/stats`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 无需登录                          |
| Rate Limit | 按 IP：30 次/分钟                 |

**描述**：上报一次访问记录。PV 每次 +1；UV 通过服务端签发 Cookie (`qiyun-uv`) 判定新访客。爬虫被排除。

**请求体**：无（从 request headers 提取 UA/IP）。

**成功响应 (200)**：

```json
{
  "ok": true,
  "todayPv": 101,
  "todayUv": 51,
  "totalPv": 10100,
  "totalUv": 3050
}
```

Cookie 头中会设置 `qiyun-uv=1`（httpOnly, sameSite=lax, maxAge=365 天），用于 UV 去重。

> **明细保留策略**：访问明细 `VisitRecord` 默认保留 180 天，服务端在每个自然日的首次上报时清理更早的记录，避免 SQLite 文件与统计聚合无界增长。可用环境变量 `VISIT_RECORD_RETENTION_DAYS` 调整天数（`0` 表示永久保留）。每日 PV/UV 汇总 `VisitStat` 不受影响，长期保留。

---

#### 12a. 点击统计 (Click Tracking)

##### `POST /api/stats/click`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 无需登录                          |
| Rate Limit | 按 IP：30 次/分钟                 |

**描述**：上报网站/友链/作品的点击次数。聚合到 `SiteLinkClick` 表。

**请求体参数**：

| 字段名 | 类型   | 必填 | 说明                                         |
| ------ | ------ | ---- | -------------------------------------------- |
| `id`   | number | 是   | 链接 ID（正整数，对应 kind 指定的实体）       |
| `kind` | string | 否   | `"site"` \| `"friend"` \| `"project"`（缺省为 site）|

**成功响应 (200)**：

```json
{ "ok": true, "recorded": true }   // 目标存在且已记录
{ "ok": true, "recorded": false }  // 目标不存在（静默丢弃）
```

---

#### 12b. 数据看板 (Dashboard)

##### `GET /api/stats/dashboard`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：完整的访问统计看板数据，包含 30 天趋势、来源分析、设备/系统/浏览器分布、时段热力图、热门链接、地域分布、本周vs上周对比、当前在线人数。

**成功响应 (200)**：

```json
{
  "totalPv": 10000,
  "totalUv": 3000,
  "todayPv": 100,
  "todayUv": 50,
  "yesterdayPv": 80,
  "yesterdayUv": 45,
  "daily": [
    { "date": "2024-09-01", "pv": 80, "uv": 40 },
    ...
  ],
  "referrers": [
    { "name": "google.com", "count": 100 },
    ...
  ],
  "sourceBuckets": [
    { "name": "直接访问", "count": 500 },
    { "name": "搜索引擎", "count": 200 },
    { "name": "社交媒体", "count": 50 },
    { "name": "外链引入", "count": 30 }
  ],
  "devices": [{"name": "desktop", "count": 800}, {"name": "mobile", "count": 300}],
  "os": [{"name": "Windows", "count": 600}, {"name": "macOS", "count": 200}],
  "browsers": [{"name": "Chrome", "count": 700}, {"name": "Safari", "count": 300}],
  "hours": Array<24>,  // [{ hour: 0..23, count: n }]
  "topLinks": [{"name": "GitHub", "count": 50, "url": "..."}],
  "geo": {
    "total": 1000,
    "unknown": 50,
    "regions": [{"name": "广东省", "count": 300}, ...]
  },
  "weekCompare": {
    "curStart": "2024-09-23",
    "curEnd": "2024-09-27",
    "prevStart": "2024-09-16",
    "prevEnd": "2024-09-22",
    "curPv": 500,
    "curUv": 200,
    "prevPv": 450,
    "prevUv": 180,
    "pvDelta": 11.1,
    "uvDelta": 11.1
  },
  "onlineNow": 12,
  "weekHours": [[0, 2, 5, ...], ...],  // 7 x 24 热力图矩阵
  "windowStart": "2024-08-29"
}
```

---

#### 12c. 地域分布 (Geo)

##### `GET /api/stats/geo`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| URL 参数   | `days`(number, 可选): 最近 N 天; `export=csv` 导出 CSV |

**描述**：访问者地域分布详情。取最活跃 500 个 IP 进行离线 IP2Region 解析。

**成功响应 (200, JSON)**：

```json
{
  "list": [
    { "region": "广东省", "visits": 500, "ips": 120 }
  ],
  "totalVisits": 1000,
  "sampled": 500
}
```

**成功响应 (200, CSV)**：当 `?export=csv` 时，返回含 UTF-8 BOM 的 CSV 下载文件。

---

### 13. 操作日志 (Operation Logs)

#### `GET /api/operation-logs`

| 属性       | 说明                                                    |
| ---------- | ------------------------------------------------------- |
| 认证要求   | 需要 NextAuth Session                                    |
| URL 参数   | `module`(string, 可选)、`keyword`(string, 可选)、`page`(number, 默认 1)、`pageSize`(number, 默认 20, 最大 100) |

**描述**：分页查询操作日志，支持按模块筛选和关键词搜索（username/summary 模糊匹配）。

**成功响应 (200)**：

```json
{
  "items": [
    { "id": 1, "module": "profile", "action": "update", "username": "admin", "summary": "...", "detail": "...", "ip": "...", "createdAt": "..." }
  ],
  "total": 150,
  "page": 1,
  "pageSize": 20
}
```

---

#### 13a. 清理日志

##### `POST /api/logs/clean`

| 属性       | 说明                  |
| ---------- | --------------------- |
| 认证要求   | 需要 NextAuth Session  |

**描述**：按时间段清理操作日志（事务内执行，清理审计本身不会被误删）。

**请求体参数**：

| 字段名 | 类型   | 必填 | 说明                |
| ------ | ------ | ---- | ------------------- |
| `from` | string | 否   | 起始时间 ISO 字符串 |
| `to`   | string | 否   | 结束时间 ISO 字符串 |

两参数均空 = 清理全部。

**成功响应 (200)**：

```json
{
  "ok": true,
  "deletedCount": 100,
  "summary": "清理操作日志 100 条（2024-01-01 ~ 2024-09-01）"
}
```

---

#### 13b. 导出 CSV

##### `GET /api/logs/export`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| URL 参数   | `module`(string, 可选)、`keyword`(string, 可选)、`from`(ISO, 可选)、`to`(ISO, 可选) |

**描述**：按相同筛选条件导出操作日志为 CSV 文件（UTF-8 BOM，Excel 兼容）。

**成功响应 (200)**：CSV 文本下载，Content-Disposition 附带文件名 `operation-logs-YYYYMMDDHHmmss.csv`。

---

### 14. 备份恢复 (Backup)

#### `GET /api/backup`

| 属性       | 说明                 |
| ---------- | -------------------- |
| 认证要求   | 需要 NextAuth Session |

**描述**：下载完整备份文件（JSON）。覆盖：站点配置 + 社交/网站/友情链接 + 作品集 + 技能云 + 公告 + 媒体库记录 + 链接点击统计。

**注意**：不包含 User 账号、操作日志、访问统计、更新记录及物理文件。

**成功响应 (200)**：JSON 文件下载，文件名 `qiyun-backup-YYYYMMDDHHmmSS.json`。

---

#### 14a. 恢复备份

##### `POST /api/backup/restore`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 全局限流：3 次/60 秒               |
| 大小限制   | 5 MB                              |

**描述**：从备份文件恢复全站数据（高危操作）。需传递 `confirm: true`。

**请求体参数**：

| 字段名     | 类型    | 必填 | 说明                                  |
| ---------- | ------- | ---- | ------------------------------------- |
| `confirm`  | boolean | 是   | 必须为 `true`                          |
| `backup`   | object  | 是   | 完整备份 JSON 对象（与 GET /api/backup 一致）|

**成功响应 (200)**：

```json
{ "ok": true, "count": 15 }
```

---

### 15. 系统工具 (System Utilities)

#### 15a. 容器探针

##### `GET /api/ping`

| 属性       | 说明                                          |
| ---------- | --------------------------------------------- |
| 认证要求   | 无（公开只读）                                |
| 用途       | docker-compose HEALTHCHECK 与外部运维探活      |

**描述**：只读探针，执行一次 `SELECT 1` 校验数据库连接，响应体极小且不含敏感信息。正常返回 200，数据库不可用返回 503。

**成功响应 (200)**：

```json
{ "ok": true }
```

**失败响应 (503)**：

```json
{ "ok": false }
```

注：`docker-compose.yml` 的 healthcheck 调用的是本接口，不是 `/api/health`。

---

#### 15b. 服务健康探测

##### `GET /api/health`

| 属性       | 说明                                          |
| ---------- | --------------------------------------------- |
| 认证要求   | 需要 NextAuth Session                          |
| URL 参数   | `force=1`: 跳过 30 秒结果缓存，强制重新探测     |
| 用途       | 后台「外部服务」面板的连通性列表                |

**描述**：并行探测各外部上游服务（必应壁纸、随机风景 / 动漫壁纸、随机头像、Iconify，以及配置后才加入的 favicon / 高德天气 / 腾讯天气）的连通性与延迟。要求登录，避免被外部滥用触发大量出站请求。

**成功响应 (200)**：

```json
{
  "checkedAt": 1759400000000,
  "cached": false,
  "services": [
    {
      "id": "bing",
      "name": "必应每日壁纸",
      "desc": "默认壁纸源",
      "url": "https://www.bing.com/HPImageArchive.aspx?...",
      "status": "ok",
      "latency": 320
    }
  ]
}
```

| 字段                    | 说明                                                     |
| ----------------------- | -------------------------------------------------------- |
| `checkedAt`             | 本次探测完成的时间戳（毫秒）                              |
| `cached`                | 是否直接命中 30 秒缓存                                    |
| `services[].status`     | `ok` \| `fail`                                            |
| `services[].error`      | 失败原因，如 `HTTP 404`、`连接失败或超时`，成功时不存在     |

---

#### 15c. Favicon 探测

##### `GET /api/favicon?url=<网址或域名>`

| 属性       | 说明                  |
| ---------- | --------------------- |
| 认证要求   | 需要 NextAuth Session  |
| URL 参数   | `url`(string): 目标网址 |

**描述**：探测并返回首个可用的网站图标地址。按以下优先级依次尝试，命中即返回：

1. **首页 HTML 声明的图标** —— 解析 `<link rel="icon">` / `rel="shortcut icon"` / `rel="apple-touch-icon(-precomposed)"`（大小写与单词顺序不敏感，支持单双引号与无引号写法），相对路径按**跳转后**的最终地址补全，再逐个校验是否真的返回图片。这是唯一能覆盖「图标托管在 OSS/CDN、根目录没有 favicon.ico」这类站点的路径。
2. **站点自身 `/favicon.ico`** —— 没有声明时的通用约定（与第 1 步并行发起，声明命中时优先取声明）。
3. **第三方图标服务** —— favicon.im / icon.horse / xinac 图标库 / Google favicon（含后台「外部服务」配置的自定义源，插在内置源之前）。

前两步都落空才会去打第三方源。所有候选都要求返回 `image/*`（或体积合规的 `octet-stream`），返回 HTML 的候选一律视为无效，避免把 SPA 首页当成图标。首页 HTML 最多读取 256KB（图标声明必在 `<head>`），单次出站请求带超时与逐跳 SSRF 校验。

**成功响应 (200)**：

```json
{ "ok": true, "host": "github.com", "url": "https://github.com/favicon.ico", "source": "站点自身 favicon.ico" }
```

`source` 取值：`页面声明的图标`、`站点自身 favicon.ico`、`自定义 favicon 服务`、`favicon.im`、`icon.horse`、`xinac 图标库`、`Google favicon（备用）`。

**失败响应 (200)**：`{ "ok": false, "host": "...", "error": "未探测到 ... 的可用图标（域名无法解析，或站点未提供 favicon）" }`

---

#### 15d. 天气服务

##### `GET /api/weather`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 无（公开只读）                    |
| Rate Limit | 按访客 IP：30 次/分钟（未配固定城市时） |
| 缓存策略   | 进程内存缓存 5 分钟 TTL            |

**描述**：根据后台配置的数据源（高德/腾讯免费版/腾讯 Key 版/混合模式）获取实况天气，支持按访客 IP 自动定位城市。多数据源自动降级切换。

**成功响应 (200)**：

```json
{
  "city": "深圳市",
  "weather": "多云",
  "temperature": "28℃",
  "winddirection": "东风",
  "windpower": "3级",
  "region": "广东省 深圳市"
}
```

> **`region`（访客地域标签）只在两个条件同时满足时才出现**：这次定位用的是**访客自己的公网 IP**，
> 且定位来自**腾讯位置服务的 IP 库**。前台欢迎通知据此显示"来自 X"，复用这次请求即可，
> 省掉一次 `GET /api/visitor/location` 查询（本地离线库，ip2region）。
>
> 两个条件缺一不可，缺了就不返回 `region`，前台回退到 `/api/visitor/location`：
> - **拿不到访客公网 IP**（私网 / IPv6 / 反向代理没转发 `X-Forwarded-For` 或 `X-Real-IP`）时，
>   定位会退化成"按请求来源（服务器出口）IP"定位 —— 那是**服务器所在城市**，展示给访客是错的，
>   而且它看起来像个真实城市，比"未知"更容易误导；
> - **高德的 IP 定位**刻意不作为访客地域：它常把地级市归到省会，比本地离线库更不准
>   （高德链路仍会用定位结果去查天气，只是不产出地域标签）。
>
> 另一条不变的约束：凡天气真正落到「后台配置的固定城市」的路径（高德 / 腾讯免费版 /
> 混合模式配了城市）都不会返回 `region` —— 那时 `city` 是站主的城市，同样不能给访客看。

---

#### 15e. 必应壁纸代理

##### `GET /api/bing`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 无                                |
| 缓存策略   | Next.js fetch 缓存，revalidate 3600 秒 |

**描述**：代理必应每日壁纸接口，解决跨域和国内访问问题。

**成功响应 (200)**：

```json
{
  "url": "https://www.bing.com/HPImageArchive.aspx/...",
  "copyright": "壁纸版权说明",
  "title": "壁纸标题"
}
```

---

#### 15f. 壁纸缓存服务

##### `GET /api/wallpaper?coverType=&bgApi=&refresh=&device=&force=&t=`

| 属性       | 说明                                                   |
| ---------- | ------------------------------------------------------ |
| 认证要求   | 无                                                     |
| URL 参数   | `coverType`(string, 默认 "bing")：可选 bing/landscape/anime/custom<br>`bgApi`(string, 可选)：自定义壁纸直链<br>`refresh`(number, 可选)：刷新间隔 0/5/10/30 分钟<br>`device`(string, 可选)：`pc`(默认)/`mobile`，决定取横图还是竖图<br>`force`(string, 可选)：`1` 表示手动换一张 |

**描述**：**缓存优先**。返回该分池本地缓存中的随机壁纸；分池为空时才即时下载一张。缓存充足时不会为了取图请求上游 —— 只有后台按 `refresh` 间隔静默补图。自定义地址直连返回，不经过缓存。

缓存上限按**预算组**计（电脑 100 / 手机 100 / 必应共享 100，各自独立），填满即停止自动新增，不会自动删旧图。本地不足 5 张时会不受间隔约束尽快补齐。

`force=1` 为「手动换一张」：明确去上游取一张新的并写入缓存；该组已满 100 张时替换掉最旧的一张。**只对随机源（风景 / 动漫）生效** —— 必应当天只有一张图，换了也是同一张；该端点按 IP 限流（6 次/分钟），超限返回 429。换图失败时返回空 `url`，前端应保留当前壁纸。

**成功响应 (200)**：

```json
{
  "url": "/api/wallpaper/file/w_abc123.jpg",
  "cached": true
}
```

手动换图成功时额外带 `switched: true`；失败时为 `{ "url": "", "cached": false, "error": "..." }`。

##### `GET /api/wallpaper/file/[name]`

| 属性       | 说明                          |
| ---------- | ----------------------------- |
| 认证要求   | 无                            |
| URL 参数   | `[name]`: 缓存文件唯一名      |

**描述**：返回本地缓存的壁纸文件。带目录穿越防护。

##### `GET /api/wallpaper/cache`

| 属性       | 说明                          |
| ---------- | ----------------------------- |
| 认证要求   | 管理员                        |
| URL 参数   | 无                            |

**描述**：列出壁纸缓存（后台「媒体库 → 壁纸缓存」分区）。这些缓存**不登记** `ImageAsset`：它的条数受预算上限约束（电脑 / 手机 / 必应共享 各 100 张），生命周期与媒体库里的用户内容不同。大小与存在性以磁盘为准，`exists: false` 表示 manifest 里还留着记录但文件已不在磁盘上。`budgets` 给出各预算组的张数与占用，`readyThreshold` 是「本地缓存够用」的阈值（张）。

**成功响应 (200)**：

```json
{
  "items": [
    {
      "fileName": "w_abc123.webp",
      "url": "/api/wallpaper/file/w_abc123.webp",
      "sourceUrl": "https://t.mwm.moe/pc",
      "addedAt": 1791000000000,
      "size": 204800,
      "tag": "anime:pc",
      "exists": true
    }
  ],
  "total": 1,
  "bytes": 204800,
  "max": 100
}
```

##### `DELETE /api/wallpaper/cache?fileName=&all=`

| 属性       | 说明                                                         |
| ---------- | ------------------------------------------------------------ |
| 认证要求   | 管理员                                                       |
| URL 参数   | `fileName`(string, 可选)：删除单张<br>`all=1`(string, 可选)：清空全部 |

**描述**：删除缓存文件并同步 manifest（先改清单再删文件，不会留下「有记录没文件」的死链接）。**清空必须显式传 `all=1`**：缺少 `fileName` 又没有 `all=1` 时返回 400，不会退化成清空。清空会同时把刷新时间戳归零，下次访问会重新预取一张。

**成功响应 (200)**：

```json
{ "ok": true, "removed": 1 }
```

---

#### 15g. 音乐播放代理

##### `GET /api/music?api=&server=&type=&id=`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 无需登录                          |
| URL 参数   | `api`(string): API 基地址<br>`server`(string, 默认 netease)<br>`type`(string, 默认 playlist)<br>`id`(string): 歌单 ID |

**描述**：代理第三方音乐歌单 API（绕过浏览器 CORS）。优先尝试 NeteaseCloudMusicApi v3 协议，回退至 meting/home 协议。带 SSRF 防护。

**成功响应 (200)**：Track[] 数组或空数组。

```json
[
  {
    "id": "123456",
    "name": "歌曲名",
    "artist": "歌手名",
    "url": "https://music.example.com/track.mp3",
    "cover": "https://music.example.com/cover.jpg",
    "lrc": "https://api.example.com/lyric?id=123456"
  }
]
```

---

#### 15h. 一言服务

##### `GET /api/hitokoto?c=`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 无                                |
| URL 参数   | `c`(string, 可选): 类型过滤器     |

**描述**：返回一条内置一言（25 条轮询，不依赖外网）。支持类型过滤：`a`(古代文学)、`b`(现代诗歌)、`c`(诗词古文)、`d`(原创语录)、`f`(其他)。

**成功响应 (200)**：

```json
{
  "text": "愿你历尽千帆，归来仍是少年。",
  "from": "无名"
}
```

---

#### 15i. Iconify 图标集目录

##### `GET /api/icons`

| 属性     | 说明                                                    |
| -------- | ------------------------------------------------------- |
| 认证要求 | 需登录（管理员），按账号限流 30 次/分钟                 |
| 查询参数 | `prefix`：图标集标识（如 fa6-solid、mdi、tabler），必填  |
| 缓存策略 | 进程内存按 prefix 缓存 1 小时，最多 20 个图标集          |

**描述**：代理 Iconify `/collection` 接口，返回指定图标集的图标名与分类清单，供后台 `IconifyPicker`
（图标浏览器）使用。只返回名称不返回图形，图形由前端按页批量向 Iconify JSON API 拉取。
`prefix` 会拼进上游 URL，服务端严格校验为小写字母/数字/连字符格式，出站走逐跳 SSRF 校验。

**成功响应 (200)**：

```json
{
  "prefix": "fa6-brands",
  "title": "Font Awesome Brands",
  "total": 486,
  "icons": [{ "name": "github", "category": "Brands" }],
  "categories": [{ "name": "Brands", "count": 100 }]
}
```

**错误响应**：400（缺少或非法 prefix）、401（未授权）、429（限流）、502（上游异常 / 超时）。

---

#### 15j. 访客地域解析

##### `GET /api/visitor/location`

| 属性       | 说明        |
| ---------- | ----------- |
| 认证要求   | 无          |

**描述**：基于访客 IP 解析地域标签（复用内置 ip2region 离线库，无需第三方调用）。返回自己的所在地理位置。

> 欢迎通知的**首选**不是这个接口，而是 `GET /api/weather` 顺带返回的 `region`（精度更高、且省一次请求）；
> 只有天气给不出访客地域时才回退到这里。因此它仍然必须保留 —— 它是零依赖的兜底，
> 在未配置天气数据源、配了固定城市、被限流等情况下是唯一能拿到地域的途径。

**成功响应 (200)**：

```json
{ "region": "广东省 深圳市" }
// 海外
{ "region": "日本" }
// 内网/未知
{ "region": "" }
```

> 省市同名（直辖市）已去重，不会再出现 `"北京市 北京市"`。

---

#### 15k. 重置默认值

##### `POST /api/reset-default`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| Rate Limit | 每用户 60s 最多 3 次              |

**描述**：危险操作！清空全部业务数据并重建种子默认值。需三重确认：登录态 + `confirm: true` + 密码校验。管理员密码被重置为 `123456` 并强制改密。

**请求体参数**：

| 字段名     | 类型    | 必填 | 说明                              |
| ---------- | ------- | ---- | --------------------------------- |
| `confirm`  | boolean | 是   | 必须为 `true`                      |
| `password` | string  | 是   | 当前登录密码（身份二次验证）       |

**成功响应 (200)**：

```json
{
  "ok": true,
  "message": "恢复默认成功：清空 12 条记录，重建 13 条默认数据，清理 3 个上传文件",
  "stats": {
    "cleared": { "VisitRecord": 100, "SocialLink": 5, ... },
    "seedsCreated": { "Profile": 1, "SocialLink": 5, ... },
    "removedFiles": 3
  }
}
```

---

#### 15l. GitHub 加速代理管理

##### `GET /api/update/proxies`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| URL 参数   | `test=1`: 触发连通性测试          |

**描述**：获取 GitHub 加速代理候选源清单（官方 + 内置 + 自定义）和当前优先代理。加 `test=1` 时并发测试全部源的延迟。

**成功响应 (200)**：

```json
{
  "ok": true,
  "sources": [
    { "url": "https://github.com", "label": "GitHub 官方", "builtin": true },
    { "url": "https://ghproxy.com", "label": "ghproxy", "builtin": true }
  ],
  "custom": ["https://my-mirror.com"],
  "preferred": null,
  "results": [
    { "url": "...", "status": "ok", "latency": 120 },
    ...
  ]
}
```

---

##### `POST /api/update/proxies`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |

**描述**：保存自定义代理列表和/或设置/清除优先代理。带 SSRF 校验。

**请求体参数**（JSON）：

| 字段名       | 类型       | 必填 | 说明                                            |
| ------------ | ---------- | ---- | ----------------------------------------------- |
| `mirrors`    | string[]   | 否   | 自定义代理 URL 数组                             |
| `preferred`  | string\|null | 否 | 优先代理地址（设为 null 恢复自动竞速）           |

**成功响应 (200)**：

```json
{
  "ok": true,
  "custom": ["https://my-mirror.com"],
  "preferred": "https://ghproxy.com",
  "invalid": 0
}
```

---

#### 15m. 更新状态查询

##### `GET /api/update/status`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| URL 参数   | `force=1`: 强制刷新版本缓存       |

**描述**：返回当前版本、GitHub 最新发布、是否有新版本、执行状态、更新历史、回滚目标和数据快照。

**成功响应 (200)**：

```json
{
  "currentVersion": "0.0.2",
  "repo": "sxlb/qiyun",
  "latestRelease": { "version": "0.0.3", "tag": "0.0.3", "body": "发布说明...", "publishedAt": "..." },
  "latestError": null,
  "isUpdateAvailable": true,
  "hostReady": true,
  "exec": { "kind": "idle" },  // idle / pending / running
  "versions": {
    "currentVersion": "0.0.2",
    "updatedAt": "2026-10-02T10:00:00.000Z",
    "history": [
      { "version": "0.0.1", "action": "update", "at": "2026-10-01T09:00:00.000Z" },
      { "version": "0.0.2", "action": "update", "at": "2026-10-02T10:00:00.000Z" }
    ]
  },
  "rollbackTargets": ["0.0.1"],
  "backups": [{ "name": "0.0.2-20261002.db", "timestamp": "2026-10-02T10:00:00.000Z" }],
  "records": [
    { "id": 1, "version": "0.0.2", "action": "update", "method": "image", "status": "success", "message": "...", "triggeredBy": "admin", "createdAt": "...", "finishedAt": "..." }
  ]
}
```

> `versions` 为宿主机部署目录中的版本清单（`DeployVersions`），宿主机尚未初始化时为 `null`，此时 `hostReady` 为 `false`。

---

#### 15n. 触发更新/回滚

##### `POST /api/update/trigger`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |

**描述**：触发系统更新到最新版本、更新到指定版本，或回滚到历史版本。并发防护：已有待执行/执行中的任务时拒绝重复提交。

**请求体参数**：

| 字段名        | 类型    | 必填 | 说明                                             |
| ------------- | ------- | ---- | ------------------------------------------------ |
| `action`      | string  | 是   | `"update"` \| `"rollback"`                       |
| `version`     | string  | 条件 | 指定目标版本号（发布标签，无 v 前缀，如 `0.0.1`）。`action=update` 时不传 = 更新到最新；`action=rollback` 时必填 |
| `description` | string  | 否   | 更新说明                                        |

> 更新方式固定为拉取已发布的镜像，服务器不本地构建，因此不再接受 `method` 参数。

> `update` 与 `rollback` 的差别不只是方向：`rollback` 额外会把数据库恢复到该版本的快照，`update` 不动数据。
> 因此「回到旧版本」应走 `rollback`（后台「版本列表」也是这么分派的），它的按钮才会标注该版本是否留有快照。

**版本号校验**：指定 `version` 时必须以「已发布版本」为准（取自 `GET /api/update/releases`）。
不在列表内直接返回 400，不会把未校验的字符串透传到宿主机镜像名里。

**成功响应 (200)**：

```json
{
  "ok": true,
  "action": "update",
  "method": "image",
  "version": "0.0.3",
  "id": "upd_xxx",
  "versionSource": "live",
  "estimatedSeconds": 90
}
```

---

#### 15n-2. 发布列表（版本列表与更新日志）

##### `GET /api/update/releases`

| 属性       | 说明                              |
| ---------- | --------------------------------- |
| 认证要求   | 需要 NextAuth Session              |
| 查询参数   | `force=1` 绕过 10 分钟进程内缓存，强制重新拉取 |

**描述**：返回 GitHub 上已发布的版本列表（新的在前，逐条含 Markdown 更新说明），
并给每条标注它相对当前版本的位置，供后台「版本列表与更新日志」区块决定按钮文案。

之所以独立成接口而不是并进 `/api/update/status`：status 在有任务时每 5 秒轮询一次，
而列表里每条都带说明正文（30 条可能上百 KB），挂在一起会把轮询变成流量黑洞。

**成功响应 (200)**：

```json
{
  "currentVersion": "0.0.10",
  "releases": [
    {
      "tag": "0.0.11",
      "version": "0.0.11",
      "name": "0.0.11",
      "body": "### 新增\n- ...",
      "htmlUrl": "https://github.com/sxlb/qiyun/releases/tag/0.0.11",
      "publishedAt": "2026-10-04T12:00:00Z",
      "relation": "newer"
    }
  ],
  "error": null
}
```

> `relation` 取 `newer` / `current` / `older`。
> 拉取失败时 `releases` 为空数组且 `error` 非空 —— 调用方必须区分「取不到」与「确实没有版本」，
> 否则网络故障会被显示成「该项目没有发布版本」。

---

#### 15o. 外部服务连通性测试

##### `POST /api/external-apis/test`

| 属性       | 说明                                     |
| ---------- | ---------------------------------------- |
| 认证要求   | 需要 NextAuth Session                     |
| 限流       | 按管理员账号 20 次/分钟                   |
| 用途       | 后台「外部服务」面板的「测试」按钮        |

**请求体**

```json
{
  "url": "https://t.mwm.moe/fj"
}
```

**成功响应**（200）

```json
{
  "ok": true,
  "status": 200,
  "latencyMs": 320,
  "message": "可访问（HTTP 200）"
}
```

**失败响应**（200，`ok: false`）

```json
{
  "ok": false,
  "status": 0,
  "latencyMs": 8000,
  "message": "连接超时（8000ms）"
}
```

常见失败 `message`：

| 场景                 | message 示例                                              |
| -------------------- | --------------------------------------------------------- |
| 超时（默认 8s）      | `连接超时（8000ms）`                                       |
| 域名无法解析 / 不达  | `连接失败（域名无法解析或网络不可达）`                     |
| 上游返回错误状态码   | `服务返回 HTTP 404`                                        |
| 内网 / 保留地址      | `目标地址为内网/保留地址，已拒绝: 127.0.0.1`               |

> **安全说明**：本接口由服务器发起出站请求，故仅管理员可调用。为防 SSRF，
> 出站统一走 `lib/ssrf` 的逐跳校验，**拒绝内网 / 保留地址**（因此自建在内网的
> API 无法在此测试，但不影响前台实际使用），非法协议（`javascript:` / `file:`）同样被拒绝。

---

## 数据字典

全部模型与字段定义，源自 `prisma/schema.prisma`。

### Profile - 站点全局配置

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `avatar` | String | "" | 头像 URL |
| `siteIcon` | String | "" | 站点图标 URL |
| `nickname` | String | "无名" | 昵称 |
| `bio` | String | "这个人很懒，什么都没写" | 个人简介 |
| `github` | String | "" | GitHub 主页 URL |
| `email` | String | "" | 联系邮箱 |
| `bgApi` | String | "" | 自定义壁纸直链 |
| `weatherProvider` | String | "tencent" | 天气数据源 (amap/tencent/tencent-key/tencent-loc-amap) |
| `amapKey` | String | "" | 高德地图 API Key |
| `amapSecretKey` | String | "" | 高德数字签名私钥 |
| `weatherCity` | String | "" | 天气城市名 |
| `txWeatherKey` | String | "" | 腾讯位置服务 Key |
| `txWeatherSk` | String | "" | 腾讯位置服务 SK |
| `coverType` | String | "bing" | 壁纸源 (bing/landscape/anime/custom) |
| `autoBGSwitchInterval` | Int | 0 | 背景自动切换间隔 |
| `wallpaperRefresh` | Int | 0 | 壁纸缓存刷新间隔(分钟): 0/5/10/30 |
| `theme` | String | "system" | 主题 |
| `songApi` | String | "" | 音乐 API 基地址 |
| `songServer` | String | "netease" | 音乐服务器 |
| `songId` | String | "" | 歌单 ID |
| `musicAutoplay` | Boolean | false | 音乐自动播放的**站点初值**：访客在播放器「设置 → 播放 → 自动播放」里显式设过就以访客为准（该开关本机默认关闭） |
| `musicSidebarDefault` | String | "demo" | 音乐侧栏进门时的默认状态：`demo` 首次访问展开示范一次、通知离场后 3 秒收起 / `expand` 默认展开并保持（**不铺满屏遮罩**，不挡页面操作）/ `collapse` 默认收起、只留贴边把手 |
| `siteUrl` | String | "" | 站点 URL |
| `siteIcp` | String | "" | ICP 备案号 |
| `siteMps` | String | "" | 公安备案号 |
| `siteStart` | String | "" | 建站日期 |
| `siteLinksTitle` | String | "我的网站" | 网站链接区标题 |
| `siteLinksIcon` | String | "link" | 网站链接图标 |
| `friendLinksTitle` | String | "友情链接" | 友链区标题 |
| `iconfontUrl` | String | "" | 阿里云图标库 symbol 脚本地址 |
| `logoArtFont` | Boolean | true | Logo 艺术字体开关 |
| `customFontEnabled` | Boolean | false | 自定义字体总开关 |
| `customFontFamily` | String | "" | 自定义字体名 |
| `customFontScope` | String | "nickname" | 自定义字体应用范围 |
| `loadingScreen` | Boolean | true | 加载动画开关 |
| `clickEffect` | Boolean | true | 点击特效开关 |
| `consoleEgg` | Boolean | true | 控制台彩蛋开关 |
| `showStats` | Boolean | true | 展示访问量统计 |
| `dynamicTitle` | Boolean | true | 动态页面标题 |
| `topProgressBar` | Boolean | true | 顶部进度条 |
| `seasonalEffectEnabled` | Boolean | false | 季节装饰特效开关 |
| `useRandomAvatar` | Boolean | false | 随机头像开关 |
| `commandPalette` | Boolean | true | 全局命令面板开关 |
| `rightClickMode` | String | "default" | 前端右键行为：`default` 原生 / `disabled` 禁用 / `menu` 自定义站内功能菜单 |
| `welcomeEnabled` | Boolean | true | 欢迎弹窗开关 |
| `welcomeIndex` | Int | 0 | 欢迎语索引 |
| `welcomeMessages` | String | [...] | 欢迎语 JSON 字符串 |
| `siteTitle` | String | "" | SEO 站点标题 |
| `siteDescription` | String | "" | SEO 站点描述 |
| `siteKeywords` | String | "" | SEO 站点关键词 |
| `accentColor` | String | "" | 主题强调色 |
| `glassOpacity` | Int | 28 | 玻璃卡片不透明度 0-80 |
| `glassBlur` | Int | 16 | 玻璃卡片模糊强度 0-40px |
| `analyticsScript` | String | "" | 统计代码片段 |
| `headScript` | String | "" | 自定义 head 脚本 |
| `timeFormat` | String | "24" | 时钟格式 24/12 |
| `showSeconds` | Boolean | true | 时钟显示秒 |
| `dateFormat` | String | "YYYY年M月D日 dddd" | 日期格式 |
| `hitokotoType` | String | "" | 一言类型过滤器 |
| `bgOverlay` | Int | 0 | 背景遮罩暗化强度 0-80% |
| `avatarShape` | String | "circle" | 头像形状 circle/rounded/square |
| `avatarBorderColor` | String | "" | 头像边框颜色 |
| `siteFooterHtml` | String | "" | 页脚自定义 HTML |
| `wallpaperLandscapeApi` | String | "" | 外部服务：随机风景壁纸直链（电脑端，横向） |
| `wallpaperLandscapeApiMobile` | String | "" | 外部服务：随机风景壁纸直链（手机端，竖向；留空沿用电脑端） |
| `wallpaperAnimeApi` | String | "" | 外部服务：随机动漫壁纸直链（电脑端，横向，内置默认 /pc） |
| `wallpaperAnimeApiMobile` | String | "" | 外部服务：随机动漫壁纸直链（手机端，竖向，内置默认 /mp） |
| `randomAvatarApi` | String | "" | 外部服务：随机头像接口地址 |
| `iconifyApi` | String | "" | 外部服务：Iconify 图标接口基地址 |
| `faviconApi` | String | "" | 外部服务：favicon 服务模板，占位符 {host} |
| `bingWallpaperApi` | String | "" | 外部服务：必应每日壁纸接口 |
| `createdAt` | DateTime | now() | 创建时间 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |

### User - 管理员账号

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `username` | String | unique | 用户名 |
| `password` | String | - | 密码哈希 |
| `mustChangePassword` | Boolean | false | 是否需强制改密 |
| `twoFactorSecret` | String | "" | TOTP 密钥 (base32) |
| `twoFactorEnabled` | Boolean | false | 是否启用两步验证 |
| `sessionVersion` | Int | 0 | 会话版本号（改密后自增） |
| `createdAt` | DateTime | now() | 创建时间 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |

### SocialLink - 社交链接

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `name` | String | - | 链接名称 |
| `icon` | String | - | 图标标识 |
| `url` | String | - | 跳转 URL |
| `tip` | String | "" | Hover 提示 |
| `sort` | Int | 0 | 排序值 |
| `createdAt` | DateTime | now() | 创建时间 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |

### SiteLink - 网站链接

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `name` | String | - | 链接名称 |
| `icon` | String | - | 图标标识 |
| `url` | String | - | 跳转 URL |
| `sort` | Int | 0 | 排序值 |
| `createdAt` | DateTime | now() | 创建时间 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |

### FriendLink - 友情链接

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `name` | String | - | 名称 |
| `url` | String | - | 跳转 URL |
| `icon` | String | "" | 图标 |
| `description` | String | "" | 描述 |
| `sort` | Int | 0 | 排序值 |
| `createdAt` | DateTime | now() | 创建时间 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |

### Project - 作品/项目

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `title` | String | - | 标题 |
| `description` | String | "" | 描述 |
| `url` | String | "" | 项目链接 |
| `image` | String | "" | 封面图 URL |
| `tags` | String | "" | 逗号分隔标签 |
| `featured` | Boolean | false | 是否置顶 |
| `enabled` | Boolean | true | 是否启用 |
| `sort` | Int | 0 | 排序值 |
| `createdAt` | DateTime | now() | 创建时间 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |

### Skill - 技能标签

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `name` | String | - | 技能名称 |
| `level` | Int | 0 | 熟练度 0-100 |
| `icon` | String | "" | 图标名（空则为纯文字） |
| `sort` | Int | 0 | 排序值 |
| `createdAt` | DateTime | now() | 创建时间 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |

### OperationLog - 操作日志

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `module` | String | - | 模块名 (account/profile/social-links 等) |
| `action` | String | - | 操作类型 (create/update/delete/batch_update 等) |
| `username` | String | - | 操作人 |
| `summary` | String | - | 摘要 |
| `detail` | String | "" | 详细信息 (JSON) |
| `ip` | String | "" | 操作者 IP |
| `createdAt` | DateTime | now() | 创建时间 |
| @@index | - | - | `createdAt`, `[module, createdAt]` |

### VisitStat - 访问统计

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `date` | String | unique | 日期 (YYYY-MM-DD) |
| `pv` | Int | 0 | 当日 PV |
| `uv` | Int | 0 | 当日 UV |

### VisitRecord - 访问明细

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `date` | String | - | 日期 |
| `hour` | Int | 0 | 东八区小时 (0-23) |
| `ipHash` | String | "" | IP 的 HMAC-SHA256 哈希（32 位 hex），仅用于独立访客去重，不可逆 |
| `region` | String | "" | 上报时解析的地域标签（省 / 国家 / 局域网未知），供地域分布直接聚合 |
| `referrerDomain` | String | "" | 来源域名 |
| `device` | String | "desktop" | 设备 (desktop/mobile/tablet) |
| `os` | String | "" | 操作系统 |
| `browser` | String | "" | 浏览器 |
| `createdAt` | DateTime | now() | 创建时间 |
| @@index | - | - | `[date, hour]`、`[date, region]` |

> **隐私说明（VULN-04）**：访问明细不持久化明文 IP。地域在上报时（`POST /api/stats`）
> 即被解析为 `region` 标签，IP 仅保留不可逆的 `ipHash` 用于独立访客去重；
> `/api/stats/geo` 与 `/api/stats/dashboard` 均按 `region` / `(region, ipHash)` 聚合。

### SiteLinkClick - 链接点击统计

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `kind` | String | "site" | 来源类型 (site/friend/project) |
| `linkId` | Int | - | 关联实体的自增 ID |
| `name` | String | - | 链接名称 |
| `url` | String | - | 链接 URL |
| `count` | Int | 0 | 点击次数 |
| `updatedAt` | DateTime | updatedAt | 更新时间 |
| @@unique | - | - | `[kind, linkId]` |
| @@index | - | - | `[count]` |

### ImageAsset - 媒体资产

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `url` | String | unique | 相对路径 (/api/uploads/file/xxx) |
| `fileName` | String | - | 原始文件名 |
| `mimeType` | String | "image/png" | MIME 类型 |
| `size` | Int | 0 | 文件大小 (字节) |
| `width` | Int | 0 | 宽度 |
| `height` | Int | 0 | 高度 |
| `usage` | String | "" | 用途 (avatar/icon/link/wallpaper 等) |
| `createdAt` | DateTime | now() | 创建时间 |
| @@index | - | - | `[mimeType]` |

### UpdateRecord - 更新记录

| 字段名 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `id` | Int | autoincrement | 主键 |
| `version` | String | - | 目标版本号（发布标签，无 v 前缀，如 `0.0.1`） |
| `action` | String | - | update / rollback |
| `method` | String | "image" | 更新方式；现固定为 image(拉取镜像)，历史记录中可能仍存有 build |
| `fromVersion` | String | "" | 变更前版本 |
| `status` | String | "pending" | pending / running / success / failed |
| `message` | String | "" | 结果说明 |
| `description` | String | "" | 发布说明 |
| `triggeredBy` | String | "" | 操作者 |
| `estimatedSeconds` | Int | 0 | 预计耗时（秒） |
| `durationSeconds` | Int? | null | 实际耗时（秒） |
| `createdAt` | DateTime | now() | 创建时间 |
| `finishedAt` | DateTime? | null | 完成时间 |
| @@index | - | - | `[createdAt]` |

---

## 附录：链接列表 API 模式

项目中使用工厂函数 `createLinkListApi()` (`lib/link-list-api.ts`) 来生成社交链接、网站链接和友情链接的 CRUD 路由。三者的接口结构完全一致，差异仅在于：

- **数据库模型**：SocialLink / SiteLink / FriendLink
- **Batch Schema**：单条 schema 扩展可选的 `id` 字段
- **同步策略**：按 id 增量 upsert（非清空重插），确保点击统计的 linkId 不脱节

所有批量保存 (PUT) 请求在 Prisma 事务内执行，保证原子性并自动生成操作日志。