#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 更新/回滚执行器（宿主机侧，由 cron 每分钟调用一次）
# 作用：轮询 data/deploy/request.json（应用后台写入的握手请求），
#       认领后备份数据库 → git 切换到目标版本 → 重建重启容器 → 写回执行结果，
#       并维护 data/deploy/versions.json 的版本权威记录。
#
# 安装（建议装到仓库之外，避免更新切 tag 时被覆盖）：
#   sudo cp scripts/update-watch.sh /usr/local/bin/qiyun-update
#   sudo chmod +x /usr/local/bin/qiyun-update
#   crontab -e 添加（必须指定 REPO_DIR 为部署仓库目录）：
#       * * * * * flock -n /tmp/qiyun-update.lock env \
#                    REPO_DIR=/home/yourname/qiyun \
#                    /usr/local/bin/qiyun-update >/dev/null 2>&1
# 也可直接置于仓库 scripts/ 内运行：此时自动以仓库目录为 REPO_DIR。
# ============================================================
set -euo pipefail

# ---------- 可覆盖配置 ----------
# 仓库目录（含 .git、docker-compose.yml、deploy.sh、data/ 的部署目录）
REPO_DIR="${REPO_DIR:-}"
if [ -z "$REPO_DIR" ]; then
  _scr="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _cand="$(cd "$_scr/.." && pwd)"
  if [ -f "$_cand/docker-compose.yml" ] && [ -d "$_cand/data" ]; then
    REPO_DIR="$_cand"
  else
    for _c in "$PWD" "$HOME/qiyun"; do
      if [ -f "$_c/docker-compose.yml" ] && [ -d "$_c/data" ]; then REPO_DIR="$_c"; break; fi
    done
  fi
fi
[ -n "$REPO_DIR" ] || { echo "未定位到仓库目录，请设置 REPO_DIR=/path/to/qiyun" >&2; exit 1; }
REPO_DIR="$(cd "$REPO_DIR" && pwd)"
# 数据目录（内含 prod.db 与 deploy/），默认 docker-compose 映射的 ./data
DATA_DIR="${DATA_DIR:-$REPO_DIR/data}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.deploy}"
CONTAINER="qiyun"
# 镜像更新模式使用的 GHCR 镜像仓库（发布时自动推送）
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/sxlb/qiyun}"
# git fetch 代理：若服务器到 GitHub 连不通，可设 GIT_PROXY_URL 指向 HTTP 代理（如 "http://127.0.0.1:1080"）。
# 为空则不代理，走默认 git 传输。
GIT_PROXY_URL="${GIT_PROXY_URL:-}"
# 镜像仓库前缀替换：GHCR 不通时，可设 IMAGE_MIRROR_PREFIX 指向镜像加速地址，
# 如 "docker.m.daocloud.io"（推荐不带协议）或 "https://docker.mirror.example.com/"；为空则原样拉取 GHCR。
IMAGE_MIRROR_PREFIX="${IMAGE_MIRROR_PREFIX:-}"
# 推导最终拉取仓库：设置镜像前缀时，剥掉可能出现协议与末尾斜杠，仅保留镜像域名，
# 生成 "<域名>/sxlb/qiyun"（docker image 名不允许带协议）。
PULL_IMAGE="$GHCR_IMAGE"
if [ -n "$IMAGE_MIRROR_PREFIX" ]; then
  _mirror_domain="$(printf '%s' "$IMAGE_MIRROR_PREFIX" | sed -E 's#^https?://##; s#/+$##')"
  PULL_IMAGE="${_mirror_domain}/sxlb/qiyun"
fi
DEPLOY_DIR="$DATA_DIR/deploy"
BACKUP_DIR="$DEPLOY_DIR/backups"

# ---------- 工具函数 ----------

log()  { echo "[$(date '+%F %T')] $*"; }
fail() { log "✗ $*"; exit 1; }

# 从格式化 JSON 中提取字符串字段值（键值独占一行的写法）。输出无引号的原始值。
json_get() { # file key
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -1
}

now_ts() { date '+%Y%m%d-%H%M%S'; }

# 容器以非 root 用户（Dockerfile 里固定 uid 1001）运行，而本脚本以 root 运行，
# 由 root 创建/触碰过的 data/deploy 属主会是 root 且非组可写 → 容器写 request.json 报 EACCES，
# 后台表现为「点击更新提示服务器内部错误」。每次调度都校正一次，保证自愈不复发。
APP_UID="${APP_UID:-1001}"
APP_GID="${APP_GID:-1001}"
ensure_deploy_perms() {
  mkdir -p "$DEPLOY_DIR"
  [ "$(id -u)" = "0" ] || return 0
  chown "$APP_UID:$APP_GID" "$DEPLOY_DIR" 2>/dev/null || true
  chmod 775 "$DEPLOY_DIR" 2>/dev/null || true
  # 版本缓存由容器侧（登录/检测更新）回写，同样需要容器可写
  [ -f "$DATA_DIR/latest.json" ] && chown "$APP_UID:$APP_GID" "$DATA_DIR/latest.json" 2>/dev/null
  return 0
}

