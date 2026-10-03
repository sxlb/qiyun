#!/usr/bin/env bash
# ============================================================
# 栖云 · Qiyun — 部署与运维脚本（拉取已发布的镜像，无需本地构建）
#
# 用法：
#   ./deploy.sh                     拉取最新版本镜像并部署
#   ./deploy.sh 0.0.2               部署指定版本（无 v 前缀，与镜像标签一致）
#   ./deploy.sh rollback            回退到上一个版本，并恢复对应的数据库快照
#   ./deploy.sh rollback 0.0.1      回退到指定版本
#   ./deploy.sh backup [版本]       立刻做一次数据库快照（会短暂重启容器）
#   ./deploy.sh status              查看当前运行状态
#   ./deploy.sh --help              显示本帮助
#
# 环境变量：
#   PORT=3100                        改用其他宿主机端口
#   IMAGE_SOURCE=ghcr               镜像源：hub（默认）/ ghcr / 完整仓库地址
#   IMAGE_MIRROR_PREFIX=域名         指定镜像加速器；留空则按候选链自动尝试
#   GHCR_IMAGE=仓库地址              等价于 IMAGE_SOURCE，保留以兼容旧写法
#   DEPLOY_NO_PROMPT=1               不询问镜像源，直接走自动链路
#   PULL_SOURCE_TIMEOUT=300          单个来源的拉取预算（秒）；只作用于「后面还有候选」的来源，
#                                    链上最后一个来源不设预算，置 0 表示全部不设
#   GITHUB_REPO=owner/repo           查询最新版本时使用的仓库
#
# 关于镜像源：发布链路同时推 GHCR 与 Docker Hub，两边是同一份构建（digest 一致），
# 因此可以互相替代。境内服务器直连两个官方源经常不通，脚本在拉取失败时会自动改用
# 公共加速器；交互式终端下先询问，非交互环境（cron / 管道）直接走自动链路，不会挂住。
# 成功用过一次的来源会被记住（data/deploy/last-source），下次部署优先尝试它：
# 官方源在境内常常「可达但极慢」，记住之后后续升级不必每次先在慢源上耗掉一个拉取预算。
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

# 镜像源：hub（默认）| ghcr | 自定义完整仓库地址（含 IMAGE_MIRROR_PREFIX 加速器前缀）
IMAGE_SOURCE="${IMAGE_SOURCE:-hub}"
# 公共加速器候选链。公共加速器存活期很短，且有的只镜像白名单内的公共镜像、
# 会直接拒绝本项目这类用户镜像（docker.m.daocloud.io 就是这样），因此：
#   1) 只收录实测能拉到本项目的；
#   2) 做成「依次尝试」而不是让用户单选——任何一个可用即可完成部署；
#   3) 全部失效也不影响官方源可用的机器，用户无需改脚本。
MIRROR_CANDIDATES="${MIRROR_CANDIDATES:-ghcr.nju.edu.cn docker.1panel.live}"
# 候选来源的连通性探测超时（秒）。只用于「拉取前快速排除连不上的来源」；
# 真正的拉取刻意不设超时——慢速链路上拉几百 MB 可能要几分钟，
# 给拉取加超时会误杀本来能成功的部署，那比多等一会儿糟糕得多。
PROBE_TIMEOUT="${PROBE_TIMEOUT:-15}"
# 单个来源的拉取墙钟预算（秒），只作用于「后面还有候选」的来源。
# 为什么必须有它：探测只能回答「连不连得上」，回答不了「拉得快不快」——
# 实测 ghcr.io 的 manifest 探测 7s 通过，实际吞吐只有约 37KB/s，按镜像体积估算要数小时；
# 而换源此前只在「失败」时发生，于是一次部署会长时间挂在这个「可达但极慢」的来源上。
# 超额即换下一个来源：镜像层按 digest 寻址，已下好的层会被下一个来源直接复用，切换成本很低。
# 链上最后一个来源不设预算，保留「绝不误杀慢速链路」的原始保证。
PULL_SOURCE_TIMEOUT="${PULL_SOURCE_TIMEOUT:-300}"

die()  { echo "✗ $*" >&2; exit 1; }
warn() { echo "⚠ $*" >&2; }
info() { echo "==> $*"; }

