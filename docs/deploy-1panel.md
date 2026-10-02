# 栖云 · Qiyun — 宝塔 / 1Panel 面板部署教程

> **适合人群**：使用宝塔或 1Panel 面板的站长 / 个人开发者
>
> **部署方式**：拉取 GHCR 预编译镜像，零构建、最省内存
>
> **预计耗时**：5–10 分钟

---

## 目录

- [一、前置准备](#一前置准备)
- [二、获取部署文件](#二获取部署文件)
- [三、启动服务](#三启动服务)
- [四、绑定域名 + HTTPS](#四绑定域名--https)
- [五、日常运维](#五日常运维)
- [六、常见问题](#六常见问题)

---

## 一、前置准备

### 1.1 服务器要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| CPU | 1 核 | 2 核+ |
| 内存 | 2 GB | 4 GB+ |
| 磁盘 | 10 GB 可用 | 20 GB+ |
| 系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 7+ | Debian 12 |
| 网络 | 能访问 `ghcr.io`（境内可能需加速） | 直连或加速代理 |

### 1.2 确认 Docker 就绪

| 面板 | 操作 |
|------|------|
| 1Panel | 左侧「容器」能正常打开即已就绪；否则去「应用商店」搜索安装 **Docker 管理器** |
| 宝塔 | 左侧「Docker」菜单；未安装则点击安装 |

验证：

```bash
docker compose version   # 应输出 Docker Compose version v2.x.x
```

### 1.3 放行端口

在云服务商安全组（腾讯云 / 阿里云控制台）放行：

| 端口 | 协议 | 用途 |
|------|------|------|
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 3000 | TCP | 首次调试（可选） |

---

## 二、获取部署文件

### 2.1 下载并解压

1. 打开 [Releases 页面](https://github.com/sxlb/qiyun/releases/latest)，下载 `qiyun-<版本号>.tar.gz`（如 `qiyun-0.0.2.tar.gz`）
2. 上传到服务器并解压：

```bash
tar -xzf qiyun-0.0.2.tar.gz -C /opt
cd /opt/qiyun
```

> 也可用面板的「文件」功能上传后在网页端解压。

解压后目录内有 `deploy.sh`、`docker-compose.yml`、`.env.deploy.example` 三个部署文件。

### 2.2 修改配置（可选）

默认配置开箱即用，**无需任何改动**：脚本首次运行会自动生成 `.env.deploy` 并填入随机密钥。

仅需自定义时才复制示例文件再改：

```bash
cd /opt/qiyun
cp .env.deploy.example .env.deploy
```

| 变量 | 说明 |
|------|------|
| `SEED_ADMIN_PASSWORD` | 后台初始密码（≥ 8 位）。不设则为 `123456`，仅在首次建库时生效 |
| `NEXTAUTH_URL` | 站点完整地址。域名部署时改为 `https://你的域名`，否则登录后会一直跳回登录页 |

---

## 三、启动服务

### 方式 A：一键脚本（推荐）

```bash
cd /opt/qiyun
chmod +x deploy.sh

./deploy.sh          # 自动查询并拉取最新版本
./deploy.sh 0.0.2    # 或指定版本号
```

脚本自动完成：生成密钥 → 拉取镜像 → 启动容器 → 健康检查。看到下面这行即部署成功：

```
✅ 服务已就绪（healthy）
```

> 脚本本质是 `docker compose --env-file .env.deploy up -d`，需要时可自行执行。

验证：浏览器打开 `http://服务器IP:3000`。

### 方式 B：面板 GUI（可选）

不想用命令行时，可在面板里手工建容器。以下参数两种面板通用：

| 参数 | 值 |
|------|-----|
| 镜像 | `ghcr.io/sxlb/qiyun:<版本号>`，如 `ghcr.io/sxlb/qiyun:0.0.2` |
| 容器名 | `qiyun` |
| 端口映射 | 宿主机 `3000` → 容器 `3000`（TCP） |
| 挂载 | 宿主机 `/opt/qiyun/data` → 容器 `/app/data`，读写 |
| 重启策略 | `unless-stopped` |
| 启动命令 | **保持镜像默认，不要覆盖**。默认命令会自动执行数据库迁移与 seed；被覆盖后数据库不会建表，也没有默认账号 |

**环境变量**（逐条添加）：

```
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
TZ=Asia/Shanghai
PORT=3000
HOSTNAME=0.0.0.0
DATABASE_URL=file:/app/data/prod.db
NEXTAUTH_URL=http://你的服务器IP:3000
NEXTAUTH_SECRET=你的密钥
BACKUP_HMAC_KEY=你的密钥
```

> 两个密钥各执行一次 `openssl rand -hex 32` 生成。`BACKUP_HMAC_KEY` 缺失会导致「导出 / 恢复备份」直接失败。

| 面板 | 入口 |
|------|------|
| 1Panel | 左侧「容器」→「编排」→「创建编排」，按上表填写后创建 |
| 宝塔 | 左侧「Docker」→「创建容器」，按上表填写后创建 |

创建后查看日志，出现 `▲ Next.js ... Ready in ...` 即为启动成功。

---

## 四、绑定域名 + HTTPS

### 宝塔面板

1. **网站** → **添加站点**，填写域名，类型选 **反向代理**
2. 目标 URL 填 `http://127.0.0.1:3000`
3. 站点设置 → **SSL** → 申请 **Let's Encrypt** 免费证书，并开启 **强制 HTTPS**

### 1Panel 面板

1. 左侧 **网站** → **创建网站**，类型选 **反向代理**，主机端口 `3000`
2. 勾选 **立即申请 Let's Encrypt 证书**，确定后开启 **强制 HTTPS**

### 收尾（两种面板都要做）

把 `.env.deploy` 中的 `NEXTAUTH_URL` 改为 `https://你的域名`，保存后重启容器：

```bash
docker restart qiyun
```

### 验证访问

- 前台：`https://你的域名`
- 后台：`https://你的域名/admin`
- 默认账号：`admin` / `123456`（设了 `SEED_ADMIN_PASSWORD` 就用你的密码，首次登录会强制改密）

---

## 五、日常运维

```bash
# 查看状态（STATUS 列显示 (healthy) 即正常）
docker ps | grep qiyun

# 实时查看最近 100 行日志
docker logs qiyun -f --tail=100

# 重启 / 停止
docker restart qiyun
docker stop qiyun
```

### 更新版本

**方式一：后台一键更新（需先启用更新通道）**

在服务器上执行一次（需先完成「三、启动服务」，脚本靠 `data/` 目录定位部署位置），幂等，可重复运行：

```bash
cd /opt/qiyun
sudo bash scripts/setup-update.sh
```

它会把更新执行器安装到 `/usr/local/bin`，并写入每分钟轮询的 cron。完成后即可在后台「系统更新」面板一键升级或回滚，也可用命令行操作：

```bash
./scripts/update.sh update 0.0.2     # 更新到指定版本
./scripts/update.sh rollback 0.0.2   # 回滚到历史版本
```

> 更新与回滚都是拉取已发布的预编译镜像，服务器上**不需要 git，也不做本地构建**。未启用更新通道时，后台「系统更新」面板会提示「宿主机更新通道尚未就绪（未安装脚本）」，此时只能用下面「方式二」手动升级。

> 若你只用了镜像、手上没有发布包，脚本也可以直接从容器里取出来：`docker cp qiyun:/app/scripts ./scripts`。

**方式二：手动拉镜像（无需更新通道）**

```bash
cd /opt/qiyun
./deploy.sh 0.0.2     # 改成目标版本号
```

两种方式都保留 `data/` 目录中的数据。

### 备份数据

```bash
# 打包整个数据目录（含数据库与上传文件）
tar -czf qiyun-backup-$(date +%Y%m%d).tar.gz data/
```

> 也可通过面板的「文件」功能直接打包下载 `data/` 目录。

**迁移到另一台服务器**：把 `data/` 目录连同 `deploy.sh`、`docker-compose.yml`、`.env.deploy` 一起拷到新机的 `/opt/qiyun`，执行 `./deploy.sh <版本号>` 即可。`.env.deploy` 里保存着已生成的密钥，一并带走才能保留原有登录态与备份签名。

---

## 六、常见问题

### Q1：容器 unhealthy 或不断重启

```bash
docker logs qiyun --tail=100
```

| 现象 | 解决方案 |
|------|----------|
| `NEXTAUTH_SECRET` 为空 | 确认 `.env.deploy` 中有该变量 |
| 日志出现 `SQLITE_CANTOPEN` 或 `attempt to write a readonly database` | 宿主机 `data/` 目录属主不对（Docker 首次创建时归属 root，而容器内以 UID 1001 运行）。执行 `sudo chown -R 1001:1001 /opt/qiyun/data` 后 `docker restart qiyun` |
| 国内无法访问 `ghcr.io` | 配置 Docker 镜像加速器，或改从 Docker Hub 拉取：`GHCR_IMAGE=docker.io/sxlb/qiyun ./deploy.sh 0.0.2` |

### Q2：页面打不开

1. 确认容器在运行：`docker ps | grep qiyun`
2. 测试本地访问：`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/`，应输出 `200`
3. 多数情况是安全组未放行端口，回到「1.3 放行端口」检查

### Q3：登录后一直跳回登录页

`NEXTAUTH_URL` 与实际访问地址不一致。打开 `.env.deploy`，把它改成浏览器地址栏里的完整 URL（含 `http/https`、域名/IP、端口），保存后 `docker restart qiyun`。

### Q4：忘记管理员密码

```bash
# 进入容器终端
docker exec -it qiyun sh

# 重置为「新密码」（SQLite）
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
(async () => {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash('新密码', 12);   // 轮数须与 lib/auth.ts 的 BCRYPT_SALT_ROUNDS 一致
  await prisma.user.update({
    where: { username: 'admin' },
    data: { password: hash, sessionVersion: { increment: 1 } },  // 自增使旧登录态立即失效
  });
  console.log('密码已重置');
  process.exit(0);
})();
"
```

### Q5：低配服务器 OOM（1GB 内存）

使用预编译镜像无需本地构建，约 400MB 内存即可运行。
