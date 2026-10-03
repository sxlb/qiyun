import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * deploy.sh 的 shell 行为测试。
 *
 * 为什么用「跑真实脚本」的方式测：来源可达性判定、拉取换源、记住上次成功的来源，
 * 这三块都是 shell 里的流程控制，用 JS 重写一遍去测只能证明副本是对的。
 * 夹具（harness/deploy-logic.sh）用 awk 从 deploy.sh 里抽出函数再执行，
 * 因此改坏原脚本会立刻反映到断言上。
 *
 * 之所以补齐这组测试：仓库里此前没有任何东西断言 deploy.sh，而这正是
 * 「探测误杀可用加速器」「可达但极慢的来源永远不换源」这两个问题能一直藏着的原因——
 * 它们都不报错，只在真实部署时以「卡住几小时 / 用不上最快的源」的形式暴露。
 *
 * 环境要求：bash + GNU 风格 coreutils（timeout / awk / mktemp）。
 * 本机为 Windows（PATH 上没有 bash）时整组跳过，CI（ubuntu-latest）会执行。
 * 「WAL 事务」那一组另需 python3（带 sqlite3 模块），缺了它只跳过该组，不影响其余断言。
 */

const HARNESS = fileURLToPath(new URL("./harness/deploy-logic.sh", import.meta.url));

/** 夹具依赖的外部命令是否齐备；缺任一就整组跳过，而不是报一堆看不懂的失败 */
function harnessEnvReady(): boolean {
  const probe = spawnSync(
    "bash",
    [
      "-c",
      "command -v timeout >/dev/null 2>&1 && command -v awk >/dev/null 2>&1 && command -v mktemp >/dev/null 2>&1",
    ],
    { stdio: "ignore" }
  );
  return probe.status === 0;
}

const ENV_READY = harnessEnvReady();

/** WAL 回归组额外需要 python 的 sqlite3 模块：用它造出「事务只在 WAL 里」的真实形态 */
function sqliteEnvReady(): boolean {
  // CI 上是 python3，Windows 本地通常只有 python，两种都认
  for (const bin of ["python3", "python"]) {
    const probe = spawnSync(bin, ["-c", "import sqlite3"], { stdio: "ignore" });
    if (probe.status === 0) return true;
  }
  return false;
}

const SQLITE_READY = ENV_READY && sqliteEnvReady();

/**
 * 环境自身是否装了 crontab。
 * 「机器上没有 crontab 命令」这一组用例要求 PATH 里确实找不到它 —— 如果宿主装了 cron，
 * 夹具把桩摘掉后仍会命中系统的那一个，断言就没有意义了，所以这种情况下直接跳过。
 */
