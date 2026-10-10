#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 更新/回滚执行器（宿主机侧，由 cron 每分钟调用一次）
# 作用：轮询 data/deploy/request.json（应用后台写入的握手请求），
#       认领后拉取目标版本镜像 → 备份数据库 → 重建容器 → 清理上一版本镜像 → 写回执行结果，
#       并维护 data/deploy/versions.json 的版本权威记录。
#
# 全程只依赖 docker 与 docker compose：镜像在 CI 中预编译，服务器上不需要 git，也不做本地构建。
#
# 安装（建议装到部署目录之外，避免被更新覆盖）：
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
# 仓库目录（含 docker-compose.yml、deploy.sh、data/ 的部署目录）
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
# ---------- 镜像来源 ----------
# 与 deploy.sh 采用同一套语义：IMAGE_SOURCE 选主源（hub / ghcr / 完整地址），
# IMAGE_MIRROR_PREFIX 指定加速器，拉取时按候选链依次尝试，谁通用谁。
# 两份脚本各留一份实现而不是抽公共库：deploy.sh 常被单独复制到服务器上使用，
# 依赖同目录的库文件会让它变脆。
IMAGE_SOURCE="${IMAGE_SOURCE:-hub}"
IMAGE_MIRROR_PREFIX="${IMAGE_MIRROR_PREFIX:-}"
# 公共加速器候选链。公共加速器存活期很短，且有的只镜像白名单内的公共镜像、
# 会直接拒绝本项目这类用户镜像（docker.m.daocloud.io 就是这样），故做成依次尝试。
MIRROR_CANDIDATES="${MIRROR_CANDIDATES:-ghcr.nju.edu.cn docker.1panel.live}"
# 单一来源的连通性探测超时（秒）。只用于拉取前快速排除连不上的来源；
# 真正的拉取刻意不设超时——慢速链路上拉几百 MB 要几分钟，加超时会误杀本可成功的更新。
PROBE_TIMEOUT="${PROBE_TIMEOUT:-15}"

# ---------- 拉取预算与测速预判 ----------
# 单个来源的拉取墙钟预算（秒），只作用于「后面还有候选」的来源；链上最后一个不设预算。
# 为什么必须有它：可达性探测只能回答「连不连得上」，回答不了「拉得快不快」。
# 本脚本此前完全没有这层保护，一次「可达但极慢」的更新会把后台长时间卡在「执行中」
# （线上实测过一次更新耗时 30 分钟，而正常只要 2 分钟）。
# 超额即换下一个来源：镜像层按 digest 寻址，已下好的层会被下一个来源直接复用，切换成本很低。
PULL_SOURCE_TIMEOUT="${PULL_SOURCE_TIMEOUT:-300}"
# timeout 缺失时不设预算：宁可不管超时，也不能因为命令不存在把一次本可成功的更新判成失败
HAVE_TIMEOUT=0
if command -v timeout >/dev/null 2>&1; then HAVE_TIMEOUT=1; fi

# 拉取前实测各来源的下载速度（秒级），把「可达但极慢」的来源在拉取前就剔除掉。
# 测不到速度（无 python3 / 无 timeout / 站点拒绝）时不参与判定，行为与加此功能前一致。
SPEED_PROBE="${SPEED_PROBE:-1}"
PROBE_MIN_KBPS="${PROBE_MIN_KBPS:-600}"           # 达标线：低于它视为慢源
SPEED_PROBE_TIMEOUT="${SPEED_PROBE_TIMEOUT:-6}"   # 单个来源的取样时长上限（秒）
SPEED_PROBE_BYTES="${SPEED_PROBE_BYTES:-6291456}" # 取样字节上限（6MB）

