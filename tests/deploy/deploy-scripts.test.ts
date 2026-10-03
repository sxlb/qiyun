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
