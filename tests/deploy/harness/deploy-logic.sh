#!/usr/bin/env bash
# 供 tests/deploy/deploy-scripts.test.ts 调用的夹具。
#
# 关键点：它从**真实 deploy.sh** 里抽取函数再执行，断言的是实际代码而不是副本——
# 复制一份函数来测，只能证明副本是对的，改动原文件后测试照样绿。
#
# 用法：deploy-logic.sh <probe|pull|rank|speed|pref|snap|wal|setup> [参数...]
#   probe <假docker行为> <repo>   输出 VERDICT=allow|exclude、PROBE_ERR=<首行>
#   pull  <chain> <budget>        输出 PULLED_REPO=...、PULL_FAILED=...
#   rank  <chain> [tag]           输出 SKIPPED=...、SUMMARY=...、PROBED=...
#   speed <模式> [url]            输出 KPBS=...、RC=...
#   pref  <saved> <chain>         输出 PULL_CHAIN=...、SAVED=...
#   snap  <场景>                  输出快照/还原后的目录内容（文件级断言）
#   wal   （无参数）              用真实 SQLite 复现「未 checkpoint 的 WAL」并断言数据是否还在
#
# deploy.sh 依赖真实 docker 与真实网络，这里把 docker 换成 PATH 前置的假命令，
# 让行为可确定、可离线复现。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEPLOY="$ROOT/deploy.sh"
[ -f "$DEPLOY" ] || { echo "找不到 deploy.sh: $DEPLOY" >&2; exit 2; }

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

# python 解释器：CI（ubuntu）上是 python3，Windows 本地（git-bash）通常只有 python
PY="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"

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

# 按函数名精确抽取。不用注释做锚点：注释会随改动挪位，锚点一断测试就悄悄抽空。
extract_fn() { awk -v name="$1" '$0 ~ "^"name"\\(\\)" {f=1} f{print} f && /^}$/{exit}' "$DEPLOY"; }
extract_snap() {
  extract_fn snapshot_stopped
  extract_fn prune_snapshots
  extract_fn restore_snapshot
}

# 造一个「文件头合法」的假数据库：snapshot_stopped 会校验前 16 字节是否为 SQLite 魔数
write_fake_db() { printf 'SQLite format 3+padding\n' > "$1"; }

# 统计文件里匹配某模式的行数，文件不存在或读不到时回落 0。
# 不用裸的 `grep -c ... || echo 0`：grep 无匹配时自己也会打一个 0 并以非 0 退出，
# `||` 分支再补一个 0，字段值就成了两行，KEY=VALUE 解析会被带偏。
count_lines() {
  local file="$1" pattern="$2" n
  n="$(grep -c -- "$pattern" "$file" 2>/dev/null | head -n1)"
  printf '%s' "${n:-0}"
}

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

# ---------- 拉取测速选源：rank_pull_chain 的跳过规则 ----------
# 把 speed_probe_kbps 桩掉，只验证「按速度决定跳过谁」这段纯逻辑。
# 同时记录被真正探测过的来源，用来钉住「遇到达标来源就停止探测」的短路行为。
cmd_rank() { # chain [tag]
  local chain="$1" tag="${2:-1.0.0}"
  PULL_CHAIN="$chain"
  SPEED_PROBE=1
  PROBE_MIN_KBPS=600
  local probed="$STUB_DIR/rank_probed.txt"
  : > "$probed"
  # 桩：按仓库名给出速度（slow=100KB/s 偏慢；fast=5000KB/s 达标；其余=测不到）
  speed_probe_kbps() {
    printf '%s\n' "$1" >> "$probed"
    case "$1" in
      *slow*) printf '100' ;;
      *fast*) printf '5000' ;;
      *)      : ;;
    esac
  }
  SPEED_SKIPPED=""
  SPEED_SUMMARY=""
  eval "$(extract_fn rank_pull_chain)"
  rank_pull_chain "$tag" >/dev/null
  printf 'SKIPPED=%s\n' "$SPEED_SKIPPED"
  printf 'SUMMARY=%s\n' "$SPEED_SUMMARY"
  printf 'PROBED=%s\n' "$(tr '\n' ' ' < "$probed" | sed 's/ *$//')"
}