# 主源仓库地址（不含标签）。GHCR_IMAGE 是等价写法，旧配置里用的就是它，必须继续认。
resolve_primary_repo() {
  if [ -n "${GHCR_IMAGE:-}" ]; then printf '%s' "$GHCR_IMAGE"; return 0; fi
  case "$IMAGE_SOURCE" in
    hub|dockerhub|docker.io|hub.docker.com) printf '%s' "docker.io/sxlb/qiyun" ;;
    ghcr|ghcr.io)                           printf '%s' "ghcr.io/sxlb/qiyun" ;;
    */*)                                    printf '%s' "$IMAGE_SOURCE" ;;
    *)                                      printf '%s' "docker.io/sxlb/qiyun" ;;
  esac
}

# 仓库地址去掉 registry 主机后的路径部分（owner/repo）
repo_path() { printf '%s' "$1" | sed -E 's#^[^/]+/##'; }

# 加速器前缀 → 镜像仓库地址。域名允许带协议与结尾斜杠，统一剥掉：
# docker 的镜像名不允许带协议，直接拼会得到非法引用，而报错完全指不到根因。
mirror_repo() {
  local host
  host="$(printf '%s' "${1:-}" | sed -E 's#^https?://##; s#/+$##')"
  [ -n "$host" ] || return 0
  printf '%s/%s' "$host" "$(repo_path "$PRIMARY_REPO")"
}

# 另一个官方源：主源不通时优先切它，比第三方加速器可信。只对两个已知官方源成立，
# 自定义仓库没有对应的「另一个」，此时返回空，避免拼出一个不存在的地址白试一轮。
secondary_repo() {
  case "$PRIMARY_REPO" in
    docker.io/*) printf '%s' "ghcr.io/$(repo_path "$PRIMARY_REPO")" ;;
    ghcr.io/*)   printf '%s' "docker.io/$(repo_path "$PRIMARY_REPO")" ;;
  esac
}

# 拉取前快速判断来源是否可达。docker manifest inspect 只取清单、不下载层，
# 能把连不上的来源在十几秒内排除，而不是让 docker 自己重试好几分钟。
# 关键：探测要与守护进程走同一条网络路径——manifest 是客户端命令、会读 shell 代理，
# 而真正的 pull 由守护进程发起，两者不一致就会误判。故照搬 docker info 里
# 守护进程自己的代理配置，而不是想当然地清空或保留。
probe_image() { # repo:tag
  PROBE_ERR=""
  command -v timeout >/dev/null 2>&1 || return 0
  local out=""
  if [ -n "${DAEMON_HTTP_PROXY:-}" ] || [ -n "${DAEMON_HTTPS_PROXY:-}" ]; then
    if out="$(timeout "$PROBE_TIMEOUT" \
        env http_proxy="$DAEMON_HTTP_PROXY" https_proxy="$DAEMON_HTTPS_PROXY" \
            HTTP_PROXY="$DAEMON_HTTP_PROXY" HTTPS_PROXY="$DAEMON_HTTPS_PROXY" \
        docker manifest inspect "$1" 2>&1)"; then
      return 0
    fi
  else
    if out="$(timeout "$PROBE_TIMEOUT" \
        env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
        docker manifest inspect "$1" 2>&1)"; then
      return 0
    fi
  fi
  PROBE_ERR="$out"
  return 1
}

# 实测某个来源的镜像层下载速度，输出整数 KB/s；测不到则无任何输出（不报错）。
#
# 为什么用内嵌 python 而不是 curl：要按 registry 协议取匿名令牌、下钻多架构索引到子清单、
# 再挑最大的一层做 Range 限时取样，用 shell + sed 解析这些 JSON 既脆弱又难维护。
# python3 在本脚本里本就被依赖（版本缓存 refresh_version_cache），缺失时优雅降级。
#
# 关键：探测要与「守护进程」走同一条网络路径。python 的 urllib 会读 shell 的代理变量，
# 而真正的 pull 由守护进程发起；不照搬 docker info 里的代理配置就会误判（同 probe_image）。
#
# 注意：本函数与 deploy.sh 里同名函数保持一致（两份脚本刻意各留一份实现，
# 因为 deploy.sh 常被单独复制到服务器上使用，依赖同目录的库文件会让它变脆）。
speed_probe_kbps() { # repo tag
  [ "${SPEED_PROBE:-1}" = "1" ] || return 0
  local py out=""
  py="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
  [ -n "$py" ] || return 0
  # 没有 timeout 就整段放弃：单次取样本身也需要墙钟兜底，宁可退回到旧行为
  command -v timeout >/dev/null 2>&1 || return 0
  # 命令替换即子 shell：里面 export/unset 的代理变量不会污染外层（外层还要跑 docker）
  out="$(
    if [ -n "${DAEMON_HTTP_PROXY:-}" ] || [ -n "${DAEMON_HTTPS_PROXY:-}" ]; then
      export http_proxy="$DAEMON_HTTP_PROXY" https_proxy="$DAEMON_HTTPS_PROXY"
      export HTTP_PROXY="$DAEMON_HTTP_PROXY" HTTPS_PROXY="$DAEMON_HTTPS_PROXY"
    else
      unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
    fi
    timeout -k 5 "$(( ${SPEED_PROBE_TIMEOUT:-6} + 20 ))" \
      "$py" - "$1" "$2" "${SPEED_PROBE_BYTES:-6291456}" "${SPEED_PROBE_TIMEOUT:-6}" <<'PY'
import json
import os
import platform
import re
import sys
import time
import urllib.error
import urllib.request

UA = "qiyun-speed-probe"
ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])
ARCH = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}
DEBUG = os.environ.get("QIYUN_PROBE_DEBUG") == "1"


def dbg(msg):
    if DEBUG:
        sys.stderr.write("[probe] %s\n" % msg)
        sys.stderr.flush()


def split_ref(ref):
    # 拆出 (scheme, host, path)；允许显式带协议前缀（http 私有仓库）
    scheme = "https"
    rest = ref
    m = re.match(r"^(https?)://(.+)$", ref)
    if m:
        scheme, rest = m.group(1), m.group(2)
    host, _, path = rest.partition("/")
    return scheme, host, path


def api_base_of(scheme, host):
    # Docker Hub 的 registry API 不在 docker.io 上，而在 registry-1.docker.io（仅 https）
    if host in ("docker.io", "index.docker.io", "registry-1.docker.io"):
        return "https://registry-1.docker.io"
    return scheme + "://" + host


def fetch_token(opener, challenge, repo_path, timeout):
    # 按 401 响应里的 WWW-Authenticate 取匿名拉取令牌；公开镜像不需要登录
    realm = re.search(r'realm="([^"]+)"', challenge)
    if not realm:
        return None
    url = realm.group(1)
    params = []
    service = re.search(r'service="([^"]+)"', challenge)
    if service:
        params.append("service=" + service.group(1))
    params.append("scope=repository:%s:pull" % repo_path)
    url += ("&" if "?" in url else "?") + "&".join(params)
    dbg("token url: %s" % url)
    try:
        with opener.open(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        dbg("token failed: %s: %s" % (type(e).__name__, e))
        return None
    return data.get("token") or data.get("access_token") or ""


def slurp(opener, url, headers, timeout):
    with opener.open(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def pick_matching_manifest(doc):
    # 多架构索引里挑一个子清单：优先本机架构，挑不到就用第一个。
    # 测速只关心到 registry 的网络吞吐，与具体架构的层内容无关，不匹配也不影响结论。
    entries = doc.get("manifests") or []
    if not entries:
        return None
    want = ARCH.get(platform.machine().lower(), "")
    if want:
        for e in entries:
            plat = e.get("platform") or {}
            if plat.get("architecture") == want and plat.get("os", "linux") == "linux":
                return e.get("digest")
    return entries[0].get("digest")


def main():
    if len(sys.argv) < 3:
        return 1
    ref = sys.argv[1]
    tag = sys.argv[2]
    want = int(sys.argv[3]) if len(sys.argv) > 3 else 6 * 1024 * 1024
    budget = float(sys.argv[4]) if len(sys.argv) > 4 else 6.0
    sock_timeout = min(4.0, budget)

    scheme, host, repo_path = split_ref(ref)
    if not repo_path:
        dbg("bad ref: %s" % ref)
        return 1
    base = api_base_of(scheme, host)
    # 回环地址不走代理：代理通常也回不到 127.0.0.1，只会白等一次超时。
    # （本地/内网自建 registry 与自动化测试都会命中这条。）
    if re.match(r"^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$", host):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    else:
        opener = urllib.request.build_opener()
    headers = {"User-Agent": UA, "Accept": ACCEPT}
    dbg("base=%s path=%s tag=%s" % (base, repo_path, tag))

    # 取清单；401 时就地用 challenge 换令牌重试，省掉一次独立的 /v2/ 往返
    man_url = "%s/v2/%s/manifests/%s" % (base, repo_path, tag)
    token = ""
    try:
        doc = slurp(opener, man_url, headers, sock_timeout)
    except urllib.error.HTTPError as e:
        if e.code != 401:
            dbg("manifest HTTP %s" % e.code)
            return 1
        token = fetch_token(opener, e.headers.get("WWW-Authenticate", ""), repo_path, sock_timeout)
        if token is None:
            return 1
        try:
            doc = slurp(opener, man_url, dict(headers, Authorization="Bearer " + token), sock_timeout)
        except Exception as e:
            dbg("manifest(auth) failed: %s: %s" % (type(e).__name__, e))
            return 1
    except Exception as e:
        dbg("manifest failed: %s: %s" % (type(e).__name__, e))
        return 1

    auth = {"Authorization": "Bearer " + token} if token else {}
    man_headers = dict(headers, **auth)

    # 多架构索引再下一层取子清单
    if not doc.get("layers"):
        digest = pick_matching_manifest(doc)
        if not digest:
            dbg("no sub manifest")
            return 1
        try:
            doc = slurp(opener, "%s/v2/%s/manifests/%s" % (base, repo_path, digest), man_headers, sock_timeout)
        except Exception as e:
            dbg("sub manifest failed: %s: %s" % (type(e).__name__, e))
            return 1

    layers = doc.get("layers") or []
    if not layers:
        return 1
    # 挑最大的一层：太小的层在快链路上测不出有效样本
    layer = max(layers, key=lambda x: int(x.get("size") or 0))
    digest = layer.get("digest")
    if not digest:
        return 1

    # 限时拉一段，按实际收到的字节估算吞吐
    blob = "%s/v2/%s/blobs/%s" % (base, repo_path, digest)
    dbg("blob=%s size=%s" % (blob, layer.get("size")))
    got = 0
    elapsed = 0.0
    start = 0.0
    try:
        req = urllib.request.Request(blob, headers=dict(man_headers, Range="bytes=0-%d" % (want - 1)))
        with opener.open(req, timeout=sock_timeout) as r:
            # 计时从「响应头到达」开始：连接与 TLS 握手在慢速链路上本身就要几秒，
            # 算进去会把预算提前耗光、取样恒为 0（本地实测踩过）。这里要的是稳态吞吐。
            start = time.time()
            dbg("blob status=%s len=%s" % (r.status, r.headers.get("Content-Length")))
            while got < want:
                if time.time() - start >= budget:
                    break
                chunk = r.read(min(65536, want - got))
                if not chunk:
                    break
                got += len(chunk)
            elapsed = time.time() - start
    except Exception as e:
        # 中途超时/断流属正常：已收到的字节足以估算速度
        elapsed = (time.time() - start) if start else 0.0
        dbg("blob interrupted: %s: %s" % (type(e).__name__, e))
    if got <= 0 or elapsed <= 0:
        dbg("no bytes received (%d in %.1fs)" % (got, elapsed))
        return 1
    kbps = int(got / elapsed / 1024)
    if kbps <= 0:
        return 1
    dbg("got=%d bytes in %.1fs -> %d KB/s" % (got, elapsed, kbps))
    sys.stdout.write("%d\n" % kbps)
    return 0


try:
    sys.exit(main())
except Exception as e:
    dbg("fatal: %s: %s" % (type(e).__name__, e))
    sys.exit(1)
PY
  )" 2>/dev/null || out=""
  # 只认纯数字：日志、告警、半截输出一律当「测不到」
  case "$out" in
    ''|*[!0-9]*) return 0 ;;
  esac
  printf '%s' "$out"
}

# 按实测下载速度决定「跳过哪些来源」，结果写入 SPEED_SKIPPED / SPEED_SUMMARY。
#
# 规则与理由：
#   1) 逐个探测，遇到「达标」的就停止——它会先被使用，后面的候选只有在前面全部失败时才轮到，
#      交给拉取预算兜底即可，没必要为它们再花测速时间（常见情形下只探一个，代价约 1 秒）。
#   2) 测到明确偏慢的记入跳过集合；测不到速度的（无 python3 / 站点拒绝）不参与判定。
#   3) 跳过集合只在「确实存在更快来源」时才生效。若所有候选都慢，跳过谁都无益，
#      此时一个都不跳，交由拉取预算与末位不设预算的保证兜底——绝不把候选清空。
rank_pull_chain() { # tag
  SPEED_SKIPPED=""
  SPEED_SUMMARY=""
  [ "${SPEED_PROBE:-1}" = "1" ] || return 0
  # 链上只有一个候选时「跳过」没有意义，直接省掉整段测速
  case "$PULL_CHAIN" in
    *" "*) ;;
    *) return 0 ;;
  esac
  local _repo _kbps _slow="" _detail="" _fast=0
  for _repo in $PULL_CHAIN; do
    _kbps="$(speed_probe_kbps "$_repo" "$1")"
    case "$_kbps" in
      ''|*[!0-9]*) _detail="$_detail ${_repo}=未知"; continue ;;
    esac
    _detail="$_detail ${_repo}=${_kbps}KB/s"
    if [ "$_kbps" -ge "${PROBE_MIN_KBPS:-600}" ]; then
      _fast=1
      break
    fi
    _slow="$_slow $_repo"
  done
  SPEED_SUMMARY="${_detail# }"
  [ "$_fast" = "1" ] || return 0
  SPEED_SKIPPED="$_slow"
  return 0
}

PRIMARY_REPO="$(resolve_primary_repo)"
DAEMON_HTTP_PROXY="$(docker info --format '{{.HTTPProxy}}' 2>/dev/null || true)"
DAEMON_HTTPS_PROXY="$(docker info --format '{{.HTTPSProxy}}' 2>/dev/null || true)"

# 候选链：显式配置的加速器优先（用户设它通常正因为官方源不通），
# 否则官方主源 → 备用官方源 → 内置加速器候选。
_chain="$PRIMARY_REPO $(secondary_repo)"
if [ -n "$IMAGE_MIRROR_PREFIX" ]; then
  _chain="$(mirror_repo "$IMAGE_MIRROR_PREFIX") $_chain"
else
  for _m in $MIRROR_CANDIDATES; do
    _r="$(mirror_repo "$_m")"; [ -n "$_r" ] && _chain="$_chain $_r"
  done
fi
PULL_CHAIN="$(printf '%s\n' $_chain | awk 'NF && !seen[$0]++' | tr '\n' ' ')"
PULL_CHAIN="${PULL_CHAIN% }"
PULL_IMAGE="${PULL_CHAIN%% *}"
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
#
# 【为什么必须连 WAL 一起存】SQLite 在 WAL 模式下，已提交的事务可能只写在 prod.db-wal 里，
# 直到 checkpoint 才并入主库。而「停容器」**并不保证**会触发 checkpoint：容器以 PID 1
# 跑 shell，SIGTERM 未必转发给 node，10s 后 Docker 直接 SIGKILL，SQLite 来不及收尾。
# 实测一份只拷主库的快照少了 14 条已提交记录，用它回滚就是静默丢数据。
backup_db() { # sourceVersion
  local srcVersion="$1"
  mkdir -p "$BACKUP_DIR"
  local db="$DATA_DIR/prod.db"
  [ -f "$db" ] || return 0
  local dest="$BACKUP_DIR/prod-${srcVersion}-$(now_ts).db"
  cp -f "$db" "$dest"
  # WAL 侧车：存成 <快照名>-wal，与主库成组保存、成组还原。空 WAL 没有内容，不必存。
  if [ -s "$db-wal" ]; then
    cp -f "$db-wal" "${dest}-wal"
  fi
  log "已备份数据库 → ${dest}（主库与 WAL 成组）"
  # 只保留最近 20 份快照，避免侵占磁盘；WAL 侧车随主文件一起删，不留孤儿
  local old
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f "$old" "${old}-wal" "${old}-shm"
  done < <(ls -1t "$BACKUP_DIR"/prod-*.db 2>/dev/null | tail -n +21 || true)
  return 0
}

# 恢复数据库到某版本快照（回滚用）。找不到快照则仅切代码、保持数据库不变。
restore_db() { # targetVersion
  local target="$1"
  local snap
  # 收尾 || true：该版本没有快照时 ls 会非 0，本脚本是 set -euo pipefail，
  # 不兜住就会在进入下面「未找到快照」的提示之前直接中止（原本的警告分支其实到不了）
  snap=$(ls -1t "$BACKUP_DIR"/"prod-${target}-"*.db 2>/dev/null | head -1 || true)
  if [ -z "$snap" ]; then
    log "警告：未找到 ${target} 的数据库快照，回滚保持现有数据库（仅切换代码）"
    return 0
  fi
  local db="$DATA_DIR/prod.db"
  # 先清理 WAL/SHM 残留，避免新旧数据文件混用导致损坏
  rm -f "$db-wal" "$db-shm"
  cp -f "$snap" "$db"
  # 快照里的 WAL 一并还原：尚未 checkpoint 的已提交事务全在里面，漏掉就是回滚时静默丢数据
  # （见 backup_db 的说明）。只还原 -wal，不还原 -shm：后者只是 WAL 的内存索引，
  # SQLite 会按 WAL 自行重建，照搬反而可能与新位置的 WAL 对不上。
  if [ -s "${snap}-wal" ]; then
    cp -f "${snap}-wal" "$db-wal"
  fi
  # cp 会重建目标文件，属主随之变成执行脚本的用户（root）。容器以 uid 1001 运行，
  # 不校正属主则新库对容器只读，容器启动即报 SQLite「disk I/O error」并转为 unhealthy，
  # 后台表现为「回滚成功但服务起不来」。ensure_deploy_perms 只管目录，覆盖不到这个文件。
  # WAL 同样要校正：它会在回放时写回主库，属主是 root 一样会报只读。
  if [ "$(id -u)" = "0" ]; then
    chown "$APP_UID:$APP_GID" "$db" 2>/dev/null || log "警告：未能调整 ${db} 的属主，容器可能无法写入数据库"
    if [ -f "$db-wal" ]; then
      chown "$APP_UID:$APP_GID" "$db-wal" 2>/dev/null || log "警告：未能调整 ${db}-wal 的属主，容器可能无法写入数据库"
    fi
  fi
  log "已恢复数据库 → ${db}（来源 ${snap}，含 WAL）"
}

# 清理上一版本镜像，避免每次更新都留一份几百 MB 的历史镜像把磁盘吃满。
#
# 只删「上一个容器实际使用的那一个镜像引用」，不做 `docker image prune -a`：
# 那会连别的服务、别的项目的镜像一起删掉，在一台机器上跑多个容器时是不可接受的。
# （无标签的悬空层另行 prune，dangling 镜像是构建残留，删掉没有副作用。）
#
# 代价：回滚到刚离开的那个版本需要重新拉取镜像（几十秒）。这是「省空间」的对价，
# 不想要就在 cron 里设 PRUNE_OLD_IMAGES=0 关掉。
prune_old_image() { # oldImageRef
  PRUNED_NOTE=""
  [ "${PRUNE_OLD_IMAGES:-1}" = "1" ] || { log "已跳过旧镜像清理（PRUNE_OLD_IMAGES=0）"; return 0; }
  [ -n "${1:-}" ] || return 0

  # 与当前容器用的是同一个镜像（例如重装同一版本）就没必要删
  local now
  now="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
  if [ "$1" = "$now" ]; then
    log "旧镜像与当前镜像相同（$1），无需清理"
    return 0
  fi

  # 删不掉不算更新失败：镜像可能仍被其它容器引用，或标签已被覆盖。
  # 只记一行日志，绝不让「清理」把一次成功的更新变成失败。
  if docker rmi "$1" >/dev/null 2>&1; then
    log "已清理旧镜像 $1"
    PRUNED_NOTE="；已清理旧镜像 $1"
  else
    log "旧镜像 $1 未能删除（可能仍被其它容器引用），已跳过"
  fi

  # 再顺手清掉无标签悬空层（只删 <none>，不动任何有标签的镜像）
  local freed
  freed="$(docker image prune -f 2>/dev/null | sed -n 's/.*[Tt]otal reclaimed space:[[:space:]]*//p' | head -1 || true)"
  [ -n "$freed" ] && log "悬空层已清理，回收 ${freed}"
  return 0
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