# 更新 versions.json：记录一次操作历史，并更新 currentVersion。
# 优先用 python3，缺失时回退 node（二者在现代 Linux 上通常至少其一）。
update_versions() { # version action
  local version="$1" action="$2" at
  at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local vf="$DEPLOY_DIR/versions.json"
  mkdir -p "$DEPLOY_DIR"
  if [ -f "$vf" ]; then
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$vf" "$version" "$action" "$at" <<'PY'
import json,sys
vf,version,action,at=sys.argv[1:5]
try:
    d=json.load(open(vf,'r',encoding='utf-8'))
except Exception:
    d={"currentVersion":"unknown","updatedAt":"","history":[]}
d.setdefault("history",[])
d["history"].append({"version":version,"action":action,"at":at})
d["currentVersion"]=version
d["updatedAt"]=at
json.dump(d,open(vf,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY
    elif command -v node >/dev/null 2>&1; then
      node -e '
        const fs=require("fs");const [vf,v,a,at]=process.argv.slice(2);
        let d={currentVersion:"unknown",updatedAt:"",history:[]};
        try{d=JSON.parse(fs.readFileSync(vf,"utf8"));}catch(e){}
        d.history=d.history||[];d.history.push({version:v,action:a,at});
        d.currentVersion=v;d.updatedAt=at;
        fs.writeFileSync(vf,JSON.stringify(d,null,2));
      ' "$vf" "$version" "$action" "$at"
    else
      fail "缺少 python3 / node，无法维护 versions.json"
    fi
  else
    # 首次：写基线
    printf '{\n  "currentVersion": "%s",\n  "updatedAt": "%s",\n  "history": [{"version": "%s", "action": "%s", "at": "%s"}]\n}\n' \
      "$version" "$at" "$version" "$action" "$at" > "$vf"
  fi
}

# 备份当前数据库（更新/回滚前各存一份，作为回档数据点）
backup_db() { # sourceVersion
  local srcVersion="$1"
  mkdir -p "$BACKUP_DIR"
  local db="$DATA_DIR/prod.db"
  [ -f "$db" ] || return 0
  local dest="$BACKUP_DIR/prod-${srcVersion}-$(now_ts).db"
  cp -f "$db" "$dest"
  log "已备份数据库 → ${dest}"
  # 只保留最近 20 份快照，避免侵占磁盘
  ls -1t "$BACKUP_DIR"/prod-*.db 2>/dev/null | tail -n +21 | xargs -r rm -f
}

# 恢复数据库到某版本快照（回滚用）。找不到快照则仅切代码、保持数据库不变。
restore_db() { # targetVersion
  local target="$1"
  local snap
  snap=$(ls -1t "$BACKUP_DIR"/"prod-${target}-"*.db 2>/dev/null | head -1)
  if [ -z "$snap" ]; then
    log "警告：未找到 ${target} 的数据库快照，回滚保持现有数据库（仅切换代码）"
    return 0
  fi
  local db="$DATA_DIR/prod.db"
  # 先清理 WAL/SHM 残留，避免新旧数据文件混用导致损坏
  rm -f "$db-wal" "$db-shm"
  cp -f "$snap" "$db"
  log "已恢复数据库 → ${db}（来源 ${snap}）"
}

# 写回执行结果（应用侧 readLatestResult 读取 result-*.json）
write_result() { # id action version method status message
  local vf="$DEPLOY_DIR/result-$1.json"
  printf '{\n  "id": "%s",\n  "action": "%s",\n  "version": "%s",\n  "method": "%s",\n  "status": "%s",\n  "message": "%s",\n  "at": "%s"\n}\n' \
    "$1" "$2" "$3" "$4" "$5" "$6" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$vf.tmp"
  mv "$vf.tmp" "$vf"
  log "执行结果已写回 → ${vf}"
}

# ---------- 失败回退 ----------

# 代码已切换后任一步失败：把代码切回切换前的版本并重新拉起容器。
# 不这样做会留下「仓库是新版本、运行中的容器仍是旧版本」的混合状态，
# 用户只看到「更新失败」，却不知道系统实际处于什么状态。
rollback_code() { # targetVersion
  local target="$1"
  log "检测到失败，尝试回滚代码到 ${target} ..."
  if ! git -C "$REPO_DIR" checkout "$target" >/dev/null 2>&1; then
    log "✗ 回滚 git checkout 失败"
    return 1
  fi
  if [ "$req_method" = "image" ]; then
    IMAGE_TAG="$target" GHCR_IMAGE="$PULL_IMAGE" APP_VERSION="$target" \
      docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.image.yml up --no-build -d >/dev/null 2>&1 || true
  else
    APP_VERSION="$target" docker compose --env-file "$ENV_FILE" up -d --build >/dev/null 2>&1 || true
  fi
  log "已回滚代码到 ${target}，容器已按该版本重新拉起"
  return 0
}

# 统一失败出口：写回失败结果，并在必要时回退代码。
# code_switched_ok=1 表示 git checkout 已成功、但后续步骤失败。
fail_after_switch() { # message
  local message="$1"
  if [ "${code_switched_ok:-0}" = "1" ] && [ -n "${cur:-}" ] && [ "$cur" != "unknown" ] && [ "$cur" != "$version" ]; then
    if rollback_code "$cur"; then
      write_result "$req_id" "$action" "$version" "$req_method" failed "${message}；已自动回退代码到 ${cur}"
    else
      write_result "$req_id" "$action" "$version" "$req_method" failed "${message}；自动回退失败，仓库当前停留在 ${version}，请手动处理"
    fi
  else
    write_result "$req_id" "$action" "$version" "$req_method" failed "$message"
  fi
  exit 0
}

# ---------- 版本缓存 refresh（兜底每日一次） ----------
# 版本缓存的"权威频率"已迁移到容器侧：登录后台按需刷新（短时去重）+ 手工"检测更新"强制刷新。
# 宿主机仅保留每日一次的兜底刷新（出网更稳），保证哪怕容器网络不可达，缓存也不会超过约一天陈旧。
refresh_version_cache() {
  local cache="$DATA_DIR/latest.json"
  mkdir -p "$DATA_DIR"
  # 约 22 小时内已刷新则跳过（每天至多一次）
  if [ -f "$cache" ] && [ -n "$(find "$cache" -mmin -1320 2>/dev/null)" ]; then
    return 0
  fi
  command -v python3 >/dev/null 2>&1 || return 0
  python3 - "$cache" <<'PY'
import json, os, sys, time, urllib.request
cache = sys.argv[1]
def fetch(u):
    req = urllib.request.Request(u, headers={
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "qiyun-update"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.read()
def parse(raw):
    g = json.loads(raw)
    tag = str(g.get("tag_name") or "")
    return {"tag": tag, "version": tag.lstrip("v"), "name": str(g.get("name") or tag),
            "body": str(g.get("body") or ""), "htmlUrl": str(g.get("html_url") or ""),
            "publishedAt": str(g.get("published_at") or "")}
out, err = None, None
for base in ("https://api.github.com/", "https://gh-proxy.com/https://api.github.com/"):
    try:
        out = parse(fetch(base + "repos/sxlb/qiyun/releases/latest"))
        break
    except Exception as e:
        err = str(e)
doc = {"timestamp": int(time.time() * 1000)}
if out:
    doc["data"] = out
else:
    doc["error"] = "宿主机拉取最新版本失败"
tmp = cache + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False)
os.replace(tmp, cache)
PY
}

# ---------- 认领并执行一次请求 ----------
request="$DEPLOY_DIR/request.json"
# 每次调度先维护版本缓存（无请求时也执行），保证容器永远有可读的最新版本缓存
refresh_version_cache
# 再校正数据目录属主（需在 refresh 之后：refresh 会以 root 重写 latest.json）
ensure_deploy_perms
[ -f "$request" ] || exit 0   # 无待执行请求，本次调度直接退出

req_id=$(json_get "$request" id)
action=$(json_get "$request" action)
version=$(json_get "$request" version)
# 更新方式：build=服务器自建构建 / image=拉取 GHCR 镜像。缺省/未知回退 build
req_method=$(json_get "$request" method)
case "$req_method" in
  image) req_method=image ;;
  *) req_method=build ;;
esac
log "发现请求：action=${action} method=${req_method} version=${version} id=${req_id}"

# 认领：防止 cron 并发重复执行（rename 是原子操作）
[ -f "$DEPLOY_DIR/running-${req_id}.json" ] && exit 0
if ! mv "$request" "$DEPLOY_DIR/running-${req_id}.json"; then
  fail "认领请求失败（可能已被其它进程认领）"
fi
running="$DEPLOY_DIR/running-${req_id}.json"
# 兜底清理：任一步失败（含 fail/write_result 后 exit）都移除认领文件，
# 避免残留 running-*.json 永久阻塞同一请求的后续更新/回滚
trap 'rm -f "$running" 2>/dev/null' EXIT

# 校验动作
case "$action" in
  update|rollback) ;;
  *) write_result "$req_id" "$action" "$version" "$req_method" failed "未知动作类型: $action"; exit 0;;
