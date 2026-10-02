#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 一键部署脚本（拉取已发布的镜像，无需本地构建）
#
# 用法：
#   ./deploy.sh                    拉取最新版本镜像（自动查询最新 release 的 tag）
#   ./deploy.sh 0.0.2              拉取指定版本镜像（无 v 前缀，与镜像标签一致）
#   PORT=3100 ./deploy.sh          改用其他宿主机端口
#
# 镜像仓库：默认 GHCR（ghcr.io/sxlb/qiyun）；发布时同时推 Docker Hub，
# 需要改从 Docker Hub 拉取时，先 export GHCR_IMAGE=docker.io/sxlb/qiyun 再运行本脚本。
#
# 流程：前置检查 → 解析版本 → 生成密钥并体检 → 准备数据目录 → 拉取镜像
#       → 升级前备份数据库 → 启动 → 健康检查 → 输出运维信息
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env.deploy"
CONTAINER="qiyun"
DATA_DIR="data"
BACKUP_DIR="$DATA_DIR/deploy/backups"
BACKUP_KEEP=20
HEALTH_TIMEOUT=24   # 每轮 5 秒，合计约 120 秒

die()  { echo "✗ $*" >&2; exit 1; }
warn() { echo "⚠ $*" >&2; }

# 取 .env.deploy 中某个变量的值（去掉两端引号）；变量不存在时返回空，而不是让 set -e 中断
env_value() { # key
  { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d "\"'"
}

# ---------- 0. 前置检查 ----------
# 环境不满足时立刻退出。放在最前面是因为这些问题的原始报错（端口已分配、no such file）
# 大多出现在拉镜像或启动阶段，信息晦涩，排查成本远高于在这里直接说清楚。
command -v docker >/dev/null 2>&1 \
  || die "未检测到 docker。请先安装 Docker：https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 \
  || die "需要 Docker Compose v2（命令形式为 docker compose）。若只装了 docker-compose v1，请升级 Docker"
docker info >/dev/null 2>&1 \
  || die "无法连接 Docker 守护进程。请确认 Docker 已启动；非 root 用户还需加入 docker 组"

# 端口来源与 compose 保持一致：进程环境优先，其次 .env.deploy，最后默认 3000
PORT="${PORT:-$(env_value PORT)}"
PORT="${PORT:-3000}"
export PORT
occupied="$(docker ps --filter "publish=${PORT}" --format '{{.Names}}' 2>/dev/null | grep -v "^${CONTAINER}$" | head -1 || true)"
[ -z "$occupied" ] \
  || die "宿主机端口 ${PORT} 已被容器「${occupied}」占用。请先停用它，或换端口部署：PORT=3100 ./deploy.sh"

# ---------- 1. 解析并校验版本号 ----------
# 显式传入优先；否则向 GitHub 查询最新 release 的 tag —— 发布链路只推版本标签，没有 latest。
REPO="${GITHUB_REPO:-sxlb/qiyun}"
IMAGE_TAG="${1:-}"
if [ -z "$IMAGE_TAG" ]; then
  command -v curl >/dev/null 2>&1 \
    || die "未指定版本号，且系统缺少 curl 无法联网查询。请显式指定：./deploy.sh 0.0.2"
  echo "==> 未指定版本，查询最新 release..."
  # curl 失败时置空（set -e + pipefail 会让整条管道失败），交给下方报错分支处理
  IMAGE_TAG=$(curl -fsSL --max-time 15 "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1) || IMAGE_TAG=""
  [ -n "$IMAGE_TAG" ] \
    || die "无法获取最新版本（网络不可达或触发 GitHub 限流），请显式指定：./deploy.sh 0.0.2"
  echo "==> 最新版本：${IMAGE_TAG}"
fi

# 只放行 [0-9A-Za-z.+-] 的三段式。最常见的输入错误是带 v 前缀：镜像标签本身不带 v，
# 写成 v0.0.2 会去拉一个不存在的镜像，而 docker 的报错很难让人联想到是写法问题。
version_ok=1
case "$IMAGE_TAG" in
  *[!0-9A-Za-z.+-]*) version_ok=0 ;;
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) version_ok=0 ;;
esac
[ "$version_ok" = "1" ] || die "版本号不合法：${IMAGE_TAG}（应形如 0.0.2，不带 v 前缀）"

