#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 部署与运维脚本（拉取已发布的镜像，无需本地构建）
#
# 用法：
#   ./deploy.sh                     拉取最新版本镜像并部署
#   ./deploy.sh 0.0.2               部署指定版本（无 v 前缀，与镜像标签一致）
#   ./deploy.sh rollback            回退到上一个版本，并恢复对应的数据库快照
#   ./deploy.sh rollback 0.0.1      回退到指定版本
#   ./deploy.sh backup              立刻做一次数据库快照（会短暂重启容器）
#   ./deploy.sh status              查看当前运行状态
#   ./deploy.sh --help              显示本帮助
#
# 环境变量：
#   PORT=3100                       改用其他宿主机端口
#   GHCR_IMAGE=docker.io/sxlb/qiyun 改从 Docker Hub 拉取
#   GITHUB_REPO=owner/repo          查询最新版本时使用的仓库
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env.deploy"
CONTAINER="qiyun"
DATA_DIR="data"
BACKUP_DIR="$DATA_DIR/deploy/backups"
BACKUP_KEEP=20       # 快照保留份数
HEALTH_TIMEOUT=24    # 每轮 5 秒，合计约 120 秒
MIN_FREE_MB=2048     # 可用磁盘低于此值时告警

die()  { echo "✗ $*" >&2; exit 1; }
warn() { echo "⚠ $*" >&2; }
info() { echo "==> $*"; }

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

# 取 .env.deploy 中某个变量的值（去掉两端引号）；变量不存在时返回空，而不是让 set -e 中断
env_value() { # key
  { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d "\"'"
}

# 从快照文件名解析版本号：prod-<版本>-<YYYYMMDD>-<HHMMSS>.db
snapshot_version() { # path
  basename "$1" | sed -E 's#^prod-(.*)-[0-9]{8}-[0-9]{6}\.db$#\1#'
}

# 快照列表，新到旧
list_snapshots() {
  ls -1t "$BACKUP_DIR"/prod-*.db 2>/dev/null || true
}

# 找某个版本的最新快照，没有则输出空
find_snapshot_for_version() { # version
  local s
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    [ "$(snapshot_version "$s")" = "$1" ] && { echo "$s"; return 0; }
  done <<< "$(list_snapshots)"
  return 0
}

# 未指定回退版本时，按「最新一个比当前更旧」的快照推断目标版本，没有则输出空。
# 只认更旧的版本：否则回退一次之后再执行回退，会被推断成「回退到更新的版本」。
# 版本号比较交给 sort -V，避免 0.0.10 被误判为小于 0.0.9。
infer_rollback_version() { # curVersion
  local s v older
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    v="$(snapshot_version "$s")"
    [ -n "$v" ] || continue
    # 与当前版本相同的快照不代表「更早的状态」，跳过（注意判断要独立于下面的比较，
    # 否则相等的情况会穿过 if 落到返回语句，把当前版本自己当成回退目标）
    [ -n "$1" ] && [ "$v" = "$1" ] && continue
    if [ -n "$1" ]; then
      older="$(printf '%s\n%s\n' "$v" "$1" | sort -V | head -1)"
      [ "$older" = "$v" ] || continue
    fi
    echo "$v"
    return 0
  done <<< "$(list_snapshots)"
  return 0
}

# 生成快照并裁剪超量份数。调用方需先停容器：SQLite 的 WAL 在容器运行时不保证已落盘，
# 直接复制会得到不一致的快照。结果写入全局 SNAP_PATH。
snapshot_stopped() { # srcVersion
  local src="$1"
  mkdir -p "$BACKUP_DIR"
  SNAP_PATH="$BACKUP_DIR/prod-${src}-$(date +%Y%m%d-%H%M%S).db"
  cp -f "$DATA_DIR/prod.db" "$SNAP_PATH" || die "复制数据库失败：${DATA_DIR}/prod.db → ${SNAP_PATH}"
  # 校验文件头：磁盘写满或文件被截断时必须当场发现，否则备份形同虚设
  head -c 16 "$SNAP_PATH" | grep -q '^SQLite format 3' \
    || die "快照不可用：${SNAP_PATH} 不是有效的 SQLite 文件，请检查磁盘空间是否充足"
  ls -1t "$BACKUP_DIR"/prod-*.db 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f
}

# 把快照恢复到数据目录；调用方需先停容器
restore_snapshot() { # path
  local snap="$1"
  # 先清 WAL/SHM：旧日志与新库文件混用会导致数据库损坏
  rm -f "$DATA_DIR/prod.db-wal" "$DATA_DIR/prod.db-shm"
  cp -f "$snap" "$DATA_DIR/prod.db" || die "恢复数据库失败：${snap} → ${DATA_DIR}/prod.db"
}

# 等待容器进入 healthy；失败时打印日志与常见原因。健康检查未定义时视为就绪。
wait_healthy() {
  local health="unknown" i
  info "等待服务就绪（最长 $((HEALTH_TIMEOUT * 5))s）..."
  for i in $(seq 1 "$HEALTH_TIMEOUT"); do
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
      sleep 5
      continue
    fi
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "none")
    [ "$health" = "healthy" ] && return 0
    # unhealthy 是终态，继续等没有意义
    [ "$health" = "unhealthy" ] && break
    sleep 5
  done
  [ "$health" = "none" ] && return 0
  echo "❌ 服务未就绪（当前状态：${health}）。最近 40 行日志：" >&2
  docker compose --env-file "$ENV_FILE" logs --tail=40 >&2 || true
  echo "" >&2
  echo "常见原因：宿主机端口被占用 / NEXTAUTH_SECRET 为空 / 数据目录属主不对 / 镜像未拉取完整。" >&2
  echo "完整排查步骤见部署教程的「常见问题」一节。" >&2
  return 1
}