esac

cd "$REPO_DIR"
[ -f docker-compose.yml ] || fail "未在仓库目录运行：缺少 docker-compose.yml"
command -v git >/dev/null 2>&1 || fail "缺少 git 命令"

# 当前基线版本（从 versions.json 读取，缺失则回退 git describe）
cur=$(sed -n 's/.*"currentVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DEPLOY_DIR/versions.json" 2>/dev/null | head -1)
[ -n "$cur" ] || cur=$(git describe --tags --abbrev=0 2>/dev/null || echo "unknown")

log "当前基线版本：$cur，目标版本：$version"

# 1) 拉取远程 tag 并切换到目标版本
log "拉取远程 tags..."
if [ -z "$GIT_PROXY_URL" ]; then
  git fetch --all --tags --prune >/dev/null 2>&1 || log "警告：git fetch 失败，将使用本地已有 tag"
else
  # 有专用 GIT 代理时，通过 http.proxy 走代理（临时注入，不落盘到仓库配置）
  git -c "http.proxy=$GIT_PROXY_URL" -c "https.proxy=$GIT_PROXY_URL" \
    fetch --all --tags --prune >/dev/null 2>&1 \
    || log "警告：git fetch（经代理 $GIT_PROXY_URL）失败，将使用本地已有 tag"
fi

# 标记：git checkout 是否已成功。成功之后的任何失败都需要回退代码，
# 否则会留下「仓库是新版本、容器是旧版本」的混合状态。
code_switched_ok=0

if git rev-parse -q --verify "refs/tags/$version" >/dev/null 2>&1; then
  log "切换到版本 $version"
  if git checkout "$version" >/dev/null 2>&1; then
    code_switched_ok=1
  else
    write_result "$req_id" "$action" "$version" "$req_method" failed "git 切换失败，请检查版本号是否已发布"
    exit 0
  fi
else
  write_result "$req_id" "$action" "$version" "$req_method" failed "目标版本 $version 不存在（未发布或未推送 tag）"
  exit 0
fi

# 2) 优雅停止容器：让 SQLite WAL 落盘，保证后续数据库读写（备份/恢复）处于一致状态
log "停止容器（等待未落盘写入收尾）..."
docker compose --env-file "$ENV_FILE" stop || fail_after_switch "停止容器失败"

# 3) 备份当前版本数据库（回档数据点）
backup_db "$cur"

# 4) 回滚时：把数据库恢复到目标版本的快照（代码与数据一同回退）
if [ "$action" = "rollback" ]; then
  restore_db "$version"
fi

# 5) 重建并启动容器（按更新方式分流：build=本地构建 / image=拉取发布镜像）
#    无论哪种方式，均注入 APP_VERSION=目标版本，让容器内"当前版本"与发布版本一致。
#    此处起的每个失败分支都走 fail_after_switch：写回失败结果并自动回退代码。
if [ "$req_method" = "image" ]; then
  log "镜像更新模式：拉取 ${PULL_IMAGE}:${version} 并重启容器..."
  IMAGE_TAG="$version" GHCR_IMAGE="$PULL_IMAGE" APP_VERSION="$version" docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.image.yml pull \
    || fail_after_switch "拉取镜像失败，请检查网络与 GHCR 仓库访问权限"
  IMAGE_TAG="$version" GHCR_IMAGE="$PULL_IMAGE" APP_VERSION="$version" docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.image.yml up --no-build -d \
    || fail_after_switch "启动容器失败，请查看 docker compose logs"
else
  if [ -f ./deploy.sh ]; then
    APP_VERSION="$version" bash ./deploy.sh || fail_after_switch "构建/启动失败，请查看 docker compose logs"
  else
    # 无 deploy.sh 时直接使用 compose 重建（用 .env.deploy 或用户指定的环境文件）
    APP_VERSION="$version" docker compose --env-file "$ENV_FILE" up -d --build || fail_after_switch "构建/启动失败，请查看 docker compose logs"
  fi
fi

# 6) 记录版本历史并写成功结果
output="已${action}到 $version"
if [ "$req_method" = "image" ]; then output="${output}（拉取镜像 ${PULL_IMAGE}:${version}）"; fi
[ "$action" = "rollback" ] && output="${output}（数据库已恢复到 ${version} 快照，若未找到快照则仅切换代码）"
update_versions "$version" "$action"
write_result "$req_id" "$action" "$version" "$req_method" success "$output"
rm -f "$running"
log "完成：${action} 至 $version"