# 新版本容器启动失败时，用旧版本镜像把容器重新拉起。
# 不这样做会留下「镜像已换、容器起不来」的空档，用户只看到「更新失败」，
# 却不知道服务其实已经中断。
reup_version() { # targetVersion
  local target="$1"
  log "尝试用版本 ${target} 重新拉起容器 ..."
  IMAGE_TAG="$target" GHCR_IMAGE="$PULL_IMAGE" APP_VERSION="$target" \
    docker compose --env-file "$ENV_FILE" up --no-build -d >/dev/null 2>&1 || true
  log "已按版本 ${target} 重新拉起容器"
  return 0
}

# 统一失败出口：写回失败结果，并在必要时用原版本重新拉起容器。
# version_switched_ok=1 表示旧容器已停止、切换已经开始，此时失败必须回退。
fail_after_switch() { # message
  local message="$1"
  if [ "${version_switched_ok:-0}" = "1" ] && [ -n "${cur:-}" ] && [ "$cur" != "unknown" ] && [ "$cur" != "$version" ]; then
    if reup_version "$cur"; then
      write_result "$req_id" "$action" "$version" "$req_method" failed "${message}；已自动回退到版本 ${cur}"
    else
      write_result "$req_id" "$action" "$version" "$req_method" failed "${message}；自动回退失败，请手动执行 IMAGE_TAG=${cur} docker compose up -d"
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
# 更新方式：统一为拉取已发布的镜像。
# 旧版遗留的 build 请求也按 image 执行——它依赖的 compose override 文件从未入库，
# 且 compose 无 build 段，实际从未本地构建过，按 image 执行与原行为一致。
req_method=image
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
command -v docker >/dev/null 2>&1 || fail "缺少 docker 命令"

# 版本号校验：只允许 [0-9A-Za-z.+-]，且须形如 0.0.1。异常值不拦会被拼进镜像名，
# docker 报出的错误难以定位，也会污染 versions.json 的历史记录。
version_ok=1
case "$version" in
  *[!0-9A-Za-z.+-]*) version_ok=0 ;;
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) version_ok=0 ;;
esac
if [ "$version_ok" != "1" ]; then
  write_result "$req_id" "$action" "$version" "$req_method" failed "版本号不合法（应形如 0.0.1）：$version"
  exit 0
