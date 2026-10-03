#!/usr/bin/env bash
# 供 tests/deploy/deploy-scripts.test.ts 调用的夹具。
#
# 关键点：它从**真实 deploy.sh** 里抽取函数再执行，断言的是实际代码而不是副本——
# 复制一份函数来测，只能证明副本是对的，改动原文件后测试照样绿。
#
# 用法：deploy-logic.sh <probe|pull|pref> [参数...]
#   probe <假docker行为> <repo>   输出 VERDICT=allow|exclude、PROBE_ERR=<首行>
#   pull  <chain> <budget>        输出 PULLED_REPO=...、PULL_FAILED=...
#   pref  <saved> <chain>         输出 PULL_CHAIN=...、SAVED=...
#
# deploy.sh 依赖真实 docker 与真实网络，这里把 docker 换成 PATH 前置的假命令，
# 让行为可确定、可离线复现。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEPLOY="$ROOT/deploy.sh"
[ -f "$DEPLOY" ] || { echo "找不到 deploy.sh: $DEPLOY" >&2; exit 2; }

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

# 被抽取的函数会调用 deploy.sh 的这几个输出函数；夹具里静音即可。
# 必须**在抽取之前**定义好：apply_preferred_source 会调 info，漏定义会报 command not found。
info() { :; }
warn() { :; }
die()  { printf 'DIED %s\n' "$*" >&2; exit 3; }

# 把多行输出压成单行：夹具以 KEY=VALUE 行输出，值里带换行会截断断言
oneline() { printf '%s' "$1" | tr '\n' ' '; }

# 用 awk 抽取：GNU/BSD 都可用。不用 `sed -n 'A,Bp' | head -n -1`，
# 那个写法依赖 GNU head，在 macOS 上会失败。
extract_probe() { awk '/^probe_repo\(\)/{f=1} f{print} f && /^}$/{exit}' "$DEPLOY"; }
extract_pref()  { awk '/^# ---------- 记住上次成功的来源/{f=1} /^# 询问是否使用镜像加速器/{f=0} f' "$DEPLOY"; }
extract_pull()  { awk '/^info "拉取 /{f=1} f{print} f && /^done$/{exit}' "$DEPLOY"; }

# 探测阶段的假 docker：行为由 FAKE_DOCKER_MODE 决定
write_fake_docker_probe() {
  cat > "$STUB_DIR/docker" <<'FAKE'
#!/usr/bin/env bash
case "${FAKE_DOCKER_MODE:-ok}" in
  # 正常返回 manifest
  ok)                 printf '{\n  "schemaVersion": 2,\n  "manifests": []\n}\n'; exit 0 ;;
  # 打印了 manifest 但进程卡住（会被 timeout 掐掉）——实测 ghcr.nju.edu.cn 就是这个形态
  manifest_then_hang) printf '{\n  "schemaVersion": 2\n}\n'; sleep 30; exit 0 ;;
  # 什么都不输出且卡住：既没拿到 manifest，也没有可判定的报错
  silent_hang)        sleep 30; exit 0 ;;
  # 明确不可达的两种典型报错
  refused)            printf 'failed to configure transport: error pinging v2 registry: Get "https://registry-1.docker.io/v2/": connect: connection refused\n' >&2; exit 1 ;;
  nohost)             printf 'Get "https://x/v2/": dial tcp: lookup x: no such host\n' >&2; exit 1 ;;
  # 鉴权类报错：不构成「不可达」的证据
  unauthorized)       printf 'unauthorized: authentication required\n' >&2; exit 1 ;;
  *)                  exit 1 ;;
esac
FAKE
  chmod +x "$STUB_DIR/docker"
}

# 拉取阶段的假 docker：按 GHCR_IMAGE 决定这次是慢、忽略信号、还是成功
write_fake_docker_pull() {
  cat > "$STUB_DIR/docker" <<'FAKE'
#!/usr/bin/env bash
case "${GHCR_IMAGE:-}" in
  # 忽略 SIGTERM：只能靠 timeout 的 -k 强杀（rc=137）
  *ignoresig*) trap '' TERM; sleep 30 ;;
  # 末位来源用：耗时长于预算但最终会成功，用来验证「末位不设预算」
  *lastslow*)  sleep 3 ;;
  # 普通慢源：会被预算掐断（rc=124）
  *slow*)      sleep 30 ;;
  *fast*)      exit 0 ;;
  *)           exit 1 ;;
esac
FAKE
  chmod +x "$STUB_DIR/docker"
}

cmd_probe() { # mode repo
  FAKE_DOCKER_MODE="$1"
  export FAKE_DOCKER_MODE
  MANIFEST_OK=1
  PROBE_TIMEOUT=1
  PROBE_PROXY_MODE=direct
  DAEMON_HTTP_PROXY=""
  DAEMON_HTTPS_PROXY=""
  PROBE_ERR=""
  eval "$(extract_probe)"
  if probe_repo "$2"; then
    printf 'VERDICT=allow\n'
  else
    printf 'VERDICT=exclude\n'
  fi
  printf 'PROBE_ERR=%s\n' "$(oneline "$PROBE_ERR")"
}

cmd_pull() { # chain budget
  ENV_FILE=/dev/null
  IMAGE_TAG=0.0.6
  PULL_CHAIN="$1"
  PULL_SOURCE_TIMEOUT="$2"
  PULLED_REPO=""
  PULL_FAILED=""
  LAST_PROBE_ERR=""
  PROBE_ERR=""
  GHCR_IMAGE=""
  # 探测单独测，这里桩掉：只让链上标了 dead 的来源被判为不可达
  probe_repo() {
    case "$1" in
      *dead*) PROBE_ERR="stub: unreachable"; return 1 ;;
      *)      PROBE_ERR=""; return 0 ;;
    esac
  }
  eval "$(extract_pull)"
  printf 'PULLED_REPO=%s\n' "$PULLED_REPO"
  printf 'PULL_FAILED=%s\n' "$PULL_FAILED"
}

cmd_pref() { # saved chain
  local saved="$1"
  DATA_DIR="$STUB_DIR/data"
  eval "$(extract_pref)"
  case "$saved" in
    __NONE__)       : ;;                                              # 完全没有记录文件
    __EMPTY__)
      mkdir -p "$DATA_DIR/deploy"
      : > "$DATA_DIR/deploy/last-source" ;;
    __WHITESPACE__)
      mkdir -p "$DATA_DIR/deploy"
      printf '  b/y \n\n' > "$DATA_DIR/deploy/last-source" ;;
    *)              remember_source "$saved" || true ;;
  esac
  PULL_CHAIN="$2"
  apply_preferred_source >/dev/null
  printf 'PULL_CHAIN=%s\n' "$PULL_CHAIN"
  printf 'SAVED=%s\n' "$(read_preferred_source)"
}

case "${1:-}" in
  probe) write_fake_docker_probe; PATH="$STUB_DIR:$PATH"; shift; cmd_probe "$@" ;;
  pull)  write_fake_docker_pull;  PATH="$STUB_DIR:$PATH"; shift; cmd_pull "$@" ;;
  pref)  shift; cmd_pref "$@" ;;
  *)     echo "用法: $0 <probe|pull|pref> ..." >&2; exit 2 ;;
esac