# 造一个「只有 timeout、没有 python」的 PATH，用来验证缺 python 时静默降级。
# 桩一律用绝对解释器（#!/bin/sh + 绝对路径 exec）：这些用例会把 PATH 收窄到桩目录本身，
# 用 «#!/usr/bin/env bash» 会因 PATH 里找不到 bash 而起不来，测出来的「空」是假的。
make_stub_timeout_only() { # dir
  local d="$1" rt
  mkdir -p "$d"
  rt="$(command -v timeout)"
  printf '#!/bin/sh\nexec "%s" "$@"\n' "$rt" > "$d/timeout"
  chmod +x "$d/timeout"
}

# 造一个「有 timeout、且有假 python3」的 PATH。假 python 按 $1 决定输出内容。
make_stub_python() { # dir pyprint
  local d="$1" print="$2"
  make_stub_timeout_only "$d"
  printf '#!/bin/sh\nprintf "%%s" %s\n' "$print" > "$d/python3"
  chmod +x "$d/python3"
}

# ---------- 拉取测速：speed_probe_kbps 的取值与降级 ----------
# real 模式需要真实网络（由上层用例起本地假 registry 提供），其余模式纯本地确定。
cmd_speed() { # mode [url]
  local mode="$1" url="${2:-}" out="" rc=0
  DAEMON_HTTP_PROXY=""
  DAEMON_HTTPS_PROXY=""
  SPEED_PROBE_BYTES=1048576
  SPEED_PROBE_TIMEOUT=4
  SPEED_PROBE=1
  eval "$(extract_fn speed_probe_kbps)"
  case "$mode" in
    real)
      out="$(speed_probe_kbps "$url" 1.0.0)" || rc=$?
      ;;
    disabled)
      SPEED_PROBE=0
      out="$(speed_probe_kbps "$url" 1.0.0)" || rc=$?
      ;;
    nopy)
      # 只有 timeout、没有 python3/python：应静默返回空而不是报错
      make_stub_timeout_only "$STUB_DIR/only-timeout"
      out="$(PATH="$STUB_DIR/only-timeout" speed_probe_kbps "$url" 1.0.0)" || rc=$?
      ;;
    garbage)
      # python 吐出非数字：应被过滤成空
      make_stub_python "$STUB_DIR/py-garbage" '"not-a-number"'
      out="$(PATH="$STUB_DIR/py-garbage" speed_probe_kbps "$url" 1.0.0)" || rc=$?
      ;;
    stub)
      # python 吐出固定数字：应原样透传（验证参数与输出管路是通的）
      make_stub_python "$STUB_DIR/py-stub" '"1234"'
      out="$(PATH="$STUB_DIR/py-stub" speed_probe_kbps "$url" 1.0.0)" || rc=$?
      ;;
    *) echo "未知模式: $mode" >&2; exit 2 ;;
  esac
  printf 'KPBS=%s\n' "$out"
  printf 'RC=%s\n' "$rc"
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

