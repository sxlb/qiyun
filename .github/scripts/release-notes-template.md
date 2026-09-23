## 栖云 · Qiyun {{VERSION}} ({{DATE}})

### 变更摘要
<!-- 自动从提交记录生成 -->
{{CHANGES}}

### 产物内容
| 文件/目录 | 说明 |
|-----------|------|
| `.next/standalone/` | Next.js standalone 构建产物（含 server.js 与精简依赖） |
| `.next/static/` | 静态资源 |
| `public/` | 静态文件与自托管字体 |
| `prisma/` | Prisma schema + migrations + seed |
| `Dockerfile` | 生产镜像构建文件 |
| `docker-compose.yml` | 容器编排（SQLite 数据卷 + 健康检查 + 日志轮转） |
| `deploy.sh` / `deploy.ps1` | Linux / Windows 一键部署脚本 |
| `.env.deploy.example` | 环境变量模板 |

### 部署步骤

1. **解压产物包**

   ```bash
   tar -xzf qiyun-{{TAG}}.tar.gz
   cd qiyun
   ```

2. **准备环境变量**

   首次部署执行 `./deploy.sh`（或 `.\deploy.ps1`）时会自动生成 `.env.deploy` 与随机 `NEXTAUTH_SECRET`；如需自定义，参考 `.env.deploy.example` 手动填写。

3. **执行部署**

   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

   （或手动：`docker compose --env-file .env.deploy up -d --build`）

4. **验证**

   ```bash
   curl http://localhost:3000/api/ping
   # 期望 {"ok":true}
   ```

### 数据库变更

- **引擎**：SQLite 单文件（数据卷 `./data/prod.db`）
- **Migrations**：容器启动时自动执行 `prisma migrate deploy`
- **Seed 数据**：首次启动自动 seed（默认账号 `admin`，密码见 `SEED_ADMIN_PASSWORD` 或容器启动日志；已存在则跳过）
- **⚠️ 注意**：升级前请备份数据目录（`docker compose down` 后复制 `./data/`）

### 环境变量说明

| 变量名 | 必填 | 说明 | 示例 |
|--------|------|------|------|
| `DATABASE_URL` | ✅ | SQLite 文件路径（compose 已预设） | `file:/app/data/prod.db` |
| `NEXTAUTH_SECRET` | ✅ | NextAuth 签名密钥（deploy 脚本自动生成） | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | 应用对外访问地址（反代/域名时必须设置） | `https://home.example.com` |
| `SEED_ADMIN_PASSWORD` | — | 默认管理员密码（≥8 位，留空则随机生成） | 自定或留空 |

### 回滚方案

```bash
# 1. 停止并备份数据
docker compose down
cp -r data data.bak.$(date +%F)

# 2. 从上一版本 tag 重新部署
git fetch --tags
git checkout <上一版本tag>
./deploy.sh
```

### 已知问题

- 无

### 完整 CHANGELOG

{{COMPARE_LINK}}
