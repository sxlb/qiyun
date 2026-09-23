# 栖云 · Qiyun — 宝塔 / 1Panel 面板部署教程

> **适合人群**：使用宝塔或 1Panel 面板的站长 / 个人开发者
>
> **部署方式**：GHCR 预编译镜像（零构建，最快最省内存）
>
> **预计耗时**：首次部署 5–10 分钟

---

## 目录

- [一、前置准备](#一前置准备)
- [二、创建配置文件](#二创建配置文件)
- [三、启动服务](#三启动服务)
- [四、绑定域名 + HTTPS](#四绑定域名--https)
- [五、日常运维](#五日常运维)
- [六、常见问题](#六常见问题)

---

## 一、前置准备

### 1.1 服务器要求

| 项目 | 最低要求 | 推荐配置 |
|------|----------|----------|
| CPU | 1 核 | 2 核+ |
| 内存 | 2 GB | 4 GB+ |
| 磁盘 | 10 GB 可用空间 | 20 GB+ |
| 操作系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 7+ | Debian 12 |
| 网络 | 能访问 `ghcr.io`（国内服务器可能需代理） | 直连或通过加速代理 |

### 1.2 确认 Docker 已就绪

**1Panel 用户**：

1. 左侧菜单 → **容器**
2. 页面正常加载即表示 Docker 运行中

如果无法正常使用：

1. 左侧 → **应用商店**
2. 搜索 `Docker`，安装 **Docker 管理器**

验证命令：

```bash
docker compose version
```

应输出 `Docker Compose version v2.x.x`。

**宝塔用户**：

1. 宝塔面板 → **Docker**（左侧菜单）
2. 如未安装，点击安装

验证命令同上。

### 1.3 放行端口

无论使用哪种面板，需在服务器安全组（腾讯云 / 阿里云控制台）放行：

| 端口 | 协议 | 用途 |
|------|------|------|
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 3000 | TCP | 临时调试（可选） |

---

## 二、创建配置文件

在服务器上创建一个工作目录并生成 `.env.deploy` 文件：

```bash
mkdir -p /opt/qiyun
cd /opt/qiyun
```

创建配置文件 `/opt/qiyun/.env.deploy`：

```ini
# NextAuth 密钥（自动生成）
NEXTAUTH_SECRET=__GENERATE_RANDOM_KEY__

# 站点地址（二选一）
NEXTAUTH_URL=http://你的服务器IP:3000
# NEXTAUTH_URL=https://你的域名

# 管理员初始密码（≥ 8 位）
SEED_ADMIN_PASSWORD=你的强密码
```

> **NEXTAUTH_SECRET**：如值为 `__GENERATE_RANDOM_KEY__`，脚本会自动生成 64 位随机字符串替换。
>
> **SEED_ADMIN_PASSWORD**：仅在首次建库时生效。未设或不足 8 位时默认使用 `123456`。

保存文件。

---

## 三、启动服务

### 方式 A：一键脚本（推荐，最简单）

在服务器终端中执行：

```bash
# 进入工作目录
cd /opt/qiyun

# 拉取 GHCR 预编译镜像并启动
./deploy.sh image latest
```

脚本会自动完成：密钥生成 → 数据库迁移 → 启动服务 → 健康检查。出现以下提示即成功：

```
✅ 服务已就绪（healthy）
```

如果还没有 `deploy.sh`，也可以手动执行：

```bash
cd /opt/qiyun

# 确保 .env.deploy 存在
test -f .env.deploy || echo "NEXTAUTH_SECRET=$(openssl rand -hex 32)" > .env.deploy

# 创建数据目录
mkdir -p data

# 启动容器
docker run -d \
  --name qiyun \
  --restart unless-stopped \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --env-file .env.deploy \
  ghcr.io/sxlb/qiyun:latest
```

### 方式 B：面板 GUI（可选）

如果你更习惯可视化操作：

#### 1Panel 容器编排

1. 左侧 → **容器** → **编排** → **创建编排**

| 字段 | 值 |
|------|-----|
| 编排名称 | `qiyun` |

**基础信息：**

| 字段 | 值 |
|------|-----|
| 服务名称 | `qiyun` |
| 镜像 | `ghcr.io/sxlb/qiyun:latest` |

**端口映射：**

| 宿主机端口 | 容器端口 | 协议 |
|------------|----------|------|
| 3000 | 3000 | TCP |

**环境变量**（逐条添加）：

```
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
TZ=Asia/Shanghai
PORT=3000
HOSTNAME=0.0.0.0
DATABASE_URL=file:/app/data/prod.db
NEXTAUTH_SECRET=你的密钥
```

**挂载：**

| 类型 | 宿主机路径 | 容器路径 | 权限 |
|------|-----------|----------|------|
| bind | `/opt/qiyun/data` | `/app/data` | 读写 |

**重启策略**：`unless-stopped`

点击 **创建**，等待状态变为 **运行中**。

#### 宝塔 Docker 容器

1. 宝塔面板 → **Docker** → **创建容器**

| 参数 | 值 |
|------|-----|
| 容器名称 | `qiyun` |
| 镜像 | `ghcr.io/sxlb/qiyun:latest` |
| 端口映射 | `3000:3000` |

**环境变量**（逐条添加）：

```
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
TZ=Asia/Shanghai
PORT=3000
HOSTNAME=0.0.0.0
DATABASE_URL=file:/app/data/prod.db
NEXTAUTH_SECRET=你的密钥
```

**存储挂载**：

```
宿主机 /opt/qiyun/data → 容器 /app/data
```

**重启策略**：`unless-stopped`

点击 **创建**，查看日志确认出现 `▲ Next.js ... Ready in ...`。

---

## 四、绑定域名 + HTTPS

### 宝塔面板

1. 宝塔面板 → **网站** → **添加站点**
2. 填写你的域名，类型选择 **反向代理**
3. 目标 URL 填入 `http://127.0.0.1:3000`
4. 进入站点设置 → **SSL** → 申请 **Let's Encrypt** 免费证书
5. 开启 **强制 HTTPS**
6. 将 `NEXTAUTH_URL` 改为 `https://你的域名`，保存后重启容器

### 1Panel 面板

1. 左侧 → **网站** → **创建网站**
2. 类型选 **反向代理**，主机端口 `3000`
3. 勾选 **立即申请 Let's Encrypt 证书**
4. 点击 **确定**，开启 **强制 HTTPS**
5. 将 `NEXTAUTH_URL` 改为 `https://你的域名`，保存后重启容器

### 验证访问

- 前台：`https://你的域名`
- 后台：`https://你的域名/admin`
- 默认账号：`admin` / `123456`（如你设置了自定义密码则使用自定义密码）

---

## 五、日常运维

### 5.1 查看服务状态

```bash
docker ps | grep qiyun
```

STATUS 列显示 `(healthy)` 即为正常。

### 5.2 查看日志

```bash
# 实时查看最近 100 行
docker logs qiyun -f --tail=100
```

### 5.3 重启 / 停止服务

```bash
# 重启
docker restart qiyun

# 停止
docker stop qiyun
```

### 5.4 更新版本

```bash
# 拉取最新镜像
docker pull ghcr.io/sxlb/qiyun:latest

# 重新运行相同配置的容器（数据保留在 data/ 目录）
docker rm qiyun
docker run -d --name qiyun --restart unless-stopped -p 3000:3000 -v $(pwd)/data:/app/data --env-file .env.deploy ghcr.io/sxlb/qiyun:latest
```

或在面板中重建容器。

### 5.5 备份数据

```bash
tar -czf qiyun-backup-$(date +%Y%m%d).tar.gz qiyun/data/
```

也可通过面板的文件管理直接打包下载 `data/` 目录。

---

## 六、常见问题

### Q1：容器状态 unhealthy 或不断重启

```bash
docker logs qiyun --tail=100
```

常见原因：

| 现象 | 解决方案 |
|------|----------|
| `NEXTAUTH_SECRET` 为空 | 确认 `.env.deploy` 中有该变量 |
| 国内无法访问 `ghcr.io` | 配置 Docker 镜像加速器或使用其他源 |

### Q2：页面打不开

1. 确认容器正常运行：`docker ps | grep qiyun`
2. 测试本地访问：`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/`，应输出 `200`
3. 99% 原因是安全组未放行端口（回顾第一节第 3 步）

### Q3：登录后一直跳回登录页

`NEXTAUTH_URL` 与实际访问地址不一致导致。

解决方案：

1. 打开 `/opt/qiyun/.env.deploy`
2. 将 `NEXTAUTH_URL` 改为浏览器地址栏中的完整 URL（包括 `http/https`、域名/IP、端口）
3. 保存后重启容器

### Q4：忘记管理员密码

```bash
# 进入容器交互式终端
docker exec -it qiyun sh

# 重置密码（SQLite）
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
(async () => {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash('新密码', 10);
  await prisma.user.update({
    where: { username: 'admin' },
    data: { passwordHash: hash },
  });
  console.log('密码已重置');
  process.exit(0);
})();
"
```

### Q5：低配服务器 OOM（1GB 内存）

使用 GHCR 预编译镜像 `ghcr.io/sxlb/qiyun:latest`，无需本地构建，仅需约 400MB 内存即可运行。