# 必须 export：docker compose 从「进程环境」读取 ${IMAGE_TAG} 做变量插值，
# 未 export 的普通 shell 变量不会传给子进程，会被静默忽略。
export IMAGE_TAG
# GHCR_IMAGE 同理：compose 用 ${GHCR_IMAGE:-ghcr.io/sxlb/qiyun} 插值
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/sxlb/qiyun}"
export GHCR_IMAGE

# ---------- 2. 生成环境变量（无需手动配置） ----------
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

# 关键项体检：只提示、不阻断。这几项配错不会让容器起不来，而是几天后以
# 「登录一直跳回登录页」「备份导出失败」的形式暴露，那时很难联想到环境变量。
secret_val="$(env_value NEXTAUTH_SECRET)"
[ ${#secret_val} -ge 32 ] \
  || warn "NEXTAUTH_SECRET 不足 32 字符，登录态可能异常（生成：openssl rand -hex 32）"
url_val="$(env_value NEXTAUTH_URL)"
case "$url_val" in
  ""|*localhost*|*127.0.0.1*)
    warn "NEXTAUTH_URL 当前为 ${url_val:-（空）}：用域名或公网 IP 访问时会一直跳回登录页，请改成实际地址" ;;
esac

# ---------- 3. 准备数据目录 ----------
# 容器内以非 root（UID 1001）运行，而 docker 自动创建绑定挂载的宿主机目录时归属 root，
# 容器会写不进 SQLite，表现为启动即 unhealthy 并反复重启。这里提前建好并交给容器用户，
# 每次运行都校正一次以便自愈；非 root 执行或调整失败时只提示，由健康检查暴露真实问题。
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  if chown -R "${APP_UID:-1001}:${APP_GID:-1001}" "$DATA_DIR" 2>/dev/null; then
    echo "==> 数据目录 ${DATA_DIR}/ 已就绪（属主 ${APP_UID:-1001}:${APP_GID:-1001}）"
  else
    echo "==> 数据目录 ${DATA_DIR}/ 已就绪（未能调整属主，启动失败请见部署教程的排查项）"
  fi
else
  echo "==> 数据目录 ${DATA_DIR}/ 已就绪（非 root 执行，未调整属主）"
fi

# ---------- 4. 记录当前运行的版本 ----------
# 用于判断这次是「首次部署」还是「版本升级」，决定要不要停容器备份。
cur_version="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null | sed 's/.*://' || true)"
cur_version="${cur_version#v}"

# ---------- 5. 拉取镜像 ----------
# 先拉镜像再动容器：目标版本不存在或网络不通时，正在运行的服务完全不受影响。
echo "==> 拉取 ${GHCR_IMAGE}:${IMAGE_TAG} 镜像..."
if ! docker compose --env-file "$ENV_FILE" pull; then
  warn "拉取失败。若为境内网络问题，可改从 Docker Hub 拉取后重试："
  warn "  GHCR_IMAGE=docker.io/sxlb/qiyun ./deploy.sh ${IMAGE_TAG}"
  die "镜像拉取失败，已终止（现有服务未受影响）"
fi

# ---------- 6. 升级前备份数据库 ----------
# 只在「已有部署 + 版本发生变化」时执行：首次部署无数据可备，同版本重跑也不该反复堆快照。
# 必须先停容器：SQLite 的 WAL 在容器运行时不保证已落盘，直接复制会得到不一致的快照。
if [ -n "$cur_version" ] && [ "$cur_version" != "$IMAGE_TAG" ] && [ -f "$DATA_DIR/prod.db" ]; then
  echo "==> 版本变化：${cur_version} → ${IMAGE_TAG}，停容器并备份数据库..."
  docker compose --env-file "$ENV_FILE" stop || die "停止容器失败"
  mkdir -p "$BACKUP_DIR"
  snap="$BACKUP_DIR/prod-${cur_version}-$(date +%Y%m%d-%H%M%S).db"
  cp -f "$DATA_DIR/prod.db" "$snap" || die "备份数据库失败：${DATA_DIR}/prod.db → ${snap}"
  # 只保留最近若干份，避免长期升级把磁盘堆满
  ls -1t "$BACKUP_DIR"/prod-*.db 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f
  echo "    已备份 ${snap}（${BACKUP_DIR} 内保留最近 ${BACKUP_KEEP} 份）"
elif [ -n "$cur_version" ] && [ "$cur_version" = "$IMAGE_TAG" ]; then
  echo "==> 当前已是 ${IMAGE_TAG}，将重建容器（数据保留）"
fi

# ---------- 7. 启动容器 ----------
echo "==> 启动容器..."
if ! docker compose --env-file "$ENV_FILE" up -d; then
  # 升级路径下旧容器已被停掉，起不来就等于服务中断，这里尝试退回原版本
  if [ -n "$cur_version" ] && [ "$cur_version" != "$IMAGE_TAG" ]; then
    warn "启动失败，尝试退回版本 ${cur_version}..."
    IMAGE_TAG="$cur_version" docker compose --env-file "$ENV_FILE" up -d \
      || warn "退回同样失败，请手动处理"
  fi
  die "启动容器失败，请查看日志：docker compose --env-file ${ENV_FILE} logs -f"
fi

# ---------- 8. 等待健康检查 ----------
echo "==> 等待服务就绪（最长 $((HEALTH_TIMEOUT * 5))s）..."
health_ok=0
health="unknown"
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    sleep 5
    continue
  fi
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "none")
  if [ "$health" = "healthy" ]; then
    health_ok=1
    break
  fi
  # unhealthy 是终态，继续等没有意义，直接跳出并打印日志
  if [ "$health" = "unhealthy" ]; then
    break
  fi
  sleep 5