# ---------- 快照 / 还原：文件级断言 ----------
# 这些函数只做文件操作，不需要假 docker，也不需要真实 SQLite。
cmd_snap() { # scenario
  local work="$STUB_DIR/snap"
  DATA_DIR="$work/data"
  BACKUP_DIR="$DATA_DIR/deploy/backups"
  BACKUP_KEEP=2
  APP_UID="$(id -u)"
  APP_GID="$(id -g)"
  mkdir -p "$DATA_DIR"
  eval "$(extract_snap)"

  local n f
  case "$1" in
    backup_with_wal)
      write_fake_db "$DATA_DIR/prod.db"
      printf 'WALDATA' > "$DATA_DIR/prod.db-wal"
      snapshot_stopped 0.0.6 >/dev/null
      printf 'FILES=%s\n' "$(ls -1 "$BACKUP_DIR" | sort | tr '\n' ',')"
      ;;
    backup_empty_wal)
      # 空 WAL 没有任何内容，不该产出侧车文件
      write_fake_db "$DATA_DIR/prod.db"
      : > "$DATA_DIR/prod.db-wal"
      snapshot_stopped 0.0.6 >/dev/null
      printf 'FILES=%s\n' "$(ls -1 "$BACKUP_DIR" | sort | tr '\n' ',')"
      ;;
    backup_no_wal)
      write_fake_db "$DATA_DIR/prod.db"
      snapshot_stopped 0.0.6 >/dev/null
      printf 'FILES=%s\n' "$(ls -1 "$BACKUP_DIR" | sort | tr '\n' ',')"
      ;;
    restore_with_wal)
      mkdir -p "$BACKUP_DIR"
      write_fake_db "$BACKUP_DIR/prod-0.0.6-20261003-120000.db"
      printf 'WALDATA' > "$BACKUP_DIR/prod-0.0.6-20261003-120000.db-wal"
      write_fake_db "$DATA_DIR/prod.db"
      printf 'STALEWAL' > "$DATA_DIR/prod.db-wal"
      printf 'STALESHM' > "$DATA_DIR/prod.db-shm"
      restore_snapshot "$BACKUP_DIR/prod-0.0.6-20261003-120000.db" >/dev/null
      printf 'WAL=%s\n' "$(cat "$DATA_DIR/prod.db-wal" 2>/dev/null || echo MISSING)"
      printf 'HAS_SHM=%s\n' "$([ -f "$DATA_DIR/prod.db-shm" ] && echo yes || echo no)"
      ;;
    restore_without_wal)
      # 兼容升级前的旧快照：没有侧车时不得凭空造一个，且旧的残留 WAL/SHM 必须清掉
      mkdir -p "$BACKUP_DIR"
      write_fake_db "$BACKUP_DIR/prod-0.0.6-20261003-120000.db"
      write_fake_db "$DATA_DIR/prod.db"
      printf 'STALEWAL' > "$DATA_DIR/prod.db-wal"
      printf 'STALESHM' > "$DATA_DIR/prod.db-shm"
      restore_snapshot "$BACKUP_DIR/prod-0.0.6-20261003-120000.db" >/dev/null
      printf 'HAS_WAL=%s\n' "$([ -f "$DATA_DIR/prod.db-wal" ] && echo yes || echo no)"
      printf 'HAS_SHM=%s\n' "$([ -f "$DATA_DIR/prod.db-shm" ] && echo yes || echo no)"
      ;;
    prune)
      mkdir -p "$BACKUP_DIR"
      for n in 1 2 3 4; do
        f="$BACKUP_DIR/prod-0.0.$n-2026100$n-120000.db"
        write_fake_db "$f"
        printf 'WAL' > "${f}-wal"
        touch -t "2026100${n}1200" "$f" "${f}-wal"
      done
      prune_snapshots
      printf 'FILES=%s\n' "$(ls -1 "$BACKUP_DIR" | sort | tr '\n' ',')"
      ;;
    *) echo "未知场景: $1" >&2; exit 2 ;;
  esac
}

# ---------- 真实 SQLite 回归：未 checkpoint 的 WAL 里的事务是否被保住 ----------
rows_of() { # dbpath
  "$PY" - "$1" <<'PY'
import sqlite3, sys
try:
    con = sqlite3.connect(sys.argv[1])
    print(con.execute("select count(*) from VisitRecord").fetchone()[0])
except Exception:
    print("none")
PY
}

