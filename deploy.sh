#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 一键部署脚本（仅支持 GHCR 镜像模式）
#
# 用法：
#   ./deploy.sh                    拉取 latest 镜像
#   ./deploy.sh v0.0.1             拉取指定版本镜像
#
# 功能：自动生成密钥 → 拉取镜像 → 启动 → 等待健康检查
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

IMAGE_TAG="${1:-latest}"

ENV_FILE=".env.deploy"
CONTAINER="qiyun"

# ---------- 1. 自动准备环境变量（无需手动配置） ----------
if [ ! -f "$ENV_FILE" ]; then
  cp .env.deploy.example "$ENV_FILE"
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

# ---------- 2. 拉取镜像并启动 ----------
echo "==> 拉取 ghcr.io/sxlb/qiyun:${IMAGE_TAG} 镜像..."
docker compose --env-file "$ENV_FILE" pull

echo "==> 启动容器..."
docker compose --env-file "$ENV_FILE" up -d

# ---------- 3. 等待健康检查 ----------
echo "==> 等待服务就绪（最长 120s）..."
for i in $(seq 1 24); do
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    sleep 5
    continue
  fi
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "none")
  if [ "$health" = "healthy" ]; then
    echo "✅ 服务已就绪（healthy)"
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