fi

# 当前基线版本：优先 versions.json；缺失时读运行中容器的镜像标签。
# 两处都加容错，避免文件缺失或容器不存在时被 set -e 直接中断。
cur=""
if [ -f "$DEPLOY_DIR/versions.json" ]; then
  cur=$(sed -n 's/.*"currentVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DEPLOY_DIR/versions.json" 2>/dev/null | head -1 || true)
fi
if [ -z "$cur" ]; then
  cur=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null | sed 's/.*://' || true)
fi
[ -n "$cur" ] || cur="unknown"
# 统一去掉 v 前缀：基线版本与快照文件名均用无 v 版本号（0.0.1），与发布标签一致
cur="${cur#v}"

# 旧容器实际使用的镜像引用（形如 docker.io/sxlb/qiyun:0.0.10）。
# 必须在重建容器之前取：compose up 会替换容器，之后就查不到旧引用，也就无从清理。
OLD_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"

log "当前基线版本：$cur，目标版本：$version"

# 1) 先拉取目标版本镜像：此时旧容器仍在运行，版本不存在或网络不通都不会造成停机。
#    官方源在境内经常不通，按候选链依次尝试（官方主源 → 备用官方源 → 加速器），
#    与 deploy.sh 保持一致，避免命令行部署与后台一键更新走到不同的源。
log "拉取 ${version} 镜像，依次尝试：${PULL_CHAIN// /、}"

