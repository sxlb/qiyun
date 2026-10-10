import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

/**
 * 拉取换源的「实测下载速度」判定。
 *
 * 为什么需要它：可达性探测只能回答「连不连得上」，回答不了「拉得快不快」。
 * 线上实测过一个形态：manifest 探测 7 秒就通过，实际吞吐只有约 150KB/s，
 * 按 267MB 的镜像估算要 30 分钟——而换源此前只在「失败」时发生，于是整次更新都挂在这上面。
 * 更糟的是 update-watch.sh（后台一键更新走的通道）当时连拉取预算都没有。
 *
 * 这组用例分两层：
 *   1) rank_pull_chain 的跳过规则：桩掉测速，纯逻辑，确定性强；
 *   2) speed_probe_kbps 端到端：起一个本地假 registry，按 registry 协议真跑一遍
 *      （令牌 → 多架构索引下钻 → Range 取样），确认量出来的吞吐与设定值相符。
 *
 * 环境要求：bash + timeout + python3/python。缺任一则整组跳过（本机 Windows 通常会跳过，
 * CI 的 ubuntu-latest 会执行）。
 */

const HARNESS = fileURLToPath(new URL("./harness/deploy-logic.sh", import.meta.url));

function has(cmd: string): boolean {
  return spawnSync("bash", ["-c", `command -v ${cmd} >/dev/null 2>&1`], { stdio: "ignore" }).status === 0;
}

const ENV_READY = has("timeout") && has("awk") && has("mktemp");
const PYTHON_READY = has("python3") || has("python");

function runHarness(...args: string[]): Record<string, string> {
  const res = spawnSync("bash", [HARNESS, ...args], { encoding: "utf8", timeout: 90_000 });
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

describe.skipIf(!ENV_READY)("deploy.sh · 按实测速度选源（rank_pull_chain）", () => {
  const rank = (chain: string) => runHarness("rank", chain);

  it("首个来源就达标 → 不跳过任何来源，且不再探测后面的（短路，避免白花测速时间）", () => {
    const r = rank("fast.example/a slow.example/b");
    expect(r.SKIPPED).toBe("");
    expect(r.SUMMARY).toBe("fast.example/a=5000KB/s");
    // 关键：只探了第一个。若把整条链都探一遍，快源场景每次更新都要多等好几秒。
    expect(r.PROBED).toBe("fast.example/a");
  });

  it("慢源在前、快源在后 → 跳过慢源（这正是「卡在上海外源半小时」要解决的场景）", () => {
    const r = rank("slow.example/a fast.example/b");
    expect(r.SKIPPED).toBe(" slow.example/a");
  });

  it("全部来源都偏慢 → 一个都不跳过（跳过谁都无益，绝不能把候选清空）", () => {
    const r = rank("slow.example/a slow.example/b");
    expect(r.SKIPPED).toBe("");
    expect(r.SUMMARY).toContain("slow.example/a=100KB/s");
  });

  it("测不到速度的来源不参与判定，但也不阻断对后续来源的探测", () => {
    const r = rank("dead.example/a slow.example/b fast.example/c");
    expect(r.SKIPPED).toBe(" slow.example/b");
    expect(r.SUMMARY).toBe("dead.example/a=未知 slow.example/b=100KB/s fast.example/c=5000KB/s");
  });

  it("候选链只有一个来源 → 省掉整段测速（跳过与否都无意义）", () => {
    const r = rank("slow.example/a");
    expect(r.SKIPPED).toBe("");
    expect(r.SUMMARY).toBe("");
    expect(r.PROBED).toBe("");
  });
});

describe.skipIf(!ENV_READY)("deploy.sh · 测速缺失时优雅降级（speed_probe_kbps）", () => {
  it("SPEED_PROBE=0 → 完全不做测速", () => {
    const r = runHarness("speed", "disabled", "http://127.0.0.1:1/x/y");
    expect(r.KPBS).toBe("");
    expect(r.RC).toBe("0");
  });

  it("机器上没有 python → 静默返回空，不报错", () => {
    const r = runHarness("speed", "nopy", "http://127.0.0.1:1/x/y");
    expect(r.KPBS).toBe("");
    expect(r.RC).toBe("0");
  });

  it("python 输出非数字 → 一律当「测不到」（日志/告警不能污染判定）", () => {
    const r = runHarness("speed", "garbage", "http://127.0.0.1:1/x/y");
    expect(r.KPBS).toBe("");
    expect(r.RC).toBe("0");
  });

  it("python 输出数字 → 原样透传（验证参数与输出管路是通的）", () => {
    const r = runHarness("speed", "stub", "http://127.0.0.1:1/x/y");
    expect(r.KPBS).toBe("1234");
    expect(r.RC).toBe("0");
  });
});

/* ==================== 端到端：本地假 registry ==================== */

const LAYER_DIGEST = `sha256:${"a".repeat(64)}`;
const SUB_DIGEST = `sha256:${"b".repeat(64)}`;
const LAYER_SIZE = 8 * 1024 * 1024;
/** 快慢由仓库路径决定：含 slow 的限速 120KB/s，其余 2048KB/s */
const SLOW_KBPS = 120;
const FAST_KBPS = 2048;

function sendJson(res: ServerResponse, obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(200, { "content-type": "application/json", "content-length": String(body.length) });
  res.end(body);
}

/** 按目标速率吐字节；客户端提前断开时静默收场（探测只取一小段就会关闭连接） */
function streamThrottled(res: ServerResponse, total: number, bytesPerSec: number): void {
  const chunk = Buffer.alloc(65536, 0x78);
  const t0 = Date.now();
  let sent = 0;
  res.on("error", () => {});
  const pump = () => {
    if (res.destroyed || res.writableEnded) return;
    if (sent >= total) {
      res.end();
      return;
    }
    const n = Math.min(chunk.length, total - sent);
    sent += n;
    res.write(chunk.subarray(0, n));
    const due = t0 + (sent / bytesPerSec) * 1000;
    setTimeout(pump, Math.max(0, due - Date.now()));
  };
  pump();
}

async function startRegistry(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];

    const man = /^\/v2\/(.+)\/manifests\/(.+)$/.exec(url);
    if (man) {
      const repoPath = man[1];
      if (repoPath.includes("missing")) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      if (man[2] === SUB_DIGEST) {
        sendJson(res, {
          schemaVersion: 2,
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          layers: [
            { digest: `sha256:${"d".repeat(64)}`, size: 1024 },
            { digest: LAYER_DIGEST, size: LAYER_SIZE },
          ],
        });
        return;
      }
      sendJson(res, {
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [{ digest: SUB_DIGEST, platform: { architecture: "amd64", os: "linux" } }],
      });
      return;
    }

    const blob = /^\/v2\/(.+)\/blobs\/(.+)$/.exec(url);
    if (blob) {
      const rate = blob[1].includes("slow") ? SLOW_KBPS * 1024 : FAST_KBPS * 1024;
      const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ""));
      const start = range ? Number(range[1]) : 0;
      const end = range ? Math.min(Number(range[2]), LAYER_SIZE - 1) : LAYER_SIZE - 1;
      const total = end - start + 1;
      res.writeHead(range ? 206 : 200, {
        "content-type": "application/octet-stream",
        "content-length": String(total),
        "accept-ranges": "bytes",
      });
      streamThrottled(res, total, rate);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // 探测会提前断开连接，先掐断所有连接，避免 close() 一直等
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

