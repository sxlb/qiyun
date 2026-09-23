#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 更新通道一键安装（在部署服务器上执行一次，幂等）
# 作用：
#   1. 确保部署目录是真实 git 克隆（含 .git 与远端 tags）——
#      更新/回滚依赖 git checkout <tag>，仅 tar 解压出的目录没有 .git 无法工作
#   2. 安装 update-watch.sh / update.sh 到 /usr/local/bin（仓库外，避免切 tag 被覆盖）
#   3. 写入 cron：每分钟 flock 轮询 data/deploy/request.json
#   4. 写基线 data/deploy/versions.json（缺省时），与 package.json 版本对齐
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

# ---------- 1. 确保 git 克隆 ----------
cd "$REPO_DIR"
if [ ! -d .git ]; then
  echo "==> 未发现 .git，初始化为 git 克隆并拉取远端 tags..."
  git init -q 2>/dev/null || true
  git remote remove origin 2>/dev/null || true
  git remote add origin https://github.com/sxlb/qiyun.git
fi
echo "==> 拉取 origin 与 tags..."
git fetch origin --tags --prune 2>&1 | sed 's/^/    /' || { echo "  （fetch 失败，可稍后手工执行 git fetch）"; }

# ---------- 2. 安装执行器到系统路径 ----------
mkdir -p /usr/local/bin
install -m 0755 "$SCRIPTS_DIR/update-watch.sh" /usr/local/bin/qiyun-update
install -m 0755 "$SCRIPTS_DIR/update.sh"        /usr/local/bin/qiyun-update-cli
echo "==> 已安装 /usr/local/bin/qiyun-update 与 qiyun-update-cli"

# ---------- 3. 安装 cron（每分钟 flock 轮询，幂等） ----------
CRON_LINE="* * * * * flock -n /tmp/qiyun-update.lock env REPO_DIR=$REPO_DIR /usr/local/bin/qiyun-update >/dev/null 2>&1"
if crontab -l 2>/dev/null | grep -qF "qiyun-update"; then
  echo "==> 定时器已存在，跳过（如需更新请手工编辑 crontab -e）"
else
  ( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
  echo "==> 已写入 cron：$CRON_LINE"
fi

# ---------- 4. 写基线版本 ----------
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
  # 与运行中应用报告的版本（package.json）对齐；无 node 时回退 git tag
  VER=""
  if command -v node >/dev/null 2>&1; then
    # 去掉 v 前缀，与 git tag / 应用 CURRENT_VERSION 的语义化版本保持一致
    VER="$( (node -p "require('$REPO_DIR/package.json').version" 2>/dev/null || node -p "require('./package.json').version") | sed 's/^v//i' )"
  fi
  [ -n "$VER" ] || VER="$(git describe --tags --abbrev=0 2>/dev/null || echo 'v0.0.0')"
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