# 拉取前实测各来源的下载速度，把「可达但极慢」的来源剔除掉（见 rank_pull_chain）
rank_pull_chain "$version"
if [ -n "${SPEED_SUMMARY:-}" ]; then
  log "  各来源实测下载速度：${SPEED_SUMMARY}"
fi

PULLED_IMAGE=""
PULL_FAILED=""
LAST_PROBE_ERR=""
# 链上最后一个候选不设拉取预算（见 PULL_SOURCE_TIMEOUT 说明）
LAST_CAND=""
for _c in $PULL_CHAIN; do LAST_CAND="$_c"; done
for _cand in $PULL_CHAIN; do
  # 测速判定为过慢的来源直接跳过；SPEED_SKIPPED 未设（未启用测速）时是空串，不影响流程
  case " ${SPEED_SKIPPED:-} " in
    *" $_cand "*)
      log "  来源 ${_cand} 实测下载速度低于 ${PROBE_MIN_KBPS:-600}KB/s，跳过（已下载的层会被后续来源复用）"
      PULL_FAILED="${PULL_FAILED} ${_cand}(过慢)"
      continue ;;
  esac
  if ! probe_image "${_cand}:${version}"; then
    LAST_PROBE_ERR="$PROBE_ERR"
    log "  来源 ${_cand} 探测不通，跳过"
    PULL_FAILED="${PULL_FAILED} ${_cand}"
    continue
  fi
  pull_rc=0
  if [ "$PULL_SOURCE_TIMEOUT" != "0" ] && [ "$HAVE_TIMEOUT" = "1" ] && [ "$_cand" != "$LAST_CAND" ]; then
    # -k 10：docker CLI 不响应 SIGTERM（实测能拖到预算的 3 倍才退），没有强杀兜底的话
    # 这个「预算」形同虚设。被强杀后守护进程会丢弃半截层，已完整的层留在原地，
    # 供下一个来源按 digest 直接复用——这正是「换源成本很低」的依据。
    IMAGE_TAG="$version" GHCR_IMAGE="$_cand" APP_VERSION="$version" \
      timeout -k 10 "$PULL_SOURCE_TIMEOUT" docker compose --env-file "$ENV_FILE" pull || pull_rc=$?
    # 124 = SIGTERM 生效；137 = SIGTERM 被忽略、由 -k 强杀。两者都表示「太慢」而不是「拉不到」
    case "$pull_rc" in
      124|137)
        log "  来源 ${_cand} 拉取超过 ${PULL_SOURCE_TIMEOUT}s 仍未完成（判定为过慢），换下一个来源；已下载的层会被复用"
        PULL_FAILED="${PULL_FAILED} ${_cand}(过慢)"
        # 给守护进程一点时间收尾被掐断的拉取，避免下一次 pull 撞上同一镜像的并发操作
        sleep 2
        continue ;;
    esac
  else
    # 末位来源（或未启用预算）：不给超时，保留「慢速链路也能拉完」的保证
    IMAGE_TAG="$version" GHCR_IMAGE="$_cand" APP_VERSION="$version" \
      docker compose --env-file "$ENV_FILE" pull || pull_rc=$?
  fi
  if [ "$pull_rc" = "0" ]; then
    PULLED_IMAGE="$_cand"
    break
  fi
  PULL_FAILED="${PULL_FAILED} ${_cand}"
  log "  从 ${_cand} 拉取失败，换下一个来源"
