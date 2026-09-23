import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeVersion, compareVersions, isNewerRelease, isTimestampTag, resetReleaseCache } from "@/lib/version";
import {
  newId,
  deployDir,
  writeRequest,
  readRequest,
  execState,
  rollbackTargets,
  listBackupSnapshots,
  checkDeployDirWritable,
  DeployDirError,
} from "@/lib/update";

describe("lib/version 版本比较", () => {
  beforeEach(() => resetReleaseCache());

  it("normalizeVersion 去掉 v 前缀", () => {
    expect(normalizeVersion("v1.2.0")).toBe("1.2.0");
    expect(normalizeVersion("1.2.0")).toBe("1.2.0");
    expect(normalizeVersion("V2.0.1")).toBe("2.0.1");
    expect(normalizeVersion("")).toBe("");
  });

  it("compareVersions 语义化比较正确", () => {
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.3.0", "1.2.0")).toBe(1);
    expect(compareVersions("1.2.9", "1.3.0")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1); // 逐段数值比较，非字典序
    expect(compareVersions("1.2", "1.2.0")).toBe(0); // 缺段按 0
    expect(compareVersions("", "1.0.0")).toBe(-1);
  });

  it("compareVersions 兼容 home-时间戳 tag（按时间先后）", () => {
    expect(compareVersions("home-2026-8-26-01-19-01", "home-2026-8-26-01-19-01")).toBe(0);
    expect(compareVersions("home-2026-8-26-01-19-01", "home-2026-8-25-01-19-01")).toBe(1);
    expect(compareVersions("home-2026-8-25-01-19-01", "home-2026-8-26-01-19-01")).toBe(-1);
    // 同日期内按时刻比较
    expect(compareVersions("home-2026-8-26-09-00-00", "home-2026-8-26-18-00-00")).toBe(-1);
    // 时间戳 vs 语义化：时间戳视为较新（既有版本判定不因格式差异而误判为无更新）
    expect(compareVersions("home-2026-8-26-01-19-01", "1.2.0")).toBe(1);
  });

  it("isTimestampTag 识别发布 tag", () => {
    expect(isTimestampTag("home-2026-8-26-01-19-01")).toBe(true);
    expect(isTimestampTag("v1.2.0")).toBe(false);
  });

  it("isNewerRelease 判断新版本", () => {
    expect(isNewerRelease("v1.3.0", "1.2.0")).toBe(true);
    expect(isNewerRelease("v1.2.0", "1.2.0")).toBe(false);
    expect(isNewerRelease("v1.1.0", "1.2.0")).toBe(false);
  });
});

describe("lib/update 更新握手协议（临时目录隔离）", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-update-"));
  });

  it("writeRequest/readRequest 原子写读一致", () => {
    writeRequest({ id: "t1", action: "update", method: "build", version: "v1.2.0", requestedBy: "admin", createdAt: new Date().toISOString() }, tmp);
    const req = readRequest(tmp);
    expect(req?.id).toBe("t1");
    expect(req?.action).toBe("update");
    expect(req?.method).toBe("build");
  });

  it("execState 待执行时返回 pending", () => {
    writeRequest({ id: "t2", action: "rollback", method: "image", version: "v1.1.0", requestedBy: "admin", createdAt: new Date().toISOString() }, tmp);
    const state = execState(tmp);
    expect(state.kind).toBe("pending");
    expect(state.request?.version).toBe("v1.1.0");
  });

  it("execState 无请求时返回 idle", () => {
    expect(execState(tmp).kind).toBe("idle");
  });

  it("rollbackTargets 去重并排除当前版本", () => {
    const dir = deployDir(tmp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "versions.json"),
      JSON.stringify({
        currentVersion: "1.3.0",
        updatedAt: "2026-09-05T00:00:00Z",
        history: [
          { version: "1.3.0", action: "update", at: "a" },
          { version: "1.2.0", action: "update", at: "b" },
          { version: "1.1.0", action: "update", at: "c" },
          { version: "1.2.0", action: "rollback", at: "d" },
        ],
      })
    );
    expect(rollbackTargets(tmp, "1.3.0")).toEqual(["1.2.0", "1.1.0"]);
    expect(rollbackTargets(tmp, "1.2.0")).toEqual(["1.1.0", "1.3.0"]);
  });

  it("listBackupSnapshots 解析文件名并按时间倒序", () => {
    const dir = path.join(deployDir(tmp), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const older = path.join(dir, "prod-v1.2.0-20260905-120000.db");
    fs.writeFileSync(older, "a");
    const newer = path.join(dir, "prod-v1.3.0-20260906-100000.db");
    fs.writeFileSync(newer, "b");
    // 显式设置不同 mtime（真实部署间隔以秒/分钟计，仅测试里写在同一瞬时需固定其顺序）
    const t1 = Date.parse("2026-09-05T12:00:00Z") / 1000;
    const t2 = Date.parse("2026-09-06T10:00:00Z") / 1000;
    fs.utimesSync(older, t1, t1);
    fs.utimesSync(newer, t2, t2);
    const snaps = listBackupSnapshots(tmp);
    expect(snaps.length).toBe(2);
    expect(snaps[0].version).toBe("v1.3.0"); // 排序后最新在前
    expect(snaps[1].file).toMatch(/prod-v1\.2\.0-20260905-120000\.db/);
  });

  it("newId 生成唯一 id", () => {
    expect(newId()).not.toBe(newId());
  });
});

describe("部署目录可写性（容器非 root + data/deploy 属主 root 的线上 500 回归）", () => {
  let tmp: string;
  // 用普通文件占位当 base：其下无法创建 deploy/ 子目录，稳定复现"目录不可写"
  let blocked: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyun-deploy-"));
    blocked = path.join(tmp, "not-a-dir");
    fs.writeFileSync(blocked, "x");
  });

  it("目录不可写时返回可照做的修复提示（含 chown/chmod 命令），而非笼统报错", () => {
    const msg = checkDeployDirWritable(blocked);
    expect(msg).toBeTruthy();
    expect(msg).toContain("对应用不可写");
    expect(msg).toContain("chown -R 1001:1001");
    expect(msg).toContain("chmod 775");
    expect(msg).toContain("setup-update.sh");
  });

  it("目录可写时返回 null，writeRequest 正常落盘握手请求", () => {
    expect(checkDeployDirWritable(tmp)).toBeNull();
    writeRequest(
      {
        id: "test-1",
        action: "update",
        method: "image",
        version: "0.0.21",
        requestedBy: "admin",
        createdAt: new Date().toISOString(),
      },
      tmp
    );
    expect(readRequest(tmp)?.version).toBe("0.0.21");
  });

  it("写入失败抛 DeployDirError（带目录与修复命令），不把裸 EACCES 抛给上层", () => {
    let thrown: unknown;
    try {
      writeRequest(
        {
          id: "test-2",
          action: "update",
          method: "image",
          version: "0.0.21",
          requestedBy: "admin",
          createdAt: new Date().toISOString(),
        },
        blocked
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DeployDirError);
    const err = thrown as DeployDirError;
    expect(err.dir).toBe(deployDir(blocked));
    expect(err.message).toContain("sudo chown -R 1001:1001");
    expect(err.cause).toBeDefined(); // 原始 EACCES/ENOTDIR 保留，便于日志追根因
  });

  it("部署目录不可创建时，状态查询降级为空闲而不是抛错", () => {
    expect(execState(blocked).kind).toBe("idle");
  });
});