show_status() {
  local state image health size db_size snaps newest upd
  state="$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "未部署")"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$CONTAINER" 2>/dev/null || echo "-")"
  image="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || echo "-")"
  size="$(du -sh "$DATA_DIR" 2>/dev/null | cut -f1 || echo '-')"
  if [ -f "$DATA_DIR/prod.db" ]; then
    db_size="$(( $(wc -c < "$DATA_DIR/prod.db") / 1024 )) KB"
  else
    db_size="不存在"
  fi
  snaps="$(list_snapshots | grep -c . || true)"
  newest="$(list_snapshots | head -1 || true)"
  [ -n "$newest" ] || newest="-"
  [ -f /usr/local/bin/qiyun-update ] && upd="已安装（后台可一键更新与回滚）" || upd="未安装（sudo bash scripts/setup-update.sh 可启用）"

  echo "──────────── 当前状态 ────────────"
  echo "  容器       ${CONTAINER}    ${state}    health=${health}"
  echo "  运行镜像   ${image}"
  echo "  访问端口   ${PORT}"
  echo "  数据目录   $(pwd)/${DATA_DIR}    ${size:-未知}"
  echo "  数据库     ${db_size}"
  echo "  数据库快照 ${snaps} 份，最新 ${newest}"
  echo "  更新通道   ${upd}"
  echo "──────────────────────────────────"
}

# ---------- 子命令解析（--help 不需要 docker，放在最前） ----------
SUB="deploy"
ROLLBACK_TAG=""
case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  status)         SUB="status" ;;
  backup)         SUB="backup" ;;
  rollback)       SUB="rollback"; ROLLBACK_TAG="${2:-}" ;;
  deploy|"")      SUB="deploy" ;;
  *)              SUB="deploy"; IMAGE_TAG="$1" ;;
esac
IMAGE_TAG="${IMAGE_TAG:-}"

# ---------- 0. 前置检查 ----------
# 环境不满足时立刻退出。这些问题的原始报错（port is already allocated、permission denied）
# 出现在拉镜像或启动阶段，信息晦涩，排查成本远高于在这里直接说清楚。
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