describe.skipIf(!ENV_READY || !PYTHON_READY)(
  "deploy.sh · 测速端到端（真实 registry 协议 + 本地假 registry）",
  () => {
    const CASE_TIMEOUT_MS = 60_000;

    it(
      "快源：量出的吞吐与限速相符（2048KB/s 量级）",
      async () => {
        const reg = await startRegistry();
        try {
          const r = runHarness("speed", "real", `http://127.0.0.1:${reg.port}/fast/sxlb/qiyun`);
          expect(r.RC).toBe("0");
          const kbps = Number(r.KPBS);
          expect(Number.isFinite(kbps)).toBe(true);
          expect(kbps).toBeGreaterThan(1000);
        } finally {
          await reg.close();
        }
      },
      CASE_TIMEOUT_MS
    );

    it(
      "慢源：量出低吞吐（这正是要在拉取前识别出来的目标场景）",
      async () => {
        const reg = await startRegistry();
        try {
          const r = runHarness("speed", "real", `http://127.0.0.1:${reg.port}/slow/sxlb/qiyun`);
          expect(r.RC).toBe("0");
          const kbps = Number(r.KPBS);
          expect(Number.isFinite(kbps)).toBe(true);
          // 明显低于 600KB/s 的达标线，因而会被跳过
          expect(kbps).toBeLessThan(400);
        } finally {
          await reg.close();
        }
      },
      CASE_TIMEOUT_MS
    );

    it(
      "清单不存在：放弃测量且不报错（站点拒绝 / 版本不存在都走这条）",
      async () => {
        const reg = await startRegistry();
        try {
          const r = runHarness("speed", "real", `http://127.0.0.1:${reg.port}/missing/sxlb/qiyun`);
          expect(r.KPBS).toBe("");
          expect(r.RC).toBe("0");
        } finally {
          await reg.close();
        }
      },
      CASE_TIMEOUT_MS
    );
  }
);