done

if [ -z "$PULLED_IMAGE" ]; then
  # 原始报错能区分两种截然不同的原因，原样带回给后台面板：
  # no such manifest / not found 是版本号不存在，超时或连接被拒才是网络不通。
  [ -z "$LAST_PROBE_ERR" ] || log "  最近一次探测的原始报错：${LAST_PROBE_ERR}"
  write_result "$req_id" "$action" "$version" "$req_method" failed \
    "拉取镜像失败：已尝试${PULL_FAILED}。若报错为 no such manifest / not found 则是版本 ${version} 不存在；超时或连接被拒则是网络不通，可设置 IMAGE_MIRROR_PREFIX 指定可用加速器。容器未受影响，仍运行 ${cur}"
  exit 0
fi
PULL_IMAGE="$PULLED_IMAGE"
log "镜像来源：${PULL_IMAGE}"

# 标记：切换是否已开始。镜像已就位，之后的任何失败都要把原版本重新拉起，
# 否则会留下「镜像换好了、容器却起不来」的空档。
version_switched_ok=0

# 2) 优雅停止容器：让 SQLite WAL 落盘，保证后续数据库读写（备份/恢复）处于一致状态
#    注意：compose 文件里 image 用了 ${IMAGE_TAG:?...} 做强制校验，任何一条 compose
#    子命令（stop / logs / ps 也一样）都必须在插值阶段拿到 IMAGE_TAG，否则会直接报
#    「IMAGE_TAG 未设置」而中止——stop 失败会让整个更新/回滚在第一步就卡死。
log "停止容器（等待未落盘写入收尾）..."
IMAGE_TAG="$version" GHCR_IMAGE="$PULL_IMAGE" APP_VERSION="$version" \
  docker compose --env-file "$ENV_FILE" stop || fail_after_switch "停止容器失败"

