#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 一键部署脚本（拉取已发布的镜像，无需本地构建）
#
# 用法：
#   ./deploy.sh                    拉取最新版本镜像（自动查询最新 release 的 tag）
#   ./deploy.sh 0.0.1              拉取指定版本镜像（无 v 前缀，与镜像标签一致）
#
# 镜像仓库：默认 GHCR（ghcr.io/sxlb/qiyun）；发布时同时推 Docker Hub，
# 需要改从 Docker Hub 拉取时，先 export GHCR_IMAGE=docker.io/sxlb/qiyun 再运行本脚本。
#
# 功能：自动生成密钥 → 准备数据目录 → 拉取镜像 → 启动 → 等待健康检查
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

# 版本来源：显式传入优先；否则向 GitHub 查询最新 release 的 tag ——
# 发布链路只推版本标签（如 0.0.1），没有可用的 latest 了。
REPO="${GITHUB_REPO:-sxlb/qiyun}"
IMAGE_TAG="${1:-}"
if [ -z "$IMAGE_TAG" ]; then
  echo "==> 未指定版本，查询最新 release..."
  # curl 失败时置空（set -e + pipefail 会让整条管道失败），交给下方报错分支处理
  IMAGE_TAG=$(curl -fsSL --max-time 15 "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1) || IMAGE_TAG=""
  if [ -z "$IMAGE_TAG" ]; then
    echo "✗ 无法获取最新版本（网络不可达或触发限流），请显式指定：./deploy.sh 0.0.1" >&2
    exit 1
  fi
  echo "==> 最新版本：${IMAGE_TAG}"
fi
# 必须 export：docker compose 从「进程环境」读取 ${IMAGE_TAG} 做变量插值，
# 未 export 的普通 shell 变量不会传给子进程，会被静默忽略。
export IMAGE_TAG

# GHCR_IMAGE 同样需已导出：compose 用 ${GHCR_IMAGE:-ghcr.io/sxlb/qiyun} 插值
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/sxlb/qiyun}"
export GHCR_IMAGE

ENV_FILE=".env.deploy"
CONTAINER="qiyun"

# ---------- 1. 自动准备环境变量（无需手动配置） ----------
if [ ! -f "$ENV_FILE" ]; then
  if [ -f .env.deploy.example ]; then
    cp .env.deploy.example "$ENV_FILE"
  else
    # 发布包异常缺失模板时兜底：写出等价的最小配置，避免整条部署链路直接中断
    printf 'NEXTAUTH_SECRET=__GENERATE_RANDOM_KEY__\nNEXTAUTH_URL=http://localhost:3000\n' > "$ENV_FILE"
    echo "==> 未找到 .env.deploy.example，已生成最小 .env.deploy"
  fi
fi

# 替换弱密钥占位符为随机值
if grep -Eq 'NEXTAUTH_SECRET=["'\''"]?(change-me|__GENERATE_RANDOM_KEY__)' "$ENV_FILE"; then
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
  tmpfile=$(mktemp)
  sed "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=${SECRET}|" "$ENV_FILE" > "$tmpfile"
  mv "$tmpfile" "$ENV_FILE"
  echo "==> 已自动生成随机 NEXTAUTH_SECRET"
else
  echo "==> NEXTAUTH_SECRET 已存在，跳过生成"
fi

# 备份签名密钥：未配置时自动生成随机值
# 【Critical 修复 VULN-01】生产环境缺失该变量会导致「导出/恢复备份」直接失败，
# 目的是杜绝用可预测的默认密钥伪造备份、静默覆盖数据库。
if grep -Eq '^BACKUP_HMAC_KEY=.+' "$ENV_FILE"; then
  echo "==> BACKUP_HMAC_KEY 已存在，跳过生成"
else
  BACKUP_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
  tmpfile=$(mktemp)
  if grep -Eq '^#?BACKUP_HMAC_KEY=' "$ENV_FILE"; then
    sed "s|^#\?BACKUP_HMAC_KEY=.*|BACKUP_HMAC_KEY=${BACKUP_KEY}|" "$ENV_FILE" > "$tmpfile"
  else
    cp "$ENV_FILE" "$tmpfile"
    printf '\nBACKUP_HMAC_KEY=%s\n' "$BACKUP_KEY" >> "$tmpfile"
  fi
  mv "$tmpfile" "$ENV_FILE"
  echo "==> 已自动生成随机 BACKUP_HMAC_KEY"
fi

# ---------- 2. 准备数据目录 ----------
# 容器内以非 root（UID 1001）运行，而 docker 自动创建绑定挂载的宿主机目录时归属 root，
# 容器会写不进 SQLite，表现为启动即 unhealthy 并反复重启。这里提前建好并交给容器用户，
# 每次运行都校正一次以便自愈；非 root 执行或调整失败时只提示，由健康检查暴露真实问题。
mkdir -p data
if [ "$(id -u)" = "0" ]; then
  if chown -R "${APP_UID:-1001}:${APP_GID:-1001}" data 2>/dev/null; then
    echo "==> 数据目录 data/ 已就绪（属主 ${APP_UID:-1001}:${APP_GID:-1001}）"
  else
    echo "==> 数据目录 data/ 已就绪（未能调整属主，启动失败请见部署教程的排查项）"
  fi
else
  echo "==> 数据目录 data/ 已就绪（非 root 执行，未调整属主）"
fi

# ---------- 3. 拉取镜像并启动 ----------
echo "==> 拉取 ${GHCR_IMAGE:-ghcr.io/sxlb/qiyun}:${IMAGE_TAG} 镜像..."
docker compose --env-file "$ENV_FILE" pull

echo "==> 启动容器..."
docker compose --env-file "$ENV_FILE" up -d

# ---------- 4. 等待健康检查 ----------
echo "==> 等待服务就绪（最长 120s）..."
for i in $(seq 1 24); do
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    sleep 5
    continue
  fi
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "none")
  if [ "$health" = "healthy" ]; then
    echo "✅ 服务已就绪（healthy）"
    docker compose --env-file "$ENV_FILE" ps
    exit 0
  fi
  if [ "$health" = "unhealthy" ]; then
    echo "❌ 健康检查失败，请查看日志：docker compose --env-file ${ENV_FILE} logs -f"
    exit 1
  fi
  sleep 5
done

echo "❌ 等待超时，请查看日志：docker compose --env-file ${ENV_FILE} logs -f"
exit 1