# 磁盘空间：镜像解包、数据库增长、快照堆积都要落盘，提前提醒比中途失败好
free_mb="$(df -Pk . | awk 'NR==2 { print int($4 / 1024) }' || true)"
if [ -n "$free_mb" ] && [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
  warn "当前可用磁盘约 ${free_mb} MB，建议先清理（docker image prune、旧快照）再部署"
fi

# ---------- 1. 记录当前运行的版本 ----------
cur_version="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null | sed 's/.*://' || true)"
cur_version="${cur_version#v}"

# status 只读不改：报告完即退出，不需要 .env.deploy 也无需版本号
if [ "$SUB" = "status" ]; then
  show_status
  exit 0
fi

# ---------- 2. 确定目标版本 ----------
if [ "$SUB" = "rollback" ]; then
  if [ -n "$ROLLBACK_TAG" ]; then
    IMAGE_TAG="$ROLLBACK_TAG"
  else
    IMAGE_TAG="$(infer_rollback_version "${cur_version:-}")"
    [ -n "$IMAGE_TAG" ] \
      || die "找不到可回退的版本：${BACKUP_DIR} 中没有比当前版本更旧的快照。可显式指定：./deploy.sh rollback 0.0.1"
    info "按最新快照推断回退目标：${IMAGE_TAG}"
  fi
elif [ -z "$IMAGE_TAG" ]; then
  # 未指定版本：向 GitHub 查询最新 release 的 tag —— 发布链路只推版本标签，没有 latest
  command -v curl >/dev/null 2>&1 \
    || die "未指定版本号，且系统缺少 curl 无法联网查询。请显式指定：./deploy.sh 0.0.2"
  info "未指定版本，查询最新 release..."
  REPO="${GITHUB_REPO:-sxlb/qiyun}"
  # curl 失败时置空（set -e + pipefail 会让整条管道失败），交给下方报错分支处理
  IMAGE_TAG=$(curl -fsSL --max-time 15 "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1) || IMAGE_TAG=""
  [ -n "$IMAGE_TAG" ] \
    || die "无法获取最新版本（网络不可达或触发 GitHub 限流），请显式指定：./deploy.sh 0.0.2"
  info "最新版本：${IMAGE_TAG}"
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

# ---------- 3. 生成环境变量（无需手动配置） ----------
if [ ! -f "$ENV_FILE" ]; then
  if [ -f .env.deploy.example ]; then
    cp .env.deploy.example "$ENV_FILE"
  else
    # 发布包异常缺失模板时兜底：写出等价的最小配置，避免整条部署链路直接中断
    printf 'NEXTAUTH_SECRET=__GENERATE_RANDOM_KEY__\nNEXTAUTH_URL=http://localhost:3000\n' > "$ENV_FILE"
    info "未找到 .env.deploy.example，已生成最小 .env.deploy"
  fi
fi

# 文件内含两个签名密钥，收紧权限（模板默认权限通常为 644）
chmod 600 "$ENV_FILE" 2>/dev/null || warn "无法收紧 ${ENV_FILE} 权限，请确认它不是其他用户可读"

# 替换弱密钥占位符为随机值
if grep -Eq 'NEXTAUTH_SECRET=["'\''"]?(change-me|__GENERATE_RANDOM_KEY__)' "$ENV_FILE"; then
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
  tmpfile=$(mktemp)
  sed "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=${SECRET}|" "$ENV_FILE" > "$tmpfile"
  mv "$tmpfile" "$ENV_FILE"
  info "已自动生成随机 NEXTAUTH_SECRET"
else
  info "NEXTAUTH_SECRET 已存在，跳过生成"
fi

# 备份签名密钥：未配置时自动生成随机值
# 【Critical 修复 VULN-01】生产环境缺失该变量会导致「导出/恢复备份」直接失败，
# 目的是杜绝用可预测的默认密钥伪造备份、静默覆盖数据库。
if grep -Eq '^BACKUP_HMAC_KEY=.+' "$ENV_FILE"; then
  info "BACKUP_HMAC_KEY 已存在，跳过生成"
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
  info "已自动生成随机 BACKUP_HMAC_KEY"
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

# ---------- 4. 准备数据目录 ----------
# 容器内以非 root（UID 1001）运行，而 docker 自动创建绑定挂载的宿主机目录时归属 root，
# 容器会写不进 SQLite，表现为启动即 unhealthy 并反复重启。这里提前建好并交给容器用户，
# 每次运行都校正一次以便自愈；非 root 执行或调整失败时只提示，由健康检查暴露真实问题。
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  if chown -R "${APP_UID:-1001}:${APP_GID:-1001}" "$DATA_DIR" 2>/dev/null; then
    info "数据目录 ${DATA_DIR}/ 已就绪（属主 ${APP_UID:-1001}:${APP_GID:-1001}）"
  else
    info "数据目录 ${DATA_DIR}/ 已就绪（未能调整属主，启动失败请见部署教程的排查项）"
  fi
else
  info "数据目录 ${DATA_DIR}/ 已就绪（非 root 执行，未调整属主）"
fi

# ---------- 5. 只做快照（backup 子命令） ----------
if [ "$SUB" = "backup" ]; then
  [ -f "$DATA_DIR/prod.db" ] || die "未找到 ${DATA_DIR}/prod.db，还没有可备份的数据"
  was_running=0
  docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" && was_running=1
  info "暂停容器以保证快照一致（完成后自动恢复）..."
  docker compose --env-file "$ENV_FILE" stop || die "停止容器失败"
  snapshot_stopped "${cur_version:-unknown}"
  info "已生成快照：${SNAP_PATH}"
  if [ "$was_running" = "1" ]; then
    docker compose --env-file "$ENV_FILE" up -d || die "容器恢复失败，请手动执行 docker compose --env-file ${ENV_FILE} up -d"
    wait_healthy || exit 1
    info "容器已恢复运行"
  else
    info "容器原本未运行，保持停止状态"
  fi
  exit 0
fi

# ---------- 6. 拉取镜像 ----------
# 先拉镜像再动容器：目标版本不存在或网络不通时，正在运行的服务完全不受影响。
info "拉取 ${GHCR_IMAGE}:${IMAGE_TAG} 镜像..."
if ! docker compose --env-file "$ENV_FILE" pull; then
  warn "拉取失败。若为境内网络问题，可改从 Docker Hub 拉取后重试："
  warn "  GHCR_IMAGE=docker.io/sxlb/qiyun ./deploy.sh ${IMAGE_TAG}"
  die "镜像拉取失败，已终止（现有服务未受影响）"
fi

# ---------- 7. 切换前的数据准备 ----------
if [ "$SUB" = "rollback" ]; then
  info "回退到 ${IMAGE_TAG}..."
  docker compose --env-file "$ENV_FILE" stop || die "停止容器失败"
  # 回退本身也要可回退：先把当前数据留一份
  if [ -f "$DATA_DIR/prod.db" ]; then
    snapshot_stopped "${cur_version:-unknown}"
    info "已把当前数据备份为 ${SNAP_PATH}"
  fi
  # 找到目标版本的最新快照并恢复
  target_snap="$(find_snapshot_for_version "$IMAGE_TAG")"
  if [ -n "$target_snap" ]; then
    restore_snapshot "$target_snap"
    info "已恢复数据库快照：${target_snap}"
  else
    warn "未找到 ${IMAGE_TAG} 的数据库快照，仅切换版本、保留现有数据"
  fi
elif [ -n "$cur_version" ] && [ "$cur_version" != "$IMAGE_TAG" ] && [ -f "$DATA_DIR/prod.db" ]; then
  info "版本变化：${cur_version} → ${IMAGE_TAG}，停容器并备份数据库..."
  docker compose --env-file "$ENV_FILE" stop || die "停止容器失败"
  snapshot_stopped "$cur_version"
  info "已备份 ${SNAP_PATH}（${BACKUP_DIR} 内保留最近 ${BACKUP_KEEP} 份）"
elif [ -n "$cur_version" ] && [ "$cur_version" = "$IMAGE_TAG" ]; then
  info "当前已是 ${IMAGE_TAG}，将重建容器（数据保留）"
fi

# ---------- 8. 启动容器 ----------
info "启动容器..."
new_tag="$IMAGE_TAG"
if ! docker compose --env-file "$ENV_FILE" up -d; then
  # 切换路径下旧容器已被停掉，起不来就等于服务中断，这里尝试回到原版本
  if [ -n "$cur_version" ] && [ "$cur_version" != "$new_tag" ]; then
    warn "启动失败，尝试回到版本 ${cur_version}..."
    if IMAGE_TAG="$cur_version" docker compose --env-file "$ENV_FILE" up -d; then
      die "新版本 ${new_tag} 启动失败，已回到 ${cur_version}。数据库仍是升级后的数据，如需连数据一起回退请执行：./deploy.sh rollback ${cur_version}"
    fi
    die "启动失败，且回到 ${cur_version} 也未成功，服务当前处于停止状态。请查看日志：docker compose --env-file ${ENV_FILE} logs -f"
  fi
  die "启动容器失败，请查看日志：docker compose --env-file ${ENV_FILE} logs -f"
fi

# ---------- 9. 健康检查 ----------
wait_healthy || exit 1
echo "✅ 服务已就绪（healthy）"
docker compose --env-file "$ENV_FILE" ps

# ---------- 10. 输出运维信息 ----------
echo ""
echo "──────────── 部署完成 ────────────"
case "$url_val" in
  ""|*localhost*|*127.0.0.1*)
    echo "  访问地址   http://服务器IP:${PORT}（后台加 /admin）" ;;
  *)
    echo "  访问地址   ${url_val}（后台加 /admin）" ;;
esac
# 初始账号只在首次创建数据库时有效，升级时提示会误导
if [ -z "$cur_version" ] && [ "$SUB" = "deploy" ]; then
  seed_pw="$(env_value SEED_ADMIN_PASSWORD)"
  echo "  初始账号   admin / ${seed_pw:-123456}（首次登录会强制改密）"
fi
echo "  数据目录   $(pwd)/${DATA_DIR}"
if [ -d "$BACKUP_DIR" ]; then
  echo "  数据库快照 ${BACKUP_DIR}（保留最近 ${BACKUP_KEEP} 份）"
fi
if [ ! -f /usr/local/bin/qiyun-update ]; then
  echo "  启用后台一键更新与回滚   sudo bash scripts/setup-update.sh"
fi
echo "  常用命令   ./deploy.sh status | backup | rollback"
echo "             docker compose --env-file ${ENV_FILE} logs -f --tail=100"
echo "             tar -czf qiyun-backup-\$(date +%Y%m%d).tar.gz ${DATA_DIR}/"
echo "──────────────────────────────────"
