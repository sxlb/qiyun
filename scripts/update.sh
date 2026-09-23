#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 手动更新/回滚入口（宿主机侧命令行工具）
# 用法：./scripts/update.sh update v1.3.0      # 更新到指定 tag
#       ./scripts/update.sh rollback v1.2.0    # 回滚到历史 tag
# 原理：与后台「系统更新」面板完全相同的握手通道：
#       把请求写入 data/deploy/request.json，再调用 update-watch.sh 执行。
#       适合在没有后台界面或需要脚本化时使用。
# ============================================================
set -euo pipefail

ACTION="${1:-}"
VERSION="${2:-}"
if [ "$ACTION" != "update" ] && [ "$ACTION" != "rollback" ]; then
  echo "用法：$0 <update|rollback> <git-tag>" >&2
  exit 1
fi
[ -n "$VERSION" ] || { echo "缺少目标版本（git tag，如 v1.3.0）" >&2; exit 1; }

# 定位仓库与数据目录（与 update-watch.sh 一致）
REPO_DIR="${REPO_DIR:-}"
if [ -z "$REPO_DIR" ]; then
  _scr="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  for _c in "$_scr" "$PWD" "$HOME/qiyun"; do
    if [ -f "$_c/docker-compose.yml" ] && [ -d "$_c/data" ]; then REPO_DIR="$_c"; break; fi
  done
fi
[ -n "$REPO_DIR" ] || { echo "未定位到仓库目录，请设置 REPO_DIR=/path/to/qiyun" >&2; exit 1; }
REPO_DIR="$(cd "$REPO_DIR" && pwd)"
DEPLOY_DIR="$REPO_DIR/data/deploy"
mkdir -p "$DEPLOY_DIR"

# 并发防护：若已有待执行 / 执行中请求，则不覆盖
if [ -f "$DEPLOY_DIR/request.json" ] || ls "$DEPLOY_DIR"/running-*.json >/dev/null 2>&1; then
  echo "已有待执行或正在执行的更新任务，请等待完成。" >&2
  exit 1
fi

now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
id="$(date +%s)-cli-$$"
printf '{\n  "id": "%s",\n  "action": "%s",\n  "version": "%s",\n  "requestedBy": "%s",\n  "createdAt": "%s"\n}\n' \
  "$id" "$ACTION" "$VERSION" "cli" "$now" > "$DEPLOY_DIR/request.json"

echo "已提交${ACTION}请求到 ${VERSION}，开始执行..."
# 调用执行器单次处理该请求
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update-watch.sh"