# 生成 n 字节的随机十六进制串（返回 2n 个字符）。精简发行版（Alpine 等）常常没有 openssl，
# 必须有零依赖的兜底：把 /dev/urandom 的原始字节整体做十六进制编码。
# 不要写成 `tr -dc 'a-f0-9'` 过滤原始字节——每个字节落在该集合内的概率只有 16/256，
# 取 64 字节平均只剩 4 个字符，会静默产出远低于强度要求的密钥。
rand_hex() { # bytes
  local out
  out="$(openssl rand -hex "$1" 2>/dev/null)" && [ -n "$out" ] && { printf '%s' "$out"; return 0; }
  head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

# 取 .env.deploy 中某个变量的值（去掉两端引号）；变量不存在时返回空，而不是让 set -e 中断
env_value() { # key
  { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d "\"'"
}

# ---------- 镜像源 ----------

# 主源仓库地址（不含标签）。IMAGE_SOURCE 支持 hub / ghcr / 完整地址；
# GHCR_IMAGE 是等价写法，早期文档用的就是它，必须继续认。
resolve_primary_repo() {
  if [ -n "${GHCR_IMAGE:-}" ]; then
    printf '%s' "$GHCR_IMAGE"
    return 0
  fi
  case "${IMAGE_SOURCE:-}" in
    hub|dockerhub|docker.io|hub.docker.com) printf '%s' "docker.io/sxlb/qiyun" ;;
    ghcr|ghcr.io)                           printf '%s' "ghcr.io/sxlb/qiyun" ;;
    */*)                                    printf '%s' "$IMAGE_SOURCE" ;;
    *) die "IMAGE_SOURCE 取值不合法：${IMAGE_SOURCE}（应为 hub / ghcr，或形如 registry.example.com/owner/repo 的完整地址）" ;;
  esac
}

# 仓库地址里去掉 registry 主机后的路径部分（本项目的 owner/repo）
repo_path() { # repo
  printf '%s' "$1" | sed -E 's#^[^/]+/##'
}

# 把加速器前缀规范成镜像仓库地址：<加速域名>/<owner>/<repo>。
# 域名允许带协议与结尾斜杠，这里统一剥掉——docker 的镜像名不允许带协议，
# 直接拼会得到 https://x/sxlb/qiyun 这种非法引用，而报错完全指不到根因。
mirror_repo() { # mirror-domain
  local host
  host="$(printf '%s' "${1:-}" | sed -E 's#^https?://##; s#/+$##')"
  [ -n "$host" ] || return 0
  printf '%s/%s' "$host" "$(repo_path "$PRIMARY_REPO")"
}

# 另一个官方源：主源不通时优先切它，比任何第三方加速器都可信。
# 只对两个已知官方源成立——自定义仓库（自建 registry、镜像站）没有对应的「另一个」，
# 此时返回空，避免拼出一个根本不存在的地址白白多试一轮。
secondary_repo() {
  case "$PRIMARY_REPO" in
    docker.io/*) printf '%s' "ghcr.io/$(repo_path "$PRIMARY_REPO")" ;;
    ghcr.io/*)   printf '%s' "docker.io/$(repo_path "$PRIMARY_REPO")" ;;
  esac
}

# 组装拉取候选链（结果写入全局 PULL_CHAIN）。加速器只做转发，拉到的与官方源是
# 同一份构建（digest 一致），因此官方源与加速器可以自由混排、按顺序试。
build_pull_chain() { # mode(auto|mirror|official)
  local mode="$1" m repo chain=""
  case "$mode" in
    official)
      chain="$PRIMARY_REPO" ;;
    mirror)
      [ -n "${MIRROR_OVERRIDE:-}" ] && chain="$(mirror_repo "$MIRROR_OVERRIDE")"
      for m in $MIRROR_CANDIDATES; do
        repo="$(mirror_repo "$m")"; [ -n "$repo" ] && chain="$chain $repo"
      done
      chain="$chain $PRIMARY_REPO $(secondary_repo)" ;;
    *)
      chain="$PRIMARY_REPO $(secondary_repo)"
      [ -n "${MIRROR_OVERRIDE:-}" ] && chain="$chain $(mirror_repo "$MIRROR_OVERRIDE")"
      for m in $MIRROR_CANDIDATES; do
        repo="$(mirror_repo "$m")"; [ -n "$repo" ] && chain="$chain $repo"
      done ;;
  esac
  chain="$(printf '%s\n' $chain | awk 'NF && !seen[$0]++' | tr '\n' ' ')"
  PULL_CHAIN="${chain% }"
}

# ---------- 记住上次成功的来源 ----------
# 存纯文本单行而不是 JSON：shell 里读它不需要 jq，精简系统上 jq 常常没有。
# 放在数据目录下（与数据库同卷），容器重建与版本升级都不会丢。
preferred_source_file() { printf '%s' "$DATA_DIR/deploy/last-source"; }

# 读取上次成功的来源；文件不存在或为空时返回空串
read_preferred_source() {
  local f
  f="$(preferred_source_file)"
  [ -f "$f" ] || return 0
  head -1 "$f" 2>/dev/null | tr -d ' \r\n'
}

# 成功拉到镜像后记录来源。尽力而为：写不进去也不能影响部署本身。
remember_source() { # repo
  local f
  f="$(preferred_source_file)"
  mkdir -p "$(dirname "$f")" 2>/dev/null || return 0
  printf '%s\n' "$1" > "$f" 2>/dev/null || return 0
  # 属主与数据目录保持一致：这个文件落在 1001 属主的目录树里，
  # 以 root 身份留下一个 root:root 的文件，以后容易被当成异常或被误清理。
  chown --reference="$DATA_DIR" "$f" 2>/dev/null || true
  return 0
}

# 把上次成功的来源提到候选链最前面。
# 只在它仍属于当前候选链时才生效——换了 IMAGE_SOURCE 或调整过 MIRROR_CANDIDATES 之后，
# 旧来源可能已不在链上，此时直接忽略：绝不凭一条历史记录凭空造出一个来源。
# 重排序保持其余元素的相对顺序，因此「链上最后一个来源不设拉取预算」这条保证
# 仍然落在原本的末尾来源上（通常是加速器），不会被这次调整破坏。
apply_preferred_source() {
  local saved first="" rest=""
  saved="$(read_preferred_source)"
  [ -n "$saved" ] || return 0
  case " $PULL_CHAIN " in
    *" $saved "*) ;;
    *) return 0 ;;
  esac
  for repo in $PULL_CHAIN; do
    if [ "$repo" = "$saved" ]; then
      first="$saved"
    else
      rest="$rest $repo"
    fi
  done
  [ -n "$first" ] || return 0
  PULL_CHAIN="${first}${rest}"
  info "上次成功的镜像来源是 ${saved}，本次优先尝试它"
}

# 询问是否使用镜像加速器。回显两行：第一行模式（auto/mirror/official），
# 第二行加速器域名（仅手动输入时有值）。
# 刻意用「回显 + 调用方解析」而不是函数内给全局变量赋值：命令替换在子 shell 里执行，
# 函数内的赋值传不回父 shell，那种写法会静默丢掉用户输入。
# 终端判断只认 stdin 与 stderr：本函数以 `$(ask_mirror)` 形式调用，命令替换下 stdout
# 是管道，用 [ -t 1 ] 判断会永远为假，提示框根本不会出现（此坑已踩过）。
# 用 stderr 而不是 stdout，是因为提示本身就走 stderr，两者一致才不会被重定向吃掉。
# cron、`ssh host './deploy.sh'`、CI 等非交互场景一旦卡在 read 上，部署会无声挂住，
# 比不问更糟，因此这些场景直接返回自动模式。
ask_mirror() {
  # 显式配置了加速器就优先用它：用户特意设置这个变量，通常正是因为官方源走不通，
  # 此时再让他等一轮官方源超时没有意义。加在官方源之后等于让配置失效。
  if [ -n "${MIRROR_OVERRIDE:-}" ]; then printf 'mirror\n\n'; return 0; fi
  if [ -n "${DEPLOY_NO_PROMPT:-}" ] || [ ! -t 0 ] || [ ! -t 2 ]; then
    printf 'auto\n\n'; return 0
  fi
  local cand_list="" m dom
  for m in $MIRROR_CANDIDATES; do cand_list="$cand_list $m"; done
  cat >&2 <<EOF

────────────── 镜像源 ──────────────
境内服务器直连 ghcr.io / docker.io 经常超时（Docker Hub 的 registry 已被墙），
可用公共加速器拉取。加速器只做转发，拿到的与官方源是同一份构建；
但转发节点处在链路上，理论上能看到并替换镜像内容，能直连时优先直连。

  1) 自动（推荐）  先直连官方源，不通再依次尝试公共加速器
  2) 优先加速器    跳过官方源，直接走加速器（候选：${cand_list# }）
  3) 仅官方源      不使用任何加速器
  4) 手动输入      自行填写加速器域名
────────────────────────────────────
EOF
  printf '请选择 [1]: ' >&2
  local answer=""
  read -r answer || answer=""
  case "$answer" in
    ""|1) printf 'auto\n\n' ;;
    2)    printf 'mirror\n\n' ;;
    3)    printf 'official\n\n' ;;
    4)
      printf '加速器域名（例如 docker.1panel.live）: ' >&2
      read -r dom || dom=""
      dom="$(printf '%s' "$dom" | sed -E 's#^https?://##; s#/+$##')"
      if [ -n "$dom" ]; then printf 'mirror\n%s\n' "$dom"; else printf 'auto\n\n'; fi ;;
    *) printf 'auto\n\n' ;;
  esac
}

# 拉取前快速判断某个来源是否可达。docker manifest inspect 只取清单、不下载层，
# 能把「连不上」的来源在十几秒内排除，而不是让 docker 自己重试好几分钟。
# 关键：探测必须与「守护进程」走同一条网络路径。manifest 是客户端命令，会读 shell
# 的代理变量，而真正的 pull 由守护进程发起；两者不一致就会出现「探测可用、拉取超时」
# 或反过来的误判。这里的做法是照搬 `docker info` 里守护进程自己的代理配置：
#   daemon 模式——守护进程配了代理，探测也走同一个代理；
#   direct 模式——守护进程没有代理，就把客户端代理变量清干净，模拟直连。
#
# 判定口径：**只在拿到「明确不可达」的证据时才排除来源**，其余一律放行。依据是实测：
#   docker.io          rc=1  0s  connect: connection refused  → 明确不可达，排除
#   ghcr.nju.edu.cn    rc=0  9s                                → 可用（但曾因 15s 超时被误判）
#   docker.1panel.live rc=124 16s（探测自身超时）               → 拉取完全正常，不该排除
# 两个反例说明 manifest 延迟与拉取吞吐无关，且 9~16s 正好贴着 PROBE_TIMEOUT=15 的边界，
# 判定会随网络抖动而翻转。因此超时只记为「不确定」：真不可达时紧接着的 pull 会以同一条
# 连接错误快速失败，代价是几秒；而误杀一个可用加速器会让整次部署变慢甚至失败，代价大得多。
# manifest 子命令缺失时同样一律放行。
probe_repo() { # repo:tag
  PROBE_ERR=""
  [ "${MANIFEST_OK:-0}" = "1" ] || return 0
  command -v timeout >/dev/null 2>&1 || return 0
  local out="" rc=0
  if [ "${PROBE_PROXY_MODE:-direct}" = "daemon" ]; then
    out="$(timeout -k 5 "$PROBE_TIMEOUT" \
        env http_proxy="$DAEMON_HTTP_PROXY" https_proxy="$DAEMON_HTTPS_PROXY" \
            HTTP_PROXY="$DAEMON_HTTP_PROXY" HTTPS_PROXY="$DAEMON_HTTPS_PROXY" \
        docker manifest inspect "$1" 2>&1)" || rc=$?
  else
    out="$(timeout -k 5 "$PROBE_TIMEOUT" \
        env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
        docker manifest inspect "$1" 2>&1)" || rc=$?
  fi
  PROBE_ERR="$out"
  [ "$rc" = "0" ] && return 0
  # 拿到过 manifest 就说明这个来源可用，哪怕进程是被 timeout 掐掉的：
  # manifest 通常已经先打印出来了。实测 ghcr.nju.edu.cn 就有过
  # 「rc=124 但输出是完整 manifest」的情况——只看退出码会把它误判为不可用。
  if printf '%s' "$out" | grep -q '"schemaVersion"'; then
    return 0
  fi
  # 再看报错文本：只有这些字样才算「明确不可达」（连不上 / 解析不了 / TLS 失败）
  if printf '%s' "$out" | grep -qiE 'connection refused|no such host|dial tcp|tls handshake|x509'; then
    return 1
  fi
  # 其余一律放行。退出码本身不可作为依据：docker CLI 不响应 SIGTERM，被强杀时
  # rc 会是 137 而输出为空（实测 docker.io 就是如此，同一地址另一次又是 rc=1 带文本）。
  # 放行一个死源的代价是拉取阶段被 PULL_SOURCE_TIMEOUT 兜住后换源；误杀一个可用来源
  # 的代价是整次部署变慢甚至失败，后者严重得多。
  return 0
}

# 校验拉到的镜像架构与当前主机一致。多架构 manifest 下 docker 会自动选对平台，
# 这条只兜住「目标版本只有单架构」的过渡情况：不拦的话容器会以
# `exec format error` 退出，而那个报错完全指不到根因。
verify_image_arch() { # image-ref
  local host_arch img_arch
  case "$(uname -m)" in
    x86_64|amd64)  host_arch="amd64" ;;
    aarch64|arm64) host_arch="arm64" ;;
    *) return 0 ;;
  esac
  img_arch="$(docker image inspect --format '{{.Architecture}}' "$1" 2>/dev/null || true)"
  [ -n "$img_arch" ] || return 0
  [ "$img_arch" = "$host_arch" ] || die "架构不匹配：本机是 ${host_arch}，而 ${1} 只有 ${img_arch} 版本。
  ${host_arch} 镜像自 0.0.4 起提供，请改用更高版本重新部署：./deploy.sh 0.0.4"
}

# 部署互斥锁：两次部署同时跑会互相踩——一边在拉镜像、一边在停容器，
# 结果是留下半旧半新的容器。用 mkdir 的原子性加锁，不依赖 flock（精简系统常缺）。
acquire_lock() {
  local lock="$DATA_DIR/.deploy.lock" pid
  mkdir -p "$DATA_DIR"
  if ! mkdir "$lock" 2>/dev/null; then
    pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      die "另一次部署正在进行（PID ${pid}）。请等它结束；若确认它已中断，删除 ${lock} 后重试"
    fi
    warn "发现残留的部署锁（持有进程已不存在），已接管"
    rm -rf "$lock"
    mkdir "$lock" 2>/dev/null || die "无法获取部署锁：${lock}"
  fi
  printf '%s' "$$" > "$lock/pid"
  trap 'rm -rf "$DATA_DIR/.deploy.lock"' EXIT
}

# Docker 缺失时按发行版给出可直接执行的安装命令。只丢一个文档链接的话，
# 用户还得自己判断发行版与安装方式，摩擦远大于直接把命令打出来。
docker_install_hint() {
  local id="" like="" cmd=""
  if [ -r /etc/os-release ]; then
    id="$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"')"
    like="$(sed -n 's/^ID_LIKE=//p' /etc/os-release | tr -d '"')"
  fi
  case " $id $like " in
    *debian*|*ubuntu*) cmd="sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2" ;;
    *centos*|*rhel*|*rocky*|*almalinux*) cmd="sudo dnf install -y docker-ce docker-compose-plugin  # 需先添加 Docker 官方源" ;;
    *fedora*) cmd="sudo dnf install -y docker-ce docker-compose-plugin" ;;
    *alpine*) cmd="sudo apk add docker docker-cli-compose && sudo rc-update add docker default && sudo service docker start" ;;
    *arch*) cmd="sudo pacman -S --noconfirm docker docker-compose && sudo systemctl enable --now docker" ;;
  esac
  [ -n "$cmd" ] && { echo "  当前系统（${id:-未知}）可直接执行："; echo "    ${cmd}"; }
  echo "  通用一键脚本：curl -fsSL https://get.docker.com | sudo sh"
  echo "  文档：https://docs.docker.com/engine/install/"
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

# 生成快照并裁剪超量份数。调用方需先停容器：复制期间必须没有写入者，
# 否则主库与 WAL 可能来自不同时刻。
#
# 【为什么快照必须连 WAL 一起存】
# SQLite 处于 WAL 模式时，已提交的事务可能只写在 prod.db-wal 里，直到发生 checkpoint
# 才并入主库文件。而「停容器」**并不保证**会触发 checkpoint：容器以 PID 1 跑 shell，
# SIGTERM 未必转发给 node，10s 后 Docker 直接 SIGKILL，SQLite 来不及做收尾 checkpoint。
# 实测证据：一份只拷 prod.db 的快照里 VisitRecord 是 0 条，而同一时刻 prod.db-wal 里
# 躺着 14 条已提交记录——那份快照一旦被用来回滚，这 14 条就凭空没了。
# 因此主库与 WAL 成组保存，恢复时成组还原，由 SQLite 回放 WAL。
snapshot_stopped() { # srcVersion
  local src="$1"
  mkdir -p "$BACKUP_DIR"
  SNAP_PATH="$BACKUP_DIR/prod-${src}-$(date +%Y%m%d-%H%M%S).db"
  cp -f "$DATA_DIR/prod.db" "$SNAP_PATH" || die "复制数据库失败：${DATA_DIR}/prod.db → ${SNAP_PATH}"
  # 校验文件头：磁盘写满或文件被截断时必须当场发现，否则备份形同虚设
  head -c 16 "$SNAP_PATH" | grep -q '^SQLite format 3' \
    || die "快照不可用：${SNAP_PATH} 不是有效的 SQLite 文件，请检查磁盘空间是否充足"
  # WAL 侧车：存成 <快照名>-wal，与主库成组。空 WAL 没有任何内容，不必存。
  if [ -s "$DATA_DIR/prod.db-wal" ]; then
    cp -f "$DATA_DIR/prod.db-wal" "${SNAP_PATH}-wal" \
      || die "复制 WAL 失败：${DATA_DIR}/prod.db-wal → ${SNAP_PATH}-wal"
  fi
  prune_snapshots
}

# 裁剪超量快照：连同 WAL 侧车一起删，避免留下跟任何快照都对不上的孤儿文件。
# 收尾显式 return 0：本脚本是 set -euo pipefail，而目录里没有快照时 ls 会非 0，
# 不兜住会把整个升级流程带停。
prune_snapshots() {
  local old
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f "$old" "${old}-wal" "${old}-shm"
  done < <(ls -1t "$BACKUP_DIR"/prod-*.db 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) || true)
  return 0
}

# 把快照恢复到数据目录；调用方需先停容器
restore_snapshot() { # path
  local snap="$1"
  # 先清 WAL/SHM：旧日志与新库文件混用会导致数据库损坏
  rm -f "$DATA_DIR/prod.db-wal" "$DATA_DIR/prod.db-shm"
  cp -f "$snap" "$DATA_DIR/prod.db" || die "恢复数据库失败：${snap} → ${DATA_DIR}/prod.db"
  # 快照里的 WAL 一并还原：尚未 checkpoint 的已提交事务全在里面，漏掉就是回滚时静默丢数据
  # （见 snapshot_stopped 的说明）。只还原 -wal，不还原 -shm：后者只是 WAL 的内存索引，
  # SQLite 会按 WAL 自行重建，照搬反而可能与新位置的 WAL 对不上。
  if [ -s "${snap}-wal" ]; then
    cp -f "${snap}-wal" "$DATA_DIR/prod.db-wal" \
      || die "恢复 WAL 失败：${snap}-wal → ${DATA_DIR}/prod.db-wal"
  fi
  # cp 会重建目标文件，属主随之变成执行脚本的用户（通常是 root）。容器内以 UID 1001 运行，
  # 不校正属主的话新库对容器只读，启动时直接报 SQLite「disk I/O error」并转为 unhealthy，
  # 表现为「回退后服务起不来」。注意本步骤在第 4 节的目录授权之后执行，必须单独处理。
  # WAL 同样要校正：它会在回放/下一次 checkpoint 时写回主库，属主是 root 一样会报只读。
  if [ "$(id -u)" = "0" ]; then
    chown "${APP_UID:-1001}:${APP_GID:-1001}" "$DATA_DIR/prod.db" 2>/dev/null \
      || warn "未能调整 ${DATA_DIR}/prod.db 的属主，容器可能无法写入数据库"
    if [ -f "$DATA_DIR/prod.db-wal" ]; then
      chown "${APP_UID:-1001}:${APP_GID:-1001}" "$DATA_DIR/prod.db-wal" 2>/dev/null \
        || warn "未能调整 ${DATA_DIR}/prod.db-wal 的属主，容器可能无法写入数据库"
    fi
  fi
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
    # 连同 WAL 一起统计：WAL 模式下未 checkpoint 的已提交数据都在 -wal 里，
    # 只报主库大小会明显低估真实数据量（实测主库 160KB 而 WAL 有 780KB）
    db_size="$(( ( $(wc -c < "$DATA_DIR/prod.db") + $(wc -c < "$DATA_DIR/prod.db-wal" 2>/dev/null || echo 0) ) / 1024 )) KB"
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
command -v docker >/dev/null 2>&1 || {
  echo "✗ 未检测到 docker。" >&2
  docker_install_hint >&2
  exit 1
}
docker compose version >/dev/null 2>&1 \
  || die "需要 Docker Compose v2（命令形式为 docker compose）。若只装了 docker-compose v1，请升级 Docker"
if ! docker info >/dev/null 2>&1; then
  # 区分「没启动」与「没权限」：两者成因和修法完全不同，
  # 笼统报一句「无法连接守护进程」会把用户引向错误的方向。
  if [ "$(id -u)" != "0" ] && ! id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    die "无法连接 Docker 守护进程：当前用户（$(id -un)）不在 docker 组。执行下面两条，重新登录（或先执行 newgrp docker）后即可：
  sudo usermod -aG docker $(id -un)
  sudo systemctl restart docker"
  fi
  die "无法连接 Docker 守护进程，Docker 可能没有启动：
  sudo systemctl start docker      # 无 systemd 的系统：sudo service docker start"
fi

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

# 其余子命令都会停容器或改数据，加互斥锁；status 已在上面退出，不会被锁影响
acquire_lock

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
elif [ "$SUB" = "backup" ]; then
  # backup 只做快照，与「升级到哪个版本」无关：必须沿用当前正在运行的版本。
  # 若走下面的「解析最新版本」分支，一次备份就会顺带把服务换成别的镜像，
  # 而且在没有 curl / 没有外网的机器上（备份恰恰是最需要能用的场景）会直接失败。
  IMAGE_TAG="${2:-$cur_version}"
  [ -n "$IMAGE_TAG" ] \
    || die "无法确定要恢复的镜像版本：容器尚未部署。可显式指定：./deploy.sh backup 0.0.1"
  info "backup 沿用镜像版本：${IMAGE_TAG}"
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
# 镜像源解析：默认 Docker Hub，可用 IMAGE_SOURCE / IMAGE_MIRROR_PREFIX 覆盖。
# 这里只定「主源」并导出——compose 用 ${GHCR_IMAGE} 做插值，backup 这类不拉镜像的
# 子命令也依赖它。加速器的询问与候选链留到第 6 步真正要拉取时再处理，
# 免得只想做个数据库快照的人也被问一堆网络配置。
PRIMARY_REPO="$(resolve_primary_repo)"
GHCR_IMAGE="$PRIMARY_REPO"
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
  SECRET="$(rand_hex 32)"
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
  BACKUP_KEY="$(rand_hex 32)"
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
# 备份签名密钥的强度：缺失或过短不会立刻报错，只在导出/恢复备份时表现为「校验不通过」，
# 而弱密钥可被枚举后伪造备份覆盖数据库，所以单独再检查一次强度。
hmac_val="$(env_value BACKUP_HMAC_KEY)"
[ ${#hmac_val} -ge 32 ] \
  || warn "BACKUP_HMAC_KEY 不足 32 字符，备份签名强度不足（生成：openssl rand -hex 32）"
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
# 官方源在境内经常不通，这里按候选链依次尝试（官方主源 → 备用官方源 → 加速器），
# 谁先成功用谁；全部失败才终止，并列出试过的来源，避免用户对着一条报错猜方向。
MIRROR_OVERRIDE="$(printf '%s' "${IMAGE_MIRROR_PREFIX:-}" | sed -E 's#^https?://##; s#/+$##')"
MIRROR_ANSWER="$(ask_mirror)"
PULL_MODE="$(printf '%s' "$MIRROR_ANSWER" | head -1)"
ANSWER_MIRROR="$(printf '%s' "$MIRROR_ANSWER" | sed -n '2p')"
if [ -n "$ANSWER_MIRROR" ]; then MIRROR_OVERRIDE="$ANSWER_MIRROR"; fi
build_pull_chain "$PULL_MODE"

# 记忆来源优先。两种情况不干预，因为那时的顺序是用户的明确意图：
#   1) 显式指定了加速器（IMAGE_MIRROR_PREFIX 或交互式选择）——它必须留在最前；
#   2) 选了「仅官方源」——链上只有官方源，重排序无意义，也不该借历史记录引入加速器。
if [ -z "$MIRROR_OVERRIDE" ] && [ "$PULL_MODE" != "official" ]; then
  apply_preferred_source
fi

# manifest 子命令用于拉取前的可达性预判；缺失时 probe_repo 一律放行
MANIFEST_OK=0
if docker manifest inspect --help >/dev/null 2>&1; then MANIFEST_OK=1; fi

# 探测走哪条网络路径，取决于守护进程自己的代理配置（理由见 probe_repo 注释）
DAEMON_HTTP_PROXY="$(docker info --format '{{.HTTPProxy}}' 2>/dev/null || true)"
DAEMON_HTTPS_PROXY="$(docker info --format '{{.HTTPSProxy}}' 2>/dev/null || true)"
PROBE_PROXY_MODE="direct"
if [ -n "$DAEMON_HTTP_PROXY" ] || [ -n "$DAEMON_HTTPS_PROXY" ]; then
  PROBE_PROXY_MODE="daemon"
  info "检测到 Docker 守护进程配置了代理，探测将沿用同一代理"
fi

info "拉取 ${IMAGE_TAG} 镜像，依次尝试：${PULL_CHAIN// /、}"
PULLED_REPO=""
PULL_FAILED=""
LAST_PROBE_ERR=""
# 链上最后一个候选不设拉取预算（见 PULL_SOURCE_TIMEOUT 说明）。
# PULL_CHAIN 已在 build_pull_chain 里去重，因此用字符串比较判定「后面还有没有候选」是可靠的。
LAST_REPO=""
for _r in $PULL_CHAIN; do LAST_REPO="$_r"; done
for repo in $PULL_CHAIN; do
  if ! probe_repo "${repo}:${IMAGE_TAG}"; then
    LAST_PROBE_ERR="$PROBE_ERR"
    warn "来源 ${repo} 探测不通，跳过"
    PULL_FAILED="${PULL_FAILED} ${repo}"
    continue
  fi

  pull_rc=0
  if [ "$PULL_SOURCE_TIMEOUT" != "0" ] && [ "$repo" != "$LAST_REPO" ]; then
    # -k 10：docker CLI 不响应 SIGTERM（实测探测阶段能拖到预算的 3 倍才退），
    # 没有强杀兜底的话这个「预算」形同虚设。被强杀后守护进程会丢弃半截层，
    # 已完整的层留在原地，供下一个来源按 digest 直接复用。
    GHCR_IMAGE="$repo" timeout -k 10 "$PULL_SOURCE_TIMEOUT" \
      docker compose --env-file "$ENV_FILE" pull || pull_rc=$?
    # 124 = SIGTERM 生效；137 = SIGTERM 被忽略、由 -k 强杀。两者都表示「太慢」而不是「拉不到」。
    case "$pull_rc" in
      124|137)
        warn "来源 ${repo} 拉取超过 ${PULL_SOURCE_TIMEOUT}s 仍未完成（判定为过慢），换下一个来源；已下载的层会被复用"
        PULL_FAILED="${PULL_FAILED} ${repo}(过慢)"
        # 给守护进程一点时间收尾被掐断的拉取，避免下一次 pull 撞上同一个镜像的并发操作
        sleep 2
        continue
        ;;
    esac
  else
    # 末位来源（或显式关闭预算）：不给超时，保留「慢速链路也能拉完」的保证
    GHCR_IMAGE="$repo" docker compose --env-file "$ENV_FILE" pull || pull_rc=$?
  fi
  if [ "$pull_rc" = "0" ]; then
    PULLED_REPO="$repo"
    break
  fi
  PULL_FAILED="${PULL_FAILED} ${repo}"
  warn "从 ${repo} 拉取失败，换下一个来源"
done

if [ -z "$PULLED_REPO" ]; then
  # 把探测到的原始报错原样带出来：它能区分两种截然不同的原因——
  # 「manifest unknown / not found」是版本号写错了，而「i/o timeout / deadline exceeded」
  # 才是网络不通。只给一句「都失败了」会让用户朝错误的方向排查。
  [ -z "$LAST_PROBE_ERR" ] || warn "最近一次探测的原始报错：${LAST_PROBE_ERR}"
  die "所有镜像来源都拉取失败（现有服务未受影响）。
  已尝试：${PULL_FAILED# }
  若报错为 no such manifest / manifest unknown / not found → 该版本不存在，请核对版本号，
    或直接执行 ./deploy.sh（不带版本号）查询最新版本。
  若是超时 / 连接被拒 → 网络不通，可自行指定可用加速器后重试：
    IMAGE_MIRROR_PREFIX=你的加速器域名 ./deploy.sh ${IMAGE_TAG}
  也可先确认服务器能否访问官方源：ghcr.io / docker.io"
fi

# 后续 compose 命令必须引用「实际拉到的那份镜像」的地址，否则 up -d 会把它当成
# 另一个镜像再拉一次（甚至拉不到）。加速器与官方源是同一份构建，内容一致。
GHCR_IMAGE="$PULLED_REPO"
export GHCR_IMAGE
# 记录本次成功的来源，下次部署优先尝试它（尽力而为，失败不影响部署本身）
remember_source "$PULLED_REPO"
# 明确告知实际用的来源：主源不通时自动切换过，用户需要知道这份镜像是从哪来的
if [ "$PULLED_REPO" = "$PRIMARY_REPO" ]; then
  info "镜像来源：${PULLED_REPO}"
else
  info "镜像来源：${PULLED_REPO}（主源 ${PRIMARY_REPO} 不可用，已自动切换）"
fi
verify_image_arch "${PULLED_REPO}:${IMAGE_TAG}"

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
  info "已备份 ${SNAP_PATH}（主库与 WAL 成组保存，${BACKUP_DIR} 内保留最近 ${BACKUP_KEEP} 份）"
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