function systemHasCrontab(): boolean {
  const probe = spawnSync("bash", ["-c", "command -v crontab >/dev/null 2>&1"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

const NO_SYSTEM_CRONTAB = !systemHasCrontab();

/** 运行夹具，把 KEY=VALUE 输出解析成对象 */
function runHarness(...args: string[]): Record<string, string> {
  const res = spawnSync("bash", [HARNESS, ...args], { encoding: "utf8", timeout: 120_000 });
  if (res.error) throw res.error;
  const stdout = `${res.stdout ?? ""}`;
  if (res.status !== 0) {
    throw new Error(
      `夹具执行失败 status=${res.status}\n参数：${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${res.stderr ?? ""}`
    );
  }
  const parsed: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) parsed[line.slice(0, at)] = line.slice(at + 1);
  }
  return parsed;
}

describe.skipIf(!ENV_READY)("deploy.sh · 来源探测判定", () => {
  const probe = (mode: string) => runHarness("probe", mode, "example.com/sxlb/qiyun:0.0.6");

  it("正常返回 manifest → 放行", () => {
    expect(probe("ok").VERDICT).toBe("allow");
  });

  it("打印了 manifest 但进程卡住 → 放行（真实踩过的误杀：只看退出码会把它当成不可用）", () => {
    const r = probe("manifest_then_hang");
    expect(r.VERDICT).toBe("allow");
    expect(r.PROBE_ERR).toContain("schemaVersion");
  });

  it("没有任何输出且卡住 → 放行（没拿到证据就不排除）", () => {
    expect(probe("silent_hang").VERDICT).toBe("allow");
  });

  it("connection refused → 排除（明确不可达）", () => {
    const r = probe("refused");
    expect(r.VERDICT).toBe("exclude");
    expect(r.PROBE_ERR).toContain("connection refused");
  });

  it("no such host → 排除", () => {
    expect(probe("nohost").VERDICT).toBe("exclude");
  });

  it("鉴权报错 → 放行（拉取会走完整鉴权流程，结果未必相同）", () => {
    expect(probe("unauthorized").VERDICT).toBe("allow");
  });
});

describe.skipIf(!ENV_READY)("deploy.sh · 拉取换源", () => {
  // 这些用例本身就要跑几秒到十几秒：脚本里的拉取预算是 1s，而 timeout 的 -k 强杀
  // 兜底是固定的 10s（docker CLI 不响应 SIGTERM，只能靠强杀）。默认的 5s 单测超时
  // 会把它们误判为失败，所以显式放宽，而不是去改脚本里的常量。
  const CASE_TIMEOUT_MS = 30_000;

  it(
    "不可达 → 过慢 → 可用：跳过死的、掐断慢的、用上能用的",
    () => {
      const r = runHarness("pull", "dead.example/x slow.example/a fast.example/b", "1");
      expect(r.PULLED_REPO).toBe("fast.example/b");
      expect(r.PULL_FAILED).toContain("dead.example/x");
      expect(r.PULL_FAILED).toContain("slow.example/a(过慢)");
    },
    CASE_TIMEOUT_MS
  );

  it(
    "首个来源就在预算内成功：不做任何切换",
    () => {
      const r = runHarness("pull", "fast.example/a slow.example/b", "1");
      expect(r.PULLED_REPO).toBe("fast.example/a");
      expect(r.PULL_FAILED).toBe("");
    },
    CASE_TIMEOUT_MS
  );

  it(
    "链上末尾来源不设预算：前面按预算换源，末位耗时超过预算也能拉完",
    () => {
      const r = runHarness("pull", "slow.example/a lastslow.example/b", "1");
      expect(r.PULLED_REPO).toBe("lastslow.example/b");
      expect(r.PULL_FAILED).toContain("slow.example/a(过慢)");
    },
    CASE_TIMEOUT_MS
  );

  it(
    "PULL_SOURCE_TIMEOUT=0：不因慢换源，回到旧行为",
    () => {
      const r = runHarness("pull", "lastslow.example/a fast.example/b", "0");
      expect(r.PULLED_REPO).toBe("lastslow.example/a");
      expect(r.PULL_FAILED).toBe("");
    },
    CASE_TIMEOUT_MS
  );

  it(
    "来源忽略 SIGTERM：被 timeout -k 强杀（rc=137）后同样按「过慢」处理",
    () => {
      const r = runHarness("pull", "ignoresig.example/a fast.example/b", "1");
      expect(r.PULLED_REPO).toBe("fast.example/b");
      expect(r.PULL_FAILED).toContain("ignoresig.example/a(过慢)");
    },
    CASE_TIMEOUT_MS
  );
});

describe.skipIf(!ENV_READY)("deploy.sh · 镜像源记忆", () => {
  const CHAIN = "a/x b/y c/z";

  it("没有记录：候选链不变", () => {
    expect(runHarness("pref", "__NONE__", CHAIN).PULL_CHAIN).toBe(CHAIN);
  });

  it("记录的是末位来源：提到最前，其余相对顺序不变", () => {
    expect(runHarness("pref", "c/z", CHAIN).PULL_CHAIN).toBe("c/z a/x b/y");
  });

  it("记录的是中间来源：同样提到最前", () => {
    expect(runHarness("pref", "b/y", CHAIN).PULL_CHAIN).toBe("b/y a/x c/z");
  });

  it("记录已不在候选链上：忽略，不凭历史记录凭空造来源", () => {
    expect(runHarness("pref", "old.example/x", CHAIN).PULL_CHAIN).toBe(CHAIN);
  });

  it("记录文件为空：忽略", () => {
    expect(runHarness("pref", "__EMPTY__", CHAIN).PULL_CHAIN).toBe(CHAIN);
  });

  it("记录带前后空白与多余换行：清理后仍生效", () => {
    expect(runHarness("pref", "__WHITESPACE__", CHAIN).PULL_CHAIN).toBe("b/y a/x c/z");
  });

  it("单元素候选链：无变化", () => {
    expect(runHarness("pref", "a/x", "a/x").PULL_CHAIN).toBe("a/x");
  });

  it("remember_source 写入的内容能被 read_preferred_source 原样读回", () => {
    expect(runHarness("pref", "c/z", CHAIN).SAVED).toBe("c/z");
  });
});

/**
 * 数据库快照必须连 WAL 一起存。
 *
 * 背景（线上实测）：更新脚本先停容器再 `cp prod.db`，注释里写着「停容器即可保证 WAL 落盘」。
 * 这个前提是错的 —— 容器以 PID 1 跑 shell，SIGTERM 未必转发给 node，10s 后被 Docker SIGKILL，
 * SQLite 来不及做收尾 checkpoint。结果是一份快照里 VisitRecord 是 0 条，而同一时刻
 * prod.db-wal 里躺着 14 条已提交记录：那份快照一旦被用来回滚，这 14 条就静默消失了。
 */
describe.skipIf(!ENV_READY)("deploy.sh · 数据库快照与还原（WAL 成组）", () => {
  const snap = (scenario: string) => runHarness("snap", scenario);
  const files = (r: Record<string, string>) => (r.FILES ?? "").split(",").filter(Boolean);

  it("存在 WAL 时，快照连侧车一起存", () => {
    const f = files(snap("backup_with_wal"));
    expect(f.some((x) => /^prod-0\.0\.6-\d{8}-\d{6}\.db$/.test(x))).toBe(true);
    expect(f.some((x) => /^prod-0\.0\.6-\d{8}-\d{6}\.db-wal$/.test(x))).toBe(true);
  });

  it("WAL 为空文件时不产生多余侧车", () => {
    const f = files(snap("backup_empty_wal"));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/\.db$/);
  });

  it("没有 WAL 文件时不凭空造一个", () => {
    const f = files(snap("backup_no_wal"));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/\.db$/);
  });

  it("还原时把快照里的 WAL 一并还原，并清掉旧的 WAL/SHM 残留", () => {
    const r = snap("restore_with_wal");
    expect(r.WAL).toBe("WALDATA");
    // -shm 只是 WAL 的内存索引，不该被还原（照搬可能与新位置的 WAL 对不上）
    expect(r.HAS_SHM).toBe("no");
  });

  it("升级前的旧快照（无侧车）仍能还原，且不留残留 WAL", () => {
    const r = snap("restore_without_wal");
    expect(r.HAS_WAL).toBe("no");
    expect(r.HAS_SHM).toBe("no");
  });

  it("裁剪超量快照时连侧车一起删，不留孤儿（保留最近 2 份）", () => {
    const f = files(snap("prune"));
    expect(f.filter((x) => x.endsWith(".db"))).toHaveLength(2);
    // 侧车数量与主文件数量一致 = 没有孤儿 -wal 留在目录里
    expect(f.filter((x) => x.endsWith(".db-wal"))).toHaveLength(2);
    expect(f.join(",")).toContain("prod-0.0.4-");
    expect(f.join(",")).toContain("prod-0.0.3-");
    expect(f.join(",")).not.toContain("prod-0.0.1-");
    expect(f.join(",")).not.toContain("prod-0.0.2-");
  });
});

