#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 更新通道一键安装（在部署服务器上执行一次，幂等）
# 作用：
#   1. 安装 update-watch.sh / update.sh 到 /usr/local/bin（部署目录之外，避免被更新覆盖）
#   2. 写入 cron：每分钟 flock 轮询 data/deploy/request.json
#   3. 写基线 data/deploy/versions.json（缺省时）
#
# 全程不需要 git：更新与回滚都是拉取已发布的镜像，服务器上不做本地构建。
#
# 用法：sudo bash scripts/setup-update.sh   （在服务器上，于仓库目录或其上级执行）
# ============================================================
set -euo pipefail

# ---------- 定位仓库目录 ----------
find_repo() {
  local c="${1:-$PWD}"
  for d in "$c" "$c/qiyun" "$HOME/qiyun" "$HOME"; do
    if [ -f "$d/docker-compose.yml" ] && [ -d "$d/data" ]; then echo "$d"; return 0; fi
  done
  return 1
}
REPO_DIR="${REPO_DIR:-$(find_repo)}"
[ -n "$REPO_DIR" ] || { echo "未定位到仓库目录，请设置 REPO_DIR=/path/to/qiyun 后重试" >&2; exit 1; }
REPO_DIR="$(cd "$REPO_DIR" && pwd)"
DEPLOY_DIR="$REPO_DIR/data/deploy"
SCRIPTS_DIR="$REPO_DIR/scripts"
echo "仓库目录：$REPO_DIR"

cd "$REPO_DIR"

# ---------- 1. 安装执行器到系统路径 ----------
mkdir -p /usr/local/bin
install -m 0755 "$SCRIPTS_DIR/update-watch.sh" /usr/local/bin/qiyun-update
install -m 0755 "$SCRIPTS_DIR/update.sh"        /usr/local/bin/qiyun-update-cli
echo "==> 已安装 /usr/local/bin/qiyun-update 与 qiyun-update-cli"

# ---------- 2. 安装 cron（每分钟 flock 轮询，幂等） ----------
CRON_LINE="* * * * * flock -n /tmp/qiyun-update.lock env REPO_DIR=$REPO_DIR /usr/local/bin/qiyun-update >/dev/null 2>&1"
# 幂等判断的记号取锁文件路径，而不是脚本名：qiyun-update-cli 里也含 "qiyun-update"
# 子串，用脚本名匹配会把「只装了命令行工具、没装定时器」误判成「已安装」，从此再也装不上定时器。
CRON_MARK="/tmp/qiyun-update.lock"
if ! command -v crontab >/dev/null 2>&1; then
  # 没有 crontab 就没法启用定时更新。此处必须明确报错并退出：
  # 否则会以一行 `crontab: command not found` 在管道处中断，后面的基线版本也不会写，
  # 面板只显示「更新通道尚未就绪」，完全看不出真实原因。
  echo "✗ 未检测到 crontab 命令，无法启用定时更新通道。" >&2
  echo "  请先安装 cron（Debian/Ubuntu：apt-get install -y cron；Alpine：apk add busybox-initscripts），再重新执行本脚本。" >&2
  exit 1
fi
# 先把现有 crontab 读进变量再判断，不要写成 `crontab -l | grep -q`：
# grep -q 命中即退出会关闭管道，crontab -l 收到 SIGPIPE 以非 0 结束，
# 在 set -o pipefail 下整条管道被判为失败 —— 已有定时器的机器会因此重复写入一行。
existing_cron="$(crontab -l 2>/dev/null || true)"
case "$existing_cron" in
  *"$CRON_MARK"*)
    echo "==> 定时器已存在，跳过（如需更新请手工编辑 crontab -e）"
    ;;
  *)
    # 用 { ... } 而非 ( ... )：本脚本是 set -euo pipefail，而「机器上还没有任何 crontab」时
    # `crontab -l` 返回非 0。放进子 shell 会让子 shell 当场中止，后面那行 echo 永远执行不到，
    # 结果是 cron 没装上、面板一直提示「更新通道尚未就绪」——全新服务器必然踩中。
    if [ -n "$existing_cron" ]; then
      { printf '%s\n' "$existing_cron"; echo "$CRON_LINE"; } | crontab -
    else
      echo "$CRON_LINE" | crontab -
    fi
    echo "==> 已写入 cron：$CRON_LINE"
    ;;
esac

# ---------- 3. 写基线版本 ----------
mkdir -p "$DEPLOY_DIR"
# 容器以非 root（uid 1001）运行，需要能往 deploy 目录写握手请求 request.json；
# 这里以 root 创建的目录必须交给容器用户，否则后台点更新会因 EACCES 报「服务器内部错误」。
APP_UID="${APP_UID:-1001}"
APP_GID="${APP_GID:-1001}"
if [ "$(id -u)" = "0" ]; then
  chown "$APP_UID:$APP_GID" "$DEPLOY_DIR" 2>/dev/null || true
  chmod 775 "$DEPLOY_DIR" 2>/dev/null || true
  [ -f "$DEPLOY_DIR/../latest.json" ] && chown "$APP_UID:$APP_GID" "$DEPLOY_DIR/../latest.json" 2>/dev/null
  echo "==> 已校正 $DEPLOY_DIR 属主为 $APP_UID:$APP_GID（容器写入握手请求用）"
fi
VERSION_FILE="$DEPLOY_DIR/versions.json"
if [ ! -f "$VERSION_FILE" ]; then
  # 优先读运行中容器的镜像标签（即当前实际运行的版本）；容器不存在时回退 package.json，最后兜底 0.0.0
  VER="$(docker inspect --format '{{.Config.Image}}' qiyun 2>/dev/null | sed 's/.*://' || true)"
  if [ -z "$VER" ] && command -v node >/dev/null 2>&1; then
    VER="$( (node -p "require('$REPO_DIR/package.json').version" 2>/dev/null || node -p "require('./package.json').version") | sed 's/^v//i' )"
  fi
  [ -n "$VER" ] || VER="0.0.0"
  # 统一去掉 v 前缀：发布触发标签与发布产物均为无 v 版本号（0.0.1）
  VER="${VER#v}"
  AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '{\n  "currentVersion": "%s",\n  "updatedAt": "%s",\n  "history": [{"version": "%s", "action": "baseline", "at": "%s"}]\n}\n' \
    "$VER" "$AT" "$VER" "$AT" > "$VERSION_FILE"
  echo "==> 已写入基线版本：$VER"
else
  echo "==> 已存在 versions.json，当前基线：$(head -n2 "$VERSION_FILE" | tail -n1)"
fi

echo
echo "✅ 更新通道安装完成。"
echo "   检查：crontab -l | grep qiyun-update"
echo "   手动验证：bash /usr/local/bin/qiyun-update （无请求时应立即退出且无报错）"