cmd_wal() {
  local work="$STUB_DIR/wal"
  [ -n "$PY" ] || { echo "NO_PYTHON=1"; return 0; }
  mkdir -p "$work/data"
  DATA_DIR="$work/data"
  BACKUP_DIR="$DATA_DIR/deploy/backups"
  BACKUP_KEEP=20
  APP_UID="$(id -u)"
  APP_GID="$(id -g)"
  eval "$(extract_snap)"

  # 造出线上真实形态：已提交的事务只在 WAL 里，主库文件尚未更新。
  # os._exit 跳过解释器收尾 → 连接不 close → 不触发 checkpoint，
  # 这正是容器被 SIGKILL 收尾时数据库的落盘状态。
  "$PY" - "$DATA_DIR/prod.db" <<'PY'
import os, sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.execute("pragma journal_mode=wal")
con.execute("create table VisitRecord(id integer primary key)")
con.executemany("insert into VisitRecord(id) values(?)", [(i,) for i in (1, 2, 3)])
con.commit()
os._exit(0)
PY
  printf 'WAL_BYTES=%s\n' "$(wc -c < "$DATA_DIR/prod.db-wal" | tr -d ' ')"

  # 关键顺序：先把两种做法要用的文件都取出来，再去做任何读取。
  # 一旦用 SQLite 打开过原库，最后一条连接关闭时会触发 checkpoint，WAL 就被并进主库，
  # 「只拷主库」于是也跟着有数据，问题就复现不出来了（第一版就踩了这个坑）。
  mkdir -p "$work/dbonly"
  cp -f "$DATA_DIR/prod.db" "$work/dbonly/prod.db"
  snapshot_stopped 0.0.6 >/dev/null

  # 旧做法：只把主库文件拷走 → 数据丢
  printf 'ROWS_DBONLY=%s\n' "$(rows_of "$work/dbonly/prod.db")"
  # 新做法：成组快照 → 成组还原 → 数据回来
  rm -f "$DATA_DIR/prod.db" "$DATA_DIR/prod.db-wal" "$DATA_DIR/prod.db-shm"
  restore_snapshot "$SNAP_PATH" >/dev/null
  printf 'ROWS_RESTORED=%s\n' "$(rows_of "$DATA_DIR/prod.db")"
}

# ---------- 更新通道安装器：在「没有 crontab 的全新机器」上的行为 ----------
# setup-update.sh 是一次性脚本（无函数可抽），所以整体跑真实文件，把会碰系统的东西桩掉。
cmd_setup() {
  local scenario="${1:-fresh}"
  local work="$STUB_DIR/setup"
  rm -rf "$work"
  mkdir -p "$work/repo/data" "$work/bin" "$work/state"
  # 最小仓库：脚本靠 docker-compose.yml + data/ 定位仓库目录
  : > "$work/repo/docker-compose.yml"
  mkdir -p "$work/repo/scripts"
  cp -f "$ROOT/scripts/setup-update.sh" "$work/repo/scripts/"
  cp -f "$ROOT/scripts/update-watch.sh" "$work/repo/scripts/"
  cp -f "$ROOT/scripts/update.sh" "$work/repo/scripts/"

  # 桩 crontab：初始完全没有 crontab（-l 返回非 0）——这正是全新服务器的状态，
  # 也是修复前会让安装脚本在中途静默死掉、导致面板一直「未就绪」的那个前提。
  cat > "$work/bin/crontab" <<'FAKE'
#!/usr/bin/env bash
store="$SETUP_STATE/crontab.txt"
if [ "${1:-}" = "-l" ]; then
  [ -s "$store" ] || { echo "no crontab for $(id -un)" >&2; exit 1; }
  cat "$store"; exit 0
fi
if [ "${1:-}" = "-" ]; then cat > "$store"; exit 0; fi
exit 1
FAKE
  # 桩 docker：只需要回答运行中镜像的标签（脚本据此写基线版本）
  cat > "$work/bin/docker" <<'FAKE'
#!/usr/bin/env bash
case "$*" in
  *"Config.Image"*) echo "ghcr.io/sxlb/qiyun:0.0.8"; exit 0 ;;
  *) exit 0 ;;
esac
FAKE
  # 桩 install：只记录目标名，绝不真的写进 /usr/local/bin
  cat > "$work/bin/install" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$(basename "${@: -1}")" >> "$SETUP_STATE/installed.txt"