/**
 * setup-update.sh —— 更新通道安装器。
 *
 * 背景：脚本是 set -euo pipefail，而「机器上还没有任何 crontab」时 `crontab -l` 返回非 0。
 * 它原先被放进 `( ... ) | crontab -` 子 shell，子 shell 因此当场中止，后面那行 echo 永远
 * 执行不到 —— cron 装不上、versions.json 也写不成，后台「系统更新」就一直提示
 * 「宿主机更新通道尚未就绪」。而安装器唯一的用武之地恰恰就是全新服务器，必然踩中。
 *
 * 反向验证过：把那一处还原成 `( ... )` 旧写法，本用例会以 EXIT=1 / CRON_COUNT=0 /
 * VERSIONS=MISSING / FINISHED=0 失败，确认它真的抓得住这个 bug。
 */
describe.skipIf(!ENV_READY)("setup-update.sh · 全新服务器（尚无 crontab）", () => {
  it("能装完：cron 写入并带 REPO_DIR、基线版本落盘、脚本走到最后一步", () => {
    const r = runHarness("setup");

    expect(r.EXIT).toBe("0");
    expect(r.INSTALLED).toContain("qiyun-update");
    // cron 必须真的写进去，且带上 REPO_DIR，否则执行器定位不到仓库
    expect(Number(r.CRON_COUNT)).toBe(1);
    expect(Number(r.CRON_HAS_REPO)).toBe(1);
    // versions.json 就是面板 hostReady 的判据，它落盘才算通道可用
    expect(r.VERSIONS).toContain('"currentVersion":"0.0.8"');
    // 走到脚本最后一步（前置步骤静默中止时这里会是 0）
    expect(Number(r.FINISHED)).toBe(1);
  });
});