done

if [ "$health_ok" != "1" ]; then
  echo "❌ 服务未就绪（当前状态：${health}）。最近 40 行日志：" >&2
  docker compose --env-file "$ENV_FILE" logs --tail=40 >&2 || true
  echo "" >&2
  echo "常见原因：宿主机端口被占用 / NEXTAUTH_SECRET 为空 / 数据目录属主不对 / 镜像未拉取完整。" >&2
  echo "完整排查步骤见部署教程的「常见问题」一节。" >&2
  exit 1
fi

echo "✅ 服务已就绪（healthy）"
docker compose --env-file "$ENV_FILE" ps

# ---------- 9. 输出运维信息 ----------
echo ""
echo "──────────── 部署完成 ────────────"
case "$url_val" in
  ""|*localhost*|*127.0.0.1*)
    echo "  访问地址   http://服务器IP:${PORT}（后台加 /admin）" ;;
  *)
    echo "  访问地址   ${url_val}（后台加 /admin）" ;;
esac
# 初始账号只在首次创建数据库时有效，升级时提示会误导
if [ -z "$cur_version" ]; then
  seed_pw="$(env_value SEED_ADMIN_PASSWORD)"
  echo "  初始账号   admin / ${seed_pw:-123456}（首次登录会强制改密）"
fi
echo "  数据目录   $(pwd)/${DATA_DIR}"
if [ -d "$BACKUP_DIR" ]; then
  echo "  数据库快照 ${BACKUP_DIR}（保留最近 ${BACKUP_KEEP} 份）"
fi
echo "  查看日志   docker compose --env-file ${ENV_FILE} logs -f --tail=100"
echo "  备份数据   tar -czf qiyun-backup-\$(date +%Y%m%d).tar.gz ${DATA_DIR}/"
echo "  升级版本   ./deploy.sh 新版本号（升级前会自动备份数据库）"
echo "──────────────────────────────────"