exit 0
FAKE
  # 桩 id：让脚本走 root 分支。CI 以非 root 运行，不桩的话权限处理那一段永远不会被执行到。
  cat > "$work/bin/id" <<'FAKE'
#!/usr/bin/env bash
case "${1:-}" in
  -un) echo root ;;
  *)   echo 0 ;;
esac
FAKE
  chmod +x "$work/bin/crontab" "$work/bin/docker" "$work/bin/install" "$work/bin/id"

  # 幂等场景：预置一份已有 crontab —— 含用户自己的两个任务，以及本通道的定时器。
  # 期望：脚本识别出「已安装」，一条都不重复写，也不动用户原有的行。
  if [ "$scenario" = "existing" ]; then
    {
      echo "*/5 * * * * /usr/bin/pre-existing-job"
      echo "* * * * * flock -n /tmp/qiyun-update.lock env REPO_DIR=/srv/old/qiyun /usr/local/bin/qiyun-update >/dev/null 2>&1"
      echo "17 3 * * * /usr/bin/other-job"
    } > "$work/state/crontab.txt"
  fi

  # 缺 cron 场景：造一个「PATH 里没有 crontab」的环境（其余桩照旧），
  # 用来验证脚本会明确报错退出，而不是以一行 command not found 中途神秘中断。
  local bin_dir="$work/bin"
  if [ "$scenario" = "nocron" ]; then
    bin_dir="$work/bin-nocron"
    mkdir -p "$bin_dir"
    for f in "$work/bin"/*; do
      [ "$(basename "$f")" = "crontab" ] && continue
      cp -f "$f" "$bin_dir/"
    done
  fi

  # 必须切到临时仓库目录再跑：find_repo 优先看 $PWD，否则会命中真实仓库、
  # 把 versions.json 写进真实 data/deploy
  local rc=0
  ( cd "$work/repo" && SETUP_STATE="$work/state" PATH="$bin_dir:$PATH" \
      bash scripts/setup-update.sh ) > "$work/out.txt" 2>&1 || rc=$?

  printf 'EXIT=%s\n' "$rc"
  printf 'INSTALLED=%s\n' "$(tr '\n' ',' < "$work/state/installed.txt" 2>/dev/null)"
  # 只数「本通道的 cron 行」（以锁文件路径为记号）：脚本名 qiyun-update 同时出现在
  # qiyun-update-cli 里，用脚本名计数会把命令行工具的安装也统计进来
  printf 'CRON_COUNT=%s\n' "$(count_lines "$work/state/crontab.txt" 'qiyun-update\.lock')"
  printf 'CRON_HAS_REPO=%s\n' "$(count_lines "$work/state/crontab.txt" 'REPO_DIR=')"
  printf 'CRON_PREEXISTING=%s\n' "$(count_lines "$work/state/crontab.txt" 'pre-existing-job')"
  printf 'CRON_OTHER=%s\n' "$(count_lines "$work/state/crontab.txt" 'other-job')"
  printf 'VERSIONS=%s\n' "$(tr -d ' \n' < "$work/repo/data/deploy/versions.json" 2>/dev/null || echo MISSING)"
  printf 'FINISHED=%s\n' "$(count_lines "$work/out.txt" '更新通道安装完成')"
  printf 'OUT=%s\n' "$(tr '\n' '|' < "$work/out.txt" | cut -c1-400)"
}

case "${1:-}" in
  probe) write_fake_docker_probe; PATH="$STUB_DIR:$PATH"; shift; cmd_probe "$@" ;;
  pull)  write_fake_docker_pull;  PATH="$STUB_DIR:$PATH"; shift; cmd_pull "$@" ;;
  rank)  shift; cmd_rank "$@" ;;
  speed) shift; cmd_speed "$@" ;;
  pref)  shift; cmd_pref "$@" ;;
  snap)  shift; cmd_snap "$@" ;;
  wal)   shift; cmd_wal "$@" ;;
  setup) shift; cmd_setup "$@" ;;
  *)     echo "用法: $0 <probe|pull|rank|speed|pref|snap|wal|setup> ..." >&2; exit 2 ;;
esac