# 3) 备份当前版本数据库（回档数据点）
backup_db "$cur" || fail_after_switch "备份数据库失败"

# 4) 回滚时：把数据库恢复到目标版本的快照（数据随代码一同回退）
if [ "$action" = "rollback" ]; then
  restore_db "$version" || fail_after_switch "恢复数据库快照失败"
fi

version_switched_ok=1

# 5) 用目标版本镜像重建容器
#    注入 APP_VERSION=目标版本，让容器内报告的"当前版本"与发布版本一致。
log "启动 ${PULL_IMAGE}:${version} 容器..."
IMAGE_TAG="$version" GHCR_IMAGE="$PULL_IMAGE" APP_VERSION="$version" docker compose --env-file "$ENV_FILE" up --no-build -d \
  || fail_after_switch "启动容器失败，请查看 docker compose logs"

# 6) 清理上一版本镜像，释放磁盘（默认开启，可用 PRUNE_OLD_IMAGES=0 关闭）
prune_old_image "${OLD_IMAGE:-}"

# 7) 记录版本历史并写成功结果
output="已${action}到 $version（镜像 ${PULL_IMAGE}:${version}）"
[ "$action" = "rollback" ] && output="${output}（数据库已恢复到 ${version} 快照，若未找到快照则保持现有数据库）"
output="${output}${PRUNED_NOTE:-}"
update_versions "$version" "$action"
write_result "$req_id" "$action" "$version" "$req_method" success "$output"
rm -f "$running"
log "完成：${action} 至 $version"