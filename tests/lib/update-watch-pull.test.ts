// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * update-watch.sh（后台一键更新的执行器）的拉取换源契约。
 *
 * 为什么用「读源码断言」而不是跑脚本：拉取依赖真实的 docker 与 registry，
 * 本机（Windows）没有 bash、CI 上也不适合在测试里起 docker。而这里要钉住的恰恰是
 * 「某段保护还在不在」——它缺失时不会报错，只会让一次更新从 2 分钟变成 30 分钟，
 * 正是线上真实发生过的那次事故（本脚本当时完全没有单源拉取预算）。
 *
 * 与之配套的纯逻辑用例在 tests/deploy/speed-probe.test.ts：
 * 那边从真实 deploy.sh 里抽函数执行，验证跳过规则与测速取值。
 */

const DEPLOY = readFileSync(join(process.cwd(), "deploy.sh"), "utf8");
const WATCH = readFileSync(join(process.cwd(), "scripts/update-watch.sh"), "utf8");

/** 剥掉整行注释后的代码，避免断言被解释性注释误触发 */
const stripComments = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

const WATCH_CODE = stripComments(WATCH);

/** 按函数名抽出完整函数体（从 `name() {` 到第一个顶格 `}`） */
function extractFn(src: string, name: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (start < 0) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i]);
    if (i > start && lines[i] === "}") break;
  }
  return out.join("\n");
}

describe("update-watch.sh · 必须有单源拉取预算（半小时事故的直接根因）", () => {
  it("定义了 PULL_SOURCE_TIMEOUT 且默认 300 秒", () => {
    expect(WATCH).toContain('PULL_SOURCE_TIMEOUT="${PULL_SOURCE_TIMEOUT:-300}"');
  });

  it("非末位来源的拉取用 timeout 兜底，并以 -k 强杀（docker CLI 不响应 SIGTERM）", () => {
    expect(WATCH_CODE).toMatch(/timeout -k 10 "\$PULL_SOURCE_TIMEOUT"\s*\\?\n?\s*docker compose --env-file "\$ENV_FILE" pull/);
  });

  it("124/137 都按「过慢」处理（SIGTERM 生效 / 被强杀），而不是当成拉取失败", () => {
    expect(WATCH_CODE).toContain("124|137)");
    expect(WATCH_CODE).toContain("${_cand}(过慢)");
    // 换源前留出收尾时间，避免下一次 pull 撞上同一镜像的并发操作
    expect(WATCH_CODE).toContain("sleep 2");
  });

  it("末位来源不设预算，保留「慢速链路也能拉完」的保证", () => {
    expect(WATCH_CODE).toContain('LAST_CAND="$_c"');
    expect(WATCH_CODE).toMatch(/\[ "\$_cand" != "\$LAST_CAND" \]/);
  });

  it("缺少 timeout 命令时不设预算，退回旧行为（不能把能成功的更新判成失败）", () => {
    expect(WATCH_CODE).toContain("HAVE_TIMEOUT=0");
    expect(WATCH_CODE).toMatch(/if command -v timeout >\/dev\/null 2>&1; then HAVE_TIMEOUT=1; fi/);
    expect(WATCH_CODE).toMatch(/\[ "\$HAVE_TIMEOUT" = "1" \]/);
  });
});

describe("update-watch.sh · 拉取前按实测速度选源", () => {
  it("定义了测速与选源两个函数", () => {
    expect(WATCH).toContain("speed_probe_kbps() {");
    expect(WATCH).toContain("rank_pull_chain() {");
  });

  it("在拉取循环之前调用 rank_pull_chain", () => {
    const rankIdx = WATCH.indexOf('rank_pull_chain "$version"');
    const loopIdx = WATCH.indexOf("for _cand in $PULL_CHAIN; do");
    expect(rankIdx).toBeGreaterThan(-1);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(rankIdx).toBeLessThan(loopIdx);
  });

  it("循环内跳过测速判定为过慢的来源，并计入失败清单（回执里能看出跳过了谁）", () => {
    expect(WATCH_CODE).toContain('case " ${SPEED_SKIPPED:-} " in');
    expect(WATCH_CODE).toMatch(/\*" \$_cand "\*\)/);
  });

  it("测速判定用的是可覆盖的达标线 PROBE_MIN_KBPS", () => {
    expect(WATCH).toContain('PROBE_MIN_KBPS="${PROBE_MIN_KBPS:-600}"');
  });
});

describe("两份脚本的测速实现必须保持一致", () => {
  // 两份脚本刻意各留一份实现（deploy.sh 常被单独复制到服务器上使用，
  // 依赖同目录的库文件会让它变脆）。代价是可能漂移，因此在这里钉住一致性：
  // 只改了一份而忘了另一份时，这条会立刻失败。
  it("speed_probe_kbps 逐字一致", () => {
    const a = extractFn(DEPLOY, "speed_probe_kbps");
    const b = extractFn(WATCH, "speed_probe_kbps");
    expect(a.length).toBeGreaterThan(500);
    expect(a).toBe(b);
  });

  it("rank_pull_chain 逐字一致", () => {
    const a = extractFn(DEPLOY, "rank_pull_chain");
    const b = extractFn(WATCH, "rank_pull_chain");
    expect(a.length).toBeGreaterThan(200);
    expect(a).toBe(b);
  });
});