/**
 * 幂等：安装器会被反复执行（升级、换仓库目录时都要求重跑）。
 *
 * 判断「已安装」用的记号是锁文件路径而不是脚本名 —— `qiyun-update` 同时出现在
 * `qiyun-update-cli` 里，用脚本名匹配会把「只装了命令行工具、没装定时器」误判成已安装，
 * 从此再也装不上定时器。
 *
 * 这里同时守住「重复执行不写第二行」：早期是 `crontab -l | grep -q` 直接成管道，
 * grep 命中即退出会让 crontab -l 收到 SIGPIPE 以非 0 结束，在 set -o pipefail 下
 * 整条管道被判为失败，于是已安装的机器又追加了一行重复的 cron。
 */
describe.skipIf(!ENV_READY)("setup-update.sh · 重复执行（已有 crontab）", () => {
  it("识别为已安装：不重复写 cron，也不动用户原有的任务", () => {
    const r = runHarness("setup", "existing");

    expect(r.EXIT).toBe("0");
    // 仍然只有一条本通道的 cron
    expect(Number(r.CRON_COUNT)).toBe(1);
    // 用户自己的两个任务原样保留
    expect(Number(r.CRON_PREEXISTING)).toBe(1);
    expect(Number(r.CRON_OTHER)).toBe(1);
    // 仍然走到最后一步
    expect(Number(r.FINISHED)).toBe(1);
    expect(r.OUT).toContain("定时器已存在");
  });
});

/**
 * 机器上没有 crontab 命令时必须明确报错退出。
 * 修好「容器没有 crontab 命令」这一态之前，脚本会以一行 `crontab: command not found`
 * 在管道处中断：二进制装好了、基线版本没写、面板只显示「更新通道尚未就绪」，看不出原因。
 */
describe.skipIf(!ENV_READY || !NO_SYSTEM_CRONTAB)(
  "setup-update.sh · 机器上没有 crontab 命令",
  () => {
    it("给出明确的中文提示并以非 0 退出，而不是静默中断", () => {
      const r = runHarness("setup", "nocron");

      expect(r.EXIT).not.toBe("0");
      expect(r.OUT).toContain("未检测到 crontab");
      // 二进制仍应装好（便于装完 cron 后直接重跑），但基线版本不会写
      expect(r.INSTALLED).toContain("qiyun-update");
      expect(r.FINISHED).toBe("0");
    });
  }
);

/**
 * 真实 SQLite 回归。上面那组是文件级断言，这组直接验证「数据还在不在」：
 * 用 python 造一个已提交但未 checkpoint 的库（os._exit 跳过收尾），
 * 再对比「只拷主库」与「成组快照 + 成组还原」两种做法的行数。
 */
describe.skipIf(!SQLITE_READY)("deploy.sh · 快照必须保住未 checkpoint 的 WAL 事务", () => {
  it("只拷主库会丢数据；成组快照 + 成组还原能把数据找回来", () => {
    const r = runHarness("wal");

    // 前置：确实造出了「数据只在 WAL 里」的形态
    expect(Number(r.WAL_BYTES)).toBeGreaterThan(0);
    // 只把主库文件拷走，3 条一条都不剩 —— 这正是线上踩到的坑
    expect(["none", "0"]).toContain(r.ROWS_DBONLY);
    // 修完之后：成组快照 → 成组还原，3 条完整回来
    expect(r.ROWS_RESTORED).toBe("3");
  });
});
